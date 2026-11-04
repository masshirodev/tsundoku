<script lang="ts">
	import SourceRow from '../browse/SourceRow.svelte';
	import { ago } from '$lib/library/tracking';
	import { goto, invalidateAll } from '$app/navigation';
	import { MediaQuery } from 'svelte/reactivity';
	import { TV } from '$lib/device.svelte';
	import TopBar from '$lib/components/chrome/TopBar.svelte';
	import Cover from '$lib/components/content/Cover.svelte';
	import SearchField from '$lib/components/controls/SearchField.svelte';
	import TagChip from '$lib/components/controls/TagChip.svelte';
	import SeriesSheet from '../SeriesSheet.svelte';
	import Band from '$lib/components/chrome/Band.svelte';
	import { enhance } from '$app/forms';
	import type { SubmitFunction } from '@sveltejs/kit';
	import { wholeBand, type WholeAnswer } from '$lib/library/works';
	import { count, kindLabel } from '$lib/library/labels';
	import { resolve } from '$app/paths';
	import { page } from '$app/state';
	import { coverSrc, searchHref, shelfHref, tagHref } from '$lib/library/links';
	import { parseSearch, splitMatch } from '$lib/library/search';
	import {
		browserSupportsWebAuthn,
		startAuthentication,
		startRegistration
	} from '@simplewebauthn/browser';

	let { data } = $props();

	// The TV cannot turn reveal on: no fingerprint, no screen lock (owner,
	// 2026-11-01). `/reveal` says so instead of asking for a ceremony.
	const tvScreen = new MediaQuery(TV, false);

	// Seeded once from the URL; after that the field owns the text and the URL
	// follows it, not the other way round.
	// svelte-ignore state_referenced_locally
	let q = $state(data.q);
	let sheetId = $state<number | null>(null);
	let input = $state<HTMLInputElement | null>(null);

	/**
	 * Results follow the typing, a beat behind it, by replacing the URL -- so
	 * the back button leaves search rather than stepping through every letter.
	 * Commands are never searched live; they run on Enter only.
	 */
	let timer: ReturnType<typeof setTimeout> | undefined;
	$effect(() => {
		const text = q;
		clearTimeout(timer);
		if (text === data.q) return;
		const parsed = parseSearch(text);
		// A command with no results on screen has nothing to clear. Navigating
		// anyway raced the command itself: /reveal's goto('/') could land first
		// and be replaced by this one 180ms later, leaving you on /search.
		if (parsed.type !== 'query' && data.q === '') return;
		timer = setTimeout(() => {
			const target = searchHref(parsed.type === 'query' ? parsed.text : '');
			// eslint-disable-next-line svelte/no-navigation-without-resolve -- searchHref() resolves
			void goto(target, { replaceState: true, keepFocus: true, noScroll: true });
		}, 180);
		return () => clearTimeout(timer);
	});

	const query = $derived(parseSearch(data.q).type === 'query' ? data.q.trim() : '');

	/**
	 * HIDE ALL n from a hit's series sheet (c391): the library's band, here. The
	 * sheet posts the library's `?/hide`, whose answer SvelteKit applies only on
	 * the library, so the sheet hands it over (`onhid`) and this page draws it
	 * with the library's own words (`wholeBand`) and UNDO. It belongs to the
	 * query it was pressed on, as the library's `form` belongs to its page: a
	 * new query is a new page, and the band goes with the old one.
	 */
	let hid = $state<{ q: string; answer: WholeAnswer; refused: string } | null>(null);
	const hidBand = $derived.by(() => {
		if (!hid || hid.q !== data.q) return null;
		const a = hid.answer;
		if ('hideFacts' in a) {
			const f = a.hideFacts;
			return {
				...wholeBand('HIDDEN', { ids: f.hidden, whole: f.whole, works: f.works }),
				action: '/?/undoHide',
				facts: JSON.stringify(f)
			};
		}
		const f = a.showFacts;
		return {
			...wholeBand('SHOWN', { ids: f.shown, whole: f.whole, works: f.works }),
			action: '/?/undoShow',
			facts: JSON.stringify(f)
		};
	});
	/**
	 * UNDO posts the library's own UNDO, whose answer is not this page's either:
	 * a success takes the band down and re-reads the hits; a refusal (the
	 * library has moved on since, c308) stays on the band and says why.
	 */
	const undoHid: SubmitFunction =
		() =>
		async ({ result }) => {
			if (result.type === 'failure' && hid) {
				const why = result.data?.workMessage;
				hid = { ...hid, refused: typeof why === 'string' ? why : 'NOT UNDONE' };
				return;
			}
			hid = null;
			await invalidateAll();
		};
	/** A page command as it's typed: offered as a result, opened by Enter or a tap (Reach, command). */
	const pageCmd = $derived.by(() => {
		const p = parseSearch(q);
		return p.type === 'page' ? p : null;
	});

	// ---- the fingerprint gate (Index Addendum, states fpPrompt/fpFail/fpCancel) -----
	// /reveal behind an enrolled device, /lock to enrol this one, /unlock to
	// take the gate away (doc/PRIVACY.md). The prompt is Android's own; what
	// sits behind it is this COMMAND row, and nothing hidden.
	type Gate = {
		command: string;
		purpose: 'reveal' | 'enrol' | 'remove';
		status: 'waiting' | 'failed' | 'done';
		text: string;
	};
	let gate = $state<Gate | null>(null);
	let form = $state<HTMLFormElement | null>(null);
	let plain = false;

	const PURPOSE = { reveal: 'reveal', lock: 'enrol', unlock: 'remove' } as const;

	// Typing something else puts the command row away.
	$effect(() => {
		if (gate && q.trim().toLowerCase() !== gate.command) gate = null;
	});

	function onsubmit(e: SubmitEvent) {
		if (plain) return;
		const input = parseSearch(q);
		if (input.type !== 'command' || !(input.command in PURPOSE)) return;
		e.preventDefault();
		// A TV has no fingerprint and no screen lock (owner, 2026-11-01): say
		// so rather than raise a prompt it cannot answer.
		if (input.command === 'reveal' && tvScreen.current) {
			gate = {
				command: '/reveal',
				purpose: 'reveal',
				status: 'done',
				text: 'NOT ON A TV · TURN REVEAL ON FROM THE COMPUTER'
			};
			return;
		}
		void ceremony(input.command as keyof typeof PURPOSE);
	}

	async function post(path: '/api/unlock/options' | '/api/unlock/verify', body: object) {
		return fetch(resolve(path), {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify(body)
		});
	}

	async function ceremony(command: keyof typeof PURPOSE) {
		const purpose = PURPOSE[command];
		const fail = (text = 'NOT UNLOCKED') =>
			(gate = { command: `/${command}`, purpose, status: 'failed', text });
		gate = {
			command: `/${command}`,
			purpose,
			status: 'waiting',
			text: 'COMMAND · WAITING FOR THE DEVICE'
		};
		const res = await post('/api/unlock/options', { purpose });
		if (!res.ok)
			return fail(
				purpose === 'enrol' ? 'REVEAL FIRST · ONLY AN UNLOCKED SESSION ADDS A DEVICE' : undefined
			);
		const o = await res.json();
		if (!o.gated && purpose === 'reveal') {
			// No device enrolled: /reveal is the plain command it always was.
			plain = true;
			form?.requestSubmit();
			return;
		}
		if (!o.gated && purpose === 'remove') {
			gate = {
				command: '/unlock',
				purpose,
				status: 'done',
				text: 'NO LOCK · /reveal ASKS NOTHING'
			};
			return;
		}
		if (!browserSupportsWebAuthn()) return fail('THIS BROWSER CANNOT ASK THE DEVICE · NEEDS HTTPS');
		try {
			const response =
				o.kind === 'register'
					? await startRegistration({ optionsJSON: o.options })
					: await startAuthentication({ optionsJSON: o.options });
			const v = await post('/api/unlock/verify', { purpose, response });
			if (!v.ok) return fail();
		} catch {
			// Cancelled or refused: the browser can't say which (both are
			// NotAllowedError), so both are the same honest answer.
			return fail(purpose === 'enrol' ? 'NOT ENROLLED' : undefined);
		}
		if (purpose === 'reveal') return goto(resolve('/'), { invalidateAll: true });
		gate = {
			command: `/${command}`,
			purpose,
			status: 'done',
			text:
				purpose === 'enrol'
					? 'LOCKED · /reveal NOW ASKS THIS DEVICE'
					: 'UNLOCKED · /reveal ASKS NOTHING'
		};
	}
</script>

<svelte:head><title>search · tsundoku</title></svelte:head>

<form method="POST" class="search" bind:this={form} {onsubmit}>
	<TopBar strong label="Search bar">
		{#snippet left()}
			<a class="cell" href={resolve('/')} aria-label="Back to library">←</a>
		{/snippet}
		{#snippet middle()}
			<SearchField bind:value={q} bind:input autofocus />
		{/snippet}
		{#snippet right()}
			<button
				type="button"
				class="cell clear"
				onclick={() => {
					q = '';
					input?.focus();
				}}>CLEAR</button
			>
		{/snippet}
	</TopBar>
</form>

{#if hidBand}
	<Band
		title={hid?.refused || hidBand.title}
		detail={hid?.refused ? hidBand.title : hidBand.detail}
	>
		{#snippet action()}
			<form method="POST" action={hidBand.action} use:enhance={undoHid}>
				<input type="hidden" name="facts" value={hidBand.facts} />
				<button type="submit">UNDO</button>
			</form>
		{/snippet}
	</Band>
{/if}

{#if pageCmd && !gate}
	<div class="label first">COMMAND</div>
	<!-- eslint-disable-next-line svelte/no-navigation-without-resolve -- a page's own path, from parseSearch -->
	<a class="page-cmd" href={pageCmd.href}><span>{pageCmd.label}</span><span>ENTER →</span></a>
	<div class="page-hint">/SETTINGS OPENS THE PAGE · /SETTINGS WATCHING OPENS IT AT A SECTION</div>
{:else if gate}
	<div class="label first">COMMAND</div>
	<div class="cmd" role="status">
		<span class="c">{gate.command}</span>
		<span class="s">{gate.text}</span>
		{#if gate.status === 'failed'}
			<button
				type="button"
				class="again"
				onclick={() => ceremony(gate!.command.slice(1) as 'reveal' | 'lock' | 'unlock')}
				>TRY AGAIN</button
			>
		{/if}
	</div>
	{#if gate.status === 'failed' && gate.purpose !== 'enrol'}
		<div class="fp-note">
			<span>FINGERPRINT NOT ACCEPTED · NOTHING SHOWN</span><span>SCREEN LOCK ALSO WORKS</span>
		</div>
	{/if}
{:else if data.result && query}
	{@const r = data.result}
	{#if r.tags.length > 0 || r.shelves.length > 0}
		<div class="label first">TAGS &amp; SHELVES</div>
		<div class="chips">
			{#each r.tags as t (t.key)}
				<TagChip
					namespace={t.namespace}
					value={t.value}
					count={count(t.count)}
					href={tagHref(t.key)}
				/>
			{/each}
			{#each r.shelves as s (s.key)}
				<TagChip
					namespace="shelf"
					value={s.name}
					count={count(s.count)}
					href={shelfHref(page.url, s.key)}
				/>
			{/each}
		</div>
	{/if}

	{#if r.titleTotal > 0 || !data.sources}
		<div class="label">
			<div>TITLES</div>
			<div>{count(r.titleTotal)}</div>
		</div>
	{/if}
	<div class="hits">
		<!-- A Work whose own name matched comes first, as the run (Work-States 5). -->
		{#each r.works as w (w.id)}
			<!-- eslint-disable-next-line svelte/no-navigation-without-resolve -- a Work's route is static -->
			<a class="hit work" href="/work/{w.id}">
				<Cover src={coverSrc(w.face.id, w.face.cover)} hue={w.face.hue} width={44} height={62} />
				<span class="text">
					<span class="title">{w.name}</span>
					<span class="why">WORK · {w.parts.length} SERIES</span>
				</span>
			</a>
		{/each}
		{#each r.titles as item (item.id)}
			{@const m = splitMatch(item.title, query)}
			<button type="button" class="hit" onclick={() => (sheetId = item.id)}>
				<Cover src={coverSrc(item.id, item.cover)} hue={item.hue} width={44} height={62} />
				<span class="text">
					<span class="title">{m.pre}<mark>{m.mid}</mark>{m.post}</span>
					<span class="why"
						>{kindLabel(item.kind)} · {item.why}{item.work
							? ` · PART ${item.work.part} · ${item.work.name.toUpperCase()}`
							: ''}</span
					>
				</span>
			</button>
		{/each}
	</div>
	{#if data.sources}
		<!-- No second field (Download States 1e): the same query, carried to the sources. -->
		<div class="label">
			<div>SOURCES</div>
			<div>NOT IN THE LIBRARY YET</div>
		</div>
		<a
			class="to-sources"
			href="{resolve('/downloads/search')}?q={encodeURIComponent(query)}"
			data-sveltekit-preload-data="off"
		>
			<span class="text">
				<span class="ts-t">SEARCH THE SOURCES</span>
				<span class="ts-m"
					>{data.sources} SOURCE{data.sources === 1 ? '' : 'S'} · RESULTS ARRIVE ONE BY ONE</span
				>
			</span>
			<span class="ts-go" aria-hidden="true">→</span>
		</a>
	{/if}
{:else if !query && data.browse && data.browse.total > 0}
	<!-- BROWSE first in the empty search (Index-Browse, phoneEntry). -->
	<div class="label first">
		<div>BROWSE A SOURCE</div>
		<div>RECENT</div>
	</div>
	{#if data.browse.recent.length}
		<div class="b-rows">
			{#each data.browse.recent as r (r.id)}
				<SourceRow
					{r}
					meta={[
						r.kind.toUpperCase(),
						r.lang.toUpperCase(),
						r.browsedAt && `BROWSED ${ago(r.browsedAt, data.now)}`
					]
						.filter(Boolean)
						.join(' · ')}
				/>
			{/each}
		</div>
	{/if}
	<a class="to-sources all" href={resolve('/browse')}>
		<span class="text"><span class="ts-t">ALL SOURCES · BROWSE</span></span>
		<span class="ts-go">{data.browse.total} →</span>
	</a>
	<p class="b-note">
		Type to search the library. SEARCH THE SOURCES follows the titles, as before.
	</p>
{/if}

<SeriesSheet
	id={sheetId}
	shelves={data.shelves}
	onclose={() => (sheetId = null)}
	onchange={() => invalidateAll()}
	onhid={(answer) => (hid = { q: data.q, answer, refused: '' })}
/>

<style>
	.page-cmd {
		display: flex;
		align-items: center;
		justify-content: space-between;
		min-height: 64px;
		padding: 0 var(--pad);
		border-top: var(--hairline);
		border-bottom: var(--hairline);
		background: var(--surface-inverse);
		color: var(--text-inverse);
		text-decoration: none;
		font: 500 15px var(--font-mono);
	}
	.page-hint {
		padding: 14px var(--pad);
		font: 400 13px/1.45 var(--font-mono);
		color: var(--text-2);
	}
	.cmd {
		display: flex;
		align-items: stretch;
		min-height: 64px;
		border-top: var(--hairline);
		border-bottom: var(--hairline);
	}
	.c {
		display: flex;
		align-items: center;
		padding: 0 var(--pad);
		font: 500 16px var(--font-mono);
	}
	.s {
		flex: 1;
		display: flex;
		align-items: center;
		padding: 0 18px;
		font: 400 13px var(--font-mono);
		color: var(--text-2);
	}
	.again {
		display: flex;
		align-items: center;
		padding: 0 var(--pad);
		border: 0;
		border-left: var(--hairline);
		border-radius: 0;
		background: transparent;
		color: var(--text-1);
		font: 500 14px var(--font-mono);
		cursor: pointer;
	}
	.again:active {
		background: var(--surface-inverse);
		color: var(--text-inverse);
	}
	.fp-note {
		display: flex;
		justify-content: space-between;
		gap: 12px;
		padding: 14px var(--pad);
		border-bottom: var(--hairline);
		font: 400 13px var(--font-mono);
		color: var(--text-2);
	}
	.search {
		display: contents;
	}
	.cell {
		display: flex;
		align-items: center;
		padding: 0 var(--pad);
		color: var(--text-1);
		font: 500 16px var(--font-mono);
	}
	.clear {
		border: 0;
		border-radius: 0;
		background: transparent;
		color: var(--text-2);
		font: var(--type-control);
		cursor: pointer;
	}
	.cell:active {
		background: var(--surface-inverse);
		color: var(--text-inverse);
	}
	.label {
		display: flex;
		justify-content: space-between;
		padding: 20px var(--pad) 10px;
		font: var(--type-label);
		color: var(--text-2);
		letter-spacing: var(--tracking-label);
	}
	.to-sources {
		display: flex;
		align-items: stretch;
		min-height: 64px;
		border-top: var(--hairline);
		border-bottom: var(--hairline);
		color: var(--text-1);
		text-decoration: none;
	}
	.to-sources .text {
		flex: 1;
		min-width: 0;
		display: flex;
		flex-direction: column;
		justify-content: center;
		gap: 5px;
		padding: 10px var(--pad);
	}
	.ts-t {
		font: 500 14px var(--font-mono);
		letter-spacing: 0.04em;
	}
	.ts-m {
		font: 400 13px/1.3 var(--font-mono);
		color: var(--text-2);
	}
	.ts-go {
		display: flex;
		align-items: center;
		padding: 0 var(--pad);
		border-left: var(--hairline);
		font: 500 16px var(--font-mono);
	}
	.label.first {
		padding-top: 18px;
	}
	.b-rows {
		display: flex;
		flex-direction: column;
		border-top: var(--hairline);
	}
	.to-sources.all {
		min-height: 56px;
		border-top: 0;
	}
	.all .ts-go {
		font: 500 14px var(--font-mono);
		letter-spacing: 0.04em;
	}
	.b-note {
		margin: 0;
		padding: 20px var(--pad);
		font: 400 15px/1.5 var(--font-sans);
		color: var(--text-prose);
	}
	.chips {
		display: flex;
		flex-wrap: wrap;
		gap: 8px;
		padding: 0 var(--pad) 8px;
	}
	.hits {
		display: flex;
		flex-direction: column;
		border-top: var(--hairline);
	}
	.hit {
		display: flex;
		align-items: center;
		gap: 16px;
		padding: 10px var(--pad);
		border: 0;
		border-bottom: var(--hairline);
		border-radius: 0;
		background: transparent;
		color: var(--text-1);
		text-align: left;
		cursor: pointer;
	}
	.hit:active {
		background: var(--surface-inverse);
		color: var(--text-inverse);
	}
	a.hit {
		text-decoration: none;
	}
	.text {
		flex: 1;
		min-width: 0;
		display: flex;
		flex-direction: column;
		gap: 5px;
	}
	.title {
		font: 500 16px var(--font-sans);
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}
	mark {
		background: var(--accent-highlight);
		color: inherit;
	}
	.why {
		font: var(--type-meta);
		color: var(--text-2);
	}
	/* ---- the TV (c238; TV-Search) ----------------------------------------- */
	@media (pointer: none) and (min-width: 900px) {
		/* Search sits in the top half, above Android's keyboard (TV Calls,
		   "SEARCH IN THE TOP HALF"). The field is the top bar; below it the
		   first results are three cards across, 114px tall. */
		.label {
			padding: 9px var(--pad);
			font: var(--type-label);
		}
		.label.first {
			padding-top: 9px;
			min-height: 36px;
		}
		.hits {
			display: grid;
			grid-template-columns: repeat(3, minmax(0, 1fr));
			gap: 1px;
			margin: 0 var(--pad);
			background: var(--line-1);
			border: var(--hairline);
		}
		.hit {
			min-height: 114px;
			gap: 14px;
			padding: 8px 14px 8px 8px;
			border: 0;
			background: var(--surface-page);
		}
		.hit :global(.cover) {
			width: 66px !important;
			height: 96px !important;
		}
		.title {
			font-size: 17px;
			white-space: normal;
			display: -webkit-box;
			-webkit-line-clamp: 2;
			line-clamp: 2;
			-webkit-box-orient: vertical;
			overflow: hidden;
		}
		.to-sources {
			margin: 0 var(--pad);
			border: var(--hairline);
		}
		.chips {
			padding: 0 var(--pad) 12px;
		}
		.cell {
			font: var(--type-control);
		}
	}
</style>

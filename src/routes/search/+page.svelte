<script lang="ts">
	import SourceRow from '../browse/SourceRow.svelte';
	import { ago } from '$lib/library/tracking';
	import {
		afterNavigate,
		beforeNavigate,
		goto,
		invalidateAll,
		replaceState
	} from '$app/navigation';
	import { browser } from '$app/environment';
	import { onMount, tick, untrack } from 'svelte';
	import { MediaQuery, SvelteMap, SvelteSet } from 'svelte/reactivity';
	import { TV } from '$lib/device.svelte';
	import TopBar from '$lib/components/chrome/TopBar.svelte';
	import Cover from '$lib/components/content/Cover.svelte';
	import SearchField from '$lib/components/controls/SearchField.svelte';
	import TagChip from '$lib/components/controls/TagChip.svelte';
	import SeriesSheet from '../SeriesSheet.svelte';
	import SelectionSheet from './SelectionSheet.svelte';
	import SelectionBar from './SelectionBar.svelte';
	import type { RefreshBatch } from '$lib/library/types';
	import {
		carrySelection,
		drawnToNote,
		landing,
		pickedOfCard,
		pickedOfPart,
		refreshFacts,
		takeCarried,
		UnseenFacts,
		workTap,
		workTicks,
		type Picked
	} from '$lib/library/selection';
	import { m } from '$lib/paraglide/messages';
	import Band from '$lib/components/chrome/Band.svelte';
	import { enhance } from '$app/forms';
	import type { SubmitFunction } from '@sveltejs/kit';
	import { wholeBand, type HideFacts, type ShowFacts, type WholeAnswer } from '$lib/library/works';
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
			const target = withKind(searchHref(parsed.type === 'query' ? parsed.text : ''));
			// eslint-disable-next-line svelte/no-navigation-without-resolve -- searchHref() resolves
			void goto(target, { replaceState: true, keepFocus: true, noScroll: true });
		}, 180);
		return () => clearTimeout(timer);
	});

	const query = $derived(parseSearch(data.q).type === 'query' ? data.q.trim() : '');

	// ---- SELECT on the search (c698; doc/LIBRARY.md, "What ends SELECT") ----
	/*
	 * The library's selection, carried here by the selecting bar's `/` (or its
	 * key), or one started here by SELECT. A hit ticks instead of opening its
	 * sheet; ←, a chip or a shelf carries the selection back to the library;
	 * only ✕ ends it here, and leaving for any other screen, or a reload, drops
	 * it (`carrySelection` is this tab's memory alone).
	 */
	const carried = browser ? takeCarried(landing(page.url)) : null;
	let selecting = $state(carried !== null);
	const selected = new SvelteSet<number>(carried?.ids ?? []);
	const facts = new SvelteMap<number, Picked>(
		(carried?.facts ?? []).filter((p) => selected.has(p.id)).map((p) => [p.id, p])
	);
	let reviewing = $state(false);
	let shownIds = $state<number[]>([]);
	/** SELECT ALL's ids carried here unseen, read by id when SHOW opens (c737). */
	const unseen = new UnseenFacts();
	/**
	 * Whether the entry behind this one in the tab's history is the library:
	 * this page was reached from it by a tap, a `goto`, or the browser's
	 * forward. Then ← while selecting is history's own back, so the library
	 * comes back at its shelf, its loaded pages and its place (its snapshot).
	 * Reached any other way (a link from elsewhere, a fresh load, the
	 * browser's back), ← is a plain way to the library.
	 */
	let behindIsLibrary = false;
	afterNavigate((nav) => {
		if (nav.from?.route.id !== '/') return;
		if (nav.type === 'link' || nav.type === 'goto') behindIsLibrary = true;
		else if (nav.type === 'popstate' && nav.delta === 1) behindIsLibrary = true;
	});
	beforeNavigate((nav) => {
		if (!selecting || nav.to?.route.id !== '/') return;
		carrySelection({ ids: [...selected], facts: [...facts.values()], to: landing(nav.to.url) });
	});

	function toggle(id: number) {
		if (selected.has(id)) selected.delete(id);
		else selected.add(id);
	}
	function tapWork(parts: readonly number[]) {
		const { add, remove } = workTap(parts, selected);
		for (const id of remove) selected.delete(id);
		for (const id of add) selected.add(id);
	}
	function stopSelecting() {
		selecting = false;
		// A Work just made or ended: the next selection's sheets read them afresh.
		listsRead = null;
		reviewing = false;
		selected.clear();
		facts.clear();
		unseen.reset();
		barRefused = '';
		batch = null;
		bar?.dropTaps();
	}
	function openShow() {
		bar?.dropTaps();
		shownIds = [...selected];
		reviewing = true;
		void unseen.fill(selected, facts, () => new Set(shownIds));
	}
	/** ← while selecting goes back to the very library it came from, when that is behind. */
	function back(e: MouseEvent) {
		if (!selecting || !behindIsLibrary) return;
		e.preventDefault();
		history.back();
	}

	/** Every hit as the facts a selection keeps: a Work's parts, then the titles. */
	const drawnPicked = $derived.by((): Picked[] => {
		const r = data.result;
		if (!r) return [];
		const out: Picked[] = [];
		for (const w of r.works)
			for (const p of w.parts)
				out.push(
					pickedOfPart(
						p,
						w.name,
						{ id: w.id, name: w.name },
						data.groupFacts[String(p.seriesId)] ?? null
					)
				);
		for (const t of r.titles)
			out.push(
				pickedOfCard(
					t,
					t.work ? { id: t.work.id, name: t.work.name } : null,
					data.groupFacts[String(t.id)] ?? null
				)
			);
		return out;
	});
	// As on the library: note what is drawn of the selection and forget what
	// left it, and build nothing while nothing is ticked (c740).
	$effect(() => {
		const ids = new Set(selected);
		const drawn = drawnToNote(selecting, ids, () => drawnPicked);
		const held = new Set(reviewing ? shownIds : []);
		untrack(() => {
			const { set, drop } = refreshFacts(ids, facts, drawn, held);
			for (const p of set) facts.set(p.id, p);
			for (const id of drop) facts.delete(id);
		});
	});
	/** SELECT on the bar: only once a search has hits (Bars-Phone, B). */
	const hasHits = $derived(
		!!data.result && !!query && data.result.titles.length + data.result.works.length > 0
	);
	/** A Work's row line, selecting: "1 OF 2 TICKED", or BOTH/ALL TICKED. */
	function tickedLine(t: ReturnType<typeof workTicks>): string {
		if (t.state === 'all')
			return t.total === 2 ? m.search_work_both_ticked() : m.search_work_all_ticked();
		if (t.state === 'some') return m.search_work_some_ticked({ ticked: t.ticked, total: t.total });
		return '';
	}

	/**
	 * The kind the library was filtered to when its search cell was tapped
	 * (c699): kept on this page's address as the typing replaces it, and
	 * handed on to SEARCH THE SOURCES, which asks only that kind's sources.
	 */
	const kind = $derived(page.url.searchParams.get('kind'));
	function withKind(href: string): string {
		if (!kind) return href;
		return `${href}${href.includes('?') ? '&' : '?'}kind=${encodeURIComponent(kind)}`;
	}

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
	// ---- the bar's actions, on a page they do not belong to (c838; doc/LIBRARY.md) ----
	let bar = $state<SelectionBar | null>(null);
	/** A refusal, shown where it was pressed; the selection stays (Rules, "Keeps it"). */
	let barRefused = $state('');
	// A derived, or every re-read's new `data` would count as the query changing.
	const searched = $derived(data.q);
	/** It answers what was pressed: a new tick or a new query is the owner moving on (c469). */
	$effect(() => {
		void searched;
		void [...selected];
		barRefused = '';
	});
	let batch = $state.raw<RefreshBatch | null>(null);
	const sheetLists = $state<{
		existing: { id: number; title: string; books: number }[];
		existingVolumes: { id: number; title: string; books: number }[];
		existingWorks: { id: number; name: string; series: number; createdAt: number }[];
	}>({ existing: [], existingVolumes: [], existingWorks: [] });
	/** The read in flight, or done: a sheet waits on it, and a failed read is asked again. */
	let listsRead: Promise<void> | null = null;
	function readLists(): Promise<void> {
		listsRead ??= fetch(resolve('/search/selection'))
			.then((r) => (r.ok ? r.json() : null))
			.then((lists) => {
				if (lists) Object.assign(sheetLists, lists);
				else listsRead = null;
			})
			.catch(() => {
				listsRead = null;
			});
		return listsRead;
	}
	$effect(() => {
		if (selecting) void readLists();
	});
	/**
	 * The bar's forms post the library's actions, whose answer SvelteKit
	 * applies only on the library (`GroupSheet`'s `ondone`, c700), so it is
	 * read here. A refusal keeps SELECT and says why; a HIDE or UNHIDE ends it
	 * (Rules, "As today"); FAV and a rating leave it on, as on the library.
	 */
	const bulkAnswer: SubmitFunction = ({ submitter }) => {
		const doing = submitter instanceof HTMLButtonElement ? submitter.value : '';
		barRefused = '';
		batch = null;
		return async ({ action, result, update }) => {
			if (result.type === 'failure') {
				const why = result.data?.foldMessage ?? result.data?.workMessage ?? result.data?.message;
				barRefused = typeof why === 'string' ? why.toUpperCase() : 'NOT DONE';
				return;
			}
			await update({ reset: false });
			if (result.type !== 'success') return;
			const answer = (result.data ?? {}) as Record<string, unknown>;
			if ('refreshed' in answer) {
				batch = answer.refreshed as RefreshBatch;
				return;
			}
			if (answer.showFacts)
				hid = { q: data.q, answer: { showFacts: answer.showFacts as ShowFacts }, refused: '' };
			// A plain HIDE that took a Work with it: the ticks said no Work, and the
			// workstation (`wholeAnswer`) knows better, so the band and UNDO come too.
			if (answer.hideFacts)
				hid = { q: data.q, answer: { hideFacts: answer.hideFacts as HideFacts }, refused: '' };
			if (doing === 'hide' || doing === 'unhide' || action.search.includes('showAll'))
				stopSelecting();
		};
	};
	/** Which hits are hidden: what a selection noted is only what it noted when ticked. */
	const hiddenOf = (id: number) => facts.get(id)?.hidden;

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

	/**
	 * `/lock`, `/unlock` and a gated `/reveal` typed into another top search
	 * bar (c697, c711) arrive here with this screen's `go` intent, which travels
	 * in history state so a typed or shared `?go=1` link cannot carry it. A `go`
	 * in the URL is only taken off it, and nothing is submitted (round 2, c710),
	 * so no link raises the device prompt with no keystroke, and
	 * `/search?q=%2Freveal&go=1` cannot start the ceremony. Only those three
	 * commands ask this screen's device prompt.
	 *
	 * The entry's state is emptied before the submit, not after: a `history.back()`
	 * to it, or the reload (SvelteKit does not restore state on one), finds no
	 * `go`, whatever the ceremony then does. No other entry can hold one: only a
	 * goto that mounts this screen reaches this `onMount`, and `runSearchCommand`
	 * is single-flight, so a double press cannot push a second entry onto a
	 * mounted `/search`. Run once, per press.
	 *
	 * One tick late: on a full page load `onMount` runs inside the router's own
	 * root creation, before SvelteKit holds the root its `replaceState` writes
	 * to, which throws (`Cannot read properties of undefined (reading '$set')`).
	 * A bar's client-side `goto` is already past that, but a shared link is not.
	 */
	onMount(() => {
		let cancelled = false;
		void tick().then(() => {
			if (cancelled) return;
			const u = new URL(page.url);
			const carried = (page.state as Record<string, unknown>).go === true;
			const asked = u.searchParams.get('go') === '1';
			if (!carried && !asked) return;
			u.searchParams.delete('go');
			// eslint-disable-next-line svelte/no-navigation-without-resolve -- this page's own address, with one parameter taken off
			replaceState(u, {});
			if (!carried) return;
			const parsed = parseSearch(u.searchParams.get('q') ?? '');
			if (parsed.type !== 'command' || !(parsed.command in PURPOSE)) return;
			form?.requestSubmit();
		});
		return () => {
			cancelled = true;
		};
	});

	function onsubmit(e: SubmitEvent) {
		if (plain) return;
		const input = parseSearch(q);
		// Enter on a query while selecting: the results already follow the
		// typing, and the form's post is a page load, which would end SELECT as
		// a reload does. The pending replace is made at once instead.
		if (selecting && (input.type === 'query' || input.type === 'empty')) {
			e.preventDefault();
			clearTimeout(timer);
			const target = withKind(searchHref(input.type === 'query' ? input.text : ''));
			// eslint-disable-next-line svelte/no-navigation-without-resolve -- searchHref() resolves
			void goto(target, { replaceState: true, keepFocus: true, noScroll: true });
			return;
		}
		if (input.type !== 'command' || !(input.command in PURPOSE)) return;
		e.preventDefault();
		// A second ceremony cancels the first's prompt, and that refusal then
		// lands as NOT UNLOCKED on a device that accepted.
		if (gate?.status === 'waiting') return;
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
		const unanswered = purpose === 'enrol' ? 'NOT ENROLLED' : undefined;
		// Never left on `waiting`: `onsubmit` drops every press until it changes.
		const res = await post('/api/unlock/options', { purpose }).catch(() => null);
		if (!res) return fail(unanswered);
		if (!res.ok)
			return fail(
				purpose === 'enrol' ? 'REVEAL FIRST · ONLY AN UNLOCKED SESSION ADDS A DEVICE' : undefined
			);
		const o = await res.json().catch(() => null);
		if (!o) return fail(unanswered);
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
			return fail(unanswered);
		}
		if (purpose === 'reveal') {
			// The plain /reveal is a form post, a page load, which ends SELECT as a
			// reload does; through the lock it is a `goto`, so it ends it here,
			// for the same command to do the same thing either way.
			stopSelecting();
			return goto(resolve('/'), { invalidateAll: true });
		}
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
			<a class="cell" href={resolve('/')} aria-label="Back to library" onclick={back}>←</a>
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
			{#if selecting}
				<!-- Tablet and desktop: the selection beside the field (Bars-Tablet). -->
				<div class="sel in-bar">{@render selection()}</div>
			{:else if hasHits}
				<!-- After CLEAR, as on the library's bar; only once a search has hits. -->
				<button type="button" class="cell select-cell" onclick={() => (selecting = true)}
					>{m.search_select()}</button
				>
			{/if}
		{/snippet}
	</TopBar>
</form>

{#snippet selection()}
	<button type="button" class="sel-x" aria-label="Stop selecting" onclick={stopSelecting}>✕</button>
	<div class="selected-count" aria-live="polite">{selected.size} SELECTED</div>
	<button type="button" class="sel-show" disabled={selected.size === 0} onclick={openShow}
		>SHOW</button
	>
{/snippet}

{#if selecting}
	<!-- A phone: a 48px strip under the field (Bars-Phone, "BOTH LAND HERE"). -->
	<div class="sel strip">{@render selection()}</div>
{/if}

{#if hidBand}
	<Band
		title={hid?.refused || hidBand.title}
		detail={hid?.refused ? hidBand.title : hidBand.detail}
		ondismiss={() => (hid = null)}
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
	{#if (r.tags.length > 0 || r.shelves.length > 0) && selecting}
		<!-- Selecting, a chip is a way to tick many (Rows, 03): the library at that
		     tag or shelf, still selecting. -->
		<div class="label first">
			<div>TAGS &amp; SHELVES</div>
			<div>
				<span class="long">{m.search_chips_selecting()}</span><span class="short"
					>{m.search_chips_selecting_short()}</span
				>
			</div>
		</div>
		<div class="chips">
			<!-- eslint-disable svelte/no-navigation-without-resolve -- tagHref() and shelfHref() resolve -->
			{#each r.tags as t (t.key)}
				<a class="chip" href={tagHref(t.key)}
					><span class="dim">{t.namespace}</span><span>{t.value}</span><span class="dim"
						>{count(t.count)}</span
					><span class="go" aria-hidden="true">→</span></a
				>
			{/each}
			{#each r.shelves as sh (sh.key)}
				<a class="chip" href={shelfHref(page.url, sh.key)}
					><span class="dim">shelf</span><span>{sh.name}</span><span class="dim"
						>{count(sh.count)}</span
					><span class="go" aria-hidden="true">→</span></a
				>
			{/each}
			<!-- eslint-enable svelte/no-navigation-without-resolve -->
		</div>
	{:else if r.tags.length > 0 || r.shelves.length > 0}
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

	{#if r.titleTotal > 0 || !data.sources || selecting}
		<div class="label">
			<div>TITLES</div>
			<div>{count(r.titleTotal)}{selecting ? ` · ${m.search_tap_ticks()}` : ''}</div>
		</div>
	{/if}
	<div class="hits">
		<!-- A Work whose own name matched comes first, as the run (Work-States 5). -->
		{#each r.works as w (w.id)}
			{#if selecting}
				{@const ids = w.parts.map((p) => p.seriesId)}
				{@const t = workTicks(ids, selected)}
				<!-- A Work's row ticks every part, as a Work tile does (Rows, 02). -->
				<button
					type="button"
					class="hit work tk"
					class:on={t.state === 'all'}
					role="checkbox"
					aria-checked={t.state === 'all' ? 'true' : t.state === 'some' ? 'mixed' : 'false'}
					onclick={() => tapWork(ids)}
				>
					<span class="tick" aria-hidden="true"
						><span class="box" class:on={t.state === 'all'}>{t.state === 'all' ? '✓' : ''}</span
						></span
					>
					<Cover src={coverSrc(w.face.id, w.face.cover)} hue={w.face.hue} width={44} height={62} />
					<span class="text">
						<span class="title">{w.name}</span>
						<span class="why"
							>{`WORK · ${w.parts.length} SERIES${t.state === 'none' ? '' : ' · '}`}<span
								class="ink">{tickedLine(t)}</span
							></span
						>
					</span>
				</button>
			{:else}
				<!-- eslint-disable-next-line svelte/no-navigation-without-resolve -- a Work's route is static -->
				<a class="hit work" href="/work/{w.id}">
					<Cover src={coverSrc(w.face.id, w.face.cover)} hue={w.face.hue} width={44} height={62} />
					<span class="text">
						<span class="title">{w.name}</span>
						<span class="why">WORK · {w.parts.length} SERIES</span>
					</span>
				</a>
			{/if}
		{/each}
		{#each r.titles as item (item.id)}
			{@const hm = splitMatch(item.title, query)}
			{@const on = selecting && selected.has(item.id)}
			<!-- Selecting, a tap anywhere on the row ticks it; nothing opens the sheet (Rows, 01). -->
			<button
				type="button"
				class="hit"
				class:tk={selecting}
				class:on
				role={selecting ? 'checkbox' : undefined}
				aria-checked={selecting ? on : undefined}
				onclick={() => (selecting ? toggle(item.id) : (sheetId = item.id))}
			>
				{#if selecting}
					<span class="tick" aria-hidden="true"
						><span class="box" class:on>{on ? '✓' : ''}</span></span
					>
				{/if}
				<Cover src={coverSrc(item.id, item.cover)} hue={item.hue} width={44} height={62} />
				<span class="text">
					<span class="title">{hm.pre}<mark>{hm.mid}</mark>{hm.post}</span>
					<span class="why"
						>{kindLabel(item.kind)} · {item.why}{item.work
							? ` · PART ${item.work.part} · ${item.work.name.toUpperCase()}`
							: ''}</span
					>
				</span>
			</button>
		{/each}
	</div>
	{#if data.sources && !selecting}
		<!-- Not while selecting: nothing outside the library can be ticked. -->
		<!-- No second field (Download States 1e): the same query, carried to the sources. -->
		<div class="label">
			<div>SOURCES</div>
			<div>NOT IN THE LIBRARY YET</div>
		</div>
		<a
			class="to-sources"
			href="{resolve('/downloads/search')}?q={encodeURIComponent(query)}{data.sourcesKind
				? `&kind=${data.sourcesKind}`
				: ''}"
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
{:else if !query && data.browse && data.browse.total > 0 && !selecting}
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

<SelectionSheet
	open={reviewing}
	ids={shownIds}
	{facts}
	{selected}
	{unseen}
	ontoggle={toggle}
	onclose={() => (reviewing = false)}
/>

{#if selecting}
	<!-- Room for the pinned bulk bar, as the library keeps under its grid. -->
	<div class="bar-room" aria-hidden="true"></div>
{/if}

<SelectionBar
	bind:this={bar}
	{selecting}
	{selected}
	{facts}
	existing={sheetLists.existing}
	existingVolumes={sheetLists.existingVolumes}
	existingWorks={sheetLists.existingWorks}
	shelves={data.shelves}
	{hiddenOf}
	fill={async () => {
		await readLists();
		await unseen.fill(selected, facts, () => new Set(shownIds));
	}}
	foldMessage={barRefused}
	{batch}
	{bulkAnswer}
	ondismissBatch={() => (batch = null)}
	ongrouped={async () => {
		stopSelecting();
		await invalidateAll();
	}}
	ongroupstale={(why) => {
		barRefused = why;
		listsRead = null;
		void readLists();
	}}
	onhide={async () => {
		stopSelecting();
		await invalidateAll();
	}}
	onhideanswer={(d) => {
		if (d.hideFacts)
			hid = { q: data.q, answer: { hideFacts: d.hideFacts as HideFacts }, refused: '' };
	}}
	ondeleted={async () => {
		stopSelecting();
		await invalidateAll();
	}}
/>

<SeriesSheet
	id={sheetId}
	shelves={data.shelves}
	onclose={() => (sheetId = null)}
	onchange={() => invalidateAll()}
	onhid={(answer) => (hid = { q: data.q, answer, refused: '' })}
/>

<style>
	.bar-room {
		height: 122px;
	}
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
		gap: 12px;
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
	/* ---- SELECT on the search (c698; sel.css in doc/handoffs/select-search/) --
	   The handoff's literals, transcribed: its spacing is hand-set, not a scale. */
	.select-cell {
		border: 0;
		border-left: var(--hairline);
		border-radius: 0;
		background: transparent;
		font: var(--type-control);
		cursor: pointer;
	}
	.sel {
		display: flex;
		align-items: stretch;
		background: var(--surface-inverse);
		color: var(--text-inverse);
	}
	.sel > * {
		display: flex;
		align-items: center;
		padding: 0 var(--pad);
		border: 0;
		border-radius: 0;
		background: transparent;
		color: inherit;
		font: var(--type-control);
		white-space: nowrap;
	}
	.sel > * + * {
		border-left: 1px solid var(--text-2);
	}
	.sel-x {
		font: 500 16px var(--font-mono);
		cursor: pointer;
	}
	.sel .selected-count {
		padding: 0 18px;
		font: 500 17px var(--font-mono);
	}
	.sel-show {
		cursor: pointer;
	}
	.sel-show:disabled {
		opacity: 0.4;
		cursor: default;
	}
	.sel-x:active,
	.sel-show:active:not(:disabled) {
		background: var(--surface-page);
		color: var(--text-1);
	}
	/* Tablet and desktop: beside the field, right of CLEAR. */
	.sel.in-bar {
		border-left: var(--hairline);
	}
	.sel.strip {
		display: none;
	}
	.label .short {
		display: none;
	}
	/* A phone: the block is a 48px strip under the field, the count taking the room. */
	@media (max-width: 599px) {
		.sel.in-bar {
			display: none;
		}
		.sel.strip {
			display: flex;
			height: 48px;
		}
		.sel.strip .selected-count {
			flex: 1;
		}
		.label .long {
			display: none;
		}
		.label .short {
			display: inline;
		}
	}
	.chip {
		display: inline-flex;
		align-items: center;
		gap: 10px;
		height: 44px;
		padding: 0 14px;
		border: 1px solid var(--line-2);
		border-radius: 0;
		color: var(--text-1);
		font: var(--type-control);
		text-decoration: none;
		white-space: nowrap;
	}
	.chip:active {
		border-color: var(--surface-inverse);
		background: var(--surface-inverse);
		color: var(--text-inverse);
	}
	.chip .dim {
		opacity: 0.6;
	}
	.chip .go {
		align-self: stretch;
		display: flex;
		align-items: center;
		margin-left: 2px;
		padding-left: 12px;
		border-left: var(--hairline);
	}
	.hit.tk {
		gap: 0;
		padding-left: 0;
		min-height: 82px;
	}
	.hit.tk :global(.cover) {
		margin-right: 16px;
	}
	.hit.tk .text {
		padding-right: var(--pad);
	}
	/* sel.css's `.title` (500 16px/1.3): the line the plain row's font leaves normal. */
	.hit.tk .title {
		line-height: 1.3;
	}
	.hit.on {
		background: var(--accent-select);
	}
	.tick {
		width: 64px;
		align-self: stretch;
		flex-shrink: 0;
		display: flex;
		align-items: center;
		justify-content: center;
	}
	.box {
		width: 24px;
		height: 24px;
		border: 1.5px solid var(--line-2);
		display: flex;
		align-items: center;
		justify-content: center;
		font: 500 14px var(--font-mono);
		color: var(--on-accent);
	}
	.box.on {
		border-color: var(--accent);
		background: var(--accent);
	}
	.hit:active .box:not(.on) {
		border-color: var(--text-inverse);
	}
	.why .ink {
		color: var(--text-1);
	}
	.hit:active .why .ink {
		color: inherit;
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
		/* A TV has no SELECT (Rules, "AS TODAY"; TV Calls, "03 — SIDEBAR"). */
		.select-cell {
			display: none;
		}
	}
</style>

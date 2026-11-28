<script lang="ts">
	import { engineDownLine } from '$lib/waiting';
	import StartTrail from '$lib/components/start/StartTrail.svelte';
	import { resolve } from '$app/paths';
	import { page } from '$app/state';
	import TopBar from '$lib/components/chrome/TopBar.svelte';
	import Cover from '$lib/components/content/Cover.svelte';
	import type { SearchHit } from '$lib/server/download-types';
	import SearchField from '$lib/components/controls/SearchField.svelte';
	import { seriesHref } from '$lib/library/links';
	import { count } from '$lib/library/downloads';
	import { SvelteMap } from 'svelte/reactivity';
	import { untrack } from 'svelte';
	import { isSettled, type Settled } from '$lib/library/settled';
	import { SiteCheck } from '$lib/site-check.svelte';
	import { answerCounts, arrangeAnswers, sourceTitle } from '$lib/library/source-answers';
	import { isSearchCommand, runSearchCommand } from '$lib/library/commands';
	import { KIND_TAB } from './source-kinds';
	import type { Kind } from '$lib/library/kinds';
	import { enhance } from '$app/forms';

	/**
	 * Searching the sources. Results fill in source by source under their
	 * names; a source still asking shows two dashed rows, Index's "not here
	 * yet"; one that didn't answer says so with TRY AGAIN. A result already in
	 * the library says IN LIBRARY and opens it; the same title from another
	 * source says so, to head off a twin. Tabs narrow to one source. Without
	 * script the server waits for every source and sends their answers as
	 * values: streamed data needs script, and without it the page drew its
	 * waiting rows for good.
	 */
	let { data } = $props();

	// svelte-ignore state_referenced_locally
	let q = $state(data.q);
	const base = resolve('/downloads/search');
	/**
	 * A search's own address: the query, then the kind and the source
	 * when there is one. A source tab keeps the kind it was picked under, so
	 * ALL beside it is that kind's ALL.
	 */
	const href = (
		source?: string,
		kind: Kind | null = data.kind,
		all: boolean = data.asks?.askRest ?? false
	) =>
		`${base}?q=${encodeURIComponent(data.q)}${kind ? `&kind=${kind}` : ''}${source ? `&source=${source}` : ''}${all ? '&all=1' : ''}`;
	/** Both sections' sources: 01's, then 02's once ASK THEM was pressed. */
	const everyGroup = $derived([...data.groups, ...data.restGroups]);

	/**
	 * What each source answered, keyed by source, in the order the answers
	 * arrived: the matches are drawn in that order, so a late one joins below
	 * (the order MOVE's candidates share: `source-answers.ts`).
	 */
	const answers = new SvelteMap<string, Settled<SearchHit[]>>();
	// Without script the answers arrive as values: set at once, on the server too.
	for (const g of untrack(() => [...data.groups, ...data.restGroups]))
		if (isSettled(g.hits)) answers.set(g.id, g.hits);
	/** Bumped by every fresh load, so an answer for an earlier search is dropped. */
	let generation = 0;
	$effect(() => {
		const gen = ++generation;
		answers.clear();
		for (const g of everyGroup) {
			const h = g.hits;
			if (isSettled(h)) answers.set(g.id, h);
			else void h.then((s) => gen === generation && answers.set(g.id, s));
		}
	});
	/** TRY AGAIN and TRY ALL AGAIN: only the named sources are asked again (`./ask`). */
	function askAgain(ids: string[]) {
		const gen = generation;
		for (const id of ids) {
			answers.delete(id);
			// Under a kind, only that kind's sources answer again (`./ask`).
			const u = new URLSearchParams({
				q: data.q,
				source: id,
				...(data.kind && !data.only ? { kind: data.kind } : {})
			});
			void fetch(`${base}/ask?${u}`, { cache: 'no-store' })
				.then(async (r): Promise<Settled<SearchHit[]>> =>
					r.ok
						? ((await r.json()) as Settled<SearchHit[]>)
						: { ok: false, error: `the workstation answered ${r.status}` }
				)
				.catch((): Settled<SearchHit[]> => ({ ok: false, error: 'the workstation did not answer' }))
				.then((s) => gen === generation && answers.set(id, s));
		}
	}
	const again = (ids: string[]) => (e: MouseEvent) => {
		e.preventDefault();
		askAgain(ids);
	};
	// A source still asking: is its site's check being passed? The engine
	// says for an extension, the app itself for a novel; asked only with
	// the engine set up, which BROWSE needs anyway.
	const checks = new SvelteMap<string, SiteCheck>();
	$effect(() => {
		if (!data.engine) return;
		for (const g of everyGroup) {
			if (answers.has(g.id)) {
				checks.get(g.id)?.stop();
				checks.delete(g.id);
			} else if (!checks.has(g.id)) {
				const c = new SiteCheck();
				c.start(g.id);
				checks.set(g.id, c);
			}
		}
	});
	$effect(() => () => {
		for (const c of checks.values()) c.stop();
	});

	const counts = $derived(answerCounts(answers));
	/**
	 * Whether each fold is open, kept here: a fold whose sources are all being
	 * asked again leaves the list, and comes back as the user left it.
	 */
	const foldOpen = $state({
		first: { nothing: false, failed: false },
		rest: { nothing: false, failed: false }
	});
	const named = (gs: { id: string; name: string; lang: string }[]) =>
		gs.map((g) => ({ id: g.id, name: g.name, lang: g.lang }));
	/** 01's sources, then 02's, as the list names them, each arranged on its own. */
	const arranged = $derived(arrangeAnswers(named(data.groups), answers));
	const arrangedRest = $derived(arrangeAnswers(named(data.restGroups), answers));
	/** One section's answered and found, of its own sources' answers. */
	const countsOf = (gs: { id: string }[]) =>
		answerCounts(
			new Map(gs.flatMap((g) => (answers.has(g.id) ? [[g.id, answers.get(g.id)!]] : [])))
		);
	const firstCounts = $derived(countsOf(data.groups));
	const restCounts = $derived(countsOf(data.restGroups));
	/**
	 * What the band's button pins: the sources the library reads from, known
	 * now, or the ones whose answers found the title, known as they land.
	 */
	const toPin = $derived(
		data.asks?.offer === 'read-from'
			? data.asks.offered
			: data.groups.filter((g) => {
					const a = answers.get(g.id);
					return a?.ok && a.value.length > 0;
				})
	);
	/** The band's button: one source by name, several by how many and why. */
	const pinLabel = $derived(
		toPin.length === 1
			? `PIN ${toPin[0].name.toUpperCase()}`
			: `PIN THE ${toPin.length} ${data.asks?.offer === 'read-from' ? 'YOU READ FROM' : 'THAT FOUND IT'}`
	);
	/** The kind's word in the band and ASK THEM's row: "MANGA SOURCES", or plain "SOURCES". */
	const ofKindWord = $derived(data.kind ? `${KIND_TAB[data.kind]} ` : '');
	/**
	 * A kind cell's count: the hits its sources found so far. A kind this
	 * search did not ask (another one is picked) has none to say: `—`.
	 */
	const kindCount = (kind: Kind | null) => {
		const ids = everyGroup
			.map((g) => g.id)
			.filter((id) => kind === null || data.kindOf?.[id] === kind);
		if (ids.length === 0) return '—';
		let n = 0;
		for (const id of ids) {
			const v = answers.get(id);
			if (v?.ok) n += v.value.length;
		}
		return count(n);
	};
	const tabCount = (id: string) => {
		const v = answers.get(id);
		return v === undefined ? '…' : !v.ok ? '✕' : String(v.value.length);
	};
	/** In the ALL tab, a source shows three and links the rest. */
	const SHOWN = 3;

	/**
	 * The bar's leading `/` runs a command, as the library's does: the
	 * sources are searched for anything else. A refusal is said above the
	 * results, and the search that was here stays.
	 */
	let commandNote = $state('');
	/**
	 * Presses so far. A press clears the note as it starts, and its answer
	 * says a refusal only while it is still the latest: a command still
	 * running when the next press is refused must not wipe that refusal when
	 * it lands.
	 */
	let presses = 0;
	async function onSearch(e: SubmitEvent) {
		const text = String(new FormData(e.currentTarget as HTMLFormElement).get('q') ?? '');
		if (!isSearchCommand(text)) return;
		e.preventDefault();
		const press = ++presses;
		commandNote = '';
		const outcome = await runSearchCommand(text);
		if (press === presses && outcome.type === 'refused') commandNote = outcome.message;
	}
</script>

<svelte:head><title>sources · tsundoku</title></svelte:head>

<!-- eslint-disable svelte/no-navigation-without-resolve -- every href below is built from resolve(), by href() or seriesHref() -->

<form method="GET" action={base} class="search" onsubmit={onSearch}>
	<TopBar strong label="Search the sources">
		{#snippet left()}
			<a
				class="cell"
				href={data.q ? `${resolve('/search')}?q=${encodeURIComponent(data.q)}` : resolve('/search')}
				aria-label="Back to search">←</a
			>
		{/snippet}
		{#snippet middle()}
			<SearchField bind:value={q} placeholder="search the sources" autofocus={!data.q} />
		{/snippet}
		{#snippet right()}
			<a class="cell clear" href={base}>CLEAR</a>
		{/snippet}
	</TopBar>
	<!-- The way back to GET STARTED, while FIRST READ's trip lasts (doc/ONBOARDING.md). -->
	<StartTrail start={data.start} />
</form>

{#if commandNote}
	<div class="note" role="status">{commandNote}</div>
{/if}

{#if data.down}
	<div class="note">
		{engineDownLine(__WEB_EDITION__)} · NOTHING CAN BE SEARCHED
	</div>
{:else if data.q && data.asks}
	{@const a = data.asks}
	<!-- The KIND band, the sources' tabs' idiom above them: ALL is every
	     source; a kind asks only its own. It ends in ASKS (c1142): what the
	     search asked first, and ALL SOURCES. One row on a TV. -->
	<div class="tabs kinds-row">
		{#if data.kinds.length > 1}
			<nav class="kinds" aria-label="Kinds">
				<span class="tab lead-cell">KIND</span>
				<a class="tab" class:on={!data.kind} href={href(undefined, null)}
					><span>ALL</span><span class="n">{data.kind ? '—' : count(counts.found)}</span></a
				>
				{#each data.kinds as k (k.kind)}
					<a class="tab" class:on={data.kind === k.kind} href={href(undefined, k.kind)}
						><span>{KIND_TAB[k.kind]}</span><span class="n">{kindCount(k.kind)}</span></a
					>
				{/each}
			</nav>
		{/if}
		<nav class="asks" aria-label="Asks">
			<a
				class="tab"
				class:on={!a.askRest && a.mode !== 'all'}
				class:quiet={a.mode === 'all'}
				href={href(undefined, data.kind, false)}
				><span>{a.mode === 'recent' ? 'LAST BROWSED' : 'PINNED'}</span><span class="n"
					>{a.mode === 'all' ? 0 : a.first}</span
				></a
			>
			<a
				class="tab"
				class:on={a.askRest || a.mode === 'all'}
				href={href(undefined, data.kind, true)}
				data-sveltekit-preload-data="off"
				><span>ALL SOURCES</span><span class="n">{a.total}</span></a
			>
		</nav>
	</div>
	{#if a.band && !data.only}
		<!-- Why this search asked what it did, and one press to pin. -->
		<div class="band" role="status">
			<div class="band-text">
				<span>
					{#if a.band === 'nothing-pinned'}NOTHING PINNED · ASKED THE {a.first} LAST BROWSED
					{:else if a.band === 'kind-none-pinned'}NO {ofKindWord}SOURCE PINNED · {a.mode ===
						'recent'
							? `ASKED THE ${a.first} LAST BROWSED`
							: `ASKED ALL ${a.first}`}
					{:else}NOTHING PINNED OR BROWSED YET · ASKED ALL {a.first}{/if}
				</span>
				<span class="dim">
					{#if a.band === 'nothing-pinned'}PIN A SOURCE IN BROWSE, OR HERE, AND A SEARCH ASKS THE
						PINNED
					{:else if a.band === 'kind-none-pinned'}A KIND WITH NONE PINNED ASKS ITS LAST BROWSED,
						ELSE EVERY ONE OF IT
					{:else}UNTIL A SOURCE IS PINNED OR BROWSED, A SEARCH ASKS THEM ALL{__WEB_EDITION__
							? ' · SLOW IN THE WEB EDITION'
							: ''}{/if}
				</span>
			</div>
			{#if toPin.length}
				<form method="POST" action="{href()}&/pin" use:enhance class="band-pin">
					{#each toPin as s (s.id)}<input type="hidden" name="source" value={s.id} />{/each}
					<button class:accent={a.band !== 'kind-none-pinned'}>{pinLabel}</button>
				</form>
			{/if}
		</div>
	{/if}
	<nav class="tabs" aria-label="Sources">
		<a class="tab" class:on={!data.only} href={href()}
			><span>ALL</span><span class="n">{count(counts.found)}</span></a
		>
		{#each data.all as s (s.id)}
			<a class="tab" class:on={data.only === s.id} href={href(s.id)}
				><span>{sourceTitle(s)}</span><span class="n">{tabCount(s.id)}</span></a
			>
		{/each}
	</nav>

	<div class="label">
		<div>
			01 — {#if data.only || a.mode === 'all'}{firstCounts.answered} OF {data.groups.length} SOURCE{data
					.groups.length === 1
					? ''
					: 'S'} ANSWERED{:else if a.mode === 'recent'}ASKED THE {data.groups.length} LAST BROWSED · {firstCounts.answered}
				ANSWERED{:else}ASKED {data.groups.length} PINNED · {firstCounts.answered}
				ANSWERED{/if}
		</div>
		<div>{count(firstCounts.found)} FOUND</div>
	</div>
	{@render results(arranged, foldOpen.first)}

	{#if !data.only && a.rest > 0}
		{#if a.askRest}
			<div class="label rest-label">
				<div>02 — THE OTHER {a.rest} · {restCounts.answered} ANSWERED</div>
				<div>{count(restCounts.found)} FOUND</div>
			</div>
			{@render results(arrangedRest, foldOpen.rest)}
		{:else}
			<!-- ALL SOURCES in the band and this row do the same thing (c1142). -->
			<div class="ask-rest">
				<span class="ask-text">
					<span>{a.rest} MORE {ofKindWord}SOURCE{a.rest === 1 ? '' : 'S'} NOT ASKED</span>
					<span class="dim">WHAT IS HERE STAYS · THEIR RESULTS FILL IN BELOW</span>
				</span>
				<a href={href(undefined, data.kind, true)} data-sveltekit-preload-data="off">ASK THEM →</a>
			</div>
		{/if}
	{/if}
{:else if !data.q}
	<div class="note">
		TYPE A TITLE · {#if data.asks?.mode === 'pinned'}THE {data.asks.first} PINNED ARE ASKED{:else if data.asks?.mode === 'recent'}THE
			{data.asks.first} LAST BROWSED ARE ASKED{:else}{data.asks?.total ?? 0}
			SOURCES ARE ASKED{/if}
	</div>
{/if}

{#snippet results(ar: typeof arranged, fold: { nothing: boolean; failed: boolean })}
	<!-- The order MOVE's candidates share (doc/READING-ONLINE.md, the search
	     page): the sources with results first, in the order they answered;
	     the ones still asking as one line; then, folded at the end, the ones
	     that found nothing and the ones that did not answer. -->
	{#each ar.matches as m (m.source.id)}
		<div class="g-head">
			<span>{sourceTitle(m.source)}</span>
			<span class="dim">{m.hits.length}</span>
		</div>
		{#each data.only ? m.hits : m.hits.slice(0, SHOWN) as h (h.mangaId)}
			<!-- A preview asks the source: loaded on tap, not hover (see ResultTile).
			     An in-library hit is the series, not its preview, and keeps the
			     search it was found by as its origin, so its ← says SOURCES: the
			     same rule BROWSE's tile follows. -->
			<a
				class="hit"
				data-sveltekit-preload-data="tap"
				href={h.match.kind === 'in-library'
					? seriesHref(h.match.seriesId, page.url.pathname + page.url.search)
					: `${resolve('/downloads/source/[id]', { id: String(h.mangaId) })}?q=${encodeURIComponent(data.q)}`}
			>
				<Cover src={h.cover} width={44} height={62} />
				<span class="text">
					<span class="t">{h.parts.pre}<mark>{h.parts.mid}</mark>{h.parts.post}</span>
					<span class="m">
						{#if h.match.kind === 'in-library'}<span class="lead">IN LIBRARY</span> · {h.match.meta}
						{:else if h.match.kind === 'same-title'}<span class="lead">SAME TITLE IN LIBRARY</span
							>{#if h.match.source}
								· FROM {h.match.source}{/if}
						{:else}{h.meta}{/if}
					</span>
				</span>
				{#if h.match.kind === 'in-library'}<span class="open">OPEN →</span>{/if}
			</a>
		{/each}
		{#if !data.only && m.hits.length > SHOWN}
			<a class="more" href={href(m.source.id)}
				>+ {m.hits.length - SHOWN} MORE FROM {m.source.name.toUpperCase()}</a
			>
		{/if}
	{/each}
	{#if ar.asking.length}
		{@const checking = ar.asking.find((s) => checks.get(s.id)?.since != null)}
		<div class="asking" role="status">
			<span>{ar.asking.length} STILL ASKING</span>
			<span class="dim">
				{#if checking}{sourceTitle(checking)} · BROWSER CHECK · ASKED {Math.floor(
						(checks.get(checking.id)?.elapsed ?? 0) / 1000
					)} S AGO{/if}
			</span>
		</div>
		{#if !ar.matches.length}
			{#each [62, 48] as w (w)}
				<div class="hit ghost" aria-hidden="true">
					<span class="cov-ghost"></span>
					<span class="text"><i style:width="{w}%"></i><i style:width="34%"></i></span>
				</div>
			{/each}
		{/if}
	{/if}
	{#if ar.nothing.length}
		<details class="fold nothing" bind:open={fold.nothing}>
			<summary><span>{ar.nothing.length} FOUND NOTHING</span><span class="ink">↓</span></summary>
			{#each ar.nothing as s (s.id)}
				<div class="g-head quiet"><span>{sourceTitle(s)}</span><span class="dim">0</span></div>
			{/each}
		</details>
	{/if}
	{#if ar.failed.length}
		<details class="fold unanswered" bind:open={fold.failed}>
			<summary><span>{ar.failed.length} DID NOT ANSWER</span><span class="ink">↓</span></summary>
			<div class="failed all">
				<span>NOTHING FROM THESE · ASKED ALONE, NOT THE REST</span>
				<!-- The href is the way without script. With it, a hover must not
				     preload it: that load asks every source again. -->
				<a
					href={href()}
					data-sveltekit-preload-data="off"
					onclick={again(ar.failed.map((f) => f.source.id))}>TRY ALL AGAIN</a
				>
			</div>
			{#each ar.failed as f (f.source.id)}
				<div class="failed">
					<span>{sourceTitle(f.source)} · DID NOT ANSWER IN 20 S</span>
					<a
						href={href(f.source.id)}
						data-sveltekit-preload-data="off"
						onclick={again([f.source.id])}>TRY AGAIN</a
					>
				</div>
			{/each}
		</details>
	{/if}
{/snippet}

<!-- eslint-enable svelte/no-navigation-without-resolve -->

<style>
	.search {
		display: contents;
	}
	.cell {
		display: flex;
		align-items: center;
		padding: 0 var(--pad);
		color: var(--text-1);
		font: 500 16px var(--font-mono);
		text-decoration: none;
	}
	.clear {
		color: var(--text-2);
		font: 500 14px var(--font-mono);
	}
	.tabs {
		display: flex;
		border-bottom: var(--hairline);
		overflow-x: auto;
		scrollbar-width: none;
	}
	.tab {
		display: flex;
		align-items: center;
		gap: 8px;
		padding: 14px 16px;
		border-right: var(--hairline);
		color: var(--text-1);
		font: 500 14px/1.2 var(--font-mono);
		white-space: nowrap;
		text-decoration: none;
	}
	.tab .n {
		opacity: 0.6;
	}
	.tab.on {
		background: var(--surface-inverse);
		color: var(--text-inverse);
	}
	.label {
		display: flex;
		justify-content: space-between;
		gap: 12px;
		padding: 18px var(--pad) 12px;
		font: 500 13px/1.2 var(--font-mono);
		letter-spacing: var(--tracking-label);
		color: var(--text-2);
	}
	.g-head {
		display: flex;
		justify-content: space-between;
		gap: 12px;
		padding: 14px var(--pad) 10px;
		border-top: var(--hairline);
		font: 500 13px/1.2 var(--font-mono);
		letter-spacing: var(--tracking-label);
	}
	.dim {
		color: var(--text-2);
	}
	.hit {
		display: flex;
		align-items: center;
		gap: 16px;
		padding: 10px var(--pad);
		border-top: var(--hairline);
		color: var(--text-1);
		text-decoration: none;
	}
	.text {
		flex: 1;
		min-width: 0;
		display: flex;
		flex-direction: column;
		gap: 5px;
	}
	.t {
		font: 500 16px var(--font-sans);
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}
	mark {
		background: var(--accent-highlight);
		color: inherit;
	}
	.m {
		font: 400 13px/1.3 var(--font-mono);
		color: var(--text-2);
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}
	.lead {
		color: var(--text-1);
	}
	.open {
		flex-shrink: 0;
		font: 500 13px var(--font-mono);
		letter-spacing: 0.04em;
	}
	/* Asking: Index's "not here yet", dashed. */
	.cov-ghost {
		flex-shrink: 0;
		width: 44px;
		height: 62px;
		box-sizing: border-box;
		border: 1px dashed var(--line-2);
	}
	.ghost i {
		display: block;
		height: 10px;
		background: var(--line-1);
	}
	.failed {
		display: flex;
		align-items: stretch;
		min-height: 56px;
		border-top: var(--hairline);
	}
	.failed span {
		flex: 1;
		display: flex;
		align-items: center;
		padding: 0 var(--pad);
		font: 400 13px var(--font-mono);
		color: var(--text-2);
	}
	.failed a {
		display: flex;
		align-items: center;
		padding: 0 var(--pad);
		border-left: var(--hairline);
		color: var(--text-1);
		font: 500 14px var(--font-mono);
		text-decoration: none;
	}
	.more {
		display: flex;
		align-items: center;
		min-height: 44px;
		padding: 0 var(--pad);
		border-top: var(--hairline);
		font: 500 12px var(--font-mono);
		letter-spacing: 0.04em;
		color: var(--text-2);
		text-decoration: none;
	}
	.g-head.quiet {
		color: var(--text-2);
	}
	.asking {
		display: flex;
		justify-content: space-between;
		gap: 12px;
		align-items: center;
		min-height: 44px;
		padding: 0 var(--pad);
		border-top: var(--hairline);
		font: 500 12px var(--font-mono);
		letter-spacing: 0.06em;
		color: var(--text-2);
	}
	/* The empty and the failed sources, folded at the end: a closed one is a
	   single stop on a remote (doc/FOCUS.md). */
	.fold {
		display: block;
		border-top: var(--hairline);
	}
	.fold summary {
		display: flex;
		justify-content: space-between;
		align-items: center;
		min-height: 48px;
		padding: 0 var(--pad);
		font: 500 12px var(--font-mono);
		letter-spacing: 0.06em;
		color: var(--text-2);
		cursor: pointer;
		list-style: none;
	}
	.fold summary::-webkit-details-marker {
		display: none;
	}
	.fold summary .ink {
		color: var(--text-1);
	}
	.fold[open] summary .ink {
		transform: rotate(180deg);
	}
	/* KIND's own label, and the ASKS pair pushed to the band's end (c1142). */
	.tab.lead-cell {
		color: var(--text-2);
	}
	.kinds {
		display: flex;
	}
	.asks {
		display: flex;
		margin-left: auto;
		border-left: var(--hairline);
	}
	.asks .tab:last-child {
		border-right: 0;
	}
	.tab.quiet {
		color: var(--text-2);
	}
	/* Why the search asked what it did, and one press to pin. */
	.band {
		display: flex;
		align-items: stretch;
		border-bottom: var(--hairline);
		background: var(--surface-panel);
	}
	.band-text {
		flex: 1;
		display: flex;
		flex-direction: column;
		gap: 6px;
		padding: 14px var(--pad);
		font: 500 13px/1.4 var(--font-mono);
		letter-spacing: var(--tracking-label);
	}
	.band-pin {
		display: flex;
	}
	.band-pin button {
		padding: 0 var(--pad);
		border: 0;
		border-left: var(--hairline);
		background: none;
		color: var(--text-1);
		font: 500 14px var(--font-mono);
		letter-spacing: 0.04em;
		white-space: nowrap;
		cursor: pointer;
	}
	.band-pin button.accent {
		border-left: 0;
		background: var(--accent);
		color: var(--on-accent);
	}
	.rest-label {
		border-top: 1px solid var(--line-2);
	}
	/* ASK THEM: one ruled row under 01, as the design draws it. */
	.ask-rest {
		display: flex;
		align-items: stretch;
		border-top: 1px solid var(--text-1);
		border-bottom: var(--hairline);
	}
	.ask-text {
		flex: 1;
		display: flex;
		flex-direction: column;
		gap: 6px;
		padding: 14px var(--pad);
		font: 500 13px/1.3 var(--font-mono);
		letter-spacing: var(--tracking-label);
	}
	.ask-rest a {
		display: flex;
		align-items: center;
		padding: 0 var(--pad);
		border-left: var(--hairline);
		color: var(--text-1);
		font: 500 14px var(--font-mono);
		letter-spacing: 0.04em;
		text-decoration: none;
		white-space: nowrap;
	}
	@media (max-width: 599px) {
		/* The phone gives ASKS its own row, and the band its button below. */
		.kinds-row {
			flex-wrap: wrap;
		}
		.asks {
			width: 100%;
			margin-left: 0;
			border-left: 0;
			border-top: var(--hairline);
		}
		.asks .tab {
			flex: 1;
		}
		.band {
			flex-direction: column;
		}
		.band-pin button {
			width: 100%;
			min-height: 52px;
			border-left: 0;
			border-top: var(--hairline);
		}
	}
	.note {
		padding: 24px var(--pad);
		font: 400 13px var(--font-mono);
		color: var(--text-2);
	}
</style>

<script lang="ts">
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

	/**
	 * Searching the sources (Download States 1e, state 6). Results fill in
	 * source by source under their names; a source still asking shows two
	 * dashed rows, Index's "not here yet"; one that didn't answer says so with
	 * TRY AGAIN. A result already in the library says IN LIBRARY and opens
	 * it; the same title from another source says so, to head off a twin.
	 * Tabs narrow to one source. Without script the server waits for every
	 * source and sends their answers as values (c146): streamed data needs
	 * script, and without it the page drew its waiting rows for good.
	 */
	let { data } = $props();

	// svelte-ignore state_referenced_locally
	let q = $state(data.q);
	const base = resolve('/downloads/search');
	const href = (source?: string) =>
		`${base}?q=${encodeURIComponent(data.q)}${source ? `&source=${source}` : ''}`;

	/**
	 * What each source answered, keyed by source, in the order the answers
	 * arrived: the matches are drawn in that order, so a late one joins below
	 * (card c490, the order MOVE's candidates share: `source-answers.ts`).
	 */
	const answers = new SvelteMap<string, Settled<SearchHit[]>>();
	// Without script the answers arrive as values (c146): set at once, on the server too.
	for (const g of untrack(() => data.groups)) if (isSettled(g.hits)) answers.set(g.id, g.hits);
	/** Bumped by every fresh load, so an answer for an earlier search is dropped. */
	let generation = 0;
	$effect(() => {
		const gen = ++generation;
		answers.clear();
		for (const g of data.groups) {
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
			const u = new URLSearchParams({ q: data.q, source: id });
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
	// A source still asking: is its site's check being passed? (c143) The engine
	// says for an extension, the app itself for a novel (c152); asked only with
	// the engine set up, which BROWSE needs anyway.
	const checks = new SvelteMap<string, SiteCheck>();
	$effect(() => {
		if (!data.engine) return;
		for (const g of data.groups) {
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
	 * asked again leaves the list, and comes back as the owner left it.
	 */
	const foldOpen = $state({ nothing: false, failed: false });
	/** The sources this search asked, as the list names them. */
	const asked = $derived(data.groups.map((g) => ({ id: g.id, name: g.name, lang: g.lang })));
	const arranged = $derived(arrangeAnswers(asked, answers));
	const tabCount = (id: string) => {
		const v = answers.get(id);
		return v === undefined ? '…' : !v.ok ? '✕' : String(v.value.length);
	};
	/** In the ALL tab, a source shows three and links the rest. */
	const SHOWN = 3;
</script>

<svelte:head><title>sources · tsundoku</title></svelte:head>

<!-- eslint-disable svelte/no-navigation-without-resolve -- every href below is built from resolve(), by href() or seriesHref() -->

<form method="GET" action={base} class="search">
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

{#if data.down}
	<div class="note">
		○ NOT ANSWERING · THE EXTENSION ENGINE ON THE WORKSTATION · NOTHING CAN BE SEARCHED
	</div>
{:else if data.q && data.all}
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
			01 — {counts.answered} OF {data.groups.length} SOURCE{data.groups.length === 1 ? '' : 'S'} ANSWERED
		</div>
		<div>{count(counts.found)} FOUND</div>
	</div>

	<!-- The order MOVE's candidates share (card c490; doc/BROWSING.md, the search
	     page): the sources with results first, in the order they answered;
	     the ones still asking as one line; then, folded at the end, the ones
	     that found nothing and the ones that did not answer. -->
	{#each arranged.matches as m (m.source.id)}
		<div class="g-head">
			<span>{sourceTitle(m.source)}</span>
			<span class="dim">{m.hits.length}</span>
		</div>
		{#each data.only ? m.hits : m.hits.slice(0, SHOWN) as h (h.mangaId)}
			<!-- A preview asks the source: loaded on tap, not hover (see ResultTile).
			     An in-library hit is the series, not its preview, and keeps the
			     search it was found by as its origin, so its ← says SOURCES (c262,
			     c152): the same rule BROWSE's tile follows. -->
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
	{#if arranged.asking.length}
		{@const checking = arranged.asking.find((s) => checks.get(s.id)?.since != null)}
		<div class="asking" role="status">
			<span>{arranged.asking.length} STILL ASKING</span>
			<span class="dim">
				{#if checking}{sourceTitle(checking)} · BROWSER CHECK · ASKED {Math.floor(
						(checks.get(checking.id)?.elapsed ?? 0) / 1000
					)} S AGO{/if}
			</span>
		</div>
		{#if !arranged.matches.length}
			{#each [62, 48] as w (w)}
				<div class="hit ghost" aria-hidden="true">
					<span class="cov-ghost"></span>
					<span class="text"><i style:width="{w}%"></i><i style:width="34%"></i></span>
				</div>
			{/each}
		{/if}
	{/if}
	{#if arranged.nothing.length}
		<details class="fold nothing" bind:open={foldOpen.nothing}>
			<summary
				><span>{arranged.nothing.length} FOUND NOTHING</span><span class="ink">↓</span></summary
			>
			{#each arranged.nothing as s (s.id)}
				<div class="g-head quiet"><span>{sourceTitle(s)}</span><span class="dim">0</span></div>
			{/each}
		</details>
	{/if}
	{#if arranged.failed.length}
		<details class="fold unanswered" bind:open={foldOpen.failed}>
			<summary
				><span>{arranged.failed.length} DID NOT ANSWER</span><span class="ink">↓</span></summary
			>
			<div class="failed all">
				<span>NOTHING FROM THESE · ASKED ALONE, NOT THE REST</span>
				<a href={href()} onclick={again(arranged.failed.map((f) => f.source.id))}>TRY ALL AGAIN</a>
			</div>
			{#each arranged.failed as f (f.source.id)}
				<div class="failed">
					<span>{sourceTitle(f.source)} · DID NOT ANSWER IN 20 S</span>
					<a href={href(f.source.id)} onclick={again([f.source.id])}>TRY AGAIN</a>
				</div>
			{/each}
		</details>
	{/if}
{:else if !data.q}
	<div class="note">TYPE A TITLE · {data.all?.length ?? 0} SOURCES ARE ASKED</div>
{/if}

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
	.note {
		padding: 24px var(--pad);
		font: 400 13px var(--font-mono);
		color: var(--text-2);
	}
</style>

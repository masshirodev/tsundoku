<script lang="ts">
	import { resolve } from '$app/paths';
	import TopBar from '$lib/components/chrome/TopBar.svelte';
	import Cover from '$lib/components/content/Cover.svelte';
	import SearchField from '$lib/components/controls/SearchField.svelte';
	import { seriesHref } from '$lib/library/links';
	import { count } from '$lib/library/downloads';
	import { SvelteMap } from 'svelte/reactivity';

	/**
	 * Searching the sources (Download States 1e, state 6). Results fill in
	 * source by source under their names; a source still asking shows two
	 * dashed rows, Index's "not here yet"; one that didn't answer says so with
	 * TRY AGAIN. A result already in the library says IN LIBRARY and opens
	 * it; the same title from another source says so, to head off a twin.
	 * Tabs narrow to one source. Without script the page waits for every
	 * source (at most twenty seconds), since streamed results need it.
	 */
	let { data } = $props();

	// svelte-ignore state_referenced_locally
	let q = $state(data.q);
	const base = resolve('/downloads/search');
	const href = (source?: string) =>
		`${base}?q=${encodeURIComponent(data.q)}${source ? `&source=${source}` : ''}`;

	/** What each source answered, as it does: a count, or 'x' for no answer. */
	const settled = new SvelteMap<string, number | 'x'>();
	$effect(() => {
		settled.clear();
		for (const g of data.groups)
			g.hits.then(
				(h) => settled.set(g.id, h.length),
				() => settled.set(g.id, 'x')
			);
	});
	const answered = $derived([...settled.values()].filter((v) => v !== 'x').length);
	const found = $derived(
		[...settled.values()].reduce<number>((a, v) => a + (v === 'x' ? 0 : v), 0)
	);
	const tabCount = (id: string) => {
		const v = settled.get(id);
		return v === undefined ? '…' : v === 'x' ? '✕' : String(v);
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
</form>

{#if data.down}
	<div class="note">○ NOT ANSWERING · SUWAYOMI ON THE WORKSTATION · NOTHING CAN BE SEARCHED</div>
{:else if data.q && data.all}
	<nav class="tabs" aria-label="Sources">
		<a class="tab" class:on={!data.only} href={href()}
			><span>ALL</span><span class="n">{count(found)}</span></a
		>
		{#each data.all as s (s.id)}
			<a class="tab" class:on={data.only === s.id} href={href(s.id)}
				><span>{s.name.toUpperCase()}</span><span class="n">{tabCount(s.id)}</span></a
			>
		{/each}
	</nav>

	<div class="label">
		<div>
			01 — {answered} OF {data.groups.length} SOURCE{data.groups.length === 1 ? '' : 'S'} ANSWERED
		</div>
		<div>{count(found)} FOUND</div>
	</div>

	{#each data.groups as g (g.id)}
		<div class="g-head">
			<span>{g.name.toUpperCase()}</span>
			<span class="dim">
				{#await g.hits}ASKING{:then hits}{hits.length}{:catch}DID NOT ANSWER{/await}
			</span>
		</div>
		{#await g.hits}
			{#each [62, 48] as w (w)}
				<div class="hit ghost" aria-hidden="true">
					<span class="cov-ghost"></span>
					<span class="text"><i style:width="{w}%"></i><i style:width="34%"></i></span>
				</div>
			{/each}
		{:then hits}
			{#each data.only ? hits : hits.slice(0, SHOWN) as h (h.mangaId)}
				<a
					class="hit"
					href={h.match.kind === 'in-library'
						? seriesHref(h.match.seriesId)
						: `${resolve('/downloads/source/[id]', { id: String(h.mangaId) })}?q=${encodeURIComponent(data.q)}`}
				>
					<Cover src={h.cover} width={44} height={62} />
					<span class="text">
						<span class="t">{h.parts.pre}<mark>{h.parts.mid}</mark>{h.parts.post}</span>
						<span class="m">
							{#if h.match.kind === 'in-library'}<span class="lead">IN LIBRARY</span> · {h.match
									.meta}
							{:else if h.match.kind === 'same-title'}<span class="lead">SAME TITLE IN LIBRARY</span
								>{#if h.match.source}
									· FROM {h.match.source}{/if}
							{:else}{h.meta}{/if}
						</span>
					</span>
					{#if h.match.kind === 'in-library'}<span class="open">OPEN →</span>{/if}
				</a>
			{/each}
			{#if hits.length === 0}
				<div class="none">NOTHING FOUND</div>
			{:else if !data.only && hits.length > SHOWN}
				<a class="more" href={href(g.id)}
					>+ {hits.length - SHOWN} MORE FROM {g.name.toUpperCase()}</a
				>
			{/if}
		{:catch}
			<div class="failed">
				<span>DID NOT ANSWER IN 20 S · NOTHING FROM IT</span>
				<a href={href(g.id)}>TRY AGAIN</a>
			</div>
		{/await}
	{/each}
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
	.more,
	.none {
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
	.note {
		padding: 24px var(--pad);
		font: 400 13px var(--font-mono);
		color: var(--text-2);
	}
</style>

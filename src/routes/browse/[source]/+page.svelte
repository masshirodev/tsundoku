<script lang="ts">
	import { resolve } from '$app/paths';
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import { onMount, untrack } from 'svelte';
	import TopBar from '$lib/components/chrome/TopBar.svelte';
	import Band from '$lib/components/chrome/Band.svelte';
	import GridOutline from '$lib/components/waiting/GridOutline.svelte';
	import { count } from '$lib/library/downloads';
	import { writeFilters } from '$lib/library/browse-filters';
	import { isSettled } from '$lib/library/settled';
	import ResultTile from './ResultTile.svelte';
	import { SiteCheck, checkLine } from '$lib/site-check.svelte';
	import { askedLine } from '$lib/waiting';
	import FilterForm from './FilterForm.svelte';

	/**
	 * A source's page in BROWSE (Index-Browse: popular, filters, phoneGrid;
	 * Browse Calls, "A source page is a shelf" and "It scrolls on, and the URL
	 * keeps the place"). POPULAR and LATEST are tabs, FILTERED joins them once
	 * filters are applied, and FILTER sits at their right end. The grid is the
	 * library's. The next page is asked for as the end comes near and added;
	 * MORE ↓ is the same as a link (?pages=N), which is the no-script way on and
	 * what back returns to.
	 */
	let { data } = $props();

	type Answer = Extract<Awaited<typeof data.answer>, { ok: true }>['value'];
	type Shown = { key: string; ok: true; value: Answer } | { key: string; ok: false; error: string };

	const base = $derived(resolve('/browse/[source]', { source: data.source.id }));
	/** The current URL with some parameters changed; null removes one. */
	function link(over: Record<string, string | null>): string {
		// eslint-disable-next-line svelte/prefer-svelte-reactivity -- a throwaway copy, never read reactively
		const p = new URLSearchParams(page.url.searchParams);
		for (const [k, v] of Object.entries(over)) {
			if (v === null) p.delete(k);
			else p.set(k, v);
		}
		const s = p.toString();
		return s ? `${base}?${s}` : base;
	}
	/** Which list this is, whatever page it's on: what decides appending vs starting over. */
	const listKey = (u: URL) => {
		// eslint-disable-next-line svelte/prefer-svelte-reactivity -- a throwaway copy, never read reactively
		const p = new URLSearchParams(u.searchParams);
		for (const k of ['pages', 'panel', 'find']) p.delete(k);
		return `${u.pathname}?${p}`;
	};

	// The answer on screen. Kept while the next page is asked for, so the grid
	// grows rather than flashing back to its outline; a different list (another
	// tab, other filters) starts from the outline.
	// svelte-ignore state_referenced_locally
	let shown = $state<Shown | null>(
		isSettled(data.answer) ? { key: listKey(page.url), ...data.answer } : null
	);
	let asking = $state(false);
	$effect(() => {
		const a = data.answer;
		const key = listKey(page.url);
		// Read without depending on it: this effect is what writes it.
		if (untrack(() => shown && shown.key !== key)) shown = null;
		if (isSettled(a)) {
			shown = { key, ...a };
			asking = false;
			return;
		}
		let current = true;
		asking = true;
		void a.then((s) => {
			if (!current) return;
			shown = { key, ...s };
			asking = false;
		});
		return () => (current = false);
	});

	// Waiting for the first answer: is the engine passing the site's browser check? (c143)
	const check = new SiteCheck();
	$effect(() => {
		if (shown) return;
		check.start(data.source.id);
		return () => check.stop();
	});

	const value = $derived(shown?.ok ? shown.value : null);
	const results = $derived(value?.results ?? null);
	const name = $derived(data.source.name);
	// An LNReader plugin (doc/NOVELS.md): no settings here, and its search takes no filters.
	const novel = $derived(data.source.kind === 'novel');
	const tabTitle = $derived(
		data.q
			? `“${data.q.toUpperCase()}”`
			: data.mode === 'filtered'
				? 'FILTERED'
				: data.mode.toUpperCase()
	);

	// ---- it scrolls on ------------------------------------------------------------
	// Without script there's no scrolling on, only MORE ↓: the label says so only with it.
	let js = $state(false);
	let moreEl = $state<HTMLElement | null>(null);
	let io = $state<IntersectionObserver | null>(null);
	onMount(() => {
		js = true;
		io = new IntersectionObserver(
			(seen) => {
				if (!seen.some((e) => e.isIntersecting) || asking || !results?.more) return;
				// eslint-disable-next-line svelte/no-navigation-without-resolve -- link() builds on base, from resolve()
				void goto(link({ pages: String(data.pages + 1) }), {
					noScroll: true,
					keepFocus: true,
					replaceState: true
				});
			},
			// "As the end comes near": a screen ahead of it.
			{ rootMargin: '0px 0px 100% 0px' }
		);
		return () => io?.disconnect();
	});
	$effect(() => {
		const el = moreEl;
		const watcher = io;
		if (!el || !watcher) return;
		watcher.observe(el);
		return () => watcher.unobserve(el);
	});

	const tileHref = (h: { mangaId: string; match: { kind: string; seriesId?: number } }) =>
		h.match.kind === 'in-library' && h.match.seriesId
			? resolve('/series/[id]', { id: String(h.match.seriesId) })
			: `${resolve('/downloads/source/[id]', { id: h.mangaId })}?from=${encodeURIComponent(page.url.pathname + page.url.search)}`;
	const hue = (id: string) => [...id].reduce((a, c) => (a * 31 + c.charCodeAt(0)) % 360, 0);

	/** RESET is the source's own choices, on the filtered tab, with the panel open. */
	const resetHref = $derived(
		value
			? `${base}?${new URLSearchParams([['tab', 'filtered'], ['panel', '1'], ...(data.q ? [['q', data.q]] : []), ...writeFilters(value.schema)] as [string, string][])}`
			: base
	);
	/** The search keeps the filters it was asked with. */
	const keptFilters = $derived(
		data.mode === 'filtered' && value ? writeFilters(value.applied) : []
	);
</script>

<svelte:head><title>{name.toLowerCase()} · browse · tsundoku</title></svelte:head>

<!-- eslint-disable svelte/no-navigation-without-resolve -- every href below is built from resolve(), by base, link() or tileHref() -->

<div class="screen">
	<TopBar sticky label="{name} in BROWSE">
		<!-- Every cell in the middle, each with its own left rule, as the mock builds the bar. -->
		{#snippet middle()}
			<a class="cell back" href={resolve('/browse')} aria-label="Back to BROWSE">←</a>
			<div class="title" class:searching={data.find || !!data.q}>
				<span class="name">{name.toUpperCase()}</span>
				<span class="sub">{data.source.kind.toUpperCase()} · {data.source.lang.toUpperCase()}</span>
			</div>
			<form method="GET" action={base} class="find" class:open={data.find || !!data.q}>
				{#each keptFilters as [k, v] (k)}<input type="hidden" name={k} value={v} />{/each}
				{#if keptFilters.length}<input type="hidden" name="tab" value="filtered" />{/if}
				<input
					type="search"
					name="q"
					value={data.q}
					placeholder={novel ? `/ search ${name}` : `/ search ${name}, with its filters`}
					aria-label="Search {name}"
					autocomplete="off"
				/>
			</form>
			<a class="cell slash" href={link({ find: '1' })} aria-label="Search {name}">/</a>
			{#if !novel}<a class="cell settings" href="{base}/settings">SETTINGS</a>{/if}
		{/snippet}
	</TopBar>

	<nav class="tabs" aria-label="Lists">
		<div class="tab-list">
			<a class="tab" class:on={data.mode === 'popular'} href={base}>POPULAR</a>
			{#if value?.latest}
				<a class="tab" class:on={data.mode === 'latest'} href="{base}?tab=latest">LATEST</a>
			{/if}
			{#if data.mode === 'filtered'}
				<span class="tab on">{data.q ? 'SEARCH' : 'FILTERED'}</span>
			{/if}
		</div>
		{#if value && value.schema.length > 0}
			<a
				class="filter"
				class:open={data.panel}
				href={link({ panel: data.panel ? null : '1' })}
				aria-expanded={data.panel}
			>
				<span>FILTER</span>
				{#if data.mode === 'filtered' && value.changed > 0}<span class="badge">{value.changed}</span
					>{/if}
				<span aria-hidden="true">{data.panel ? '▴' : '▾'}</span>
			</a>
		{/if}
	</nav>

	{#if data.panel && value}
		<FilterForm
			action={base}
			title="{name} · {data.source.lang}"
			schema={value.schema}
			applied={value.applied}
			q={data.q}
			{resetHref}
			cancelHref={link({ panel: null })}
		/>
	{/if}

	{#if shown && !shown.ok}
		{#if shown.error === 'down'}
			<Band
				title="○ NOT ANSWERING · THE EXTENSION ENGINE ON THE WORKSTATION"
				detail="THE LIBRARY AND CACHED CHAPTERS STILL OPEN"
			/>
		{:else if data.source.failed}
			<Band
				title="FAILED TO LOAD · {data.source.failed.toUpperCase()}"
				detail="TRY AGAIN IN EXTENSIONS"
			/>
		{:else}
			<Band
				title="{name.toUpperCase()} DID NOT ANSWER"
				detail={shown.error.toUpperCase().slice(0, 140)}
			>
				{#snippet action()}<a class="again" href={link({})}>TRY AGAIN</a>{/snippet}
			</Band>
		{/if}
	{:else}
		{#if !results && check.since !== null}
			<Band
				title="{name.toUpperCase()} · PASSING THE SITE'S BROWSER CHECK"
				detail={checkLine(check.elapsed)}
			/>
		{:else if !results && check.elapsed >= 10_000}
			<Band title="STILL ASKING {name.toUpperCase()}" detail={askedLine(check.elapsed)} />
		{/if}
		<div class="label">
			<div>01 — {tabTitle}</div>
			<div class="r">
				{#if !results && check.since !== null}WAITING FOR THE SITE{:else if !results}ASKING {name.toUpperCase()}{:else if results.more}<span
						>{count(results.hits.length)} SO FAR</span
					>{#if js}<span class="long">&nbsp;· MORE AS YOU SCROLL</span>{/if}{:else}{count(
						results.hits.length
					)} IN ALL{/if}
			</div>
		</div>

		{#if !results}
			<GridOutline />
		{:else if results.hits.length === 0}
			<div class="none">NOTHING HERE{data.mode === 'filtered' ? ' · TRY FEWER FILTERS' : ''}</div>
		{:else}
			<div class="grid" class:dim={data.panel}>
				{#each results.hits as h (h.mangaId)}
					<ResultTile hit={h} href={tileHref(h)} hue={hue(h.mangaId)} />
				{/each}
			</div>
			{#if results.more}
				<div class="more" bind:this={moreEl}>
					<span class="pg"
						>{asking ? `ASKING FOR PAGE ${data.pages + 1}` : `PAGE ${data.pages + 1}`}</span
					>
					<a class="go" href={link({ pages: String(data.pages + 1) })} data-sveltekit-noscroll
						>MORE ↓</a
					>
				</div>
			{/if}
		{/if}
	{/if}
</div>

<!-- eslint-enable svelte/no-navigation-without-resolve -->

<style>
	/* Index-Browse, popular / filters / phoneGrid, transcribed: the mock's literals; colours are tokens. */
	.screen {
		display: flex;
		flex-direction: column;
		min-height: 100dvh;
	}
	/* The mock's cells: a column, centred, 4px between a cell's lines. */
	.cell {
		display: flex;
		flex-direction: column;
		justify-content: center;
		/* TopBar centres what it holds; the mock's cells stretch, their text at the left. */
		align-items: stretch;
		gap: 4px;
		height: 100%;
		padding: 0 var(--pad);
		font: 500 14px/1.2 var(--font-mono);
		color: var(--text-1);
		text-decoration: none;
		white-space: nowrap;
	}
	.cell + .cell,
	.cell + .title,
	.title + .find,
	.find + .cell {
		border-left: var(--hairline);
	}
	.back {
		font: 500 16px/1 var(--font-mono);
	}
	.title {
		display: flex;
		flex-direction: column;
		justify-content: center;
		gap: 4px;
		flex-shrink: 0;
		min-width: 0;
		padding: 0 var(--pad);
	}
	.name {
		font: 500 16px/1.2 var(--font-mono);
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.sub {
		font: 400 12px/1 var(--font-mono);
		letter-spacing: 0.04em;
		color: var(--text-2);
		white-space: nowrap;
	}
	.find {
		display: flex;
		flex-direction: column;
		justify-content: center;
		align-items: stretch;
		gap: 4px;
		flex: 1 1 auto;
		min-width: 0;
		padding: 0 18px;
	}
	.find input {
		min-width: 0;
		padding: 0;
		border: 0;
		border-radius: 0;
		background: transparent;
		color: var(--text-1);
		font: 400 16px/1.2 var(--font-mono);
		outline: none;
	}
	.find input::placeholder {
		color: var(--text-2);
	}
	.slash {
		display: none;
		font: 500 16px/1 var(--font-mono);
	}
	.tabs {
		flex-shrink: 0;
		display: flex;
		border-top: var(--hairline);
		border-bottom: var(--hairline);
	}
	.tab-list {
		flex: 1;
		min-width: 0;
		display: flex;
		overflow: hidden;
	}
	.tab {
		padding: 14px 16px;
		border-right: var(--hairline);
		font: 500 14px var(--font-mono);
		white-space: nowrap;
		color: var(--text-1);
		text-decoration: none;
	}
	.tab.on {
		background: var(--surface-inverse);
		color: var(--text-inverse);
	}
	.filter {
		display: flex;
		align-items: center;
		gap: 8px;
		flex-shrink: 0;
		padding: 0 16px;
		border-left: var(--hairline);
		font: 500 14px var(--font-mono);
		color: var(--text-1);
		text-decoration: none;
	}
	.filter.open {
		background: var(--surface-inverse);
		color: var(--text-inverse);
	}
	.badge {
		padding: 1px 6px;
		background: var(--accent);
		color: var(--on-accent);
		font: 500 12px var(--font-mono);
	}
	.label {
		flex-shrink: 0;
		display: flex;
		justify-content: space-between;
		gap: 12px;
		padding: 22px var(--pad) 12px;
		font: 500 13px/1.2 var(--font-mono);
		letter-spacing: 0.06em;
		color: var(--text-2);
	}
	.label .r {
		white-space: nowrap;
	}
	.grid {
		position: relative;
		flex-shrink: 0;
		display: grid;
		grid-template-columns: repeat(var(--grid-cols), minmax(0, 1fr));
		gap: 1px;
		/* Each tile draws its rules into the gap (ResultTile), not the grid's
		   background, so a short last row ends in page, not a grey block: the
		   library counts filler cells in script, and this page draws without it.
		   The last row's own rule lands on the border, so it reads as one. */
		background: var(--surface-page);
		border-bottom: var(--hairline);
	}
	.grid.dim::after {
		content: '';
		position: absolute;
		inset: 0;
		background: var(--scrim);
	}
	.more {
		flex-shrink: 0;
		display: flex;
		align-items: stretch;
		min-height: 56px;
		border-bottom: var(--hairline);
	}
	.pg {
		flex: 1;
		min-width: 0;
		display: flex;
		align-items: center;
		padding: 0 var(--pad);
		font: 500 13px var(--font-mono);
		letter-spacing: 0.04em;
		color: var(--text-2);
	}
	.go {
		display: flex;
		align-items: center;
		padding: 0 var(--pad);
		border-left: var(--hairline);
		font: 500 14px var(--font-mono);
		letter-spacing: 0.04em;
		white-space: nowrap;
		color: var(--text-1);
		text-decoration: none;
	}
	.none {
		padding: 24px var(--pad);
		font: 500 13px var(--font-mono);
		letter-spacing: 0.06em;
		color: var(--text-2);
	}
	.again {
		color: inherit;
		font: 500 14px var(--font-mono);
	}

	/* The phone: no room for the field, so / opens it in the title's place. */
	@media (max-width: 599px) {
		.title {
			flex: 1 1 auto;
		}
		.sub,
		.long {
			display: none;
		}
		.find {
			display: none;
		}
		.find.open {
			display: flex;
		}
		.title.searching {
			display: none;
		}
		.slash {
			display: flex;
		}
		.find.open ~ .slash {
			display: none;
		}
		.label {
			padding-top: 18px;
		}
	}
</style>

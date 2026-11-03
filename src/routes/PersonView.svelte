<script lang="ts">
	import { enhance } from '$app/forms';
	import { goto } from '$app/navigation';
	import BookTile from '$lib/components/content/BookTile.svelte';
	import Cover from '$lib/components/content/Cover.svelte';
	import Badge from '$lib/components/content/Badge.svelte';
	import { hueFor } from '$lib/library/cover';
	import { count } from '$lib/library/labels';
	import { bookCoverSrc, coverSrc, seriesHref, tagHref } from '$lib/library/links';
	import type { TagItem, TagPage } from '$lib/library/books';
	import type { WorkFootFacts } from '$lib/library/works';
	import { phone } from '$lib/device.svelte';
	import FilterPanel from '$lib/components/controls/FilterPanel.svelte';
	import {
		activeCount,
		filterWords,
		kindsAmong,
		languagesAmong,
		matches,
		NO_FILTERS,
		type Filters
	} from '$lib/library/filters';

	/**
	 * A person or tag page (Index Books, states 4, 5 and 8): the library at
	 * `/?tag=…`, where this header replaces CONTINUE. Tiles, SELECT and the bulk
	 * bar stay the library's own, so grouping from here needs nothing new.
	 *
	 * People (artist, circle, author) get FAV, a circle its ARTISTS, and a
	 * SERIES strip; a plain tag gets the same page with less.
	 */
	let {
		page,
		selecting,
		selected,
		onselect,
		reveal = false,
		workFeet = {}
	}: {
		page: TagPage;
		/** HIDDEN is in the panel only while reveal is on. */
		reveal?: boolean;
		selecting: boolean;
		selected: Set<number>;
		onselect: (item: TagItem) => void;
		/** Each series' place in its Work: "PART 2 · THE BREAKER" (doc/WORKS.md). */
		workFeet?: Record<string, WorkFootFacts>;
	} = $props();

	// FAV and RATED left the tabs for the FILTER panel, as the library's
	// shelves did (Library Filters 3i). The page filters on the device: it
	// holds every item already.
	type Filter = 'all' | 'unread';
	type Sort = 'added' | 'title' | 'rating';
	let filter = $state<Filter>('all');
	let sort = $state<Sort>('added');
	let bySeries = $state(false);
	let filters = $state<Filters>(NO_FILTERS);
	const nFilters = $derived(activeCount(filters));
	const languages = $derived(languagesAmong(page.items));
	const kinds = $derived(kindsAmong(page.items));

	// Cosmetic: pad a short last row so the hairline background doesn't show
	// as a grey slab. The column counts themselves are CSS.
	const cols = $derived(phone.current ? 3 : 6);
	const pad = (n: number, c: number) => (c - (n % c)) % c;

	const tagKey = $derived(`${page.namespace}:${page.value}`);
	const counts = $derived({
		all: page.items.length,
		unread: page.items.filter((i) => !i.read).length
	});
	/** The tab's own items, before the panel narrows them: what "12 OF 38" is out of. */
	const onTab = $derived(page.items.filter((i) => filter !== 'unread' || !i.read));
	const shown = $derived.by(() => {
		let items = onTab.filter((i) => matches(i, filters));
		if (bySeries) {
			// One tile per series of books: its first matching book stands for it.
			// eslint-disable-next-line svelte/prefer-svelte-reactivity -- local to this derivation, never reactive state
			const seen = new Set<number>();
			items = items.filter((i) => {
				if (i.entryId === null) return true;
				if (seen.has(i.seriesId)) return false;
				seen.add(i.seriesId);
				return true;
			});
		}
		const sorted = [...items];
		if (sort === 'title')
			sorted.sort((a, b) => a.title.localeCompare(b.title, 'en', { numeric: true }));
		else if (sort === 'rating') sorted.sort((a, b) => b.rating - a.rating || b.addedAt - a.addedAt);
		return sorted;
	});

	const SORT_LABEL: Record<Sort, string> = {
		added: 'DATE ADDED ↓',
		title: 'A–Z ↓',
		rating: 'RATING ↓'
	};
	const nextSort: Record<Sort, Sort> = { added: 'title', title: 'rating', rating: 'added' };

	function meta(i: TagItem): { text: string; accent: boolean; progress?: number } {
		// Finding shows the series; its foot says where in the run it sits
		// (Work-States 7), and a book keeps its own place in its series.
		const work = i.entryId === null ? workFeet[String(i.seriesId)] : undefined;
		if (work) return { text: `PART ${work.part} · ${work.name.toUpperCase()}`, accent: false };
		if (i.entryId !== null && i.seriesTitle) {
			const series = bySeries ? `${i.total} BOOKS` : `${i.position}/${i.total}`;
			return { text: `${i.seriesTitle.toUpperCase()} · ${series}`, accent: false };
		}
		if (i.kind !== 'doujin') {
			const unit = i.kind === 'novel' ? 'VOL' : 'CH';
			return {
				text: i.read
					? `${i.kind.toUpperCase()} · READ`
					: `${i.kind.toUpperCase()} · ${i.entries} ${unit}`,
				accent: false
			};
		}
		if (i.read) return { text: `${i.pages} P · READ`, accent: false };
		if (i.progress !== null) {
			return {
				text: `P. ${Math.round(i.progress * i.pages)} / ${i.pages}`,
				accent: true,
				progress: i.progress
			};
		}
		return { text: `${i.pages} P`, accent: false };
	}

	function open(i: TagItem) {
		if (selecting) {
			if (i.entryId === null) onselect(i);
			return;
		}
		const extra: Record<string, string> = i.entryId !== null ? { book: String(i.entryId) } : {};
		// eslint-disable-next-line svelte/no-navigation-without-resolve -- seriesHref() resolves
		void goto(seriesHref(i.seriesId, `tag:${tagKey}`, extra));
	}

	const label = $derived(page.namespace ? page.namespace.toUpperCase() : 'TAG');
</script>

<div class="person">
	<div class="label"><span>01 — {label}</span><span>{page.person ? 'PERSON' : 'TAG'}</span></div>
	<h1 class="name">{page.value}</h1>

	<div class="counts">
		{#if page.person}
			<div class="c"><b>{count(page.counts.books)}</b><span>BOOKS</span></div>
			<div class="c"><b>{count(page.counts.series)}</b><span>SERIES</span></div>
			<div class="c wide-only"><b>{count(page.counts.single)}</b><span>SINGLE</span></div>
			<div class="c"><b>{count(page.counts.read)}</b><span>READ</span></div>
			<form method="POST" action="?/personFavourite" use:enhance class="fav-form">
				<input type="hidden" name="namespace" value={page.namespace} />
				<input type="hidden" name="value" value={page.value} />
				<input type="hidden" name="on" value={page.favourite ? '0' : '1'} />
				<button type="submit" class="fav" class:on={page.favourite} aria-pressed={page.favourite}>
					{page.favourite ? 'FAV ✓' : 'FAV'}
				</button>
			</form>
		{:else}
			<div class="c"><b>{count(page.counts.series)}</b><span>SERIES</span></div>
			<div class="c"><b>{count(page.counts.read)}</b><span>READ</span></div>
			<div class="c"><b>{count(page.counts.favourite)}</b><span>FAVOURITE</span></div>
		{/if}
	</div>

	{#if page.members.length > 0}
		<div class="members">
			<div class="m-label">ARTISTS</div>
			<div class="m-chips">
				{#each page.members as m (m.value)}
					<!-- eslint-disable-next-line svelte/no-navigation-without-resolve -- tagHref() resolves -->
					<a class="chip" href={tagHref(`artist:${m.value}`)}>{m.value}<span>{m.count}</span></a>
				{/each}
			</div>
		</div>
	{/if}

	{#if page.series.length > 0}
		<div class="label section">
			<span>02 — SERIES</span><span>{page.series.length} · BY RECENT</span>
		</div>
		<div class="strip">
			{#each page.series as s (s.id)}
				<!-- eslint-disable-next-line svelte/no-navigation-without-resolve -- seriesHref() resolves -->
				<a class="strip-tile" href={seriesHref(s.id, `tag:${tagKey}`)}>
					<Cover src={coverSrc(s.id, s.cover)} hue={hueFor(s.title)}>
						{#if s.favourite}<Badge tone="accent" corner="top-right">FAV</Badge>{/if}
						<Badge corner="bottom-left">{s.books} BOOKS</Badge>
					</Cover>
					<span class="s-title">{s.title}</span>
					<span class="s-meta">{s.read} OF {s.books} READ</span>
				</a>
			{/each}
			{#if !phone.current}
				{#each { length: pad(page.series.length, 6) }, i (i)}<span class="filler" aria-hidden="true"
					></span>{/each}
			{/if}
		</div>
	{/if}

	<div class="label section">
		<span
			>{page.series.length > 0 ? '03' : '02'} — {page.person
				? 'BOOKS'
				: 'SERIES'}{#if nFilters}<span class="extra"
					>{` · ${filterWords(filters).join(' · ')}`}</span
				>{/if}</span
		>
		<button type="button" onclick={() => (sort = nextSort[sort])} aria-label="Change sort"
			>{SORT_LABEL[sort]}</button
		>
	</div>
	<div class="bar">
		<div class="tabs" role="tablist" aria-label="Filter">
			{#each [['all', 'ALL'], ['unread', 'UNREAD']] as [key, name] (key)}
				<button
					type="button"
					role="tab"
					aria-selected={filter === key}
					class:on={filter === key}
					onclick={() => (filter = key as Filter)}
					>{name}
					<span class="n"
						>{filter === key && nFilters
							? `${count(shown.length)} OF ${count(onTab.length)}`
							: count(counts[key as Filter])}</span
					></button
				>
			{/each}
			<span class="spacer"></span>
			{#if page.series.length > 0}
				<button
					type="button"
					class="by-series"
					class:on={bySeries}
					aria-pressed={bySeries}
					onclick={() => (bySeries = !bySeries)}>BY SERIES</button
				>
			{/if}
		</div>
		<FilterPanel
			{filters}
			{languages}
			{kinds}
			{reveal}
			title={page.person ? 'BOOKS' : 'SERIES'}
			count={nFilters ? `${count(shown.length)} OF ${count(onTab.length)}` : count(onTab.length)}
			reading={false}
			onchange={(f) => (filters = f)}
		/>
	</div>

	{#if shown.length === 0 && nFilters > 0}
		<div class="empty-result">
			<p class="empty-title">Nothing on this page matches these filters.</p>
			<p class="empty-sub">It holds {count(onTab.length)}.</p>
			<button type="button" class="empty-clear" onclick={() => (filters = NO_FILTERS)}
				>✕ CLEAR · SHOW {count(onTab.length)}</button
			>
		</div>
	{/if}

	<ol class="grid">
		{#each shown as i (i.key)}
			{@const m = meta(i)}
			<li class:unselectable={selecting && i.entryId !== null}>
				<BookTile
					title={i.title}
					src={i.entryId !== null
						? bookCoverSrc(i.entryId, i.coverPage)
						: coverSrc(i.seriesId, i.cover)}
					hue={hueFor(i.title)}
					rating={i.rating}
					favourite={i.favourite}
					meta={m.text}
					metaTone={m.accent ? 'accent' : 'muted'}
					progress={m.progress}
					read={i.read}
					selectable={selecting && i.entryId === null}
					selected={selected.has(i.seriesId) && i.entryId === null}
					onpress={() => open(i)}
				/>
			</li>
		{/each}
		{#each { length: pad(shown.length, cols) }, i (i)}<li
				class="filler"
				aria-hidden="true"
			></li>{/each}
	</ol>
</div>

<style>
	.person {
		display: flex;
		flex-direction: column;
		--title: 30px;
		--count-h: 64px;
		--count-pad: 18px;
		--count-num: 18px;
		--fav-w: 108px;
		--label-w: 120px;
	}
	@media (max-width: 599px) {
		.person {
			--title: 22px;
			--count-h: 56px;
			--count-pad: 12px;
			--count-num: 16px;
			--fav-w: 72px;
			--label-w: 84px;
		}
		.wide-only {
			display: none;
		}
	}
	.label {
		display: flex;
		justify-content: space-between;
		padding: 18px var(--pad) 12px;
		font: var(--type-label);
		color: var(--text-2);
		letter-spacing: var(--tracking-label);
	}
	.label.section {
		padding-top: 24px;
	}
	.label button {
		all: unset;
		cursor: pointer;
	}
	.name {
		margin: 0;
		padding: 0 var(--pad) 18px;
		font: 500 var(--title) / 1.2 var(--font-sans);
	}
	.counts {
		display: flex;
		height: var(--count-h);
		border-top: var(--hairline);
		border-bottom: var(--hairline);
	}
	.c {
		flex: 1;
		min-width: 0;
		display: flex;
		flex-direction: column;
		justify-content: center;
		gap: 4px;
		padding: 0 var(--count-pad);
		border-right: var(--hairline);
	}
	.c b {
		font: 500 var(--count-num) var(--font-mono);
	}
	.c span {
		font: 500 11px var(--font-mono);
		color: var(--text-2);
		letter-spacing: var(--tracking-label);
	}
	.fav-form {
		display: flex;
	}
	.fav {
		width: var(--fav-w);
		border: 0;
		border-radius: 0;
		background: transparent;
		color: var(--text-2);
		font: 500 14px var(--font-mono);
		letter-spacing: 0.04em;
		cursor: pointer;
	}
	.fav.on {
		background: var(--accent);
		color: var(--on-accent);
	}
	.members {
		display: flex;
		min-height: 60px;
		border-bottom: var(--hairline);
	}
	.m-label {
		display: flex;
		align-items: center;
		width: var(--label-w);
		flex-shrink: 0;
		padding-left: var(--pad);
		font: 500 12px var(--font-mono);
		letter-spacing: var(--tracking-label);
		color: var(--text-2);
		border-right: var(--hairline);
	}
	.m-chips {
		flex: 1;
		min-width: 0;
		display: flex;
		align-items: center;
		gap: 8px;
		padding: 10px 14px;
		overflow-x: auto;
	}
	.chip {
		height: 36px;
		flex-shrink: 0;
		display: flex;
		align-items: center;
		gap: 10px;
		padding: 0 12px;
		border: 1px solid var(--line-2);
		color: var(--text-1);
		font: 500 14px var(--font-sans);
	}
	.chip span {
		font: 500 12px var(--font-mono);
		color: var(--text-2);
	}
	.strip {
		display: grid;
		grid-template-columns: repeat(6, minmax(0, 1fr));
		gap: 1px;
		background: var(--line-1);
		border-top: var(--hairline);
		border-bottom: var(--hairline);
	}
	@media (max-width: 599px) {
		.strip {
			grid-template-columns: none;
			grid-auto-flow: column;
			grid-auto-columns: 112px;
			overflow-x: auto;
		}
	}
	.strip-tile {
		background: var(--surface-page);
		padding: 10px;
		display: flex;
		flex-direction: column;
		gap: 8px;
		color: var(--text-1);
	}
	.s-title {
		font: var(--type-tile);
		display: -webkit-box;
		-webkit-line-clamp: 2;
		line-clamp: 2;
		-webkit-box-orient: vertical;
		overflow: hidden;
		height: 32px;
	}
	.s-meta {
		height: 14px;
		font: 500 12px var(--font-mono);
		color: var(--text-2);
		white-space: nowrap;
	}
	/* The tabs scroll; FILTER stays pinned at the end, its panel under the bar. */
	.bar {
		position: relative;
		z-index: 5;
		display: flex;
		border-top: var(--hairline);
		border-bottom: var(--hairline);
	}
	.tabs {
		position: relative;
		z-index: 5;
		background: var(--surface-page);
		flex: 1;
		min-width: 0;
		display: flex;
		overflow-x: auto;
		scrollbar-width: none;
	}
	.extra {
		color: var(--text-1);
	}
	.empty-result {
		display: flex;
		flex-direction: column;
		align-items: flex-start;
		gap: 20px;
		padding: 64px var(--pad);
	}
	.empty-title,
	.empty-sub {
		margin: 0;
	}
	.empty-title {
		font: 500 22px/1.3 var(--font-sans);
		text-wrap: pretty;
	}
	.empty-sub {
		font: 400 15px/1.5 var(--font-sans);
		color: var(--text-prose);
	}
	.empty-clear {
		display: flex;
		align-items: center;
		height: 52px;
		padding: 0 24px;
		border: 0;
		border-radius: 0;
		background: var(--accent);
		color: var(--on-accent);
		font: 500 14px var(--font-mono);
		cursor: pointer;
	}
	.tabs button {
		padding: 14px 16px;
		border: 0;
		border-right: var(--hairline);
		border-radius: 0;
		background: transparent;
		color: var(--text-1);
		font: var(--type-control);
		white-space: nowrap;
		cursor: pointer;
	}
	.tabs .n {
		opacity: 0.6;
	}
	.tabs .on {
		background: var(--surface-inverse);
		color: var(--text-inverse);
	}
	.spacer {
		flex: 1;
		border-right: var(--hairline);
	}
	.by-series {
		border-right: 0 !important;
	}
	@media (max-width: 599px) {
		.by-series {
			display: none;
		}
	}
	.grid {
		list-style: none;
		margin: 0;
		padding: 0;
		display: grid;
		grid-template-columns: repeat(6, minmax(0, 1fr));
		gap: 1px;
		background: var(--line-1);
		border-bottom: var(--hairline);
	}
	@media (max-width: 599px) {
		.grid {
			grid-template-columns: repeat(3, minmax(0, 1fr));
		}
	}
	.grid li {
		display: flex;
		min-width: 0;
	}
	.grid li > :global(.tile) {
		flex: 1;
	}
	.filler {
		background: var(--surface-page);
	}
	.unselectable {
		opacity: 0.4;
	}
</style>

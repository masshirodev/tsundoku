<script lang="ts">
	import { tick } from 'svelte';
	import { longpress } from '$lib/actions/longpress';
	import { downloadStatus, type DownloadState } from '$lib/library/downloads';
	import { withLive } from '$lib/downloads-live.svelte';
	import {
		episodeCount,
		episodeLabel,
		episodeMeta,
		episodeNumber,
		episodeRows,
		episodeStatus,
		hasSeasons,
		seasonLabel,
		watchedFraction
	} from '$lib/library/anime';
	import {
		currentEntry,
		formatNumber,
		type SeriesEntry,
		type SeriesPage
	} from '$lib/library/series';
	import { coverPlaceholder } from '$lib/library/cover';
	import { offline } from '$lib/offline.svelte';
	import { resolve } from '$app/paths';
	import { seriesHref } from '$lib/library/links';
	import { tagSearchHref } from '$lib/library/tag-search';
	import type { AroundHead, SeasonsAround } from '$lib/library/seasons-around';

	/**
	 * An anime series' episodes (Index Anime Series, Anime States 1a; doc/ANIME.md):
	 * EntryList's list with episodes for chapters. A row is an episode with its
	 * 16:9 picture, its length and FILLER or RECAP, and the time left on the one
	 * part-watched; seasons are groups, and one watched through folds. A tap
	 * plays any episode, downloaded or not, since it streams; downloading is the
	 * DOWNLOAD row's and SELECT's. Rows are 72px, which is what the handoff draws.
	 */
	let {
		series,
		selecting,
		selected,
		cached,
		onrow,
		onselect,
		onlong,
		downloads = null,
		around = null,
		tagSource = null
	}: {
		series: SeriesPage;
		selecting: boolean;
		selected: Set<number>;
		/** Episode ids cached on the device: ↓. */
		cached: Set<number>;
		onrow: (entry: SeriesEntry) => void;
		onselect: () => void;
		/** A long press on a row: mark it and everything before it watched. */
		onlong?: (entry: SeriesEntry) => void;
		downloads?: Map<number, DownloadState> | null;
		/**
		 * The seasons around it (c358; doc/SERIES.md, "The seasons around it"),
		 * from the relation cache: dim heads above the list for every season
		 * before, NEXT SEASON below it, and the extras folded under one line.
		 * Null draws the list as it was.
		 */
		around?: SeasonsAround | null;
		/** The source FIND searches (c313's `/browse/<source>?q=`); null offers no FIND. */
		tagSource?: { id: string; name: string } | null;
	} = $props();

	/** The extras line unfolded, for this series only: another series' list opens folded. */
	let extrasOpenFor = $state<number | null>(null);
	const extrasOpen = $derived(extrasOpenFor === series.id);

	/**
	 * FIND: this series' own source searched for a season's title (c313's
	 * mechanism, `tagSearchHref` called as it is; no schema, so it is `q=`),
	 * with ← back to this screen.
	 */
	const openLabel = (h: AroundHead) => `${h.label}, in the library: ${h.title}`;
	const findLabel = (h: AroundHead) => `Search ${tagSource?.name ?? 'the source'} for ${h.query}`;

	function findHref(h: AroundHead): string | null {
		if (!tagSource || !h.query) return null;
		return tagSearchHref(
			resolve('/browse/[source]', { source: tagSource.id }),
			[],
			{ namespace: 'title', value: h.query },
			resolve('/series/[id]', { id: String(series.id) })
		);
	}

	let expanded = $state(false);
	const current = $derived(currentEntry(series.entries));
	const rows = $derived(episodeRows(series.entries, { expanded, current }));
	const seasons = $derived(hasSeasons(series.entries));

	// ---- # --------------------------------------------------------------------------------
	let jumping = $state(false);
	let jumpValue = $state('');
	let jumpInput = $state<HTMLInputElement | null>(null);
	let flash = $state<number | null>(null);

	async function openJump() {
		jumping = true;
		jumpValue = '';
		await tick();
		jumpInput?.focus();
	}

	/** An episode by its number: in the season being watched first, since numbers start again each season. */
	async function submitJump(e: SubmitEvent) {
		e.preventDefault();
		jumping = false;
		const n = Number(jumpValue);
		const season = current?.episode?.season ?? null;
		const target =
			series.entries.find(
				(x) => episodeNumber(x) === n && (x.episode?.season ?? null) === season
			) ?? series.entries.find((x) => episodeNumber(x) === n);
		if (!target) return;
		if (!rows.some((r) => r.type === 'episode' && r.entry.id === target.id)) {
			expanded = true;
			await tick();
		}
		document.getElementById(`entry-${target.id}`)?.scrollIntoView({ block: 'start' });
		flash = target.id;
		setTimeout(() => (flash = null), 1200);
	}

	/** DOWNLOADING · 38%: an episode takes minutes, so its share means something (Anime States 1b). */
	function status(e: SeriesEntry, isCurrent: boolean, dl: DownloadState | undefined): string {
		// Offline (Anime States, offline): only what the device keeps plays.
		if (!offline.online && !cached.has(e.id)) return e.readAt !== null ? 'WATCHED' : 'NOT CACHED';
		if (dl?.kind === 'downloading') return `DOWNLOADING · ${Math.round(dl.fraction * 100)}%`;
		return (dl && dl.kind !== 'none' && downloadStatus(dl)) || episodeStatus(e, isCurrent);
	}
</script>

<section class="list" aria-label="Episodes">
	<div class="head">
		{#if jumping}
			<form class="jump" onsubmit={submitJump}>
				<label for="jump-to">GO TO EP.</label>
				<input
					id="jump-to"
					bind:this={jumpInput}
					bind:value={jumpValue}
					inputmode="decimal"
					autocomplete="off"
					onblur={() => (jumping = false)}
					onkeydown={(e) => e.key === 'Escape' && (jumping = false)}
				/>
			</form>
		{:else}
			<div class="title">
				<span>01 — EPISODES</span>
				<span>{episodeCount(series.entries)}</span>
			</div>
			{#if !selecting}
				<button type="button" class="tool" onclick={openJump} aria-label="Go to episode number"
					>#</button
				>
				<button type="button" class="tool" onclick={onselect}>SELECT</button>
			{/if}
		{/if}
	</div>

	{#snippet aroundHead(h: AroundHead)}
		{@const find = h.seriesId === null ? findHref(h) : null}
		<!-- A source page asks the source as it loads: never on a hover (doc/BROWSE.md). -->
		<li class="season around" data-around={h.key || 'next'} data-sveltekit-preload-data="tap">
			<span class="a-what">{[h.label, ...h.facts].join(' · ')}</span>
			{#if h.title}<span class="a-title">{h.title}</span>{/if}
			{#if h.seriesId !== null}
				<!-- eslint-disable-next-line svelte/no-navigation-without-resolve -- seriesHref resolves -->
				<a class="a-go" href={seriesHref(h.seriesId)} aria-label={openLabel(h)}>IN LIBRARY →</a>
			{:else if find}
				<!-- eslint-disable-next-line svelte/no-navigation-without-resolve -- built from resolve() -->
				<a class="a-go" href={find} aria-label={findLabel(h)}>FIND</a>
			{/if}
		</li>
	{/snippet}

	<ol class="rows">
		{#each around?.before ?? [] as h (h.key)}
			{@render aroundHead(h)}
		{/each}
		{#each rows as row (row.type === 'episode' ? row.entry.id : `${row.type}-${row.season}`)}
			{#if row.type === 'fold'}
				<li class="fold">
					<!-- The stripes are a stylesheet picture: the hover tint must not replace them (c488, doc/MOTION.md). -->
					<button type="button" data-picture onclick={() => (expanded = true)}>
						<span>↑ {seasonLabel(row.season, row.from, row.to)}</span>
						<span>{row.count} WATCHED · SHOW</span>
					</button>
				</li>
			{:else if row.type === 'head'}
				<li class="season">
					<span>{seasonLabel(row.season, row.from, row.to)}</span>
					<span class="d">{row.watched ? `${row.watched} WATCHED` : 'NONE WATCHED'}</span>
				</li>
			{:else}
				{@const e = row.entry}
				{@const on = selected.has(e.id)}
				{@const dl = withLive(downloads?.get(e.id))}
				{@const state =
					e.readAt !== null ? 'watched' : row.current && e.lastPosition !== null ? 'progress' : ''}
				<li
					id="entry-{e.id}"
					class="entry {state} {dl ? `dl-${dl.kind}` : ''}"
					class:uncached={!offline.online && !cached.has(e.id)}
					class:selected={selecting && on}
					class:flash={flash === e.id}
				>
					<button
						type="button"
						class="entry-btn"
						aria-label="{selecting ? '' : 'Play '}{episodeLabel(e, seasons)}{e.title
							? `, ${e.title}`
							: ''}"
						aria-pressed={selecting ? on : undefined}
						data-focus-mark="in"
						data-focus-id={`entry-${e.id}`}
						use:longpress={() => !selecting && onlong?.(e)}
						onclick={() => onrow(e)}
					>
						{#if selecting}
							<span class="check" aria-hidden="true"
								><span class="box" class:on>{on ? '✓' : ''}</span></span
							>
						{/if}
						<span class="num">{formatNumber(episodeNumber(e))}</span>
						<span
							class="thumb"
							class:none={!e.episode?.thumb}
							style:background={e.episode?.thumb
								? `center / cover no-repeat url(${e.episode.thumb}), ${coverPlaceholder(series.hue)}`
								: undefined}
						></span>
						<span class="text">
							<span class="t">{e.title || `Episode ${formatNumber(episodeNumber(e))}`}</span>
							<span class="m">{episodeMeta(e)}</span>
							{#if state === 'progress'}
								<span class="bar"><span style:width="{watchedFraction(e) * 100}%"></span></span>
							{:else if dl?.kind === 'downloading'}
								<span class="bar ink"><span style:width="{dl.fraction * 100}%"></span></span>
							{/if}
						</span>
						<span class="status">
							{#if e.originSource}
								<!-- An episode kept from the source the series left (doc/MOVE.md). -->
								<span class="src">{e.originSource.toUpperCase()}</span>
							{:else}
								{status(e, row.current, dl)}
							{/if}
						</span>
						<span class="cache">{cached.has(e.id) ? '↓' : ''}</span>
					</button>
				</li>
			{/if}
		{/each}
		{#if around}
			{@render aroundHead(around.next)}
			{#if around.extras.length}
				<li class="season around extras">
					<button
						type="button"
						class="a-fold"
						aria-expanded={extrasOpen}
						onclick={() => (extrasOpenFor = extrasOpen ? null : series.id)}
						><span class="a-line">{around.extrasLine}</span><span aria-hidden="true"
							>{extrasOpen ? '↑' : '↓'}</span
						></button
					>
				</li>
				{#if extrasOpen}
					{#each around.extras as h (h.key)}
						{@render aroundHead(h)}
					{/each}
				{/if}
			{/if}
		{/if}
	</ol>
</section>

<style>
	.list {
		display: flex;
		flex-direction: column;
		min-width: 0;
	}
	.head {
		position: sticky;
		top: var(--list-top, 0);
		z-index: 3;
		display: flex;
		align-items: stretch;
		height: 52px;
		border-bottom: var(--hairline);
		background: var(--surface-page);
	}
	.title {
		flex: 1;
		min-width: 0;
		display: flex;
		align-items: center;
		gap: 14px;
		padding: 0 var(--pad);
		font: 500 13px var(--font-mono);
		color: var(--text-2);
		letter-spacing: var(--tracking-label);
		white-space: nowrap;
		overflow: hidden;
	}
	.tool {
		display: flex;
		align-items: center;
		padding: 0 20px;
		border: 0;
		border-left: var(--hairline);
		border-radius: 0;
		background: transparent;
		color: var(--text-1);
		font: 500 13px var(--font-mono);
		letter-spacing: 0.04em;
		cursor: pointer;
	}
	.tool:active {
		background: var(--surface-inverse);
		color: var(--text-inverse);
	}
	.jump {
		flex: 1;
		display: flex;
		align-items: center;
		gap: 14px;
		padding: 0 var(--pad);
		font: 500 13px var(--font-mono);
		color: var(--text-2);
	}
	.jump input {
		flex: 1;
		height: 36px;
		border: 1px solid var(--line-2);
		background: transparent;
		color: var(--text-1);
		font: 500 15px var(--font-mono);
		padding: 0 10px;
	}
	.rows {
		list-style: none;
		margin: 0;
		padding: 0;
	}
	.fold button,
	.entry-btn {
		width: 100%;
		display: flex;
		align-items: stretch;
		border: 0;
		border-bottom: var(--hairline);
		border-radius: 0;
		background: transparent;
		color: var(--text-1);
		padding: 0;
		text-align: left;
		font: inherit;
		cursor: pointer;
	}
	/* The literals are the handoff's (Index Anime Series): 72px rows, a 96×54 picture. */
	.entry-btn {
		height: 72px;
	}
	.entry {
		scroll-margin-top: calc(var(--list-top, 0px) + 52px);
	}
	.fold button {
		height: 52px;
		align-items: center;
		justify-content: space-between;
		gap: 12px;
		padding: 0 var(--pad);
		font: 500 13px var(--font-mono);
		color: var(--text-2);
		letter-spacing: 0.04em;
		background: repeating-linear-gradient(
			135deg,
			var(--surface-panel) 0 6px,
			var(--surface-page) 6px 12px
		);
	}
	.season {
		height: 44px;
		box-sizing: border-box;
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 12px;
		padding: 0 var(--pad);
		border-bottom: var(--hairline);
		background: var(--surface-panel);
		font: 500 12px var(--font-mono);
		letter-spacing: 0.06em;
	}
	.season .d {
		color: var(--text-2);
	}
	/* The seasons around it (c358): the season head's own row, dimmer, never
	   louder than a head of the series' own. */
	.season.around {
		justify-content: flex-start;
		padding-right: 0;
		background: transparent;
		color: var(--text-2);
	}
	.a-what {
		flex-shrink: 0;
		white-space: nowrap;
	}
	.a-title {
		flex: 1;
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		color: var(--text-2);
	}
	.a-go,
	.a-fold {
		align-self: stretch;
		display: flex;
		align-items: center;
		gap: 8px;
		margin-left: auto;
		padding: 0 var(--pad);
		border: 0;
		border-left: var(--hairline);
		border-radius: 0;
		background: transparent;
		color: var(--text-2);
		font: inherit;
		letter-spacing: inherit;
		text-decoration: none;
		white-space: nowrap;
		cursor: pointer;
	}
	.season.around.extras {
		padding: 0;
	}
	.a-fold {
		flex: 1;
		min-width: 0;
		justify-content: space-between;
		margin-left: 0;
		border-left: 0;
	}
	.a-line {
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
	}
	.a-go:active,
	.a-fold:active {
		background: var(--surface-inverse);
		color: var(--text-inverse);
	}
	.entry.progress .entry-btn {
		background: var(--surface-panel);
	}
	/* Offline: an episode the device doesn't keep dims, as a chapter it can't open does. */
	.entry.uncached .entry-btn {
		opacity: 0.4;
	}
	.entry.selected .entry-btn {
		background: var(--accent-select);
	}
	.entry.flash .entry-btn {
		box-shadow: inset 3px 0 0 var(--accent);
	}
	.check {
		width: 60px;
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
	.num {
		width: 64px;
		flex-shrink: 0;
		box-sizing: border-box;
		padding-left: var(--pad);
		display: flex;
		align-items: center;
		overflow: hidden;
		white-space: nowrap;
		font: 500 14px var(--font-mono);
		color: var(--text-2);
	}
	.list:has(.check) .num {
		padding-left: 0;
	}
	.thumb {
		width: 96px;
		height: 54px;
		align-self: center;
		flex-shrink: 0;
		margin-right: 16px;
		box-sizing: border-box;
	}
	.thumb.none {
		border: var(--hairline);
	}
	.text {
		flex: 1;
		min-width: 0;
		display: flex;
		flex-direction: column;
		justify-content: center;
		gap: 5px;
		padding-right: 12px;
	}
	.t {
		font: 400 16px var(--font-sans);
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}
	.entry.watched .t,
	.entry.dl-queued .t,
	.entry.dl-downloading .t {
		color: var(--text-2);
	}
	.entry.progress .t {
		font-weight: 500;
	}
	.m {
		font: 400 12px var(--font-mono);
		color: var(--text-2);
		letter-spacing: 0.02em;
	}
	.bar {
		height: 2px;
		background: var(--line-1);
	}
	.bar > span {
		display: block;
		height: 2px;
		background: var(--accent);
	}
	.bar.ink > span {
		background: var(--text-1);
	}
	.status {
		display: flex;
		align-items: center;
		padding: 0 10px;
		font: 500 13px var(--font-mono);
		color: var(--text-2);
		white-space: nowrap;
	}
	.entry.progress .status {
		color: var(--accent);
	}
	/* An episode kept from the source the series left (doc/MOVE.md). */
	.src {
		display: inline-flex;
		align-items: center;
		height: 22px;
		max-width: 160px;
		padding: 0 7px;
		overflow: hidden;
		border: 1px solid var(--line-2);
		color: var(--text-2);
		font: 500 11px var(--font-mono);
		letter-spacing: 0.06em;
		text-overflow: ellipsis;
	}
	.entry.dl-queued .status,
	.entry.dl-downloading .status,
	.entry.dl-failed .status {
		color: var(--text-1);
	}
	.entry.dl-failed .entry-btn {
		box-shadow: inset 3px 0 0 var(--text-1);
	}
	.cache {
		width: 40px;
		flex-shrink: 0;
		display: flex;
		align-items: center;
		justify-content: center;
		font: 500 14px var(--font-mono);
		color: var(--text-2);
	}
	/* A phone keeps the number, the title and the status; the picture is the first to go. */
	@media (max-width: 599px) {
		.thumb {
			display: none;
		}
		.num {
			width: 52px;
		}
	}
	/* ---- the TV (c238; TV-Series) ----------------------------------------- */
	@media (pointer: none) and (min-width: 900px) {
		.list {
			border: var(--hairline);
		}
		.head {
			height: 36px;
		}
		.title,
		.tool {
			font: var(--type-label);
		}
		/* The handoff's rows are 56 at TV size, not the tablet's 72. */
		.entry-btn {
			height: 56px;
		}
		.t {
			font-size: 17px;
		}
		.status {
			font: var(--type-meta);
		}
		.fold button {
			height: 56px;
		}
	}
</style>

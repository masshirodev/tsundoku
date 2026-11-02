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
		downloads = null
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
	} = $props();

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

	<ol class="rows">
		{#each rows as row (row.type === 'episode' ? row.entry.id : `${row.type}-${row.season}`)}
			{#if row.type === 'fold'}
				<li class="fold">
					<button type="button" onclick={() => (expanded = true)}>
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
						<span class="status">{status(e, row.current, dl)}</span>
						<span class="cache">{cached.has(e.id) ? '↓' : ''}</span>
					</button>
				</li>
			{/if}
		{/each}
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
</style>

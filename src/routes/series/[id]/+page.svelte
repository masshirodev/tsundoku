<script lang="ts">
	import { enhance } from '$app/forms';
	import { SvelteSet } from 'svelte/reactivity';
	import { browser } from '$app/environment';
	import SeriesPanel from './SeriesPanel.svelte';
	import EntryList from './EntryList.svelte';
	import PageGrid from './PageGrid.svelte';
	import EditSheet from './EditSheet.svelte';
	import { offline } from '$lib/offline.svelte';
	import { bulkCounts, continueAction, rangeBetween, type SeriesEntry } from '$lib/library/series';

	let { data, form } = $props();

	const series = $derived(data.series);
	const doujin = $derived(series.kind === 'doujin');
	const action = $derived(continueAction(series));

	// ---- compact top bar ---------------------------------------------------------
	// Once CONTINUE has scrolled away, the top bar carries the title and a ▶ cell.

	let cta = $state<HTMLElement | null>(null);
	let ctaVisible = $state(true);
	$effect(() => {
		if (!cta) return;
		const io = new IntersectionObserver(([e]) => (ctaVisible = e.isIntersecting), {
			rootMargin: '-80px 0px 0px 0px'
		});
		io.observe(cta);
		return () => io.disconnect();
	});

	// ---- selection -------------------------------------------------------------------

	let selecting = $state(false);
	const selected = new SvelteSet<number>();
	let anchor = $state<number | null>(null);
	let rangeArmed = $state(false);

	function onrow(e: SeriesEntry) {
		if (!selecting) return;
		if (rangeArmed && anchor !== null) {
			for (const id of rangeBetween(series.entries, anchor, e.id)) selected.add(id);
			rangeArmed = false;
		} else if (selected.has(e.id)) {
			selected.delete(e.id);
		} else {
			selected.add(e.id);
		}
		anchor = e.id;
	}

	function stopSelecting() {
		selecting = false;
		rangeArmed = false;
		anchor = null;
		selected.clear();
	}

	const counts = $derived(bulkCounts(series.entries, selected));

	// ---- sort, remembered per series on this device --------------------------------

	let descending = $state(false);
	const sortKey = $derived(`tsundoku:series-sort:${series.id}`);
	$effect(() => {
		try {
			descending = browser && localStorage.getItem(sortKey) === 'desc';
		} catch {
			descending = false;
		}
	});
	function setDescending(v: boolean) {
		descending = v;
		try {
			if (v) localStorage.setItem(sortKey, 'desc');
			else localStorage.removeItem(sortKey);
		} catch {
			// Storage unavailable: the flip still holds for this visit.
		}
	}

	// ---- device cache ------------------------------------------------------------------
	// Which entries are cached on this device. The reader is what will fill the
	// cache; until it exists this is honestly empty.
	const cachedEntries = $derived(new Set<number>());
	const cachedCount = $derived(offline.cached[series.id] ?? 0);

	// `?edit=tags` (the library sheet's TAGS button) opens straight into editing.
	// svelte-ignore state_referenced_locally
	let editing = $state(data.editing);
</script>

<svelte:head><title>{series.title} · tsundoku</title></svelte:head>

<div class="series" class:selecting>
	{#if selecting}
		<header class="bar inverse" aria-label="Selection">
			<button type="button" class="cell x" aria-label="Stop selecting" onclick={stopSelecting}
				>✕</button
			>
			<div class="mid count" aria-live="polite">
				{selected.size} SELECTED{rangeArmed ? ' · TAP THE OTHER END' : ''}
			</div>
			<button
				type="button"
				class="cell"
				class:armed={rangeArmed}
				aria-pressed={rangeArmed}
				disabled={anchor === null}
				onclick={() => (rangeArmed = !rangeArmed)}>RANGE</button
			>
			<button
				type="button"
				class="cell"
				onclick={() =>
					series.entries.filter((e) => e.readAt === null).forEach((e) => selected.add(e.id))}
				>ALL UNREAD</button
			>
		</header>
	{:else}
		<header class="bar" class:compact={!ctaVisible} aria-label="Series">
			<!-- eslint-disable-next-line svelte/no-navigation-without-resolve -- data.back.href is a library URL built on the server -->
			<a class="cell back" href={data.back.href}>
				<span class="arrow">←</span>
				<span class="back-label">{data.back.label.toUpperCase()}</span>
			</a>
			<div class="mid title">{series.title}</div>
			<button type="button" class="cell go" disabled>▶ {action.short || action.label}</button>
		</header>
	{/if}

	<div class="body">
		{#if !selecting}
			<div class="panel-col">
				<SeriesPanel
					{series}
					shelves={data.shelves}
					cached={cachedCount}
					bind:cta
					onedit={() => (editing = true)}
				/>
			</div>
		{/if}
		<div class="list-col">
			{#if doujin}
				<PageGrid {series} />
			{:else}
				<EntryList
					{series}
					{selecting}
					{selected}
					cached={cachedEntries}
					bind:descending={() => descending, setDescending}
					{onrow}
					onselect={() => (selecting = true)}
				/>
			{/if}
		</div>
	</div>

	{#if selecting}
		<form
			method="POST"
			action="?/mark"
			use:enhance={() =>
				async ({ update }) =>
					update({ reset: false })}
			class="bulk"
		>
			{#each [...selected] as id (id)}<input type="hidden" name="entry" value={id} />{/each}
			<button type="submit" name="read" value="1" disabled={counts.markRead === 0}>
				<span>MARK READ</span><span class="n">{counts.markRead}</span>
			</button>
			<button type="submit" name="read" value="0" disabled={counts.markUnread === 0}>
				<span>MARK UNREAD</span><span class="n">{counts.markUnread}</span>
			</button>
			<!-- Device caching arrives with the reader; see doc/SERIES.md. -->
			<button type="button" disabled><span>↓ CACHE</span><span class="n">—</span></button>
			<button type="button" disabled><span>REMOVE CACHE</span><span class="n">—</span></button>
		</form>
	{/if}
</div>

<EditSheet
	open={editing}
	{series}
	shelves={data.shelves}
	tagMessage={form && 'tagMessage' in form ? form.tagMessage : undefined}
	onclose={() => (editing = false)}
/>

<style>
	.series {
		display: flex;
		flex-direction: column;
		flex: 1;
		--list-top: var(--header-h);
	}
	.series.selecting {
		padding-bottom: 76px;
	}

	/* ---- top bar ---- */
	.bar {
		position: sticky;
		top: 0;
		z-index: 5;
		flex-shrink: 0;
		display: flex;
		align-items: stretch;
		height: var(--header-h);
		border-bottom: var(--hairline);
		background: var(--surface-page);
	}
	.bar.inverse {
		background: var(--surface-inverse);
		color: var(--text-inverse);
		border-bottom: 0;
	}
	.cell {
		display: flex;
		align-items: center;
		gap: 14px;
		padding: 0 var(--pad);
		border: 0;
		border-radius: 0;
		background: transparent;
		color: inherit;
		font: 500 14px var(--font-mono);
		letter-spacing: 0.04em;
		white-space: nowrap;
		cursor: pointer;
	}
	.cell:disabled {
		cursor: default;
	}
	.bar:not(.inverse) .cell.back {
		border-right: var(--hairline);
		color: var(--text-1);
	}
	.inverse .cell {
		border-left: 1px solid var(--text-2);
	}
	.inverse .cell.x {
		border-left: 0;
		border-right: 1px solid var(--text-2);
		font: 500 18px var(--font-mono);
	}
	.inverse .cell:disabled {
		opacity: 0.4;
	}
	.cell.armed {
		background: var(--accent);
		color: var(--on-accent);
	}
	.arrow {
		font-size: 17px;
	}
	.mid {
		flex: 1;
		min-width: 0;
		display: flex;
		align-items: center;
		padding: 0 18px;
	}
	.count {
		font: 500 17px var(--font-mono);
	}
	.title {
		font: 500 17px var(--font-sans);
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
		visibility: hidden;
	}
	.go {
		display: none;
		background: var(--accent);
		color: var(--on-accent);
	}
	/* Compact: CONTINUE has scrolled away, so the bar carries title and ▶. */
	.bar.compact .title {
		visibility: visible;
	}
	.bar.compact .go {
		display: flex;
	}
	.bar.compact .back-label {
		display: none;
	}
	@media (max-width: 599px) {
		.back-label {
			font-size: 13px;
		}
	}

	/* ---- frame: header above the list in portrait, a panel beside it in landscape ---- */
	.body {
		display: flex;
		flex-direction: column;
		flex: 1;
		min-height: 0;
	}
	.list-col {
		min-width: 0;
	}
	@media (min-width: 1024px) {
		.series {
			--list-top: 0px;
		}
		.body {
			flex-direction: row;
			height: calc(100dvh - var(--header-h) - var(--banner-h, 0px));
			flex: none;
		}
		.panel-col {
			flex-shrink: 0;
			width: 440px;
			overflow-y: auto;
			border-right: var(--hairline);
		}
		.list-col {
			flex: 1;
			overflow-y: auto;
			--rail-h: calc(100dvh - var(--header-h) - var(--banner-h, 0px) - 52px);
		}
	}

	/* ---- bulk bar ---- */
	.bulk {
		position: fixed;
		left: var(--sheet-left, 0);
		right: 0;
		bottom: 0;
		z-index: 10;
		display: flex;
		height: 76px;
		border-top: var(--rule-strong);
		background: var(--surface-page);
		padding-bottom: env(safe-area-inset-bottom);
	}
	.bulk button {
		flex: 1;
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		gap: 5px;
		border: 0;
		border-right: var(--hairline);
		border-radius: 0;
		background: transparent;
		color: var(--text-1);
		font: 500 14px var(--font-mono);
		letter-spacing: 0.04em;
		cursor: pointer;
	}
	.bulk button:last-child {
		border-right: 0;
	}
	.bulk button:disabled {
		opacity: 0.4;
		cursor: default;
	}
	.bulk button:active:not(:disabled) {
		background: var(--surface-inverse);
		color: var(--text-inverse);
	}
	.bulk .n {
		font: 400 12px var(--font-mono);
		color: var(--text-2);
	}
	@media (max-width: 599px) {
		.bulk button {
			font-size: 12px;
		}
	}
</style>

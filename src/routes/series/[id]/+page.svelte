<script lang="ts">
	import ConfirmSheet from '$lib/components/chrome/ConfirmSheet.svelte';
	import { stepsBackTo } from '$lib/back';
	import type { ActionResult } from '@sveltejs/kit';
	import { backLink } from '$lib/back';
	import { enhance } from '$app/forms';
	import { SvelteSet } from 'svelte/reactivity';
	import { tick } from 'svelte';
	import { browser } from '$app/environment';
	import SeriesPanel from './SeriesPanel.svelte';
	import EntryList from './EntryList.svelte';
	import PageGrid from './PageGrid.svelte';
	import EditSheet from './EditSheet.svelte';
	import BookGrid from './BookGrid.svelte';
	import BookSheet from './BookSheet.svelte';
	import GroupSheet from '../../GroupSheet.svelte';
	import Band from '$lib/components/chrome/Band.svelte';
	import NavLine from '$lib/components/waiting/NavLine.svelte';
	import { goto, invalidateAll } from '$app/navigation';
	import { page } from '$app/state';
	import { offline } from '$lib/offline.svelte';
	import { cacheMany, dropMany } from '$lib/cache/device';
	import { orderBooks } from '$lib/library/books';
	import { withParam, readHref } from '$lib/library/links';
	import {
		bulkCounts,
		continueAction,
		fileMeta,
		isBookSeries,
		rangeBetween,
		type SeriesEntry
	} from '$lib/library/series';

	let { data, form } = $props();
	const refusal = $derived(
		form && 'message' in form && typeof form.message === 'string' ? form.message.toUpperCase() : ''
	);

	const series = $derived(data.series);
	const doujin = $derived(series.kind === 'doujin');
	const books = $derived(isBookSeries(series));

	// ---- series of books ---------------------------------------------------------------

	/**
	 * The book whose sheet is open (long-press), by id: the sheet reads the
	 * entry from the current data, so a rating or FAV it saves shows at once.
	 */
	let sheetBookId = $state<number | null>(null);
	/** The book whose tags are being edited (TAGS on its sheet), by id so it follows the data. */
	let tagsBookId = $state<number | null>(null);
	const tagsBook = $derived(
		tagsBookId === null ? null : (series.entries.find((e) => e.id === tagsBookId) ?? null)
	);
	const sheetBook = $derived(series.entries.find((e) => e.id === sheetBookId) ?? null);
	let reordering = $state(false);
	let order = $state<number[]>([]);
	let reviewing = $state(false);

	function startOrder() {
		order = series.entries.map((e) => e.id);
		reordering = true;
	}

	function orderBy(mode: 'date' | 'title') {
		const byId = new Map(series.entries.map((e) => [e.id, e]));
		order = orderBooks(
			order
				.map((id) => byId.get(id)!)
				.map((e) => ({ id: e.id, title: e.title, addedAt: e.addedAt })),
			mode
		).map((e) => e.id);
	}

	/** A book of this series opened on its own: its page grid. */
	function openBook(e: SeriesEntry) {
		sheetBookId = null;
		// eslint-disable-next-line svelte/no-navigation-without-resolve -- withParam() keeps the current, resolved path
		void goto(withParam(page.url, 'book', String(e.id)));
	}

	/** "SERIES CREATED · 6 BOOKS", from the grouping sheet's redirect. */
	const created = $derived(Number(page.url.searchParams.get('created')) || 0);
	const added = $derived(page.url.searchParams.get('added'));
	// Grouped novels are counted by the volume (doc/BOOKS.md).
	const unit = $derived(page.url.searchParams.get('unit') === 'volumes' ? 'VOLUMES' : 'BOOKS');
	const createdOrder = $derived(page.url.searchParams.get('order') ?? 'BY DATE ADDED');
	const takenOut = $derived(form && 'takenOut' in form ? form.takenOut : null);
	const markedThrough = $derived(form && 'markedThrough' in form ? form.markedThrough : null);

	// A long press on a chapter row: it and everything before it, read. The
	// band that follows offers UNDO for exactly the chapters that changed.
	let throughForm = $state<HTMLFormElement | null>(null);
	let throughId = $state(0);
	async function markThrough(e: SeriesEntry) {
		throughId = e.id;
		await tick();
		throughForm?.requestSubmit();
	}
	const dismissedKey = $derived(form && 'dismissed' in form ? form.dismissed : null);
	const action = $derived(continueAction(series));

	// ---- deleting ------------------------------------------------------------------
	let deletingSeries = $state(false);
	let deletingBook = $state<SeriesEntry | null>(null);
	/**
	 * A deleted series has no page to stay on: back where it was opened from,
	 * the way ← goes (src/lib/back.ts), so the shelf comes back as it was.
	 */
	async function leaveDeleted(r: ActionResult) {
		if (r.type !== 'success') return;
		deletingSeries = false;
		const steps = stepsBackTo(new URL(data.back.href, location.href));

		if (steps) history.go(-steps);
		else await goto(data.back.href, { replaceState: true });
	}

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
		// A tap on a chapter reads it; while selecting, it selects.
		// eslint-disable-next-line svelte/no-navigation-without-resolve -- readHref() resolves
		if (!selecting) return void goto(readHref(e.id));
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
	// Which entries are cached on this device (doc/OFFLINE.md): the reader keeps
	// the next chapters, and ↓ CACHE adds the selection. A hidden series is never
	// cached, nor anything while revealed or incognito.
	const cachedEntries = $derived(new Set(offline.entries[series.id] ?? []));
	const cachedCount = $derived(offline.cached[series.id] ?? 0);
	const mayCache = $derived(!series.hidden && !data.reveal && !data.incognito && offline.online);
	const toCache = $derived(
		mayCache
			? series.entries
					.filter((e) => selected.has(e.id) && e.available && !cachedEntries.has(e.id))
					.map((e) => e.id)
			: []
	);
	const toDrop = $derived([...selected].filter((id) => cachedEntries.has(id)));
	let caching = $state(false);
	async function cacheSelection() {
		caching = true;
		try {
			await cacheMany(series.id, toCache);
		} finally {
			caching = false;
		}
	}

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
	{:else if reordering}
		<form
			method="POST"
			action="?/reorder"
			use:enhance={() =>
				async ({ update }) => {
					await update();
					reordering = false;
				}}
			class="bar inverse"
			aria-label="Reorder"
		>
			<button
				type="button"
				class="cell x"
				aria-label="Cancel reordering"
				onclick={() => (reordering = false)}>✕</button
			>
			<div class="mid count">
				<span class="long">REORDER · {series.entries.length}</span><span class="short">REORDER</span
				>
			</div>
			<button type="button" class="cell" onclick={() => orderBy('date')}>BY DATE</button>
			<button type="button" class="cell" onclick={() => orderBy('title')}>BY TITLE</button>
			{#each order as id (id)}<input type="hidden" name="entry" value={id} />{/each}
			<button type="submit" class="cell done">DONE</button>
		</form>
	{:else if data.book}
		<header class="bar" aria-label="Book">
			<!-- eslint-disable-next-line svelte/no-navigation-without-resolve -- withParam() keeps the current, resolved path -->
			<a class="cell back" href={withParam(page.url, 'book', null)}>
				<span class="arrow">←</span>
				<span class="back-label">{series.title.toUpperCase()}</span>
			</a>
			<div class="mid title shown">{data.book.title}</div>
		</header>
	{:else}
		<header class="bar" class:compact={!ctaVisible} aria-label="Series">
			<!-- eslint-disable-next-line svelte/no-navigation-without-resolve -- data.back.href is a library URL built on the server -->
			<a class="cell back" href={data.back.href} use:backLink>
				<span class="arrow">←</span>
				<span class="back-label">{data.back.label.toUpperCase()}</span>
			</a>
			<div class="mid title">{series.title}</div>
			<!-- eslint-disable-next-line svelte/no-navigation-without-resolve -- readHref() resolves -->
			<a class="cell go" href={action.entry ? readHref(action.entry.id) : undefined}
				>▶ {action.short || action.label}</a
			>
			<NavLine />
		</header>
	{/if}

	<form method="POST" action="?/markThrough" use:enhance bind:this={throughForm} hidden>
		<input type="hidden" name="through" value={throughId} />
	</form>

	<!-- An action refused (a move, a take-out, a delete): it says why, never silently. -->
	{#if refusal}
		<Band title={refusal} detail="NOTHING CHANGED" />
	{/if}

	{#if markedThrough}
		<Band
			title={markedThrough.ids.length === 0
				? `NOTHING TO MARK · ALL READ THROUGH ${markedThrough.label.toUpperCase()}`
				: `MARKED READ THROUGH ${markedThrough.label.toUpperCase()}`}
			detail={markedThrough.ids.length === 0
				? undefined
				: `${markedThrough.ids.length} CHAPTER${markedThrough.ids.length === 1 ? '' : 'S'}`}
		>
			{#snippet action()}
				{#if markedThrough.ids.length > 0}
					<form method="POST" action="?/mark" use:enhance>
						{#each markedThrough.ids as id (id)}<input
								type="hidden"
								name="entry"
								value={id}
							/>{/each}
						<button type="submit" name="read" value="0">UNDO</button>
					</form>
				{/if}
			{/snippet}
		</Band>
	{:else if takenOut}
		<Band
			title="TAKEN OUT · {takenOut.title?.toUpperCase()}"
			detail="A SINGLE BOOK AGAIN · KEEPS ITS RATING, FAV, TAGS AND PAGE"
		>
			{#snippet action()}
				<form method="POST" action="?/undoTakeOut" use:enhance>
					<input type="hidden" name="single" value={takenOut.single} />
					<input type="hidden" name="position" value={takenOut.position} />
					<button type="submit">UNDO</button>
				</form>
			{/snippet}
		</Band>
	{:else if created > 0 && !reordering}
		<Band
			title={added ? `${created} ${unit} ADDED` : `SERIES CREATED · ${created} ${unit}`}
			detail={added ? 'AT THE END · ORDER TO CHANGE' : `ORDERED ${createdOrder} · ORDER TO CHANGE`}
		>
			{#snippet action()}
				<form method="POST" action={added ? '?/undoAdd' : '?/ungroup'}>
					{#each (added ?? '').split(',').filter(Boolean) as id (id)}<input
							type="hidden"
							name="entry"
							value={id}
						/>{/each}
					<button type="submit">UNDO</button>
				</form>
			{/snippet}
		</Band>
	{/if}

	<div class="body">
		{#if !selecting && !reordering && !data.book}
			<div class="panel-col">
				<SeriesPanel
					{series}
					shelves={data.shelves}
					cached={cachedCount}
					bind:cta
					onedit={() => (editing = true)}
					ondelete={() => (deletingSeries = true)}
					suggestion={data.suggestion}
					{dismissedKey}
					onreview={() => (reviewing = true)}
					ocr={data.ocr}
					twin={data.twin}
					words={data.words}
					editions={data.editions}
					link={data.link}
					tracking={data.tracking}
				/>
			</div>
		{/if}
		<div class="list-col">
			{#if data.book}
				<PageGrid {series} book={data.book} cover={data.cover} />
			{:else if books}
				<BookGrid
					{series}
					{reordering}
					bind:order
					onbook={openBook}
					onlong={(e) => (sheetBookId = e.id)}
					onorder={startOrder}
				/>
			{:else if doujin}
				<PageGrid {series} cover={data.cover} editions={data.editions} />
			{:else}
				<EntryList
					{series}
					{selecting}
					{selected}
					cached={cachedEntries}
					bind:descending={() => descending, setDescending}
					{onrow}
					onselect={() => (selecting = true)}
					onlong={markThrough}
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
			<!-- The device cache (doc/OFFLINE.md): counts are what each would change. -->
			<button type="button" disabled={toCache.length === 0 || caching} onclick={cacheSelection}>
				<span>{caching ? '↓ CACHING…' : '↓ CACHE'}</span><span class="n">{toCache.length}</span>
			</button>
			<button type="button" disabled={toDrop.length === 0} onclick={() => dropMany(toDrop)}>
				<span>REMOVE CACHE</span><span class="n">{toDrop.length}</span>
			</button>
		</form>
	{/if}
</div>

<BookSheet
	{series}
	book={sheetBook}
	others={data.otherSeries}
	onclose={() => (sheetBookId = null)}
	onpages={openBook}
	ondelete={(b) => {
		sheetBookId = null;
		deletingBook = b;
	}}
	ontags={(b) => {
		sheetBookId = null;
		tagsBookId = b.id;
	}}
/>

<!-- Deleting asks first (doc/DELETING.md). -->
<ConfirmSheet
	open={deletingSeries}
	title="DELETE {series.title.toUpperCase()}?"
	lines={[
		`${series.entries.length} ${series.entries.length === 1 ? 'ENTRY' : 'ENTRIES'} · ${fileMeta(series.entries)}`,
		'ITS FILES MOVE TO THE TRASH FOLDER ON THE WORKSTATION.',
		'ITS READING HISTORY GOES WITH IT.',
		'A SCAN OR A SYNC WON’T BRING IT BACK.'
	]}
	confirm="DELETE"
	action="?/delete"
	fields={{}}
	onclose={() => (deletingSeries = false)}
	ondone={leaveDeleted}
/>
<ConfirmSheet
	open={deletingBook !== null}
	title="DELETE {(deletingBook?.title || 'THIS BOOK').toUpperCase()}?"
	lines={[
		`FROM ${series.title.toUpperCase()} · ${deletingBook ? fileMeta([deletingBook]) : ''}`,
		'ITS FILES MOVE TO THE TRASH FOLDER ON THE WORKSTATION.',
		'THE SERIES KEEPS ITS OTHER BOOKS.',
		'A SCAN OR A SYNC WON’T BRING IT BACK.'
	]}
	confirm="DELETE BOOK"
	action="?/deleteBook"
	fields={{ entry: String(deletingBook?.id ?? '') }}
	onclose={() => (deletingBook = null)}
	ondone={async (r) => {
		deletingBook = null;
		if (r.type === 'redirect') await goto(r.location);
		else await invalidateAll();
	}}
/>

{#if data.suggestion}
	<GroupSheet
		open={reviewing}
		suggested
		books={data.suggestion.books}
		existing={data.otherSeries}
		onclose={() => (reviewing = false)}
	/>
{/if}

<EditSheet
	open={editing}
	{series}
	shelves={data.shelves}
	tagMessage={form && 'tagMessage' in form ? form.tagMessage : undefined}
	onclose={() => (editing = false)}
/>
<!-- A book's own tags (doc/BOOKS.md): the same sheet, the book's tags only. -->
<EditSheet
	open={tagsBook !== null}
	{series}
	shelves={data.shelves}
	book={tagsBook}
	tagMessage={form && 'tagMessage' in form ? form.tagMessage : undefined}
	onclose={() => (tagsBookId = null)}
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
	.cell.done {
		background: var(--accent);
		color: var(--on-accent);
	}
	.mid .short {
		display: none;
	}
	@media (max-width: 599px) {
		.mid .long {
			display: none;
		}
		.mid .short {
			display: inline;
		}
	}
	.title.shown {
		visibility: visible;
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
		text-decoration: none;
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

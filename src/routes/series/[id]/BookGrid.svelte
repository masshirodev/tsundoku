<script lang="ts">
	import { bookCoverSrc } from '$lib/library/links';
	import BookTile from '$lib/components/content/BookTile.svelte';
	import { hueFor } from '$lib/library/cover';
	import { phone, wide } from '$lib/device.svelte';
	import { bookNumber, moveItem } from '$lib/library/books';
	import {
		addedMonth,
		bookMeta,
		booksCount,
		booksOf,
		currentEntry,
		extrasOf,
		type SeriesEntry,
		type SeriesPage
	} from '$lib/library/series';
	import ExtrasList from './ExtrasList.svelte';

	/**
	 * A series of books: BOOKS replaces CHAPTERS as a cover grid in the user's
	 * order. Tap opens the book's pages; long-press opens
	 * its sheet. In `reordering` the tiles show only their date added, and a
	 * cover is dragged -- or moved with the arrow keys when focused -- to set the
	 * reading order, held in `order` until DONE saves it.
	 */
	let {
		series,
		reordering = false,
		order = $bindable<number[]>([]),
		onbook,
		onlong,
		onorder
	}: {
		series: SeriesPage;
		reordering?: boolean;
		/** Entry ids in the order being edited, while reordering. */
		order?: number[];
		onbook: (entry: SeriesEntry) => void;
		onlong: (entry: SeriesEntry) => void;
		onorder: () => void;
	} = $props();

	const current = $derived(currentEntry(series.entries));
	/** The books alone: a hand-made extra is drawn apart, and is never numbered. */
	const books = $derived(booksOf(series.entries));
	const extras = $derived(extrasOf(series.entries));
	const byId = $derived(new Map(books.map((e) => [e.id, e])));
	const shown = $derived(
		reordering ? order.map((id) => byId.get(id)).filter((e): e is SeriesEntry => !!e) : books
	);

	// ---- dragging ------------------------------------------------------------------

	let grid = $state<HTMLElement | null>(null);
	let dragId = $state<number | null>(null);
	let dragFrom = $state(0);

	function indexAt(x: number, y: number): number | null {
		const el = document.elementFromPoint(x, y)?.closest<HTMLElement>('[data-index]');
		return el && grid?.contains(el) ? Number(el.dataset.index) : null;
	}

	function down(e: PointerEvent, id: number, i: number) {
		if (!reordering || e.button !== 0) return;
		(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
		dragId = id;
		dragFrom = i;
	}

	function drag(e: PointerEvent) {
		if (dragId === null) return;
		const to = indexAt(e.clientX, e.clientY);
		const from = order.indexOf(dragId);
		if (to !== null && to !== from) order = moveItem(order, from, to);
	}

	function drop() {
		dragId = null;
	}

	function key(e: KeyboardEvent, id: number) {
		if (!reordering) return;
		const from = order.indexOf(id);
		const by =
			e.key === 'ArrowLeft' || e.key === 'ArrowUp'
				? -1
				: e.key === 'ArrowRight' || e.key === 'ArrowDown'
					? 1
					: 0;
		if (by === 0) return;
		e.preventDefault();
		order = moveItem(order, from, from + by);
	}

	// Cosmetic: pad the last row. The column count itself is CSS.
	const cols = $derived(phone.current ? 3 : wide.current ? 6 : 4);
	const fillers = $derived((cols - (shown.length % cols)) % cols);
</script>

<section class="list" aria-label="Books">
	<div class="head">
		<div class="title">
			<span>01 — BOOKS</span>
			<span>{reordering ? `${books.length} · YOUR ORDER` : booksCount(books)}</span>
		</div>
		{#if !reordering}
			<button type="button" class="tool" onclick={onorder}>ORDER</button>
		{/if}
	</div>

	<ol
		class="grid"
		class:reordering
		data-focus-off={reordering ? '' : undefined}
		bind:this={grid}
		onpointermove={drag}
		onpointerup={drop}
		onpointercancel={drop}
	>
		{#each shown as e, i (e.id)}
			{@const m = bookMeta(e, current)}
			<!-- The pointer and key events come from the tile's own button and bubble
			     here; the item only delegates the drag and the arrow-key moves. -->
			<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
			<li
				data-index={i}
				class="cell"
				class:dragging={dragId === e.id}
				onpointerdown={(ev) => down(ev, e.id, i)}
				onkeydown={(ev) => key(ev, e.id)}
			>
				<BookTile
					src={e.available ? bookCoverSrc(e.id, e.coverPage) : null}
					title={e.title || `Book ${i + 1}`}
					hue={hueFor(e.title || series.title)}
					rating={reordering ? 0 : e.rating}
					favourite={!reordering && e.favourite}
					number={bookNumber(i)}
					meta={reordering ? addedMonth(e.addedAt) : m.text}
					metaTone={!reordering && m.state === 'progress' ? 'accent' : 'muted'}
					progress={!reordering ? m.progress : undefined}
					read={!reordering && m.state === 'read'}
					current={!reordering && m.state === 'progress'}
					focusId={`book-${e.id}`}
					moving={dragId === e.id && i !== dragFrom
						? `${bookNumber(dragFrom)} → ${bookNumber(i)}`
						: undefined}
					onpress={() => !reordering && onbook(e)}
					onlongpress={reordering ? undefined : () => onlong(e)}
				/>
			</li>
		{/each}
		{#each { length: fillers }, i (i)}<li class="filler" aria-hidden="true"></li>{/each}
	</ol>

	<!-- The extras, drawn apart: not a book, not numbered, not reordered. -->
	{#if !reordering}<ExtrasList entries={extras} />{/if}

	{#if reordering}
		<div class="foot">
			<span>DRAG A COVER · NUMBERS ARE THE READING ORDER</span>
			<span>CONTINUE FOLLOWS IT</span>
		</div>
	{/if}
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
	.grid {
		list-style: none;
		margin: 0;
		padding: 0;
		display: grid;
		grid-template-columns: repeat(4, minmax(0, 1fr));
		gap: 1px;
		background: var(--line-1);
		border-bottom: var(--hairline);
	}
	/* Landscape and desktop: six covers fit in one row beside the panel. */
	@media (min-width: 1024px) {
		.grid {
			grid-template-columns: repeat(6, minmax(0, 1fr));
		}
	}
	@media (max-width: 599px) {
		.grid {
			grid-template-columns: repeat(3, minmax(0, 1fr));
		}
	}
	.cell {
		display: flex;
		min-width: 0;
	}
	.cell > :global(.tile) {
		flex: 1;
	}
	.reordering .cell {
		touch-action: none;
		cursor: grab;
	}
	.cell.dragging {
		cursor: grabbing;
		z-index: 2;
	}
	.filler {
		background: var(--surface-page);
	}
	.foot {
		display: flex;
		justify-content: space-between;
		gap: 12px;
		padding: 18px var(--pad);
		font: var(--type-label);
		color: var(--text-2);
		letter-spacing: var(--tracking-label);
	}
</style>

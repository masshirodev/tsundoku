<script lang="ts">
	import { coverPlaceholder } from '$lib/library/cover';
	import {
		booksOf,
		entryProgress,
		extrasOf,
		type SeriesEntry,
		type SeriesPage
	} from '$lib/library/series';
	import { pageThumbSrc, readHref } from '$lib/library/links';
	import { resolve } from '$app/paths';
	import { invalidateAll } from '$app/navigation';
	import { longpress } from '$lib/actions/longpress';
	import { offline } from '$lib/offline.svelte';
	import { saves } from '$lib/saves.svelte';
	import Band from '$lib/components/chrome/Band.svelte';
	import PageMenu from '$lib/components/content/PageMenu.svelte';
	import { bandFor, menuRows, type Automatic, type MenuRow } from '$lib/library/cover-menu';
	import type { BookEditions } from '$lib/server/editions';
	import { baseToEdition } from '$lib/library/editions';
	import ExtrasList from './ExtrasList.svelte';

	/**
	 * A doujin reads as a book, so its contents are its pages rather than a
	 * chapter list of one. The page last opened carries the accent ring.
	 *
	 * Each page shows its thumbnail, made on the workstation on first ask
	 * (doc/COVERS.md, "Page thumbnails"), over the striped placeholder while it
	 * loads; only the cells on screen ask. Each page opens the reader there.
	 */
	let {
		series,
		book: only,
		cover,
		editions = null
	}: {
		series: SeriesPage;
		book?: SeriesEntry | null;
		/** The series' chosen cover and what automatic gives: the page menu's rows (c26). */
		cover: {
			chosen: { entry: number; page: number } | null;
			automatic: Automatic;
			files: number[];
		};
		/** A folded book (doc/EDITIONS.md): the grid is the opening edition's pages. */
		editions?: BookEditions | null;
	} = $props();

	const opening = $derived(
		editions && !only ? (editions.editions.find((e) => e.entryId === editions.opens) ?? null) : null
	);
	/**
	 * A one-book doujin shows its book; a book of a series is passed in. A
	 * hand-made extra beside the book is not the book, even when its row sorts
	 * first (c650): the books are what the screen draws. A folded book shows the
	 * edition it opens in, at the book's place in it.
	 */
	const book = $derived.by(() => {
		const b = only ?? booksOf(series.entries)[0];
		if (!b || !opening || opening.base) return b;
		return {
			...b,
			id: opening.entryId,
			pageCount: opening.pages,
			coverPage: null,
			lastPosition:
				b.lastPosition === null ? null : baseToEdition(opening.rows, b.lastPosition).page
		};
	});
	/** Pages only the shown edition has: "29 · EN ONLY". */
	const onlyHere = $derived(new Set(opening?.only ?? []));
	const pages = $derived(book?.pageCount ?? 0);
	const current = $derived(book && book.readAt === null ? (entryProgress(book)?.page ?? 0) : 0);
	const countLabel = $derived(
		!book
			? '0'
			: opening
				? [
						pages,
						opening.code,
						book.readAt !== null ? 'READ' : current > 0 ? `AT P. ${current}` : ''
					]
						.filter(Boolean)
						.join(' · ')
				: book.readAt !== null
					? `${pages} · READ`
					: current > 0
						? `${pages} · LAST OPENED P. ${current}`
						: String(pages)
	);

	// ---- the page menu (Page Menu 1i): long-press a cell ----------------------------------
	let menu = $state<{ page: number; rect: DOMRect } | null>(null);
	type CoverBody = {
		entryId: number;
		book?: number | null;
		series?: { entry: number; page: number } | null;
	};
	let band = $state<{ title: string; detail: string; undo: CoverBody } | null>(null);
	const rows = $derived(
		menu && book
			? menuRows({
					kind: only ? 'book' : 'single',
					entry: book.id,
					page: menu.page,
					book: { coverPage: book.coverPage, hasFile: cover.files.includes(book.id) },
					series: cover,
					labelOf: (id) => series.entries.find((e) => e.id === id)?.label ?? ''
				})
			: []
	);
	async function post(b: CoverBody): Promise<boolean> {
		try {
			const r = await fetch(resolve('/api/covers'), {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify(b)
			});
			return r.ok;
		} catch {
			return false;
		}
	}
	async function choose(row: MenuRow) {
		const m = menu;
		if (!m || !book) return;
		const b: CoverBody = { entryId: book.id };
		const undo: CoverBody = { entryId: book.id };
		if (row.target !== 'series') {
			b.book = row.isThis ? null : m.page;
			undo.book = book.coverPage;
		}
		if (row.target !== 'book') {
			b.series = row.isThis ? null : { entry: book.id, page: m.page };
			undo.series = cover.chosen;
		}
		const text = bandFor(row, m.page, only ? book.title || book.label : series.title);
		menu = null;
		if (await post(b)) {
			band = { ...text, undo };
			await invalidateAll();
		} else
			saves.fail({
				what: `${row.target === 'book' ? 'BOOK COVER' : row.target === 'series' ? 'SERIES COVER' : 'COVER'} NOT SAVED`,
				putBackLabel: 'PUT BACK',
				key: `cover:${book.id}`,
				retry: async () => (await post(b)) && (await invalidateAll(), true),
				putBack: () => undefined
			});
	}
	/**
	 * A hand-made extra beside the book (c650): its pages are not this book's,
	 * so it is listed apart under the grid, where it stays reachable. No
	 * importer writes `matter` on a doujin (doc/BOOKS.md).
	 */
	const extras = $derived(extrasOf(series.entries));

	async function undoBand() {
		const u = band?.undo;
		band = null;
		if (u && (await post(u))) await invalidateAll();
	}
</script>

<section class="list" aria-label="Pages">
	<div class="head">
		<span>01 — PAGES</span>
		<span>{countLabel}</span>
	</div>
	{#if band}
		<Band title={band.title} detail={band.detail}>
			{#snippet action()}
				<button type="button" onclick={undoBand}>UNDO</button>
			{/snippet}
		</Band>
	{/if}
	<ol class="grid">
		{#each { length: pages }, i (i)}
			{@const n = i + 1}
			<li
				class="page"
				class:current={n === current}
				style:background={coverPlaceholder((series.hue + n * 11) % 360)}
				aria-current={n === current ? 'page' : undefined}
				data-cell={i}
			>
				{#if book?.coverPage === i}<span class="is-cover">COVER</span>{/if}
				{#if book?.available}
					<img
						class="thumb"
						src={pageThumbSrc(book, i)}
						alt=""
						loading="lazy"
						decoding="async"
						draggable="false"
					/>
					<!-- eslint-disable svelte/no-navigation-without-resolve -- readHref() resolves -->
					<a
						class="open"
						href={readHref(book.id, n)}
						aria-label="Read from page {n}"
						use:longpress={() => {
							// An edition's page isn't a cover the book can wear (doc/EDITIONS.md).
							if (opening && !opening.base) return;
							const cell = document.querySelector(`[data-cell="${i}"]`);
							if (cell) menu = { page: i, rect: cell.getBoundingClientRect() };
						}}
					></a>
					<!-- eslint-enable svelte/no-navigation-without-resolve -->
				{/if}
				<span class="n" class:only={onlyHere.has(n)}
					>{onlyHere.has(n) ? `${n} · ${opening?.code} ONLY` : n}</span
				>
			</li>
		{/each}
	</ol>
	<ExtrasList entries={extras} />
</section>

{#if menu && book}
	<PageMenu
		page={menu.page}
		{pages}
		rect={menu.rect}
		{rows}
		offline={!offline.online}
		readHref={readHref(book.id, menu.page + 1)}
		onchoose={choose}
		onclose={() => (menu = null)}
	/>
{/if}

<style>
	.open {
		position: absolute;
		inset: 0;
	}
	/* Over the stripes, which show until it arrives. Cut from the top, as a cover is. */
	.thumb {
		position: absolute;
		inset: 0;
		width: 100%;
		height: 100%;
		object-fit: cover;
		object-position: top;
	}
	.list {
		display: flex;
		flex-direction: column;
		min-width: 0;
		--cols: 5;
	}
	@media (min-width: 1024px) {
		.list {
			--cols: 6;
		}
	}
	@media (max-width: 599px) {
		.list {
			--cols: 3;
		}
	}
	.head {
		position: sticky;
		top: var(--list-top, 0);
		z-index: 3;
		display: flex;
		align-items: center;
		gap: 14px;
		height: 52px;
		padding: 0 var(--pad);
		border-bottom: var(--hairline);
		background: var(--surface-page);
		font: 500 13px var(--font-mono);
		color: var(--text-2);
		letter-spacing: var(--tracking-label);
		white-space: nowrap;
	}
	.grid {
		list-style: none;
		margin: 0;
		padding: 0;
		display: grid;
		grid-template-columns: repeat(var(--cols), minmax(0, 1fr));
		gap: 1px;
		background: var(--line-1);
		border-bottom: var(--hairline);
	}
	.page {
		position: relative;
		aspect-ratio: var(--cover-ratio);
	}
	.current {
		box-shadow: inset 0 0 0 3px var(--accent);
	}
	.n {
		position: absolute;
		left: 0;
		bottom: 0;
		padding: 4px 7px;
		background: var(--surface-page);
		color: var(--text-1);
		font: 500 12px var(--font-mono);
	}
	/* The page chosen as the book's cover (Page Menu 1i). */
	.is-cover {
		position: absolute;
		left: 0;
		top: 0;
		z-index: 1;
		padding: 2px 5px;
		background: var(--accent);
		color: var(--on-accent);
		font: 500 12px/1 var(--font-mono);
		pointer-events: none;
	}
	.n.only {
		color: var(--accent);
	}
	.current .n {
		background: var(--accent);
		color: var(--on-accent);
	}
</style>

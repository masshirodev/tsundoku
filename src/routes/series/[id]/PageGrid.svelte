<script lang="ts">
	import { coverPlaceholder } from '$lib/library/cover';
	import { entryProgress, type SeriesEntry, type SeriesPage } from '$lib/library/series';
	import { pageThumbSrc, readHref } from '$lib/library/links';

	/**
	 * A doujin reads as a book, so its contents are its pages rather than a
	 * chapter list of one. The page last opened carries the accent ring.
	 *
	 * Each page shows its thumbnail, made on the workstation on first ask
	 * (doc/COVERS.md, "Page thumbnails"), over the striped placeholder while it
	 * loads; only the cells on screen ask. Each page opens the reader there.
	 */
	let { series, book: only }: { series: SeriesPage; book?: SeriesEntry | null } = $props();

	/** A one-book doujin shows its book; a book of a series is passed in. */
	const book = $derived(only ?? series.entries[0]);
	const pages = $derived(book?.pageCount ?? 0);
	const current = $derived(book && book.readAt === null ? (entryProgress(book)?.page ?? 0) : 0);
	const countLabel = $derived(
		!book
			? '0'
			: book.readAt !== null
				? `${pages} · READ`
				: current > 0
					? `${pages} · LAST OPENED P. ${current}`
					: String(pages)
	);
</script>

<section class="list" aria-label="Pages">
	<div class="head">
		<span>01 — PAGES</span>
		<span>{countLabel}</span>
	</div>
	<ol class="grid">
		{#each { length: pages }, i (i)}
			{@const n = i + 1}
			<li
				class="page"
				class:current={n === current}
				style:background={coverPlaceholder((series.hue + n * 11) % 360)}
				aria-current={n === current ? 'page' : undefined}
			>
				{#if book?.available}
					<img
						class="thumb"
						src={pageThumbSrc(book, i)}
						alt=""
						loading="lazy"
						decoding="async"
						draggable="false"
					/>
					<!-- eslint-disable-next-line svelte/no-navigation-without-resolve -- readHref() resolves -->
					<a class="open" href={readHref(book.id, n)} aria-label="Read from page {n}"></a>
				{/if}
				<span class="n">{n}</span>
			</li>
		{/each}
	</ol>
</section>

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
	.current .n {
		background: var(--accent);
		color: var(--on-accent);
	}
</style>

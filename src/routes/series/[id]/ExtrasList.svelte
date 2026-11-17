<script lang="ts">
	import { page } from '$app/state';
	import { withParam } from '$lib/library/links';
	import { formatNumber, type SeriesEntry } from '$lib/library/series';

	/**
	 * A doujin's hand-made extras, listed apart from its books. An entry
	 * carrying front or back matter is not a book: no importer writes `matter`
	 * on a doujin (only the EPUB plans set it, for novels), so one comes from a
	 * hand-made row or the duplicates review. It is drawn here, under the books
	 * or the pages, so it stays reachable without being numbered as a book or
	 * counted in `N BOOKS` (doc/BOOKS.md, "A book with something beside it").
	 *
	 * Each row opens the extra's pages (`?book=<id>`, the way a book of a series
	 * opens), and is a link, so a TV's focus finds it with nothing extra.
	 */
	let { entries }: { entries: SeriesEntry[] } = $props();

	const meta = (e: SeriesEntry) =>
		[`${e.pageCount} P`, e.readAt !== null ? 'READ' : ''].filter(Boolean).join(' · ');
</script>

{#if entries.length}
	<div class="head">
		<span>EXTRAS</span>
		<span>{formatNumber(entries.length)}</span>
	</div>
	<div class="rows">
		{#each entries as e (e.id)}
			<!-- eslint-disable-next-line svelte/no-navigation-without-resolve -- withParam keeps the current, resolved path -->
			<a class="row" href={withParam(page.url, 'book', String(e.id))} data-extra={e.id}>
				<span class="t">{e.title || e.label || 'Extra'}</span>
				<span class="m">{meta(e)}</span>
			</a>
		{/each}
	</div>
{/if}

<style>
	.head {
		display: flex;
		align-items: center;
		justify-content: space-between;
		height: 52px;
		padding: 0 var(--pad);
		border-bottom: var(--hairline);
		background: var(--surface-page);
		font: 500 13px var(--font-mono);
		color: var(--text-2);
		letter-spacing: var(--tracking-label);
	}
	.rows {
		display: flex;
		flex-direction: column;
		border-bottom: var(--hairline);
	}
	.row {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 12px;
		min-height: 52px;
		padding: 0 var(--pad);
		border-bottom: var(--hairline);
		color: var(--text-1);
		text-decoration: none;
	}
	.row:last-child {
		border-bottom: 0;
	}
	.row:active {
		background: var(--surface-inverse);
		color: var(--text-inverse);
	}
	.t {
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.m {
		flex-shrink: 0;
		font: 400 13px var(--font-mono);
		color: var(--text-2);
		letter-spacing: 0.04em;
	}
	.row:active .m {
		color: inherit;
	}
</style>

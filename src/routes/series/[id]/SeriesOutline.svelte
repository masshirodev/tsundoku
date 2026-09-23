<script lang="ts">
	import { resolve } from '$app/paths';
	import NavLine from '$lib/components/waiting/NavLine.svelte';
	import type { SeriesPage } from '$lib/library/series';
	import type { Kind } from '$lib/library/types';
	import type { SeriesPreview } from '$lib/waiting.svelte';
	import SeriesPanel from './SeriesPanel.svelte';

	/**
	 * The series screen on its way (Loading States 1g, 1h): its own frame, with
	 * the real panel showing what the tapped tile knew -- cover, title, kind,
	 * rating, FAV and counts, and rating and FAV already work -- and the rest,
	 * the list included, in outline under the progress line. Content lands in
	 * the same places, so nothing moves when the screen arrives.
	 */
	let { preview }: { preview: SeriesPreview } = $props();

	const series = $derived<SeriesPage>({
		id: preview.id,
		title: preview.title,
		kind: preview.kind as Kind,
		rating: preview.rating,
		favourite: preview.favourite,
		hidden: preview.hidden,
		newCount: 0,
		entryCount: preview.entryCount,
		readCount: preview.readCount,
		hue: preview.hue,
		indexed: true,
		cover: preview.cover,
		addedAt: 0,
		collections: [],
		altTitles: [],
		source: '',
		status: '',
		description: '',
		direction: null,
		path: '',
		tags: [],
		entries: [],
		duplicates: 0,
		scanlators: [],
		scanlator: null
	});
	const widths = [
		'58%',
		'44%',
		'66%',
		'38%',
		'52%',
		'61%',
		'47%',
		'70%',
		'41%',
		'55%',
		'63%',
		'49%'
	];
</script>

<div class="series" aria-busy="true">
	<header class="bar" aria-label="Series">
		<a class="cell back" href={resolve('/')}>
			<span class="arrow">←</span>
			<span class="back-label">LIBRARY</span>
		</a>
		<div class="mid"></div>
		<NavLine force />
	</header>
	<div class="body">
		<div class="panel-col">
			<SeriesPanel {series} shelves={[]} cached={0} onedit={() => undefined} outline />
		</div>
		<div class="list-col" aria-hidden="true">
			<div class="head">
				<span>01 — {series.kind === 'novel' ? 'CONTENTS' : 'CHAPTERS'}</span>
				<span>{series.entryCount} · {series.readCount} READ</span>
			</div>
			{#each widths as w, i (i)}
				<div class="row"><i class="num"></i><i style:width={w}></i></div>
			{/each}
		</div>
	</div>
</div>

<style>
	.series {
		display: flex;
		flex-direction: column;
		flex: 1;
		overflow: hidden;
		max-height: 100dvh;
	}
	.bar {
		position: relative;
		flex-shrink: 0;
		display: flex;
		align-items: stretch;
		height: var(--header-h);
		border-bottom: var(--hairline);
		background: var(--surface-page);
	}
	.cell {
		display: flex;
		align-items: center;
		gap: 14px;
		padding: 0 var(--pad);
		border-right: var(--hairline);
		font: 500 14px var(--font-mono);
		letter-spacing: 0.04em;
		color: var(--text-1);
		text-decoration: none;
	}
	.arrow {
		font-size: 17px;
	}
	.mid {
		flex: 1;
	}
	.body {
		display: flex;
		flex-direction: column;
		flex: 1;
		min-height: 0;
	}
	.list-col {
		min-width: 0;
		overflow: hidden;
	}
	.head {
		display: flex;
		align-items: center;
		gap: 14px;
		height: 52px;
		padding: 0 var(--pad);
		border-bottom: var(--hairline);
		font: 500 13px var(--font-mono);
		letter-spacing: 0.06em;
		color: var(--text-2);
		white-space: nowrap;
	}
	.row {
		display: flex;
		align-items: center;
		height: 60px;
		border-bottom: var(--hairline);
	}
	.row i {
		display: block;
		height: 10px;
		background: var(--line-1);
	}
	.row .num {
		width: 32px;
		margin: 0 24px;
		flex-shrink: 0;
	}
	@media (max-width: 599px) {
		.row {
			height: 52px;
		}
	}
	@media (min-width: 1024px) {
		.body {
			flex-direction: row;
			height: calc(100dvh - var(--header-h) - var(--banner-h, 0px));
			flex: none;
		}
		.panel-col {
			flex-shrink: 0;
			width: 440px;
			overflow: hidden;
			border-right: var(--hairline);
		}
		.list-col {
			flex: 1;
		}
	}
</style>

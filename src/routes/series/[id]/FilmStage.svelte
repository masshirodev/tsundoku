<script lang="ts">
	import { resolve } from '$app/paths';
	import { coverPlaceholder } from '$lib/library/cover';
	import { seriesHref } from '$lib/library/links';
	import { tagSearchHref } from '$lib/library/tag-search';
	import type { CollectionItem, CollectionRow, CollectionView } from '$lib/library/surroundings';
	import type { TmdbTitle } from '$lib/library/tmdb';

	/**
	 * A film's stage (card c992; the handoff's Film-Desk, Collection and
	 * Film-States boards, doc/handoffs/movies-shows/): where a wide device's
	 * list column would be, a film has nothing to list. The backdrop at 16:9,
	 * flat, with nothing laid over it, on the series' stripes until it loads;
	 * then `01 — THE COLLECTION` (c990's view, the offer and never the lead);
	 * then `02 — ABOUT`. With no TMDB link the stage is empty: the film closes
	 * up (the owner's call, 2026-11-12), and LISTS says why.
	 *
	 * The measurements are the mock's own (24px padding, 28px between blocks,
	 * 56px rows, a 76px tag cell), not a ladder: the theme declares no length
	 * tokens (doc/FILMS-SHOWS.md, "The screens").
	 */
	let {
		seriesId,
		hue,
		facts,
		collection,
		genres,
		tagSource,
		ongroup
	}: {
		seriesId: number;
		hue: number;
		facts: TmdbTitle | null;
		collection: CollectionView | null;
		/** The series' own genres, for ABOUT's foot. */
		genres: string[];
		tagSource: { id: string; name: string } | null;
		/** GROUP →: the GROUP sheet, with the parts in the library. */
		ongroup: () => void;
	} = $props();

	/** SHOW on a fold, or on the Work's one line: for this film only. */
	let openFor = $state<number | null>(null);
	const open = $derived(openFor === seriesId);
	let loaded = $state(false);

	/** FIND: the screen's own source searched for the part's title (c313's mechanism, as the anime heads do). */
	function findHref(title: string): string | null {
		if (!tagSource) return null;
		return tagSearchHref(
			resolve('/browse/[source]', { source: tagSource.id }),
			[],
			{ namespace: 'title', value: title },
			resolve('/series/[id]', { id: String(seriesId) })
		);
	}

	const hrefOf = (r: CollectionRow): string | null =>
		r.cell?.label === 'IN LIBRARY →'
			? seriesHref(r.cell.seriesId)
			: r.cell?.label === 'FIND'
				? findHref(r.cell.title)
				: null;

	/** The items as drawn: a fold opened shows its parts in its place. */
	const items = $derived.by((): CollectionItem[] => {
		if (!collection || collection.mode !== 'parts') return [];
		if (!open) return collection.items;
		return collection.items.flatMap((i): CollectionItem[] =>
			i.type === 'fold' ? i.rows.map((row) => ({ type: 'row', row })) : [i]
		);
	});
	const folds = $derived(
		collection?.mode === 'parts' && collection.items.some((i) => i.type === 'fold')
	);
</script>

{#snippet row(r: CollectionRow, first: boolean)}
	{@const href = hrefOf(r)}
	{#if href}
		<!-- A TV draws the facts only (Film-TV 1.7): no cells and no stops on the stage.
		     Both copies are drawn and CSS keeps one, so the focus layer never finds the other. -->
		<div class="row tv-only" class:first>
			<span class="tag">{r.tag}</span>
			<span class="bo">
				<span class="tt" class:mu={r.cell?.label === 'FIND'}>{r.title}</span>
				<span class="lm"
					>{r.cell?.label === 'FIND'
						? 'NOT IN THE LIBRARY'
						: r.cell?.label === 'IN LIBRARY →'
							? 'IN LIBRARY'
							: r.meta}</span
				>
			</span>
		</div>
	{/if}
	<!-- eslint-disable svelte/no-navigation-without-resolve -- seriesHref and tagSearchHref resolve -->
	<svelte:element
		this={href ? 'a' : 'div'}
		{href}
		class="row"
		class:first
		class:not-tv={!!href}
		data-press={href ? 'fill' : undefined}
	>
		<span class="tag" class:on={r.on}>{r.tag}</span>
		<span class="bo">
			<span class="tt" class:mu={r.cell?.label === 'FIND'}>{r.title}</span>
			<span class="lm">{r.meta}</span>
		</span>
		{#if r.cell}<span class="cell">{r.cell.label}</span>{/if}
	</svelte:element>
	<!-- eslint-enable svelte/no-navigation-without-resolve -->
{/snippet}

<section class="stage" aria-label="The film">
	{#if facts?.backdrop}
		<div class="backdrop" style:background={coverPlaceholder(hue)}>
			<img
				src={facts.backdrop}
				alt=""
				class:loaded
				onload={() => (loaded = true)}
				referrerpolicy="no-referrer"
			/>
		</div>
	{/if}

	{#if collection?.mode === 'parts'}
		<div class="block">
			<div class="lab"><span>01 — {collection.name}</span><span>{collection.at}</span></div>
			<div class="box">
				{#each items as item, i (item.type === 'row' ? item.row.key : `f${item.above}`)}
					{#if item.type === 'row'}
						{@render row(item.row, i === 0)}
					{:else}
						<div class="row fold" class:first={i === 0}>
							<span class="bo"><span class="lm">{item.words}</span></span>
							<button
								type="button"
								class="cell not-tv"
								onclick={() => (openFor = open ? null : seriesId)}>{open ? 'HIDE' : 'SHOW'}</button
							>
						</div>
					{/if}
				{/each}
				{#if open && folds}
					<div class="row fold">
						<span class="bo"><span class="lm">EVERY PART</span></span>
						<button type="button" class="cell" onclick={() => (openFor = null)}>HIDE</button>
					</div>
				{/if}
				<div class="row foot">
					<span class="bo">{collection.foot.words}</span>
					{#if collection.foot.group}
						<button type="button" class="cell not-tv" onclick={ongroup}>GROUP →</button>
					{/if}
				</div>
			</div>
		</div>
	{:else if collection?.mode === 'work'}
		<div class="block">
			<div class="lab"><span>01 — ON THE STAGE</span></div>
			<div class="box">
				<div class="row first">
					<span class="bo"><span class="lm">{collection.line}</span></span>
					<button type="button" class="cell" onclick={() => (openFor = open ? null : seriesId)}
						>{open ? 'HIDE' : 'SHOW'}</button
					>
				</div>
				{#each collection.facts as f (f.key)}{@render row(f, false)}{/each}
				{#if open}
					{#each collection.rows as r (r.key)}{@render row(r, false)}{/each}
					<div class="row foot"><span class="bo">THE WORK’S ORDER IS ON ITS ROW, ABOVE</span></div>
				{/if}
			</div>
		</div>
	{/if}

	{#if facts?.overview}
		<div class="block about not-tv">
			<div class="lab"><span>02 — ABOUT</span><span>TMDB</span></div>
			<p>{facts.overview}</p>
			{#if genres.length}<div class="genres">{genres.join(' · ').toUpperCase()}</div>{/if}
		</div>
	{/if}
</section>

<style>
	.stage .tv-only {
		display: none;
	}
	/* A TV (doc/TV.md): the stage is facts, and PLAY is the screen's one stop (Film-TV 1.7). */
	/* Scoped under .stage so it outranks .row's and .cell's own display, declared below. */
	@media (pointer: none) and (min-width: 900px) {
		.stage .tv-only {
			display: flex;
		}
		.stage .not-tv {
			display: none;
		}
	}
	.stage {
		display: flex;
		flex-direction: column;
		gap: 28px;
		padding: 24px;
		min-width: 0;
	}
	.backdrop {
		aspect-ratio: 16 / 9;
		overflow: hidden;
	}
	.backdrop img {
		display: block;
		width: 100%;
		height: 100%;
		object-fit: cover;
		opacity: 0;
	}
	.backdrop img.loaded {
		opacity: 1;
	}
	.block {
		display: flex;
		flex-direction: column;
		gap: 12px;
	}
	.lab {
		display: flex;
		justify-content: space-between;
		gap: 12px;
		font: var(--type-label);
		letter-spacing: 0.06em;
		color: var(--text-2);
	}
	.box {
		display: flex;
		flex-direction: column;
		border: 1px solid var(--line-1);
	}
	.row {
		display: flex;
		align-items: stretch;
		min-height: 56px;
		border-top: 1px solid var(--line-1);
		color: var(--text-1);
		text-decoration: none;
	}
	.row.first {
		border-top: 0;
	}
	.tag {
		display: flex;
		flex-shrink: 0;
		align-items: center;
		justify-content: center;
		width: 76px;
		border-right: 1px solid var(--line-1);
		font: 500 12px var(--font-mono);
		letter-spacing: 0.06em;
		color: var(--text-2);
	}
	.tag.on {
		background: var(--surface-inverse);
		color: var(--text-inverse);
	}
	.bo {
		display: flex;
		flex: 1;
		min-width: 0;
		flex-direction: column;
		justify-content: center;
		gap: 4px;
		padding: 8px 14px;
	}
	.tt {
		font: 500 15px/1.3 var(--font-sans);
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}
	.tt.mu {
		color: var(--text-2);
	}
	.lm {
		font: 400 12px/1.35 var(--font-mono);
		color: var(--text-2);
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}
	.cell {
		display: flex;
		flex-shrink: 0;
		align-items: center;
		justify-content: center;
		min-width: 72px;
		padding: 0 16px;
		border: 0;
		border-left: 1px solid var(--line-1);
		background: none;
		font: 500 12px var(--font-mono);
		letter-spacing: 0.04em;
		white-space: nowrap;
		color: var(--text-1);
		cursor: pointer;
	}
	.row.foot {
		min-height: 52px;
	}
	.row.foot > .bo {
		padding: 0 16px;
		font: 400 12px var(--font-mono);
		letter-spacing: 0.02em;
		color: var(--text-2);
	}
	.about p {
		max-width: 680px;
		margin: 0;
		font: 400 15px/1.55 var(--font-sans);
		color: var(--text-prose);
	}
	.genres {
		font: 400 12px/1.5 var(--font-mono);
		letter-spacing: 0.02em;
		color: var(--text-2);
	}
</style>

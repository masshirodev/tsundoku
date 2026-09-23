<script lang="ts">
	import { enhance } from '$app/forms';
	import Badge from '$lib/components/content/Badge.svelte';
	import { coverPlaceholder } from '$lib/library/cover';
	import { RATING_OPTIONS } from '$lib/library/rating';
	import {
		continueAction,
		directionOptions,
		directionRowLabel,
		effectiveDirection,
		fileMeta,
		seriesMeta,
		tagGroups,
		type SeriesPage
	} from '$lib/library/series';
	import type { Shelf } from '$lib/library/types';
	import { isBookSeries } from '$lib/library/series';
	import { isPersonNamespace, suggestionLabel, type Suggestion } from '$lib/library/books';
	import { tagHref, readHref } from '$lib/library/links';
	import Band from '$lib/components/chrome/Band.svelte';

	/**
	 * The series' metadata: a header that scrolls away in portrait, a 440px
	 * panel with its own scroll in landscape (the CSS decides which). Order is
	 * the handoff's: identity, then rating and FAV, then CONTINUE -- all within
	 * thumb reach -- then direction, shelves, tags, about, and the file row with
	 * HIDE at the very end, away from CONTINUE.
	 */
	let {
		series,
		shelves,
		cached,
		onedit,
		suggestion = null,
		dismissedKey = null,
		onreview,
		cta = $bindable<HTMLElement | null>(null)
	}: {
		series: SeriesPage;
		shelves: Shelf[];
		/** Entries of this series cached on the device. */
		cached: number;
		onedit: () => void;
		/** "Might be one series": only on a single book, only visible books. */
		suggestion?: Suggestion | null;
		/** Set just after NOT A SERIES, so the band can offer UNDO. */
		dismissedKey?: string | null;
		onreview?: () => void;
		/** The CONTINUE bar, observed by the page to know when it scrolled away. */
		cta?: HTMLElement | null;
	} = $props();

	const action = $derived(continueAction(series));
	const direction = $derived(effectiveDirection(series));
	const tags = $derived(tagGroups(series.tags));
	const onShelves = $derived(
		shelves.filter(
			(s) => s.kind === 'collection' && series.collections.includes(Number(s.key.slice(2)))
		)
	);
	const noCover = $derived(series.kind === 'novel');
	let aboutOpen = $state(false);
</script>

<section class="panel" aria-label="About this series">
	<div class="identity">
		<div
			class="cover"
			class:typeset={noCover}
			style:background={noCover ? undefined : coverPlaceholder(series.hue)}
		>
			{#if noCover}
				<span class="nocover">NO COVER · EPUB</span>
				<span class="nocover-title">{series.title}</span>
			{/if}
			{#if series.hidden}<Badge tone="reveal" corner="top-left">HIDDEN</Badge>{/if}
			{#if series.favourite}<Badge tone="accent" corner="top-right">FAV</Badge>{/if}
		</div>
		<div class="names">
			<div class="meta">{seriesMeta(series)}</div>
			<h1>{series.title}</h1>
			{#each series.altTitles as alt (alt)}<div class="alt">{alt}</div>{/each}
		</div>
	</div>

	<div class="rating-row">
		<div class="label">{series.rating === 0 ? 'UNRATED' : 'RATING'}</div>
		<form method="POST" action="?/rate" use:enhance class="cells">
			{#each RATING_OPTIONS as n (n)}
				<!-- Cells fill up to the rating; 0 (unrated) fills none. -->
				{@const on = n > 0 && n <= series.rating}
				<button
					type="submit"
					name="rating"
					value={n}
					class="cell"
					class:on
					class:muted={series.rating === 0}
					aria-pressed={series.rating !== 0 && n === series.rating}
					aria-label={n === 0 ? 'Unrated' : `Rate ${n}`}>{n}</button
				>
			{/each}
		</form>
		<form method="POST" action="?/favourite" use:enhance class="fav-form">
			<input type="hidden" name="on" value={series.favourite ? '0' : '1'} />
			<button type="submit" class="fav" class:on={series.favourite} aria-pressed={series.favourite}>
				{series.favourite ? 'FAV ✓' : 'FAV'}
			</button>
		</form>
	</div>

	<!-- eslint-disable svelte/no-navigation-without-resolve -- readHref() resolves -->
	<a
		class="cta"
		bind:this={cta}
		href={action.entry ? readHref(action.entry.id) : undefined}
		aria-disabled={!action.entry}
	>
		<span>▶ {action.label}</span>
		<span class="cta-meta">
			<span class="long"
				>{action.meta}{series.kind === 'doujin' && cached > 0 ? ' · ↓ CACHED' : ''}</span
			>
			<span class="short">{action.short || action.meta}</span>
		</span>
	</a>
	<!-- eslint-enable svelte/no-navigation-without-resolve -->

	{#if suggestion}
		<!-- Index Books, state 7: under CONTINUE, on this book's screen only. -->
		<section class="sugg" aria-label="Might be one series">
			<div class="sugg-head">
				<span>MIGHT BE ONE SERIES</span>
				<span class="dim"
					>{suggestion.books.length} BOOKS · {suggestionLabel(suggestion.books)}</span
				>
			</div>
			<div class="sugg-covers">
				{#each suggestion.books as b (b.seriesId)}
					<span
						class="sugg-cover"
						class:this={b.seriesId === series.id}
						style:background={coverPlaceholder(b.hue)}
						title={b.title}
					></span>
				{/each}
			</div>
			<div class="sugg-actions">
				<button type="button" onclick={() => onreview?.()}>REVIEW →</button>
				<form method="POST" action="?/dismiss" use:enhance>
					{#each suggestion.books as b (b.seriesId)}<input
							type="hidden"
							name="series"
							value={b.seriesId}
						/>{/each}
					<button type="submit" class="dim">NOT A SERIES</button>
				</form>
			</div>
		</section>
	{:else if dismissedKey}
		<Band title="NOT A SERIES · WON'T ASK AGAIN">
			{#snippet action()}
				<form method="POST" action="?/undoDismiss" use:enhance>
					<input type="hidden" name="key" value={dismissedKey} />
					<button type="submit">UNDO</button>
				</form>
			{/snippet}
		</Band>
	{/if}

	<form method="POST" action="?/direction" use:enhance class="row">
		<div class="label">{directionRowLabel(series.kind)}</div>
		<div class="seg">
			{#each directionOptions(series.kind) as d (d.value)}
				<button
					type="submit"
					name="direction"
					value={d.value}
					class:on={d.value === direction}
					aria-pressed={d.value === direction}>{d.label}</button
				>
			{/each}
		</div>
	</form>

	<div class="row">
		<div class="label">SHELVES</div>
		<div class="chips">
			{#each onShelves as s (s.key)}<span class="chip">{s.name}</span>{/each}
			{#if onShelves.length === 0}<span class="none">ON NO SHELF</span>{/if}
		</div>
		<button type="button" class="edit" onclick={onedit}>EDIT</button>
	</div>

	<div class="row top">
		<div class="label">TAGS</div>
		<div class="tags">
			{#each tags.groups as g (g.namespace)}
				<div class="tag-line">
					<span class="ns">{g.namespace}</span>
					<span class="vals">
						{#if isPersonNamespace(g.namespace)}
							<!-- People open their person page (Index Books). -->
							<!-- eslint-disable svelte/no-navigation-without-resolve -- tagHref() resolves -->
							{#each g.values as v, i (v)}{#if i > 0}<span class="sep"> · </span>{/if}<a
									class="person"
									href={tagHref(`${g.namespace}:${v}`)}>{v}</a
								>{/each}
							<!-- eslint-enable svelte/no-navigation-without-resolve -->
						{:else}
							{g.values.join(' · ')}
						{/if}
					</span>
				</div>
			{/each}
			{#if tags.groups.length === 0}<span class="none">NO TAGS</span>{/if}
			{#if tags.more > 0}<div class="more">+ {tags.more} MORE</div>{/if}
			{#if isBookSeries(series)}
				<div class="more">FROM ITS {series.entries.length} BOOKS · EACH KEEPS ITS OWN</div>
			{/if}
		</div>
		<button type="button" class="edit" onclick={onedit}>EDIT</button>
	</div>

	{#if series.description}
		<div class="row top">
			<div class="label">ABOUT</div>
			<div class="about">
				<p class:open={aboutOpen}>{series.description}</p>
				<button type="button" class="more" onclick={() => (aboutOpen = !aboutOpen)}>
					{aboutOpen ? 'LESS ↑' : 'MORE ↓'}
				</button>
			</div>
		</div>
	{/if}

	<div class="row file-row">
		<div class="label">FILE</div>
		<div class="file">
			{#if series.path}<div class="path">{series.path}</div>{/if}
			<div class="file-meta">
				{fileMeta(series.entries)}{series.kind !== 'doujin' && cached > 0
					? ` · ↓ ${cached} CACHED`
					: ''}
			</div>
		</div>
		{#if isBookSeries(series)}
			<!-- Every book back out as a single; the series goes. -->
			<form method="POST" action="?/ungroup" class="hide-form">
				<button type="submit" class="edit">UNGROUP</button>
			</form>
		{/if}
		<form method="POST" action="?/hide" use:enhance class="hide-form">
			<input type="hidden" name="on" value={series.hidden ? '0' : '1'} />
			<button type="submit" class="edit">{series.hidden ? 'UNHIDE' : 'HIDE'}</button>
		</form>
	</div>
</section>

<style>
	.panel {
		display: flex;
		flex-direction: column;
		--label-w: 120px;
		--cov-w: 184px;
		--title-size: 28px;
		--rating-h: 64px;
		--fav-w: 96px;
		--cta-h: 64px;
		--ns-w: 72px;
	}
	/* Landscape: a narrower cover and title in the 440px panel. */
	@media (min-width: 1024px) {
		.panel {
			--cov-w: 132px;
			--title-size: 22px;
		}
	}
	@media (max-width: 599px) {
		.panel {
			--label-w: 84px;
			--cov-w: 104px;
			--title-size: 20px;
			--rating-h: 52px;
			--fav-w: 60px;
			--cta-h: 56px;
			--ns-w: 56px;
		}
	}

	.identity {
		display: flex;
		gap: var(--pad);
		padding: var(--pad);
	}
	.cover {
		position: relative;
		flex-shrink: 0;
		width: var(--cov-w);
		aspect-ratio: var(--cover-ratio);
		align-self: flex-start;
	}
	.cover.typeset {
		background: var(--surface-panel);
		border: 1px solid var(--line-2);
		padding: 14px;
		display: flex;
		flex-direction: column;
		justify-content: space-between;
	}
	.nocover {
		font: 500 12px var(--font-mono);
		color: var(--text-2);
		letter-spacing: var(--tracking-label);
	}
	.nocover-title {
		font: 500 15px/1.3 var(--font-sans);
		text-wrap: pretty;
	}
	.names {
		flex: 1;
		min-width: 0;
		display: flex;
		flex-direction: column;
		gap: 10px;
	}
	.meta {
		font: 500 13px var(--font-mono);
		color: var(--text-2);
		letter-spacing: var(--tracking-label);
	}
	h1 {
		margin: 0;
		font: 500 var(--title-size) / 1.2 var(--font-sans);
		text-wrap: pretty;
	}
	.alt {
		font: 400 15px/1.35 var(--font-sans);
		color: var(--text-2);
	}
	.names .alt + .alt {
		margin-top: -6px;
	}

	.label {
		display: flex;
		align-items: center;
		width: var(--label-w);
		padding-left: var(--pad);
		flex-shrink: 0;
		font: 500 12px var(--font-mono);
		letter-spacing: var(--tracking-label);
		color: var(--text-2);
		border-right: var(--hairline);
	}
	.top .label {
		align-items: flex-start;
		padding-top: 18px;
	}

	.rating-row {
		flex-shrink: 0;
		display: flex;
		align-items: stretch;
		height: var(--rating-h);
		border-top: var(--hairline);
		border-bottom: var(--hairline);
	}
	.cells {
		flex: 1;
		display: flex;
	}
	.cell {
		flex: 1;
		min-width: 0;
		border: 0;
		border-right: var(--hairline);
		border-radius: 0;
		padding: 0;
		background: transparent;
		color: var(--text-1);
		font: 500 16px var(--font-mono);
		cursor: pointer;
	}
	.cell.muted {
		color: var(--text-2);
	}
	.cell.on {
		background: var(--accent);
		color: var(--on-accent);
	}
	.fav-form {
		display: flex;
	}
	.fav {
		width: var(--fav-w);
		border: 0;
		border-radius: 0;
		background: transparent;
		color: var(--text-2);
		font: 500 14px var(--font-mono);
		letter-spacing: 0.04em;
		cursor: pointer;
	}
	.fav.on {
		background: var(--accent);
		color: var(--on-accent);
	}

	.cta {
		flex-shrink: 0;
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 12px;
		height: var(--cta-h);
		padding: 0 var(--pad);
		border: 0;
		border-radius: 0;
		background: var(--accent);
		color: var(--on-accent);
		font: 500 15px var(--font-mono);
		letter-spacing: 0.04em;
		text-align: left;
	}
	.cta {
		text-decoration: none;
	}
	.cta[aria-disabled='true'] {
		pointer-events: none;
	}
	.cta-meta .short {
		display: none;
	}
	@media (max-width: 599px) {
		.cta-meta .long {
			display: none;
		}
		.cta-meta .short {
			display: inline;
		}
	}

	.row {
		display: flex;
		align-items: stretch;
		border-bottom: var(--hairline);
		min-height: 60px;
	}
	.seg {
		flex: 1;
		display: flex;
		min-height: 56px;
	}
	.seg button {
		flex: 1;
		border: 0;
		border-right: var(--hairline);
		border-radius: 0;
		background: transparent;
		color: var(--text-1);
		font: 500 14px var(--font-mono);
		cursor: pointer;
	}
	.seg button.on {
		background: var(--surface-inverse);
		color: var(--text-inverse);
	}
	.chips {
		flex: 1;
		min-width: 0;
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 8px;
		padding: 10px 14px;
	}
	.chip {
		height: 36px;
		display: flex;
		align-items: center;
		padding: 0 12px;
		border: 1px solid var(--line-2);
		font: 500 14px var(--font-sans);
	}
	.none {
		font: 500 12px var(--font-mono);
		color: var(--text-2);
		letter-spacing: 0.04em;
	}
	.edit {
		display: flex;
		align-items: center;
		padding: 0 var(--pad);
		border: 0;
		border-left: var(--hairline);
		border-radius: 0;
		background: transparent;
		color: var(--text-1);
		font: 500 13px var(--font-mono);
		letter-spacing: 0.04em;
		cursor: pointer;
	}
	.hide-form {
		display: flex;
	}
	.cell:active:not(.on),
	.fav:active:not(.on),
	.seg button:active:not(.on),
	.edit:active {
		background: var(--surface-inverse);
		color: var(--text-inverse);
	}
	.tags {
		flex: 1;
		min-width: 0;
		display: flex;
		flex-direction: column;
		gap: 8px;
		padding: 14px;
	}
	.tag-line {
		display: flex;
		gap: 12px;
		align-items: baseline;
	}
	.ns {
		flex-shrink: 0;
		width: var(--ns-w);
		font: 400 12px var(--font-mono);
		color: var(--text-2);
		letter-spacing: 0.04em;
	}
	.vals {
		flex: 1;
		min-width: 0;
		font: 400 15px/1.35 var(--font-sans);
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}
	.more {
		align-self: flex-start;
		padding: 0;
		border: 0;
		background: none;
		font: 500 12px var(--font-mono);
		color: var(--text-2);
		letter-spacing: 0.04em;
		cursor: pointer;
	}
	.about {
		flex: 1;
		min-width: 0;
		display: flex;
		flex-direction: column;
		gap: 6px;
		padding: 14px;
	}
	.about p {
		margin: 0;
		font: 400 15px/1.45 var(--font-sans);
		color: var(--text-prose);
		display: -webkit-box;
		-webkit-line-clamp: 2;
		line-clamp: 2;
		-webkit-box-orient: vertical;
		overflow: hidden;
		text-wrap: pretty;
	}
	.about p.open {
		display: block;
	}
	.person {
		color: inherit;
		text-decoration: underline;
		text-underline-offset: 4px;
		text-decoration-color: var(--line-2);
	}
	.person:active {
		background: var(--surface-inverse);
		color: var(--text-inverse);
	}
	.sugg {
		display: flex;
		flex-direction: column;
		background: var(--surface-panel);
		border-bottom: var(--hairline);
	}
	.sugg-head {
		display: flex;
		justify-content: space-between;
		gap: 12px;
		padding: 16px var(--pad) 12px;
		font: 500 13px var(--font-mono);
		letter-spacing: var(--tracking-label);
	}
	.dim {
		color: var(--text-2);
	}
	.sugg-covers {
		display: flex;
		gap: 8px;
		padding: 0 var(--pad) 16px;
		overflow-x: auto;
	}
	.sugg-cover {
		width: 64px;
		aspect-ratio: var(--cover-ratio);
		flex-shrink: 0;
	}
	.sugg-cover.this {
		box-shadow: inset 0 0 0 2px var(--accent);
	}
	.sugg-actions {
		display: flex;
		height: 56px;
		border-top: var(--hairline);
	}
	.sugg-actions > button,
	.sugg-actions > form {
		flex: 1;
		display: flex;
	}
	.sugg-actions button {
		flex: 1;
		display: flex;
		align-items: center;
		justify-content: center;
		border: 0;
		border-radius: 0;
		background: transparent;
		color: var(--text-1);
		font: 500 14px var(--font-mono);
		letter-spacing: 0.04em;
		cursor: pointer;
	}
	.sugg-actions > button {
		border-right: var(--hairline);
	}
	.sugg-actions button.dim {
		color: var(--text-2);
	}
	.sugg-actions button:active {
		background: var(--surface-inverse);
		color: var(--text-inverse);
	}
	.file-row {
		min-height: 64px;
	}
	.file {
		flex: 1;
		min-width: 0;
		display: flex;
		flex-direction: column;
		justify-content: center;
		gap: 5px;
		padding: 10px 14px;
		font: 400 13px var(--font-mono);
		color: var(--text-2);
	}
	.path {
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}
	.file-meta {
		color: var(--text-1);
	}
</style>

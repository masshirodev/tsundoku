<script lang="ts">
	import { leave } from '$lib/motion';
	import { fullscreen } from '$lib/reader/fullscreen.svelte';
	import { enhance } from '$app/forms';
	import { backLink } from '$lib/back';
	import { chapterCells, scrubFill, scrubPage, type Mode } from '$lib/reader/reader';
	import { MediaQuery } from 'svelte/reactivity';
	import { TV } from '$lib/device.svelte';
	import { focusScope } from '$lib/focus';
	import type { CellState, SpreadChoice } from '$lib/library/highlights';

	/**
	 * The controls: a 64px bar on top -- back, where
	 * you are, the rating and FAV -- and a scrubber and chapter cells below.
	 * Shown by a tap in the middle, gone by the next. Both follow the reading
	 * direction: in R->L the scrubber fills from the right and the next
	 * chapter is on the left.
	 *
	 * On a TV the chrome is a focus row once it is up:
	 * OK brings it with focus on the scrubber, ↓ reaches the cells, and the
	 * scrubber keeps ← → so it still scrubs rather than walking the pad.
	 */
	let {
		title,
		meta,
		backHref,
		incognito,
		rating,
		favourite,
		mode,
		page,
		total,
		prev,
		next,
		settings,
		shift,
		onfav,
		onsheet,
		addHref = null,
		onscrub,
		onchapter,
		onshift,
		noText = null,
		languages = [],
		onlanguage,
		highlight = null,
		ticks = [],
		onhighlight,
		choices = null,
		onchoice,
		onchoicesclose
	}: {
		title: string;
		meta: string;
		backHref: string;
		incognito: boolean;
		rating: number;
		favourite: boolean;
		mode: Mode;
		/** 0-based page the scrubber shows, and how many. */
		page: number;
		total: number;
		prev: string | null;
		next: string | null;
		settings: string;
		/** Offered only while spreads are on. */
		shift: boolean;
		onfav: () => void;
		onsheet: () => void;
		/**
		 * A browsing record (doc/READING-ONLINE.md): no rating or FAV for a series not in the
		 * library, so + ADD takes their cell (Online Calls, "The reader, for a record").
		 */
		addHref?: string | null;
		onscrub: (page: number) => void;
		onchapter: (to: 'prev' | 'next') => void;
		onshift: () => void;
		/**
		 * A Japanese page OCR hasn't read yet (Index Japanese 1c, noOcr): the
		 * series' chapters read so far. Dashed, as what isn't stored yet is.
		 */
		noText?: { done: number; total: number } | null;
		/** A folded book's languages (doc/EDITIONS.md): one cell each, the one read inverted. */
		languages?: { code: string; on: boolean; entryId: number }[];
		onlanguage?: (entryId: number) => void;
		/**
		 * HIGHLIGHT: its words and its state; none where the reader offers no
		 * highlight (a browsing record, which is not in the library).
		 */
		highlight?: { label: string; state: CellState; waiting?: boolean } | null;
		/** The scrubber's yellow ticks, one at each kept page (0-based). */
		ticks?: number[];
		onhighlight?: () => void;
		/** A spread's HIGHLIGHT asks which: open while set. */
		choices?: SpreadChoice[] | null;
		onchoice?: (c: SpreadChoice) => void;
		onchoicesclose?: () => void;
	} = $props();
	let hlCell = $state<HTMLElement | null>(null);
	/** The chooser stands over the cell that opened it, kept inside the screen. */
	const choicesLeft = $derived.by(() => {
		if (!choices || !hlCell) return 0;
		const r = hlCell.getBoundingClientRect();
		return Math.max(0, Math.min(r.left, innerWidth - 260));
	});
	const tickAt = (p: number) => {
		const f = scrubFill(p, total, mode);
		return mode === 'rtl' ? f.left : f.width;
	};
	let adding = $state(false);
	let added = $state(false);
	const tvScreen = new MediaQuery(TV, false);

	const cells = $derived(chapterCells(mode, prev, next));
	const fill = $derived(scrubFill(page, total, mode));
	const thumb = $derived(mode === 'rtl' ? fill.left : fill.width);

	let track = $state<HTMLElement | null>(null);
	let dragging = false;
	function scrubAt(e: PointerEvent) {
		if (!track) return;
		const r = track.getBoundingClientRect();
		onscrub(scrubPage((e.clientX - r.left) / r.width, total, mode));
	}
</script>

<header class="top appear" out:leave={'up'} aria-label="Reader">
	<!-- eslint-disable-next-line svelte/no-navigation-without-resolve -- backHref is resolved by the page -->
	<a class="back" href={backHref} aria-label="Back to the series" use:backLink data-focus-mark="in"
		>←</a
	>
	<div class="where">
		<div class="title">{title}</div>
		<div class="meta">{meta}</div>
	</div>
	{#if incognito}<div class="incognito">INCOGNITO</div>{/if}
	{#if noText}
		<div class="notext">
			<div>NO TEXT YET</div>
			<div class="sub">OCR · {noText.done} OF {noText.total}</div>
		</div>
	{/if}
	{#each languages as l (l.entryId)}
		<button
			type="button"
			class="lang"
			class:on={l.on}
			aria-pressed={l.on}
			aria-label="Read in {l.code}"
			data-focus-mark="in"
			onclick={() => !l.on && onlanguage?.(l.entryId)}>{l.code}</button
		>
	{/each}
	{#if addHref}
		<form
			method="POST"
			action={addHref}
			class="add-form"
			use:enhance={() => {
				adding = true;
				return async ({ result }) => {
					adding = false;
					if (result.type === 'redirect') added = true;
				};
			}}
		>
			<button type="submit" class="add" disabled={adding || added} data-focus-mark="in"
				>{added ? 'IN LIBRARY ✓' : adding ? 'ADDING…' : '+ ADD'}</button
			>
		</form>
	{:else}
		<button
			type="button"
			class="rating"
			class:folded={languages.length > 1}
			aria-label={rating
				? `Rated ${rating} of 10 · reading settings`
				: 'Unrated · reading settings'}
			data-focus-mark="in"
			onclick={onsheet}
		>
			{#each [1, 2, 3, 4, 5] as n (n)}<span class:on={n <= rating}></span>{/each}
		</button>
		<button
			type="button"
			class="fav"
			class:folded={languages.length > 1}
			class:on={favourite}
			aria-pressed={favourite}
			data-focus-mark="in"
			onclick={onfav}>FAV</button
		>
	{/if}
</header>

<footer class="bottom appear" out:leave={'down'} aria-label="Reader controls">
	<div class="scrub">
		<span class="end">{mode === 'rtl' ? total : 1}</span>
		<div
			class="track"
			bind:this={track}
			role="slider"
			tabindex="0"
			aria-label="Page"
			aria-valuemin={1}
			aria-valuemax={total}
			aria-valuenow={page + 1}
			data-focus-start={tvScreen.current ? '' : undefined}
			data-focus-adjust={tvScreen.current ? '' : undefined}
			onpointerdown={(e) => {
				dragging = true;
				(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
				scrubAt(e);
			}}
			onpointermove={(e) => dragging && scrubAt(e)}
			onpointerup={() => (dragging = false)}
			onpointercancel={() => (dragging = false)}
			onkeydown={(e) => {
				const forward = mode === 'rtl' ? 'ArrowLeft' : 'ArrowRight';
				const back = mode === 'rtl' ? 'ArrowRight' : 'ArrowLeft';
				if (e.key === forward) onscrub(Math.min(total - 1, page + 1));
				else if (e.key === back) onscrub(Math.max(0, page - 1));
			}}
		>
			<div class="fill" style:left="{fill.left}%" style:width="{fill.width}%"></div>
			{#each ticks as t (t)}
				<div class="tick" data-tick={t + 1} style:left="{tickAt(t)}%" aria-hidden="true"></div>
			{/each}
			<div class="thumb" style:left="{thumb}%"></div>
		</div>
		<span class="end right">{mode === 'rtl' ? 1 : total}</span>
	</div>
	<div class="cells">
		{#if cells.left}
			<button
				type="button"
				class="cell"
				data-focus-mark="in"
				onclick={() => onchapter(cells.left!.to)}>{cells.left.label}</button
			>
		{:else}
			<span class="cell empty"></span>
		{/if}
		<!-- The summary, and what tapping it does: alone it reads as a status line. -->
		<button type="button" class="cell grow opens" data-focus-mark="in" onclick={onsheet}
			><span class="sum">{settings}</span><span class="opens-k">SETTINGS ↑</span></button
		>
		{#if shift}<button type="button" class="cell" data-focus-mark="in" onclick={onshift}
				>SHIFT PAIRING</button
			>{/if}
		{#if highlight}
			<!-- HIGHLIGHT joins the row before FULL SCREEN. Kept, it reads
			     ✓ HIGHLIGHTED, inverted, and opens the page's sheet: a page kept for
			     good is never unmarked by a stray tap. -->
			<button
				type="button"
				class="cell hl {highlight.state}"
				bind:this={hlCell}
				aria-haspopup="dialog"
				disabled={highlight.state === 'incognito'}
				aria-disabled={(highlight.state === 'keeping' && !highlight.waiting) || undefined}
				data-focus-mark="in"
				onclick={() => (highlight?.state !== 'keeping' || highlight.waiting) && onhighlight?.()}
				>{highlight.label}</button
			>
		{/if}
		{#if fullscreen.available}
			<!-- The browser's bars gone (doc/READER.md, "Full screen"); not on an iPhone, nor in the app. -->
			<button
				type="button"
				class="cell"
				aria-pressed={fullscreen.on}
				data-focus-mark="in"
				onclick={() => fullscreen.toggle()}>{fullscreen.on ? 'EXIT FULL' : 'FULL SCREEN'}</button
			>
		{/if}
		{#if cells.right}
			<button
				type="button"
				class="cell last"
				data-focus-mark="in"
				onclick={() => onchapter(cells.right!.to)}>{cells.right.label}</button
			>
		{:else}
			<span class="cell empty last"></span>
		{/if}
	</div>
	{#if choices}
		<!-- A spread asks which: the pages in reading order, then BOTH. -->
		<div
			class="choices"
			role="dialog"
			aria-label="Highlight which page"
			style:left="{choicesLeft}px"
			use:focusScope={{ force: true }}
		>
			<div class="ch-h">HIGHLIGHT WHICH PAGE</div>
			{#each choices as c, i (c.label)}
				<button
					type="button"
					class="ch"
					class:kept={c.keptId !== null}
					aria-label="{c.keptId !== null ? `✓ ${c.label}` : c.label} · {c.keptId !== null
						? 'OPEN'
						: c.where}"
					data-focus-start={i === 0 ? '' : undefined}
					data-focus-mark="in"
					onclick={() => onchoice?.(c)}
					><span>{c.keptId !== null ? `✓ ${c.label}` : c.label}</span><span class="ch-w"
						>{c.keptId !== null ? 'OPEN' : c.where}</span
					></button
				>
			{/each}
		</div>
	{/if}
</footer>
<svelte:window
	onkeydown={(e) => {
		if (choices && e.key === 'Escape') {
			e.stopPropagation();
			onchoicesclose?.();
		}
	}}
/>

<style>
	.top,
	.bottom {
		position: fixed;
		left: 0;
		right: 0;
		z-index: 20;
		background: var(--surface-page);
		color: var(--text-1);
	}
	/*
	 * In the phone app the reader's pages run under the camera
	 * (doc/ANDROID.md, "Drawn under the camera"), and the app says how tall
	 * the band is. The top bar stays where it is, below the band, and its
	 * background reaches up through it, so no page shows above the bar. The
	 * bottom bar hugs the display's edge. Anywhere else
	 * the variable is unset and both are as they were.
	 */
	.top {
		top: 0;
		display: flex;
		align-items: stretch;
		height: calc(64px + var(--app-inset-top, 0px));
		padding-top: var(--app-inset-top, 0px);
		border-bottom: var(--hairline);
	}
	.back {
		display: flex;
		align-items: center;
		justify-content: center;
		width: 64px;
		flex-shrink: 0;
		border-right: var(--hairline);
		color: var(--text-1);
		font: 500 18px var(--font-mono);
		text-decoration: none;
	}
	.where {
		flex: 1;
		min-width: 0;
		display: flex;
		flex-direction: column;
		justify-content: center;
		gap: 3px;
		padding: 0 18px;
	}
	.title {
		font: 500 16px/19.2px var(--font-sans);
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}
	.meta {
		font: 400 12px var(--font-mono);
		letter-spacing: 0.04em;
		color: var(--text-2);
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}
	.incognito {
		display: flex;
		align-items: center;
		padding: 0 18px;
		border-left: 1px dashed var(--line-2);
		font: 500 13px var(--font-mono);
		letter-spacing: 0.04em;
	}
	.notext {
		display: flex;
		flex-direction: column;
		justify-content: center;
		gap: 3px;
		padding: 0 18px;
		border-left: 1px dashed var(--line-2);
		font: 500 13px var(--font-mono);
		letter-spacing: 0.04em;
		white-space: nowrap;
	}
	.notext .sub {
		font-weight: 400;
		font-size: 12px;
		color: var(--text-2);
	}
	button {
		border: 0;
		border-radius: 0;
		background: transparent;
		color: var(--text-1);
		cursor: pointer;
	}
	.add-form {
		display: flex;
	}
	.add {
		display: flex;
		align-items: center;
		padding: 0 22px;
		border: 0;
		border-left: var(--hairline);
		background: none;
		color: var(--text-1);
		font: 500 14px var(--font-mono);
		letter-spacing: 0.04em;
		cursor: pointer;
	}
	.rating {
		display: flex;
		align-items: center;
		gap: 3px;
		width: 108px;
		flex-shrink: 0;
		padding: 0 18px;
		border-left: var(--hairline);
	}
	.rating span {
		flex: 1;
		height: 6px;
		background: var(--rating-off);
	}
	.rating span.on {
		background: var(--rating-on);
	}
	.fav {
		display: flex;
		align-items: center;
		padding: 0 20px;
		border-left: var(--hairline);
		font: 500 14px var(--font-mono);
		color: var(--text-2);
	}
	.fav.on {
		background: var(--accent);
		color: var(--on-accent);
		border-left-color: var(--accent);
	}
	.bottom {
		bottom: 0;
		display: flex;
		flex-direction: column;
		border-top: var(--hairline);
	}
	.scrub {
		display: flex;
		align-items: center;
		gap: 18px;
		height: 56px;
		padding: 0 24px;
	}
	.end {
		min-width: 24px;
		font: 500 13px var(--font-mono);
		color: var(--text-2);
	}
	.end.right {
		text-align: right;
	}
	.track {
		position: relative;
		flex: 1;
		height: 4px;
		background: var(--line-1);
		touch-action: none;
		cursor: pointer;
	}
	/* A taller invisible hit area: a 4px line is no target for a thumb. */
	.track::before {
		content: '';
		position: absolute;
		inset: -20px 0;
	}
	.fill {
		position: absolute;
		top: 0;
		height: 4px;
		background: var(--accent);
	}
	.thumb {
		position: absolute;
		top: -10px;
		width: 4px;
		height: 24px;
		margin-left: -2px;
		background: var(--text-1);
	}
	/* A yellow tick at each kept page, 4 × 8 above the line. */
	.tick {
		position: absolute;
		top: -16px;
		width: 4px;
		height: 8px;
		margin-left: -2px;
		background: oklch(0.5 0.09 95);
		pointer-events: none;
	}
	/* The cell's states: kept is inverted; offline and incognito
	   drop to 0.4; a page being kept is dashed until it is. */
	.cell.hl.kept {
		background: var(--surface-inverse);
		color: var(--text-inverse);
	}
	.cell.hl.offline,
	.cell.hl.incognito {
		opacity: 0.4;
	}
	.cell.hl.keeping {
		outline: 1px dashed var(--line-2);
		outline-offset: -1px;
	}
	/* KEEPING… is aria-disabled, not disabled: a disabled button drops the
	   TV's focus, and the next OK went to the page instead of the cell. */
	.cell.hl:disabled,
	.cell.hl[aria-disabled='true'] {
		cursor: default;
	}
	/* 260px, ruled in ink, over the row. */
	.choices {
		position: absolute;
		bottom: 64px;
		z-index: 2;
		width: 260px;
		border: 1px solid var(--text-1);
		background: var(--surface-page);
	}
	.ch-h {
		padding: 14px 16px;
		border-bottom: var(--hairline);
		font: 500 12px/14.4px var(--font-mono);
		letter-spacing: 0.06em;
		color: var(--text-2);
	}
	.ch {
		display: flex;
		align-items: center;
		justify-content: space-between;
		width: 100%;
		height: 48px;
		padding: 0 16px;
		border: 0;
		border-bottom: var(--hairline);
		background: transparent;
		color: var(--text-1);
		font: 500 13px/13px var(--font-mono);
		letter-spacing: 0.06em;
		text-align: left;
		cursor: pointer;
	}
	.ch:last-child {
		border-bottom: 0;
	}
	.ch-w {
		color: var(--text-2);
	}
	.cells {
		display: flex;
		align-items: stretch;
		height: 64px;
		border-top: var(--hairline);
		/* A phone's bar is narrower than its cells: the row scrolls
		   rather than hiding a cell past the edge, and no cell shrinks to a
		   sliver. The bar's height is the reading area's, so no second row. */
		overflow-x: auto;
		overflow-y: hidden;
		scrollbar-width: none;
	}
	.cells::-webkit-scrollbar {
		display: none;
	}
	.cell {
		display: flex;
		align-items: center;
		justify-content: center;
		flex: 0 0 auto;
		padding: 0 24px;
		border-right: var(--hairline);
		font: 500 14px var(--font-mono);
		white-space: nowrap;
	}
	.cell.grow {
		flex: 1 1 auto;
		min-width: 0;
		overflow: hidden;
	}
	/* The reading sheet's cell: the summary gives way, SETTINGS ↑ stays. */
	.cell.opens {
		justify-content: space-between;
		gap: 12px;
	}
	.sum {
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.opens-k {
		flex-shrink: 0;
		color: var(--text-2);
	}
	.cell.last {
		border-right: 0;
	}
	.cell.empty {
		width: 64px;
		padding: 0;
	}
	button:active {
		background: var(--surface-inverse);
		color: var(--text-inverse);
	}
	.lang {
		width: 64px;
		flex-shrink: 0;
		border-left: var(--hairline);
		font: 500 14px var(--font-mono);
	}
	.lang.on {
		background: var(--surface-inverse);
		color: var(--text-inverse);
	}
	@media (max-width: 599px) {
		.lang {
			width: 52px;
		}
		/* The phone's bar gives the rating's and FAV's room to the languages (Editions 2e). */
		.rating.folded,
		.fav.folded {
			display: none;
		}
		.cell {
			padding: 0 14px;
			font-size: 13px;
		}
		/* The read summary gives way on a phone but SETTINGS ↑ keeps its whole
		   width, and the row scrolls for the cells past the edge. */
		.cell.grow {
			flex: 0 1 auto;
			min-width: 160px;
		}
		.rating {
			width: 84px;
			padding: 0 12px;
		}
	}
</style>

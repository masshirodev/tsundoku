<script lang="ts">
	import { backLink } from '$lib/back';
	import { chapterCells, scrubFill, scrubPage, type Mode } from '$lib/reader/reader';

	/**
	 * The controls (Index Reader, state 1b): a 64px bar on top -- back, where
	 * you are, the rating and FAV -- and a scrubber and chapter cells below.
	 * Shown by a tap in the middle, gone by the next. Both follow the reading
	 * direction: in R->L the scrubber fills from the right and the next
	 * chapter is on the left.
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
		onscrub,
		onchapter,
		onshift,
		noText = null
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
		onscrub: (page: number) => void;
		onchapter: (to: 'prev' | 'next') => void;
		onshift: () => void;
		/**
		 * A Japanese page OCR hasn't read yet (Index Japanese 1c, noOcr): the
		 * series' chapters read so far. Dashed, as what isn't stored yet is.
		 */
		noText?: { done: number; total: number } | null;
	} = $props();

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

<header class="top" aria-label="Reader">
	<!-- eslint-disable-next-line svelte/no-navigation-without-resolve -- backHref is resolved by the page -->
	<a class="back" href={backHref} aria-label="Back to the series" use:backLink>←</a>
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
	<button
		type="button"
		class="rating"
		aria-label={rating ? `Rated ${rating} of 5 · reading settings` : 'Unrated · reading settings'}
		onclick={onsheet}
	>
		{#each [1, 2, 3, 4, 5] as n (n)}<span class:on={n <= rating}></span>{/each}
	</button>
	<button type="button" class="fav" class:on={favourite} aria-pressed={favourite} onclick={onfav}
		>FAV</button
	>
</header>

<footer class="bottom" aria-label="Reader controls">
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
			<div class="thumb" style:left="{thumb}%"></div>
		</div>
		<span class="end right">{mode === 'rtl' ? 1 : total}</span>
	</div>
	<div class="cells">
		{#if cells.left}
			<button type="button" class="cell" onclick={() => onchapter(cells.left!.to)}
				>{cells.left.label}</button
			>
		{:else}
			<span class="cell empty"></span>
		{/if}
		<button type="button" class="cell grow" onclick={onsheet}>{settings}</button>
		{#if shift}<button type="button" class="cell" onclick={onshift}>SHIFT PAIRING</button>{/if}
		{#if cells.right}
			<button type="button" class="cell last" onclick={() => onchapter(cells.right!.to)}
				>{cells.right.label}</button
			>
		{:else}
			<span class="cell empty last"></span>
		{/if}
	</div>
</footer>

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
	.top {
		top: 0;
		display: flex;
		align-items: stretch;
		height: 64px;
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
	.cells {
		display: flex;
		align-items: stretch;
		height: 64px;
		border-top: var(--hairline);
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
	@media (max-width: 599px) {
		.cell {
			padding: 0 14px;
			font-size: 13px;
		}
		.rating {
			width: 84px;
			padding: 0 12px;
		}
	}
</style>

<script lang="ts">
	import { leave } from '$lib/motion';
	import { fullscreen } from '$lib/reader/fullscreen.svelte';
	import { backLink } from '$lib/back';
	import { ratingBars } from '$lib/library/rating';
	import type { Rating } from '$lib/library/types';
	import { MediaQuery } from 'svelte/reactivity';
	import { TV } from '$lib/device.svelte';

	/**
	 * The text reader's controls (Index Text Reader 1c): a 64px top bar -- back,
	 * the series and where you are in the book, rating, FAV -- and a bottom
	 * block with the chapter and its page, a scrubber across the chapter, and
	 * four cells: previous chapter, CONTENTS, READING, next. A book read right
	 * to left mirrors the bottom -- vertical Japanese, and a horizontal book
	 * whose DIRECTION is R→L in PAGED: the scrubber fills from the right
	 * and the next chapter is on the left.
	 *
	 * On a TV it is a focus row once it is up, as the image reader's chrome
	 * is: OK brings it with focus on the scrubber, ↓ reaches CONTENTS and
	 * READING, and the scrubber keeps ← → so it still scrubs.
	 */
	let {
		title,
		meta,
		incognito,
		rating,
		favourite,
		chapter,
		pageText,
		page,
		pages,
		rtl,
		prevLabel,
		nextLabel,
		settings,
		seriesHref,
		bottom = true,
		onfav,
		onscrub,
		atEnd = false,
		onprev,
		onnext,
		oncontents,
		onreading
	}: {
		title: string;
		meta: string;
		incognito: boolean;
		rating: number;
		favourite: boolean;
		chapter: string;
		pageText: string;
		/** 0-based page in the chapter, and how many there are. */
		page: number;
		pages: number;
		/** The pages turn right to left: the bottom mirrors. */
		rtl: boolean;
		prevLabel: string | null;
		nextLabel: string | null;
		settings: string;
		seriesHref: string;
		/** A sheet takes the bottom's place. */
		bottom?: boolean;
		onfav: () => void;
		onscrub: (page: number) => void;
		/**
		 * The reader is on its end page, where it leaves ← → to the controls
		 * (doc/FOCUS.md): the focused scrubber steps there on any device.
		 */
		atEnd?: boolean;
		onprev: () => void;
		onnext: () => void;
		oncontents: () => void;
		onreading: () => void;
	} = $props();

	const fraction = $derived(pages <= 1 ? 1 : page / (pages - 1));
	const tvScreen = new MediaQuery(TV, false);

	let track = $state<HTMLElement | null>(null);
	let dragging = false;
	function scrubAt(e: PointerEvent) {
		if (!track) return;
		const r = track.getBoundingClientRect();
		let f = Math.min(1, Math.max(0, (e.clientX - r.left) / r.width));
		if (rtl) f = 1 - f;
		onscrub(Math.round(f * Math.max(0, pages - 1)));
	}

	type Cell = { key: string; text: string; grow: boolean; on: (() => void) | null };
	const cells = $derived.by((): Cell[] => {
		const prev: Cell = {
			key: 'prev',
			text: prevLabel ? `← ${prevLabel}` : '',
			grow: false,
			on: prevLabel ? onprev : null
		};
		const next: Cell = {
			key: 'next',
			text: nextLabel ? `${nextLabel} →` : '',
			grow: false,
			on: nextLabel ? onnext : null
		};
		const middle: Cell[] = [
			{ key: 'contents', text: 'CONTENTS', grow: false, on: oncontents },
			{ key: 'reading', text: settings, grow: true, on: onreading }
		];
		// Right to left: the next chapter is the left-hand cell.
		return rtl
			? [
					{ ...next, text: nextLabel ? `← ${nextLabel}` : '' },
					...middle,
					{ ...prev, text: prevLabel ? `${prevLabel} →` : '' }
				]
			: [prev, ...middle, next];
	});
</script>

<header class="top appear" out:leave={'up'}>
	<!-- eslint-disable svelte/no-navigation-without-resolve -- seriesHref is resolved by the caller -->
	<a
		class="back"
		href={seriesHref}
		aria-label="Back to the series"
		use:backLink
		data-focus-mark="in">←</a
	>
	<!-- eslint-enable svelte/no-navigation-without-resolve -->
	<div class="names">
		<div class="title">{title}</div>
		<div class="meta">{meta}</div>
	</div>
	{#if incognito}<div class="incog">INCOGNITO</div>{/if}
	<div class="bars" role="img" aria-label={rating === 0 ? 'Unrated' : `Rated ${rating} of 10`}>
		{#each ratingBars(rating as Rating) as b, i (i)}<span class="bar {b}"></span>{/each}
	</div>
	<button
		type="button"
		class="fav"
		class:on={favourite}
		aria-pressed={favourite}
		data-focus-mark="in"
		onclick={onfav}>FAV</button
	>
</header>

{#if bottom}
	<footer class="bottom appear" out:leave={'down'}>
		<div class="chapter">
			<div class="ch">{chapter}</div>
			<div class="left">{pageText}</div>
		</div>
		<div class="scrub">
			<div class="end">{rtl ? pages : 1}</div>
			<div
				class="track"
				bind:this={track}
				role="slider"
				tabindex="0"
				aria-label="Page in chapter"
				aria-valuemin={1}
				aria-valuemax={Math.max(1, pages)}
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
				onkeydown={(e) => {
					// Off a TV the arrows are the reader's (doc/READER.md): see Chrome.svelte.
					if (!tvScreen.current && !atEnd) return;
					if (e.key === 'ArrowRight') onscrub(Math.min(pages - 1, page + (rtl ? -1 : 1)));
					if (e.key === 'ArrowLeft') onscrub(Math.max(0, page + (rtl ? 1 : -1)));
				}}
			>
				<div
					class="fill"
					style:left={rtl ? 'auto' : '0'}
					style:right={rtl ? '0' : 'auto'}
					style:width="{fraction * 100}%"
				></div>
				<div class="thumb" style:left="{(rtl ? 1 - fraction : fraction) * 100}%"></div>
			</div>
			<div class="end right">{rtl ? 1 : pages}</div>
		</div>
		<div class="cells">
			{#each cells as c (c.key)}
				<button
					type="button"
					class="cell"
					class:grow={c.grow}
					disabled={!c.on}
					data-focus-mark="in"
					onclick={() => c.on?.()}
					>{#if c.grow}<span class="sum">{c.text}</span><span class="opens-k">SETTINGS ↑</span
						>{:else}{c.text}{/if}</button
				>
			{/each}
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
		</div>
	</footer>
{/if}

<style>
	.top {
		position: absolute;
		left: 0;
		right: 0;
		top: 0;
		z-index: 20;
		display: flex;
		align-items: stretch;
		height: 64px;
		background: var(--surface-page);
		border-bottom: var(--hairline);
	}
	.back {
		width: 64px;
		flex-shrink: 0;
		display: flex;
		align-items: center;
		justify-content: center;
		border-right: var(--hairline);
		font: 500 18px var(--font-mono);
		color: var(--text-1);
		text-decoration: none;
	}
	.names {
		flex: 1;
		min-width: 0;
		display: flex;
		flex-direction: column;
		justify-content: center;
		gap: 3px;
		padding: 0 18px;
	}
	.title {
		font: 500 16px/1.2 var(--font-sans);
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}
	.meta {
		font: 400 12px var(--font-mono);
		color: var(--text-2);
		letter-spacing: 0.04em;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}
	.incog {
		display: flex;
		align-items: center;
		padding: 0 18px;
		border-left: 1px dashed var(--line-2);
		font: 500 13px var(--font-mono);
		letter-spacing: 0.04em;
	}
	.bars {
		width: 108px;
		flex-shrink: 0;
		display: flex;
		align-items: center;
		gap: 3px;
		padding: 0 18px;
		box-sizing: border-box;
		border-left: var(--hairline);
	}
	.bar {
		flex: 1;
		height: 6px;
	}
	.bar.on {
		background: var(--accent);
	}
	.bar.off,
	.bar.none {
		background: var(--line-2);
	}
	/* A half: the left half of the bar (Ratings out of 10 1e). */
	.bar.half {
		background: linear-gradient(to right, var(--accent) 50%, var(--line-2) 50%);
	}
	button {
		border: 0;
		border-radius: 0;
		background: transparent;
		color: var(--text-1);
		cursor: pointer;
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
	}
	.bottom {
		position: absolute;
		left: 0;
		right: 0;
		bottom: 0;
		z-index: 20;
		display: flex;
		flex-direction: column;
		background: var(--surface-page);
		border-top: var(--hairline);
	}
	.chapter {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 18px;
		height: 48px;
		padding: 0 24px;
		border-bottom: var(--hairline);
	}
	.ch {
		flex: 1;
		min-width: 0;
		font: 500 15px var(--font-sans);
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}
	.left {
		font: 500 13px var(--font-mono);
		color: var(--text-2);
		white-space: nowrap;
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
		flex: 0 0 auto;
		min-width: 0;
		display: flex;
		align-items: center;
		justify-content: center;
		padding: 0 24px;
		border-right: var(--hairline);
		font: 500 14px var(--font-mono);
		white-space: nowrap;
		overflow: hidden;
	}
	.cell:last-child {
		border-right: 0;
	}
	.cell.grow {
		flex: 1 1 auto;
	}
	.cell:disabled {
		cursor: default;
	}
	@media (max-width: 599px) {
		.bars {
			display: none;
		}
		.cell {
			padding: 0 12px;
			font-size: 13px;
		}
		/* The read summary gives way on a phone but SETTINGS ↑ keeps its whole
		   width, and the row scrolls for the cells past the edge. */
		.cell.grow {
			flex: 0 1 auto;
			min-width: 160px;
		}
	}
	/* The reading sheet's cell: the summary gives way, SETTINGS ↑ stays. */
	.cell.grow {
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
</style>

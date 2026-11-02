<script lang="ts">
	import Cover from './Cover.svelte';
	import Badge from './Badge.svelte';
	import RatingBars from './RatingBars.svelte';
	import type { Rating } from '$lib/library/types';

	/**
	 * A book in a cover grid: the series-of-books screen and person pages
	 * (Index Books). It is the library tile plus a meta line -- pages, READ,
	 * the page in progress with a bar, or the series and position -- and an
	 * optional position badge in the bottom-left corner.
	 *
	 * The book in progress (or the one being moved while reordering) carries
	 * the accent ring and an accent badge, as the last page opened does in a
	 * single book.
	 */
	let {
		title,
		hue,
		src = null,
		rating = 0,
		favourite = false,
		number,
		meta,
		metaTone = 'muted',
		progress,
		read = false,
		current = false,
		moving,
		selectable = false,
		selected = false,
		onpress,
		onlongpress,
		focusId,
		startFocus = false
	}: {
		title: string;
		hue: number;
		/** The cover thumbnail, when there is one (doc/COVERS.md). */
		src?: string | null;
		rating?: Rating;
		favourite?: boolean;
		/** "04": the reading position, when the grid is one series. */
		number?: string;
		meta: string;
		metaTone?: 'muted' | 'accent';
		/** 0-1, drawn as a bar after the meta when the book is in progress. */
		progress?: number;
		read?: boolean;
		current?: boolean;
		/** "03 → 02": the inverse strip on a cover being dragged. */
		moving?: string;
		selectable?: boolean;
		selected?: boolean;
		onpress?: () => void;
		onlongpress?: () => void;
		/** Where focus comes back to after a trip away (doc/FOCUS.md). */
		focusId?: string;
		/** The screen's first arrow lands here (doc/FOCUS.md). */
		startFocus?: boolean;
	} = $props();

	const HOLD_MS = 450;
	const SLOP_PX = 10;
	let timer: ReturnType<typeof setTimeout> | null = null;
	let start: { x: number; y: number } | null = null;
	let longFired = false;

	function cancel() {
		if (timer) clearTimeout(timer);
		timer = null;
		start = null;
	}
	function down(e: PointerEvent) {
		longFired = false;
		if (e.button !== 0 || !onlongpress) return;
		start = { x: e.clientX, y: e.clientY };
		timer = setTimeout(() => {
			timer = null;
			longFired = true;
			onlongpress?.();
		}, HOLD_MS);
	}
	function move(e: PointerEvent) {
		if (start && Math.hypot(e.clientX - start.x, e.clientY - start.y) > SLOP_PX) cancel();
	}
	function click() {
		cancel();
		if (longFired) {
			longFired = false;
			return;
		}
		onpress?.();
	}
	function contextmenu(e: MouseEvent) {
		if (!onlongpress) return;
		e.preventDefault();
		cancel();
		if (!longFired) onlongpress();
		longFired = true;
	}
</script>

<button
	type="button"
	class="tile"
	aria-pressed={selectable ? selected : undefined}
	data-focus-id={focusId}
	data-focus-start={startFocus ? '' : undefined}
	onpointerdown={down}
	onpointermove={move}
	onpointerup={() => timer && cancel()}
	onpointercancel={cancel}
	onpointerleave={cancel}
	onclick={click}
	oncontextmenu={contextmenu}
>
	<Cover {src} {hue} ring={selected}>
		{#if favourite}<Badge tone="accent" corner="top-right">FAV</Badge>{/if}
		{#if number}
			<span class="num" class:on={current || !!moving} class:big={!!moving}>{number}</span>
		{/if}
		{#if moving}<span class="moving">{moving}</span>{/if}
		{#if selectable}
			<span class="check" class:on={selected} aria-hidden="true">{selected ? '✓' : ''}</span>
		{/if}
		{#if current || moving}<span class="ring" aria-hidden="true"></span>{/if}
	</Cover>
	<span class="title" class:read>{title}</span>
	<span class="meta" class:accent={metaTone === 'accent'}>
		<span class="meta-text">{meta}</span>
		{#if progress !== undefined}
			<span class="bar"><span style:width="{Math.round(progress * 100)}%"></span></span>
		{/if}
	</span>
	<RatingBars value={rating} />
</button>

<style>
	.tile {
		background: var(--surface-page);
		padding: 10px;
		display: flex;
		flex-direction: column;
		gap: 8px;
		min-width: 0;
		border: 0;
		border-radius: 0;
		margin: 0;
		color: inherit;
		text-align: left;
		font: inherit;
		cursor: pointer;
		user-select: none;
		-webkit-user-select: none;
		-webkit-touch-callout: none;
		touch-action: manipulation;
	}
	/* The mark is around the cover, as on the library's tiles (doc/FOCUS.md). */
	.tile:focus-visible {
		box-shadow: none;
	}
	.tile:focus-visible :global(.cover) {
		box-shadow: var(--focus-ring);
	}
	.num {
		position: absolute;
		left: 0;
		bottom: 0;
		padding: 4px 7px;
		background: var(--surface-page);
		color: var(--text-1);
		font: 500 12px var(--font-mono);
	}
	.num.big {
		font-size: 16px;
	}
	.num.on {
		background: var(--accent);
		color: var(--on-accent);
	}
	.moving {
		position: absolute;
		left: 0;
		top: 0;
		right: 0;
		padding: 6px 8px;
		background: var(--surface-inverse);
		color: var(--text-inverse);
		font: 500 12px var(--font-mono);
		letter-spacing: 0.04em;
	}
	.ring {
		position: absolute;
		inset: 0;
		box-shadow: inset 0 0 0 3px var(--accent);
		pointer-events: none;
	}
	.check {
		position: absolute;
		left: 6px;
		top: 6px;
		width: 26px;
		height: 26px;
		border: 2px solid var(--text-1);
		display: flex;
		align-items: center;
		justify-content: center;
		font: 700 15px var(--font-mono);
		color: var(--on-accent);
	}
	.check.on {
		border-color: var(--accent);
		background: var(--accent);
	}
	.title {
		font: var(--type-tile);
		display: -webkit-box;
		-webkit-line-clamp: 2;
		line-clamp: 2;
		-webkit-box-orient: vertical;
		overflow: hidden;
		height: 32px;
	}
	.title.read {
		color: var(--text-2);
	}
	.meta {
		display: flex;
		align-items: center;
		gap: 8px;
		height: 14px;
		font: 500 12px var(--font-mono);
		color: var(--text-2);
		white-space: nowrap;
		min-width: 0;
	}
	.meta.accent {
		color: var(--accent);
	}
	.meta-text {
		overflow: hidden;
		text-overflow: ellipsis;
	}
	.bar {
		flex: 1;
		height: 3px;
		background: var(--line-1);
		min-width: 12px;
	}
	.bar > span {
		display: block;
		height: 3px;
		background: var(--accent);
	}
</style>

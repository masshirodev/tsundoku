<script lang="ts">
	import Cover from './Cover.svelte';
	import Badge from './Badge.svelte';
	import RatingBars from './RatingBars.svelte';
	import type { Rating } from '$lib/library/types';

	/**
	 * One cell of the library grid. Badges are pinned flush to the cover's
	 * corners: FAV top-right, +N bottom-left, HIDDEN top-left, ↓N bottom-right.
	 *
	 * A press is a tap; a long press (450ms, or the context menu) opens the
	 * sheet. A pointer that travels is a scroll, not a press, so it cancels both
	 * -- otherwise flicking through 800 covers on a tablet opens one.
	 */
	let {
		title,
		src,
		hue,
		rating = 0,
		favourite = false,
		newCount = 0,
		hidden = false,
		cached = null,
		selectable = false,
		selected = false,
		dimmed = false,
		indexing = false,
		onpress,
		onlongpress
	}: {
		title: string;
		src?: string | null;
		hue: number;
		rating?: Rating;
		favourite?: boolean;
		newCount?: number;
		hidden?: boolean;
		cached?: number | null;
		selectable?: boolean;
		selected?: boolean;
		dimmed?: boolean;
		indexing?: boolean;
		onpress?: () => void;
		onlongpress?: () => void;
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
		// Reset for every press, not only the primary button: a right-click
		// opens the sheet through `contextmenu`, which sets this, and nothing
		// else would clear it before the next right-click.
		longFired = false;
		if (e.button !== 0) return;
		start = { x: e.clientX, y: e.clientY };
		timer = setTimeout(() => {
			timer = null;
			longFired = true;
			onlongpress?.();
		}, HOLD_MS);
	}

	function move(e: PointerEvent) {
		if (!start) return;
		if (Math.hypot(e.clientX - start.x, e.clientY - start.y) > SLOP_PX) cancel();
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
		e.preventDefault();
		cancel();
		if (!longFired) onlongpress?.();
		longFired = true;
	}
</script>

{#if indexing}
	<div class="tile" data-state="indexing">
		<Cover hue={0} dashed label="indexing" />
		<div class="skel-title"></div>
		<div class="skel-rating"></div>
	</div>
{:else}
	<button
		type="button"
		class="tile"
		class:dimmed
		aria-pressed={selectable ? selected : undefined}
		onpointerdown={down}
		onpointermove={move}
		onpointerup={() => timer && cancel()}
		onpointercancel={cancel}
		onpointerleave={cancel}
		onclick={click}
		oncontextmenu={contextmenu}
	>
		<Cover {src} {hue} ring={selected}>
			{#if hidden}<Badge tone="reveal" corner="top-left">HIDDEN</Badge>{/if}
			{#if favourite}<Badge tone="accent" corner="top-right">FAV</Badge>{/if}
			{#if newCount > 0}<Badge corner="bottom-left">+{newCount}</Badge>{/if}
			{#if cached != null}<Badge tone="inverse" corner="bottom-right">↓ {cached}</Badge>{/if}
			{#if selectable}
				<span class="check" class:on={selected} aria-hidden="true">{selected ? '✓' : ''}</span>
			{/if}
		</Cover>
		<span class="title">{title}</span>
		<RatingBars value={rating} />
	</button>
{/if}

<style>
	.tile {
		background: var(--surface-page);
		padding: 10px;
		display: flex;
		flex-direction: column;
		gap: 8px;
		min-width: 0;
		/* reset the button */
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
	.tile:active:not([data-state]) {
		background: var(--surface-inverse);
		color: var(--text-inverse);
	}
	.dimmed {
		opacity: 0.35;
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
	.skel-title {
		height: 10px;
		width: 70%;
		background: var(--line-1);
	}
	.skel-rating {
		height: 14px;
	}
</style>

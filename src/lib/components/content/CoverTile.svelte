<script lang="ts">
	import Cover from './Cover.svelte';
	import Badge from './Badge.svelte';
	import RatingBars from './RatingBars.svelte';
	import RatingSlider from '$lib/components/controls/RatingSlider.svelte';
	import type { Rating } from '$lib/library/types';

	/**
	 * One cell of the library grid. Badges are pinned flush to the cover's
	 * corners: FAV top-right, +N bottom-left, HIDDEN top-left, ↓N bottom-right.
	 *
	 * With `onfavourite` and `onrate`, both are edited on the tile itself
	 * (doc/LIBRARY.md): the top-right corner toggles FAV in one tap, and the
	 * rating bars open the blocky slider over the foot of the tile. Neither opens
	 * the series, and neither is offered while selecting, when every tap is a
	 * pick.
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
		languages = [],
		onpress,
		onlongpress,
		onfavourite,
		onrate,
		focusId,
		startFocus = false,
		meta = ''
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
		/** A folded book's languages, the one it opens in first (doc/EDITIONS.md). */
		languages?: string[];
		onpress?: () => void;
		onlongpress?: () => void;
		onfavourite?: (on: boolean) => void;
		onrate?: (rating: Rating) => void;
		/** Where focus comes back to after a trip away (doc/FOCUS.md). */
		focusId?: string;
		/** The screen's first arrow lands here (doc/FOCUS.md). */
		startFocus?: boolean;
		/** The TV focus line's second line: kind, progress, +N, FAV (c238). */
		meta?: string;
	} = $props();

	const editable = $derived(!selectable);
	let picking = $state(false);
	let tile = $state<HTMLElement | null>(null);

	// The picker closes on a tap anywhere else, or Esc, without choosing.
	$effect(() => {
		if (!picking) return;
		const away = (e: PointerEvent) => {
			if (!tile?.contains(e.target as Node)) picking = false;
		};
		const esc = (e: KeyboardEvent) => {
			if (e.key === 'Escape') picking = false;
		};
		window.addEventListener('pointerdown', away, true);
		window.addEventListener('keydown', esc);
		return () => {
			window.removeEventListener('pointerdown', away, true);
			window.removeEventListener('keydown', esc);
		};
	});
	$effect(() => {
		if (!editable) picking = false;
	});

	function rate(n: Rating) {
		picking = false;
		if (n !== rating) onrate?.(n);
	}

	const HOLD_MS = 450;
	const SLOP_PX = 10;
	let timer: ReturnType<typeof setTimeout> | null = null;
	let start: { x: number; y: number } | null = null;
	let longFired = false;

	/**
	 * The menu came from a pointer. Only then is a click on its heels the
	 * release's own, to swallow: MENU and a held OK send no click at all, and
	 * swallowing the next one would eat the press that follows.
	 */
	let fromPointer = false;

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
		fromPointer = true;
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
		longFired = longFired || fromPointer;
		fromPointer = false;
	}
</script>

{#if indexing}
	<div class="tile" data-state="indexing">
		<Cover hue={0} dashed label="indexing" />
		<div class="skel-title"></div>
		<div class="skel-rating"></div>
	</div>
{:else}
	<div class="tile" class:dimmed bind:this={tile} data-hover="group">
		<button
			type="button"
			class="open"
			data-hover="off"
			aria-pressed={selectable ? selected : undefined}
			data-focus-id={focusId}
			data-focus-start={startFocus ? '' : undefined}
			data-focus-line={meta ? '' : undefined}
			data-focus-title={meta ? title : undefined}
			data-focus-meta={meta || undefined}
			data-focus-rating={meta ? rating : undefined}
			onpointerdown={down}
			onpointermove={move}
			onpointerup={() => timer && cancel()}
			onpointercancel={cancel}
			onpointerleave={cancel}
			onclick={click}
			oncontextmenu={contextmenu}
		>
			<Cover {src} {hue} ring={selected} stripeTitle={title}>
				{#if hidden}<Badge tone="reveal" corner="top-left">HIDDEN</Badge>{/if}
				{#if favourite && !(editable && onfavourite)}
					<Badge tone="accent" corner="top-right">FAV</Badge>
				{/if}
				{#if newCount > 0}<Badge corner="bottom-left">+{newCount}</Badge>
				{:else if languages.length > 1}<Badge corner="bottom-left">{languages.join(' · ')}</Badge
					>{/if}
				{#if cached != null}<Badge tone="inverse" corner="bottom-right">↓ {cached}</Badge>{/if}
				{#if selectable}
					<span class="check" class:on={selected} aria-hidden="true">{selected ? '✓' : ''}</span>
				{/if}
			</Cover>
			<span class="title">{title}</span>
		</button>

		{#if editable && onrate}
			<button
				type="button"
				class="rating"
				aria-label={rating === 0 ? 'Rate, unrated' : `Rate, rated ${rating} of 10`}
				aria-expanded={picking}
				data-focus-skip
				onclick={() => (picking = !picking)}
			>
				<RatingBars value={rating} />
			</button>
		{:else}
			<RatingBars value={rating} />
		{/if}

		{#if editable && onfavourite}
			<button
				type="button"
				class="fav"
				aria-label="Favourite"
				aria-pressed={favourite}
				data-focus-skip
				onclick={() => onfavourite(!favourite)}
			>
				{#if favourite}
					<Badge tone="accent" corner="top-right">FAV</Badge>
				{:else}
					<span class="ghost" aria-hidden="true">☆</span>
				{/if}
			</button>
		{/if}

		{#if picking}
			<!-- The blocky slider, compact at the tile's foot: the handoff doesn't draw this one (doc/SERIES.md, "Rating"). -->
			<div class="picker">
				<RatingSlider
					value={rating}
					label={null}
					height={44}
					phoneHeight={44}
					zeroWidth={28}
					phoneZeroWidth={24}
					borderTop={false}
					borderBottom={false}
					fontSize={14}
					onchange={(n) => rate(n as Rating)}
				/>
			</div>
		{/if}
	</div>
{/if}

<style>
	.tile {
		position: relative;
		background: var(--surface-page);
		padding: 10px;
		display: flex;
		flex-direction: column;
		gap: 8px;
		min-width: 0;
		container-type: inline-size;
	}
	button {
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
		background: transparent;
		padding: 0;
	}
	.open {
		display: flex;
		flex-direction: column;
		gap: 8px;
		min-width: 0;
	}
	/*
	 * The mark is around the cover, not the button: the tile's title is not
	 * what a D-pad user is pointing at (doc/FOCUS.md, "The mark").
	 */
	.open:focus-visible {
		box-shadow: none;
	}
	.open:focus-visible :global(.cover) {
		box-shadow: var(--focus-ring);
	}
	.tile:has(.open:active) {
		background: var(--surface-inverse);
		color: var(--text-inverse);
	}
	/* The bars are 4px; the button reaches into the gap above and the padding
	   below so a finger finds it, and across the tile's padding so its hover
	   runs the tile's full width (c487), without moving anything. */
	.rating {
		display: block;
		padding: 8px 10px;
		margin: -8px -10px;
	}
	.fav {
		position: absolute;
		top: 10px;
		right: 10px;
		width: 44px;
		height: 44px;
	}
	.ghost {
		position: absolute;
		top: 0;
		right: 0;
		padding: 2px 5px;
		font: var(--type-badge);
		background: var(--surface-page);
		color: var(--text-2);
		opacity: 0.75;
	}
	.picker {
		position: absolute;
		left: 0;
		right: 0;
		bottom: 0;
		z-index: 2;
		border-top: var(--rule-strong);
		background: var(--surface-page);
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
	/*
	 * The TV (c238; TV-Library): the cover is the tile. At 144px a caption is
	 * a dozen unreadable characters, and the focus line under the tabs names
	 * the cover in full. FAV and the rating are the tile's options (a held OK,
	 * c235), not two more stops a 6-wide grid has to walk, so their buttons
	 * and the bars leave the cell.
	 */
	@media (pointer: none) and (min-width: 900px) {
		.open {
			gap: 0;
		}
		.title,
		.rating,
		.ghost {
			display: none;
		}
	}
</style>

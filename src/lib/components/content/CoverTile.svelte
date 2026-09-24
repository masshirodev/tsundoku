<script lang="ts">
	import Cover from './Cover.svelte';
	import Badge from './Badge.svelte';
	import RatingBars from './RatingBars.svelte';
	import { RATING_OPTIONS } from '$lib/library/rating';
	import type { Rating } from '$lib/library/types';

	/**
	 * One cell of the library grid. Badges are pinned flush to the cover's
	 * corners: FAV top-right, +N bottom-left, HIDDEN top-left, ↓N bottom-right.
	 *
	 * With `onfavourite` and `onrate`, both are edited on the tile itself
	 * (doc/LIBRARY.md): the top-right corner toggles FAV in one tap, and the
	 * rating bars open the six cells over the foot of the tile. Neither opens
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
		onrate
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
	<div class="tile" class:dimmed bind:this={tile}>
		<button
			type="button"
			class="open"
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
				aria-label={rating === 0 ? 'Rate, unrated' : `Rate, rated ${rating} of 5`}
				aria-expanded={picking}
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
			<div class="picker" role="group" aria-label="Rating">
				{#each RATING_OPTIONS as n (n)}
					<button
						type="button"
						class="cell"
						class:on={n > 0 && n <= rating}
						class:muted={rating === 0}
						aria-pressed={rating !== 0 && n === rating}
						aria-label={n === 0 ? 'Unrated' : `Rate ${n}`}
						onclick={() => rate(n)}>{n}</button
					>
				{/each}
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
	.tile:has(.open:active) {
		background: var(--surface-inverse);
		color: var(--text-inverse);
	}
	/* The bars are 4px; the button reaches into the gap above and the padding
	   below so a finger finds it, without moving anything. */
	.rating {
		display: block;
		padding: 8px 0;
		margin: -8px 0;
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
		display: grid;
		grid-template-columns: repeat(6, 1fr);
		border-top: var(--rule-strong);
		background: var(--surface-page);
	}
	.cell {
		height: 44px;
		border-right: var(--hairline);
		font: 500 15px var(--font-mono);
		text-align: center;
		color: var(--text-1);
	}
	.cell:last-child {
		border-right: 0;
	}
	.cell.muted {
		color: var(--text-2);
	}
	.cell.on {
		background: var(--accent);
		color: var(--on-accent);
	}
	/* A phone column is too narrow for six cells a finger can tell apart. */
	@container (max-width: 180px) {
		.picker {
			grid-template-columns: repeat(3, 1fr);
		}
		.cell:nth-child(3) {
			border-right: 0;
		}
		.cell:nth-child(-n + 3) {
			border-bottom: var(--hairline);
		}
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

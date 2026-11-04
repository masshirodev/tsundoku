<script lang="ts">
	import { goto } from '$app/navigation';
	import { MediaQuery } from 'svelte/reactivity';
	import { TV } from '$lib/device.svelte';
	import { halfOn, minLabel, readout, valueAt, type SliderMode } from '$lib/library/rating';

	/**
	 * The blocky slider (Ratings out of 10.dc.html, RatingSlider.dc.html; card
	 * c67): five blocks, each split in two. Press anywhere on the row and drag:
	 * it snaps to halves, a readout above the finger says where it is, and it
	 * commits when the finger lifts. A tap is a drag that didn't move. 0 is its
	 * own cell at the left, and dragging off the left end clears too.
	 *
	 * How it commits, whichever the caller gives:
	 * - `onchange`: a callback (the series row, which saves behind the value);
	 * - `name`: each half is a submit button with its value, so the slider
	 *   works in a plain form without script, and a drag submits the half it
	 *   ended on (the library sheet, the bulk bar);
	 * - `href` (mode 'min'): each half is a link with the threshold in its URL,
	 *   as shelves are links (the RATED shelf, turn 2).
	 *
	 * The chosen half is `aria-pressed` (a link: `aria-current`), as the old
	 * picker's cell was: the fill alone is only visual. An unsaved choice
	 * stays chosen; NOT SAVED is what says it didn't take.
	 *
	 * Mode 'min' is a threshold: filled from the value up, no 0 cell, the
	 * number written in the five steps ("4+"), and a count cell at the end.
	 * Sizes are the mock's per device: the `phone*` ones apply under 600px, by
	 * media query, so the first paint is right.
	 */
	let {
		value,
		mode = 'rate',
		label = 'RATING',
		labelWidth = 120,
		phoneLabelWidth = 84,
		height = 64,
		phoneHeight = 52,
		zeroWidth = 64,
		phoneZeroWidth = 36,
		pad = 24,
		phonePad = 16,
		fontSize = 16,
		borderTop = true,
		borderBottom = true,
		showNum = true,
		unsaved = false,
		name,
		onchange,
		href,
		fav,
		count,
		disabled = false
	}: {
		/** The rating (0-10) or threshold (1-10). Undefined is the bulk bar: several series, no one value. */
		value?: number;
		mode?: SliderMode;
		label?: string | null;
		/** Null lets the label size to its text (the bulk bar's RATE). */
		labelWidth?: number | null;
		phoneLabelWidth?: number | null;
		height?: number;
		phoneHeight?: number;
		zeroWidth?: number;
		phoneZeroWidth?: number;
		pad?: number;
		phonePad?: number;
		fontSize?: number;
		borderTop?: boolean;
		/** Off inside a row that draws its own, as the book sheet's does. */
		borderBottom?: boolean;
		showNum?: boolean;
		/** A save that failed (1g): NOT SAVED, the blocks empty, one dashed outline around the span. */
		unsaved?: boolean;
		name?: string;
		onchange?: (n: number) => void;
		href?: (n: number) => string;
		/** The series row's FAV, at the slider's end (1a). */
		fav?: {
			on: boolean;
			onclick: () => void;
			unsaved?: boolean;
			width?: number;
			phoneWidth?: number;
		} | null;
		/** The threshold's count cell, where FAV would be (turn 2). */
		count?: { text: string; sub: string; width?: number; phoneWidth?: number } | null;
		disabled?: boolean;
	} = $props();

	const bulk = $derived(value === undefined);
	const tvScreen = new MediaQuery(TV, false);
	let drag = $state<number | null>(null);
	/** The bulk bar fills under the finger and while the save goes, then empties (1c). */
	let flash = $state<number | null>(null);
	let flashTimer: ReturnType<typeof setTimeout> | undefined;
	let track = $state<HTMLElement | null>(null);

	const stored = $derived(bulk ? (flash ?? 0) : (value ?? 0));
	const shown = $derived(drag ?? stored);
	const on = $derived(unsaved ? 0 : shown);
	const labelTop = $derived(
		unsaved
			? 'NOT SAVED'
			: bulk || label === null
				? (label ?? '')
				: label === 'RATING' && shown === 0
					? 'UNRATED'
					: label
	);
	const numText = $derived(mode === 'min' ? minLabel(shown) : String(shown));
	const bubble = $derived(drag !== null ? readout(drag, mode) : null);
	const bubbleX = $derived(drag === null || drag === 0 ? 0 : (drag - 0.5) * 10);

	function flashBulk(n: number) {
		if (!bulk) return;
		flash = n;
		clearTimeout(flashTimer);
		flashTimer = setTimeout(() => (flash = null), 700);
	}
	function commit(n: number) {
		flashBulk(n);
		if (onchange) onchange(n);
		// eslint-disable-next-line svelte/no-navigation-without-resolve -- the caller's href resolves (minHref)
		else if (href) void goto(href(n));
		else if (name) {
			const button = track?.parentElement?.querySelector<HTMLButtonElement>(
				`button[name="${name}"][value="${n}"]`
			);
			button?.form?.requestSubmit(button);
		}
	}

	function down(e: PointerEvent) {
		if (disabled || !track || e.button > 0) return;
		track.setPointerCapture(e.pointerId);
		const r = track.getBoundingClientRect();
		drag = valueAt(e.clientX - r.left, r.width, mode);
	}
	function move(e: PointerEvent) {
		if (drag === null || !track) return;
		const r = track.getBoundingClientRect();
		const n = valueAt(e.clientX - r.left, r.width, mode);
		if (n !== drag) drag = n;
	}
	function up() {
		if (drag === null) return;
		const n = drag;
		drag = null;
		commit(n);
	}

	/**
	 * The TV's rating (c238; TV-Series, state 4C): ← → move the value by half a
	 * bar and save as it changes, rather than walking the ten half-cells; OK or
	 * BACK leaves. The focus layer keeps these two keys for whatever sits
	 * inside `[data-focus-adjust]` (doc/FOCUS.md), so ↑ ↓ still leave the row.
	 */
	function adjust(e: KeyboardEvent) {
		// The focus layer already moved focus for this key: the row did not keep it.
		if (!tvScreen.current || disabled || e.defaultPrevented) return;
		if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
		e.preventDefault();
		const floor = mode === 'min' ? 1 : 0;
		commit(Math.min(10, Math.max(floor, shown + (e.key === 'ArrowRight' ? 1 : -1))));
	}

	const blocks = [0, 1, 2, 3, 4];
	const style = $derived(
		[
			`--rs-h:${height}px`,
			`--rs-h-p:${phoneHeight}px`,
			`--rs-label-w:${labelWidth === null ? 'auto' : `${labelWidth}px`}`,
			`--rs-label-w-p:${phoneLabelWidth === null || labelWidth === null ? 'auto' : `${phoneLabelWidth}px`}`,
			`--rs-label-pr:${labelWidth === null ? `${pad}px` : '0px'}`,
			`--rs-zero-w:${zeroWidth}px`,
			`--rs-zero-w-p:${phoneZeroWidth}px`,
			`--rs-pad:${pad}px`,
			`--rs-pad-p:${phonePad}px`,
			`--rs-font:${fontSize}px`,
			`--rs-fav-w:${fav?.width ?? 96}px`,
			`--rs-fav-w-p:${fav?.phoneWidth ?? 60}px`,
			`--rs-count-w:${count?.width ?? 96}px`,
			`--rs-count-w-p:${count?.phoneWidth ?? 60}px`,
			`--rs-pct:${shown * 10}%`
		].join(';')
	);
</script>

<div
	class="rs"
	class:top={borderTop}
	class:bottom={borderBottom}
	class:min={mode === 'min'}
	class:disabled
	{style}
>
	{#if label !== null}
		<div class="lab">
			<div class="lab-top" class:alert={unsaved}>{labelTop}</div>
			{#if showNum && !bulk && shown > 0}<div class="num">{numText}</div>{/if}
		</div>
	{/if}
	{#if mode === 'rate'}
		{#if name}
			<button
				type="submit"
				class="zero"
				{name}
				value="0"
				aria-label="Unrated"
				{disabled}
				data-focus-adjust={tvScreen.current ? '' : undefined}
				onkeydown={adjust}
				onclick={() => flashBulk(0)}>0</button
			>
		{:else}
			<button
				type="button"
				class="zero"
				aria-label="Unrated"
				{disabled}
				data-focus-adjust={tvScreen.current ? '' : undefined}
				onkeydown={adjust}
				onclick={() => commit(0)}>0</button
			>
		{/if}
	{/if}
	<div
		class="track"
		bind:this={track}
		role="group"
		aria-label={mode === 'min' ? 'At least' : 'Rating'}
		data-focus-adjust={tvScreen.current ? '' : undefined}
		onpointerdown={down}
		onpointermove={move}
		onpointerup={up}
		onpointercancel={() => (drag = null)}
	>
		{#each blocks as k (k)}
			{@const l = k * 2}
			{@const lf = halfOn(l, on, mode)}
			{@const rf = halfOn(l + 1, on, mode)}
			<div class="block" class:last={k === 4}>
				{#each [l + 1, l + 2] as n, h (n)}
					{@const filled = h === 0 ? lf : rf}
					{@const said = mode === 'min' ? `At least ${minLabel(n)}` : `Rate ${n} of 10`}
					{@const chosen = !bulk && n === stored}
					{#if href}
						<!-- eslint-disable svelte/no-navigation-without-resolve -- the caller's href resolves (minHref) -->
						<a
							class="half"
							data-hover="off"
							class:on={filled}
							href={href(n)}
							aria-label={said}
							aria-current={chosen ? 'true' : undefined}
							draggable="false"
							onkeydown={adjust}
						></a>
						<!-- eslint-enable svelte/no-navigation-without-resolve -->
					{:else if name}
						<button
							type="submit"
							class="half"
							data-hover="off"
							class:on={filled}
							{name}
							value={n}
							aria-label={said}
							aria-pressed={bulk ? undefined : chosen}
							{disabled}
							onkeydown={adjust}
						></button>
					{:else}
						<button
							type="button"
							class="half"
							data-hover="off"
							class:on={filled}
							aria-label={said}
							aria-pressed={chosen}
							{disabled}
							onkeydown={adjust}
							onclick={() => commit(n)}
						></button>
					{/if}
				{/each}
				<span class="tick t-top" class:full={lf && rf} class:split={lf !== rf}></span>
				<span class="tick t-bottom" class:full={lf && rf} class:split={lf !== rf}></span>
				<span class="digit" class:on={lf}>{k + 1}</span>
			</div>
		{/each}
		{#if unsaved && shown > 0}<div class="dash" aria-hidden="true"></div>{/if}
		{#if bubble}
			<div class="bubble" style:left="calc({bubbleX}% - 30px)" aria-live="polite">
				<span class="b-num">{bubble.num}</span>
				<span class="b-sub">{bubble.sub}</span>
			</div>
			<div class="stem" style:left="calc({bubbleX}% - 1px)"></div>
		{/if}
	</div>
	{#if fav}
		<button
			type="button"
			class="fav"
			class:on={fav.on}
			class:unsaved={fav.unsaved}
			aria-pressed={fav.on}
			{disabled}
			onclick={fav.onclick}>{fav.on ? 'FAV ✓' : 'FAV'}</button
		>
	{/if}
	{#if count}
		<div class="count">
			<div class="c-text">{count.text}</div>
			<div class="c-sub">{count.sub}</div>
		</div>
	{/if}
</div>

<style>
	/* RatingSlider.dc.html, transcribed: the mock's literals; colours are tokens. */
	.rs {
		position: relative;
		display: flex;
		align-items: stretch;
		height: var(--rs-h);
		color: var(--text-1);
		user-select: none;
		-webkit-user-select: none;
		--rs-tick: 8px;
		--rs-inset: 6px;
		--rs-dash: 7px;
	}
	.rs.top {
		border-top: 1px solid var(--line-1);
	}
	.rs.bottom {
		border-bottom: 1px solid var(--line-1);
	}
	.lab {
		display: flex;
		flex-direction: column;
		justify-content: center;
		gap: 5px;
		width: var(--rs-label-w);
		flex-shrink: 0;
		padding: 0 var(--rs-label-pr) 0 var(--rs-pad);
		border-right: 1px solid var(--line-1);
	}
	.lab-top {
		font: 500 12px var(--font-mono);
		letter-spacing: 0.06em;
		color: var(--text-2);
		white-space: nowrap;
	}
	.lab-top.alert {
		color: var(--text-1);
	}
	.num {
		font: 500 16px/1 var(--font-mono);
		white-space: nowrap;
	}
	.zero {
		width: var(--rs-zero-w);
		flex-shrink: 0;
		border: 0;
		border-right: 1px solid var(--line-1);
		border-radius: 0;
		padding: 0;
		background: transparent;
		color: var(--text-2);
		font: 500 var(--rs-font) var(--font-mono);
		cursor: pointer;
	}
	.zero:active {
		background: var(--surface-inverse);
		color: var(--text-inverse);
	}
	.track {
		position: relative;
		flex: 1;
		min-width: 0;
		display: grid;
		grid-template-columns: repeat(5, minmax(0, 1fr));
		touch-action: none;
		cursor: pointer;
	}
	.block {
		position: relative;
		display: flex;
		border-right: 1px solid var(--line-1);
	}
	.block.last {
		border-right: 0;
	}
	.half {
		flex: 1;
		min-width: 0;
		display: block;
		border: 0;
		border-radius: 0;
		padding: 0;
		background: transparent;
		cursor: pointer;
		-webkit-user-drag: none;
	}
	.half.on {
		background: var(--rating-on);
	}
	.half:focus-visible {
		outline: 2px solid var(--text-1);
		outline-offset: -2px;
	}
	/*
	 * Hovering previews the value a click would set (c494): a rating is a
	 * level, so every half from the start to the pointer, not the one cell
	 * under it (each half opts out of the app's own hover tint for this). A
	 * half it would add is a light fill, never the real one; a filled half it
	 * would take away is hatched, so hovering below the rating shows where it
	 * drops to, and the 0 cell hatches all of it. 'min' fills from the
	 * pointer up, so its preview runs that way. CSS alone, so a slider in a
	 * plain form previews too; a drag captures the pointer, and draws itself.
	 */
	@media (hover: hover) and (pointer: fine) {
		.rs {
			--rs-preview: color-mix(in oklab, var(--rating-on) 30%, transparent);
			--rs-drop: repeating-linear-gradient(135deg, var(--rating-on) 0 2px, transparent 2px 6px);
		}
		.rs:not(.disabled, .min)
			:is(.half:hover, .half:has(~ .half:hover), .block:has(~ .block .half:hover) .half):not(.on),
		.rs.min:not(.disabled)
			:is(.half:hover, .half:hover ~ .half, .block:has(.half:hover) ~ .block .half):not(.on) {
			background-color: var(--rs-preview);
		}
		.rs:not(.disabled, .min) :is(.half:hover ~ .half, .block:has(.half:hover) ~ .block .half).on,
		.rs:not(.disabled, .min):has(.zero:hover) .half.on,
		.rs.min:not(.disabled)
			:is(.half:has(~ .half:hover), .block:has(~ .block .half:hover) .half).on {
			background: var(--rs-drop);
		}
	}
	.tick {
		position: absolute;
		left: 50%;
		width: 1px;
		height: var(--rs-tick);
		background: var(--line-2);
		pointer-events: none;
	}
	.t-top {
		top: 0;
	}
	.t-bottom {
		bottom: 0;
	}
	.tick.full {
		background: oklch(0 0 0 / 0.22);
	}
	.tick.split {
		background: transparent;
	}
	.digit {
		position: absolute;
		left: var(--rs-inset);
		bottom: var(--rs-inset);
		font: 500 11px/1 var(--font-mono);
		color: var(--text-2);
		pointer-events: none;
	}
	.digit.on {
		color: var(--on-accent);
	}
	.dash {
		position: absolute;
		left: var(--rs-dash);
		top: var(--rs-dash);
		bottom: var(--rs-dash);
		width: calc(var(--rs-pct) - 2 * var(--rs-dash));
		outline: 1.5px dashed var(--accent);
		pointer-events: none;
	}
	.bubble {
		position: absolute;
		bottom: calc(100% + 8px);
		width: 60px;
		height: 52px;
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		gap: 4px;
		background: var(--surface-inverse);
		color: var(--text-inverse);
		pointer-events: none;
		z-index: 3;
	}
	.b-num {
		font: 500 20px/1 var(--font-mono);
	}
	.b-sub {
		font: 500 10px/1 var(--font-mono);
		letter-spacing: 0.06em;
	}
	.stem {
		position: absolute;
		bottom: 100%;
		width: 2px;
		height: 8px;
		background: var(--surface-inverse);
		pointer-events: none;
		z-index: 3;
	}
	.fav {
		width: var(--rs-fav-w);
		flex-shrink: 0;
		border: 0;
		border-left: 1px solid var(--line-1);
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
	/* Not stored yet (Loading States 1o): dashed, Index's mark for it. */
	.fav.unsaved {
		background: transparent;
		color: var(--accent);
		outline: 1.5px dashed var(--accent);
		outline-offset: -7px;
	}
	.fav:active:not(.on) {
		background: var(--surface-inverse);
		color: var(--text-inverse);
	}
	.count {
		width: var(--rs-count-w);
		flex-shrink: 0;
		display: flex;
		flex-direction: column;
		justify-content: center;
		gap: 5px;
		padding: 0 16px;
		border-left: 1px solid var(--line-1);
	}
	.c-text {
		font: 500 16px/1 var(--font-mono);
	}
	.c-sub {
		font: 500 11px/1 var(--font-mono);
		letter-spacing: 0.06em;
		color: var(--text-2);
	}
	.disabled .track,
	.disabled .zero,
	.disabled .fav {
		opacity: 0.35;
		cursor: default;
	}
	@media (max-width: 599px) {
		.rs {
			height: var(--rs-h-p);
			--rs-tick: 6px;
			--rs-inset: 4px;
			--rs-dash: 4px;
		}
		.lab {
			width: var(--rs-label-w-p);
			padding-left: var(--rs-pad-p);
		}
		.zero {
			width: var(--rs-zero-w-p);
		}
		.fav {
			width: var(--rs-fav-w-p);
		}
		.count {
			width: var(--rs-count-w-p);
			padding: 0 10px;
		}
	}
	/* ---- the TV (c238; TV-Series, state 4C) ------------------------------- */
	@media (pointer: none) and (min-width: 900px) {
		/* A narrower label and FAV leave the blocks room to be seen from the
		   couch; the instance's inline sizes are the tablet's, so !important. */
		.rs {
			--rs-label-w: 84px !important;
			--rs-zero-w: 44px !important;
			--rs-fav-w: 76px !important;
		}
		.lab-top {
			font: var(--type-label);
		}
		.num {
			font-size: 17px;
		}
		.digit {
			font-size: 13px;
		}
		.fav {
			font: var(--type-control);
		}
		/* The actions are one closed block: the mark frames the row, not the
		   half-cell the arrows are standing on. */
		.half:focus-visible,
		.zero:focus-visible,
		.fav:focus-visible {
			outline: none;
			box-shadow: none;
		}
		.rs:has(.half:focus-visible),
		.rs:has(.zero:focus-visible),
		.rs:has(.fav:focus-visible) {
			box-shadow: var(--focus-ring-in);
		}
	}
</style>

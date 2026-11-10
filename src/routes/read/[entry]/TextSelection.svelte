<script lang="ts">
	import { leave } from '$lib/motion';

	/**
	 * What a selection in the text reader puts on the page (Highlights H2, c702;
	 * Novel N1 to N3, N8, D1): the two square handles, the bar over it, and at a
	 * paged page's end HOLD TO TURN →. The words themselves are tinted in place
	 * (`src/lib/reader/text-marks.ts`); this draws what stands over them.
	 *
	 * The bar is left out, never dimmed, where a cell has no answer: LOOK UP
	 * without a language pack, HIGHLIGHT and NOTE in incognito, where a first
	 * cell says why (Main 02, INCOGNITO MAKES NONE).
	 */
	type Point = { x: number; y: number; h: number };
	let {
		bar,
		start,
		end,
		vertical,
		dragging,
		cue,
		incognito,
		canKeep,
		lookUp,
		fine,
		copied,
		onwidth,
		onhandle,
		onkeep,
		onnote,
		oncopy,
		onlookup
	}: {
		/** Null while dragging or with no line on this page. */
		bar: { left: number; top: number } | null;
		start: Point | null;
		end: Point | null;
		vertical: boolean;
		dragging: boolean;
		cue: boolean;
		incognito: boolean;
		canKeep: boolean;
		lookUp: boolean;
		/** A mouse is the pointer here: the keys are shown on their cells (Novel D1). */
		fine: boolean;
		copied: boolean;
		onwidth: (w: number) => void;
		onhandle: (edge: 'start' | 'end', e: PointerEvent) => void;
		onkeep: () => void;
		onnote: () => void;
		oncopy: () => void;
		onlookup: () => void;
	} = $props();

	let width = $state(0);
	$effect(() => {
		if (width) onwidth(width);
	});
</script>

<!-- While a handle moves the layer lets the point through, or the caret finds the handle. -->
<div class="layer" class:dragging class:vertical>
	{#each [['start', start], ['end', end]] as const as [edge, p] (edge)}
		{#if p}
			<div
				class="hd {edge}"
				role="presentation"
				style:left="{p.x}px"
				style:top="{p.y}px"
				style:--h="{p.h}px"
				onpointerdown={(e) => onhandle(edge, e)}
			></div>
		{/if}
	{/each}
</div>

{#if bar}
	<div
		class="sb appear"
		out:leave
		role="toolbar"
		aria-label="Selection"
		style:left="{bar.left}px"
		style:top="{bar.top}px"
		bind:clientWidth={width}
	>
		{#if incognito}<span class="x">INCOGNITO</span>{/if}
		{#if canKeep}
			<button type="button" onclick={onkeep}
				>HIGHLIGHT{#if fine}<span class="key">H</span>{/if}</button
			>
			<button type="button" onclick={onnote}
				>NOTE{#if fine}<span class="key">N</span>{/if}</button
			>
		{/if}
		<button type="button" onclick={oncopy}>{copied ? '✓ COPIED' : 'COPY'}</button>
		{#if lookUp}
			<button type="button" onclick={onlookup}
				>LOOK UP{#if fine}<span class="key">L</span>{/if}</button
			>
		{/if}
	</div>
{/if}

{#if cue}
	<div class="hold" aria-live="polite">
		<div class="cue">HOLD TO TURN →</div>
	</div>
{/if}

<style>
	.layer {
		position: absolute;
		inset: 0;
		z-index: 28;
		pointer-events: none;
	}
	.hd {
		position: absolute;
		pointer-events: auto;
		touch-action: none;
		cursor: grab;
		width: 44px;
		height: 44px;
		margin-left: -22px;
	}
	.layer.dragging .hd {
		pointer-events: none;
	}
	/* Novel N2's handles, transcribed: a 2px bar the line's height and a 14px square. */
	.hd::before,
	.hd::after {
		content: '';
		position: absolute;
		background: var(--hl-accent);
	}
	.hd::before {
		left: 21px;
		width: 2px;
		height: var(--h);
	}
	.hd::after {
		left: 15px;
		width: 14px;
		height: 14px;
	}
	/* The start stands on the line's top with its square over it, the end under its foot. */
	.hd.start {
		margin-top: -14px;
	}
	.hd.start::before {
		top: 14px;
	}
	.hd.start::after {
		top: 0;
	}
	.hd.end {
		margin-top: calc(var(--h) * -1);
	}
	.hd.end::before {
		top: 0;
	}
	.hd.end::after {
		top: calc(var(--h) - 4px);
	}
	/* Vertical: the bar is across the column, the square at its end (Novel J3). */
	.vertical .hd::before {
		width: var(--h);
		height: 2px;
		left: calc(22px - var(--h) / 2);
	}
	.vertical .hd.start::before {
		top: 0;
	}
	.vertical .hd.start::after {
		left: calc(22px + var(--h) / 2 - 7px);
		top: -6px;
	}
	.vertical .hd.end::before {
		top: 0;
	}
	.vertical .hd.end::after {
		left: calc(22px - var(--h) / 2 - 7px);
		top: -6px;
	}
	.sb {
		position: absolute;
		z-index: 28;
		display: flex;
		background: var(--surface-inverse);
		color: var(--text-inverse);
		font: 500 13px/1 var(--font-mono);
		letter-spacing: 0.06em;
	}
	.sb > * {
		display: flex;
		align-items: center;
		height: 48px;
		padding: 0 16px;
		border: 0;
		border-left: 1px solid color-mix(in oklab, var(--text-inverse) 35%, transparent);
		background: transparent;
		color: inherit;
		font: inherit;
		letter-spacing: inherit;
		white-space: nowrap;
		cursor: pointer;
	}
	.sb > *:first-child {
		border-left: 0;
	}
	.sb .x {
		opacity: 0.4;
		cursor: default;
	}
	.key {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		min-width: 20px;
		height: 20px;
		margin-left: 8px;
		padding: 0 5px;
		border: 1px solid currentColor;
		font: 500 11px/1 var(--font-mono);
		opacity: 0.55;
	}
	/* Novel N3: the bottom strip, the cue at its end. */
	.hold {
		position: absolute;
		left: 0;
		right: 0;
		bottom: 0;
		z-index: 28;
		display: flex;
		justify-content: flex-end;
		align-items: stretch;
		height: 64px;
		border-top: 1px dashed var(--line-2);
		pointer-events: none;
	}
	.cue {
		display: flex;
		align-items: center;
		padding: 0 18px;
		background: var(--surface-inverse);
		color: var(--text-inverse);
		font: 500 13px/1 var(--font-mono);
		letter-spacing: 0.06em;
	}
</style>

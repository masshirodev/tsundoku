<script lang="ts">
	import { leave } from '$lib/motion';
	import HelpSheet from '$lib/components/help/HelpSheet.svelte';
	import { resolve } from '$app/paths';
	import { modeName, type Fit, type Mode, type Wide } from '$lib/reader/reader';
	import type { BlocksShown } from '$lib/japanese/blocks';
	import { resetZoom, stepZoom, zoomLabel } from '$lib/reader/zoom';
	import RatingSlider from '$lib/components/controls/RatingSlider.svelte';
	import { focusScope } from '$lib/focus';
	import { MediaQuery } from 'svelte/reactivity';
	import { TV } from '$lib/device.svelte';

	/**
	 * READING (Index Reader, state 1b with the sheet): mode, fit, spreads, crop
	 * borders, wide pages, sides, dim
	 * and the rating, over a scrim. A row that doesn't apply is dimmed with the
	 * reason, not removed, so the sheet doesn't jump when MODE changes (the
	 * addendum's rule). Mode is this session's until REMEMBER makes it the
	 * series'; fit, spreads, crop, wide pages, sides and dim belong to the device.
	 *
	 * On a TV it is a focus scope and a 420px panel from the right (c241;
	 * TV-Reader 7E): the pad lands on the mode in use, ← → step between a row's
	 * values and ↑ ↓ move between rows, and the pages stay in view at the left.
	 */
	let {
		mode,
		seriesMode,
		fit,
		spreads,
		sides,
		wide,
		crop,
		landscape,
		dim,
		zoom = 1,
		keptZoom = 1,
		rating,
		blocks = null,
		onblocks = () => undefined,
		onmode,
		onremember,
		onfit,
		onspreads,
		onsides,
		onwide,
		oncrop,
		ondim,
		onzoom = () => undefined,
		onkeepzoom = () => undefined,
		onrate,
		onclose
	}: {
		mode: Mode;
		/** What the series reads as: its own direction, or its kind's default. */
		seriesMode: Mode;
		fit: Fit;
		spreads: boolean;
		/** Vertical: each side's margin, percent of the screen's width. */
		sides: number;
		/** A wide page outside spreads: whole, in halves, or turned. */
		wide: Wide;
		/** Paged: each page's plain border cropped away. */
		crop: boolean;
		landscape: boolean;
		/** 0 to 0.8. */
		dim: number;
		/** The session's zoom and the kept one for this mode on this screen (doc/READER.md, "Zoom"). */
		zoom?: number;
		keptZoom?: number;
		rating: number;
		/** A Japanese series: when its text blocks are outlined (doc/JAPANESE.md). Null hides the row. */
		blocks?: BlocksShown | null;
		onblocks?: (b: BlocksShown) => void;
		onmode: (m: Mode) => void;
		onremember: () => void;
		onfit: (f: Fit) => void;
		onspreads: (on: boolean) => void;
		onsides: (percent: number) => void;
		onwide: (w: Wide) => void;
		oncrop: (on: boolean) => void;
		ondim: (d: number) => void;
		onzoom?: (z: number) => void;
		onkeepzoom?: () => void;
		onrate: (r: number) => void;
		onclose: () => void;
	} = $props();

	const MODES: Mode[] = ['rtl', 'ltr', 'vertical'];
	const FITS: [Fit, string][] = [
		['width', 'WIDTH'],
		['height', 'HEIGHT'],
		['screen', 'SCREEN']
	];
	const SIDES = [0, 10, 20, 30];
	const BLOCKS: [BlocksShown, string][] = [
		['controls', 'WITH CONTROLS'],
		['always', 'ALWAYS'],
		['never', 'NEVER']
	];
	const WIDES: [Wide, string][] = [
		['fit', 'WHOLE'],
		['split', 'SPLIT'],
		['rotate', 'ROTATE']
	];
	const paged = $derived(mode !== 'vertical');
	const spreadsApply = $derived(paged && landscape);
	/** Wide pages are treated only where spreads aren't showing them whole. */
	const wideApplies = $derived(paged && !(spreadsApply && spreads));

	/** READING's "?": its rows give way to 02 — READING's In short (doc/HELP.md). */
	let asking = $state(false);
	const tvScreen = new MediaQuery(TV, false);

	let dimTrack = $state<HTMLElement | null>(null);
	let sliding = false;
	function dimAt(e: PointerEvent) {
		if (!dimTrack) return;
		const r = dimTrack.getBoundingClientRect();
		ondim(Math.round(Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)) * 80) / 100);
	}
</script>

<button
	type="button"
	class="scrim appear"
	aria-label="Close reading settings"
	onclick={onclose}
	out:leave
></button>
<div
	class="sheet rise"
	out:leave={'down'}
	role="dialog"
	aria-label="Reading settings"
	use:focusScope
>
	{#if asking}
		<!-- READING's "?" (doc/HELP.md; the HELP handoff, 2F): the same sheet changes,
		     rather than a second one stacking on it; ← READING brings the rows back. -->
		<HelpSheet
			content
			topic="reading"
			at="LEAVES THE CHAPTER · BACK RETURNS TO THIS PAGE"
			{onclose}
		>
			{#snippet back()}
				<button type="button" class="back-r" onclick={() => (asking = false)}
					><span class="arrow">←</span>READING</button
				>
			{/snippet}
		</HelpSheet>
	{:else}
		<div class="head">
			<div class="h">READING</div>
			<button
				type="button"
				class="x ask"
				aria-label="Help: reading"
				data-focus-mark="in"
				onclick={() => (asking = true)}>?</button
			>
			<button type="button" class="x" aria-label="Close" data-focus-mark="in" onclick={onclose}
				>✕</button
			>
		</div>

		<div class="row">
			<div class="label">MODE</div>
			<div class="body col">
				<div class="seg" role="radiogroup" aria-label="Mode">
					{#each MODES as m (m)}
						<button
							type="button"
							role="radio"
							aria-checked={mode === m}
							class:on={mode === m}
							data-focus-mark="in"
							data-focus-start={mode === m ? '' : undefined}
							onclick={() => onmode(m)}>{modeName(m)}</button
						>
					{/each}
				</div>
				<div class="under">
					<span class="note">SERIES DEFAULT {modeName(seriesMode)}</span>
					{#if mode !== seriesMode}
						<button type="button" class="remember" onclick={onremember}
							>REMEMBER {modeName(mode)}</button
						>
					{/if}
				</div>
			</div>
		</div>

		<div class="row">
			<div class="label">FIT</div>
			<div class="body col" class:off={!paged}>
				<div class="seg" role="radiogroup" aria-label="Fit">
					{#each FITS as [f, name] (f)}
						<button
							type="button"
							role="radio"
							aria-checked={paged ? fit === f : f === 'width'}
							class:on={paged ? fit === f : f === 'width'}
							disabled={!paged}
							data-focus-mark="in"
							onclick={() => onfit(f)}>{name}</button
						>
					{/each}
				</div>
				{#if !paged}<div class="under"><span class="note">VERTICAL FITS WIDTH</span></div>{/if}
			</div>
		</div>

		<div class="row">
			<div class="label">SPREADS</div>
			<div class="body split" class:off={!spreadsApply}>
				<button
					type="button"
					class="switch"
					role="switch"
					aria-checked={spreads}
					disabled={!spreadsApply}
					onclick={() => onspreads(!spreads)}
				>
					<span class="track" class:on={spreads}><span class="knob"></span></span>
					<span>{spreads ? 'ON' : 'OFF'}</span>
				</button>
				<span class="note">{paged ? 'LANDSCAPE ONLY' : 'PAGED ONLY'}</span>
			</div>
		</div>

		<!-- White or black margins around the art, measured on the workstation. -->
		<div class="row">
			<div class="label">CROP BORDERS</div>
			<div class="body split" class:off={!paged}>
				<button
					type="button"
					class="switch"
					role="switch"
					aria-checked={paged && crop}
					disabled={!paged}
					onclick={() => oncrop(!crop)}
				>
					<span class="track" class:on={paged && crop}><span class="knob"></span></span>
					<span>{paged && crop ? 'ON' : 'OFF'}</span>
				</button>
				<span class="note">{paged ? 'WHITE OR BLACK MARGINS' : 'PAGED ONLY'}</span>
			</div>
		</div>

		<!-- A page wider than it is tall, on a screen showing one page: split it or turn it. -->
		<div class="row">
			<div class="label">WIDE PAGES</div>
			<div class="body col" class:off={!wideApplies}>
				<div class="seg" role="radiogroup" aria-label="Wide pages">
					{#each WIDES as [w, name] (w)}
						<button
							type="button"
							role="radio"
							aria-checked={wideApplies && wide === w}
							class:on={wideApplies && wide === w}
							disabled={!wideApplies}
							data-focus-mark="in"
							onclick={() => onwide(w)}>{name}</button
						>
					{/each}
				</div>
				{#if !wideApplies}
					<div class="under">
						<span class="note">{paged ? 'SPREADS SHOW THEM WHOLE' : 'PAGED ONLY'}</span>
					</div>
				{/if}
			</div>
		</div>

		<!-- A strip fit to the width of a landscape tablet is enormous: margins bring it in. -->
		<div class="row">
			<div class="label">SIDES</div>
			<div class="body col" class:off={paged}>
				<div class="seg" role="radiogroup" aria-label="Side margins">
					{#each SIDES as n (n)}
						<button
							type="button"
							role="radio"
							aria-checked={!paged && sides === n}
							class:on={!paged && sides === n}
							disabled={paged}
							data-focus-mark="in"
							onclick={() => onsides(n)}>{n === 0 ? 'NONE' : `${n}%`}</button
						>
					{/each}
				</div>
				{#if paged}<div class="under"><span class="note">VERTICAL ONLY</span></div>{/if}
			</div>
		</div>

		<!-- Zoom (card c169): − and + step, RESET goes to the kept zoom and then 100%,
	     KEEP makes this one where every series of this mode starts on this screen. -->
		<div class="row">
			<div class="label">ZOOM</div>
			<div class="body col">
				<div class="seg" role="group" aria-label="Zoom">
					<button
						type="button"
						aria-label="Zoom out"
						data-focus-mark="in"
						onclick={() => onzoom(stepZoom(zoom, -1))}>−</button
					>
					<span class="zval" aria-live="polite">{zoomLabel(zoom)}</span>
					<button
						type="button"
						aria-label="Zoom in"
						data-focus-mark="in"
						onclick={() => onzoom(stepZoom(zoom, 1))}>+</button
					>
					<button
						type="button"
						disabled={zoom === 1 && keptZoom === 1}
						data-focus-mark="in"
						onclick={() => onzoom(resetZoom(zoom, keptZoom))}>RESET</button
					>
				</div>
				<div class="under">
					<span class="note"
						>{zoom === keptZoom
							? `EVERY ${paged ? 'PAGED' : 'VERTICAL'} SERIES STARTS HERE ON THIS SCREEN`
							: `KEPT: ${zoomLabel(keptZoom)}`}</span
					>
					{#if zoom !== keptZoom}
						<button type="button" class="remember" onclick={onkeepzoom}
							>KEEP FOR ALL {paged ? 'PAGED' : 'VERTICAL'}</button
						>
					{/if}
				</div>
			</div>
		</div>

		{#if blocks}
			<!-- Japanese: where the OCR'd text blocks are, outlined. A tap on one looks it up either way. -->
			<div class="row">
				<div class="label">BLOCKS</div>
				<div class="body col">
					<div class="seg" role="radiogroup" aria-label="Text blocks">
						{#each BLOCKS as [b, name] (b)}
							<button
								type="button"
								role="radio"
								aria-checked={blocks === b}
								class:on={blocks === b}
								data-focus-mark="in"
								onclick={() => onblocks(b)}>{name}</button
							>
						{/each}
					</div>
					<div class="under"><span class="note">OUTLINES OCR'D TEXT BLOCKS</span></div>
				</div>
			</div>
		{/if}

		<div class="row dim">
			<div class="label">DIM</div>
			<div class="body split">
				<div
					class="dimtrack"
					bind:this={dimTrack}
					role="slider"
					tabindex="0"
					aria-label="Dim"
					aria-valuemin={0}
					aria-valuemax={80}
					aria-valuenow={Math.round(dim * 100)}
					data-focus-adjust={tvScreen.current ? '' : undefined}
					onpointerdown={(e) => {
						sliding = true;
						(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
						dimAt(e);
					}}
					onpointermove={(e) => sliding && dimAt(e)}
					onpointerup={() => (sliding = false)}
					onkeydown={(e) => {
						if (e.key === 'ArrowRight') ondim(Math.min(0.8, Math.round((dim + 0.05) * 100) / 100));
						if (e.key === 'ArrowLeft') ondim(Math.max(0, Math.round((dim - 0.05) * 100) / 100));
					}}
				>
					<div class="dimfill" style:width="{(dim / 0.8) * 100}%"></div>
					<div class="dimthumb" style:left="{(dim / 0.8) * 100}%"></div>
				</div>
				<span class="pct">{Math.round(dim * 100)}%</span>
			</div>
		</div>

		<!-- Ratings out of 10: the blocky slider, as on the series screen. -->
		<RatingSlider value={rating} borderTop={false} fontSize={15} onchange={onrate} />
		<!-- ALL SETTINGS →: the page, at this sheet's section (Reach, readerSheet; card c171). -->
		<a class="all-settings" href="{resolve('/settings')}?section=images"
			><span>ALL SETTINGS →</span><span class="n">DEFAULTS, AND WHAT EACH ROW KEEPS</span></a
		>
		<div class="foot"></div>
	{/if}
</div>

<style>
	.all-settings {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 12px;
		min-height: 64px;
		padding: 0 var(--pad, 24px);
		border-top: var(--hairline);
		color: var(--text-1);
		text-decoration: none;
		font: 500 14px var(--font-mono);
	}
	.all-settings .n {
		font-weight: 400;
		font-size: 13px;
		color: var(--text-2);
		text-align: right;
	}
	button {
		border: 0;
		border-radius: 0;
		background: transparent;
		color: var(--text-1);
		cursor: pointer;
	}
	button:disabled {
		cursor: default;
	}
	.scrim {
		position: fixed;
		inset: 0;
		z-index: 30;
		background: var(--scrim);
	}
	.sheet {
		position: fixed;
		left: 0;
		right: 0;
		bottom: 0;
		z-index: 31;
		display: flex;
		flex-direction: column;
		border-top: var(--rule-strong);
		background: var(--surface-page);
		color: var(--text-1);
		max-height: 90dvh;
		overflow-y: auto;
	}
	.head {
		display: flex;
		align-items: stretch;
		height: 56px;
		border-bottom: var(--hairline);
	}
	.h {
		flex: 1;
		display: flex;
		align-items: center;
		padding: 0 24px;
		font: 500 13px var(--font-mono);
		letter-spacing: var(--tracking-label);
		color: var(--text-2);
	}
	.x {
		padding: 0 24px;
		border-left: var(--hairline);
		font: 500 18px var(--font-mono);
	}
	/* The "?" before ✕: a cell like it (Help Calls, D). */
	.x.ask {
		width: 56px;
		padding: 0;
	}
	.back-r {
		display: flex;
		align-items: center;
		gap: 10px;
		padding: 0 16px;
		border-right: var(--hairline);
		font: 500 14px var(--font-mono);
		letter-spacing: 0.04em;
		white-space: nowrap;
	}
	.back-r .arrow {
		font-size: 17px;
	}
	.row {
		display: flex;
		align-items: stretch;
		min-height: 64px;
		border-bottom: var(--hairline);
	}
	.row.dim {
		min-height: 72px;
	}
	.label {
		display: flex;
		align-items: center;
		width: 120px;
		flex-shrink: 0;
		padding: 0 24px;
		border-right: var(--hairline);
		font: 500 13px var(--font-mono);
		letter-spacing: var(--tracking-label);
		color: var(--text-2);
	}
	.body {
		flex: 1;
		min-width: 0;
		padding: 14px 18px;
	}
	.body.off {
		opacity: 0.4;
	}
	.col {
		display: flex;
		flex-direction: column;
		gap: 12px;
	}
	.split {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 18px;
		padding-top: 0;
		padding-bottom: 0;
	}
	.seg {
		display: flex;
		height: 48px;
		border: 1px solid var(--line-2);
	}
	.seg button {
		flex: 1;
		border-right: 1px solid var(--line-2);
		font: 500 14px var(--font-mono);
	}
	.seg button:last-child {
		border-right: 0;
	}
	.zval {
		flex: 1.4;
		display: flex;
		align-items: center;
		justify-content: center;
		border-right: 1px solid var(--line-2);
		font: 500 14px var(--font-mono);
	}
	.seg button.on {
		background: var(--surface-inverse);
		color: var(--text-inverse);
	}
	.under {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 12px;
		min-height: 44px;
	}
	.note {
		font: 400 13px var(--font-mono);
		color: var(--text-2);
	}
	.remember {
		display: flex;
		align-items: center;
		height: 44px;
		padding: 0 16px;
		background: var(--accent);
		color: var(--on-accent);
		font: 500 14px var(--font-mono);
	}
	.switch {
		display: flex;
		align-items: center;
		gap: 12px;
		font: 500 15px var(--font-mono);
	}
	.track {
		position: relative;
		width: 44px;
		height: 24px;
		border: 1px solid var(--line-2);
	}
	.knob {
		position: absolute;
		top: 2px;
		left: 2px;
		width: 18px;
		height: 18px;
		background: var(--text-2);
	}
	.track.on {
		border-color: var(--accent);
		background: var(--accent);
	}
	.track.on .knob {
		left: 22px;
		background: var(--on-accent);
	}
	.dimtrack {
		position: relative;
		flex: 1;
		height: 4px;
		background: var(--line-1);
		touch-action: none;
		cursor: pointer;
	}
	.dimtrack::before {
		content: '';
		position: absolute;
		inset: -20px 0;
	}
	.dimfill {
		height: 4px;
		background: var(--accent);
	}
	.dimthumb {
		position: absolute;
		top: -10px;
		width: 4px;
		height: 24px;
		margin-left: -2px;
		background: var(--text-1);
	}
	.pct {
		width: 44px;
		text-align: right;
		font: 500 14px var(--font-mono);
	}
	.foot {
		height: 24px;
		flex-shrink: 0;
	}
	/* On a TV, READING is a panel from the right (c241; TV-Reader 7E): the pages
	   stay in view at the left and change as a row does, and the panel is the
	   same 420px the other sheets are (Sheet.svelte), with the same 48px right
	   side -- that padding is what makes its content 372px wide. */
	@media (pointer: none) and (min-width: 900px) {
		.sheet {
			left: auto;
			right: 0;
			top: 0;
			bottom: 0;
			width: var(--tv-panel-w);
			max-height: none;
			height: 100dvh;
			border-top: 0;
			border-left: var(--rule-strong);
			padding: var(--safe-y) var(--pad) var(--safe-y) 0;
		}
	}
	@media (max-width: 599px) {
		.label {
			width: 88px;
			padding: 0 14px;
		}
	}
</style>

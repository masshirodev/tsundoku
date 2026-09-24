<script lang="ts">
	import { modeName, type Fit, type Mode, type Wide } from '$lib/reader/reader';
	import { RATING_OPTIONS } from '$lib/library/rating';

	/**
	 * READING (Index Reader, state 1b with the sheet): mode, fit, spreads, crop
	 * borders, wide pages, sides, dim
	 * and the rating, over a scrim. A row that doesn't apply is dimmed with the
	 * reason, not removed, so the sheet doesn't jump when MODE changes (the
	 * addendum's rule). Mode is this session's until REMEMBER makes it the
	 * series'; fit, spreads, crop, wide pages, sides and dim belong to the device.
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
		rating,
		onmode,
		onremember,
		onfit,
		onspreads,
		onsides,
		onwide,
		oncrop,
		ondim,
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
		rating: number;
		onmode: (m: Mode) => void;
		onremember: () => void;
		onfit: (f: Fit) => void;
		onspreads: (on: boolean) => void;
		onsides: (percent: number) => void;
		onwide: (w: Wide) => void;
		oncrop: (on: boolean) => void;
		ondim: (d: number) => void;
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
	const WIDES: [Wide, string][] = [
		['fit', 'WHOLE'],
		['split', 'SPLIT'],
		['rotate', 'ROTATE']
	];
	const paged = $derived(mode !== 'vertical');
	const spreadsApply = $derived(paged && landscape);
	/** Wide pages are treated only where spreads aren't showing them whole. */
	const wideApplies = $derived(paged && !(spreadsApply && spreads));

	let dimTrack = $state<HTMLElement | null>(null);
	let sliding = false;
	function dimAt(e: PointerEvent) {
		if (!dimTrack) return;
		const r = dimTrack.getBoundingClientRect();
		ondim(Math.round(Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)) * 80) / 100);
	}
</script>

<button type="button" class="scrim" aria-label="Close reading settings" onclick={onclose}></button>
<div class="sheet" role="dialog" aria-label="Reading settings">
	<div class="head">
		<div class="h">READING</div>
		<button type="button" class="x" aria-label="Close" onclick={onclose}>✕</button>
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
						onclick={() => onsides(n)}>{n === 0 ? 'NONE' : `${n}%`}</button
					>
				{/each}
			</div>
			{#if paged}<div class="under"><span class="note">VERTICAL ONLY</span></div>{/if}
		</div>
	</div>

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

	<div class="row rate">
		<div class="label">RATING</div>
		{#each RATING_OPTIONS as n (n)}
			<button
				type="button"
				class="cell"
				class:on={n > 0 && n <= rating}
				class:muted={rating === 0}
				aria-pressed={rating !== 0 && n === rating}
				aria-label={n === 0 ? 'Unrated' : `Rate ${n}`}
				onclick={() => onrate(n)}>{n}</button
			>
		{/each}
	</div>
	<div class="foot"></div>
</div>

<style>
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
	.rate .cell {
		flex: 1;
		border-right: var(--hairline);
		font: 500 15px var(--font-mono);
	}
	.rate .cell:last-child {
		border-right: 0;
	}
	.rate .cell.muted {
		color: var(--text-2);
	}
	.rate .cell.on {
		background: var(--accent);
		color: var(--on-accent);
	}
	.foot {
		height: 24px;
		flex-shrink: 0;
	}
	@media (max-width: 599px) {
		.label {
			width: 88px;
			padding: 0 14px;
		}
	}
</style>

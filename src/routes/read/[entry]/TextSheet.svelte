<script lang="ts">
	import { resolve } from '$app/paths';
	import RatingSlider from '$lib/components/controls/RatingSlider.svelte';
	import {
		LINES,
		SIZE_MAX,
		SIZE_MIN,
		type Furigana,
		type Layout,
		type Margins,
		type TextFont,
		type TextSettings,
		type Theme
	} from '$lib/reader/text';

	/**
	 * READING for text (Index Text Reader 1c, "sheet"): the image reader's sheet
	 * with rows for type. No scrim, so size and spacing change in view as
	 * they're set. LAYOUT is the series' (REMEMBER keeps it); everything below
	 * it belongs to the device. A row that doesn't apply is dimmed with the
	 * reason, not removed, so the sheet never jumps.
	 */
	let {
		layout,
		seriesLayout,
		settings,
		size,
		lineHeight,
		landscape,
		vertical,
		dim,
		rating,
		onlayout,
		onremember,
		onsettings,
		ondim,
		onrate,
		onclose
	}: {
		layout: Layout;
		seriesLayout: Layout;
		settings: TextSettings;
		/** The size and line height in use, the device's defaults included. */
		size: number;
		lineHeight: number;
		landscape: boolean;
		vertical: boolean;
		dim: number;
		rating: number;
		onlayout: (l: Layout) => void;
		onremember: () => void;
		onsettings: (s: Partial<TextSettings>) => void;
		ondim: (d: number) => void;
		onrate: (r: number) => void;
		onclose: () => void;
	} = $props();

	const LAYOUTS: [Layout, string][] = [
		['paged', 'PAGED'],
		['scroll', 'SCROLL']
	];
	const THEMES: [Theme, string][] = [
		['dark', 'DARK'],
		['paper', 'PAPER']
	];
	const FONTS: [TextFont, string][] = [
		['serif', 'Plex Serif'],
		['sans', 'Plex Sans']
	];
	const MARGINS: [Margins, string][] = [
		['narrow', 'NARROW'],
		['normal', 'NORMAL'],
		['wide', 'WIDE']
	];
	const FURIGANA: [Furigana, string][] = [
		['all', 'ALL'],
		['unknown', 'UNKNOWN'],
		['none', 'NONE']
	];
	const columnsApply = $derived(landscape && layout === 'paged' && !vertical);

	let dimTrack = $state<HTMLElement | null>(null);
	let sliding = false;
	function dimAt(e: PointerEvent) {
		if (!dimTrack) return;
		const r = dimTrack.getBoundingClientRect();
		ondim(Math.round(Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)) * 80) / 100);
	}
</script>

<div class="sheet" role="dialog" aria-label="Reading settings">
	<div class="head">
		<div class="h">READING</div>
		<button type="button" class="x" aria-label="Close" onclick={onclose}>✕</button>
	</div>

	<div class="row">
		<div class="label">LAYOUT</div>
		<div class="body col">
			<div class="seg" role="radiogroup" aria-label="Layout">
				{#each LAYOUTS as [l, name] (l)}
					<button
						type="button"
						role="radio"
						aria-checked={layout === l}
						class:on={layout === l}
						onclick={() => onlayout(l)}>{name}</button
					>
				{/each}
			</div>
			<div class="under">
				<span class="note">SERIES DEFAULT {seriesLayout.toUpperCase()}</span>
				{#if layout !== seriesLayout}
					<button type="button" class="remember" onclick={onremember}
						>REMEMBER {layout.toUpperCase()}</button
					>
				{/if}
			</div>
		</div>
	</div>

	<div class="row">
		<div class="label">COLUMNS</div>
		<div class="body split" class:off={!columnsApply}>
			<button
				type="button"
				class="switch"
				role="switch"
				aria-checked={settings.columns}
				disabled={!columnsApply}
				onclick={() => onsettings({ columns: !settings.columns })}
			>
				<span class="track" class:on={settings.columns}><span class="knob"></span></span>
				<span>{settings.columns ? 'ON' : 'OFF'}</span>
			</button>
			<span class="note">{vertical ? 'HORIZONTAL ONLY' : 'LANDSCAPE ONLY'}</span>
		</div>
	</div>

	{#snippet seg(
		label: string,
		opts: [string, string][],
		on: string,
		pick: (v: string) => void,
		fonts = false
	)}
		<div class="row">
			<div class="label">{label}</div>
			<div class="body col">
				<div class="seg" role="radiogroup" aria-label={label}>
					{#each opts as [v, name] (v)}
						<button
							type="button"
							role="radio"
							aria-checked={on === v}
							class:on={on === v}
							style:font-family={fonts
								? v === 'serif'
									? 'var(--font-serif)'
									: 'var(--font-sans)'
								: undefined}
							onclick={() => pick(v)}>{name}</button
						>
					{/each}
				</div>
			</div>
		</div>
	{/snippet}

	{@render seg('THEME', THEMES, settings.theme, (theme) => onsettings({ theme: theme as Theme }))}
	{@render seg(
		'FONT',
		FONTS,
		settings.font,
		(font) => onsettings({ font: font as TextFont }),
		true
	)}

	<div class="row">
		<div class="label">SIZE</div>
		<div class="body col">
			<div class="seg" role="group" aria-label="Size">
				<button
					type="button"
					aria-label="Smaller"
					disabled={size <= SIZE_MIN}
					onclick={() => onsettings({ size: Math.max(SIZE_MIN, size - 1) })}>A −</button
				>
				<button
					type="button"
					class="on"
					aria-label="Device default"
					onclick={() => onsettings({ size: null, line: null })}>{size} PX</button
				>
				<button
					type="button"
					aria-label="Larger"
					disabled={size >= SIZE_MAX}
					onclick={() => onsettings({ size: Math.min(SIZE_MAX, size + 1) })}>A +</button
				>
			</div>
		</div>
	</div>

	{@render seg(
		'LINE',
		LINES.map((l) => [l.toFixed(1), l.toFixed(1)] as [string, string]),
		LINES.reduce((a, b) => (Math.abs(b - lineHeight) < Math.abs(a - lineHeight) ? b : a)).toFixed(
			1
		),
		(line) => onsettings({ line: Number(line) })
	)}
	{@render seg('MARGINS', MARGINS, settings.margins, (margins) =>
		onsettings({ margins: margins as Margins })
	)}

	<div class="row">
		<div class="label">JUSTIFY</div>
		<div class="body split">
			<button
				type="button"
				class="switch"
				role="switch"
				aria-checked={settings.justify}
				onclick={() => onsettings({ justify: !settings.justify })}
			>
				<span class="track" class:on={settings.justify}><span class="knob"></span></span>
				<span>{settings.justify ? 'ON' : 'OFF'}</span>
			</button>
			<span class="note">HYPHENATES</span>
		</div>
	</div>

	<div class="row">
		<div class="label">FURIGANA</div>
		<div class="body col" class:off={!vertical}>
			<div class="seg" role="radiogroup" aria-label="Furigana">
				{#each FURIGANA as [f, name] (f)}
					<button
						type="button"
						role="radio"
						aria-checked={settings.furigana === f}
						class:on={settings.furigana === f}
						disabled={!vertical || f === 'unknown'}
						onclick={() => onsettings({ furigana: f })}>{name}</button
					>
				{/each}
			</div>
			{#if !vertical}<div class="under"><span class="note">JAPANESE BOOKS ONLY</span></div>{/if}
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

	<!-- Ratings out of 10: the blocky slider, as on the series screen. -->
	<RatingSlider value={rating} borderTop={false} fontSize={15} onchange={onrate} />
	<!-- ALL SETTINGS →: the page, at this sheet's section (Reach, readerSheet; card c171). -->
	<a class="all-settings" href="{resolve('/settings')}?section=novels"
		><span>ALL SETTINGS →</span><span class="n">DEFAULTS, AND WHAT EACH ROW KEEPS</span></a
	>
	<div class="foot"></div>
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
	.sheet {
		position: absolute;
		left: 0;
		right: 0;
		bottom: 0;
		z-index: 31;
		display: flex;
		flex-direction: column;
		border-top: var(--rule-strong);
		background: var(--surface-page);
		color: var(--text-1);
		max-height: calc(100dvh - 64px);
		overflow-y: auto;
	}
	.head {
		display: flex;
		align-items: stretch;
		height: 56px;
		flex-shrink: 0;
		border-bottom: var(--hairline);
	}
	.h {
		flex: 1;
		display: flex;
		align-items: center;
		padding: 0 24px;
		font: 500 13px var(--font-mono);
		letter-spacing: 0.06em;
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
		flex-shrink: 0;
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
		box-sizing: border-box;
		border-right: var(--hairline);
		font: 500 13px var(--font-mono);
		letter-spacing: 0.06em;
		color: var(--text-2);
	}
	.body {
		flex: 1;
		min-width: 0;
		display: flex;
		gap: 8px;
		padding: 8px 18px;
	}
	.body.off {
		opacity: 0.4;
	}
	.col {
		flex-direction: column;
		justify-content: center;
		align-items: stretch;
	}
	.split {
		flex-direction: row;
		justify-content: space-between;
		align-items: center;
	}
	.seg {
		display: flex;
		height: 46px;
		border: 1px solid var(--line-2);
		font: 500 14px var(--font-mono);
	}
	.seg button {
		flex: 1;
		border-right: 1px solid var(--line-2);
		font: inherit;
	}
	.seg button:last-child {
		border-right: 0;
	}
	.seg button.on {
		background: var(--text-1);
		color: var(--surface-page);
	}
	.under {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 12px;
	}
	.note {
		font: 400 13px var(--font-mono);
		color: var(--text-2);
	}
	.remember {
		display: flex;
		align-items: center;
		height: 36px;
		padding: 0 14px;
		background: var(--accent);
		color: var(--on-accent);
		font: 500 13px var(--font-mono);
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
		box-sizing: border-box;
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
	@media (max-width: 599px) {
		.label {
			width: 96px;
			padding: 0 14px;
		}
		.body {
			padding: 8px 12px;
		}
	}
</style>

<script lang="ts">
	import Cover from './Cover.svelte';
	import ProgressBar from './ProgressBar.svelte';
	import { percent } from '$lib/library/labels';

	/**
	 * A continue-reading row. On a phone it is compact -- a 48x68 cover and the
	 * progress bar under the meta line -- and elsewhere the progress gets its
	 * own 110px column beside a 62x88 cover.
	 *
	 * That switch is CSS, not a prop, so the server's first paint is already
	 * right for the device; a prop read from a media query in script would be
	 * decided only after hydration, and the row would visibly jump.
	 *
	 * `unavailable` is offline-and-not-cached: dimmed, and the resume cell
	 * becomes a dash.
	 */
	let {
		title,
		meta,
		progress = 0,
		src,
		hue,
		unavailable = false,
		work = null,
		onresume,
		focusId,
		startFocus = false
	}: {
		title: string;
		/** The entry's own label, e.g. "Ch. 41"; a Work row composes it. */
		meta: string;
		progress?: number;
		src?: string | null;
		hue: number;
		unavailable?: boolean;
		/**
		 * A Work's row (Work-Library, the Akasaka row): the part CONTINUE opens,
		 * or UP NEXT between parts. The row is never one per part.
		 */
		work?: {
			id: number;
			name: string;
			part: number;
			of: number;
			upNext: boolean;
			partTitle: string;
		} | null;
		onresume?: () => void;
		/** Where focus comes back to after a trip away (doc/FOCUS.md). */
		focusId?: string;
		/** The screen's first arrow lands here (doc/FOCUS.md). */
		startFocus?: boolean;
	} = $props();
</script>

<div class="row" class:unavailable class:work>
	<div class="cover"><Cover {src} {hue} /></div>
	<div class="text">
		<div class="title">{title}</div>
		{#if work}
			<!-- The part's own label, and the Work it belongs to (Work-Library B1). -->
			<div class="meta">
				{#if work.upNext}<span class="nx">UP NEXT</span><span class="ink"
						>{work.partTitle} · {meta}</span
					>
				{:else}WORK · PART {work.part} · <span class="ink">{work.partTitle}</span> · {meta}{/if}
			</div>
		{:else}
			<div class="meta">{meta}</div>
		{/if}
		<div class="inline-progress"><ProgressBar value={progress} /></div>
	</div>
	<div class="progress">
		<div class="pct">{work && work.upNext ? `PART ${work.part}` : percent(progress)}</div>
		<ProgressBar value={progress} width={110} />
	</div>
	<button
		type="button"
		class="go"
		class:acc={work?.upNext}
		disabled={unavailable || !onresume}
		aria-label={work?.upNext ? 'Start {title}' : 'Resume {title}'}
		data-focus-id={focusId}
		data-focus-start={startFocus ? '' : undefined}
		onclick={() => onresume?.()}>{unavailable ? '—' : '▶'}</button
	>
</div>

<style>
	.row {
		display: flex;
		align-items: center;
		gap: 16px;
		padding: 12px var(--pad);
		border-bottom: var(--hairline);
		border-right: 1px solid transparent;
		min-width: 0;
	}
	.unavailable {
		opacity: 0.4;
	}
	.cover {
		width: 62px;
		height: 88px;
		flex-shrink: 0;
		display: flex;
	}
	.cover > :global(.cover) {
		width: 100%;
		height: 100%;
		aspect-ratio: auto;
	}
	.text {
		flex: 1;
		min-width: 0;
		display: flex;
		flex-direction: column;
		gap: 6px;
	}
	.title {
		font: var(--type-row);
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}
	.meta {
		font: var(--type-meta);
		color: var(--text-2);
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}
	.meta .ink {
		color: var(--text-1);
	}
	/* UP NEXT between parts: inverse, because the row is pointing rather than resuming (Work-Library). */
	.nx {
		font: 500 12px var(--font-mono);
		letter-spacing: 0.06em;
		padding: 2px 6px;
		background: var(--surface-inverse);
		color: var(--text-inverse);
		margin-right: 8px;
	}
	.inline-progress {
		display: none;
	}
	.progress {
		width: 110px;
		flex-shrink: 0;
		display: flex;
		flex-direction: column;
		gap: 6px;
		align-items: flex-end;
	}
	.pct {
		font: var(--type-control);
	}
	@media (max-width: 599px) {
		.cover {
			width: 48px;
			height: 68px;
		}
		.inline-progress {
			display: block;
		}
		.progress {
			display: none;
		}
	}
	.go {
		width: 48px;
		height: 48px;
		flex-shrink: 0;
		border: 1px solid var(--line-2);
		border-radius: 0;
		background: transparent;
		color: var(--text-1);
		font: 500 15px var(--font-mono);
		display: flex;
		align-items: center;
		justify-content: center;
		cursor: pointer;
		padding: 0;
	}
	.go:active:not(:disabled) {
		background: var(--surface-inverse);
		color: var(--text-inverse);
	}
	/* The next part's ▶ is the accent cell: it starts something (Work-Library). */
	.go.acc {
		background: var(--accent);
		color: var(--on-accent);
		border-color: var(--accent);
	}
	.go:disabled {
		cursor: default;
	}
	/*
	 * The TV's CONTINUE card (c238; TV-Library 3A; TV Calls, "CONTINUE"): one
	 * 288x120 button, three across, with a 72px cover, the title on two lines,
	 * where you are and the progress bar. The whole card is the button, so the
	 * ▶ cell becomes an invisible overlay and the mark is drawn inside the
	 * card, as a cell of the ruled grid.
	 */
	@media (pointer: none) and (min-width: 900px) {
		.row {
			position: relative;
			display: grid;
			grid-template-columns: 72px minmax(0, 1fr);
			grid-template-rows: auto auto;
			column-gap: 14px;
			row-gap: 6px;
			align-content: center;
			align-items: stretch;
			min-height: 120px;
			padding: 8px 14px 8px 8px;
			border-bottom: 0;
			background: var(--surface-page);
		}
		.cover {
			grid-row: 1 / span 2;
			width: 72px;
			height: 104px;
			align-self: center;
		}
		.text {
			grid-column: 2;
			grid-row: 1;
			justify-content: center;
		}
		.title {
			font: 500 17px/1.25 var(--font-sans);
			white-space: normal;
			display: -webkit-box;
			-webkit-line-clamp: 2;
			line-clamp: 2;
			-webkit-box-orient: vertical;
			overflow: hidden;
		}
		.meta {
			font: var(--type-meta);
		}
		.progress {
			grid-column: 2;
			grid-row: 2;
			width: auto;
			align-self: end;
			align-items: stretch;
			gap: 0;
		}
		.pct {
			display: none;
		}
		/* 4px, the TV's own bar (tv.css --progress-h): the component's inline
		   height is 3px, so it takes !important to redraw it at TV size. */
		.progress :global(.track),
		.progress :global(.track > div) {
			height: 4px !important;
			width: 100%;
		}
		.inline-progress {
			display: none;
		}
		.go {
			position: absolute;
			inset: 0;
			width: auto;
			height: auto;
			border: 0;
			padding: 0;
			background: transparent;
			color: transparent;
			font-size: 0;
		}
		.go:focus-visible {
			box-shadow: var(--focus-ring-in);
		}
	}
</style>

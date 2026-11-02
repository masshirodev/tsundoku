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
		onresume,
		focusId,
		startFocus = false
	}: {
		title: string;
		meta: string;
		progress?: number;
		src?: string | null;
		hue: number;
		unavailable?: boolean;
		onresume?: () => void;
		/** Where focus comes back to after a trip away (doc/FOCUS.md). */
		focusId?: string;
		/** The screen's first arrow lands here (doc/FOCUS.md). */
		startFocus?: boolean;
	} = $props();
</script>

<div class="row" class:unavailable>
	<div class="cover"><Cover {src} {hue} /></div>
	<div class="text">
		<div class="title">{title}</div>
		<div class="meta">{meta}</div>
		<div class="inline-progress"><ProgressBar value={progress} /></div>
	</div>
	<div class="progress">
		<div class="pct">{percent(progress)}</div>
		<ProgressBar value={progress} width={110} />
	</div>
	<button
		type="button"
		class="go"
		disabled={unavailable || !onresume}
		aria-label="Resume {title}"
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
	.go:disabled {
		cursor: default;
	}
</style>

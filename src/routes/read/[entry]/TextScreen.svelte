<script lang="ts">
	import RatingSlider from '$lib/components/controls/RatingSlider.svelte';
	import { formatBytes } from '$lib/library/series';

	/**
	 * The text reader's full screens (Index Text Reader 1d, 1f): OPENING while
	 * a book downloads the first time, DID NOT OPEN for a locked or damaged
	 * file, and the end of what's available -- which asks for RATING and FAV
	 * only while the series is unrated, so it never asks twice.
	 */
	type Props =
		| { kind: 'loading'; chapters: number; bytes: number; progress: number }
		| {
				kind: 'failed';
				title: string;
				bytes: number;
				reason: 'drm' | 'broken' | 'missing' | 'offline' | 'undownloaded' | 'online';
				detail: string;
				seriesHref: string;
				libraryHref: string;
				onretry?: () => void;
		  }
		| {
				kind: 'end';
				title: string;
				where: string;
				askRating: boolean;
				rating: number;
				favourite: boolean;
				seriesHref: string;
				libraryHref: string;
				onrate: (n: number) => void;
				onfav: () => void;
				/** A novel downloaded so far: the next chapter, which isn't (doc/NOVELS.md). */
				missing?: string | null;
		  };
	let props: Props = $props();

	const WHY = {
		drm: 'This file is encrypted for another reading app. tsundoku opens DRM-free EPUBs only, so nothing in it can be shown.',
		broken:
			'The file is damaged: part of what makes it an EPUB is missing, so its text can’t be found.',
		missing:
			'The workstation has no file at this place any more. A rescan will mark it not downloaded.',
		offline: 'The workstation did not answer, and this book isn’t kept on the tablet yet.',
		undownloaded:
			'Only part of this novel is downloaded. Download this chapter from the series page, and it opens here.',
		online:
			'This chapter is read from its source, and the source did not send it. Downloaded chapters still open; this one opens once the source answers.'
	} as const;
</script>

{#if props.kind === 'loading'}
	<div class="loading" role="status">
		<div class="what">OPENING · READING {props.chapters.toLocaleString('en-US')} CHAPTERS</div>
		<div class="bar"><div style:width="{Math.round(props.progress * 100)}%"></div></div>
		<div class="size">1 EPUB{props.bytes ? ` · ${formatBytes(props.bytes)}` : ''}</div>
	</div>
{:else}
	<div class="screen">
		<div class="middle">
			{#if props.kind === 'failed'}
				<div class="kicker">
					<div>DID NOT OPEN</div>
					<div>1 EPUB{props.bytes ? ` · ${formatBytes(props.bytes)}` : ''}</div>
				</div>
				<div class="rule"></div>
				<h1>{props.title}</h1>
				<div class="why">
					<div class="reason">
						{props.reason === 'broken' ? `BROKEN EPUB · ${props.detail}` : props.detail}
					</div>
					<div class="text">{WHY[props.reason]}</div>
				</div>
			{:else}
				<div class="kicker">
					<div>END · LAST AVAILABLE</div>
					<div>{props.where}</div>
				</div>
				<div class="rule"></div>
				<h1>{props.title}</h1>
				{#if props.missing}
					<div class="why">
						<div class="reason">{props.missing} IS NOT DOWNLOADED</div>
						<div class="text">Download it from the series page, and reading carries on here.</div>
					</div>
				{/if}
				{#if props.askRating}
					<div class="ask">
						<!-- Ratings out of 10 1d: the blocky slider, as the image reader's end page. -->
						<RatingSlider
							value={props.rating}
							height={72}
							phoneHeight={72}
							pad={0}
							phonePad={0}
							borderTop={false}
							onchange={(n) => props.kind === 'end' && props.onrate(n)}
						/>
						<div class="row">
							<div class="label">FAV</div>
							<button
								type="button"
								class="switch"
								role="switch"
								aria-checked={props.favourite}
								data-focus-mark="in"
								onclick={() => props.kind === 'end' && props.onfav()}
							>
								<span class="track" class:on={props.favourite}><span class="knob"></span></span>
								<span>{props.favourite ? 'ON' : 'OFF'}</span>
							</button>
						</div>
					</div>
					<div class="note">SHOWN WHILE UNRATED · RATING SAVES WHEN YOU LET GO</div>
				{/if}
			{/if}
		</div>
		<nav class="foot">
			<!-- eslint-disable svelte/no-navigation-without-resolve -- both hrefs are resolved by the caller -->
			<!-- Ruled cells: on a TV the pad reaches them at the end (c251; the reader
			     lifts its opt-out there, doc/FOCUS.md), so the mark is drawn inside. -->
			<a href={props.seriesHref} data-focus-mark="in">← SERIES</a>
			<div class="gap">
				{#if props.kind === 'failed' && (props.reason === 'offline' || props.reason === 'online') && props.onretry}
					<button type="button" data-focus-mark="in" onclick={props.onretry}>RETRY</button>
				{/if}
			</div>
			<a href={props.libraryHref} data-focus-mark="in">LIBRARY</a>
			<!-- eslint-enable svelte/no-navigation-without-resolve -->
		</nav>
	</div>
{/if}

<style>
	.loading {
		position: absolute;
		inset: 0;
		z-index: 40;
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		gap: 16px;
		background: #000;
	}
	.what {
		font: 500 15px var(--font-mono);
		color: var(--text-2);
	}
	.bar {
		width: 160px;
		height: 2px;
		background: var(--line-1);
	}
	.bar div {
		height: 2px;
		background: var(--accent);
	}
	.size {
		font: 400 13px var(--font-mono);
		color: var(--text-2);
	}
	.screen {
		position: absolute;
		inset: 0;
		z-index: 40;
		display: flex;
		flex-direction: column;
		background: var(--surface-page);
		color: var(--text-1);
	}
	.middle {
		flex: 1;
		display: flex;
		flex-direction: column;
		justify-content: center;
		gap: 36px;
		padding: 0 64px;
	}
	.kicker {
		display: flex;
		justify-content: space-between;
		gap: 12px;
		font: 500 13px var(--font-mono);
		letter-spacing: 0.06em;
		color: var(--text-2);
	}
	.rule {
		height: 1px;
		background: var(--line-1);
	}
	h1 {
		margin: 0;
		font: 500 44px/1.15 var(--font-sans);
		text-wrap: pretty;
	}
	.why {
		display: flex;
		flex-direction: column;
		gap: 8px;
		padding: 18px 20px;
		border: 1px dashed var(--line-2);
	}
	.reason {
		font: 500 14px var(--font-mono);
		letter-spacing: 0.04em;
	}
	.text {
		font: 400 16px/1.5 var(--font-sans);
		color: var(--text-2);
		text-wrap: pretty;
	}
	.ask {
		display: flex;
		flex-direction: column;
		border-top: var(--hairline);
	}
	.row {
		display: flex;
		align-items: stretch;
		height: 72px;
		border-bottom: var(--hairline);
	}
	.label {
		display: flex;
		align-items: center;
		width: 120px;
		flex-shrink: 0;
		font: 500 13px var(--font-mono);
		letter-spacing: 0.06em;
		color: var(--text-2);
		border-right: var(--hairline);
	}
	button {
		border: 0;
		border-radius: 0;
		background: transparent;
		color: var(--text-1);
		cursor: pointer;
	}
	.switch {
		display: flex;
		align-items: center;
		gap: 12px;
		padding: 0 18px;
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
	.note {
		font: 400 13px var(--font-mono);
		color: var(--text-2);
	}
	.foot {
		flex-shrink: 0;
		display: flex;
		height: 64px;
		border-top: var(--hairline);
	}
	.foot a,
	.foot button {
		display: flex;
		align-items: center;
		padding: 0 24px;
		font: 500 14px var(--font-mono);
		color: var(--text-1);
		text-decoration: none;
	}
	.foot a:first-child {
		border-right: var(--hairline);
	}
	.foot a:last-child {
		border-left: var(--hairline);
	}
	.gap {
		flex: 1;
		display: flex;
		justify-content: center;
	}
	@media (max-width: 599px) {
		.middle {
			padding: 0 24px;
			gap: 24px;
		}
		h1 {
			font-size: 30px;
		}
	}
</style>

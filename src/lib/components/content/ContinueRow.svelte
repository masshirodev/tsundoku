<script lang="ts">
	import Cover from './Cover.svelte';
	import ProgressBar from './ProgressBar.svelte';
	import { longpress } from '$lib/actions/longpress';
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
	 *
	 * The band is a real link to the entry's page and ▶ its sibling (c841), so
	 * there is no button inside a link. `href` is null where the band has
	 * nowhere honest to go: the page decides that (SELECT, an offline row whose
	 * screen this device never kept; doc/LIBRARY.md, "The CONTINUE row").
	 *
	 * A held press anywhere on the row, the band and ▶ alike, is `onlongpress`
	 * (c860): a held OK, a long press and a right click, and the press that fired
	 * it neither follows the band nor resumes.
	 */
	let {
		title,
		meta,
		progress = 0,
		src,
		hue,
		unavailable = false,
		work = null,
		href = null,
		onopen,
		onresume,
		onlongpress,
		focusId,
		linkFocusId,
		focusDown,
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
		/** Where the band goes: the series, or a Work's own screen. Null, it goes nowhere. */
		href?: string | null;
		/** Called as the band's link is followed, so the next screen can draw what this one knew. */
		onopen?: () => void;
		onresume?: () => void;
		/** The entry's options, as a grid tile's hold opens them. Absent, a hold is a plain press. */
		onlongpress?: () => void;
		/** Where focus comes back to after a trip away (doc/FOCUS.md): the ▶ cell. */
		focusId?: string;
		/** The same for the band: its own stop, so a trip to the series returns to it. */
		linkFocusId?: string;
		/** Where ↓ goes from ▶, when the screen wants other than the nearest (doc/FOCUS.md). */
		focusDown?: string;
		/** The screen's first arrow lands here (doc/FOCUS.md). */
		startFocus?: boolean;
	} = $props();

	/**
	 * ▶❚❚ on a remote resumes the focused CONTINUE card (doc/TV.md). The layer
	 * finds the card by `continue-<id>`, which only ▶ carries now, and does
	 * nothing on the band, so the band answers the key itself.
	 */
	function mediaResume(e: KeyboardEvent) {
		if (e.key !== 'MediaPlayPause' || unavailable || !onresume) return;
		e.preventDefault();
		onresume();
	}

	/**
	 * `longpress` takes the `contextmenu` whether or not it has anything to open,
	 * and to the remote's layer a taken `contextmenu` means "this had options"
	 * (doc/FOCUS.md, "OK held"), so a row with nothing to offer would turn a held
	 * OK into a dead press. Such a row carries no action at all.
	 */
	function holdable(node: HTMLElement, onlong: (() => void) | undefined) {
		let held = onlong ? longpress(node, onlong) : undefined;
		return {
			update(next: (() => void) | undefined) {
				if (next && held) held.update?.(next);
				else if (next) held = longpress(node, next);
				else {
					held?.destroy?.();
					held = undefined;
				}
			},
			destroy: () => held?.destroy?.()
		};
	}
</script>

<!-- The row hovers as one, ▶'s cell and the row's padding included (owner,
     2026-11-10): the band's own tint stopped 16px short of ▶ (doc/MOTION.md,
     "hover can belong to a group"). Only a row that opens something is tinted. -->
<div
	class="row"
	class:unavailable
	class:work
	data-hover={href ? 'group' : undefined}
	use:holdable={onlongpress}
>
	<!-- Both handlers exist only on the <a>; the <div> takes no input at all. -->
	<!-- svelte-ignore a11y_no_static_element_interactions -->
	<svelte:element
		this={href ? 'a' : 'div'}
		class="band"
		data-hover="off"
		{href}
		data-focus-id={href ? linkFocusId : undefined}
		data-focus-mark={href ? 'in' : undefined}
		onclick={href ? onopen : undefined}
		onkeydown={href ? mediaResume : undefined}
	>
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
	</svelte:element>
	<button
		type="button"
		class="go"
		class:acc={work?.upNext}
		disabled={unavailable || !onresume}
		aria-label={work?.upNext ? `Start ${title}` : `Resume ${title}`}
		data-focus-id={focusId}
		data-focus-down={focusDown}
		data-focus-start={startFocus ? '' : undefined}
		onclick={() => onresume?.()}
		>{#if unavailable}—{:else}
			<!-- Drawn, because a text ▶ is placed by the font's metrics (c840). The
			     triangle's centroid, not its box, is the viewBox's middle: (4+4+13)/3 = 7. -->
			<svg class="tri" viewBox="0 0 14 14" aria-hidden="true"><path d="M4 1 13 7 4 13Z" /></svg>
		{/if}</button
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
		/* The hold is the row's, and iOS sends no `contextmenu` for `longpress` to
		   cancel (doc/TOUCH.md): without these a held band draws the link's callout
		   or starts a selection over the sheet, as a tile's rules say (CoverTile). */
		user-select: none;
		-webkit-user-select: none;
		-webkit-touch-callout: none;
	}
	.unavailable {
		opacity: 0.4;
	}
	/* The whole band, the row's own padding and the gap before ▶ included, is
	   the link: the margins take the row's inset back and the padding returns it,
	   so nothing is drawn anywhere new. */
	.band {
		flex: 1;
		min-width: 0;
		display: flex;
		align-items: center;
		gap: 16px;
		margin: -12px -16px -12px calc(-1 * var(--pad));
		padding: 12px 16px 12px var(--pad);
		color: inherit;
		text-decoration: none;
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
	/* Through to the row, so a held press on a dash is still the row's hold. */
	.go:disabled {
		pointer-events: none;
	}
	.tri {
		width: 14px;
		height: 14px;
		fill: currentColor;
	}
	/*
	 * The TV's CONTINUE card (c238; TV-Library 3A; TV Calls, "CONTINUE"): 288x120,
	 * three across, with a 72px cover, the title on two lines, where you are and
	 * the progress bar. Two stops since c841: the band opens the entry and ▶ is
	 * a ruled cell at the card's end, so the ring is drawn inside each.
	 */
	@media (pointer: none) and (min-width: 900px) {
		.row {
			position: relative;
			align-items: stretch;
			gap: 0;
			min-height: 120px;
			padding: 8px 14px 8px 8px;
			border-bottom: 0;
			background: var(--surface-page);
		}
		.band {
			display: grid;
			grid-template-columns: 72px minmax(0, 1fr);
			grid-template-rows: auto auto;
			column-gap: 14px;
			row-gap: 6px;
			align-content: center;
			align-items: stretch;
			min-height: 120px;
			/* Stops at ▶'s cell: the layer's arrows are an edge test (doc/FOCUS.md),
			   so a band running under ▶ would not be "to the left" of it. */
			margin: -8px 34px -8px -8px;
			padding: 8px 14px 8px 8px;
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
			top: 0;
			right: 0;
			bottom: 0;
			width: 48px;
			height: auto;
			border: 0;
			border-left: var(--hairline);
		}
		.go:focus-visible {
			box-shadow: var(--focus-ring-in);
		}
	}
</style>

<script lang="ts">
	import Cover from './Cover.svelte';
	import Badge from './Badge.svelte';
	import { coverSrc } from '$lib/library/links';
	import {
		continuePart,
		inOrder,
		workFoot,
		workFootShort,
		type WorkTile
	} from '$lib/library/works';

	/**
	 * A Work in the library grid (doc/WORKS.md, "The one
	 * rule"): browsing shows the run as one tile. Its cover is the part CONTINUE
	 * opens -- the part on the shelf being browsed -- and two hairline frames
	 * stand behind it to say "more than one". The foot draws one segment per
	 * part instead of rating bars: a Work has no rating of its own.
	 *
	 * `tile.parts` is every part the viewer can see, which is what the segments,
	 * the PART n OF m and the sums are about.
	 */
	let {
		tile,
		cached = null,
		selectable = false,
		selected = false,
		dimmed = false,
		onpress,
		focusId,
		startFocus = false,
		meta = ''
	}: {
		tile: WorkTile;
		/** The device's own cached chapters for this Work, when offline (doc/OFFLINE.md). */
		cached?: number | null;
		selectable?: boolean;
		selected?: boolean;
		dimmed?: boolean;
		onpress?: () => void;
		focusId?: string;
		startFocus?: boolean;
		/** The TV focus line's second line. */
		meta?: string;
	} = $props();

	const parts = $derived(inOrder(tile.parts));
	const foot = $derived(workFoot(parts));
	const current = $derived(continuePart(parts));
	// HIDDEN is the Work's mark, not the face's: a Work is hidden or shown
	// whole, and a part hidden on its own after grouping still means the run
	// is hidden (doc/WORKS.md, "The one rule"). The +N follows the same flag.
	const hidden = $derived(tile.hidden);
	const place = $derived(
		current ? parts.findIndex((p) => p.seriesId === current.seriesId) + 1 : parts.length
	);
	const word = $derived(workFootShort(foot, parts));
</script>

<div class="tile work" class:dimmed data-hover="group">
	<button
		type="button"
		class="open"
		data-hover="off"
		aria-pressed={selectable ? selected : undefined}
		aria-label={tile.name}
		data-focus-id={focusId}
		data-focus-start={startFocus ? '' : undefined}
		data-focus-line={meta ? '' : undefined}
		data-focus-title={meta ? tile.name : undefined}
		data-focus-meta={meta || undefined}
		onclick={() => onpress?.()}
	>
		<span class="frames">
			<Cover
				src={coverSrc(tile.face.id, tile.face.cover)}
				hue={tile.face.hue}
				ring={selected}
				stripeTitle={tile.name}
			>
				{#if hidden}<Badge tone="reveal" corner="bottom-left">HIDDEN</Badge>{/if}
				<span class="bdg wb">WORK · {parts.length}</span>
				{#if tile.parts.some((p) => p.favourite)}<Badge tone="accent" corner="top-right">FAV</Badge
					>{/if}
				{#if tile.newCount > 0 && !hidden}
					<Badge corner="bottom-left">+{tile.newCount}</Badge>
				{/if}
				{#if cached != null && cached > 0}
					<Badge tone="inverse" corner="bottom-right">↓ {cached}</Badge>
				{/if}
				{#if selectable}
					<span class="check" class:on={selected} aria-hidden="true">{selected ? '✓' : ''}</span>
				{/if}
			</Cover>
		</span>
		<span class="title">{tile.name}</span>
		{#if foot.label}
			<span class="ft">
				<span class="seg" aria-hidden="true">
					{#each foot.segments as s, i (i)}<i class={s}></i>{/each}
				</span>
				<span class="long">
					{#if foot.upNext}
						<span class="ink">UP NEXT</span> · PART {place}
					{:else}
						<span class="ink">PART {place}</span> OF {parts.length}
					{/if}
				</span>
				<span class="short">{word}</span>
			</span>
		{/if}
	</button>
</div>

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
	/*
	 * Two hairline frames stand behind the cover: a Work is more
	 * than the part its face shows. They are the cover's own box-shadow so the
	 * tile's height stays the cover's, and the ink hairline is what a themed
	 * library still reads.
	 */
	.frames {
		display: block;
		margin-top: 10px;
		width: calc(100% - 10px);
		box-shadow:
			5px -5px 0 -1px var(--surface-page),
			5px -5px 0 0 var(--line-2),
			10px -10px 0 -1px var(--surface-page),
			10px -10px 0 0 var(--line-2);
	}
	.open:focus-visible {
		box-shadow: none;
	}
	.open:focus-visible :global(.cover) {
		box-shadow: var(--focus-ring);
	}
	.bdg {
		position: absolute;
		font: 500 12px var(--font-mono);
		padding: 2px 5px;
		white-space: nowrap;
	}
	.bdg.wb {
		left: 0;
		top: 0;
		background: var(--surface-inverse);
		color: var(--text-inverse);
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
	.ft {
		height: 16px;
		display: flex;
		align-items: center;
		gap: 6px;
		font: 500 11px var(--font-mono);
		letter-spacing: 0.04em;
		color: var(--text-2);
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}
	.ft .ink {
		color: var(--text-1);
	}
	.seg {
		display: flex;
		gap: 2px;
	}
	.seg i {
		width: 10px;
		height: 4px;
		background: var(--line-2);
	}
	.seg i.done {
		background: var(--text-2);
	}
	.seg i.now {
		background: var(--text-1);
	}
	.short {
		display: none;
	}
	.dimmed {
		opacity: 0.35;
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
	/* The phone's foot says the place in fewer words. */
	@media (max-width: 599px) {
		.long {
			display: none;
		}
		.short {
			display: inline;
		}
	}
	/* A TV's caption is gone, like any other tile's. */
	@media (pointer: none) and (min-width: 900px) {
		.open {
			gap: 0;
		}
		.title,
		.ft {
			display: none;
		}
	}
</style>

<script lang="ts">
	import Cover from '$lib/components/content/Cover.svelte';
	import Badge from '$lib/components/content/Badge.svelte';
	import type { SearchHit } from '$lib/server/download-types';
	import { longpress } from '$lib/actions/longpress';

	/**
	 * One of a source's results on its BROWSE page; a tile says what's already
	 * yours. IN LIBRARY sits in FAV's corner, top right, since accent means
	 * yours, and a tap opens the series; SAME TITLE · FROM … is the meta line
	 * in ink 500, to head off a twin; otherwise the line is the source's status
	 * and author. HIDDEN, top left, only ever shows inside reveal: with it off
	 * such a result isn't sent.
	 */
	let {
		hit,
		href,
		hue,
		selecting = false,
		ticked = false,
		tickable = true,
		adding = false,
		ontick,
		onlong
	}: {
		hit: SearchHit;
		href: string;
		hue: number;
		/**
		 * SELECT (doc/BROWSE.md, "SELECT in a catalog"): a tap ticks and
		 * opens nothing, a long press opens the preview. A tile the press could
		 * not add (IN LIBRARY, ADDING) is dimmed, has no box, and takes no tap.
		 */
		selecting?: boolean;
		ticked?: boolean;
		tickable?: boolean;
		/** Being added now (an earlier press, or a preview's ADD): the ink ADDING badge. */
		adding?: boolean;
		ontick?: () => void;
		onlong?: () => void;
	} = $props();
	const m = $derived(hit.match);
</script>

{#snippet face(box: boolean)}
	<Cover src={hit.cover || null} {hue} ring={box && ticked}>
		{#if m.kind === 'in-library' && m.hidden}<Badge tone="reveal" corner="top-left">HIDDEN</Badge
			>{/if}
		{#if m.kind === 'in-library'}<Badge tone="accent" corner="top-right">IN LIBRARY</Badge>
		{:else if selecting && adding}<Badge tone="inverse" corner="top-right">ADDING</Badge>{/if}
		{#if box}<span class="check" class:on={ticked} aria-hidden="true">{ticked ? '✓' : ''}</span
			>{/if}
	</Cover>
	<span class="t">{hit.title}</span>
	{#if m.kind === 'same-title'}
		<span class="m twin"
			>{m.source ? `SAME TITLE · FROM ${m.source}` : 'SAME TITLE IN LIBRARY'}</span
		>
	{:else}
		<span class="m">{hit.meta}</span>
	{/if}
{/snippet}

{#if selecting && tickable}
	<!-- While selecting a tap ticks (opens nothing) and a long press opens the
	     preview in this tab, still selecting. -->
	<button
		type="button"
		class="tile pick"
		data-press="scale"
		aria-pressed={ticked}
		data-focus-id={`result-${hit.mangaId}`}
		onclick={ontick}
		use:longpress={() => onlong?.()}
	>
		{@render face(true)}
	</button>
{:else if selecting}
	<!-- Not tickable: the press could not add it. A tap does nothing. -->
	<div class="tile off" data-focus-id={`result-${hit.mangaId}`}>{@render face(false)}</div>
{:else}
	<!-- A preview asks the source (details and episodes, one call at a time per
     extension), so it loads on tap, not hover: twenty hovered tiles queued
     forty calls ahead of the one opened. -->
	<!-- eslint-disable-next-line svelte/no-navigation-without-resolve -- the page builds href from resolve() -->
	<a class="tile" {href} data-sveltekit-preload-data="tap" data-focus-id={`result-${hit.mangaId}`}>
		{@render face(false)}
	</a>
{/if}

<style>
	/* Transcribed from the design: its literals; colours are tokens. */
	.tile {
		display: flex;
		flex-direction: column;
		gap: 7px;
		min-width: 0;
		padding: 10px;
		background: var(--surface-page);
		box-shadow:
			1px 0 0 var(--line-1),
			0 1px 0 var(--line-1),
			1px 1px 0 var(--line-1);
		color: var(--text-1);
		text-decoration: none;
	}
	/*
	 * The mark is around the cover, as on a library tile (CoverTile; doc/FOCUS.md,
	 * "The mark"), and not on the tile: this rule's three hairlines outweigh
	 * the global `:focus-visible` ring, so a focused tile drew none at all, and an
	 * outer ring on the tile would be painted under its neighbours' backgrounds in
	 * a grid whose gap is 1 px. The cover's ring ends 7 px out, inside the padding.
	 */
	.tile:focus-visible :global(.cover) {
		box-shadow: var(--focus-ring);
	}
	/* FILTER's scrim is drawn over the grid, and the pad can still walk under it. */
	:global(.grid.dim) .tile:focus-visible {
		position: relative;
		z-index: 1;
	}
	.tile:active {
		background: var(--surface-inverse);
		color: var(--text-inverse);
	}
	/* SELECT: a tile is a button while selecting. */
	.pick {
		border: 0;
		border-radius: 0;
		font: inherit;
		text-align: left;
		cursor: pointer;
	}
	.pick:focus-visible :global(.cover) {
		box-shadow: var(--focus-ring);
	}
	/* The ticked ring is the cover's own (Cover's `ring`): a tap sinks the tile
	   (the press layer's `scale`) rather than inverting it, which would hide it. */
	.pick:active {
		background: var(--surface-page);
		color: var(--text-1);
	}
	/* IN LIBRARY and ADDING while selecting: 0.4, no box, the badge kept. */
	.off {
		opacity: 0.4;
	}
	/* GROUP's check, top-left where HIDDEN would be (the library's CoverTile). */
	.check {
		position: absolute;
		left: 6px;
		top: 6px;
		width: 26px;
		height: 26px;
		box-sizing: border-box;
		border: 2px solid var(--text-1);
		background: color-mix(in srgb, var(--surface-page) 55%, transparent);
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
	.t,
	.m {
		display: -webkit-box;
		-webkit-box-orient: vertical;
		-webkit-line-clamp: 2;
		line-clamp: 2;
		overflow: hidden;
	}
	.t {
		height: 32px;
		font: 500 13px/1.25 var(--font-sans);
	}
	.m {
		height: 29px;
		font: 400 11px/1.3 var(--font-mono);
		letter-spacing: 0.02em;
		color: var(--text-2);
	}
	.tile:active .m {
		color: inherit;
	}
	.twin {
		font-weight: 500;
		color: var(--text-1);
	}
</style>

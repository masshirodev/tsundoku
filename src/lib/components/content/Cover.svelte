<script lang="ts">
	import type { Snippet } from 'svelte';
	import { coverPlaceholder } from '$lib/library/cover';

	/**
	 * A cover at 2:2.9, or a fixed size when both dimensions are given. Without
	 * an image it draws the striped placeholder tinted by `hue`; `dashed` is the
	 * still-indexing outline.
	 */
	let {
		src,
		hue = 200,
		width,
		height,
		ring = false,
		dashed = false,
		label,
		children
	}: {
		src?: string | null;
		hue?: number;
		width?: number;
		height?: number;
		ring?: boolean;
		dashed?: boolean;
		label?: string;
		children?: Snippet;
	} = $props();

	const background = $derived(
		dashed
			? 'transparent'
			: // The stripes stay underneath: an image that fails leaves the placeholder.
				src
				? `center / cover no-repeat url(${src}), ${coverPlaceholder(hue)}`
				: coverPlaceholder(hue)
	);
</script>

<div
	class="cover"
	class:dashed
	class:ring
	class:sized={width != null && height != null}
	style:width={width != null ? `${width}px` : undefined}
	style:height={height != null ? `${height}px` : undefined}
	style:background
>
	{#if label}<span class="label">{label}</span>{/if}
	{@render children?.()}
</div>

<style>
	/* The width is said outright, not left to a stretching parent: the Xiaomi
	   Pad 5's browser gave a stretched cover no height from its ratio, and every
	   tile in the library lost its cover (2026-10-15). */
	.cover {
		position: relative;
		width: 100%;
		aspect-ratio: var(--cover-ratio);
		flex-shrink: 0;
		display: flex;
		align-items: center;
		justify-content: center;
	}
	.sized {
		aspect-ratio: auto;
	}
	/* An engine without aspect-ratio at all: a padding the ratio's height. */
	@supports not (aspect-ratio: 1) {
		.cover:not(.sized)::before {
			content: '';
			padding-top: calc(100% * 2.9 / 2);
		}
	}
	.dashed {
		border: 1px dashed var(--line-2);
	}
	.ring {
		box-shadow: var(--select-ring);
	}
	.label {
		font: 400 11px var(--font-mono);
		color: var(--text-2);
	}
</style>

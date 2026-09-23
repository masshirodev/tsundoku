<script lang="ts">
	import { ratingBars } from '$lib/library/rating';
	import type { Rating } from '$lib/library/types';

	/** Five flat bars. Unrated draws no track at all; 0 draws five empty ones. */
	let {
		value = null,
		height = 4,
		gap = 2
	}: { value?: Rating; height?: number; gap?: number } = $props();
</script>

<div
	class="bars"
	role="img"
	aria-label={value === null ? 'Unrated' : `Rated ${value} of 5`}
	style:height="{height}px"
	style:gap="{gap}px"
>
	{#each ratingBars(value) as bar, i (i)}
		<div class="bar {bar}"></div>
	{/each}
</div>

<style>
	.bars {
		display: flex;
	}
	.bar {
		flex: 1;
	}
	.on {
		background: var(--rating-on);
	}
	.off {
		background: var(--rating-off);
	}
	.none {
		background: var(--rating-unrated);
	}
</style>

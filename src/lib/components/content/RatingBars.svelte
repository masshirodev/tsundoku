<script lang="ts">
	import { ratingBars } from '$lib/library/rating';
	import type { Rating } from '$lib/library/types';

	/** Five flat bars. Unrated (0) draws no track at all. */
	let {
		value = 0,
		height = 4,
		gap = 2
	}: { value?: Rating; height?: number; gap?: number } = $props();
</script>

<div
	class="bars"
	role="img"
	aria-label={value === 0 ? 'Unrated' : `Rated ${value} of 5`}
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

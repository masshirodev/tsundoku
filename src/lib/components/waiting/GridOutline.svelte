<script lang="ts">
	import { onMount } from 'svelte';

	/**
	 * A grid of cover tiles in outline (Loading States 1c–1f, 1i): flat panel
	 * cells with a grey title bar, in the real grid's columns. It fills the
	 * viewport and stops: the number of cells is the screen's, never the
	 * shelf's, so it can't count a hidden series or say how long a list is.
	 */
	let rows = $state(3);
	let el = $state<HTMLElement | null>(null);
	let cols = $state(6);
	onMount(() => {
		const measure = () => {
			if (!el) return;
			cols = Number(getComputedStyle(el).getPropertyValue('--grid-cols')) || 6;
			const tileW = el.clientWidth / cols;
			const tileH = tileW * (2.9 / 2) + 62;
			rows = Math.max(1, Math.ceil((innerHeight - el.getBoundingClientRect().top) / tileH));
		};
		measure();
		addEventListener('resize', measure);
		return () => removeEventListener('resize', measure);
	});
</script>

<div class="grid" bind:this={el} aria-hidden="true">
	{#each { length: rows * cols }, i (i)}
		<div class="tile">
			<div class="cover"></div>
			<!-- 10 + 8 + 14 + 8 + 4 = 44px: the real tile's title and bars, so nothing moves. -->
			<div class="t"></div>
			<div class="s"></div>
			<div class="b"></div>
		</div>
	{/each}
</div>

<style>
	.grid {
		display: grid;
		grid-template-columns: repeat(var(--grid-cols), minmax(0, 1fr));
		gap: 1px;
		background: var(--line-1);
		border-top: var(--hairline);
		border-bottom: var(--hairline);
		overflow: hidden;
	}
	.tile {
		display: flex;
		flex-direction: column;
		gap: 8px;
		padding: 10px;
		background: var(--surface-page);
	}
	.cover {
		aspect-ratio: 2 / 2.9;
		background: var(--surface-panel);
	}
	.t {
		width: 70%;
		height: 10px;
		background: var(--line-1);
	}
	.s {
		height: 14px;
	}
	.b {
		height: 4px;
	}
</style>

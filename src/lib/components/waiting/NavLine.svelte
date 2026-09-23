<script lang="ts">
	import { waiting } from '$lib/waiting.svelte';

	/**
	 * The header's bottom rule while a screen is on its way (Loading States
	 * 1b): a 2px line, ink while the workstation works, filling with accent as
	 * the screen's bytes arrive. It sits over the header's own hairline, so the
	 * header never changes height. Placed by every header; `force` draws it in
	 * an outline's header, which only exists while waiting.
	 */
	let { force = false }: { force?: boolean } = $props();
	const on = $derived(force || (waiting.phase !== 'idle' && waiting.phase !== 'pressed'));
</script>

{#if on}
	<div
		class="navline"
		role="progressbar"
		aria-label="Loading"
		aria-valuemin={0}
		aria-valuemax={100}
		aria-valuenow={Math.round(waiting.fill * 100)}
	>
		<div class="fill" style:width="{waiting.fill * 100}%"></div>
	</div>
{/if}

<style>
	.navline {
		position: absolute;
		left: 0;
		right: 0;
		bottom: -1px;
		z-index: 6;
		height: 2px;
		background: var(--text-1);
		pointer-events: none;
	}
	.fill {
		height: 2px;
		background: var(--accent);
	}
</style>

<script lang="ts">
	/** `value` is a fraction, 0-1. */
	let {
		value = 0,
		height = 3,
		width,
		tone = 'accent'
	}: { value?: number; height?: number; width?: number; tone?: 'accent' | 'ink' } = $props();

	const pct = $derived(`${Math.max(0, Math.min(1, value)) * 100}%`);
</script>

<div
	class="track"
	style:height="{height}px"
	style:width={width != null ? `${width}px` : undefined}
	role="progressbar"
	aria-valuemin={0}
	aria-valuemax={100}
	aria-valuenow={Math.round(value * 100)}
>
	<div class="fill {tone}" style:height="{height}px" style:width={pct}></div>
</div>

<style>
	.track {
		background: var(--line-1);
	}
	.accent {
		background: var(--accent);
	}
	.ink {
		background: var(--text-1);
	}
</style>

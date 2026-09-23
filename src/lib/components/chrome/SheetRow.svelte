<script lang="ts">
	import type { Snippet } from 'svelte';

	/** A labelled row inside a sheet: a 120px label cell, then content. */
	let { label, children }: { label: string; children: Snippet } = $props();
</script>

<div class="row">
	<div class="label">{label.toUpperCase()}</div>
	<div class="content">{@render children()}</div>
</div>

<style>
	.row {
		display: flex;
		align-items: stretch;
		min-height: 64px;
		border-bottom: var(--hairline);
	}
	.label {
		display: flex;
		align-items: center;
		width: 120px;
		flex-shrink: 0;
		padding: 0 var(--pad);
		font: var(--type-label);
		color: var(--text-2);
		border-right: var(--hairline);
	}
	.content {
		flex: 1;
		min-width: 0;
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 8px;
		padding: 10px 18px;
	}
</style>

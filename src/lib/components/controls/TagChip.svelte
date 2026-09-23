<script lang="ts">
	import type { Snippet } from 'svelte';

	/**
	 * A 44px chip: `namespace value count`, the outer two dimmed. A link when
	 * given `href`, a button otherwise. Selected chips are inverted.
	 */
	let {
		namespace,
		value,
		count,
		selected = false,
		href,
		height = 44,
		onclick,
		children
	}: {
		namespace?: string;
		value?: string;
		count?: number | string;
		selected?: boolean;
		href?: string;
		height?: number;
		onclick?: () => void;
		children?: Snippet;
	} = $props();
</script>

{#snippet body()}
	{#if namespace}<span class="dim">{namespace}</span>{/if}
	{#if value}<span>{value}</span>{/if}
	{@render children?.()}
	{#if count != null}<span class="dim">{count}</span>{/if}
{/snippet}

{#if href}
	<!-- eslint-disable-next-line svelte/no-navigation-without-resolve -- callers pass an href already built with resolve() -->
	<a class="chip" class:selected {href} style:height="{height}px">{@render body()}</a>
{:else}
	<button type="button" class="chip" class:selected style:height="{height}px" {onclick}
		>{@render body()}</button
	>
{/if}

<style>
	.chip {
		display: inline-flex;
		align-items: center;
		gap: 10px;
		padding: 0 14px;
		border-radius: 0;
		border: 1px solid var(--line-2);
		background: transparent;
		color: var(--text-1);
		font: var(--type-control);
		cursor: pointer;
		white-space: nowrap;
	}
	.chip:hover {
		color: var(--text-1);
	}
	.dim {
		opacity: 0.6;
	}
	.selected,
	.selected:hover,
	.chip:active {
		border-color: var(--surface-inverse);
		background: var(--surface-inverse);
		color: var(--text-inverse);
	}
</style>

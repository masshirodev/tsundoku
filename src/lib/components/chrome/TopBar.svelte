<script lang="ts">
	import type { Snippet } from 'svelte';

	/**
	 * A row of cells split by hairlines: left, a flexible middle, right.
	 * `inverse` is multi-select mode; `strong` is the full-ink rule under an
	 * active mode surface such as search.
	 */
	let {
		left,
		middle,
		right,
		inverse = false,
		strong = false,
		label
	}: {
		left?: Snippet;
		middle?: Snippet;
		right?: Snippet;
		inverse?: boolean;
		strong?: boolean;
		label?: string;
	} = $props();
</script>

<header class="bar" class:inverse class:strong aria-label={label}>
	{#if left}<div class="cell left">{@render left()}</div>{/if}
	<div class="middle">{@render middle?.()}</div>
	{#if right}<div class="cell right">{@render right()}</div>{/if}
</header>

<style>
	.bar {
		flex-shrink: 0;
		display: flex;
		align-items: stretch;
		height: var(--header-h);
		border-bottom: var(--hairline);
		color: var(--text-1);
	}
	.strong {
		border-bottom: var(--rule-strong);
	}
	.inverse {
		background: var(--surface-inverse);
		color: var(--text-inverse);
		border-bottom: 0;
	}
	.cell {
		display: flex;
		align-items: stretch;
	}
	.left {
		border-right: var(--hairline);
	}
	.right {
		border-left: var(--hairline);
	}
	.inverse .left {
		border-right: 1px solid var(--text-2);
	}
	.inverse .right {
		border-left: 1px solid var(--text-2);
	}
	.middle {
		flex: 1;
		display: flex;
		align-items: stretch;
		min-width: 0;
	}
	/* Anything placed in a cell fills it and centres its content. */
	.cell > :global(*),
	.middle > :global(*) {
		display: flex;
		align-items: center;
	}
</style>

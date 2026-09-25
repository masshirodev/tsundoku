<script lang="ts">
	import type { Snippet } from 'svelte';

	/**
	 * `01 — CONTINUE` on the left, a count or the sort on the right. The top
	 * padding differs by position on the screen -- 18px for the first section,
	 * 24px after content -- which is why it is a prop rather than fixed.
	 */
	let {
		index,
		text,
		top = 24,
		extra = '',
		right
	}: {
		index?: number;
		text: string;
		top?: number;
		/** What narrows it, in full ink after the text: " · RATED 4+ · NOT FAV" (doc/FILTERS.md). */
		extra?: string;
		right?: Snippet;
	} = $props();
</script>

<div class="label" style:padding-top="{top}px">
	<div>
		{index != null
			? `${String(index).padStart(2, '0')} — `
			: ''}{text.toUpperCase()}{#if extra}<span class="extra">{` · ${extra}`}</span>{/if}
	</div>
	{#if right}<div class="right">{@render right()}</div>{/if}
</div>

<style>
	.label {
		flex-shrink: 0;
		display: flex;
		justify-content: space-between;
		gap: 12px;
		padding: 24px var(--pad) 12px;
		font: var(--type-label);
		letter-spacing: var(--tracking-label);
		color: var(--text-2);
	}
	.right {
		display: flex;
		white-space: nowrap;
	}
	.extra {
		color: var(--text-1);
	}
	.right :global(button) {
		all: unset;
		cursor: pointer;
	}
</style>

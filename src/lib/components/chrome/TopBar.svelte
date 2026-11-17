<script lang="ts">
	import type { Snippet } from 'svelte';
	import NavLine from '$lib/components/waiting/NavLine.svelte';

	/**
	 * A row of cells split by hairlines: left, a flexible middle, right.
	 * `inverse` is multi-select mode; `strong` is the full-ink rule under an
	 * active mode surface such as search. `sticky` keeps it at the top while the
	 * screen scrolls under it, on a phone and the tablet; on a desktop the
	 * sidebar already stays.
	 */
	let {
		left,
		middle,
		right,
		inverse = false,
		strong = false,
		sticky = false,
		label
	}: {
		left?: Snippet;
		middle?: Snippet;
		right?: Snippet;
		inverse?: boolean;
		strong?: boolean;
		sticky?: boolean;
		label?: string;
	} = $props();
</script>

<header class="bar" class:inverse class:strong class:sticky aria-label={label}>
	{#if left}<div class="cell left">{@render left()}</div>{/if}
	<div class="middle">{@render middle?.()}</div>
	{#if right}<div class="cell right">{@render right()}</div>{/if}
	<!-- While a screen is on its way, the bottom rule is its progress (doc/WAITING.md). -->
	<NavLine />
</header>

<style>
	.bar {
		position: relative;
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
	/* Above the tiles and their badges (2–6), under the bulk bar (10) and sheets (20). */
	.sticky {
		position: sticky;
		top: 0;
		z-index: 8;
	}
	.sticky:not(.inverse) {
		background: var(--surface-page);
	}
	@media (min-width: 1024px) and (pointer: fine) {
		.sticky {
			position: relative;
			z-index: auto;
		}
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
	/* Under the TV's 28px safe top; the bar's rules still run edge to
	   edge, because the margin is on the bar and not on the page. */
	@media (pointer: none) and (min-width: 900px) {
		.bar {
			margin-top: var(--safe-y);
		}
	}
</style>

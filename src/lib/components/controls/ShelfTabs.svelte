<script lang="ts">
	import { count } from '$lib/library/labels';
	import type { Shelf } from '$lib/library/types';

	/**
	 * Shelves as a row of cells (tablet, phone) or a column (the desktop
	 * sidebar). The active one is inverted. They are links, so a shelf has a
	 * URL and the back button works.
	 */
	let {
		shelves,
		active,
		href,
		vertical = false
	}: {
		shelves: Shelf[];
		active: string;
		href: (key: string) => string;
		vertical?: boolean;
	} = $props();
</script>

<nav class="tabs" class:vertical aria-label="Shelves">
	{#each shelves as shelf (shelf.key)}
		<!-- Callers build `href` with resolve() (src/lib/library/links.ts). -->
		<!-- eslint-disable svelte/no-navigation-without-resolve -->
		<a
			class="tab"
			class:on={shelf.key === active}
			href={href(shelf.key)}
			aria-current={shelf.key === active ? 'page' : undefined}
			data-sveltekit-noscroll
			data-sveltekit-keepfocus
		>
			<span>{shelf.name.toUpperCase()}</span>
			<span class="n">{count(shelf.count)}</span>
		</a>
		<!-- eslint-enable svelte/no-navigation-without-resolve -->
	{/each}
</nav>

<style>
	.tabs {
		display: flex;
		border-top: var(--hairline);
		border-bottom: var(--hairline);
		overflow-x: auto;
		scrollbar-width: none;
	}
	.tabs::-webkit-scrollbar {
		display: none;
	}
	.tab {
		display: flex;
		align-items: center;
		gap: 8px;
		white-space: nowrap;
		padding: 14px 16px;
		border-right: var(--hairline);
		color: var(--text-1);
		font: var(--type-control);
	}
	.tab:hover {
		color: var(--text-1);
	}
	.n {
		opacity: 0.6;
	}
	.on,
	.on:hover,
	.tab:active {
		background: var(--surface-inverse);
		color: var(--text-inverse);
	}
	.vertical {
		flex-direction: column;
		border: 0;
		overflow: visible;
	}
	.vertical .tab {
		justify-content: space-between;
		height: 44px;
		padding: 0 24px;
		border-right: 0;
	}
</style>

<script lang="ts">
	import { count } from '$lib/library/labels';
	import type { Shelf } from '$lib/library/types';

	/**
	 * Shelves as a row of cells (tablet, phone) or a column (the desktop
	 * sidebar). The active one is inverted. They are links, so a shelf has a
	 * URL and the back button works.
	 *
	 * A shelf opens at its top (c589, the owner, 2026-11-05: "clicking a shelf
	 * should set take me to the top"), the one already showing included: the
	 * links let SvelteKit scroll, which jumps, and BACK puts the last shelf's
	 * place back (the library's snapshot). Focus stays on the tab
	 * (keepfocus), so a TV's mark stays on the row. + NEW keeps the scroll: it
	 * opens a field where it is.
	 */
	let {
		shelves,
		active,
		href,
		vertical = false,
		bare = false,
		newHref
	}: {
		shelves: Shelf[];
		active: string;
		href: (key: string) => string;
		vertical?: boolean;
		/** Inside a bar that draws the rules (the tabs beside FILTER). */
		bare?: boolean;
		/** + NEW, the last tab (Library Filters 3g): a new shelf. */
		newHref?: string;
	} = $props();

	let nav = $state<HTMLElement | null>(null);
	// A row that scrolls keeps the active shelf in view, as the mocks draw it
	// (Library Filters 3d): MANGA shouldn't hide off the end behind FILTER.
	$effect(() => {
		if (vertical || !nav) return;
		void active;
		const on = nav.querySelector<HTMLElement>('.on');
		if (on) nav.scrollLeft += on.getBoundingClientRect().left - nav.getBoundingClientRect().left;
	});
</script>

<nav class="tabs" class:vertical class:bare aria-label="Shelves" bind:this={nav}>
	{#each shelves as shelf (shelf.key)}
		<!-- Callers build `href` with resolve() (src/lib/library/links.ts). -->
		<!-- eslint-disable svelte/no-navigation-without-resolve -->
		<a
			class="tab"
			class:on={shelf.key === active}
			href={href(shelf.key)}
			aria-current={shelf.key === active ? 'page' : undefined}
			data-sveltekit-keepfocus
			data-focus-mark="in"
			data-focus-id={`shelf-${shelf.key}`}
		>
			<span>{shelf.name.toUpperCase()}</span>
			<span class="n">{shelf.countText ?? count(shelf.count)}</span>
		</a>
		<!-- eslint-enable svelte/no-navigation-without-resolve -->
	{/each}
	{#if newHref}
		<!-- eslint-disable-next-line svelte/no-navigation-without-resolve -- the caller's href resolves -->
		<a class="tab new" href={newHref} data-sveltekit-noscroll data-focus-mark="in">+ NEW</a>
	{/if}
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
	.bare {
		flex: 1;
		min-width: 0;
		border: 0;
	}
	.new {
		color: var(--text-2);
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
	/* The TV's row is 56px, in the bar the library draws around it (c238). */
	@media (pointer: none) and (min-width: 900px) {
		.tab {
			height: 100%;
			padding: 0 18px;
		}
	}
</style>

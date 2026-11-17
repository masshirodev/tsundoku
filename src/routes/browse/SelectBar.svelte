<script lang="ts">
	import TopBar from '$lib/components/chrome/TopBar.svelte';
	import { barCount } from '$lib/library/browse-select';
	import { browseSelection } from '$lib/library/browse-selection.svelte';

	/**
	 * The bar while selecting in a catalog: inverse, ✕ · N SELECTED · SHOW, and the way to
	 * the source's own search, `/ SEARCH MANGADEX TO TICK` (`/` alone on a
	 * phone). No SELECT ALL: a catalog has no end, and every tick is a request
	 * at the press. With two sources the count says so (`· 2 SOURCES`) on a
	 * tablet and a desktop; a phone's bar has no room, and the bulk bar's line
	 * says it there. BROWSE draws it with no search (`find` null).
	 */
	let {
		find = null,
		findLabel = '',
		onshow
	}: {
		/** The source's search, while one is not already open. */
		find?: string | null;
		/** The source's name, as the hint says it. */
		findLabel?: string;
		onshow: () => void;
	} = $props();

	const sel = browseSelection;
	const c = $derived(barCount(sel.list));
</script>

<TopBar inverse sticky label="Selection">
	{#snippet middle()}
		<!-- Every cell in the middle, each with its own left rule, as the design builds the bar. -->
		<button
			type="button"
			class="cell-btn x"
			aria-label="Stop selecting"
			data-focus-mark="in"
			onclick={() => sel.end()}>✕</button
		>
		<div class="count" aria-live="polite">
			{c.count}{#if c.sources}<small>{` ${c.sources}`}</small>{/if}
		</div>
		<button
			type="button"
			class="cell-btn show"
			data-focus-mark="in"
			disabled={sel.ticks.size === 0}
			onclick={onshow}>SHOW</button
		>
		{#if find}
			<!-- eslint-disable-next-line svelte/no-navigation-without-resolve -- the page builds it from resolve() -->
			<a class="hint" href={find} aria-label="Search {findLabel} to tick" data-focus-mark="in"
				><b>/</b><span class="long">SEARCH {findLabel.toUpperCase()} TO TICK</span></a
			>
		{:else}
			<span class="grow"></span>
		{/if}
	{/snippet}
</TopBar>

<style>
	/* Transcribed from the design: its literals; colours are tokens. */
	.cell-btn {
		display: flex;
		align-items: center;
		padding: 0 var(--pad);
		border: 0;
		border-radius: 0;
		background: transparent;
		color: inherit;
		font: var(--type-control);
		white-space: nowrap;
		cursor: pointer;
	}
	.cell-btn:disabled {
		opacity: 0.4;
		cursor: default;
	}
	.x {
		font: 500 16px var(--font-mono);
	}
	.count {
		gap: 10px;
		padding: 0 18px;
		border-left: 1px solid var(--text-2);
		font: 500 17px var(--font-mono);
		white-space: nowrap;
	}
	.count small {
		font: 400 13px var(--font-mono);
	}
	.show {
		border-left: 1px solid var(--text-2);
	}
	.hint {
		flex: 1;
		min-width: 0;
		padding: 0 18px;
		border-left: 1px solid var(--text-2);
		color: var(--text-inverse);
		font: 400 16px var(--font-mono);
		text-decoration: none;
		white-space: nowrap;
		overflow: hidden;
	}
	.hint b {
		font-weight: 500;
		margin-right: 1ch;
	}
	.grow {
		flex: 1;
		border-left: 1px solid var(--text-2);
	}
	/* The phone: the count takes the room, `/` alone, no sources. */
	@media (max-width: 599px) {
		.count {
			flex: 1;
		}
		.count small,
		.hint .long {
			display: none;
		}
		.hint {
			flex: 0 0 auto;
			padding: 0 var(--pad);
			font: 500 16px var(--font-mono);
		}
		.hint b {
			margin-right: 0;
		}
		.grow {
			display: none;
		}
	}
</style>

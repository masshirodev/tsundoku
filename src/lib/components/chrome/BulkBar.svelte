<script lang="ts">
	import type { Snippet } from 'svelte';
	import RatingPicker from '../controls/RatingPicker.svelte';

	/**
	 * Pinned to the bottom while selecting: a RATE row over a row of actions.
	 * The rate cells submit `rating` with whichever form wraps this bar; the
	 * actions are supplied by the caller, one grid cell each.
	 */
	let { actions, columns }: { actions: Snippet; columns: number } = $props();
</script>

<div class="bulk" role="toolbar" aria-label="Selection actions">
	<RatingPicker label="Rate" labelWidth={null} height={60} fontSize={16} name="rating" />
	<div class="actions" style:grid-template-columns="repeat({columns}, 1fr)">
		{@render actions()}
	</div>
</div>

<style>
	.bulk {
		position: fixed;
		left: var(--sheet-left, 0);
		right: 0;
		bottom: 0;
		z-index: 10;
		background: var(--surface-page);
		border-top: var(--rule-strong);
		display: flex;
		flex-direction: column;
		padding-bottom: env(safe-area-inset-bottom);
	}
	.actions {
		display: grid;
	}
	.actions > :global(*) {
		height: 60px;
		display: flex;
		align-items: center;
		justify-content: center;
		border: 0;
		border-right: var(--hairline);
		border-bottom: var(--hairline);
		border-radius: 0;
		background: transparent;
		color: var(--text-1);
		font: var(--type-control);
		white-space: nowrap;
		cursor: pointer;
	}
	.actions > :global(*:disabled) {
		opacity: 0.4;
		cursor: default;
	}
	.actions > :global(*:active:not(:disabled)) {
		background: var(--surface-inverse);
		color: var(--text-inverse);
	}
</style>

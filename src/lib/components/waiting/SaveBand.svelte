<script lang="ts">
	import { saves } from '$lib/saves.svelte';

	/** Writes that didn't go through (Loading States 1o), pinned to the bottom, one band each. */
</script>

{#if saves.failed.length > 0}
	<!-- One band each, stacked in the same shape: the newest sits where a lone band does. -->
	<div class="stack">
		{#each saves.failed as f (f.key)}
			<div class="band" role="alert">
				<div class="text">
					<div class="what">{f.what}</div>
					<div class="why">WORKSTATION DID NOT ANSWER · TRIES AGAIN WITH THE NEXT REQUEST</div>
				</div>
				<button type="button" class="put" onclick={() => saves.putBack(f.key)}
					>{f.putBackLabel}</button
				>
				<button type="button" class="retry" onclick={() => saves.retry(f.key)}>RETRY</button>
			</div>
		{/each}
	</div>
{/if}

<style>
	.stack {
		position: fixed;
		left: var(--sheet-left, 0);
		right: 0;
		bottom: 0;
		z-index: 45;
		/* Many failures must not bury the screen: the stack scrolls instead. */
		max-height: 60dvh;
		overflow-y: auto;
	}
	.band {
		display: flex;
		align-items: stretch;
		min-height: 76px;
		background: var(--surface-panel);
		border-top: 1px solid var(--text-1);
		color: var(--text-1);
	}
	.text {
		flex: 1;
		min-width: 0;
		display: flex;
		flex-direction: column;
		justify-content: center;
		gap: 4px;
		padding: 12px var(--pad);
	}
	.what {
		font: 500 14px var(--font-mono);
		letter-spacing: 0.04em;
	}
	.why {
		font: 400 13px var(--font-mono);
		color: var(--text-2);
	}
	button {
		display: flex;
		align-items: center;
		padding: 0 var(--pad);
		border: 0;
		border-radius: 0;
		font: 500 14px var(--font-mono);
		cursor: pointer;
	}
	.put {
		background: transparent;
		color: var(--text-1);
		border-left: var(--hairline);
	}
	.retry {
		background: var(--accent);
		color: var(--on-accent);
	}
	@media (max-width: 599px) {
		.why {
			display: none;
		}
	}
</style>

<script lang="ts">
	import { saves } from '$lib/saves.svelte';

	/** A write that didn't go through (Loading States 1o), pinned to the bottom. */
</script>

{#if saves.failed}
	<div class="band" role="alert">
		<div class="text">
			<div class="what">{saves.failed.what}</div>
			<div class="why">WORKSTATION DID NOT ANSWER · TRIES AGAIN WITH THE NEXT REQUEST</div>
		</div>
		<button type="button" class="put" onclick={() => saves.putBack()}
			>{saves.failed.putBackLabel}</button
		>
		<button type="button" class="retry" onclick={() => saves.retry()}>RETRY</button>
	</div>
{/if}

<style>
	.band {
		position: fixed;
		left: var(--sheet-left, 0);
		right: 0;
		bottom: 0;
		z-index: 45;
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

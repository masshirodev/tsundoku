<script lang="ts">
	import { askedLine } from '$lib/waiting';
	import { waiting } from '$lib/waiting.svelte';

	/**
	 * Ten seconds and up (Loading States 1l): the workstation isn't answering.
	 * It says how long it has been asking and keeps asking. ← BACK stays where
	 * you are. The offline states (doc/OFFLINE.md) replace it when they apply.
	 */
	let { onback }: { onback: () => void } = $props();
</script>

{#if waiting.phase === 'stalled'}
	<div class="band" role="status">
		<div class="text">
			<div class="what">○ WORKSTATION NOT ANSWERING</div>
			<div class="when">{askedLine(waiting.elapsed ?? 0)}</div>
		</div>
		<button type="button" onclick={onback}>← BACK</button>
	</div>
{/if}

<style>
	.band {
		flex-shrink: 0;
		display: flex;
		align-items: stretch;
		min-height: 72px;
		border-bottom: var(--hairline);
		background: var(--surface-panel);
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
	.when {
		font: 400 13px var(--font-mono);
		color: var(--text-2);
	}
	button {
		display: flex;
		align-items: center;
		padding: 0 var(--pad);
		border: 0;
		border-left: var(--hairline);
		border-radius: 0;
		background: transparent;
		color: var(--text-1);
		font: 500 14px var(--font-mono);
		cursor: pointer;
	}
</style>

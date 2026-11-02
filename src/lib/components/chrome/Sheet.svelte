<script lang="ts">
	import type { Snippet } from 'svelte';
	import { m } from '$lib/paraglide/messages';
	import { focusScope } from '$lib/focus';

	/**
	 * A bottom sheet over a scrim. No shadow and no blur: elevation is the scrim
	 * plus the full-ink rule on the sheet's top edge. Escape and a tap on the
	 * scrim both close it.
	 *
	 * It is a focus scope too (doc/FOCUS.md): the arrows and Tab stay inside it
	 * while it is open, and focus returns to whatever opened it. A sheet opened
	 * by a reader is left alone -- that screen reads its own keys.
	 */
	let {
		open,
		onclose,
		label,
		children
	}: { open: boolean; onclose: () => void; label: string; children: Snippet } = $props();

	function keydown(e: KeyboardEvent) {
		if (open && e.key === 'Escape') onclose();
	}
</script>

<svelte:window onkeydown={keydown} />

{#if open}
	<button type="button" class="scrim appear" aria-label={m.chrome_close()} onclick={onclose}
	></button>
	<div class="sheet appear" role="dialog" aria-modal="true" aria-label={label} use:focusScope>
		{@render children()}
	</div>
{/if}

<style>
	.scrim {
		position: fixed;
		inset: 0;
		background: var(--scrim);
		border: 0;
		padding: 0;
		z-index: 20;
		cursor: default;
	}
	.sheet {
		position: fixed;
		left: var(--sheet-left, 0);
		right: 0;
		bottom: 0;
		max-height: 92dvh;
		overflow-y: auto;
		background: var(--surface-page);
		border-top: var(--rule-strong);
		display: flex;
		flex-direction: column;
		z-index: 21;
		padding-bottom: env(safe-area-inset-bottom);
	}
</style>

<script lang="ts">
	import { leave } from '$lib/motion';
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
	<button
		type="button"
		class="scrim appear"
		aria-label={m.chrome_close()}
		onclick={onclose}
		out:leave
	></button>
	<div
		class="sheet rise"
		out:leave={'down'}
		role="dialog"
		aria-modal="true"
		aria-label={label}
		use:focusScope
	>
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
	/*
	 * Every sheet on a TV is a panel from the right (c238; TV Calls, "SHEETS
	 * ARE PANELS"): 420px wide, the strong rule on its left edge, the screen it
	 * opened over still in view at the left. The page's own rows keep their
	 * 48px right padding, which is what makes the panel's content 372px wide,
	 * as TV-Series and TV-Reader draw it.
	 */
	@media (pointer: none) and (min-width: 900px) {
		.sheet {
			left: auto;
			right: 0;
			top: 0;
			bottom: 0;
			width: var(--tv-panel-w);
			max-height: none;
			height: 100dvh;
			border-top: 0;
			border-left: var(--rule-strong);
			padding: var(--safe-y) var(--pad) var(--safe-y) 0;
			padding-bottom: var(--safe-y);
		}
	}
</style>

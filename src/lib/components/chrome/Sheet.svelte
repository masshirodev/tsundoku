<script lang="ts">
	import { leave } from '$lib/motion';
	import type { Snippet } from 'svelte';
	import { m } from '$lib/paraglide/messages';
	import { focusScope } from '$lib/focus';
	import { lockPage } from '$lib/scroll-lock';

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

	// The page under the scrim holds still while the sheet is open: a drag on
	// the scrim used to scroll the library behind MORE (src/lib/scroll-lock.ts).
	$effect(() => {
		if (open) return lockPage();
	});

	/**
	 * Keeps a focused row out from under the pinned head (c716). Heads differ
	 * per caller and some wrap with their title, so the room is measured; a
	 * caller's head can also come and go with its view (MORE's SERVERS).
	 */
	function headRoom(node: HTMLElement) {
		let watched: HTMLElement | null = null;
		const fit = () => {
			const head = node.querySelector<HTMLElement>(
				':scope > .sheet-head, :scope > form > .sheet-head'
			);
			if (head !== watched) {
				if (watched) sizes.unobserve(watched);
				if (head) sizes.observe(head);
				watched = head;
			}
			// `sticky` stops at the padding, but scroll-padding counts from the edge.
			const pad = head ? parseFloat(getComputedStyle(node).paddingTop) || 0 : 0;
			node.style.scrollPaddingTop = head ? `${pad + head.offsetHeight}px` : '';
		};
		const sizes = new ResizeObserver(fit);
		const views = new MutationObserver(fit);
		views.observe(node, { childList: true });
		fit();
		return {
			destroy() {
				sizes.disconnect();
				views.disconnect();
			}
		};
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
		use:headRoom
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
		/* Its own scroll ends at its edge rather than passing to the page. */
		overscroll-behavior: contain;
		background: var(--surface-page);
		border-top: var(--rule-strong);
		display: flex;
		flex-direction: column;
		z-index: 21;
		padding-bottom: env(safe-area-inset-bottom);
	}
	/*
	 * The sheet scrolls as a whole, so a head with the way out in it is pinned
	 * (c716; ReadingSheet's c679). `sheet-head` marks those: a cover head with
	 * no control (SeriesSheet, BookSheet) would only spend the screen. A head
	 * inside the caller's form still sticks: the form is as tall as the content.
	 */
	.sheet > :global(.sheet-head),
	.sheet > :global(form) > :global(.sheet-head) {
		position: sticky;
		top: 0;
		z-index: 1;
		flex-shrink: 0;
		background: var(--surface-page);
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
		/*
		 * `sticky` counts from the panel's padding, so the head stops on the safe
		 * area with `top: 0`; rows would still scroll through the band above it.
		 */
		.sheet > :global(.sheet-head)::before,
		.sheet > :global(form) > :global(.sheet-head)::before {
			content: '';
			position: absolute;
			left: 0;
			right: 0;
			bottom: 100%;
			height: var(--safe-y);
			background: var(--surface-page);
		}
	}
</style>

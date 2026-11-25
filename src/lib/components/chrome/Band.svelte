<script module lang="ts">
	import { goto } from '$app/navigation';
	import { page } from '$app/state';

	/**
	 * A ✕ for a band that lives in the URL: the parameters go by a
	 * replacing navigation, so a reload does not bring it back, Back does not
	 * step through it, and the page keeps its place and focus.
	 */
	export function clearBandUrl(names: readonly string[]): void {
		// A clear still landing (a slow load) is where the next one starts:
		// `page.url` doesn't move until it lands, and building on it would put
		// the first band's parameters back. Only on the same screen.
		const base =
			pendingClear && pendingClear.pathname === page.url.pathname ? pendingClear : page.url;
		const url = new URL(base);
		for (const name of names) url.searchParams.delete(name);
		pendingClear = url;
		const done = () => {
			if (pendingClear === url) pendingClear = null;
		};
		// eslint-disable-next-line svelte/no-navigation-without-resolve -- the current, resolved path, less its band's parameters
		void goto(url, { replaceState: true, noScroll: true, keepFocus: true }).then(done, done);
	}
	/** The address the last clear is navigating to, until it lands. */
	let pendingClear: URL | null = null;

	/**
	 * When a band last went away: bands stack, so the band below moves
	 * up to where it was, and the second press of a double tap must not reach
	 * it. Measured from the band going, not the press, because a URL band goes
	 * only when its navigation lands, however long that takes.
	 */
	let lastGone = -Infinity;
	const DOUBLE_TAP_MS = 400;
</script>

<script lang="ts">
	import { onDestroy, type Snippet } from 'svelte';
	import { m } from '$lib/paraglide/messages';

	/**
	 * A panel band with a plain action cell on the right: a confirmation
	 * strip ("SERIES CREATED · 6 BOOKS / UNDO",
	 * "NOT A SERIES · WON'T ASK AGAIN / UNDO", "INCOGNITO · NOTHING SAVED /
	 * END"). One line is 48px; with a `detail` line it is 60px. Unlike Banner's
	 * `action` kind, the cell is not accent -- it undoes, it doesn't advance.
	 */
	let {
		title,
		detail,
		action,
		ondismiss,
		dashed = false,
		wrap = false
	}: {
		title: string;
		detail?: string;
		/** The right-hand cell: a form button or a link, supplied by the caller. */
		action?: Snippet;
		/**
		 * Turns on the ✕ cell after `action` (doc/BANDS.md): what clearing
		 * this band does. A band that says what is true now does not pass it.
		 */
		ondismiss?: () => void;
		/** Incognito's mark: "not stored yet" is dashed in Index. */
		dashed?: boolean;
		/**
		 * A detail that must be read whole wraps instead of trailing off, and
		 * the band grows to hold it: the web edition's "this browser can clear
		 * the library" (handoff web-edition-start, Keep-Refused).
		 */
		wrap?: boolean;
	} = $props();

	let pressed = false;
	function dismiss(e: MouseEvent) {
		if (e.timeStamp - lastGone < DOUBLE_TAP_MS) return;
		pressed = true;
		ondismiss?.();
	}

	// Only a ✕ starts the wait: a band replaced by a new answer has not just
	// been pressed, and the next ✕ is the user's own.
	onDestroy(() => {
		if (pressed) lastGone = performance.now();
	});
</script>

<div class="band" class:two={!!detail} class:dashed class:wrap role="status">
	<div class="text">
		<div class="title">{title}</div>
		{#if detail}<div class="detail">{detail}</div>{/if}
	</div>
	{#if action || ondismiss}
		<div class="end">
			{#if action}<div class="act">{@render action()}</div>{/if}
			{#if ondismiss}
				<button
					type="button"
					class="x"
					aria-label={m.band_dismiss()}
					data-focus-mark="in"
					onclick={dismiss}>✕</button
				>
			{/if}
		</div>
	{/if}
</div>

<style>
	.band {
		flex-shrink: 0;
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 12px;
		height: 48px;
		padding-left: var(--pad);
		border-bottom: var(--hairline);
		background: var(--surface-panel);
		font: var(--type-control);
	}
	.band.two {
		height: 60px;
	}
	.band.dashed {
		border-bottom: 2px dashed var(--text-2);
	}
	.band.wrap {
		height: auto;
		min-height: 60px;
	}
	.band.wrap .text {
		gap: 4px;
		padding: 10px 0;
	}
	.band.wrap .detail {
		white-space: normal;
		line-height: 1.4;
	}
	.text {
		display: flex;
		flex-direction: column;
		gap: 3px;
		min-width: 0;
	}
	.end {
		align-self: stretch;
		display: flex;
		flex-shrink: 0;
	}
	.title,
	.detail {
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}
	.detail {
		font: var(--type-meta);
		color: var(--text-2);
	}
	.act {
		align-self: stretch;
		display: flex;
		border-left: var(--hairline);
	}
	.act > :global(form) {
		display: flex;
	}
	.act :global(:is(button, a)) {
		display: flex;
		align-items: center;
		padding: 0 var(--pad);
		border: 0;
		border-radius: 0;
		background: transparent;
		color: var(--text-1);
		font: var(--type-control);
		white-space: nowrap;
		cursor: pointer;
	}
	.act :global(:is(button, a):active) {
		background: var(--surface-inverse);
		color: var(--text-inverse);
	}
	/* The house's ✕ cell, inside the band's own height: its hit area stops at
	   the hairline, so a band stacked below it cannot be pressed through it. */
	.x {
		width: 48px;
		display: flex;
		align-items: center;
		justify-content: center;
		border: 0;
		border-left: var(--hairline);
		border-radius: 0;
		background: none;
		color: var(--text-1);
		font: var(--type-control);
		cursor: pointer;
	}
	.x:active {
		background: var(--surface-inverse);
		color: var(--text-inverse);
	}
</style>

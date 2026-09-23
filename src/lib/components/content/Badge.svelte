<script lang="ts">
	import type { Snippet } from 'svelte';

	/**
	 * A square corner badge on a cover. Tones map to the design system's four:
	 * `accent` (FAV), `page` (+N new), `inverse` (↓N cached), `reveal` (HIDDEN).
	 */
	type Tone = 'accent' | 'page' | 'inverse' | 'reveal';
	type Corner = 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right';

	let {
		tone = 'page',
		corner,
		children
	}: { tone?: Tone; corner?: Corner; children: Snippet } = $props();
</script>

<span class="badge {tone} {corner ?? ''}">{@render children()}</span>

<style>
	.badge {
		display: inline-block;
		font: var(--type-badge);
		padding: 2px 5px;
	}
	.accent {
		background: var(--accent);
		color: var(--on-accent);
	}
	.page {
		background: var(--surface-page);
		color: var(--text-1);
	}
	.inverse {
		background: var(--surface-inverse);
		color: var(--text-inverse);
	}
	.reveal {
		background: var(--reveal);
		color: var(--on-reveal);
	}
	.top-left,
	.top-right,
	.bottom-left,
	.bottom-right {
		position: absolute;
	}
	.top-left {
		left: 0;
		top: 0;
	}
	.top-right {
		right: 0;
		top: 0;
	}
	.bottom-left {
		left: 0;
		bottom: 0;
	}
	.bottom-right {
		right: 0;
		bottom: 0;
	}
</style>

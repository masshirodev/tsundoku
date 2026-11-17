<script lang="ts">
	import RatingBars from './RatingBars.svelte';
	import type { Rating } from '$lib/library/types';

	/**
	 * The TV's focus line (doc/TV.md). Under the pinned KIND band, a 64px bar
	 * names the focused cover in full, because at 144px a tile's own title is
	 * neither readable from the couch nor ever the whole of a romanised title.
	 * It carries the kind, where you are, the rating, and what the remote does
	 * here.
	 *
	 * It reads the DOM rather than a store: a tile puts `data-focus-line` and
	 * its own name, meta and rating on the thing the D-pad focuses, and this
	 * follows focus. That keeps the two in step when the grid pages in, and
	 * means a screen that does not have a line pays for nothing. Only the TV
	 * displays it (CSS), so a tablet's tap-focus draws no bar.
	 */
	type Line = { title: string; meta: string; rating: Rating };

	let line = $state<Line | null>(null);

	$effect(() => {
		const read = () => {
			const el =
				document.activeElement instanceof Element
					? document.activeElement.closest<HTMLElement>('[data-focus-line]')
					: null;
			if (!el) {
				line = null;
				return;
			}
			line = {
				title: el.dataset.focusTitle ?? '',
				meta: el.dataset.focusMeta ?? '',
				rating: (Number(el.dataset.focusRating) || 0) as Rating
			};
		};
		// A blur to nothing fires no focusin, so the frame after every focusout
		// asks again; a focus that has already moved on answers with the new one.
		const later = () => requestAnimationFrame(read);
		document.addEventListener('focusin', read);
		document.addEventListener('focusout', later);
		return () => {
			document.removeEventListener('focusin', read);
			document.removeEventListener('focusout', later);
		};
	});
</script>

{#if line}
	<div class="focus-line" data-testid="focus-line">
		<div class="text">
			<div class="name">{line.title}</div>
			<div class="meta">{line.meta}</div>
		</div>
		<div class="rating"><RatingBars value={line.rating} height={6} gap={3} /></div>
		<div class="hints">
			<span><span class="key">OK</span>OPEN</span>
			<span><span class="key">HOLD OK</span>OPTIONS</span>
		</div>
	</div>
{/if}

<style>
	/* Drawn only on a TV: the phone and tablet name a tile under it, as before. */
	.focus-line {
		display: none;
	}
	@media (pointer: none) and (min-width: 900px) {
		.focus-line {
			position: sticky;
			/* Under the pinned KIND band, in the tabs' place. */
			top: var(--tv-tab-h);
			z-index: 9;
			display: flex;
			align-items: center;
			gap: 24px;
			height: var(--tv-focus-line-h);
			padding: 0 var(--pad);
			border-bottom: var(--hairline);
			background: var(--surface-page);
		}
		.text {
			flex: 1;
			min-width: 0;
			display: flex;
			flex-direction: column;
			gap: 5px;
		}
		.name {
			font: var(--type-row);
			white-space: nowrap;
			overflow: hidden;
			text-overflow: ellipsis;
		}
		.meta {
			font: var(--type-meta);
			color: var(--text-2);
			white-space: nowrap;
			overflow: hidden;
			text-overflow: ellipsis;
		}
		.rating {
			flex-shrink: 0;
			width: 120px;
		}
		.rating :global(.bars) {
			width: 100%;
		}
		.hints {
			flex-shrink: 0;
			display: flex;
			gap: 22px;
			font: var(--type-meta);
			color: var(--text-2);
			white-space: nowrap;
		}
		.key {
			display: inline-flex;
			align-items: center;
			justify-content: center;
			min-width: 26px;
			height: 24px;
			padding: 0 6px;
			margin-right: 8px;
			border: 1px solid var(--line-2);
			color: var(--text-1);
			font: 500 13px/1 var(--font-mono);
		}
	}
</style>

<script lang="ts">
	/**
	 * The kept place's height, and nothing else. Drawing the
	 * kept answer before this visit's own answer arrives would draw results the
	 * server has not cleared for this visit: a series hidden since the list was
	 * left (ADD with ADDED HIDDEN, HIDE, another screen) would show its title and
	 * cover until the answer came, outside reveal (doc/BROWSE.md, "A way back
	 * comes back to the place"). So a restored visit draws this instead: as many
	 * cells as the kept answer had tiles, no title and no cover, so the scroll
	 * has the height the place needs while the answer is on its way.
	 *
	 * The cells and the MORE row are the real grid's (`ResultTile`'s heights,
	 * `more` in the page): the outline is exactly as tall as the list it stands
	 * for, so a place at the very end of a long list is reachable and held. No
	 * count of hidden series rides on it — the page's own line already says how
	 * many were drawn; here there is only empty air.
	 */
	let { count, more }: { count: number; more: boolean } = $props();
</script>

<div class="grid" aria-hidden="true">
	{#each { length: count }, i (i)}
		<div class="tile">
			<div class="cover"></div>
			<!-- The real tile's title and meta line, so the row is exactly as tall. -->
			<div class="t"></div>
			<div class="m"></div>
		</div>
	{/each}
</div>
{#if more}
	<!-- The MORE ↓ row the kept list had, at its own height (the page's `.more`). -->
	<div class="more" aria-hidden="true"></div>
{/if}

<style>
	/* The page's own grid and `ResultTile`'s cell, copied rather than shared, so the
	   outline's height is the drawn list's and no component another screen uses
	   is changed. */
	.grid {
		display: grid;
		grid-template-columns: repeat(var(--grid-cols), minmax(0, 1fr));
		gap: 1px;
		background: var(--surface-page);
		border-bottom: var(--hairline);
	}
	.tile {
		display: flex;
		flex-direction: column;
		gap: 7px;
		min-width: 0;
		padding: 10px;
		background: var(--surface-page);
		box-shadow:
			1px 0 0 var(--line-1),
			0 1px 0 var(--line-1),
			1px 1px 0 var(--line-1);
	}
	.cover {
		aspect-ratio: 2 / 2.9;
		background: var(--surface-panel);
	}
	.t {
		width: 70%;
		height: 32px;
		background: var(--line-1);
	}
	.m {
		height: 29px;
	}
	.more {
		min-height: 56px;
		border-bottom: var(--hairline);
	}
</style>

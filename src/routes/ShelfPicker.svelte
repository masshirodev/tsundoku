<script lang="ts">
	import { enhance } from '$app/forms';
	import Sheet from '$lib/components/chrome/Sheet.svelte';
	import SheetRow from '$lib/components/chrome/SheetRow.svelte';
	import type { Shelf } from '$lib/library/types';
	import type { SubmitFunction } from '@sveltejs/kit';

	/**
	 * `+ SHELF` from the bulk bar: every collection as a chip; tapping one puts
	 * the whole selection on it. The mock draws the button but not what it
	 * opens, so this is the sheet's own SHELVES row reused rather than a new
	 * surface -- see doc/LIBRARY.md, "Departures".
	 */
	let {
		open,
		ids,
		shelves,
		onclose
	}: { open: boolean; ids: number[]; shelves: Shelf[]; onclose: () => void } = $props();

	const collections = $derived(shelves.filter((s) => s.kind === 'collection'));

	const done: SubmitFunction =
		() =>
		async ({ update }) => {
			await update();
			onclose();
		};
</script>

<Sheet {open} {onclose} label="Add to shelf">
	<SheetRow label="Add {ids.length} to">
		{#each collections as c (c.key)}
			<form method="POST" action="/?/shelf" use:enhance={done}>
				{#each ids as id (id)}<input type="hidden" name="id" value={id} />{/each}
				<input type="hidden" name="collection" value={c.key.slice(2)} />
				<button type="submit">{c.name.toUpperCase()}</button>
			</form>
		{/each}
	</SheetRow>
</Sheet>

<style>
	button {
		height: 40px;
		padding: 0 12px;
		display: flex;
		align-items: center;
		border: 1px solid var(--line-2);
		border-radius: 0;
		background: transparent;
		color: var(--text-1);
		font: 500 13px var(--font-mono);
		cursor: pointer;
	}
	button:active {
		background: var(--surface-inverse);
		color: var(--text-inverse);
	}
</style>

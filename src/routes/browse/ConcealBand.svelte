<script lang="ts">
	import { enhance } from '$app/forms';
	import Band from '$lib/components/chrome/Band.svelte';
	import { count } from '$lib/library/downloads';
	import type { ConcealBand } from './conceal.server';

	/**
	 * CONCEAL ITS SERIES' band (card c523; doc/BROWSE.md, "Conceal its
	 * series"): what the press hid and is still hidden, from the source and,
	 * for its Works, from others, and UNDO. On the source's settings page it
	 * names the source; on BROWSE, where it lands outside reveal once the
	 * source is mostly hidden, it does not.
	 */
	let {
		band,
		name,
		undo
	}: {
		band: ConcealBand;
		/** The source's name, or null where reveal hides it. */
		name: string | null;
		/** UNDO's form action. */
		undo: string;
	} = $props();

	const works = $derived(band.works === 1 ? 'THEIR WORK' : `THEIR ${count(band.works)} WORKS`);
	const detail = $derived(
		[
			name ? `${count(band.own)} FROM ${name.toUpperCase()}` : `${count(band.own)} FROM ITS SOURCE`,
			band.others ? `${count(band.others)} MORE: PARTS OF ${works}, HIDDEN WHOLE` : '',
			name ? 'REVEAL SHOWS THEM' : 'THE SOURCE IS HIDDEN WITH THEM · REVEAL SHOWS BOTH'
		]
			.filter(Boolean)
			.join(' · ')
	);
</script>

<Band title="{count(band.hidden)} SERIES HIDDEN NOW" {detail}>
	{#snippet action()}
		<form method="POST" action={undo} use:enhance>
			<input type="hidden" name="concealed" value={band.concealed} />
			<input type="hidden" name="of" value={band.of} />
			<button type="submit">UNDO</button>
		</form>
	{/snippet}
</Band>

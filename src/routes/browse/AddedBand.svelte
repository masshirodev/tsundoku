<script lang="ts">
	import { enhance } from '$app/forms';
	import Band from '$lib/components/chrome/Band.svelte';
	import { addedDetail } from '$lib/library/downloads';
	import type { AddedBand } from './added.server';

	/**
	 * The ADDED band (cards c435, c505; doc/BROWSE.md, "Added hidden"): a
	 * preview's ADD outside reveal on a source that adds its series hidden.
	 * What the series page's band would have said: the chapters, what ADD AND
	 * DOWNLOAD queued, and UNDO while nothing of it is downloaded or read. On
	 * the source's page it names the source; on BROWSE, where it lands once the
	 * ADD left the source mostly hidden, it does not (hidden means not named,
	 * as CONCEAL's band).
	 */
	let {
		band,
		name,
		undo,
		refusal
	}: {
		band: AddedBand;
		/** The source's name, or null where reveal hides it. */
		name: string | null;
		/** UNDO's form action. */
		undo: string;
		/** Why the last UNDO was refused, if it was. */
		refusal: string | null;
	} = $props();

	const refused = $derived(
		refusal ?? (band.touched ? 'something of it is downloaded or read now' : '')
	);
	const tail = $derived(
		refused
			? ` · NO UNDO: ${refused.toUpperCase()}`
			: name || !band.sourceHidden
				? ' · REVEAL SHOWS IT'
				: ' · THE SOURCE IS HIDDEN WITH IT · REVEAL SHOWS BOTH'
	);
</script>

<Band
	title="ADDED TO THE LIBRARY, AND HIDDEN"
	detail="{name ? name.toUpperCase() : 'ITS SOURCE'} ADDS ITS SERIES HIDDEN · {addedDetail(
		band.entries,
		band.queued,
		band.video
	)}{tail}"
>
	{#snippet action()}
		{#if !refused}
			<form method="POST" action={undo} use:enhance>
				<input type="hidden" name="series" value={band.seriesId} />
				<input type="hidden" name="preview" value={band.preview} />
				<button type="submit">UNDO</button>
			</form>
		{/if}
	{/snippet}
</Band>

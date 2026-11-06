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
	 * ADD left the source mostly hidden, it does not outside reveal (hidden
	 * means not named, as CONCEAL's band), and inside reveal it does (c605).
	 */
	let {
		band,
		name,
		reveal,
		undo,
		refusal
	}: {
		band: AddedBand;
		/** The source's name, or null where reveal hides it. */
		name: string | null;
		/** Reveal on: nothing of the source is hidden from this viewer, so there is no tail to point at it. */
		reveal: boolean;
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
			: reveal
				? ''
				: name || !band.sourceHidden
					? ' · REVEAL SHOWS IT'
					: ' · THE SOURCE IS HIDDEN WITH IT · REVEAL SHOWS BOTH'
	);
	/**
	 * UNDO without script posts to `?/undoAdd`, which is the band's own URL with
	 * its parameters replaced: the page would load with no band, and the 409/503
	 * refusal, drawn only inside one, would have nowhere to be read (c605). So
	 * the action carries them, and the answer is this band again, refusing.
	 */
	const submit = $derived(
		`${undo}&added=hidden&series=${band.seriesId}&preview=${encodeURIComponent(band.preview)}` +
			(band.queued ? `&queued=${encodeURIComponent(band.queued)}` : '')
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
			<form method="POST" action={submit} use:enhance>
				<input type="hidden" name="series" value={band.seriesId} />
				<input type="hidden" name="preview" value={band.preview} />
				<button type="submit">UNDO</button>
			</form>
		{/if}
	{/snippet}
</Band>

<script lang="ts">
	import { enhance } from '$app/forms';
	import { page } from '$app/state';
	import type { SubmitFunction } from '@sveltejs/kit';
	import Band from '$lib/components/chrome/Band.svelte';
	import { addedDetail } from '$lib/library/downloads';
	import {
		BAND_SHELVES,
		SHELF_KEY,
		bandChips,
		bandOrder,
		collectionShelves,
		lastShelf,
		otherShelves,
		shelfLine
	} from '$lib/library/add-shelf';
	import type { Shelf } from '$lib/library/types';
	import ShelfPicker from '../ShelfPicker.svelte';
	import NewShelfSheet from '../NewShelfSheet.svelte';
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
		refusal,
		from = null,
		shelves = [],
		onShelves = [],
		shelve = '',
		shelfRefusal = null
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
		/**
		 * The tag origin the page was opened with (`backOrigin`'s answer), kept
		 * through the post: without script the answer is a load of the action's
		 * URL, and ← would go to the default cell without it (c664).
		 */
		from?: string | null;
		/** The layout's shelves (`data.shelves`): the band offers the collections among them (card c724). */
		shelves?: Shelf[];
		/** The shelves (collection ids) the band's series is on now (`bandShelves`). */
		onShelves?: number[];
		/** PUT ON A SHELF's form action (`?/shelve`); none draws no chips. */
		shelve?: string;
		/** Why the last chip's tap was refused, if it was. */
		shelfRefusal?: string | null;
	} = $props();

	/**
	 * PUT ON A SHELF (card c724; doc/BROWSE.md, "Shelves in the ADD band"): the
	 * owner's shelves as chips under the band, one tap each, several allowed,
	 * a second tap takes it off again; the last chosen on this device first
	 * (`SHELF_KEY`). Past `BAND_SHELVES` the rest are in the SHELVES sheet,
	 * `ShelfPicker` as it is; + NEW SHELF is `NewShelfSheet` as it is, open
	 * while the URL says `new=shelf`.
	 */
	let last = $state<number | null>(null);
	$effect(() => {
		try {
			last = lastShelf(localStorage.getItem(SHELF_KEY));
		} catch {
			last = null;
		}
	});
	const on = $derived(new Set(onShelves));
	const collections = $derived(collectionShelves(shelves));
	const offered = $derived(bandChips(bandOrder(collections, last), on, BAND_SHELVES));
	let picking = $state(false);
	/** The band's own address with `new` set or taken off: + NEW SHELF opens the sheet, ✕ closes it. */
	const withNew = (open: boolean) => {
		// eslint-disable-next-line svelte/prefer-svelte-reactivity -- a throwaway copy, never read reactively
		const p = new URLSearchParams(page.url.searchParams);
		if (open) p.set('new', 'shelf');
		else p.delete('new');
		const q = p.toString();
		return `${page.url.pathname}${q ? `?${q}` : ''}`;
	};
	const naming = $derived(!!shelve && page.url.searchParams.get('new') === 'shelf');
	/** A chip's post: without script the answer is a load of this URL, so it carries the band (as UNDO's does). */
	const shelveSubmit = $derived(
		`${shelve}&added=hidden&series=${band.seriesId}&preview=${encodeURIComponent(band.preview)}` +
			(band.queued ? `&queued=${encodeURIComponent(band.queued)}` : '') +
			(from ? `&from=${encodeURIComponent(from)}` : '')
	);
	/**
	 * A chip put on: remembered as the last chosen, once the write answered.
	 * Read from what the form posts, not from the chip's state when it was
	 * drawn: `enhance` keeps the first submit function it is given, so a chip
	 * drawn on and tapped twice would otherwise still read as put off.
	 */
	const chosen: SubmitFunction = ({ formData }) => {
		const id = String(formData.get('collection') ?? '');
		const putOn = formData.get('on') === '1';
		return async ({ result, update }) => {
			// Remembered before the band redraws, so it is never drawn on while unremembered.
			if (result.type === 'success' && putOn && lastShelf(id) !== null)
				try {
					localStorage.setItem(SHELF_KEY, id);
				} catch {
					// Storage unavailable: the shelf is still put on, only not offered first.
				}
			await update({ reset: false });
		};
	};

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
	 * its parameters replaced: the page would load with no band, and the 409
	 * refusal, drawn only inside one, would have nowhere to be read (c605). So
	 * the action carries them, and the answer is this band again, refusing.
	 */
	const submit = $derived(
		`${undo}&added=hidden&series=${band.seriesId}&preview=${encodeURIComponent(band.preview)}` +
			(band.queued ? `&queued=${encodeURIComponent(band.queued)}` : '') +
			(from ? `&from=${encodeURIComponent(from)}` : '')
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
{#if shelve}
	<!-- PUT ON A SHELF (card c724): the band's second line, chips one tap each.
	     Its names are the shelves' own and + NEW SHELF; nothing here is named
	     UNDO, HIDE, SHOW, MORE or ALL. -->
	<div class="shelves" role="group" aria-label="Put on a shelf">
		<span class="ask" class:on={on.size > 0}>{shelfLine(offered.chips, on)}</span>
		{#each offered.chips as c (c.id)}
			<form method="POST" action={shelveSubmit} use:enhance={chosen}>
				<input type="hidden" name="series" value={band.seriesId} />
				<input type="hidden" name="preview" value={band.preview} />
				<input type="hidden" name="collection" value={c.id} />
				<input type="hidden" name="on" value={on.has(c.id) ? '0' : '1'} />
				<button type="submit" class="chip" class:on={on.has(c.id)} aria-pressed={on.has(c.id)}
					>{on.has(c.id) ? '✓ ' : ''}{c.name.toUpperCase()}</button
				>
			</form>
		{/each}
		{#if offered.more > 0}
			<button type="button" class="chip" onclick={() => (picking = true)}
				>{otherShelves(offered.more)}</button
			>
		{/if}
		<!-- eslint-disable-next-line svelte/no-navigation-without-resolve -- this page's own address -->
		<a class="chip new" href={withNew(true)} data-sveltekit-noscroll>+ NEW SHELF</a>
		{#if shelfRefusal}<span class="refused">NOT SHELVED: {shelfRefusal.toUpperCase()}</span>{/if}
	</div>
	<ShelfPicker open={picking} ids={[band.seriesId]} {shelves} onclose={() => (picking = false)} />
	{#if naming}<NewShelfSheet closeHref={withNew(false)} />{/if}
{/if}

<style>
	/* The band's second line (card c724): the Band's panel and hairline, chips as ShelfPicker's. */
	.shelves {
		flex-shrink: 0;
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 8px;
		padding: 10px var(--pad) 12px;
		border-bottom: var(--hairline);
		background: var(--surface-panel);
	}
	.ask {
		font: var(--type-meta);
		color: var(--text-2);
		margin-right: 4px;
	}
	.ask.on {
		color: var(--text-1);
	}
	.shelves form {
		display: flex;
	}
	.chip {
		height: 40px;
		padding: 0 12px;
		display: flex;
		align-items: center;
		border: 1px solid var(--line-2);
		border-radius: 0;
		background: transparent;
		color: var(--text-1);
		font: 500 13px var(--font-mono);
		text-decoration: none;
		white-space: nowrap;
		cursor: pointer;
	}
	/* At the right end, under UNDO: a remote's ↓ from UNDO lands in the strip,
	   and ← walks the chips (doc/FOCUS.md: a stop overlapping across the way wins). */
	.chip.new {
		margin-left: auto;
	}
	.chip.on {
		background: var(--surface-inverse);
		color: var(--text-inverse);
	}
	.refused {
		font: var(--type-meta);
		color: var(--text-1);
	}
</style>

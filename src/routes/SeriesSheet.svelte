<script lang="ts">
	import { enhance } from '$app/forms';
	import Sheet from '$lib/components/chrome/Sheet.svelte';
	import SheetRow from '$lib/components/chrome/SheetRow.svelte';
	import Cover from '$lib/components/content/Cover.svelte';
	import RatingSlider from '$lib/components/controls/RatingSlider.svelte';
	import Switch from '$lib/components/controls/Switch.svelte';
	import TagChip from '$lib/components/controls/TagChip.svelte';
	import { sheetMeta } from '$lib/library/labels';
	import { coverSrc, seriesHref, readHref } from '$lib/library/links';
	import type { SeriesDetail, Shelf } from '$lib/library/types';
	import type { HideFacts, LibraryCard, ShowFacts, WholeAnswer } from '$lib/library/works';
	import type { SubmitFunction } from '@sveltejs/kit';

	/**
	 * The long-press sheet: where a series is rated, favourited, shelved and
	 * hidden without leaving the library. Every control is a form, so the
	 * change is a server write; after each one the sheet re-reads the series
	 * and the page re-reads its data.
	 */
	let {
		id,
		shelves,
		onclose,
		onchange,
		onhid
	}: {
		id: number | null;
		shelves: Shelf[];
		onclose: () => void;
		onchange: () => Promise<void>;
		/**
		 * HIDE's answer when it took a Work whole (its band's facts), for a page
		 * that is not the library: the library's own `form` carries the answer
		 * there, but SvelteKit applies an action's result only on the action's
		 * own page, so the search page would never see it (c391).
		 */
		onhid?: (answer: WholeAnswer) => void;
	} = $props();

	/**
	 * `/api/series/N` is `seriesDetail`, built on the library's card, so it
	 * carries the card's Work too (`LibraryCard.work`): which Work, and how
	 * many parts HIDE takes with it.
	 */
	let detail = $state<(SeriesDetail & Pick<LibraryCard, 'work'>) | null>(null);
	let adding = $state(false);
	let newShelf = $state('');

	async function load(target: number) {
		const res = await fetch(`/api/series/${target}`);
		detail = res.ok ? await res.json() : null;
		if (!res.ok) onclose();
	}

	$effect(() => {
		adding = false;
		newShelf = '';
		if (id === null) detail = null;
		else void load(id);
	});

	const collections = $derived(shelves.filter((s) => s.kind === 'collection'));
	const member = $derived(new Set(detail?.collections ?? []));
	const shelfId = (key: string) => Number(key.slice(2));

	const after: SubmitFunction =
		() =>
		async ({ update }) => {
			await update({ reset: true, invalidateAll: false });
			await onchange();
			if (id !== null) await load(id);
		};

	const afterHide: SubmitFunction =
		() =>
		async ({ update, result }) => {
			await update({ invalidateAll: false });
			if (onhid && result.type === 'success' && result.data) {
				const data = result.data as { hideFacts?: HideFacts; showFacts?: ShowFacts };
				if (data.hideFacts) onhid({ hideFacts: data.hideFacts });
				else if (data.showFacts) onhid({ showFacts: data.showFacts });
			}
			await onchange();
			onclose();
		};
</script>

<Sheet open={id !== null && detail !== null} {onclose} label={detail?.title ?? 'Series'}>
	{#if detail}
		<div class="head">
			<Cover src={coverSrc(detail.id, detail.cover)} hue={detail.hue} width={96} height={139} />
			<div class="text">
				<h2>{detail.title}</h2>
				<div class="meta">{sheetMeta(detail)}</div>
				{#if detail.artist}<div class="meta">artist · {detail.artist}</div>{/if}
			</div>
		</div>

		<form method="POST" action="/?/rate" use:enhance={after}>
			<input type="hidden" name="id" value={detail.id} />
			<!-- Ratings out of 10 1c: the blocky slider, the halves submit buttons. -->
			<RatingSlider value={detail.rating} name="rating" borderTop={false} fontSize={15} />
		</form>

		<SheetRow label="Favourite">
			<form method="POST" action="/?/favourite" use:enhance={after}>
				<input type="hidden" name="id" value={detail.id} />
				<Switch checked={detail.favourite} name="on" value={detail.favourite ? '0' : '1'} />
			</form>
		</SheetRow>

		<SheetRow label="Shelves">
			{#each collections.filter((c) => member.has(shelfId(c.key))) as c (c.key)}
				<form method="POST" action="/?/shelf" use:enhance={after}>
					<input type="hidden" name="id" value={detail.id} />
					<input type="hidden" name="collection" value={shelfId(c.key)} />
					<input type="hidden" name="on" value="0" />
					<button type="submit" class="shelf on">{c.name.toUpperCase()} ✓</button>
				</form>
			{/each}
			{#if adding}
				{#each collections.filter((c) => !member.has(shelfId(c.key))) as c (c.key)}
					<form method="POST" action="/?/shelf" use:enhance={after}>
						<input type="hidden" name="id" value={detail.id} />
						<input type="hidden" name="collection" value={shelfId(c.key)} />
						<button type="submit" class="shelf">{c.name.toUpperCase()}</button>
					</form>
				{/each}
				<form method="POST" action="/?/shelf" use:enhance={after} class="new-shelf">
					<input type="hidden" name="id" value={detail.id} />
					<input
						name="name"
						bind:value={newShelf}
						placeholder="NEW SHELF"
						aria-label="New shelf name"
						autocomplete="off"
					/>
					<button type="submit" class="shelf" disabled={newShelf.trim() === ''}>+</button>
				</form>
			{:else}
				<TagChip height={40} onclick={() => (adding = true)}>+ ADD</TagChip>
			{/if}
		</SheetRow>

		<div class="actions">
			{#if detail.nextEntryId !== null}
				<!-- eslint-disable-next-line svelte/no-navigation-without-resolve -- readHref() resolves -->
				<a class="primary" href={readHref(detail.nextEntryId)}
					>▶ {(detail.nextEntry ?? 'READ').toUpperCase()}</a
				>
			{:else}
				<button type="button" class="primary" disabled>▶ READ</button>
			{/if}
			<!-- eslint-disable svelte/no-navigation-without-resolve -- seriesHref() resolves -->
			<a href={seriesHref(detail.id)}>SERIES</a>
			<a href={seriesHref(detail.id, null, { edit: 'tags' })}>TAGS</a>
			<!-- eslint-enable svelte/no-navigation-without-resolve -->
			<!-- A Work is hidden or shown whole (doc/WORKS.md, "The one rule"): on a
			     part, ?/hide takes every part with it, so the cell says how many, in
			     the HIDE sheet's words, and the library's band says it was the Work. -->
			<form method="POST" action="/?/hide" use:enhance={afterHide}>
				<input type="hidden" name="id" value={detail.id} />
				<input type="hidden" name="on" value={detail.hidden ? '0' : '1'} />
				<button type="submit"
					>{detail.hidden ? 'UNHIDE' : 'HIDE'}{detail.work ? ` ALL ${detail.work.of}` : ''}</button
				>
			</form>
		</div>
	{/if}
</Sheet>

<style>
	.head {
		display: flex;
		gap: 20px;
		padding: 24px var(--pad);
		border-bottom: var(--hairline);
	}
	.text {
		flex: 1;
		min-width: 0;
		display: flex;
		flex-direction: column;
		gap: 8px;
	}
	h2 {
		margin: 0;
		font: var(--type-title);
		text-wrap: pretty;
	}
	.meta {
		font: 400 14px var(--font-mono);
		color: var(--text-2);
	}
	.shelf {
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
	.shelf.on {
		border-color: var(--surface-inverse);
		background: var(--surface-inverse);
		color: var(--text-inverse);
	}
	.shelf:disabled {
		opacity: 0.4;
		cursor: default;
	}
	.new-shelf {
		display: flex;
	}
	.new-shelf input {
		height: 40px;
		width: 160px;
		padding: 0 12px;
		border: 1px solid var(--line-2);
		border-right: 0;
		border-radius: 0;
		background: transparent;
		color: var(--text-1);
		font: 500 13px var(--font-mono);
		caret-color: var(--accent);
		outline: none;
	}
	.new-shelf input:focus {
		border-color: var(--text-1);
	}
	.actions {
		display: flex;
		align-items: stretch;
		height: 68px;
	}
	.actions > button,
	.actions > form {
		flex: 1;
		display: flex;
	}
	.actions button,
	.actions > a {
		flex: 1;
		display: flex;
		align-items: center;
		justify-content: center;
		border: 0;
		border-right: var(--hairline);
		border-radius: 0;
		background: transparent;
		color: var(--text-1);
		font: 500 15px var(--font-mono);
		cursor: pointer;
	}
	.actions > form button {
		border-right: 0;
	}
	.actions .primary {
		background: var(--accent);
		color: var(--on-accent);
		border-right: 0;
	}
	.actions button:disabled {
		cursor: default;
	}
	.actions button:not(.primary):disabled {
		opacity: 0.4;
	}
	.actions > a {
		border-right: var(--hairline);
	}
	.actions button:active:not(:disabled),
	.actions > a:active {
		background: var(--surface-inverse);
		color: var(--text-inverse);
	}
</style>

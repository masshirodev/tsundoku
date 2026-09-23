<script lang="ts">
	import { enhance } from '$app/forms';
	import Sheet from '$lib/components/chrome/Sheet.svelte';
	import Cover from '$lib/components/content/Cover.svelte';
	import { RATING_OPTIONS } from '$lib/library/rating';
	import { hueFor } from '$lib/library/cover';
	import { entryProgress, type SeriesEntry, type SeriesPage } from '$lib/library/series';
	import { readHref } from '$lib/library/links';
	import type { SubmitFunction } from '@sveltejs/kit';

	/**
	 * A book's sheet inside a series of books (Index Books, state 3): the
	 * library's sheet scoped to the book. Its own rating and FAV, and a SERIES
	 * row with MOVE TO… and TAKE OUT. TAKE OUT makes it a single again, keeping
	 * its rating, FAV, tags and page; the series screen then offers UNDO.
	 */
	let {
		series,
		book,
		others,
		onclose,
		onpages
	}: {
		series: SeriesPage;
		book: SeriesEntry | null;
		others: { id: number; title: string; books: number }[];
		onclose: () => void;
		onpages: (book: SeriesEntry) => void;
	} = $props();

	let moving = $state(false);
	const index = $derived(book ? series.entries.findIndex((e) => e.id === book.id) : -1);
	const page = $derived(book ? entryProgress(book)?.page : undefined);
	const people = $derived(
		book ? book.tags.filter((t) => ['circle', 'artist', 'author'].includes(t.namespace)) : []
	);

	$effect(() => {
		if (!book) moving = false;
	});

	const close: SubmitFunction =
		() =>
		async ({ update }) => {
			await update();
			onclose();
		};
</script>

<Sheet open={book !== null} {onclose} label={book?.title ?? 'Book'}>
	{#if book}
		<div class="head">
			<Cover hue={hueFor(book.title || series.title)} width={96} height={139} />
			<div class="text">
				<h2>{book.title}</h2>
				<div class="meta">
					DOUJIN · BOOK {index + 1} OF {series.entries.length} · {book.pageCount} PAGES{page
						? ` · P. ${page}`
						: book.readAt !== null
							? ' · READ'
							: ''}
				</div>
				{#each people.slice(0, 2) as p (p.namespace + p.value)}
					<div class="meta">{p.namespace} · {p.value}</div>
				{/each}
			</div>
		</div>

		<div class="rating-row">
			<div class="label">{book.rating === 0 ? 'UNRATED' : 'RATING'}</div>
			<form method="POST" action="?/bookRate" use:enhance class="cells">
				<input type="hidden" name="entry" value={book.id} />
				{#each RATING_OPTIONS as n (n)}
					<button
						type="submit"
						name="rating"
						value={n}
						class="cell"
						class:on={n > 0 && n <= book.rating}
						class:muted={book.rating === 0}
						aria-pressed={book.rating !== 0 && n === book.rating}
						aria-label={n === 0 ? 'Unrated' : `Rate ${n}`}>{n}</button
					>
				{/each}
			</form>
			<form method="POST" action="?/bookFavourite" use:enhance class="fav-form">
				<input type="hidden" name="entry" value={book.id} />
				<input type="hidden" name="on" value={book.favourite ? '0' : '1'} />
				<button type="submit" class="fav" class:on={book.favourite} aria-pressed={book.favourite}>
					{book.favourite ? 'FAV ✓' : 'FAV'}
				</button>
			</form>
		</div>

		<div class="series-row">
			<div class="label">SERIES</div>
			<div class="series-name">
				{series.title}<span>{index + 1} OF {series.entries.length}</span>
			</div>
			<button
				type="button"
				class="cellbtn"
				disabled={others.length === 0}
				onclick={() => (moving = !moving)}>MOVE TO…</button
			>
			<form method="POST" action="?/takeOut" use:enhance={close} class="take">
				<input type="hidden" name="entry" value={book.id} />
				<button type="submit" class="cellbtn inverse">TAKE OUT</button>
			</form>
		</div>

		{#if moving}
			<ul class="targets">
				{#each others as o (o.id)}
					<li>
						<form method="POST" action="?/move" use:enhance={close}>
							<input type="hidden" name="entry" value={book.id} />
							<input type="hidden" name="to" value={o.id} />
							<button type="submit"
								><span>{o.title}</span><span class="dim">{o.books} BOOKS</span></button
							>
						</form>
					</li>
				{/each}
			</ul>
		{:else}
			<div class="note">
				<span>BECOMES A SINGLE BOOK · KEEPS ITS RATING, FAV, TAGS AND PAGE</span>
				<span>UNDO AFTER</span>
			</div>
		{/if}

		<div class="actions">
			<!-- eslint-disable-next-line svelte/no-navigation-without-resolve -- readHref() resolves -->
			<a class="primary" href={readHref(book.id)}>▶ {page ? `P. ${page}` : 'READ'}</a>
			<button type="button" onclick={() => onpages(book)}>PAGES</button>
			<!-- Editing a single book's tags waits on the tag editor being scoped to books. -->
			<button type="button" disabled>TAGS</button>
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
	.label {
		display: flex;
		align-items: center;
		width: 120px;
		flex-shrink: 0;
		padding: 0 var(--pad);
		font: 500 13px var(--font-mono);
		color: var(--text-2);
		border-right: var(--hairline);
	}
	.rating-row,
	.series-row {
		display: flex;
		align-items: stretch;
		height: 64px;
		border-bottom: var(--hairline);
	}
	.cells {
		flex: 1;
		display: flex;
	}
	button {
		border: 0;
		border-radius: 0;
		background: transparent;
		color: var(--text-1);
		cursor: pointer;
	}
	button:disabled {
		cursor: default;
	}
	.cell {
		flex: 1;
		min-width: 0;
		padding: 0;
		border-right: var(--hairline);
		font: 500 15px var(--font-mono);
	}
	.cell.muted {
		color: var(--text-2);
	}
	.cell.on,
	.fav.on {
		background: var(--accent);
		color: var(--on-accent);
	}
	.fav-form,
	.take {
		display: flex;
	}
	.fav {
		width: 96px;
		font: 500 14px var(--font-mono);
		letter-spacing: 0.04em;
		color: var(--text-2);
	}
	.series-name {
		flex: 1;
		min-width: 0;
		display: flex;
		align-items: center;
		gap: 12px;
		padding: 0 18px;
		font: 500 15px var(--font-sans);
		white-space: nowrap;
		overflow: hidden;
	}
	.series-name span {
		font: 400 13px var(--font-mono);
		color: var(--text-2);
	}
	.cellbtn {
		display: flex;
		align-items: center;
		padding: 0 var(--pad);
		border-left: var(--hairline);
		font: 500 14px var(--font-mono);
		white-space: nowrap;
	}
	.cellbtn:disabled {
		opacity: 0.4;
	}
	.cellbtn.inverse {
		background: var(--surface-inverse);
		color: var(--text-inverse);
		border-left: 0;
	}
	.note {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 12px;
		padding: 14px var(--pad);
		border-bottom: var(--hairline);
		font: 400 13px var(--font-mono);
		color: var(--text-2);
	}
	.targets {
		list-style: none;
		margin: 0;
		padding: 0;
		border-bottom: var(--hairline);
	}
	.targets button {
		width: 100%;
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 12px;
		height: 52px;
		padding: 0 var(--pad);
		border-bottom: var(--hairline);
		font: 500 15px var(--font-sans);
		text-align: left;
	}
	.targets li:last-child button {
		border-bottom: 0;
	}
	.dim {
		font: 400 13px var(--font-mono);
		color: var(--text-2);
	}
	.actions {
		display: flex;
		height: 68px;
	}
	.actions button {
		flex: 1;
		border-right: var(--hairline);
		font: 500 15px var(--font-mono);
	}
	.actions button:last-child {
		border-right: 0;
	}
	.actions .primary {
		flex: 1;
		display: flex;
		align-items: center;
		justify-content: center;
		background: var(--accent);
		color: var(--on-accent);
		border-right: 0;
		font: 500 15px var(--font-mono);
		text-decoration: none;
	}
	.actions button:not(.primary):disabled {
		opacity: 0.4;
	}
	.cell:active:not(.on),
	.fav:active:not(.on),
	.cellbtn:active:not(:disabled),
	.targets button:active,
	.actions button:active:not(:disabled) {
		background: var(--surface-inverse);
		color: var(--text-inverse);
	}
</style>

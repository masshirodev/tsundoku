<script lang="ts">
	import { fileMeta } from '$lib/library/series';
	import { enhance } from '$app/forms';
	import { settleReplacing } from '$lib/back';
	import Sheet from '$lib/components/chrome/Sheet.svelte';
	import Cover from '$lib/components/content/Cover.svelte';
	import RatingSlider from '$lib/components/controls/RatingSlider.svelte';
	import { hueFor } from '$lib/library/cover';
	import { booksOf, entryProgress, type SeriesEntry, type SeriesPage } from '$lib/library/series';
	import { readHref } from '$lib/library/links';
	import type { SubmitFunction } from '@sveltejs/kit';

	/**
	 * A book's sheet inside a series of books: the library's sheet scoped to
	 * the book. Its own rating and FAV, and a SERIES row with MOVE TO… and TAKE
	 * OUT. TAKE OUT makes it a single again, keeping its rating, FAV, tags and
	 * page; the series screen then offers UNDO.
	 */
	let {
		series,
		book,
		others,
		onclose,
		onpages,
		ondelete,
		ontags
	}: {
		series: SeriesPage;
		book: SeriesEntry | null;
		others: { id: number; title: string; books: number }[];
		onclose: () => void;
		onpages: (book: SeriesEntry) => void;
		/** DELETE: the page asks first (doc/DELETING.md). */
		ondelete?: (book: SeriesEntry) => void;
		/** TAGS: the book's own tags, in the shelves-and-tags sheet's book mode. */
		ontags?: (book: SeriesEntry) => void;
	} = $props();

	let moving = $state(false);
	/** The books alone: an extra beside them is not numbered as one. */
	const books = $derived(booksOf(series.entries));
	const index = $derived(book ? books.findIndex((e) => e.id === book.id) : -1);
	const page = $derived(book ? entryProgress(book)?.page : undefined);
	const people = $derived(
		book ? book.tags.filter((t) => ['circle', 'artist', 'author'].includes(t.namespace)) : []
	);

	$effect(() => {
		if (!book) moving = false;
	});

	const close: SubmitFunction = () => async (input) => {
		// Taking out or moving the last book redirects away from a series that's gone.
		await settleReplacing(input);
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
					DOUJIN · BOOK {index + 1} OF {books.length} · {book.pageCount} PAGES{page
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
			<!-- Ratings out of 10 1c: the book's own rating, the halves submit buttons. -->
			<form method="POST" action="?/bookRate" use:enhance class="rate-form">
				<input type="hidden" name="entry" value={book.id} />
				<RatingSlider
					value={book.rating}
					name="rating"
					height={63}
					phoneHeight={63}
					borderTop={false}
					borderBottom={false}
					fontSize={15}
				/>
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
				{series.title}<span>{index + 1} OF {books.length}</span>
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

		<!-- This book's files, and deleting it: a duplicate is the usual reason. -->
		<div class="series-row">
			<div class="label">FILES</div>
			<div class="series-name">{fileMeta([book])}</div>
			<button type="button" class="cellbtn" onclick={() => book && ondelete?.(book)}>DELETE</button>
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
			<button type="button" onclick={() => ontags?.(book)}>TAGS</button>
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
	.rate-form {
		flex: 1;
		min-width: 0;
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
		border-left: var(--hairline);
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
	.fav:active:not(.on),
	.cellbtn:active:not(:disabled),
	.targets button:active,
	.actions button:active:not(:disabled) {
		background: var(--surface-inverse);
		color: var(--text-inverse);
	}
</style>

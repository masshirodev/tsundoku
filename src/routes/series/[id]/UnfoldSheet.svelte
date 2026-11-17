<script lang="ts">
	import { enhance } from '$app/forms';
	import { invalidateAll } from '$app/navigation';
	import Sheet from '$lib/components/chrome/Sheet.svelte';

	/**
	 * UNFOLD INTO 2 BOOKS (doc/EDITIONS.md): a folded book back
	 * into one book per language. Nothing is deleted, so it asks in the
	 * ConfirmSheet's shape but with the book's editions, one line each, saying
	 * where each will be and what it takes.
	 */
	let {
		open,
		lines,
		onclose
	}: {
		open: boolean;
		/** One per edition: its code, its title, and "P. 13 OF 29 · RATING 4 · 2 SHELVES". */
		lines: { code: string; title: string; detail: string }[];
		onclose: () => void;
	} = $props();

	let busy = $state(false);
</script>

<Sheet {open} {onclose} label="Unfold into {lines.length} books">
	<div class="head sheet-head">
		<span class="h">UNFOLD INTO {lines.length} BOOKS</span>
		<button type="button" class="x" aria-label="Close" onclick={onclose}>✕</button>
	</div>
	<p class="lead">
		Each edition becomes a book of its own again, at the page this book is at. Rating, FAV and
		shelves go to both. Nothing is deleted.
	</p>
	<ul class="eds">
		{#each lines as l (l.code)}
			<li>
				<span class="code">{l.code}</span>
				<span class="text"><span class="t">{l.title}</span><span class="d">{l.detail}</span></span>
			</li>
		{/each}
	</ul>
	<p class="note">THE DUPLICATES REVIEW WON’T OFFER THEM AGAIN</p>
	<form
		method="POST"
		action="?/unfold"
		class="actions"
		use:enhance={() => {
			busy = true;
			return async () => {
				await invalidateAll();
				busy = false;
				onclose();
			};
		}}
	>
		<button type="button" onclick={onclose} disabled={busy}>CANCEL</button>
		<button type="submit" class="go" disabled={busy}>{busy ? 'WORKING' : 'UNFOLD'}</button>
	</form>
</Sheet>

<style>
	.head {
		display: flex;
		align-items: stretch;
		min-height: 64px;
		border-bottom: var(--hairline);
	}
	.h {
		flex: 1;
		display: flex;
		align-items: center;
		padding: 12px var(--pad);
		font: 500 15px var(--font-mono);
		letter-spacing: 0.04em;
	}
	.x {
		width: 64px;
		border: 0;
		border-left: var(--hairline);
		background: none;
		color: var(--text-1);
		font: 500 18px var(--font-mono);
		cursor: pointer;
	}
	.lead {
		max-width: 640px;
		margin: 0;
		padding: 24px var(--pad) 20px;
		font: 400 18px/1.45 var(--font-sans);
		text-wrap: pretty;
	}
	.eds {
		margin: 0;
		padding: 0;
		list-style: none;
		border-top: var(--hairline);
	}
	.eds li {
		display: flex;
		align-items: stretch;
		min-height: 72px;
		border-bottom: var(--hairline);
	}
	.code {
		width: 72px;
		flex-shrink: 0;
		display: flex;
		align-items: center;
		justify-content: center;
		border-right: var(--hairline);
		font: 500 14px var(--font-mono);
	}
	.text {
		flex: 1;
		min-width: 0;
		display: flex;
		flex-direction: column;
		justify-content: center;
		gap: 5px;
		padding: 10px 18px;
	}
	.t {
		font: 500 16px/1.25 var(--font-sans);
	}
	.d {
		font: 400 13px var(--font-mono);
		color: var(--text-2);
	}
	.note {
		margin: 0;
		padding: 14px var(--pad);
		font: 400 13px/1.4 var(--font-mono);
		color: var(--text-2);
	}
	.actions {
		display: grid;
		grid-template-columns: 1fr 1fr;
		border-top: var(--hairline);
	}
	.actions button {
		height: 64px;
		border: 0;
		background: none;
		color: var(--text-1);
		font: 500 14px var(--font-mono);
		letter-spacing: 0.06em;
		cursor: pointer;
	}
	.actions .go {
		background: var(--surface-inverse);
		color: var(--text-inverse);
	}
	.actions button:disabled {
		opacity: 0.5;
		cursor: default;
	}
</style>

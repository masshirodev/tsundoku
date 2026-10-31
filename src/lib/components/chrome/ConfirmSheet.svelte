<script lang="ts">
	import { enhance } from '$app/forms';
	import type { ActionResult } from '@sveltejs/kit';
	import type { Snippet } from 'svelte';
	import Sheet from './Sheet.svelte';
	import { m } from '$lib/paraglide/messages';

	/**
	 * Asking before something that can't be taken back in the app, such as
	 * deleting (doc/DELETING.md). A sheet like every other: the question, what
	 * it will do in plain lines, then CANCEL and the action itself in full
	 * ink, as TAKE OUT is. The action is a form post, so nothing happens until
	 * it's pressed.
	 */
	let {
		open,
		title,
		lines,
		confirm,
		action,
		fields,
		onclose,
		ondone,
		extra
	}: {
		open: boolean;
		/** "DELETE KAORI MAMA?" */
		title: string;
		/** What it will do, one fact a line. */
		lines: string[];
		/** The action's own name: "DELETE", "DELETE 3 SERIES". */
		confirm: string;
		/** The form action it posts to. */
		action: string;
		fields: Record<string, string | string[]>;
		onclose: () => void;
		/**
		 * After the post, with its result. Without it the page's data is read
		 * again; with it, that's the caller's to decide (a deleted series has no
		 * page to read again).
		 */
		ondone?: (result: ActionResult) => void | Promise<void>;
		/** A choice to make before it (an anime's QUALITY, doc/ANIME.md), under the title. */
		extra?: Snippet;
	} = $props();

	let busy = $state(false);
	const pairs = $derived(
		Object.entries(fields).flatMap(([k, v]) => (Array.isArray(v) ? v : [v]).map((x) => [k, x]))
	);
</script>

<Sheet {open} {onclose} label={title}>
	<div class="head">
		<span class="h">{title}</span>
		<button type="button" class="x" aria-label={m.chrome_close()} onclick={onclose}>✕</button>
	</div>
	{#if extra}{@render extra()}{/if}
	<div class="body">
		{#each lines as line (line)}<p>{line}</p>{/each}
	</div>
	<form
		method="POST"
		{action}
		class="actions"
		use:enhance={() => {
			busy = true;
			return async ({ result, update }) => {
				if (ondone) await ondone(result);
				else await update();
				busy = false;
			};
		}}
	>
		{#each pairs as [name, value], i (i)}<input type="hidden" {name} {value} />{/each}
		<button type="button" onclick={onclose} disabled={busy}>{m.chrome_cancel()}</button>
		<button type="submit" class="go" disabled={busy}>{busy ? m.chrome_working() : confirm}</button>
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
		font: 500 16px var(--font-mono);
		letter-spacing: var(--tracking-label);
		overflow-wrap: anywhere;
	}
	.x {
		width: 64px;
		border: 0;
		border-left: var(--hairline);
		background: none;
		color: var(--text-1);
		font: 400 20px var(--font-mono);
		cursor: pointer;
	}
	.body {
		display: flex;
		flex-direction: column;
		gap: 10px;
		padding: 20px var(--pad);
		border-bottom: var(--hairline);
	}
	.body p {
		margin: 0;
		font: 400 14px var(--font-mono);
		line-height: 1.5;
		color: var(--text-2);
	}
	.actions {
		display: grid;
		grid-template-columns: 1fr 1fr;
	}
	.actions button {
		height: 64px;
		border: 0;
		background: none;
		color: var(--text-1);
		font: 500 15px var(--font-mono);
		letter-spacing: var(--tracking-label);
		cursor: pointer;
	}
	.actions button + button {
		border-left: var(--hairline);
	}
	/* The action in full ink: the weighty one, as TAKE OUT is. */
	.actions .go {
		background: var(--surface-inverse);
		color: var(--text-inverse);
	}
	.actions button:disabled {
		opacity: 0.5;
		cursor: default;
	}
</style>

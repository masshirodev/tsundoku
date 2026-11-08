<script lang="ts">
	import { enhance } from '$app/forms';
	import type { ActionResult } from '@sveltejs/kit';
	import Sheet from '$lib/components/chrome/Sheet.svelte';
	import Switch from '$lib/components/controls/Switch.svelte';
	import { m } from '$lib/paraglide/messages';
	import { deleteWithLine, keptLine } from '$lib/library/highlights';

	/**
	 * DELETE's confirmation on the series screen (doc/DELETING.md), with the
	 * row highlights add (c701; Out X4): `14 HIGHLIGHTS ARE KEPT`, and DELETE
	 * THEM TOO as a switch under it, off. A copy of the shared ConfirmSheet
	 * (src/lib/components/chrome/), which other screens use as it is: the row
	 * sits after the lines and before the actions, where the shared sheet has
	 * no place for it. With no highlights it draws exactly what ConfirmSheet
	 * does.
	 */
	let {
		open,
		title,
		lines,
		confirm,
		action,
		fields,
		highlights,
		why,
		onclose,
		ondone
	}: {
		open: boolean;
		title: string;
		lines: string[];
		confirm: string;
		action: string;
		fields: Record<string, string>;
		/** How many highlights this delete would leave ORPHAN; 0 draws no row. */
		highlights: number;
		/** Where the kept ones will say they came from, in the sheet's words. */
		why: string;
		onclose: () => void;
		ondone?: (result: ActionResult) => void | Promise<void>;
	} = $props();

	let busy = $state(false);
	let too = $state(false);
	// Off every time the sheet opens: deleting them is never carried over.
	$effect(() => {
		if (open) too = false;
	});
</script>

<Sheet {open} {onclose} label={title}>
	<div class="head sheet-head">
		<span class="h">{title}</span>
		<button type="button" class="x" aria-label={m.chrome_close()} onclick={onclose}>✕</button>
	</div>
	<div class="body">
		{#each lines as line (line)}<p>{line}</p>{/each}
	</div>
	{#if highlights > 0}
		<div class="kept" data-highlights-kept>
			<div class="r col">
				<span class="lbl">{keptLine(highlights)}</span>
				<span class="why">{why}</span>
			</div>
			<div class="r">
				<span class="lbl too">DELETE THEM TOO</span>
				<Switch checked={too} onchange={(v) => (too = v)} />
			</div>
		</div>
	{/if}
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
		{#each Object.entries(fields) as [name, value] (name)}<input
				type="hidden"
				{name}
				{value}
			/>{/each}
		{#if too && highlights > 0}<input type="hidden" name="highlights" value="1" />{/if}
		<button type="button" onclick={onclose} disabled={busy}>{m.chrome_cancel()}</button>
		<button type="submit" class="go" disabled={busy}
			>{busy
				? m.chrome_working()
				: too && highlights > 0
					? deleteWithLine(highlights)
					: confirm}</button
		>
	</form>
</Sheet>

<style>
	/* The head, body and actions are ConfirmSheet's, unchanged. */
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
	/* Out X4's box: a hairline box 16px in, two ruled rows (hl.css .box > .r). */
	.kept {
		display: flex;
		flex-direction: column;
		margin: 16px var(--pad);
		border: var(--hairline);
	}
	.r {
		display: flex;
		align-items: center;
		gap: 14px;
		min-height: 48px;
		padding: 10px 16px;
	}
	.r + .r {
		border-top: var(--hairline);
	}
	.r.col {
		flex-direction: column;
		align-items: flex-start;
		gap: 6px;
	}
	.lbl {
		font: 500 12px/1.2 var(--font-mono);
		letter-spacing: var(--tracking-label);
		color: var(--text-1);
	}
	.lbl.too {
		flex: 1;
		color: var(--text-2);
	}
	.why {
		font: 400 14px/1.45 var(--font-sans);
		color: var(--text-2);
	}
	.actions {
		display: grid;
		grid-template-columns: 1fr 1fr;
	}
	.kept + .actions {
		border-top: var(--hairline);
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
	.actions .go {
		background: var(--surface-inverse);
		color: var(--text-inverse);
	}
	.actions button:disabled {
		opacity: 0.5;
		cursor: default;
	}
</style>

<script lang="ts">
	import { leave } from '$lib/motion';
	import { lockPage } from '$lib/scroll-lock';
	import { focusScope } from '$lib/focus';
	import { resolve } from '$app/paths';
	import { pageSheetHead, pageSheetLine, type KeptPage } from '$lib/library/highlights';

	/**
	 * A kept page's sheet (Highlights H3, c703; Manga M6), opened from
	 * ✓ HIGHLIGHTED or the page menu's ✓ HIGHLIGHTED · OPEN: its copy, NOTE,
	 * when it was made and what it keeps on the workstation, SAVE IMAGE (the
	 * copy at the page's own size) and DELETE, at once, with the band's UNDO.
	 *
	 * The note is saved when it changes and the field is left, or the sheet
	 * closes; a note that did not save says so in the sheet and keeps the words.
	 */
	let {
		kept,
		entryName,
		offline = false,
		onnote,
		ondelete,
		onclose
	}: {
		kept: KeptPage;
		entryName: string;
		offline?: boolean;
		/** Answers whether the workstation took the note. */
		onnote: (note: string) => Promise<boolean>;
		ondelete: () => void;
		onclose: () => void;
	} = $props();

	// The sheet edits its own copy of the note: the page's list follows once it saves.
	// svelte-ignore state_referenced_locally
	let note = $state(kept.note);
	// svelte-ignore state_referenced_locally
	let saved = $state(kept.note);
	let failed = $state(false);
	const copy = $derived(
		resolve('/api/highlights/[id]/[file]', { id: String(kept.id), file: 'copy' })
	);

	async function save() {
		if (note.trim() === saved.trim()) return;
		const ok = await onnote(note);
		failed = !ok;
		if (ok) saved = note;
	}
	async function close() {
		await save();
		onclose();
	}

	// Drawn only while open: the page under its scrim holds still for as long
	// as it is, as under a Sheet (src/lib/scroll-lock.ts, c1033).
	$effect(() => lockPage());
</script>

<svelte:window
	onkeydown={(e) => {
		if (e.key === 'Escape') {
			e.stopPropagation();
			void close();
		}
	}}
/>

<button
	type="button"
	class="scrim appear"
	aria-label="Close the highlight"
	onclick={() => void close()}
	out:leave
></button>
<div
	class="sheet rise"
	out:leave={'down'}
	role="dialog"
	aria-label="Highlight"
	use:focusScope={{ force: true }}
>
	<div class="head">
		<div class="h">{pageSheetHead(entryName, kept)}</div>
		<button
			type="button"
			class="x"
			aria-label="Close"
			data-focus-mark="in"
			onclick={() => void close()}>✕</button
		>
	</div>
	<div class="body">
		<img class="thumb" src={copy} alt="The kept page" draggable="false" />
		<label class="note">
			<span class="nl">NOTE</span>
			<textarea
				bind:value={note}
				rows="3"
				maxlength="4000"
				disabled={offline}
				placeholder="A few lines of your own"
				onblur={() => void save()}></textarea>
			{#if failed}<span class="nf">NOTE NOT SAVED · IT STAYS HERE</span>{/if}
		</label>
	</div>
	<div class="made">{pageSheetLine(kept, Date.now())}</div>
	<div class="foot">
		<a class="act" href="{copy}?save=1" download data-focus-mark="in" data-focus-start=""
			>SAVE IMAGE</a
		>
		<button
			type="button"
			class="act del"
			disabled={offline}
			data-focus-mark="in"
			onclick={() => ondelete()}>DELETE</button
		>
	</div>
</div>

<style>
	.scrim {
		position: fixed;
		inset: 0;
		z-index: 30;
		border: 0;
		background: var(--scrim);
	}
	/* Manga M6, transcribed: the phone's 390 sheet, its literals; colours are tokens. */
	.sheet {
		position: fixed;
		left: 0;
		right: 0;
		bottom: 0;
		z-index: 31;
		display: flex;
		flex-direction: column;
		border-top: var(--rule-strong);
		background: var(--surface-page);
		color: var(--text-1);
		max-height: 90dvh;
		overflow-y: auto;
		/* Its own scroll ends at its edge rather than passing to the page. */
		overscroll-behavior: contain;
	}
	.head {
		display: flex;
		flex-shrink: 0;
		align-items: stretch;
		height: 56px;
		border-bottom: var(--hairline);
	}
	.h {
		display: flex;
		flex: 1;
		align-items: center;
		min-width: 0;
		padding: 0 20px;
		font: 500 12px/14.4px var(--font-mono);
		letter-spacing: 0.06em;
		color: var(--text-2);
	}
	.x {
		display: flex;
		align-items: center;
		justify-content: center;
		min-width: 56px;
		padding: 0 18px;
		border: 0;
		border-left: var(--hairline);
		background: transparent;
		color: var(--text-1);
		font: 500 16px/16px var(--font-mono);
		letter-spacing: 0.06em;
		cursor: pointer;
	}
	.body {
		display: flex;
		flex-shrink: 0;
		gap: 16px;
		padding: 18px 20px;
	}
	.thumb {
		flex-shrink: 0;
		width: 72px;
		height: 104px;
		object-fit: cover;
		object-position: top;
		background: var(--surface-panel);
	}
	.note {
		display: flex;
		flex: 1 1 0%;
		flex-direction: column;
		gap: 10px;
		min-width: 0;
	}
	.nl,
	.nf {
		font: 500 12px/14.4px var(--font-mono);
		letter-spacing: 0.06em;
		color: var(--text-2);
	}
	.nf {
		color: var(--text-1);
	}
	textarea {
		min-height: 76px;
		padding: 12px 14px;
		border: 1px solid var(--line-2);
		border-radius: 0;
		background: var(--surface-panel);
		color: var(--text-1);
		font: 400 15px/24px var(--font-sans);
		resize: vertical;
	}
	.made {
		flex-shrink: 0;
		padding: 0 20px 14px;
		font: 400 12px/15.6px var(--font-mono);
		letter-spacing: 0.04em;
		color: var(--text-2);
	}
	.foot {
		display: flex;
		flex-shrink: 0;
		align-items: stretch;
		height: 56px;
		border-top: var(--hairline);
	}
	.act {
		display: flex;
		flex: 1 1 0%;
		flex-direction: column;
		align-items: flex-start;
		justify-content: center;
		gap: 6px;
		padding: 0 18px;
		border: 0;
		background: transparent;
		color: var(--text-1);
		font: 500 13px/13px var(--font-mono);
		letter-spacing: 0.06em;
		text-decoration: none;
		white-space: nowrap;
		cursor: pointer;
	}
	.act.del {
		border-left: var(--hairline);
	}
	.act:disabled {
		opacity: 0.4;
		cursor: default;
	}
	.act:active,
	.x:active {
		background: var(--surface-inverse);
		color: var(--text-inverse);
	}
	/* The TV: READING's 420px panel from the right, where the pad reaches it. */
	@media (pointer: none) and (min-width: 900px) {
		.sheet {
			left: auto;
			top: 0;
			width: var(--tv-panel-w);
			max-height: none;
			height: 100dvh;
			border-top: 0;
			border-left: var(--rule-strong);
		}
	}
</style>

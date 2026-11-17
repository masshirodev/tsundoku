<script lang="ts">
	import { leave } from '$lib/motion';
	import { lockPage } from '$lib/scroll-lock';
	import { COLOURS, type Colour } from '$lib/library/highlights';

	/**
	 * The open highlight: the words, the three colours, NOTE, COPY and DELETE,
	 * as a bottom sheet on a phone and a 420 px panel on the far side from the
	 * words elsewhere (where the lookup goes). DELETE is at once, with the
	 * reader's band and its UNDO.
	 *
	 * The note saves as it's typed. A note that did not save says so
	 * here and keeps the words, as a page's does.
	 */
	let {
		head,
		quote,
		colour,
		note,
		line,
		side,
		focusNote,
		waiting = false,
		copied = false,
		onnote,
		oncolour,
		oncopy,
		ondelete,
		onclose
	}: {
		head: string;
		quote: string;
		colour: Colour;
		note: string;
		line: string;
		side: 'left' | 'right';
		/** NOTE or N opened it: the field has the keyboard. */
		focusNote: boolean;
		waiting?: boolean;
		copied?: boolean;
		/** Answers whether the note was kept. */
		onnote: (note: string) => Promise<boolean>;
		oncolour: (c: Colour) => void;
		oncopy: () => void;
		ondelete: () => void;
		onclose: () => void;
	} = $props();

	// The sheet edits its own copy of the note: the page's list follows once it saves.
	// svelte-ignore state_referenced_locally
	let draft = $state(note);
	// svelte-ignore state_referenced_locally
	let saved = note;
	let failed = $state(false);
	let timer: ReturnType<typeof setTimeout> | undefined;
	const SAVE_MS = 400;

	/** The text already on its way, so a blur and a close don't send it twice. */
	let sending: string | null = null;
	async function save() {
		clearTimeout(timer);
		if (draft.trim() === saved.trim() || draft === sending) return;
		const text = draft;
		sending = text;
		const ok = await onnote(text);
		sending = null;
		failed = !ok;
		if (ok) saved = text;
	}
	function typed() {
		clearTimeout(timer);
		timer = setTimeout(() => void save(), SAVE_MS);
	}
	async function close() {
		await save();
		onclose();
	}
	/** DELETE after the note has gone: UNDO brings back what was typed. */
	async function del() {
		await save();
		ondelete();
	}
	// Every other way out (Escape, back, a chapter's opening) ends here: what was typed goes too.
	$effect(() => () => void save());

	const word: Record<Colour, string> = { yellow: 'YELLOW', orange: 'ORANGE', blue: 'BLUE' };
	const focused = (el: HTMLTextAreaElement) => {
		if (focusNote) el.focus();
	};

	// Drawn only while open: the page under its scrim holds still for as long
	// as it is, as under a Sheet (src/lib/scroll-lock.ts).
	$effect(() => lockPage());
</script>

<button
	type="button"
	class="scrim appear"
	aria-label="Close the highlight"
	onclick={() => void close()}
	out:leave
></button>
<div class="sheet rise {side}" out:leave={'down'} role="dialog" aria-label="Highlight">
	<div class="head">
		<span class="h">{head}</span>
		<button type="button" class="x" aria-label="Close" onclick={() => void close()}>✕</button>
	</div>
	<div class="body">
		<div class="quote">{quote}</div>
		<div class="colours">
			{#each COLOURS as c (c)}
				<button
					type="button"
					class="sw {c}"
					class:on={colour === c}
					aria-label="{word[c][0]}{word[c].slice(1).toLowerCase()}{colour === c ? ', chosen' : ''}"
					onclick={() => oncolour(c)}>{colour === c ? '✓' : ''}</button
				>
			{/each}
			<span class="lbl">{word[colour]}</span>
		</div>
		<label class="nl" for="quote-note">NOTE</label>
		<textarea
			id="quote-note"
			class="note"
			rows="2"
			maxlength="4000"
			placeholder="A few lines"
			use:focused
			bind:value={draft}
			oninput={typed}
			onblur={() => void save()}></textarea>
		{#if failed}<div class="lbl nf">NOTE NOT SAVED · IT STAYS HERE</div>{/if}
		{#if waiting}<div class="lbl">
				○ WAITING TO BE SENT · ON THIS DEVICE UNTIL THE WORKSTATION ANSWERS
			</div>{/if}
		<div class="meta">{line}</div>
	</div>
	<div class="spacer"></div>
	<div class="foot">
		<button type="button" class="act" onclick={oncopy}>{copied ? '✓ COPIED' : 'COPY'}</button>
		<button type="button" class="act del" onclick={() => void del()}>DELETE</button>
	</div>
</div>

<style>
	.scrim {
		position: fixed;
		inset: 0;
		z-index: 30;
		border: 0;
		background: var(--scrim, rgba(0, 0, 0, 0.6));
	}
	/* The phone's sheet. Colours are the reader's own tokens. */
	.sheet {
		position: fixed;
		left: 0;
		right: 0;
		bottom: 0;
		z-index: 31;
		display: flex;
		flex-direction: column;
		max-height: 90dvh;
		overflow-y: auto;
		/* Its own scroll ends at its edge rather than passing to the page. */
		overscroll-behavior: contain;
		border-top: var(--rule-strong);
		background: var(--surface-page);
		color: var(--text-1);
		font-family: var(--font-sans);
	}
	.head {
		display: flex;
		flex-shrink: 0;
		align-items: stretch;
		height: 56px;
		border-bottom: var(--hairline);
	}
	.h,
	.nl,
	.lbl {
		font: 500 12px/14.4px var(--font-mono);
		letter-spacing: 0.06em;
		color: var(--text-2);
	}
	.h {
		display: flex;
		flex: 1;
		align-items: center;
		min-width: 0;
		padding: 0 20px;
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
		flex-direction: column;
		gap: 16px;
		padding: 18px 20px;
	}
	.quote {
		font: 400 17px/1.55 var(--font-serif);
		color: var(--text-1);
		white-space: pre-line;
	}
	.colours {
		display: flex;
		align-items: center;
		gap: 12px;
	}
	.colours .lbl {
		margin-left: 6px;
	}
	.sw {
		display: flex;
		align-items: center;
		justify-content: center;
		width: 44px;
		height: 44px;
		padding: 0;
		border: 1px solid var(--line-2);
		color: var(--mk-ink);
		font: 500 14px/1 var(--font-mono);
		cursor: pointer;
	}
	.sw.yellow {
		background: var(--mk-y);
	}
	.sw.orange {
		background: var(--mk-o);
	}
	.sw.blue {
		background: var(--mk-b);
	}
	.sw.on {
		box-shadow:
			0 0 0 3px var(--surface-page),
			0 0 0 4px var(--text-1);
	}
	.note {
		min-height: 76px;
		padding: 12px 14px;
		border: 1px solid var(--line-2);
		border-radius: 0;
		background: var(--surface-panel);
		color: var(--text-1);
		font: 400 16px/1.5 var(--font-sans);
		resize: vertical;
	}
	.nf {
		color: var(--text-1);
	}
	.meta {
		font: 400 12px/1.3 var(--font-mono);
		letter-spacing: 0.04em;
		color: var(--text-2);
	}
	.spacer {
		display: none;
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
		align-items: center;
		justify-content: center;
		padding: 0 18px;
		border: 0;
		background: transparent;
		color: var(--text-1);
		font: 500 13px/1 var(--font-mono);
		letter-spacing: 0.06em;
		white-space: nowrap;
		cursor: pointer;
	}
	.act.del {
		border-left: var(--hairline);
	}
	/* Tablet and up: a 420px panel on the far side from the words. */
	@media (min-width: 600px) {
		.sheet {
			left: auto;
			top: 0;
			width: 420px;
			max-height: none;
			border-top: 0;
			border-left: var(--rule-strong);
		}
		.sheet.left {
			left: 0;
			right: auto;
			border-left: 0;
			border-right: var(--rule-strong);
		}
		.body {
			gap: 18px;
			padding: 20px 24px;
		}
		.quote {
			font-size: 18px;
		}
		.spacer {
			display: block;
			flex: 1;
		}
		.foot {
			height: 60px;
		}
	}
</style>

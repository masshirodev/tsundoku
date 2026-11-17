<script lang="ts">
	import { invalidateAll } from '$app/navigation';
	import Sheet from '$lib/components/chrome/Sheet.svelte';
	import { count } from '$lib/library/labels';
	import { addOnlyLine, firstTenLine, pressLine } from '$lib/library/browse-select';
	import { browseSelection } from '$lib/library/browse-selection.svelte';
	import type { Which } from '$lib/library/browse-press';

	/**
	 * The bulk bar while selecting in a catalog (card c868; the Bars board):
	 * a line saying what the press will do, then ADD TO LIBRARY, ADD + FIRST 10
	 * EACH (accent, the common case) and ADD + ALL, the preview's ADD and its
	 * two DOWNLOAD cells, for many. ALL asks first. Nothing ticked dims the
	 * cells and the line says what a tap does. `here` is the list on screen
	 * (`listKey`), null on BROWSE.
	 *
	 * ALL's question is cut 1's (doc/BROWSE.md, "Limits"): it
	 * says what ALL does in plain lines and how many series, not the totals and
	 * the size a counting sheet would, since nothing of a catalog's series is
	 * known before each is asked.
	 */
	let { here = null }: { here?: string | null } = $props();

	const sel = browseSelection;
	const ticks = $derived(sel.list);
	const line = $derived(pressLine(ticks, here));
	const none = $derived(ticks.length === 0);
	/** One press at a time (cut 1): ticking goes on while one runs, pressing waits for it. */
	const busy = $derived(sel.running);
	const off = $derived(none || busy);
	let asking = $state(false);

	function go(which: Which) {
		asking = false;
		sel.press(which, () => void invalidateAll());
	}
</script>

<div class="bulk" role="toolbar" aria-label="Add the selection">
	<div class="say" aria-live="polite">
		{#if none}
			<span>A TAP ON A TILE TICKS IT</span>
		{:else if busy}
			<span
				><span class="ink">{line.lead}</span> · ONE PRESS AT A TIME · THE BAND SAYS WHEN IT ENDS</span
			>
		{:else}
			<span
				><span class="ink">{line.lead}</span>{#each line.wide as w (w)}<span class="wide"
						>{` · ${w}`}</span
					>{/each}{#each line.phone as w (w)}<span class="phone">{` · ${w}`}</span>{/each}</span
			>
			<span class="right"
				><span class="wide">{line.right}</span><span class="phone">{line.rightPhone}</span></span
			>
		{/if}
	</div>
	<div class="acts">
		<button type="button" disabled={off} onclick={() => go('none')}>
			<span class="wide">ADD TO LIBRARY</span><span class="phone">ADD</span>
			<small
				><span class="wide">{addOnlyLine(ticks.length)}</span><span class="phone">NO DOWNLOAD</span
				></small
			>
		</button>
		<button type="button" class="acc" disabled={off} onclick={() => go('first')}>
			<span class="wide">ADD + FIRST 10 EACH</span><span class="phone">ADD + 10</span>
			<small
				><span class="wide">{firstTenLine(ticks)}</span><span class="phone">FIRST 10 EACH</span
				></small
			>
		</button>
		<button type="button" disabled={off} onclick={() => (asking = true)}>
			ADD + ALL
			<small><span class="wide">ASKS FIRST</span><span class="phone">ASKS</span></small>
		</button>
	</div>
</div>

<Sheet open={asking} onclose={() => (asking = false)} label="Add and download all">
	<div class="head">
		<span class="h">ADD {count(ticks.length)} SERIES AND DOWNLOAD EVERY CHAPTER?</span>
		<button type="button" class="x" aria-label="Close" onclick={() => (asking = false)}>✕</button>
	</div>
	<div class="body">
		<p>Each series is added, then every chapter or episode it has is queued.</p>
		<p>A chapter already read is never queued, and nothing is downloaded twice.</p>
		<p>
			How many that is, and its size, is known only once each series is asked: each answers as it is
			added, and the queue shows them.
		</p>
	</div>
	<div class="foot">
		<button type="button" onclick={() => (asking = false)}>CANCEL</button>
		<button type="button" class="acc" onclick={() => go('all')}
			>ADD {count(ticks.length)} + ALL</button
		>
	</div>
</Sheet>

<style>
	/* The Bars board, transcribed: the mock's literals; colours are tokens. */
	.bulk {
		position: fixed;
		left: var(--sheet-left, 0);
		right: 0;
		bottom: 0;
		z-index: 10;
		display: flex;
		flex-direction: column;
		border-top: var(--rule-strong);
		background: var(--surface-page);
		padding-bottom: env(safe-area-inset-bottom);
	}
	.say {
		display: flex;
		justify-content: space-between;
		align-items: center;
		gap: 12px;
		min-height: 44px;
		padding: 8px var(--pad);
		border-bottom: var(--hairline);
		font: var(--type-meta);
		color: var(--text-2);
	}
	.ink {
		color: var(--text-1);
	}
	.right {
		white-space: nowrap;
	}
	.acts {
		display: grid;
		grid-template-columns: repeat(3, minmax(0, 1fr));
	}
	.acts button {
		height: 60px;
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		gap: 3px;
		border: 0;
		border-right: var(--hairline);
		border-radius: 0;
		background: transparent;
		color: var(--text-1);
		font: var(--type-control);
		white-space: nowrap;
		cursor: pointer;
	}
	.acts button:last-child {
		border-right: 0;
	}
	.acts small {
		font: 400 11px var(--font-mono);
		color: var(--text-2);
	}
	.acts .acc {
		background: var(--accent);
		color: var(--on-accent);
	}
	.acts .acc small {
		color: var(--on-accent);
	}
	.acts button:disabled {
		opacity: 0.4;
		cursor: default;
	}
	.phone {
		display: none;
	}
	@media (max-width: 599px) {
		.wide {
			display: none;
		}
		.phone {
			display: inline;
		}
		.acts button {
			font-size: 12px;
		}
	}
	/* ALL's question: ConfirmSheet's head, lines and foot, its action a press, not a post. */
	.head {
		display: flex;
		align-items: stretch;
		min-height: 60px;
		border-bottom: var(--hairline);
	}
	.h {
		flex: 1;
		display: flex;
		align-items: center;
		padding: 0 var(--pad);
		font: var(--type-control);
	}
	.x {
		width: 60px;
		border: 0;
		border-left: var(--hairline);
		border-radius: 0;
		background: transparent;
		color: var(--text-1);
		font: var(--type-control);
		cursor: pointer;
	}
	.body {
		padding: 8px var(--pad);
	}
	.body p {
		margin: 8px 0;
		font: 400 15px/1.5 var(--font-sans);
		color: var(--text-prose);
	}
	.foot {
		display: grid;
		grid-template-columns: 1fr 1fr;
		border-top: var(--hairline);
		margin-top: 16px;
	}
	.foot button {
		height: 60px;
		border: 0;
		border-right: var(--hairline);
		border-radius: 0;
		background: transparent;
		color: var(--text-1);
		font: var(--type-control);
		cursor: pointer;
	}
	.foot .acc {
		border-right: 0;
		background: var(--accent);
		color: var(--on-accent);
	}
</style>

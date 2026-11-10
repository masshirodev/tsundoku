<script lang="ts">
	import { page } from '$app/state';
	import { untrack } from 'svelte';
	import { count } from '$lib/library/labels';
	import { lanesLine, runningTitle } from '$lib/library/browse-press';
	import { browseSelection } from '$lib/library/browse-selection.svelte';
	import {
		BAND_SHELVES,
		SHELF_KEY,
		bandChips,
		bandOrder,
		collectionShelves,
		lastShelf,
		shelfLine
	} from '$lib/library/add-shelf';
	import type { Shelf } from '$lib/library/types';

	/**
	 * A press's one band (card c868; Main board 6 and 7, the Results board),
	 * under the bar of every browse screen while this tab has a run. While it
	 * runs: ADDING 14 SERIES, an ink progress line and the lanes. Then one
	 * result, `ADDED 14 SERIES · 140 CHAPTERS QUEUED` or `ADDED 11 OF 14 · …`,
	 * with RETRY n for what failed, one UNDO for the press, and ✕. PUT ON A
	 * SHELF is live from the run's start: a chip chosen while it runs reaches
	 * every series it adds after, as well as those already added.
	 *
	 * Hidden means hidden: outside reveal it counts only what can be seen, and
	 * a run of hidden sources alone draws no band at all (the Rules board).
	 */
	let { reveal }: { reveal: boolean } = $props();

	const sel = browseSelection;
	const run = $derived(sel.run);
	const lines = $derived(run?.lines(reveal) ?? null);
	const progress = $derived(
		lines?.kind === 'running' ? runningTitle(lines.items) : { title: '', done: 0 }
	);

	// UNDO's words say what it would leave: asked again while the band is up,
	// since a chapter queued by the press can finish downloading meanwhile.
	$effect(() => {
		if (lines?.kind !== 'result' || !run) return;
		const r = run;
		const timer = setInterval(() => void untrack(() => r.readTouched()), 10_000);
		return () => clearInterval(timer);
	});

	let last = $state<number | null>(null);
	$effect(() => {
		try {
			last = lastShelf(localStorage.getItem(SHELF_KEY));
		} catch {
			last = null;
		}
	});
	const on = $derived(new Set(run?.shelves.map((s) => s.id) ?? []));
	const offered = $derived(
		bandChips(
			bandOrder(collectionShelves((page.data.shelves ?? []) as Shelf[]), last),
			on,
			BAND_SHELVES
		)
	);
	function chip(id: number, name: string) {
		if (!run) return;
		const putOn = !on.has(id);
		void run.shelve({ id, name }, putOn);
		if (putOn)
			try {
				localStorage.setItem(SHELF_KEY, String(id));
			} catch {
				// Storage unavailable: the shelf is still put on, only not offered first.
			}
	}
</script>

{#if run && lines}
	<div class="band" role="status" aria-label="The press">
		<div class="row">
			<div class="bx">
				{#if lines.kind === 'running'}
					<div class="bt">{progress.title}</div>
					<div
						class="prog"
						role="progressbar"
						aria-valuemin={0}
						aria-valuemax={lines.items.length}
						aria-valuenow={progress.done}
					>
						<i style:width="{(100 * progress.done) / Math.max(1, lines.items.length)}%"></i>
					</div>
					<div class="bd">{lanesLine(lines.items)}</div>
				{:else if lines.kind === 'result'}
					<div class="bt">{lines.title}</div>
					{#if lines.undo.detail || lines.detail || run.refusal}
						<div class="bd">
							{[run.refusal, lines.undo.detail, lines.detail].filter(Boolean).join(' · ')}
						</div>
					{/if}
				{:else}
					<div class="bt">{lines.title}</div>
					{#if lines.detail}<div class="bd">{lines.detail}</div>{/if}
				{/if}
			</div>
			{#if lines.kind === 'result'}
				{#if lines.failed.length > 0}
					<button type="button" class="c" onclick={() => run.retry()}
						>RETRY {count(lines.failed.length)}</button
					>
				{/if}
				{#if lines.added.length > 0 && lines.undo.cell}
					<button
						type="button"
						class="c"
						disabled={run.undoing}
						onclick={() => void run.undo(reveal)}>{lines.undo.cell}</button
					>
				{/if}
			{/if}
			{#if lines.kind !== 'running'}
				<button type="button" class="c x" aria-label="Close" onclick={() => sel.closeRun()}
					>✕</button
				>
			{/if}
		</div>
		{#if lines.kind !== 'undone' && offered.chips.length > 0}
			<div class="shelfline" role="group" aria-label="Put on a shelf">
				<span class="ask" class:on={on.size > 0}>{shelfLine(offered.chips, on)}</span>
				{#each offered.chips as c (c.id)}
					<button
						type="button"
						class="chip"
						class:on={on.has(c.id)}
						aria-pressed={on.has(c.id)}
						onclick={() => chip(c.id, c.name)}
						>{on.has(c.id) ? '✓ ' : ''}{c.name.toUpperCase()}</button
					>
				{/each}
			</div>
		{/if}
	</div>
{/if}

<style>
	/* The Results board, transcribed: the mock's literals; colours are tokens. */
	.band {
		flex-shrink: 0;
		display: flex;
		flex-direction: column;
		background: var(--surface-panel);
		border-bottom: var(--hairline);
	}
	.row {
		display: flex;
		align-items: stretch;
	}
	.bx {
		flex: 1;
		min-width: 0;
		display: flex;
		flex-direction: column;
		justify-content: center;
		gap: 5px;
		padding: 12px var(--pad);
	}
	.bt {
		font: var(--type-control);
	}
	.bd {
		font: var(--type-meta);
		color: var(--text-2);
	}
	.prog {
		height: 3px;
		margin-top: 3px;
		background: var(--line-2);
	}
	.prog i {
		display: block;
		height: 3px;
		background: var(--text-1);
	}
	.c {
		display: flex;
		align-items: center;
		padding: 0 var(--pad);
		border: 0;
		border-left: var(--hairline);
		border-radius: 0;
		background: transparent;
		color: var(--text-1);
		font: var(--type-control);
		white-space: nowrap;
		cursor: pointer;
	}
	.c:disabled {
		opacity: 0.4;
		cursor: default;
	}
	.x {
		font: 500 16px var(--font-mono);
	}
	.shelfline {
		display: flex;
		align-items: center;
		gap: 8px;
		flex-wrap: wrap;
		padding: 10px var(--pad) 12px;
		border-top: var(--hairline);
		font: var(--type-meta);
		color: var(--text-2);
	}
	.ask.on {
		color: var(--text-1);
	}
	.chip {
		display: inline-flex;
		align-items: center;
		gap: 8px;
		height: 44px;
		padding: 0 14px;
		border: 1px solid var(--line-2);
		border-radius: 0;
		background: transparent;
		color: var(--text-1);
		font: var(--type-control);
		white-space: nowrap;
		cursor: pointer;
	}
	.chip.on {
		background: var(--surface-inverse);
		color: var(--text-inverse);
		border-color: var(--surface-inverse);
	}
</style>

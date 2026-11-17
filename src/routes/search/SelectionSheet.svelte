<script lang="ts">
	import Sheet from '$lib/components/chrome/Sheet.svelte';
	import Cover from '$lib/components/content/Cover.svelte';
	import { count } from '$lib/library/labels';
	import { coverSrc } from '$lib/library/links';
	import { m } from '$lib/paraglide/messages';
	import { goneCount, pickedInOrder, type Picked, type UnseenFacts } from '$lib/library/selection';

	/**
	 * SHOW (doc/LIBRARY.md, "A selection outlives the shelf"): the selection,
	 * wherever it was ticked, in the order it was ticked. A row's tick takes it
	 * out and puts it back; the rows stay until the sheet closes, so a slip is
	 * undone where it was made. GROUP's own sheet draws its rows the same way.
	 * The library and the search draw this one sheet; `ids` is what it listed
	 * when it opened, `selected` what is ticked now. `unseen` is SELECT ALL's
	 * ids read by id: being asked for, or gone since and taken out.
	 */
	let {
		open,
		ids,
		facts,
		selected,
		unseen,
		ontoggle,
		onclose
	}: {
		open: boolean;
		ids: readonly number[];
		facts: ReadonlyMap<number, Picked>;
		selected: ReadonlySet<number>;
		unseen: UnseenFacts;
		ontoggle: (id: number) => void;
		onclose: () => void;
	} = $props();
	/** Listed when it opened, with no facts yet: asked for now, or not asked (offline). */
	const waiting = $derived(ids.filter((id) => !facts.has(id) && !unseen.gone.has(id)));
	const asking = $derived(waiting.filter((id) => unseen.asking.has(id)).length);
	const gone = $derived(goneCount(ids, unseen.gone, selected, facts));
</script>

<Sheet {open} {onclose} label="The selection">
	<div class="show-head">
		<div class="show-title">
			THE SELECTION · {selected.size} SERIES
		</div>
		<button type="button" class="show-done" onclick={onclose}>DONE</button>
	</div>
	<ul class="show-rows">
		{#each pickedInOrder(ids, facts) as p (p.id)}
			{@const on = selected.has(p.id)}
			<li class="show-row" class:off={!on}>
				<button
					type="button"
					class="show-tick"
					role="checkbox"
					aria-checked={on}
					aria-label="Keep {p.title}"
					onclick={() => ontoggle(p.id)}><span class="box" class:on>{on ? '✓' : ''}</span></button
				>
				<span class="show-cov"
					><Cover src={coverSrc(p.id, p.cover)} hue={p.hue} width={34} height={49} /></span
				>
				<span class="show-t">
					<span class="a">{p.title}</span>
					<span class="b">{p.meta}{p.work ? ` · IN ${p.work.name.toUpperCase()}` : ''}</span>
				</span>
			</li>
		{/each}
	</ul>
	{#if asking > 0}
		<!-- SELECT ALL takes the pages not loaded by id alone: read now. -->
		<div class="show-unseen" role="status">{m.library_show_asking({ n: count(asking) })}</div>
	{/if}
	{#if waiting.length - asking > 0}
		<!-- Not asked: offline, or the read was refused. They are selected all the
		     same, and the bulk bar acts on them. -->
		<div class="show-unseen">
			{count(waiting.length - asking)} MORE FROM SELECT ALL · NOT LOADED, SO NOT LISTED
		</div>
	{/if}
	{#if gone > 0}
		<div class="show-unseen">{m.library_show_gone({ n: count(gone) })}</div>
	{/if}
</Sheet>

<style>
	.show-head {
		flex-shrink: 0;
		display: flex;
		align-items: stretch;
		height: 64px;
		border-bottom: var(--hairline);
	}
	.show-title {
		flex: 1;
		display: flex;
		align-items: center;
		padding: 0 24px;
		font: var(--type-control);
	}
	.show-done {
		padding: 0 24px;
		border: 0;
		border-left: var(--hairline);
		border-radius: 0;
		background: transparent;
		color: var(--text-1);
		font: var(--type-control);
		cursor: pointer;
	}
	.show-rows {
		list-style: none;
		margin: 0;
		padding: 0;
	}
	.show-row {
		display: flex;
		align-items: stretch;
		min-height: 64px;
		border-bottom: var(--hairline);
	}
	.show-row.off {
		opacity: 0.4;
	}
	.show-tick {
		width: 64px;
		flex-shrink: 0;
		display: flex;
		align-items: center;
		justify-content: center;
		border: 0;
		border-radius: 0;
		background: transparent;
		cursor: pointer;
	}
	.show-tick .box {
		width: 24px;
		height: 24px;
		border: 1.5px solid var(--line-2);
		display: flex;
		align-items: center;
		justify-content: center;
		font: 500 14px var(--font-mono);
		color: var(--on-accent);
	}
	.show-tick .box.on {
		border-color: var(--accent);
		background: var(--accent);
	}
	.show-cov {
		display: flex;
		align-items: center;
		padding-right: 16px;
	}
	.show-t {
		flex: 1;
		min-width: 0;
		display: flex;
		flex-direction: column;
		justify-content: center;
		gap: 4px;
		padding: 8px 24px 8px 0;
	}
	.show-t .a {
		font: 500 14px/1.3 var(--font-sans);
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}
	.show-t .b {
		font: 400 11px/1.35 var(--font-mono);
		color: var(--text-2);
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}
	.show-unseen {
		padding: 16px 24px;
		font: var(--type-label);
		color: var(--text-2);
	}
</style>

<script lang="ts">
	import { untrack } from 'svelte';
	import Sheet from '$lib/components/chrome/Sheet.svelte';
	import Cover from '$lib/components/content/Cover.svelte';
	import { count } from '$lib/library/labels';
	import { showGroups, showMeta, sourcesWord, type Tick } from '$lib/library/browse-select';
	import { browseSelection } from '$lib/library/browse-selection.svelte';

	/**
	 * SHOW in a catalog (card c868; Show-Tablet): the whole selection grouped
	 * by source, each group in the order it was ticked. A row's box unticks it
	 * and a second tap puts it back; rows stay until the sheet closes, as the
	 * library's SHOW (`SelectionSheet`) keeps them. A row says where it was
	 * ticked, and a group counts what the list on screen does not draw. `here`
	 * is the list on screen (`listKey`), null on BROWSE.
	 */
	let {
		open,
		here = null,
		onclose
	}: { open: boolean; here?: string | null; onclose: () => void } = $props();

	const sel = browseSelection;
	/** What the sheet listed as it opened, and their facts: an untick keeps its row. */
	let held = $state<Tick[]>([]);
	$effect(() => {
		// Taken once as it opens: a tick or an untick in the sheet must not redraw its rows.
		if (open) held = untrack(() => sel.list);
	});
	const facts = $derived(new Map(held.map((t) => [t.id, t])));
	const groups = $derived(
		showGroups(
			held.map((t) => t.id),
			facts,
			here
		)
	);

	function toggle(t: Tick) {
		if (sel.has(t.id)) sel.untick(t.id);
		else sel.toggle(t);
	}
</script>

<Sheet {open} {onclose} label="The selection">
	<div class="sheet-head">
		<div class="t">
			SELECTED · {count(sel.ticks.size)}{groups.length > 1
				? ` · ${sourcesWord(groups.length)}`
				: ''} · IN THE ORDER TICKED
		</div>
		<button type="button" class="done" onclick={onclose}>DONE</button>
	</div>
	{#each groups as g (g.source.id)}
		<div class="grph">
			<span><span class="ink">{g.source.name.toUpperCase()}</span> · {count(g.ticks.length)}</span>
			{#if here !== null}
				<span
					>{g.away > 0
						? `${count(g.away)} NOT IN THE LIST YOU ARE ON`
						: 'THE LIST YOU ARE ON'}</span
				>
			{/if}
		</div>
		<ul class="rows">
			{#each g.ticks as t (t.id)}
				{@const on = sel.has(t.id)}
				<li class="rw" class:on>
					<button
						type="button"
						class="tick"
						role="checkbox"
						aria-checked={on}
						aria-label="Keep {t.title}"
						onclick={() => toggle(t)}><span class="box" class:on>{on ? '✓' : ''}</span></button
					>
					<span class="cvs"><Cover src={t.cover || null} hue={t.hue} width={36} height={52} /></span
					>
					<span class="tx">
						<b>{t.title}</b>
						<span
							>{showMeta(t)}{#if !on}<span class="ink">
									· UNTICKED · A TAP PUTS IT BACK</span
								>{/if}</span
						>
					</span>
				</li>
			{/each}
		</ul>
	{/each}
</Sheet>

<style>
	/* Show-Tablet, transcribed: the mock's literals; colours are tokens. */
	.sheet-head {
		position: sticky;
		top: 0;
		z-index: 1;
		display: flex;
		align-items: stretch;
		height: 60px;
		border-bottom: var(--hairline);
		background: var(--surface-page);
	}
	.t {
		flex: 1;
		min-width: 0;
		display: flex;
		align-items: center;
		padding: 0 var(--pad);
		font: var(--type-control);
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}
	.done {
		padding: 0 var(--pad);
		border: 0;
		border-left: var(--hairline);
		border-radius: 0;
		background: transparent;
		color: var(--text-1);
		font: var(--type-control);
		cursor: pointer;
	}
	.grph {
		display: flex;
		justify-content: space-between;
		gap: 12px;
		padding: 12px 16px;
		border-bottom: var(--hairline);
		background: var(--surface-panel);
		font: var(--type-label);
		letter-spacing: 0.06em;
		color: var(--text-2);
	}
	.ink {
		color: var(--text-1);
	}
	.rows {
		list-style: none;
		margin: 0;
		padding: 0;
	}
	.rw {
		display: flex;
		align-items: center;
		min-height: 72px;
		border-bottom: var(--hairline);
	}
	.rw.on {
		background: var(--accent-select);
	}
	.tick {
		width: 60px;
		align-self: stretch;
		flex-shrink: 0;
		display: flex;
		align-items: center;
		justify-content: center;
		border: 0;
		border-radius: 0;
		background: transparent;
		cursor: pointer;
	}
	.box {
		width: 24px;
		height: 24px;
		box-sizing: border-box;
		border: 1.5px solid var(--line-2);
		display: flex;
		align-items: center;
		justify-content: center;
		font: 500 14px var(--font-mono);
		color: var(--on-accent);
	}
	.box.on {
		border-color: var(--accent);
		background: var(--accent);
	}
	.cvs {
		flex-shrink: 0;
		margin-right: 14px;
	}
	.tx {
		flex: 1;
		min-width: 0;
		display: flex;
		flex-direction: column;
		gap: 4px;
		padding: 10px 16px 10px 0;
	}
	.tx b {
		font: 500 15px/1.3 var(--font-sans);
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}
	.tx > span {
		font: var(--type-meta);
		color: var(--text-2);
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}
</style>

<script lang="ts">
	import { resolve } from '$app/paths';
	import { seriesHref } from '$lib/library/links';
	import type { GroupOther, OtherFormRow } from './other-forms.server';

	/**
	 * OTHER FORMS (doc/SERIES.md, "OTHER FORMS"): the same work's manga,
	 * novel or anime, from the relation cache. A quiet line, the extras line's idiom,
	 * that unfolds to one row each. It is `<li>`s, for the list it sits in.
	 *
	 * It never groups and never offers a Work on its own: GROUP AS A WORK is here
	 * only because the user opened the line, and nothing changes until the
	 * flow's own sheet is answered.
	 */
	let {
		rows,
		seriesId,
		ongroup
	}: { rows: OtherFormRow[]; seriesId: number; ongroup?: GroupOther } = $props();

	/** Unfolded for this series only: another series' list opens folded. */
	let openFor = $state<number | null>(null);
	const open = $derived(openFor === seriesId);
	const line = $derived(
		[
			`+ ${rows.length} OTHER FORM${rows.length === 1 ? '' : 'S'}`,
			...new Set(rows.map((r) => r.word))
		].join(' · ')
	);
	const findHref = (r: OtherFormRow) =>
		`${resolve('/downloads/search')}?q=${encodeURIComponent(r.title)}&kind=${r.kind}`;
</script>

<li class="head">
	<button
		type="button"
		class="fold"
		aria-expanded={open}
		onclick={() => (openFor = open ? null : seriesId)}
		><span class="words">{line}</span><span aria-hidden="true">{open ? '↑' : '↓'}</span></button
	>
</li>
{#if open}
	<!-- A source page asks the source as it loads: never on a hover (doc/BROWSE.md). -->
	{#each rows as r (r.anilistId)}
		<li class="form" data-form={r.anilistId} data-sveltekit-preload-data="tap">
			<div class="text">
				<span class="what">{r.facts.join(' · ')}</span>
				<span class="title">{r.title}</span>
			</div>
			<div class="cells">
				{#if r.seriesId !== null}
					<!-- eslint-disable svelte/no-navigation-without-resolve -- seriesHref resolves -->
					<a
						class="cell"
						href={r.work?.state === 'same'
							? seriesHref(r.seriesId, `work:${r.work.workId}`)
							: seriesHref(r.seriesId)}>{r.word} · IN LIBRARY →</a
					>
					<!-- eslint-enable svelte/no-navigation-without-resolve -->
					{#if r.work?.state === 'same'}
						<span class="cell quiet">IN THIS WORK · PART {r.work.part}</span>
					{:else if r.work?.state === 'group' && r.book}
						{@const book = r.book}
						<button type="button" class="cell" onclick={() => ongroup?.(book)}
							>GROUP AS A WORK</button
						>
					{/if}
				{:else}
					<!-- eslint-disable-next-line svelte/no-navigation-without-resolve -- built from resolve() -->
					<a class="cell" href={findHref(r)} aria-label="Find {r.word}: {r.title}">FIND</a>
				{/if}
			</div>
		</li>
	{/each}
{/if}

<style>
	.head,
	.form {
		border-bottom: var(--hairline);
		font: 500 12px var(--font-mono);
		letter-spacing: 0.06em;
		color: var(--text-2);
		list-style: none;
	}
	.fold {
		width: 100%;
		min-height: 44px;
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 12px;
		padding: 0 var(--pad);
		border: 0;
		border-radius: 0;
		background: transparent;
		color: inherit;
		font: inherit;
		letter-spacing: inherit;
		text-align: left;
		cursor: pointer;
	}
	.words {
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.form {
		display: flex;
		flex-wrap: wrap;
		align-items: stretch;
		justify-content: space-between;
	}
	.text {
		flex: 1 1 240px;
		min-width: 0;
		display: flex;
		flex-direction: column;
		justify-content: center;
		gap: 2px;
		padding: 8px var(--pad);
	}
	.title {
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.cells {
		display: flex;
		flex-wrap: wrap;
		align-items: stretch;
	}
	.cell {
		min-height: 44px;
		display: flex;
		align-items: center;
		padding: 0 var(--pad);
		border: 0;
		border-left: var(--hairline);
		border-radius: 0;
		background: transparent;
		color: inherit;
		font: inherit;
		letter-spacing: inherit;
		text-decoration: none;
		white-space: nowrap;
		cursor: pointer;
	}
	.cell.quiet {
		cursor: default;
	}
	.fold:active,
	a.cell:active,
	button.cell:active {
		background: var(--surface-inverse);
		color: var(--text-inverse);
	}
</style>

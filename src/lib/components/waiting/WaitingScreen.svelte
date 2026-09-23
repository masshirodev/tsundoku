<script lang="ts">
	import { resolve } from '$app/paths';
	import TopBar from '$lib/components/chrome/TopBar.svelte';
	import Wordmark from '$lib/components/chrome/Wordmark.svelte';
	import ShelfTabs from '$lib/components/controls/ShelfTabs.svelte';
	import type { Shelf } from '$lib/library/types';
	import type { Destination } from '$lib/waiting';
	import GridOutline from './GridOutline.svelte';

	/**
	 * The next screen in outline (Loading States 1c–1f, 1i, 1j), drawn by the
	 * layout in place of the old one: its header, what's already known in
	 * full, and flat grey cells where content will go. Nothing here counts
	 * anything the server hasn't said, so it can't give a hidden series away.
	 * The series screen has its own (SeriesOutline).
	 */
	let { to, shelves, active }: { to: Destination; shelves: Shelf[]; active: string } = $props();

	const person = $derived.by(() => {
		if (to.kind !== 'person') return null;
		const at = to.tag.indexOf(':');
		return at < 0
			? { namespace: 'tag', value: to.tag }
			: { namespace: to.tag.slice(0, at) || 'tag', value: to.tag.slice(at + 1) };
	});
	const history = ['54%', '38%', '62%', '46%', '58%', '41%', '66%', '50%', '35%', '60%'];
</script>

<div class="waiting" aria-busy="true">
	{#if to.kind === 'library'}
		<TopBar label="Library">
			{#snippet left()}<a class="brand" href={resolve('/')} aria-label="Library"><Wordmark /></a
				>{/snippet}
			{#snippet middle()}<span class="hint">/ search</span>{/snippet}
			{#snippet right()}<span class="cellish">SELECT</span>{/snippet}
		</TopBar>
		<div class="label"><span>02 — SHELVES</span><span>LOADING</span></div>
		<div class="tabs">
			<ShelfTabs
				{shelves}
				{active}
				href={(k) => (k === 'all' ? resolve('/') : `${resolve('/')}?shelf=${k}`)}
			/>
		</div>
		<GridOutline />
	{:else if person}
		<TopBar label="Library">
			{#snippet left()}<a class="cellish" href={resolve('/')} aria-label="Back to library">←</a
				>{/snippet}
			{#snippet middle()}
				<span class="tag-title"><span class="ns">{person.namespace}</span>{person.value}</span>
			{/snippet}
		</TopBar>
		<div class="label"><span>01 — {person.namespace.toUpperCase()}</span><span>LOADING</span></div>
		<h1 class="name">{person.value}</h1>
		<GridOutline />
	{:else if to.kind === 'history'}
		<TopBar label="History">
			{#snippet left()}
				<a class="cellish" href={resolve('/')}><span class="arrow">←</span>LIBRARY</a>
			{/snippet}
			{#snippet middle()}<span class="title">HISTORY</span>{/snippet}
		</TopBar>
		{#each history as w, i (i)}
			{#if i % 4 === 0}
				<div class="day" aria-hidden="true">
					<i style:width="{90 + (i % 3) * 15}px"></i><i style:width="60px"></i>
				</div>
			{/if}
			<div class="hrow" aria-hidden="true">
				<i class="cov"></i>
				<div class="lines"><i style:width={w}></i><i style:width="28%"></i></div>
				<i style:width="44px"></i>
			</div>
		{/each}
	{/if}
</div>

<style>
	.waiting {
		position: relative;
		display: flex;
		flex-direction: column;
		flex: 1;
		overflow: hidden;
		max-height: 100dvh;
	}
	.brand {
		padding: 0 var(--pad);
		color: inherit;
		text-decoration: none;
	}
	.hint,
	.title {
		padding: 0 18px;
		font: 500 16px var(--font-mono);
		color: var(--text-2);
	}
	.title {
		font-size: 17px;
		color: var(--text-1);
	}
	.cellish {
		gap: 14px;
		padding: 0 var(--pad);
		font: 500 14px var(--font-mono);
		letter-spacing: 0.04em;
		color: var(--text-1);
		text-decoration: none;
	}
	.arrow {
		font-size: 17px;
	}
	.tag-title {
		gap: 10px;
		padding: 0 18px;
		font: 500 16px var(--font-sans);
	}
	.ns {
		font: 500 13px var(--font-mono);
		color: var(--text-2);
		text-transform: uppercase;
	}
	.label {
		display: flex;
		justify-content: space-between;
		gap: 12px;
		padding: 24px var(--pad) 12px;
		font: var(--type-label);
		letter-spacing: var(--tracking-label);
		color: var(--text-2);
	}
	.tabs {
		padding: 0 var(--pad) 12px;
	}
	.name {
		margin: 0;
		padding: 0 var(--pad) 18px;
		font: 500 28px / 1.2 var(--font-sans);
	}
	.day {
		display: flex;
		align-items: center;
		justify-content: space-between;
		height: 52px;
		padding: 0 var(--pad);
		border-bottom: var(--hairline);
	}
	.hrow {
		display: flex;
		align-items: center;
		gap: 16px;
		padding: 12px var(--pad);
		border-bottom: var(--hairline);
	}
	.lines {
		flex: 1;
		display: flex;
		flex-direction: column;
		gap: 12px;
	}
	i {
		display: block;
		height: 10px;
		background: var(--line-1);
	}
	.cov {
		width: 44px;
		height: 62px;
		flex-shrink: 0;
		background: var(--surface-panel);
	}
	@media (min-width: 1024px) and (pointer: fine) {
		.tabs {
			display: none;
		}
	}
</style>

<script lang="ts">
	import { goto, invalidateAll } from '$app/navigation';
	import TopBar from '$lib/components/chrome/TopBar.svelte';
	import Cover from '$lib/components/content/Cover.svelte';
	import SearchField from '$lib/components/controls/SearchField.svelte';
	import TagChip from '$lib/components/controls/TagChip.svelte';
	import SeriesSheet from '../SeriesSheet.svelte';
	import { count, kindLabel } from '$lib/library/labels';
	import { resolve } from '$app/paths';
	import { page } from '$app/state';
	import { searchHref, shelfHref, tagHref } from '$lib/library/links';
	import { parseSearch, splitMatch } from '$lib/library/search';

	let { data } = $props();

	// Seeded once from the URL; after that the field owns the text and the URL
	// follows it, not the other way round.
	// svelte-ignore state_referenced_locally
	let q = $state(data.q);
	let sheetId = $state<number | null>(null);
	let input = $state<HTMLInputElement | null>(null);

	/**
	 * Results follow the typing, a beat behind it, by replacing the URL -- so
	 * the back button leaves search rather than stepping through every letter.
	 * Commands are never searched live; they run on Enter only.
	 */
	let timer: ReturnType<typeof setTimeout> | undefined;
	$effect(() => {
		const text = q;
		clearTimeout(timer);
		if (text === data.q) return;
		timer = setTimeout(() => {
			const parsed = parseSearch(text);
			const target = searchHref(parsed.type === 'query' ? parsed.text : '');
			// eslint-disable-next-line svelte/no-navigation-without-resolve -- searchHref() resolves
			void goto(target, { replaceState: true, keepFocus: true, noScroll: true });
		}, 180);
		return () => clearTimeout(timer);
	});

	const query = $derived(parseSearch(data.q).type === 'query' ? data.q.trim() : '');
</script>

<svelte:head><title>search · tsundoku</title></svelte:head>

<form method="POST" class="search">
	<TopBar strong label="Search bar">
		{#snippet left()}
			<a class="cell" href={resolve('/')} aria-label="Back to library">←</a>
		{/snippet}
		{#snippet middle()}
			<SearchField bind:value={q} bind:input autofocus />
		{/snippet}
		{#snippet right()}
			<button
				type="button"
				class="cell clear"
				onclick={() => {
					q = '';
					input?.focus();
				}}>CLEAR</button
			>
		{/snippet}
	</TopBar>
</form>

{#if data.result && query}
	{@const r = data.result}
	{#if r.tags.length > 0 || r.shelves.length > 0}
		<div class="label first">TAGS &amp; SHELVES</div>
		<div class="chips">
			{#each r.tags as t (t.key)}
				<TagChip
					namespace={t.namespace}
					value={t.value}
					count={count(t.count)}
					href={tagHref(t.key)}
				/>
			{/each}
			{#each r.shelves as s (s.key)}
				<TagChip
					namespace="shelf"
					value={s.name}
					count={count(s.count)}
					href={shelfHref(page.url, s.key)}
				/>
			{/each}
		</div>
	{/if}

	<div class="label">
		<div>TITLES</div>
		<div>{count(r.titleTotal)}</div>
	</div>
	<div class="hits">
		{#each r.titles as item (item.id)}
			{@const m = splitMatch(item.title, query)}
			<button type="button" class="hit" onclick={() => (sheetId = item.id)}>
				<Cover hue={item.hue} width={44} height={62} />
				<span class="text">
					<span class="title">{m.pre}<mark>{m.mid}</mark>{m.post}</span>
					<span class="why">{kindLabel(item.kind)} · {item.why}</span>
				</span>
			</button>
		{/each}
	</div>
{/if}

<SeriesSheet
	id={sheetId}
	shelves={data.shelves}
	onclose={() => (sheetId = null)}
	onchange={() => invalidateAll()}
/>

<style>
	.search {
		display: contents;
	}
	.cell {
		display: flex;
		align-items: center;
		padding: 0 var(--pad);
		color: var(--text-1);
		font: 500 16px var(--font-mono);
	}
	.clear {
		border: 0;
		border-radius: 0;
		background: transparent;
		color: var(--text-2);
		font: var(--type-control);
		cursor: pointer;
	}
	.cell:active {
		background: var(--surface-inverse);
		color: var(--text-inverse);
	}
	.label {
		display: flex;
		justify-content: space-between;
		padding: 20px var(--pad) 10px;
		font: var(--type-label);
		color: var(--text-2);
		letter-spacing: var(--tracking-label);
	}
	.label.first {
		padding-top: 18px;
	}
	.chips {
		display: flex;
		flex-wrap: wrap;
		gap: 8px;
		padding: 0 var(--pad) 8px;
	}
	.hits {
		display: flex;
		flex-direction: column;
		border-top: var(--hairline);
	}
	.hit {
		display: flex;
		align-items: center;
		gap: 16px;
		padding: 10px var(--pad);
		border: 0;
		border-bottom: var(--hairline);
		border-radius: 0;
		background: transparent;
		color: var(--text-1);
		text-align: left;
		cursor: pointer;
	}
	.hit:active {
		background: var(--surface-inverse);
		color: var(--text-inverse);
	}
	.text {
		flex: 1;
		min-width: 0;
		display: flex;
		flex-direction: column;
		gap: 5px;
	}
	.title {
		font: 500 16px var(--font-sans);
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}
	mark {
		background: var(--accent-highlight);
		color: inherit;
	}
	.why {
		font: var(--type-meta);
		color: var(--text-2);
	}
</style>

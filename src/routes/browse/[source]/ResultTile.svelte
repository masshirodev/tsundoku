<script lang="ts">
	import Cover from '$lib/components/content/Cover.svelte';
	import Badge from '$lib/components/content/Badge.svelte';
	import type { SearchHit } from '$lib/server/download-types';

	/**
	 * One of a source's results on its BROWSE page (Index-Browse, popular;
	 * Browse Calls, "A tile says what's already yours"). IN LIBRARY sits in
	 * FAV's corner, top right, since accent means yours, and a tap opens the
	 * series; SAME TITLE · FROM … is the meta line in ink 500, to head off a
	 * twin; otherwise the line is the source's status and author. HIDDEN, top
	 * left, only ever shows inside reveal: with it off such a result isn't sent.
	 */
	let { hit, href, hue }: { hit: SearchHit; href: string; hue: number } = $props();
	const m = $derived(hit.match);
</script>

<!-- eslint-disable-next-line svelte/no-navigation-without-resolve -- the page builds href from resolve() -->
<a class="tile" {href}>
	<Cover src={hit.cover || null} {hue}>
		{#if m.kind === 'in-library' && m.hidden}<Badge tone="reveal" corner="top-left">HIDDEN</Badge
			>{/if}
		{#if m.kind === 'in-library'}<Badge tone="accent" corner="top-right">IN LIBRARY</Badge>{/if}
	</Cover>
	<span class="t">{hit.title}</span>
	{#if m.kind === 'same-title'}
		<span class="m twin"
			>{m.source ? `SAME TITLE · FROM ${m.source}` : 'SAME TITLE IN LIBRARY'}</span
		>
	{:else}
		<span class="m">{hit.meta}</span>
	{/if}
</a>

<style>
	/* Index-Browse, popular, transcribed: the mock's literals; colours are tokens. */
	.tile {
		display: flex;
		flex-direction: column;
		gap: 7px;
		min-width: 0;
		padding: 10px;
		background: var(--surface-page);
		box-shadow:
			1px 0 0 var(--line-1),
			0 1px 0 var(--line-1),
			1px 1px 0 var(--line-1);
		color: var(--text-1);
		text-decoration: none;
	}
	.tile:active {
		background: var(--surface-inverse);
		color: var(--text-inverse);
	}
	.t,
	.m {
		display: -webkit-box;
		-webkit-box-orient: vertical;
		-webkit-line-clamp: 2;
		line-clamp: 2;
		overflow: hidden;
	}
	.t {
		height: 32px;
		font: 500 13px/1.25 var(--font-sans);
	}
	.m {
		height: 29px;
		font: 400 11px/1.3 var(--font-mono);
		letter-spacing: 0.02em;
		color: var(--text-2);
	}
	.tile:active .m {
		color: inherit;
	}
	.twin {
		font-weight: 500;
		color: var(--text-1);
	}
</style>

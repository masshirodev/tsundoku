<script lang="ts">
	import { resolve } from '$app/paths';
	import TopBar from '$lib/components/chrome/TopBar.svelte';
	import StartList from '$lib/components/start/StartList.svelte';
	import { countLine } from '$lib/library/start';
	import { trail } from '$lib/start-trail.svelte';

	/**
	 * GET STARTED, a page of its own (doc/ONBOARDING.md; the handoff's
	 * Start-Phone board): the empty library's list, reachable from HELP's first
	 * topic and the sidebar on any install, finished or not. Arriving here ends
	 * a trip (the way back has done its job).
	 */
	let { data } = $props();
	$effect(() => trail.end());
</script>

<svelte:head><title>Get started · tsundoku</title></svelte:head>

<div class="start-page">
	<TopBar label="Get started">
		{#snippet left()}
			<a class="back" href={resolve('/')}><span class="arrow">←</span><span>LIBRARY</span></a>
		{/snippet}
		{#snippet middle()}
			<div class="title">
				<h1>GET STARTED</h1>
				<span>HELP · 01</span>
			</div>
		{/snippet}
	</TopBar>

	{#if data.start}
		<section class="ob" aria-label="Get started">
			<div class="ob-head">
				<div class="k">00 — GET STARTED</div>
				<div class="k">{countLine(data.start)}</div>
			</div>
			<h2>
				{data.start.finished ? 'Everything is set up, or skipped.' : 'Four things to set up.'}
			</h2>
			<p class="lede">
				In any order. Each one ticks itself when it's done, and the sidebar keeps a way back here
				until they are.
			</p>
			<div class="list"><StartList view={data.start} libraryRoot={data.libraryRoot} /></div>
			<p class="kept">THE SAME LIST ON EVERY DEVICE · TICKS AND SKIPS ARE KEPT ON THE COMPUTER</p>
		</section>
	{/if}
</div>

<style>
	.back {
		display: flex;
		align-items: center;
		gap: 14px;
		padding: 0 var(--pad);
		border-right: var(--hairline);
		color: var(--text-1);
		font: 500 14px var(--font-mono);
		letter-spacing: 0.04em;
		text-decoration: none;
	}
	.arrow {
		font-size: 17px;
	}
	.title {
		display: flex;
		flex-direction: column;
		justify-content: center;
		gap: 3px;
		padding: 0 20px;
	}
	.title h1 {
		margin: 0;
		font: 500 14px var(--font-mono);
	}
	.title span {
		font: 400 12px var(--font-mono);
		color: var(--text-2);
	}
	/* The checklist's frame (ob.css .ob), as on the empty library. */
	.ob {
		display: flex;
		flex-direction: column;
		max-width: 980px;
		padding: 48px 64px 56px;
	}
	.ob-head {
		display: flex;
		justify-content: space-between;
		align-items: baseline;
		gap: 12px;
		margin-bottom: 18px;
	}
	.k {
		font: 500 12px/1.2 var(--font-mono);
		letter-spacing: 0.06em;
		color: var(--text-2);
	}
	h2 {
		margin: 0;
		font: 500 34px/1.2 var(--font-sans);
	}
	.lede {
		margin: 14px 0 0;
		max-width: 680px;
		font: 400 18px/1.5 var(--font-sans);
		color: var(--text-2);
		text-wrap: pretty;
	}
	.list {
		margin-top: 32px;
	}
	.kept {
		margin: 20px 0 0;
		font: 400 12px/1.5 var(--font-mono);
		color: var(--text-2);
	}
	@media (max-width: 599px) {
		.back span:last-child {
			display: none;
		}
		.ob {
			padding: 18px 0 24px;
		}
		.ob-head {
			padding: 0 16px;
			margin-bottom: 12px;
		}
		h2,
		.lede {
			display: none;
		}
		.list {
			margin-top: 0;
		}
		.kept {
			padding: 0 16px;
		}
	}
</style>

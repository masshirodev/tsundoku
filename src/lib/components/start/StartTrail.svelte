<script lang="ts">
	import { onMount } from 'svelte';
	import { invalidate } from '$app/navigation';
	import { page } from '$app/state';
	import { resolve } from '$app/paths';
	import { TRAIL, trailDone, type StartView } from '$lib/library/start';
	import { trail } from '$lib/start-trail.svelte';

	/**
	 * The way back to GET STARTED (doc/ONBOARDING.md, "The way back"; the
	 * Getting Started handoff, board 2): one band under the screen's top bar
	 * while a step's trip lasts. ← GET STARTED, the step and what ticks it, ✕;
	 * once it ticks, ✓ and BACK TO GET STARTED → in accent. A pairing ticks
	 * without the page reloading, so the list is asked again every few seconds
	 * while the step is still to do.
	 */
	let { start }: { start: StartView | null } = $props();

	onMount(() => trail.load());

	const id = $derived(trail.step);
	const here = $derived(!!id && !!TRAIL[id] && page.url.pathname.startsWith(TRAIL[id]!.path));
	const step = $derived(id && start ? start.steps.find((s) => s.id === id) : undefined);
	const done = $derived(step?.state === 'done');

	$effect(() => {
		if (!here || done) return;
		const t = setInterval(() => void invalidate('tsundoku:start'), 5000);
		return () => clearInterval(t);
	});
</script>

{#if here && step && start}
	<nav class="trail" aria-label="Get started">
		<a class="back" href={resolve('/start')} onclick={() => trail.end()}>← GET STARTED</a>
		{#if done}
			{@const d = trailDone(start, step.id)}
			<div class="mid">
				<div class="a"><span class="acc">✓</span>{d.a.slice(1)}</div>
				<div class="b">{d.b}</div>
			</div>
			<a class="ret" href={resolve('/start')} onclick={() => trail.end()}>BACK TO GET STARTED →</a>
		{:else}
			<div class="mid">
				<div class="a">{step.n} OF 04 · {step.title.toUpperCase()}</div>
				<div class="b">{TRAIL[step.id]!.doing}</div>
			</div>
		{/if}
		<button type="button" class="x" aria-label="Close the trail" onclick={() => trail.end()}
			>✕</button
		>
	</nav>
{/if}

<style>
	/* ob.css .trail, transcribed. */
	.trail {
		flex-shrink: 0;
		display: flex;
		align-items: stretch;
		height: 56px;
		border-bottom: var(--hairline);
		background: var(--surface-panel);
		font: 500 14px var(--font-mono);
	}
	.trail a,
	.trail button {
		display: flex;
		align-items: center;
		padding: 0 24px;
		border: 0;
		border-radius: 0;
		background: none;
		color: var(--text-1);
		font: inherit;
		text-decoration: none;
		white-space: nowrap;
		cursor: pointer;
	}
	.back {
		border-right: var(--hairline) !important;
	}
	.mid {
		flex: 1;
		min-width: 0;
		display: flex;
		flex-direction: column;
		justify-content: center;
		gap: 3px;
		padding: 0 20px;
	}
	.mid .a {
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}
	.mid .b {
		font: 400 12px var(--font-mono);
		color: var(--text-2);
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}
	.acc {
		color: var(--accent);
	}
	.trail .x {
		border-left: var(--hairline);
		color: var(--text-2);
	}
	.trail .ret {
		background: var(--accent);
		color: var(--on-accent);
	}
	/* The phone: the step's line goes; ← and the return cell carry it. */
	@media (max-width: 599px) {
		.trail a,
		.trail button {
			padding: 0 14px;
			font-size: 13px;
		}
		.mid {
			padding: 0 12px;
		}
	}
</style>

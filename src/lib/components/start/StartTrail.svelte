<script lang="ts">
	import type { Snippet } from 'svelte';
	import { onMount } from 'svelte';
	import { invalidate } from '$app/navigation';
	import { page } from '$app/state';
	import { resolve } from '$app/paths';
	import {
		partOf,
		readTrail,
		TRAIL,
		trailDone,
		trailHere,
		type StartView
	} from '$lib/library/start';
	import { trail } from '$lib/start-trail.svelte';
	import { m } from '$lib/paraglide/messages';
	import { upper } from '$lib/i18n/format';

	/**
	 * The way back to GET STARTED (doc/ONBOARDING.md, "The way back"): one band
	 * under the screen's top bar while a step's trip lasts. ← GET STARTED, the
	 * step and what ticks it, ✕; once it ticks, ✓ and BACK TO GET STARTED → in
	 * accent. A FIRST READ trip's band moves on as each of its steps ticks,
	 * and says what's next. A pairing or a download ticks without the page
	 * reloading, so the list is asked again every few seconds while the trip
	 * waits on a step.
	 */
	let {
		start,
		prefix = '',
		extra
	}: {
		start: StartView | null;
		/** What the screen says ahead of the next step (the series just added: its chapters). */
		prefix?: string;
		/** A cell of the screen's own before ✕ (UNDO, on the series just added). */
		extra?: Snippet;
	} = $props();

	onMount(() => trail.load());

	const id = $derived(trail.step);
	const here = $derived(!!id && trailHere(id, page.url.pathname));
	const read = $derived(!!id && partOf(id) === 'read');
	const step = $derived(id && start ? start.steps.find((s) => s.id === id) : undefined);
	const done = $derived(step?.state === 'done');
	const rt = $derived(read && start ? readTrail(start, trail.before, prefix) : null);
	const waiting = $derived(read ? rt?.mode !== 'done' : !done);

	$effect(() => {
		if (!here || !waiting) return;
		const t = setInterval(() => void invalidate('tsundoku:start'), 5000);
		return () => clearInterval(t);
	});
</script>

{#if here && step && start}
	<nav class="trail" class:read={!!rt} aria-label={m.start_page_label()}>
		<a class="back" href={resolve('/start')} onclick={() => trail.end()}
			>← <span class="long">{m.name_get_started()}</span></a
		>
		{#if rt}
			<div class="mid">
				{#if rt.mode === 'arrive'}
					<div class="a">{rt.a}</div>
				{:else}
					<div class="a"><span class="acc">✓</span>{rt.a.slice(1)}</div>
				{/if}
				<div class="b">{rt.b}</div>
				<div class="short">{rt.short}</div>
			</div>
			{#if extra}{@render extra()}{/if}
			{#if rt.mode === 'done'}
				<a class="plain long" href={resolve('/downloads')}>{m.start_done_link_download()}</a>
				<a class="ret" href={resolve('/start')} onclick={() => trail.end()}
					><span class="long">{m.start_trail_back()}</span><span class="short"
						>{m.start_trail_back_short()}</span
					></a
				>
			{/if}
		{:else if done}
			{@const d = trailDone(start, step.id)}
			<div class="mid">
				<div class="a"><span class="acc">✓</span>{d.a.slice(1)}</div>
				<div class="b">{d.b}</div>
			</div>
			<a class="ret" href={resolve('/start')} onclick={() => trail.end()}
				><span class="long">{m.start_trail_back()}</span><span class="short"
					>{m.start_trail_back_short()}</span
				></a
			>
		{:else}
			<div class="mid">
				<div class="a">
					{m.start_trail_step({
						n: step.n,
						total: String(start.steps.length).padStart(2, '0'),
						title: upper(step.title)
					})}
				</div>
				<div class="b">{TRAIL[step.id]!.doing()}</div>
			</div>
		{/if}
		<button type="button" class="x" aria-label={m.start_trail_close()} onclick={() => trail.end()}
			>✕</button
		>
	</nav>
{/if}

<style>
	/* ob.css and fr.css .trail, transcribed. */
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
	.trail button,
	.trail :global(form > button) {
		display: flex;
		align-items: center;
		height: 100%;
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
	.trail :global(form) {
		display: flex;
		border-left: var(--hairline);
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
	.trail .plain {
		border-left: var(--hairline);
	}
	.trail .x {
		border-left: var(--hairline);
		color: var(--text-2);
	}
	.trail .ret {
		background: var(--accent);
		color: var(--on-accent);
	}
	.short {
		display: none;
	}
	/* The phone (FirstRead "Not drawn"): ← · 06 OF 07 · ✕, and BACK → in accent once a step ticks. */
	@media (max-width: 599px) {
		.trail a,
		.trail button {
			padding: 0 14px;
			font-size: 13px;
		}
		.mid {
			padding: 0 12px;
		}
		.read .long,
		.read .mid .a,
		.read .mid .b,
		.ret .long {
			display: none;
		}
		.read .short,
		.ret .short {
			display: inline;
		}
		.read .mid .short {
			display: block;
		}
	}
</style>

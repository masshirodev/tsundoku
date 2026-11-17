<script lang="ts">
	import { onDestroy, onMount } from 'svelte';
	import { invalidateAll } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { SiteCheck } from '$lib/site-check.svelte';
	import { challengeScale } from '$lib/library/player';
	import { offline } from '$lib/offline.svelte';

	/**
	 * A chapter read online, before its pages arrive or when its source won't
	 * send them (doc/READING-ONLINE.md, "Manga online"; Online Board 3a·2): the
	 * player's interstitial page (Player Waiting), with the chapter where the
	 * episode was, so every reader waits in the same words. Asking; a source
	 * passing its browser check, on the 20–45 s scale; a source that asked to
	 * slow down, with a real countdown and no TRY AGAIN to hammer it with; a
	 * source that didn't answer; offline, ONLINE ONLY.
	 */
	let {
		title,
		entryName,
		seriesId,
		source,
		failed = null
	}: {
		title: string;
		entryName: string;
		seriesId: number;
		source: { id: string; name: string } | null;
		failed?: { failure: string; message: string } | null;
	} = $props();

	/** How long a rate limit is waited out before asking again by itself. */
	const SLOW_S = 30;
	const check = new SiteCheck();
	let waited = $state(0);
	let countdown = $state(SLOW_S);
	let timer: ReturnType<typeof setInterval> | undefined;
	onMount(() => {
		if (source && !failed) check.start(source.id);
		const started = Date.now();
		timer = setInterval(() => {
			waited = Math.round((Date.now() - started) / 1000);
			if (failed?.failure === 'rate-limited' && --countdown <= 0) void again();
		}, 1000);
	});
	onDestroy(() => {
		check.stop();
		clearInterval(timer);
	});
	async function again() {
		countdown = SLOW_S;
		await invalidateAll();
	}

	const name = $derived((source?.name ?? 'THE SOURCE').toUpperCase());
	const phase = $derived(
		!offline.online
			? 'offline'
			: failed
				? failed.failure === 'rate-limited'
					? 'slow'
					: failed.failure === 'down'
						? 'engine'
						: 'failed'
				: check.since !== null
					? waited > 45
						? 'still'
						: 'challenge'
					: 'asking'
	);
	const scale = $derived(challengeScale(waited));
	const seriesHref = $derived(resolve('/series/[id]', { id: String(seriesId) }));
</script>

<div class="inter" role="status">
	<div class="imid">
		<div class="kick">
			<div>{entryName.toUpperCase()}</div>
			<div>{phase === 'challenge' || phase === 'still' ? `${name} · FIRST CALL` : name}</div>
		</div>
		<div class="rule" class:ink={phase === 'asking' || phase === 'challenge'}></div>
		<div class="what">
			<div class="label">
				{phase === 'offline'
					? '○ ONLINE ONLY'
					: phase === 'asking'
						? 'ASKING THE SOURCE'
						: phase === 'challenge'
							? 'THE SOURCE IS CHECKING THE WORKSTATION'
							: phase === 'still'
								? 'STILL ASKING'
								: phase === 'slow'
									? 'THE SOURCE ASKED TO SLOW DOWN'
									: phase === 'engine'
										? 'SOURCES NOT ANSWERING'
										: 'THE SOURCE DID NOT ANSWER'}
			</div>
			<div
				class="big"
				class:faint={phase === 'offline' || phase === 'failed' || phase === 'engine'}
			>
				{title} · {entryName}
			</div>
			<div class="tag">
				{phase === 'asking'
					? `${waited} S · USUALLY A FEW SECONDS`
					: phase === 'challenge' || phase === 'still'
						? 'THE FIRST CALL OF THE DAY TAKES 20–45 S · THEN SECONDS'
						: phase === 'slow'
							? `ASKING AGAIN IN ${countdown} S`
							: phase === 'engine'
								? 'THE WORKSTATION ANSWERED · THE PART THAT TALKS TO SOURCES DID NOT'
								: phase === 'failed'
									? `${name} · ${(failed?.message ?? '').toUpperCase().slice(0, 120)}`
									: ''}
			</div>
		</div>
		{#if phase === 'challenge' || phase === 'still'}
			<div class="scale" aria-hidden="true">
				<div class="base"></div>
				<div
					class="range"
					style:left="{scale.from * 100}%"
					style:width="{(scale.to - scale.from) * 100}%"
				></div>
				<div class="done" style:width="{scale.at * 100}%"></div>
				<div class="mark" style:left="{scale.at * 100}%"></div>
				<div class="now" style:left="{scale.at * 100}%">{waited} S</div>
				<div class="n0">0</div>
				<div class="n20" style:left="{scale.from * 100}%">20</div>
				<div class="n45" style:left="{scale.to * 100}%">45</div>
				<div class="n60">60 S</div>
			</div>
			<div class="prose">
				{source?.name} checks a new visitor before it answers. Once it has, its chapters open in seconds
				until the workstation restarts.
			</div>
		{:else if phase === 'slow'}
			<div class="prose">
				{source?.name} limits how often it's asked. The chapter opens by itself once the wait is over.
			</div>
		{:else if phase === 'failed' || phase === 'engine'}
			<div class="prose">
				Downloaded chapters still open. Online chapters wait until the source answers again.
			</div>
		{:else if phase === 'offline'}
			<div class="prose">
				{entryName} is read from the source, and nothing of it is kept on this device. It opens once the
				workstation is reachable.
			</div>
		{/if}
	</div>
	<div class="acts">
		<!-- eslint-disable-next-line svelte/no-navigation-without-resolve -- resolved above -->
		<a href={seriesHref}>← SERIES</a>
		{#if phase === 'failed' || phase === 'engine' || phase === 'still'}
			<button type="button" class="acc" onclick={again}>TRY AGAIN</button>
		{/if}
	</div>
</div>

<style>
	/* The player's interstitial (VideoPlayer.svelte, Player Waiting), as a page of its own. */
	.inter {
		position: fixed;
		inset: 0;
		background: var(--surface-page);
		color: var(--text-1);
		display: flex;
		flex-direction: column;
	}
	.imid {
		flex: 1;
		display: flex;
		flex-direction: column;
		justify-content: center;
		gap: 36px;
		padding: 0 96px;
	}
	@media (max-width: 799px) {
		.imid {
			padding: 0 24px;
		}
	}
	.kick {
		display: flex;
		justify-content: space-between;
		gap: 12px;
		font: 500 13px var(--font-mono);
		letter-spacing: 0.06em;
		color: var(--text-2);
	}
	.rule {
		height: 1px;
		background: var(--line-1);
	}
	.rule.ink {
		height: 2px;
		background: var(--text-1);
	}
	.what {
		display: flex;
		flex-direction: column;
		gap: 12px;
		max-width: 820px;
	}
	.label {
		font: 500 13px var(--font-mono);
		letter-spacing: 0.06em;
		color: var(--text-2);
	}
	.big {
		font: 500 44px/1.15 var(--font-sans);
	}
	@media (max-width: 599px) {
		.big {
			font-size: 30px;
		}
	}
	.big.faint {
		opacity: 0.4;
	}
	.tag {
		font: 400 15px var(--font-mono);
		color: var(--text-2);
	}
	.prose {
		max-width: 620px;
		font: 400 17px/1.5 var(--font-sans);
		color: var(--text-prose);
	}
	.scale {
		position: relative;
		height: 64px;
		max-width: 820px;
		font: 400 12px var(--font-mono);
		color: var(--text-2);
	}
	.scale > div {
		position: absolute;
	}
	.scale .base {
		left: 0;
		right: 0;
		top: 30px;
		height: 2px;
		background: var(--line-1);
	}
	.scale .range {
		top: 28px;
		height: 6px;
		background: var(--line-2);
	}
	.scale .done {
		left: 0;
		top: 30px;
		height: 2px;
		background: var(--text-1);
	}
	.scale .mark {
		top: 20px;
		width: 2px;
		height: 22px;
		margin-left: -1px;
		background: var(--text-1);
	}
	.scale .now {
		top: 0;
		transform: translateX(-50%);
		font: 500 13px var(--font-mono);
		color: var(--text-1);
	}
	.scale .n0,
	.scale .n20,
	.scale .n45,
	.scale .n60 {
		top: 44px;
	}
	.scale .n0 {
		left: 0;
	}
	.scale .n20,
	.scale .n45 {
		transform: translateX(-50%);
	}
	.scale .n60 {
		right: 0;
	}
	.acts {
		display: flex;
		height: 64px;
		border-top: var(--hairline);
	}
	.acts a,
	.acts button {
		display: flex;
		align-items: center;
		padding: 0 var(--pad, 24px);
		border: 0;
		border-right: var(--hairline);
		background: none;
		color: var(--text-1);
		font: 500 14px var(--font-mono);
		letter-spacing: 0.04em;
		text-decoration: none;
		cursor: pointer;
	}
	.acts .acc {
		background: var(--accent);
		color: var(--on-accent);
	}
</style>

<script lang="ts">
	import {
		clock,
		downloadLine,
		noteLines,
		offerMeta,
		percent,
		type UpdateView
	} from '$lib/updates';
	import { updateRun } from '$lib/update-run.svelte';

	/**
	 * A new version, told on entry (doc/UPDATES.md, "Told on entry"; the Getting
	 * Started handoff, board 4; card c208): on a friend's computer, over the
	 * library, once a day at most per version. UPDATE runs here, in the modal:
	 * downloading (HIDE puts it away, the library's band keeps count),
	 * installing, the tab waiting while tsundoku is away, and a failure that
	 * changed nothing. On Linux and the zip it's DOWNLOAD and three steps.
	 */
	let { offer, onlater }: { offer: UpdateView; onlater: () => void } = $props();

	const v = $derived(offer.available!);
	const run = $derived(updateRun.running ? (updateRun.view?.install ?? null) : null);
	const phase = $derived(
		updateRun.failed
			? 'failed'
			: !updateRun.running
				? 'offer'
				: updateRun.awaySince !== null
					? 'away'
					: run?.phase === 'installing'
						? 'installing'
						: 'downloading'
	);
	const downloading = $derived(
		run?.phase === 'downloading' ? run : { bytes: 0, total: v.size ?? 0 }
	);

	let now = $state(Date.now());
	$effect(() => {
		if (phase !== 'away') return;
		const t = setInterval(() => (now = Date.now()), 1000);
		return () => clearInterval(t);
	});

	/** Escape and the scrim: LATER on an offer or a failure, HIDE while downloading. */
	function dismiss() {
		if (phase === 'offer') onlater();
		else if (phase === 'failed') {
			updateRun.reset();
			onlater();
		} else if (phase === 'downloading') updateRun.hidden = true;
	}
	function keydown(e: KeyboardEvent) {
		if (e.key === 'Escape') dismiss();
	}
</script>

<svelte:window onkeydown={keydown} />

<button type="button" class="scrim appear" aria-label="Later" onclick={dismiss}></button>
<div
	class="modal appear"
	role="dialog"
	aria-modal="true"
	aria-label={phase === 'offer'
		? 'A new version'
		: phase === 'failed'
			? 'Update failed'
			: 'Updating'}
>
	{#if phase === 'offer'}
		<div class="m-head">
			<span class="k">00 — NEW VERSION</span><span class="k">RUNNING {offer.current}</span>
		</div>
		<div class="m-body">
			<h2 class="m-ver">tsundoku <span class="m">{v.version}</span></h2>
			<div class="m-meta">{offerMeta(offer)}</div>
			{#if noteLines(v.notes).length}
				{#if offer.how === 'install'}<div class="k notes-k">WHAT'S NEW</div>{/if}
				<div class="notes">
					{#each noteLines(v.notes) as line, i (i)}<div>{line}</div>{/each}
				</div>
			{/if}
			{#if offer.how === 'install'}
				<p class="m-say">
					UPDATE downloads it and installs it. tsundoku closes for about a minute and opens again by
					itself, and this page comes back on its own. Your library stays as it is.
				</p>
			{:else}
				<div class="steps-n">
					<div><span>1</span><span>DOWNLOAD the new version.</span></div>
					<div><span>2</span><span>Unpack it beside this one.</span></div>
					<div>
						<span>3</span><span
							>Start tsundoku from the new folder, then delete the old one. Your library stays where
							it is.</span
						>
					</div>
				</div>
			{/if}
		</div>
		<div class="m-foot">
			<button type="button" onclick={onlater}>LATER</button>
			{#if offer.how === 'install'}
				<button type="button" class="up" onclick={() => void updateRun.start(v.version)}
					>UPDATE →</button
				>
			{:else if offer.download}
				<!-- eslint-disable-next-line svelte/no-navigation-without-resolve -- the release host, not a route -->
				<a class="up" href={offer.download}>DOWNLOAD ↓</a>
			{/if}
		</div>
		<div class="m-note">
			LATER · ASKED AGAIN TOMORROW · IT WAITS IN SETTINGS › 08 — DEVICES › UPDATES
		</div>
	{:else if phase === 'failed'}
		<div class="m-head">
			<span class="k">00 — UPDATE FAILED</span><span class="k">{v.version}</span>
		</div>
		<div class="m-body">
			<h2 class="m-ver">Nothing was changed</h2>
			<div class="m-meta why">{(updateRun.failed ?? '').toUpperCase()}</div>
			<p class="m-say">
				tsundoku {offer.current} is still running, as it was. TRY AGAIN downloads it afresh.
			</p>
		</div>
		<div class="m-foot">
			<button type="button" onclick={dismiss}>LATER</button>
			<button type="button" class="up" onclick={() => void updateRun.start(v.version)}
				>TRY AGAIN</button
			>
		</div>
	{:else}
		<div class="m-head">
			<span class="k">00 — UPDATING</span><span class="k">{offer.current} → {v.version}</span>
		</div>
		<div class="m-body">
			{#if phase === 'downloading'}
				<h2 class="m-ver">Downloading</h2>
				<div class="prog"><i style:width="{percent(downloading) * 100}%"></i></div>
				<div class="m-meta">{downloadLine(downloading)}</div>
				<p class="m-say">
					Keep reading if you like: HIDE closes this, and the library's band keeps count.
				</p>
			{:else if phase === 'installing'}
				<h2 class="m-ver">Installing</h2>
				<div class="prog"><i style:width="100%"></i></div>
				<div class="m-meta">MATCHES THE RELEASE KEY · TSUNDOKU CLOSES NOW</div>
				<p class="m-say">
					It opens again by itself in about a minute, and this page reloads onto it.
				</p>
			{:else}
				<h2 class="m-ver">Opening again</h2>
				<div class="prog wait"></div>
				<div class="m-meta">
					WAITING FOR {v.version} · {clock(now - (updateRun.awaySince ?? now))}
				</div>
				<p class="m-say">
					Nothing to do here. If it takes more than a few minutes, start tsundoku from the Start
					menu: your library is untouched.
				</p>
			{/if}
		</div>
		{#if phase === 'downloading'}
			<div class="m-foot one">
				<button type="button" onclick={() => (updateRun.hidden = true)}>HIDE</button>
			</div>
		{/if}
	{/if}
</div>

<style>
	/* The Getting Started handoff's board 4 (ob.css .modal, .m-*), transcribed;
	   colours are tokens. Centred, as a modal isn't anchored to anything. */
	.scrim {
		position: fixed;
		inset: 0;
		z-index: 30;
		border: 0;
		padding: 0;
		background: var(--scrim);
		cursor: default;
	}
	.modal {
		position: fixed;
		z-index: 31;
		top: 50%;
		left: 50%;
		transform: translate(-50%, -50%);
		width: min(600px, calc(100vw - 32px));
		max-height: calc(100dvh - 32px);
		overflow-y: auto;
		display: flex;
		flex-direction: column;
		background: var(--surface-page);
		border-top: var(--rule-strong);
		color: var(--text-1);
	}
	.k {
		font: 500 12px/1.2 var(--font-mono);
		letter-spacing: 0.06em;
		color: var(--text-2);
	}
	.m-head {
		display: flex;
		justify-content: space-between;
		align-items: center;
		gap: 12px;
		height: 52px;
		flex-shrink: 0;
		padding: 0 24px;
		border-bottom: var(--hairline);
	}
	.m-body {
		display: flex;
		flex-direction: column;
		gap: 18px;
		padding: 24px 24px 22px;
	}
	.m-ver {
		margin: 0;
		font: 500 26px/1.2 var(--font-sans);
	}
	.m-ver .m {
		font: 500 26px/1.2 var(--font-mono);
		letter-spacing: 0.01em;
	}
	.m-meta {
		font: 400 13px var(--font-mono);
		color: var(--text-2);
	}
	.m-meta.why {
		color: var(--text-1);
	}
	.notes-k {
		margin-top: 6px;
	}
	.notes {
		display: flex;
		flex-direction: column;
		border-top: var(--hairline);
	}
	.notes > div {
		padding: 11px 0;
		border-bottom: var(--hairline);
		font: 400 16px/1.45 var(--font-sans);
		color: var(--text-prose);
	}
	.m-say {
		margin: 0;
		font: 400 14px/1.5 var(--font-sans);
		color: var(--text-2);
		text-wrap: pretty;
	}
	.steps-n {
		display: flex;
		flex-direction: column;
		border-top: var(--hairline);
	}
	.steps-n > div {
		display: flex;
		gap: 16px;
		padding: 12px 0;
		border-bottom: var(--hairline);
		font: 400 15px/1.45 var(--font-sans);
		color: var(--text-prose);
	}
	.steps-n > div span:first-child {
		font: 500 13px var(--font-mono);
		color: var(--text-2);
		padding-top: 2px;
	}
	.m-foot {
		display: grid;
		grid-template-columns: repeat(2, minmax(0, 1fr));
		border-top: var(--hairline);
	}
	.m-foot.one {
		grid-template-columns: minmax(0, 1fr);
	}
	.m-foot > * {
		display: flex;
		align-items: center;
		justify-content: center;
		height: 60px;
		border: 0;
		border-radius: 0;
		background: transparent;
		color: var(--text-1);
		font: 500 15px var(--font-mono);
		letter-spacing: 0.04em;
		text-decoration: none;
		cursor: pointer;
	}
	.m-foot > * + * {
		border-left: var(--hairline);
	}
	.m-foot .up {
		background: var(--accent);
		color: var(--on-accent);
	}
	.m-note {
		padding: 12px 24px 14px;
		border-top: var(--hairline);
		font: 400 12px/1.45 var(--font-mono);
		color: var(--text-2);
	}
	.prog {
		height: 4px;
		background: var(--line-2);
	}
	.prog i {
		display: block;
		height: 4px;
		background: var(--accent);
	}
	.prog.wait {
		background: repeating-linear-gradient(90deg, var(--line-2) 0 10px, transparent 10px 16px);
	}
</style>

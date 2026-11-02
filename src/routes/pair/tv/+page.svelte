<script lang="ts">
	import { resolve } from '$app/paths';
	import Wordmark from '$lib/components/chrome/Wordmark.svelte';

	let { data } = $props();

	/** What a remote types; the hidden entry owns the keys and the cells draw it. */
	let typed = $state('');
	/** The next cell to fill: the one the design rings. */
	const next = $derived(Math.min(typed.length, 5));
	const digits = $derived(Array.from({ length: 6 }, (_, i) => typed[i] ?? ''));
	const live = $derived(data.step === 'code' && data.state === 'live');

	let form: HTMLFormElement | undefined = $state();

	/** PAIR → presses itself when the sixth arrives (TV-Pair.dc.html, 9C). */
	function oninput(e: Event & { currentTarget: HTMLInputElement }) {
		const v = e.currentTarget.value.replace(/\D/g, '').slice(0, 6);
		e.currentTarget.value = v;
		typed = v;
		if (v.length === 6 && live) form?.requestSubmit();
	}

	/**
	 * What the last try said, or what the code's state says on arrival: the
	 * design draws no band for these, so they keep the panel's own idiom.
	 */
	const band = $derived(
		data.step !== 'code'
			? null
			: data.result === 'wrong'
				? { h: 'NOT THAT CODE', m: `${data.left} ${data.left === 1 ? 'TRY' : 'TRIES'} LEFT` }
				: data.result === 'short'
					? { h: 'SIX DIGITS', m: 'TYPE ALL SIX' }
					: data.result === 'expired' || data.state === 'expired'
						? { h: 'THIS CODE EXPIRED', m: 'MAKE A NEW ONE ON THE COMPUTER' }
						: data.result === 'used' || data.state === 'used'
							? { h: 'THIS CODE IS USED', m: 'ONE TV, ONCE · MAKE A NEW ONE ON THE COMPUTER' }
							: data.result === 'burned' || data.state === 'burned'
								? { h: 'NO TRIES LEFT', m: 'MAKE A NEW CODE ON THE COMPUTER' }
								: null
	);

	/** Back to the app's own address page: the one screen before this one. */
	const back = () => history.back();
</script>

<svelte:head><title>PAIR THIS TV · tsundoku</title></svelte:head>

<!--
	Pairing a TV with six digits typed on a remote (c236; TV-Pair.dc.html 9C,
	9E). The measurements are the handoff's: a 960x540 frame, the bar 28 from
	the top, the label at 108, six 72x88 cells at 148, two threes with a 12px
	gap, the meta line at 252 and the buttons at 304. This screen is only ever
	a TV's, so it is laid out at the TV's size rather than a responsive stack.
-->
{#if data.step === 'paired'}
	<main class="pair paired">
		<div class="bar">
			<Wordmark size={20} />
			<div class="grow"></div>
			<div class="step">PAIRED</div>
		</div>
		<div class="safe head">
			<div class="lab acc">✓ PAIRED WITH {data.name} · {data.host}</div>
			<h1>The library is on this TV</h1>
			<p>
				Everything streams from the computer, so it has to be awake. Nothing is kept on the TV. If
				the computer gets a new address, pair again.
			</p>
		</div>
		<div class="safe go-row">
			<a class="btn pri" href={resolve('/')}>OPEN THE LIBRARY →</a>
			<div class="meta">ON THE COMPUTER IT'S A DEVICE: TV · OVER WI-FI, WITH SIGN OUT</div>
		</div>
	</main>
{:else}
	<main class="pair">
		<div class="bar">
			<Wordmark size={20} />
			<div class="grow"></div>
			<div class="step">PAIR THIS TV · 2 OF 2</div>
		</div>

		{#if band}
			<div class="band" role="status">
				<div class="bh">{band.h}</div>
				<div class="bm">{band.m}</div>
			</div>
		{/if}

		<div class="safe sl">
			<div>02 — THE SIX DIGITS ON THE COMPUTER</div>
			<div class="meta">{data.host} ✓ ANSWERED</div>
		</div>

		<form class="safe digits" method="POST" bind:this={form}>
			<!-- The keys land here: a remote's number keys and ←, as the design says. -->
			<input
				class="entry"
				name="code"
				type="text"
				inputmode="numeric"
				autocomplete="off"
				maxlength="6"
				aria-label="The six digits on the computer"
				value={typed}
				{oninput}
				data-focus-start
			/>
			<div class="cells" aria-hidden="true">
				{#each digits as d, i (i)}
					{#if i === 3}<div class="gap"></div>{/if}
					<div class="cell" class:ring={live && i === next}>
						{d}{#if live && i === next}<span class="caret"></span>{/if}
					</div>
				{/each}
			</div>
			<div class="hint meta">
				GOOD FOR 10 MINUTES · ONE TV, ONCE · A NEW CODE ON THE COMPUTER IF IT RAN OUT
			</div>
			<div class="actions">
				<button class="btn pri" type="submit" disabled={!live}>PAIR →</button>
				<button class="btn" type="button" onclick={back}>← THE ADDRESS</button>
			</div>
		</form>
	</main>
{/if}

<style>
	.pair {
		position: relative;
		min-height: 100dvh;
		box-sizing: border-box;
		background: var(--surface-page);
		color: var(--text-1);
		font-family: var(--font-sans);
		overflow: hidden;
	}
	.bar {
		position: absolute;
		left: 0;
		right: 0;
		top: 28px;
		height: 56px;
		display: flex;
		align-items: center;
		gap: 12px;
		padding: 0 48px;
		border-bottom: 1px solid var(--line-1);
		font: 500 17px/1.2 var(--font-mono);
		letter-spacing: 0.02em;
	}
	.grow {
		flex: 1;
	}
	.step {
		color: var(--text-2);
		font: 400 15px/1.3 var(--font-mono);
	}
	.safe {
		position: absolute;
		left: 48px;
		right: 48px;
	}
	.sl {
		top: 108px;
		display: flex;
		justify-content: space-between;
		align-items: flex-end;
		height: 36px;
		padding-bottom: 9px;
		font: 500 15px/1.2 var(--font-mono);
		letter-spacing: 0.06em;
		color: var(--text-2);
	}
	.meta {
		font: 400 15px/1.3 var(--font-mono);
		color: var(--text-2);
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}
	.lab {
		font: 500 15px/1.2 var(--font-mono);
		letter-spacing: 0.06em;
	}
	.acc {
		color: var(--accent);
	}
	.digits {
		top: 148px;
	}
	.entry {
		position: absolute;
		left: 0;
		top: 0;
		width: 1px;
		height: 1px;
		opacity: 0;
		border: 0;
		padding: 0;
	}
	.cells {
		display: flex;
		gap: 12px;
	}
	.cell {
		width: 72px;
		height: 88px;
		box-sizing: border-box;
		display: flex;
		align-items: center;
		justify-content: center;
		border: 1px solid var(--line-2);
		font: 500 40px/1 var(--font-mono);
	}
	.cell.ring {
		border-color: var(--text-1);
		box-shadow: var(--focus-ring);
	}
	.gap {
		width: 12px;
	}
	.caret {
		display: inline-block;
		width: 2px;
		height: 40px;
		background: var(--accent);
	}
	.hint {
		margin-top: 16px;
		white-space: normal;
		line-height: 1.5;
	}
	.actions {
		display: flex;
		gap: 16px;
		margin-top: 36px;
	}
	.band {
		position: absolute;
		left: 0;
		right: 0;
		top: 84px;
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 16px;
		height: 56px;
		padding: 0 48px;
		box-sizing: border-box;
		background: var(--surface-panel);
		border-bottom: 1px solid var(--line-1);
		font: 500 17px/1.2 var(--font-mono);
	}
	.bm {
		font: 400 15px/1.3 var(--font-mono);
		color: var(--text-2);
	}
	.btn {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		gap: 10px;
		height: 56px;
		padding: 0 24px;
		box-sizing: border-box;
		border: 1px solid var(--line-2);
		background: none;
		color: var(--text-1);
		font: 500 17px/1.2 var(--font-mono);
		letter-spacing: 0.02em;
		white-space: nowrap;
		text-decoration: none;
		cursor: pointer;
	}
	.btn.pri {
		background: var(--accent);
		color: var(--on-accent);
		border-color: var(--accent);
	}
	.btn:disabled {
		opacity: 0.4;
	}
	/* 9E */
	.head {
		top: 112px;
		display: flex;
		flex-direction: column;
		gap: 12px;
		max-width: 700px;
	}
	h1 {
		margin: 0;
		font: 500 36px/1.15 var(--font-sans);
	}
	p {
		margin: 0;
		font: 400 19px/1.5 var(--font-sans);
		color: var(--text-prose);
	}
	.go-row {
		top: 330px;
		display: flex;
		gap: 16px;
		align-items: center;
	}
</style>

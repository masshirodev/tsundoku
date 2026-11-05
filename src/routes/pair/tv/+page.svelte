<script lang="ts">
	import { resolve } from '$app/paths';
	import { onMount } from 'svelte';
	import Wordmark from '$lib/components/chrome/Wordmark.svelte';

	let { data } = $props();

	/*
	 * The TV's page, or the phone app's 9C and 9E on a phone or a tablet (c521;
	 * PhoneApp-*.dc.html). The TV's words and frame are exactly what they were;
	 * the phone and tablet say themselves where the TV did and reflow at 600 px.
	 */
	const device = $derived(data.device ?? 'tv');
	const mobile = $derived(device !== 'tv');
	const word = $derived(device === 'tv' ? 'TV' : device);
	const upper = $derived(word.toUpperCase());
	const pairStep = $derived(device === 'phone' ? 'PAIR' : `PAIR THIS ${upper}`);

	let entry: HTMLInputElement | undefined = $state();
	// On a touchscreen the six cells take focus at once, so the number keyboard
	// opens with the screen (9C); a TV's focus layer starts there by itself.
	onMount(() => {
		if (mobile && data.step === 'code') entry?.focus();
	});

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
	function bandFor(d: typeof data): { h: string; m: string } | null {
		if (d.step !== 'code') return null;
		if (d.result === 'wrong') {
			const left = `${d.left} ${d.left === 1 ? 'TRY' : 'TRIES'} LEFT`;
			// A phone's band has room for the rule under the count (9C · NOT THAT CODE).
			return { h: 'NOT THAT CODE', m: mobile ? `${left} · FIVE WRONG TRIES BURN IT` : left };
		}
		if (d.result === 'short') return { h: 'SIX DIGITS', m: 'TYPE ALL SIX' };
		// Burned is for good, whatever the last try said (the load's `shown`).
		if (d.state === 'burned' || d.result === 'burned')
			return { h: 'NO TRIES LEFT', m: 'MAKE A NEW CODE ON THE COMPUTER' };
		// The typed code had run out, or been used, and the load made a new one
		// (c246): it is on the computer's screen already, nothing to walk for.
		if ((d.result === 'expired' || d.result === 'used') && d.state === 'live')
			return {
				h: d.result === 'expired' ? 'THAT CODE EXPIRED' : 'THAT CODE IS USED',
				m: 'THE NEW ONE IS ON THE COMPUTER'
			};
		if (d.result === 'expired' || d.state === 'expired')
			return { h: 'THIS CODE EXPIRED', m: 'MAKE A NEW ONE ON THE COMPUTER' };
		if (d.result === 'used' || d.state === 'used')
			return { h: 'THIS CODE IS USED', m: 'ONE DEVICE, ONCE · MAKE A NEW ONE ON THE COMPUTER' };
		return null;
	}
	const band = $derived(bandFor(data));

	/** Back to the app's own address page: the one screen before this one. */
	const back = () => history.back();
</script>

<svelte:head><title>PAIR THIS {upper} · tsundoku</title></svelte:head>

<!--
	Pairing a TV with six digits typed on a remote (c236; TV-Pair.dc.html 9C,
	9E). The measurements are the handoff's: a 960x540 frame, the bar 28 from
	the top, the label at 108, six 72x88 cells at 148, two threes with a 12px
	gap, the meta line at 252 and the buttons at 304. On a TV it is laid out at
	the TV's size rather than a responsive stack.

	The phone app opens it too (c521; PhoneApp-Phone.dc.html and
	PhoneApp-Tablet.dc.html): `.mobile` reflows it into the phone's column
	under 600 px, PAIR → pinned at the bottom on the keyboard's top edge, and
	into the tablet's flow above it.
-->
{#if data.step === 'paired'}
	<!-- The TV app reads the server's name from data-paired-name (c545;
	     MainActivity's PAIRED_JS), so the label's words can change freely. -->
	<main class="pair paired" class:mobile data-paired-name={data.name}>
		<div class="bar">
			<Wordmark size={20} />
			<div class="grow"></div>
			<div class="step">PAIRED</div>
		</div>
		<div class="safe head">
			<div class="lab acc">✓ PAIRED WITH {data.name} · {data.host}</div>
			<h1>The library is on this {word}</h1>
			<p>
				Everything streams from the computer, so it has to be awake. Nothing is kept on the {word}.
				If the computer gets a new address, pair again.
			</p>
		</div>
		<div class="safe go-row">
			<a class="btn pri" href={resolve('/')}>OPEN THE LIBRARY →</a>
			<div class="meta">
				{mobile
					? `ON THE COMPUTER IT'S A DEVICE: ${upper} · IN THE APP · WITH SIGN OUT`
					: "ON THE COMPUTER IT'S A DEVICE: TV · WITH SIGN OUT"}
			</div>
		</div>
	</main>
{:else}
	<!-- The band is 56 high at 84 (tv.css's .band), so it ends at 140 and the
	     label at 108 would sit inside it: with-band moves the column down. -->
	<main class="pair" class:mobile class:with-band={!!band}>
		<div class="bar">
			<Wordmark size={20} />
			<div class="grow"></div>
			<div class="step">{pairStep} · 2 OF 2</div>
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
				bind:this={entry}
				data-focus-start
			/>
			<!-- A tap on the cells is a tap on the field they draw (a phone). -->
			<div class="cells" aria-hidden="true" onclick={() => entry?.focus()}>
				{#each digits as d, i (i)}
					{#if i === 3}<div class="gap"></div>{/if}
					<div class="cell" class:ring={live && i === next}>
						{d}{#if live && i === next}<span class="caret"></span>{/if}
					</div>
				{/each}
			</div>
			<div class="hint meta">
				GOOD FOR 10 MINUTES · ONE DEVICE, ONCE · A NEW CODE ON THE COMPUTER IF IT RAN OUT
			</div>
			<div class="actions">
				<!-- A TV presses PAIR → with a short code and is told so; on a phone it
				     stays dim until the sixth digit, which presses it (9C). -->
				<button class="btn pri" type="submit" disabled={!live || (mobile && typed.length < 6)}
					>PAIR →</button
				>
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
	/*
	 * A band draws over the column instead of in it, so with one the section
	 * label and the digits move down by the band's own height: the label at
	 * 164 is the rhythm 9D keeps below its band (TV-Pair.dc.html), and the
	 * cards at 204 still clear the frame's bottom (2026-11-02, c246: the band
	 * used to cover "02 — …" and the ✓ ANSWERED line).
	 */
	.pair.with-band .sl {
		top: 164px;
	}
	.pair.with-band .digits {
		top: 204px;
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

	/* ---- c521 · the phone app's 9C and 9E ------------------------------------
	   PhoneApp-Phone.dc.html and PhoneApp-Tablet.dc.html, their literal values.
	   The camera band and the gesture strip are the app's padding, so the page
	   starts at the header. Every height is a min-height: Android's font size
	   scales the text through the WebView (Form.kt), up to 130%. */
	.pair.mobile {
		display: flex;
		flex-direction: column;
		height: 100dvh;
		min-height: 0;
		touch-action: manipulation;
	}
	.pair.mobile .bar {
		position: static;
		flex-shrink: 0;
		height: auto;
		align-items: stretch;
		gap: 0;
		padding: 0;
	}
	.pair.mobile .bar > :global(.wordmark) {
		flex: 1;
	}
	.pair.mobile :global(.wordmark .latin) {
		/* Wordmark sets its size inline; the design's header is 18. */
		font-size: 18px !important;
	}
	.pair.mobile .grow {
		display: none;
	}
	.pair.mobile .step {
		display: flex;
		align-items: center;
		border-left: 1px solid var(--line-1);
		font: 500 12px/1.3 var(--font-mono);
		letter-spacing: 0.04em;
		white-space: nowrap;
	}
	.pair.mobile .safe {
		position: static;
		left: auto;
		right: auto;
	}
	.pair.mobile .band {
		position: static;
		flex-shrink: 0;
		height: auto;
	}
	.pair.mobile .meta {
		white-space: normal;
		overflow: visible;
	}
	.pair.mobile .sl {
		height: auto;
		align-items: flex-start;
	}
	.pair.mobile .digits {
		flex: 1;
		min-height: 0;
		overflow-y: auto;
		display: flex;
		flex-direction: column;
	}
	.pair.mobile .cell {
		box-sizing: border-box;
	}
	.pair.mobile .cell.ring {
		border-color: var(--accent);
		box-shadow: none;
	}
	.pair.mobile .hint {
		margin-top: 0;
	}
	.pair.mobile .btn {
		height: auto;
		min-height: 56px;
		font: 500 15px/1.2 var(--font-mono);
		letter-spacing: 0.04em;
		text-align: center;
	}

	/* The phone: one column, PAIR → under the thumb. */
	@media (max-width: 599.98px) {
		.pair.mobile .bar {
			min-height: 56px;
		}
		.pair.mobile .bar > :global(.wordmark) {
			padding: 0 16px;
		}
		.pair.mobile :global(.wordmark .jp) {
			display: none;
		}
		.pair.mobile .step {
			padding: 0 16px;
		}
		.pair.mobile .band {
			flex-direction: column;
			align-items: flex-start;
			justify-content: flex-start;
			gap: 4px;
			padding: 12px 16px;
			font: 500 14px/1.35 var(--font-mono);
		}
		.pair.mobile .bm,
		.pair.mobile .meta {
			font: 400 12px/1.5 var(--font-mono);
		}
		.pair.mobile .sl {
			flex-direction: column;
			justify-content: flex-start;
			gap: 6px;
			padding: 20px 16px 0;
			font: 500 12px/1.3 var(--font-mono);
		}
		.pair.mobile .digits {
			gap: 12px;
			padding: 12px 16px;
		}
		.pair.mobile .cells {
			gap: 6px;
		}
		.pair.mobile .cell {
			flex: 1;
			width: auto;
			min-width: 44px;
			height: 64px;
			font: 500 28px/1 var(--font-mono);
		}
		.pair.mobile .gap {
			flex-shrink: 0;
			width: 10px;
		}
		.pair.mobile .caret {
			height: 28px;
		}
		.pair.mobile .actions {
			display: contents;
		}
		.pair.mobile .btn {
			display: flex;
			width: 100%;
			padding: 8px 20px;
			white-space: normal;
		}
		.pair.mobile .btn:not(.pri) {
			min-height: 48px;
			font-size: 13px;
		}
		.pair.mobile .digits .btn.pri {
			order: 1;
			margin-top: auto;
		}
		/* 9E */
		.pair.mobile .head {
			gap: 10px;
			max-width: none;
			padding: 24px 16px 0;
		}
		.pair.mobile .lab {
			font: 500 12px/1.3 var(--font-mono);
		}
		.pair.mobile h1 {
			font: 500 26px/1.2 var(--font-sans);
		}
		.pair.mobile p {
			font: 400 15px/1.5 var(--font-sans);
		}
		.pair.mobile .go-row {
			margin-top: auto;
			flex-direction: column-reverse;
			align-items: stretch;
			gap: 8px;
			padding: 12px 16px;
		}
		.pair.mobile .go-row .meta {
			padding-bottom: 4px;
		}
	}

	/* The tablet: the TV's arrangement, in flow at a 24 px margin. */
	@media (min-width: 600px) {
		.pair.mobile {
			--pad-top: 36px;
		}
		.pair.mobile .bar {
			min-height: 64px;
		}
		.pair.mobile .bar > :global(.wordmark) {
			align-items: baseline;
			padding: 22px 24px 0;
		}
		.pair.mobile :global(.wordmark .jp) {
			font: 400 13px var(--font-sans);
		}
		.pair.mobile .step {
			padding: 0 24px;
			font-size: 13px;
		}
		.pair.mobile .band {
			flex-wrap: wrap;
			gap: 6px 24px;
			min-height: 64px;
			padding: 10px 24px;
			font: 500 16px/1.3 var(--font-mono);
		}
		.pair.mobile .bm,
		.pair.mobile .meta {
			font: 400 13px/1.5 var(--font-mono);
		}
		.pair.mobile .sl {
			flex-wrap: wrap;
			gap: 6px 24px;
			max-width: 864px;
			padding: var(--pad-top) 24px 0;
			font: 500 13px/1.3 var(--font-mono);
		}
		.pair.mobile .digits {
			gap: 16px;
			max-width: 864px;
			padding: 16px 24px 24px;
		}
		.pair.mobile .cells {
			gap: 12px;
		}
		.pair.mobile .cell {
			width: 68px;
			height: 84px;
			font: 500 38px/1 var(--font-mono);
		}
		.pair.mobile .caret {
			height: 38px;
		}
		.pair.mobile .actions {
			flex-wrap: wrap;
			margin-top: 8px;
		}
		.pair.mobile .btn {
			padding: 8px 24px;
		}
		/* 9E */
		.pair.mobile .head {
			max-width: 700px;
			padding: var(--pad-top) 24px 0;
		}
		.pair.mobile .lab {
			font: 500 13px/1.3 var(--font-mono);
		}
		.pair.mobile h1 {
			font: 500 32px/1.2 var(--font-sans);
		}
		.pair.mobile p {
			font: 400 17px/1.5 var(--font-sans);
		}
		.pair.mobile .go-row {
			flex-wrap: wrap;
			gap: 12px 20px;
			padding: 24px 24px 0;
		}
	}
	@media (min-width: 600px) and (orientation: portrait) {
		.pair.mobile {
			--pad-top: 48px;
		}
	}
</style>

<script lang="ts">
	import { resolve } from '$app/paths';

	let { data } = $props();

	/** The handoff's list (Wifi-Phone.dc.html, 3A): what plain http over Wi-Fi can't do. */
	const MISSING = [
		'Installing as an app',
		'Offline chapters',
		'Keeping the screen awake',
		'Fingerprint checks'
	];
</script>

<svelte:head><title>signed in · tsundoku</title></svelte:head>

<!--
	A phone, just paired over Wi-Fi (doc/WIFI.md, 3A; Wifi-Phone.dc.html,
	"welcome"). A screen, not a flash: it's the one time the phone is told what
	Wi-Fi leaves out, and how to come back. Measurements transcribed from the
	handoff; tests/wifi.e2e.ts pins them.
-->
<main class="welcome">
	<header class="bar">
		<div class="name">TSUNDOKU</div>
		<div class="via">OVER WI-FI</div>
	</header>
	<div class="body">
		<div class="head">
			<div class="k">01 — SIGNED IN</div>
			<h1>This phone is signed in</h1>
			<div class="addr">{data.address} · THE COMPUTER'S WI-FI ADDRESS</div>
		</div>
		<section class="block" aria-label="Works here">
			<div class="k pad">WORKS HERE</div>
			<p>Reading, browsing, search, downloads, and every setting.</p>
		</section>
		<section class="block" aria-label="Not over Wi-Fi">
			<div class="k pad tight">NOT OVER WI-FI</div>
			{#each MISSING as m (m)}
				<div class="missing"><span>{m}</span></div>
			{/each}
			<div class="note">
				TAILSCALE GIVES THE PHONE ALL OF IT · THE README ON THE COMPUTER SAYS HOW
			</div>
		</section>
		<section class="block last" aria-label="To come back">
			<div class="k pad">TO COME BACK</div>
			<p class="prose">
				In the browser's menu, Add to Home screen. It's a shortcut to this address: if the address
				changes, scan a new code.
			</p>
		</section>
		<div class="fill"></div>
		<div class="go-wrap">
			<a class="go" href={resolve('/')}>OPEN THE LIBRARY →</a>
		</div>
	</div>
</main>

<style>
	.welcome {
		flex: 1;
		display: flex;
		flex-direction: column;
		min-height: 100dvh;
		background: var(--surface-page);
		color: var(--text-1);
		font-family: var(--font-sans);
	}
	.bar {
		flex-shrink: 0;
		display: flex;
		align-items: stretch;
		height: 60px;
		border-bottom: 1px solid var(--line-1);
	}
	.name {
		flex: 1;
		display: flex;
		align-items: center;
		padding: 0 16px;
		font: 500 18px var(--font-mono);
		letter-spacing: 0.02em;
	}
	.via {
		display: flex;
		align-items: center;
		padding: 0 16px;
		border-left: 1px solid var(--line-1);
		font: 500 12px var(--font-mono);
		letter-spacing: 0.04em;
		color: var(--text-2);
	}
	.body {
		flex: 1;
		min-height: 0;
		display: flex;
		flex-direction: column;
	}
	.head {
		display: flex;
		flex-direction: column;
		gap: 8px;
		padding: 24px 16px 18px;
	}
	.k {
		font: 500 12px var(--font-mono);
		letter-spacing: 0.06em;
		color: var(--text-2);
	}
	h1 {
		margin: 0;
		font: 500 24px/1.25 var(--font-sans);
	}
	.addr {
		font: 400 12px var(--font-mono);
		color: var(--text-2);
	}
	.block {
		display: flex;
		flex-direction: column;
		border-top: 1px solid var(--line-1);
	}
	.block.last {
		border-bottom: 1px solid var(--line-1);
	}
	.pad {
		padding: 14px 16px 4px;
	}
	.pad.tight {
		padding-bottom: 6px;
	}
	p {
		margin: 0;
		padding: 0 16px 14px;
		font: 400 15px/1.5 var(--font-sans);
	}
	.prose {
		color: var(--text-prose);
		text-wrap: pretty;
	}
	.missing {
		display: flex;
		align-items: center;
		min-height: 36px;
		padding: 0 16px;
		font: 400 15px var(--font-sans);
		opacity: 0.6;
	}
	.note {
		padding: 8px 16px 14px;
		font: 400 12px/1.45 var(--font-mono);
		color: var(--text-2);
	}
	.fill {
		flex: 1;
	}
	.go-wrap {
		padding: 16px;
	}
	.go {
		display: flex;
		align-items: center;
		justify-content: center;
		height: 56px;
		background: var(--accent);
		color: var(--on-accent);
		text-decoration: none;
		font: 500 15px var(--font-mono);
		letter-spacing: 0.04em;
	}
</style>

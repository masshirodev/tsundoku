<script lang="ts">
	import { resolve } from '$app/paths';
	import { m } from '$lib/paraglide/messages';

	let { data } = $props();

	/** What plain http over Wi-Fi can't do. */
	const MISSING = [
		m.welcome_missing_app,
		m.welcome_missing_offline,
		m.welcome_missing_awake,
		m.welcome_missing_fingerprint
	];
</script>

<svelte:head><title>{m.welcome_title()} · tsundoku</title></svelte:head>

<!--
	A phone, just paired over Wi-Fi (doc/WIFI.md). A screen, not a flash: it's
	the one time the phone is told what Wi-Fi leaves out, and how to come back.
	Measurements transcribed from the design; tests/wifi.e2e.ts pins them.
-->
<main class="welcome">
	<header class="bar">
		<div class="name">TSUNDOKU</div>
		<div class="via">{m.welcome_via()}</div>
	</header>
	<div class="body">
		<div class="head">
			<div class="k">{m.welcome_kicker()}</div>
			<h1>{m.welcome_heading()}</h1>
			<div class="addr">{data.address} · {m.welcome_address()}</div>
		</div>
		<section class="block" aria-label={m.welcome_works_aria()}>
			<div class="k pad">{m.welcome_works()}</div>
			<p>{m.welcome_works_body()}</p>
		</section>
		<section class="block" aria-label={m.welcome_missing_aria()}>
			<div class="k pad tight">{m.welcome_missing()}</div>
			{#each MISSING as missing (missing)}
				<div class="missing"><span>{missing()}</span></div>
			{/each}
			<div class="note">
				{m.welcome_note()}
			</div>
		</section>
		<section class="block last" aria-label={m.welcome_back_aria()}>
			<div class="k pad">{m.welcome_back()}</div>
			<p class="prose">
				{m.welcome_back_body()}
			</p>
		</section>
		<div class="fill"></div>
		<div class="go-wrap">
			<a class="go" href={resolve('/')}>{m.welcome_open()}</a>
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

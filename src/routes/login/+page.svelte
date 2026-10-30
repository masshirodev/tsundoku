<script lang="ts">
	import { enhance } from '$app/forms';
	import Wordmark from '$lib/components/chrome/Wordmark.svelte';
	import Button from '$lib/components/controls/Button.svelte';

	let { data, form } = $props();
</script>

<svelte:head><title>sign in · tsundoku</title></svelte:head>

<!--
	Not drawn in the handoff. Built from the empty state's parts -- numbered
	label, hairline field, primary button -- so it belongs to the same system.
-->
{#if data.pair}
	<!-- A code that no longer works (doc/WIFI.md, 3B, 3C; Wifi-Phone.dc.html): what happened, and what to do on the computer. -->
	<div class="band" role="status">
		<div class="ba">
			{data.pair === 'used' ? 'THIS CODE WAS ALREADY USED' : 'THIS CODE EXPIRED'}
		</div>
		<div class="bb">
			{data.pair === 'used' ? 'A CODE SIGNS IN ONE PHONE, ONCE' : 'CODES LAST 10 MINUTES'} · ON THE COMPUTER:
			SETTINGS › 08 — DEVICES › NEW CODE, THEN SCAN IT
		</div>
	</div>
{/if}
<main class="login">
	<Wordmark />
	{#if !data.configured}
		<div class="label">00 — NOT CONFIGURED</div>
		<p>
			TSUNDOKU_TOKEN is not set. The server refuses to authenticate without one: the workstation has
			no firewall running, so an unauthenticated library would be reachable from the whole LAN.
		</p>
	{:else if !data.field}
		<!-- Over Wi-Fi with no password set: nothing to type, only a code (doc/WIFI.md). -->
		<div class="label">ONLY A CODE SIGNS IN HERE</div>
		<p>
			tsundoku on the computer has no password, so a phone signs in by scanning its code: on the
			computer, SETTINGS › 08 — DEVICES › WI-FI.
		</p>
	{:else}
		<form method="POST" use:enhance>
			<label class="label" for="token"
				>{data.lan
					? `OR SIGN IN WITH THE ${data.password ? 'PASSWORD' : 'TOKEN'}`
					: data.password
						? 'PASSWORD'
						: 'TOKEN'}</label
			>
			<input id="token" name="token" type="password" autocomplete="current-password" />
			{#if form?.message}<div class="error">{form.message.toUpperCase()}</div>{/if}
			<Button variant="primary" size="lg" type="submit">UNLOCK</Button>
		</form>
		{#if data.password}
			<!-- The way back in is at the PC (doc/SIGN-IN.md, "Forgot it"). -->
			<p class="hint">
				Forgot it? On the computer tsundoku runs on, open the Start menu and choose RESET TSUNDOKU
				PASSWORD (on Linux, run <code>./tsundoku --reset-password</code>). Then choose a new one
				here.
			</p>
		{/if}
	{/if}
</main>

<style>
	.login {
		flex: 1;
		display: flex;
		flex-direction: column;
		justify-content: center;
		gap: 28px;
		padding: 0 var(--pad);
		max-width: 420px;
		margin: 0 auto;
		width: 100%;
	}
	form {
		display: flex;
		flex-direction: column;
		align-items: flex-start;
		gap: 12px;
	}
	.label {
		font: 500 12px var(--font-mono);
		color: var(--text-2);
		letter-spacing: var(--tracking-label);
	}
	input {
		width: 100%;
		font: 500 15px var(--font-mono);
		padding: 14px 16px;
		border: 1px solid var(--line-2);
		border-radius: 0;
		background: transparent;
		color: var(--text-1);
		caret-color: var(--accent);
		outline: none;
	}
	input:focus {
		border-color: var(--text-1);
	}
	p {
		margin: 0;
		font: var(--type-body);
		color: var(--text-2);
	}
	.band {
		flex-shrink: 0;
		display: flex;
		flex-direction: column;
		gap: 6px;
		padding: 16px;
		border-bottom: 1px solid var(--text-1);
		background: var(--surface-panel);
	}
	.ba {
		font: 500 14px var(--font-mono);
	}
	.bb {
		font: 400 12px/1.5 var(--font-mono);
		color: var(--text-2);
	}
	.hint {
		font: var(--type-meta);
	}
	code {
		font-family: var(--font-mono);
	}
	.error {
		font: var(--type-meta);
		color: var(--text-1);
	}
</style>

<script lang="ts">
	import { enhance } from '$app/forms';
	import Wordmark from '$lib/components/chrome/Wordmark.svelte';
	import Button from '$lib/components/controls/Button.svelte';
	import { upper } from '$lib/i18n/format';
	import { m } from '$lib/paraglide/messages';

	let { data, form } = $props();
</script>

<svelte:head><title>{m.login_title()} · tsundoku</title></svelte:head>

<!--
	Not drawn in the handoff. Built from the empty state's parts -- numbered
	label, hairline field, primary button -- so it belongs to the same system.
-->
{#if data.pair}
	<!-- A code that no longer works (doc/WIFI.md, 3B, 3C; Wifi-Phone.dc.html): what happened, and what to do on the computer. -->
	<div class="band" role="status">
		<div class="ba">
			{data.pair === 'used' ? m.login_pair_used() : m.login_pair_expired()}
		</div>
		<div class="bb">
			{data.pair === 'used' ? m.login_pair_once() : m.login_pair_minutes()} · {m.login_pair_remedy({
				settings: m.name_settings(),
				devices: m.name_devices_section()
			})}
		</div>
	</div>
{/if}
<main class="login">
	<Wordmark />
	{#if !data.configured}
		<div class="label">{m.login_unconfigured_label()}</div>
		<p>{m.login_unconfigured_body()}</p>
	{:else if !data.field}
		<!-- Over Wi-Fi with no password set: nothing to type, only a code (doc/WIFI.md). -->
		<div class="label">{m.login_code_only_label()}</div>
		<p>
			{m.login_code_only_body({ settings: m.name_settings(), devices: m.name_devices_section() })}
		</p>
	{:else}
		<form method="POST" use:enhance>
			<label class="label" for="token"
				>{data.lan
					? data.password
						? m.login_label_or_password()
						: m.login_label_or_token()
					: data.password
						? m.login_label_password()
						: m.login_label_token()}</label
			>
			<input id="token" name="token" type="password" autocomplete="current-password" />
			{#if form?.message}<div class="error">{upper(form.message)}</div>{/if}
			<Button variant="primary" size="lg" type="submit">{m.login_unlock()}</Button>
		</form>
		{#if data.password}
			<!-- The way back in is at the PC (doc/SIGN-IN.md, "Forgot it"). -->
			<p class="hint">
				{m.login_forgot_a()} <code>./tsundoku --reset-password</code>{m.login_forgot_b()}
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

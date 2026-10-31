<script lang="ts">
	import { enhance } from '$app/forms';
	import Wordmark from '$lib/components/chrome/Wordmark.svelte';
	import Button from '$lib/components/controls/Button.svelte';
	import { upper } from '$lib/i18n/format';
	import { m } from '$lib/paraglide/messages';

	let { data, form } = $props();
	/** NO PASSWORD asks first (the owner, 2026-10-30). */
	let asking = $state(false);
</script>

<svelte:head><title>{m.setup_title()} · tsundoku</title></svelte:head>

<!--
	A friend's first open (doc/SIGN-IN.md). The sign-in page's parts -- numbered
	label, hairline fields, primary button -- with one more field and a second
	way out, so it belongs to the same system without a drawing of its own.
-->
<main class="setup">
	<Wordmark />
	{#if !asking}
		<form method="POST" action="?/password" use:enhance>
			<div class="label">{m.setup_label()}</div>
			<p>{m.setup_intro()}</p>
			<label class="label" for="password">{m.setup_password_label()}</label>
			<!-- svelte-ignore a11y_autofocus -->
			<input
				id="password"
				name="password"
				type="password"
				autocomplete="new-password"
				minlength={data.min}
				required
				autofocus
			/>
			<label class="label" for="again">{m.setup_again_label()}</label>
			<input id="again" name="again" type="password" autocomplete="new-password" required />
			{#if form?.message}<div class="error">{upper(form.message)}</div>{/if}
			<div class="actions">
				<Button variant="primary" size="lg" type="submit">{m.setup_set_password()}</Button>
				<Button variant="ghost" size="lg" onclick={() => (asking = true)}
					>{m.setup_no_password()}</Button
				>
			</div>
		</form>
	{:else}
		<form method="POST" action="?/none" use:enhance>
			<div class="label">{m.setup_none_label()}</div>
			<p>{m.setup_none_body()}</p>
			<p>{m.setup_none_later({ settings: m.name_settings() })}</p>
			<input type="hidden" name="sure" value="yes" />
			{#if form?.message}<div class="error">{upper(form.message)}</div>{/if}
			<div class="actions">
				<Button variant="primary" size="lg" type="submit">{m.setup_none_yes()}</Button>
				<Button variant="ghost" size="lg" onclick={() => (asking = false)}>{m.setup_back()}</Button>
			</div>
		</form>
	{/if}
</main>

<style>
	.setup {
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
		margin: 0 0 8px;
		font: var(--type-body);
		color: var(--text-2);
	}
	.error {
		font: var(--type-meta);
		color: var(--text-1);
	}
	.actions {
		display: flex;
		flex-wrap: wrap;
		gap: 12px;
		margin-top: 8px;
	}
</style>

<script lang="ts">
	import { resolve } from '$app/paths';
	import { enhance } from '$app/forms';
	import { onMount } from 'svelte';
	import TopBar from '$lib/components/chrome/TopBar.svelte';
	import Band from '$lib/components/chrome/Band.svelte';
	import Switch from '$lib/components/controls/Switch.svelte';
	import { CELLS_MAX } from '$lib/library/source-settings';

	/**
	 * A source's settings (Index-Browse, settings; Browse Calls, "Settings, per
	 * type"). A switch and a check box sit on the row's right; a list of up to
	 * four is cells, a longer one its value and CHANGE ▾; a multi-select is ✓
	 * cells; text is a field with SAVE. Each row is its own form, so every
	 * change works without script; with it, a multi-select saves as it's
	 * ticked. Saved by tsundoku and sent with every call: the source's page
	 * asks again on return.
	 */
	let { data, form } = $props();
	let js = $state(false);
	onMount(() => (js = true));

	const s = $derived(data.source);
	const title = $derived(`${s.name.toUpperCase()} · ${s.lang.toUpperCase()}`);
	const back = $derived(resolve('/browse/[source]', { source: s.id }));
	const here = $derived(resolve('/browse/[source]/settings', { source: s.id }));
	const refusal = $derived(
		form && 'message' in form && typeof form.message === 'string' ? form.message.toUpperCase() : ''
	);
	// Each form keeps its place: the page isn't scrolled to the top by a save.
	const keep =
		() =>
		async ({ update }: { update: (o?: { reset?: boolean }) => Promise<void> }) =>
			update({ reset: false });
</script>

<svelte:head><title>settings · {s.name.toLowerCase()} · tsundoku</title></svelte:head>

<!-- eslint-disable svelte/no-navigation-without-resolve -- every href below is built from resolve() -->

<div class="screen">
	<TopBar sticky label="Settings for {s.name}">
		{#snippet middle()}
			<a class="cell back" href={back} aria-label="Back to {s.name}">←</a>
			<span class="cell title"
				><span class="name">SETTINGS</span><span class="sub">{title}</span></span
			>
		{/snippet}
	</TopBar>

	{#if data.down === 'down'}
		<Band
			title="○ NOT ANSWERING · THE EXTENSION ENGINE ON THE WORKSTATION"
			detail="THESE ARE THE VALUES TSUNDOKU KEPT · A CHANGE IS SENT WITH THE NEXT CALL"
		/>
	{:else if data.down}
		<Band
			title="{s.name.toUpperCase()} DID NOT ANSWER"
			detail="THESE ARE THE VALUES TSUNDOKU KEPT"
		/>
	{/if}
	{#if refusal}<Band title={refusal} detail="NOTHING CHANGED" />{/if}

	<div class="label">
		<span>01 — {title}</span>
		<span
			>{data.settings.length} SETTING{data.settings.length === 1 ? '' : 'S'} · KEPT BY TSUNDOKU</span
		>
	</div>

	{#if data.settings.length === 0}
		<div class="none">
			{s.failed ? `FAILED TO LOAD · ${s.failed.toUpperCase()}` : 'THIS SOURCE HAS NO SETTINGS'}
		</div>
	{/if}

	{#each data.settings as x (x.key)}
		{@const long = x.type === 'list' && x.entries.length > CELLS_MAX}
		<form
			method="POST"
			action="{here}?/set"
			class="set"
			class:column={x.type === 'multi' ||
				x.type === 'text' ||
				(x.type === 'list' && data.change === x.key)}
			class:saved={form && 'saved' in form && form.saved === x.key}
			use:enhance={keep}
		>
			<input type="hidden" name="key" value={x.key} />
			<div class="what">
				<div class="t">{x.title}</div>
				{#if x.summary}<div class="s">{x.summary}</div>{/if}
			</div>
			{#if x.type === 'switch'}
				<div class="ctl"><Switch checked={x.on} name="value" value={String(!x.on)} /></div>
			{:else if x.type === 'check'}
				<button
					type="submit"
					name="value"
					value={String(!x.on)}
					class="check"
					class:on={x.on}
					role="checkbox"
					aria-checked={x.on}
					aria-label={x.title}><span class="box" aria-hidden="true">{x.on ? '✓' : ''}</span></button
				>
			{:else if x.type === 'list' && (!long || data.change === x.key)}
				<div class="cells" role="radiogroup" aria-label={x.title}>
					{#each x.entries as e, i (i)}
						<button
							type="submit"
							name="value"
							value={String(i)}
							class="cell-opt"
							class:on={i === x.index}
							role="radio"
							aria-checked={i === x.index}>{e.toUpperCase()}</button
						>
					{/each}
				</div>
			{:else if x.type === 'list'}
				<div class="value">
					<span class="v">{x.entries[x.index].toUpperCase()}</span>
					<a class="change" href="{here}?change={encodeURIComponent(x.key)}">CHANGE ▾</a>
				</div>
			{:else if x.type === 'multi'}
				<div class="cells">
					{#each x.entries as e, i (i)}
						<label class="cell-opt box-opt"
							><input
								type="checkbox"
								name="value"
								value={x.entryValues[i]}
								checked={x.chosen.includes(x.entryValues[i])}
								onchange={(ev) => (ev.currentTarget.form as HTMLFormElement).requestSubmit()}
							/><span>{e.toUpperCase()}</span></label
						>
					{/each}
				</div>
				{#if !js}<button type="submit" class="save-multi">SAVE</button>{/if}
			{:else if x.type === 'text'}
				<div class="field">
					<input name="value" value={x.text} aria-label={x.title} autocomplete="off" />
					<button type="submit" class="save">SAVE</button>
				</div>
			{/if}
		</form>
	{/each}

	<p class="prose">
		A change is saved here and sent with every call to the source. Its page asks again when you go
		back, since a setting can change what it lists.
	</p>
</div>

<!-- eslint-enable svelte/no-navigation-without-resolve -->

<style>
	/* Index-Browse, settings, transcribed: the mock's literals; colours are tokens. */
	.screen {
		display: flex;
		flex-direction: column;
		min-height: 100dvh;
	}
	.cell {
		display: flex;
		flex-direction: column;
		justify-content: center;
		align-items: stretch;
		gap: 4px;
		height: 100%;
		padding: 0 var(--pad);
		font: 500 14px/1.2 var(--font-mono);
		color: var(--text-1);
		text-decoration: none;
		white-space: nowrap;
	}
	.cell + .cell {
		border-left: var(--hairline);
	}
	.back {
		font: 500 16px/1 var(--font-mono);
	}
	.title {
		flex: 1 1 auto;
		min-width: 0;
	}
	.name {
		font: 500 16px/1.2 var(--font-mono);
	}
	.sub {
		font: 400 12px/1 var(--font-mono);
		letter-spacing: 0.04em;
		color: var(--text-2);
	}
	.label {
		display: flex;
		justify-content: space-between;
		gap: 12px;
		padding: 18px var(--pad) 12px;
		border-bottom: var(--hairline);
		font: 500 13px/1.2 var(--font-mono);
		letter-spacing: 0.06em;
		color: var(--text-2);
	}
	.label span:last-child {
		white-space: nowrap;
	}
	.none {
		padding: 24px var(--pad);
		font: 500 13px var(--font-mono);
		letter-spacing: 0.06em;
		color: var(--text-2);
	}
	.set {
		flex-shrink: 0;
		display: flex;
		align-items: center;
		gap: 14px 24px;
		padding: 16px var(--pad);
		border-bottom: var(--hairline);
	}
	.set.column {
		flex-direction: column;
		align-items: stretch;
	}
	.what {
		flex: 1;
		min-width: 0;
		display: flex;
		flex-direction: column;
		gap: 4px;
	}
	.t {
		font: 500 16px/1.3 var(--font-sans);
	}
	.s {
		font: 400 14px/1.45 var(--font-sans);
		color: var(--text-prose);
		text-wrap: pretty;
	}
	.ctl {
		flex-shrink: 0;
		display: flex;
		align-items: center;
		min-height: 44px;
	}
	.check {
		flex-shrink: 0;
		display: flex;
		align-items: center;
		justify-content: center;
		width: 44px;
		height: 44px;
		padding: 0;
		border: 0;
		border-radius: 0;
		background: transparent;
		cursor: pointer;
	}
	.box {
		box-sizing: border-box;
		display: flex;
		align-items: center;
		justify-content: center;
		width: 26px;
		height: 26px;
		border: 2px solid var(--line-2);
		color: var(--on-accent);
		font: 700 15px var(--font-mono);
	}
	.check.on .box {
		border-color: var(--accent);
		background: var(--accent);
	}
	.cells {
		flex-shrink: 0;
		display: flex;
		flex-wrap: wrap;
		border-top: 1px solid var(--line-2);
		border-left: 1px solid var(--line-2);
	}
	.column .cells {
		align-self: flex-start;
	}
	.cell-opt {
		display: flex;
		align-items: center;
		height: 44px;
		padding: 0 14px;
		border: 0;
		border-right: 1px solid var(--line-2);
		border-bottom: 1px solid var(--line-2);
		border-radius: 0;
		background: transparent;
		color: var(--text-1);
		font: 500 14px var(--font-mono);
		white-space: nowrap;
		cursor: pointer;
	}
	.cell-opt.on,
	.box-opt:has(input:checked) {
		background: var(--surface-inverse);
		color: var(--text-inverse);
	}
	.box-opt input {
		position: absolute;
		opacity: 0;
		pointer-events: none;
	}
	.box-opt:has(input:checked) span::before {
		content: '✓ ';
	}
	.box-opt:has(input:focus-visible) {
		outline: 2px solid var(--accent);
		outline-offset: -2px;
	}
	.value {
		flex-shrink: 0;
		display: flex;
		height: 44px;
		border: 1px solid var(--line-2);
	}
	.v {
		display: flex;
		align-items: center;
		padding: 0 14px;
		font: 500 14px var(--font-mono);
	}
	.change {
		display: flex;
		align-items: center;
		padding: 0 14px;
		border-left: 1px solid var(--line-2);
		font: 500 13px var(--font-mono);
		color: var(--text-2);
		text-decoration: none;
	}
	.field {
		display: flex;
		align-self: stretch;
		min-height: 52px;
		border: 1px solid var(--text-1);
	}
	.field input {
		flex: 1;
		min-width: 0;
		padding: 0 14px;
		border: 0;
		border-radius: 0;
		background: transparent;
		color: var(--text-1);
		font: 400 15px var(--font-mono);
		outline: none;
	}
	.save,
	.save-multi {
		display: flex;
		align-items: center;
		padding: 0 22px;
		border: 0;
		border-radius: 0;
		background: var(--accent);
		color: var(--on-accent);
		font: 500 14px var(--font-mono);
		cursor: pointer;
	}
	.save-multi {
		align-self: flex-start;
		height: 44px;
	}
	.prose {
		margin: 0;
		padding: 20px var(--pad);
		font: 400 15px/1.5 var(--font-sans);
		color: var(--text-prose);
		text-wrap: pretty;
	}
</style>

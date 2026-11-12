<script lang="ts">
	import { resolve } from '$app/paths';
	import { enhance } from '$app/forms';
	import { onMount } from 'svelte';
	import TopBar from '$lib/components/chrome/TopBar.svelte';
	import Band from '$lib/components/chrome/Band.svelte';
	import Switch from '$lib/components/controls/Switch.svelte';
	import { CELLS_MAX } from '$lib/library/source-settings';
	import { fromExtensions, keepOrigin } from '$lib/library/tag-search';
	import { backLink } from '$lib/back';
	import ConfirmSheet from '$lib/components/chrome/ConfirmSheet.svelte';
	import { goto } from '$app/navigation';
	import { count } from '$lib/library/downloads';
	import ConcealBand from '../../ConcealBand.svelte';

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
	/**
	 * Where ← goes (card c727). Opened from EXTENSIONS' SETTINGS cell, back to
	 * that list, its tab and filters as they were; otherwise to the source's
	 * page, with the tag origin it was opened with kept both ways (card c453).
	 * A back link either way: when that screen is a few history entries back
	 * (here, and any CHANGE ▾ or band opened since), ← goes back to it, so
	 * its scroll comes back too; a bookmark, a reload or a new tab without
	 * that history opens the address.
	 */
	const toList = $derived(fromExtensions(data.from));
	const back = $derived(
		toList ? data.from : keepOrigin(resolve('/browse/[source]', { source: s.id }), data.from)
	);
	const backLabel = $derived(toList ? 'Back to EXTENSIONS' : `Back to ${s.name}`);
	const here = $derived(resolve('/browse/[source]/settings', { source: s.id }));
	const act = (name: string) => keepOrigin(`${here}?/${name}`, data.from);
	/** tsundoku's own switches (engine/source-flags.ts; doc/BROWSE.md, "A source's own switches"). */
	const OWN = [
		{
			flag: 'hidden',
			title: 'Hidden source',
			summary:
				'Listed in BROWSE and EXTENSIONS, searched and named only while reveal is on. Its series keep their own hidden state.'
		},
		{
			flag: 'addedHidden',
			title: 'Added hidden',
			summary: 'A series added to the library from it starts hidden.'
		},
		{
			flag: 'offHistory',
			title: 'Off history',
			summary:
				'Its reads and watches never show in HISTORY. They still count for progress, CONTINUE and tracking.'
		},
		{
			flag: 'neverTracked',
			title: 'Never tracked',
			summary:
				'Nothing from it is sent to AniList, MAL or Ranobe. Its reads still count here: progress, CONTINUE and HISTORY are unchanged.'
		}
	] as const;
	/**
	 * The answer the band's ✕ cleared (c493): only that answer, so the next
	 * action's new `form` draws its own band.
	 */
	let droppedAnswer = $state.raw<typeof form>(null);
	const latest = $derived(form === droppedAnswer ? null : form);
	const dropAnswer = () => (droppedAnswer = form);
	const refusal = $derived(
		latest && 'message' in latest && typeof latest.message === 'string'
			? latest.message.toUpperCase()
			: ''
	);
	/**
	 * CONCEAL ITS SERIES (card c523): one press, not a switch. More than one
	 * series asks first, in a sheet; without script the sheet is a URL
	 * (`?ask=conceal`), as CHANGE ▾ is.
	 */
	const c = $derived(data.conceal);
	const total = $derived(c.own + c.others);
	let asking = $state(false);
	const askOpen = $derived(asking || data.askConceal);
	function closeAsk() {
		asking = false;
		// eslint-disable-next-line svelte/no-navigation-without-resolve -- built from resolve()
		if (data.askConceal) void goto(keepOrigin(here, data.from), { replaceState: true });
	}
	const theirWorks = $derived(c.works === 1 ? 'their Work' : `their ${c.works} Works`);
	const concealSummary = $derived(
		c.own === 0
			? 'Nothing from it is shown in the library now.'
			: `Hides the ${count(c.own)} series here from it, once, now` +
					(c.others
						? `, and ${count(c.others)} more from other sources: the parts of ${theirWorks}, since a Work is hidden whole.`
						: '.') +
					' Unlike Hidden source, it changes the series themselves, and a series added later is not hidden by it.'
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
			<a class="cell back" href={back} aria-label={backLabel} use:backLink>←</a>
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
	{#if refusal}<Band title={refusal} detail="NOTHING CHANGED" ondismiss={dropAnswer} />{/if}
	{#if data.concealed}
		<ConcealBand band={data.concealed} name={s.name} undo={act('undoConceal')} />
	{/if}

	<!-- tsundoku's own switches for this source (card c435), every family's,
	     above the extension's: the same rows, in a form of their own each. -->
	<div class="label">
		<span>01 — IN TSUNDOKU</span>
		<span>{OWN.length} SWITCHES · THIS SOURCE, NOT ITS EXTENSION</span>
	</div>
	{#each OWN as o (o.flag)}
		<form
			method="POST"
			action={act('flag')}
			class="own"
			class:saved={form && 'saved' in form && form.saved === `flag:${o.flag}`}
			use:enhance={keep}
		>
			<input type="hidden" name="flag" value={o.flag} />
			<div class="what">
				<div class="t">{o.title}</div>
				<div class="s">{o.summary}</div>
			</div>
			<div class="ctl">
				<Switch checked={data.flags[o.flag]} name="value" value={String(!data.flags[o.flag])} />
			</div>
		</form>
	{/each}
	<!-- The kind this source serves (card c986): the default for every series
	     added from it, never a rewrite of the ones already here. A family with
	     one kind (LNReader's, Aniyomi's today) has nothing to choose and draws
	     no row. -->
	{#if data.kindChoices.length > 1}
		{@const chosen = data.kind ?? ''}
		<form
			method="POST"
			action={act('kind')}
			class="own"
			class:saved={form && 'saved' in form && form.saved === 'kind'}
			use:enhance={keep}
		>
			<div class="what">
				<div class="t">Kind</div>
				<div class="s">
					New series added from it start as this. Auto reads each one: a gallery's book, a webtoon
					source. The series already here keep theirs.
				</div>
			</div>
			<div class="ctl">
				<div class="cells" role="radiogroup" aria-label="Kind">
					<button
						type="submit"
						name="kind"
						value=""
						class="cell-opt"
						class:on={chosen === ''}
						role="radio"
						aria-checked={chosen === ''}>AUTO</button
					>
					{#each data.kindChoices as k (k)}
						<button
							type="submit"
							name="kind"
							value={k}
							class="cell-opt"
							class:on={k === chosen}
							role="radio"
							aria-checked={k === chosen}>{k.toUpperCase()}</button
						>
					{/each}
				</div>
			</div>
		</form>
	{/if}
	<!-- CONCEAL ITS SERIES (card c523): an action beside the switches, which
	     stores nothing; its own words, so no locator for HIDDEN SOURCE or a
	     HIDE button finds it. -->
	<div class="own-act">
		<div class="what">
			<div class="t">Conceal its series</div>
			<div class="s">{concealSummary}</div>
		</div>
		<div class="ctl">
			{#if total === 0}
				<button type="button" class="act-cell" disabled>CONCEAL</button>
			{:else if total === 1}
				<form method="POST" action={act('conceal')} use:enhance>
					<button type="submit" class="act-cell">CONCEAL 1</button>
				</form>
			{:else}
				<a
					class="act-cell"
					href={keepOrigin(`${here}?ask=conceal`, data.from)}
					onclick={(e) => {
						e.preventDefault();
						asking = true;
					}}>CONCEAL {count(total)}</a
				>
			{/if}
		</div>
	</div>
	<ConfirmSheet
		open={askOpen && total > 1}
		title="CONCEAL {count(total)} SERIES?"
		lines={[
			`${count(c.own)} FROM ${s.name.toUpperCase()} ARE HIDDEN NOW.`,
			...(c.others
				? [
						`${count(c.others)} MORE GO WITH THEM: THE PARTS OF ${theirWorks.toUpperCase()} FROM OTHER SOURCES. A WORK IS HIDDEN WHOLE.`
					]
				: []),
			'NOTHING IS KEPT: A SERIES ADDED LATER IS NOT HIDDEN. UNDO SHOWS THEM AGAIN.'
		]}
		confirm="CONCEAL {count(total)} SERIES"
		action={act('conceal')}
		fields={{}}
		onclose={closeAsk}
	/>

	{#if data.preferences}
		<div class="label">
			<span>02 — {title}</span>
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
				action={act('set')}
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
						aria-label={x.title}
						><span class="box" aria-hidden="true">{x.on ? '✓' : ''}</span></button
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
						<a
							class="change"
							href={keepOrigin(`${here}?change=${encodeURIComponent(x.key)}`, data.from)}
							>CHANGE ▾</a
						>
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
	{:else}
		<p class="prose">
			An LNReader plugin keeps no settings of its own here: only tsundoku's switches above.
		</p>
	{/if}
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
	.set,
	.own,
	.own-act {
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
	.act-cell {
		display: flex;
		align-items: center;
		height: 44px;
		padding: 0 14px;
		border: 1px solid var(--line-2);
		border-radius: 0;
		background: transparent;
		color: var(--text-1);
		font: 500 14px var(--font-mono);
		white-space: nowrap;
		text-decoration: none;
		cursor: pointer;
	}
	.act-cell:disabled {
		color: var(--text-2);
		cursor: default;
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

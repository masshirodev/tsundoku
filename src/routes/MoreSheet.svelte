<script lang="ts">
	import { onMount } from 'svelte';
	import { resolve } from '$app/paths';
	import Sheet from '$lib/components/chrome/Sheet.svelte';
	import { topics } from '$lib/help/topics';
	import {
		DEVICE_KEYS,
		VALUES,
		deviceChanged,
		valueDef,
		type Json,
		type ValueId
	} from '$lib/settings/catalog';
	import { deviceValues } from '$lib/settings/stamped';
	import { readLocal } from '$lib/settings/local';
	import { m } from '$lib/paraglide/messages';
	import { num, upper } from '$lib/i18n/format';
	import { getLocale } from '$lib/paraglide/runtime';

	/**
	 * MORE (Reach, tabletMore and phoneMore; doc/SETTINGS.md, "Getting there";
	 * card c171): the desktop sidebar's foot as a sheet, so the tablet's and
	 * phone's bar grows by one cell, not four.
	 */
	let {
		open,
		onclose,
		queued,
		start = null,
		lastImport = null
	}: {
		open: boolean;
		onclose: () => void;
		queued: number | null;
		/** GET STARTED's count, while it isn't finished: its row comes first (doc/ONBOARDING.md). */
		start?: { done: number; total: number } | null;
		/** When the last backup came in (c438): IMPORT LOG's row says LAST 2 NOV. */
		lastImport?: number | null;
	} = $props();

	/** 2 NOV, in the device's language. */
	const day = (at: number) => {
		const d = new Date(at);
		const month = d.toLocaleDateString(getLocale(), { month: 'short' }).replace(/\.$/, '');
		// Day first, as the handoff writes it, whatever order the language prefers.
		return upper(`${d.getDate()} ${month}`);
	};

	let changed = $state(0);
	onMount(() => {
		const store = Object.fromEntries(
			DEVICE_KEYS.flatMap((k) => {
				const v = readLocal<Json | undefined>(k, undefined);
				return v === undefined ? [] : [[k, v]];
			})
		);
		const ids = (Object.keys(VALUES) as ValueId[]).filter((id) => valueDef(id).where === 'device');
		changed = deviceChanged(deviceValues(ids, store));
	});
</script>

<Sheet {open} {onclose} label={m.more_label()}>
	<div class="head">
		<div class="title">{m.more_title()}</div>
		<button
			type="button"
			class="x"
			aria-label={m.chrome_close()}
			data-focus-mark="in"
			onclick={onclose}>✕</button
		>
	</div>
	{#if start}
		<a class="row start" data-focus-mark="in" href={resolve('/start')}
			><span>{m.name_get_started()}</span><span class="n">{start.done} / {start.total} →</span></a
		>
	{/if}
	<a class="row" data-focus-mark="in" href={resolve('/history')}
		><span>{m.name_history()} →</span><span class="n"></span></a
	>
	<a class="row" data-focus-mark="in" href={resolve('/downloads')}
		><span>{m.name_downloads()} →</span><span class="n"
			>{queued ? m.more_queued({ n: num(queued) }) : ''}</span
		></a
	>
	<a class="row" data-focus-mark="in" href={resolve('/settings')}
		><span>{m.name_settings()} →</span><span class="n"
			>{changed ? m.more_changed({ count: changed, n: num(changed) }) : ''}</span
		></a
	>
	<!-- HELP after SETTINGS, counting its topics (doc/HELP.md; the HELP handoff, 1D). -->
	<a class="row" data-focus-mark="in" href={resolve('/help')}
		><span>{m.name_help()} →</span><span class="n"
			>{m.more_topics({ count: topics().length, n: num(topics().length) })}</span
		></a
	>
	<!-- IMPORT LOG (c438; Import-Doors E, right): live, with when the last import came in. -->
	<a class="row" data-focus-mark="in" href={resolve('/import/log')}
		><span>{m.name_import_log()} →</span><span class="n"
			>{lastImport ? m.more_import_last({ date: day(lastImport) }) : ''}</span
		></a
	>
	<div class="foot"></div>
</Sheet>

<style>
	.head {
		display: flex;
		align-items: stretch;
		height: 56px;
		border-bottom: var(--hairline);
	}
	.title {
		flex: 1;
		display: flex;
		align-items: center;
		padding: 0 var(--pad);
		font: 500 13px var(--font-mono);
		letter-spacing: 0.06em;
		color: var(--text-2);
	}
	.x {
		width: 56px;
		display: flex;
		align-items: center;
		justify-content: center;
		border: 0;
		border-left: var(--hairline);
		background: none;
		color: var(--text-1);
		font: 500 18px var(--font-mono);
		cursor: pointer;
	}
	.row {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 12px;
		min-height: 64px;
		padding: 0 var(--pad);
		border-bottom: var(--hairline);
		color: var(--text-1);
		text-decoration: none;
		font: 500 15px var(--font-mono);
	}
	.row.start .n {
		color: var(--accent);
		font-weight: 500;
	}
	.n {
		font-weight: 400;
		color: var(--text-2);
	}
	.foot {
		height: 16px;
	}
</style>

<script lang="ts">
	import { onMount } from 'svelte';
	import { resolve } from '$app/paths';
	import Sheet from '$lib/components/chrome/Sheet.svelte';
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

	/**
	 * MORE (Reach, tabletMore and phoneMore; doc/SETTINGS.md, "Getting there";
	 * card c171): the desktop sidebar's foot as a sheet, so the tablet's and
	 * phone's bar grows by one cell, not four.
	 */
	let { open, onclose, queued }: { open: boolean; onclose: () => void; queued: number | null } =
		$props();

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

<Sheet {open} {onclose} label="More">
	<div class="head">
		<div class="title">MORE</div>
		<button type="button" class="x" aria-label="Close" onclick={onclose}>✕</button>
	</div>
	<a class="row" href={resolve('/history')}><span>HISTORY →</span><span class="n"></span></a>
	<a class="row" href={resolve('/downloads')}
		><span>DOWNLOADS →</span><span class="n"
			>{queued ? `${queued.toLocaleString('en-US')} QUEUED` : ''}</span
		></a
	>
	<a class="row" href={resolve('/settings')}
		><span>SETTINGS →</span><span class="n">{changed ? `${changed} CHANGED HERE` : ''}</span></a
	>
	<!-- Not built yet; see doc/LIBRARY.md, "What it does not do yet". -->
	<span class="row dim" aria-disabled="true"
		><span>IMPORT LOG</span><span class="n">SOON</span></span
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
	.row.dim {
		opacity: 0.4;
	}
	.n {
		font-weight: 400;
		color: var(--text-2);
	}
	.foot {
		height: 16px;
	}
</style>

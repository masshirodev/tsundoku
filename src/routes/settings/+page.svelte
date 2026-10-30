<script lang="ts">
	import { onMount } from 'svelte';
	import { enhance, deserialize } from '$app/forms';
	import { invalidateAll } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { page } from '$app/state';
	import { MediaQuery } from 'svelte/reactivity';
	import Band from '$lib/components/chrome/Band.svelte';
	import { offline } from '$lib/offline.svelte';
	import { SERVICE_NAME, clock, type Service } from '$lib/library/tracking';
	import type { AccountView } from '$lib/server/tracking';
	import {
		DEVICE_KEYS,
		SECTIONS,
		VALUES,
		deviceChanged,
		deviceName,
		equal,
		isChanged,
		movesLine,
		keptOf,
		ORIGINAL_ONLY,
		resetMoves,
		rowChanged,
		scopeLabel,
		sectionChanged,
		sectionFor,
		valueDef,
		valueLabel,
		type DeviceKind,
		type Json,
		type RowDef,
		type SectionDef,
		type SectionId,
		type ValueId,
		type Values
	} from '$lib/settings/catalog';
	import { deviceValues, plain, writeValue } from '$lib/settings/stamped';
	import {
		deviceId,
		onLocalChange,
		readLocal,
		syncDevice,
		thisKind,
		writeLocal
	} from '$lib/settings/local';
	import { audioLine, differ, inUse, overrideLine, subsLine, when } from '$lib/settings/lines';
	import { clampZoom, stepZoom, zoomLabel } from '$lib/reader/zoom';
	import { SIZE_MAX, SIZE_MIN, baseFontSize, deviceOf } from '$lib/reader/text';

	/**
	 * SETTINGS, one page (doc/SETTINGS.md; card c171, Settings.dc.html): every
	 * setting once, in eight sections, each row ending in where it's kept. A
	 * value off its default carries accent's rule and RESET; RESET SECTION
	 * applies at once and says what moved, with UNDO. No modal anywhere.
	 */
	let { data } = $props();

	// ---- where the page is drawn -------------------------------------------------------------
	const phone = new MediaQuery('(max-width: 599px)', false);
	const wide = new MediaQuery('(min-width: 1024px)', false);
	const desktop = new MediaQuery('(min-width: 1024px) and (pointer: fine)', false);
	const off = $derived(!offline.online);

	// ---- this device, and the one shown (2C) -------------------------------------------------
	let myId = $state('');
	let myKind = $state<DeviceKind>('tablet');
	/** This browser's storage, by key: what its rows read. */
	let local = $state<Record<string, Json>>({});
	let showing = $state<string | null>(null);
	const readAll = () =>
		Object.fromEntries(
			DEVICE_KEYS.flatMap((k) => {
				const v = readLocal<Json | undefined>(k, undefined);
				return v === undefined ? [] : [[k, v]];
			})
		);
	onMount(() => {
		myId = deviceId();
		myKind = thisKind();
		local = readAll();
		const stop = onLocalChange(() => (local = readAll()));
		// A visit here checks in, so the DEVICES section lists this one as it is now.
		void syncDevice({ register: true }).then((ok) => {
			if (ok) void invalidateAll();
		});
		const target = sectionFor(page.url.searchParams.get('section') ?? '');
		if (target) document.getElementById(`s-${target}`)?.scrollIntoView();
		return stop;
	});
	const other = $derived(
		showing && showing !== myId ? (data.devices.find((d) => d.id === showing) ?? null) : null
	);
	const store = $derived(other ? plain(other.settings) : local);
	const deviceIds = (Object.keys(VALUES) as ValueId[]).filter(
		(id) => valueDef(id).where === 'device'
	);
	const values = $derived<Values>({ ...data.values, ...deviceValues(deviceIds, store) });
	const shownKind = $derived(other ? other.kind : myKind);
	const devName = $derived(deviceName(shownKind, !other));
	const kindWord = (k: DeviceKind) => k.toUpperCase();

	// ---- setting ----------------------------------------------------------------------------
	async function act(name: string, fields: [string, string][]): Promise<boolean> {
		const body = new FormData();
		for (const [k, v] of fields) body.append(k, v);
		try {
			const res = await fetch(`?/${name}`, {
				method: 'POST',
				body,
				headers: { 'x-sveltekit-action': 'true' }
			});
			const r = deserialize(await res.text());
			await invalidateAll();
			return r.type === 'success';
		} catch {
			return false;
		}
	}

	/** Set or reset (undefined) several values at once: the library's in one request. */
	async function setValues(changes: { id: ValueId; v: Json | undefined }[]) {
		const lib = changes.filter((c) => valueDef(c.id).where === 'library');
		const dev = changes.filter((c) => valueDef(c.id).where === 'device');
		let st = { ...store };
		for (const c of dev) {
			const key = valueDef(c.id).key;
			const v = writeValue(c.id, st, c.v);
			st = { ...st, [key]: v };
			if (other)
				await act('device', [
					['device', other.id],
					['key', key],
					['v', JSON.stringify(v)]
				]);
			else writeLocal(key, v === null ? undefined : v);
		}
		const sets = lib.filter((c) => c.v !== undefined);
		const resets = lib.filter((c) => c.v === undefined);
		if (sets.length)
			await act(
				'set',
				sets.flatMap((c): [string, string][] => [
					['id', c.id],
					['v', JSON.stringify(c.v)]
				])
			);
		if (resets.length)
			await act(
				'set',
				resets.map((c): [string, string] => ['id', c.id])
			);
	}
	const set = (id: ValueId, v: Json) =>
		setValues([{ id, v: equal(v, valueDef(id).def) ? undefined : v }]);

	// ---- resetting, with UNDO ------------------------------------------------------------------
	/** What a RESET just moved, on the section (RESET SECTION) or on its row. Gone when the page is left. */
	let band = $state<{ at: string; a: string; b: string; undo: { id: ValueId; v: Json }[] } | null>(
		null
	);
	function reset(rows: RowDef[], at: string, a: string) {
		const moves = resetMoves(rows, values);
		if (!moves.length) return;
		const undo = moves.map((m) => ({ id: m.id, v: values[m.id] as Json }));
		band = { at, a, b: movesLine(moves), undo };
		void setValues(moves.map((m) => ({ id: m.id, v: undefined })));
	}
	function undo() {
		if (!band) return;
		const u = band.undo;
		band = null;
		void setValues(u);
	}

	// ---- lists behind N SERIES DIFFER → (2A) ---------------------------------------------------
	let open = $state<string | null>(null);
	type Item = { href: string; t: string; v: string; ids: number[] };
	const MODE_WORD: Record<string, string> = {
		rtl: 'R→L',
		ltr: 'L→R',
		vertical: 'VERTICAL',
		paged: 'PAGED',
		scroll: 'SCROLL'
	};
	function itemsOf(row: RowDef): { what: string; items: Item[] } | null {
		const href = (id: number) => resolve('/series/[id]', { id: String(id) });
		if (row.overrides === 'audio' || row.overrides === 'subs') {
			const what = row.overrides;
			return {
				what,
				items: data.lists[what].map((o) => ({
					href: href(o.seriesId),
					t: o.title,
					v: overrideLine(what, o.value, o.chosenAt),
					ids: [o.seriesId]
				}))
			};
		}
		if (row.overrides === 'mode') {
			const novel = row.id === 'layout';
			return {
				what: 'mode',
				items: data.lists.mode
					.filter((o) => (o.kind === 'novel') === novel)
					.map((o) => ({
						href: href(o.seriesId),
						t: o.title,
						v: `${MODE_WORD[o.direction] ?? o.direction.toUpperCase()} · ${o.kind.toUpperCase()} · CHOSEN IN THE READER`,
						ids: [o.seriesId]
					}))
			};
		}
		return null;
	}
	function differCount(row: RowDef): number {
		if (row.overrides === 'mode')
			return row.id === 'layout'
				? (data.counts.mode.novel ?? 0)
				: (data.counts.mode.manga ?? 0) +
						(data.counts.mode.manhwa ?? 0) +
						(data.counts.mode.doujin ?? 0);
		if (row.overrides === 'audio') return data.counts.audio;
		if (row.overrides === 'subs') return data.counts.subs;
		if (row.overrides === 'edition') return data.counts.edition;
		return 0;
	}
	async function clear(what: string, ids: number[]) {
		await act('clear', [
			['what', what],
			...ids.map((id): [string, string] => ['series', String(id)])
		]);
	}

	// ---- what a row says ------------------------------------------------------------------------
	const lastSize = $derived(data.last.subsize?.v ?? null);
	function metaOf(row: RowDef): string {
		if (row.id === 'audio')
			return audioLine((data.values['anime.audio'] as string) || undefined, data.last.audio);
		if (row.id === 'subtitles') {
			const s = data.values['anime.subs'] as string | undefined;
			return subsLine(
				{
					subs: s ? (s === 'off' ? null : s) : undefined,
					size: (data.values['anime.subsize'] as string) || undefined
				},
				{ subs: data.last.subs, size: data.last.subsize }
			);
		}
		if (row.id === 'audio-kept')
			return values['dl.audio'] === ORIGINAL_ONLY
				? 'A DOWNLOAD KEEPS THE ORIGINAL ALONE · NEW DOWNLOADS ONLY'
				: values['dl.audio']
					? 'A DOWNLOAD KEEPS THE ORIGINAL AND THESE · NEW DOWNLOADS ONLY'
					: 'A DOWNLOAD KEEPS EVERY TRACK THE SOURCE HAS · CHOOSE TO KEEP THE ORIGINAL AND A FEW';
		if (phone.current && row.id === 'mode') return '';
		return row.meta ?? '';
	}
	/** The value a segment shows pressed: the set one, else what stands in for an unset default. */
	function shown(id: ValueId): Json {
		const v = values[id];
		if (v !== undefined) return v;
		if (id === 'anime.subsize') return lastSize ?? 'M';
		return valueDef(id).def;
	}
	const needsWorkstation = (row: RowDef) => off && (row.where === 'all' || row.where === 'default');
	function scopeOf(row: RowDef): string {
		if (needsWorkstation(row))
			return `○ ${row.where === 'all' ? 'ALL DEVICES' : 'DEFAULT'} · NEEDS THE WORKSTATION`;
		return scopeLabel(row, devName);
	}
	const resetWord = (row: RowDef) => row.reset ?? 'RESET';

	// ---- the zoom cells and the novel size ----------------------------------------------------
	const zoomOf = (id: ValueId) => (typeof values[id] === 'number' ? (values[id] as number) : 1);
	const sizeDevice = $derived(
		other
			? other.kind === 'phone'
				? 'phone'
				: other.kind === 'desktop'
					? 'landscape'
					: 'tablet'
			: typeof window === 'undefined'
				? 'tablet'
				: deviceOf(innerWidth, innerHeight)
	);
	const size = $derived(
		typeof values['text.size'] === 'number'
			? (values['text.size'] as number)
			: baseFontSize(sizeDevice)
	);
	const stepSize = (d: 1 | -1) =>
		set('text.size', Math.min(SIZE_MAX, Math.max(SIZE_MIN, size + d)));

	// ---- AUDIO KEPT (c160) ------------------------------------------------------------------------
	const KEPT_CHIPS = ['EN', 'ES', 'PT', 'FR', 'DE', 'IT', 'AR'];
	const kept = $derived(
		keptOf((values['dl.audio'] as string | undefined) ?? '') ?? [...KEPT_CHIPS]
	);
	function toggleKept(l: string) {
		const next = kept.includes(l) ? kept.filter((x) => x !== l) : [...kept, l];
		// Every chip kept is every track kept, the default; none is the original alone.
		const all = KEPT_CHIPS.every((c) => next.includes(c));
		void set(
			'dl.audio',
			all ? '' : next.length ? KEPT_CHIPS.filter((c) => next.includes(c)).join(',') : ORIGINAL_ONLY
		);
	}

	// ---- the section index (landscape and desktop) ----------------------------------------------
	let active = $state<SectionId>('images');
	onMount(() => {
		const io = new IntersectionObserver(
			(entries) => {
				const seen = entries.filter((e) => e.isIntersecting);
				if (seen.length) active = seen[0].target.id.slice(2) as SectionId;
			},
			{ rootMargin: '-20% 0px -70% 0px' }
		);
		for (const s of SECTIONS) {
			const el = document.getElementById(`s-${s.id}`);
			if (el) io.observe(el);
		}
		return () => io.disconnect();
	});

	const sections = $derived(SECTIONS.filter((s) => s.id !== 'browse' || data.browse));
	const titleOf = (s: SectionDef) => (phone.current && s.short ? s.short : s.title);

	// ---- CATALOGUES (Catalogue Links 1u, 1v; doc/TRACKING.md) -----------------------------------
	const count = (n: number) => n.toLocaleString('en-US');
	const DAY = 24 * 3600_000;
	function accountMeta(a: AccountView): { text: string; alert: boolean } {
		if (!a.configured)
			return { text: 'THE APP ISN’T REGISTERED · SEE DOC/SECRETS.MD', alert: false };
		if (!a.userName)
			return { text: `${count(a.linked)} LINKED · SHOWN, BUT NOTHING SENT`, alert: false };
		const head = a.service === 'anilist' ? 'MAIN LIST · READ AND WRITTEN' : 'READ AND WRITTEN';
		if (a.failed.count)
			return {
				text: `${a.failed.count} SERIES NOT SENT · ${a.failed.error ?? 'DID NOT ANSWER'}${a.failed.at ? ` · ${clock(a.failed.at)}` : ''}`,
				alert: true
			};
		// AniList's token lasts a year, with no refresh: say so a month ahead.
		if (a.service === 'anilist' && a.expiresAt && a.expiresAt - Date.now() < 30 * DAY)
			return {
				text: `${head} · SIGN-IN RUNS OUT ${new Date(a.expiresAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }).toUpperCase()}`,
				alert: true
			};
		if (a.waiting) return { text: `${head} · ${a.waiting} WAITING`, alert: false };
		return {
			text: `${head} · ${a.listReadAt ? `LIST READ ${clock(a.listReadAt)}` : 'ALL SENT'}`,
			alert: false
		};
	}
	const rb = $derived(data.catalogues.ranobe);
	const rbSend = $derived.by((): { text: string; alert: boolean } => {
		if (rb.failed.count)
			return {
				text: `${rb.failed.count} UNIT${rb.failed.count === 1 ? '' : 'S'} NOT SENT · ${rb.failed.error ?? 'RANOBE DID NOT ANSWER'}${rb.failed.at ? ` · ${clock(rb.failed.at)}` : ''}`,
				alert: true
			};
		return {
			text: `NOVELS · READ AND WRITTEN · ${rb.lastSent ? `LAST SENT ${clock(rb.lastSent)}` : 'NOTHING SENT YET'}`,
			alert: false
		};
	});
	const rbPassHead = $derived(
		`${rb.passAt ? `LAST PASS ${clock(rb.passAt)}` : 'NO PASS YET'} · ${count(rb.linked)} LINKED`
	);
	const signinBand = $derived.by(() => {
		const s = data.signin;
		if (!s) return null;
		const name = SERVICE_NAME[s.service as Service] ?? s.service.toUpperCase();
		if (s.outcome === 'ok')
			return { title: `SIGNED IN TO ${name}`, detail: 'ITS LIST IS BEING READ' };
		if (s.outcome === 'refused')
			return { title: `${name} SIGN-IN CANCELLED`, detail: 'NOTHING CHANGED' };
		if (s.outcome === 'unconfigured')
			return {
				title: `${name} ISN’T SET UP`,
				detail: 'ITS APP KEYS AREN’T IN .ENV · DOC/SECRETS.MD'
			};
		return { title: `${name} SIGN-IN FAILED`, detail: 'NOTHING CHANGED · TRY AGAIN' };
	});

	// ---- DEVICES ---------------------------------------------------------------------------------
	const changedOn = (settings: Record<string, Json>) =>
		deviceChanged(deviceValues(deviceIds, settings));
	const myChanged = $derived(changedOn(local));
	const changedWord = (n: number) =>
		n ? `${n} SETTING${n === 1 ? '' : 'S'} CHANGED` : 'NOTHING CHANGED';
	const others = $derived(data.devices.filter((d) => d.id !== myId));
	async function startFromDevice(from: string) {
		if (
			await act('startFrom', [
				['device', myId],
				['from', from]
			])
		)
			await syncDevice();
		local = readAll();
	}
</script>

<svelte:head><title>Settings · tsundoku</title></svelte:head>

<div
	class="settings"
	class:phone={phone.current}
	class:wide={wide.current}
	class:desk={desktop.current}
>
	<div class="bar">
		{#if !desktop.current}
			<a class="back" href={resolve('/')}><span class="arrow">←</span><span>LIBRARY</span></a>
		{/if}
		<h1>SETTINGS</h1>
		<div class="dev" class:ink={!!other}>
			{other ? `SHOWING: ${kindWord(other.kind)}` : devName}
		</div>
	</div>

	{#if signinBand}<Band title={signinBand.title} detail={signinBand.detail} />{/if}

	{#if other}
		<div class="topband">
			<div class="tb-text">
				<div class="a">SHOWING THE {kindWord(other.kind)}'S SETTINGS</div>
				<div class="b">
					CHANGES REACH IT THE NEXT TIME IT OPENS · ALL-DEVICE ROWS ARE THE SAME EVERYWHERE
				</div>
			</div>
			<button type="button" class="tb-cell" onclick={() => (showing = null)}
				>BACK TO {deviceName(myKind, true)}</button
			>
		</div>
	{:else if off}
		<div class="topband">
			<div class="tb-text">
				<div class="a">○ OFFLINE</div>
				<div class="b">
					{devName}'S ROWS STILL CHANGE, AND REACH THE WORKSTATION WHEN IT'S BACK
				</div>
			</div>
		</div>
	{/if}

	<div class="body">
		{#if wide.current}
			<nav class="index" aria-label="Sections">
				{#each sections as s (s.id)}
					{@const n = sectionChanged(s, values)}
					<a
						href="#s-{s.id}"
						class:on={active === s.id}
						aria-current={active === s.id ? 'true' : undefined}
						><span>{s.n} {s.short ?? s.title}</span><span class="n">{n ? `${n} CHANGED` : ''}</span
						></a
					>
				{/each}
			</nav>
		{/if}

		<div class="content">
			{#if !wide.current}
				<div class="legend">
					<div class="lg">
						<div class="lg-a">ALL DEVICES</div>
						<div class="lg-b">KEPT ON THE WORKSTATION · ONE VALUE EVERYWHERE</div>
					</div>
					<div class="lg">
						<div class="lg-a">{devName}</div>
						<div class="lg-b">KEPT FOR THIS DEVICE · OTHERS KEEP THEIR OWN</div>
					</div>
					<div class="lg">
						<div class="lg-a">DEFAULT</div>
						<div class="lg-b">WHERE THINGS START · A SERIES CAN DIFFER</div>
					</div>
				</div>
			{/if}

			{#each sections as s (s.id)}
				{@const n = sectionChanged(s, values)}
				<section id="s-{s.id}" aria-label="{s.n} — {titleOf(s)}">
					<div class="sec-head">
						<h2>{s.n} — {titleOf(s)}</h2>
						<span class="sec-right">
							{#if s.id === 'library'}<span>{count(data.folded)} FOLDED</span>
							{:else if s.id === 'catalogues'}<span
									>{off
										? '○ OFFLINE · SIGN-INS NEED THE WORKSTATION'
										: `${count(data.catalogues.linked)} LINKED · ${data.catalogues.toReview} TO REVIEW`}</span
								>
							{:else if s.id === 'browse' && data.browse}<span
									>{data.browse.chosen.map((l) => l.toUpperCase()).join(', ')}</span
								>
							{:else if s.id === 'devices'}<span>{data.devices.length} KEPT</span>
							{:else if n}<span>{n} CHANGED ·</span><button
									type="button"
									class="link"
									onclick={() =>
										reset(s.rows, s.id, `SECTION RESET · ${n} SETTING${n === 1 ? '' : 'S'}`)}
									>{phone.current ? 'RESET' : 'RESET SECTION'}</button
								>{/if}
						</span>
					</div>
					{#if band && band.at === s.id}
						{@render resetBand()}
					{/if}
					<div class="rows">
						{#each s.rows as row (row.id)}
							{#if row.control.type === 'account'}
								{@render account(row)}
							{:else if s.id === 'browse'}
								{@render browseRow(row)}
							{:else}
								{@render settingRow(row)}
							{/if}
							{#if band && band.at === row.id}
								{@render resetBand()}
							{/if}
						{/each}
						{#if s.id === 'devices'}
							{@render devices()}
						{/if}
					</div>
				</section>
			{/each}
			<div class="end"></div>
		</div>
	</div>
</div>

{#snippet resetBand()}
	{#if band}
		<div class="secband" role="status">
			<div class="sb-text">
				<div class="a">{band.a}</div>
				<div class="b">{band.b}</div>
			</div>
			<button type="button" class="sb-cell" onclick={undo}>UNDO</button>
		</div>
	{/if}
{/snippet}

{#snippet scope(row: RowDef)}
	{@const n = differCount(row)}
	{@const list = itemsOf(row)}
	<span class="sa" class:quiet={row.where === 'all' || needsWorkstation(row)}>{scopeOf(row)}</span>
	{#if n && !needsWorkstation(row)}
		{#if list}
			<button
				type="button"
				class="sb"
				aria-expanded={open === row.id}
				onclick={() => (open = open === row.id ? null : row.id)}
				>{differ(n, row.overrides === 'edition' ? 'BOOK' : 'SERIES')}</button
			>
		{:else}
			<span class="sb plain">{differ(n, 'BOOK').replace(' →', '')}</span>
		{/if}
	{/if}
	{#if rowChanged(row, values) && !needsWorkstation(row)}
		<button type="button" class="reset" onclick={() => reset([row], row.id, `${row.label} RESET`)}
			>{resetWord(row)}</button
		>
	{/if}
{/snippet}

{#snippet settingRow(row: RowDef)}
	{@const c = row.control}
	{@const dim = needsWorkstation(row)}
	{@const tall =
		(c.type === 'seg' && c.groups.length > 1) ||
		c.type === 'zoom' ||
		c.type === 'chips' ||
		open === row.id}
	{@const meta = metaOf(row)}
	{@const list = open === row.id ? itemsOf(row) : null}
	<div class="row" class:changed={rowChanged(row, values)} class:dim data-row={row.id}>
		<div class="label" class:tall>{row.label}</div>
		<div class="ctl">
			{#if c.type === 'seg'}
				{#each c.groups as g (g.value)}
					<div class="seg" role="group" aria-label={g.k ?? row.label}>
						{#if g.k && !(phone.current && row.id === 'subtitles')}<div class="k">{g.k}</div>{/if}
						{#each g.opts as o (JSON.stringify(o.value))}
							{@const on = equal(shown(g.value), o.value)}
							<button
								type="button"
								aria-pressed={on}
								class:on
								disabled={dim}
								onclick={() => set(g.value, o.value)}
								>{phone.current && o.short ? o.short : o.label}</button
							>
						{/each}
					</div>
				{/each}
			{:else if c.type === 'chips'}
				<div class="chips">
					<button type="button" class="on locked" aria-pressed="true" disabled
						>✓ ORIGINAL · ALWAYS</button
					>
					{#each KEPT_CHIPS as l (l)}
						{@const on = kept.includes(l)}
						<button
							type="button"
							aria-pressed={on}
							class:on
							disabled={dim}
							onclick={() => toggleKept(l)}>{on ? `✓ ${l}` : l}</button
						>
					{/each}
				</div>
			{:else if c.type === 'zoom'}
				<div class="zooms">
					{#each c.cells as z (z.value)}
						{@const v = zoomOf(z.value)}
						<div class="zoom" class:changed={isChanged(z.value, values[z.value])}>
							<div class="zh">
								<span>{z.h}</span><span class="flag"
									>{!other && inUse(z.h, phone.current) ? 'IN USE' : ''}</span
								>
							</div>
							<div class="zb">
								<button
									type="button"
									aria-label="Smaller"
									onclick={() => set(z.value, clampZoom(stepZoom(v, -1)))}>−</button
								>
								<div class="zv">{zoomLabel(v)}</div>
								<button
									type="button"
									aria-label="Larger"
									onclick={() => set(z.value, clampZoom(stepZoom(v, 1)))}>+</button
								>
							</div>
						</div>
					{/each}
				</div>
			{:else if c.type === 'step'}
				<div class="seg" role="group" aria-label={row.label}>
					<button type="button" disabled={size <= SIZE_MIN} onclick={() => stepSize(-1)}>A −</button
					>
					<button
						type="button"
						class:on={values['text.size'] !== undefined}
						aria-pressed={values['text.size'] !== undefined}>{size} PX</button
					>
					<button type="button" disabled={size >= SIZE_MAX} onclick={() => stepSize(1)}>A +</button>
				</div>
			{:else if c.type === 'info'}
				<div class="info">
					{c.value === 'speed' ? '1×' : valueLabel(c.value, values[c.value])}
				</div>
			{/if}
			{#if meta}<div class="meta">{meta}</div>{/if}
			{#if list}
				<div class="list">
					{#each list.items as it (it.href)}
						<div class="item">
							<!-- eslint-disable-next-line svelte/no-navigation-without-resolve -- resolved in itemsOf -->
							<a href={it.href}><span class="it-t">{it.t}</span><span class="it-v">{it.v}</span></a>
							<button
								type="button"
								aria-label="Back to the default"
								onclick={() => clear(list.what, it.ids)}>✕</button
							>
						</div>
					{/each}
					<div class="list-foot">
						<span
							>{differ(list.items.length).replace(' →', '')} · ✕ PUTS ONE BACK ON THE DEFAULT</span
						>
						<button
							type="button"
							class="link"
							onclick={() =>
								clear(
									list.what,
									list.items.flatMap((i) => i.ids)
								)}>CLEAR ALL {list.items.length}</button
						>
					</div>
				</div>
			{/if}
			{#if phone.current}
				<div class="scope inline">{@render scope(row)}</div>
			{/if}
		</div>
		{#if !phone.current}
			<div class="scope">{@render scope(row)}</div>
		{/if}
	</div>
{/snippet}

{#snippet account(row: RowDef)}
	{#if row.id === 'ranobe'}
		<div class="row acct ranobe" class:dim={off}>
			<div class="label">RANOBE</div>
			<div class="ctl">
				<div class="acct-body">
					<div class="who">
						{#if rb.configured}
							<!-- Ranobe has no endpoint naming a token's account: the mock's "Token for masshiro" can't be known (doc/RANOBE.md). -->
							<div class="name">Token in .env</div>
							<div class="meta" class:alert={rbSend.alert}>{rbSend.text}</div>
							<div class="meta">
								{rbPassHead}{#if rb.toChoose}
									· <a class="choose" href={resolve('/links')}>{rb.toChoose} TO CHOOSE</a>{/if}
								· {count(rb.notOn)} NOT ON RANOBE{rb.suggested
									? ` · ${rb.suggested} SUGGESTED`
									: ''}
							</div>
						{:else}
							<div class="name muted">Not configured</div>
							<div class="meta">NO TOKEN · RANOBE_TOKEN IN .ENV</div>
						{/if}
					</div>
					{#if rb.configured && rb.failed.count}
						<form method="POST" action="?/retryRanobe" use:enhance class="cell-form">
							<button type="submit" class="cell" disabled={off}>TRY AGAIN</button>
						</form>
					{/if}
				</div>
			</div>
			{#if !phone.current}<div class="scope"><span class="sa quiet">ALL DEVICES</span></div>{/if}
		</div>
	{:else}
		{@const a = data.catalogues.accounts.find((x) => x.service === row.id)}
		{#if a}
			{@const m = accountMeta(a)}
			<div class="row acct" class:dim={off}>
				<div class="label">{SERVICE_NAME[a.service]}</div>
				<div class="ctl">
					<div class="acct-body">
						<div class="who">
							<div class="name" class:muted={!a.userName}>
								{a.userName ? `Signed in as ${a.userName}` : 'Not signed in'}
							</div>
							<div class="meta" class:alert={m.alert}>{m.text}</div>
						</div>
						{#if a.userName}
							{#if a.failed.count}
								<form method="POST" action="?/retry" use:enhance class="cell-form">
									<input type="hidden" name="service" value={a.service} />
									<button type="submit" class="cell" disabled={off}>TRY AGAIN</button>
								</form>
							{/if}
							<form method="POST" action="?/signOut" use:enhance class="cell-form">
								<input type="hidden" name="service" value={a.service} />
								<button type="submit" class="cell" disabled={off}>SIGN OUT</button>
							</form>
						{:else if a.configured}
							{#if off}
								<span class="cell acc dim" aria-disabled="true">SIGN IN →</span>
							{:else}
								<!-- A full navigation: off to the catalogue and back (doc/TRACKING.md). -->
								<a
									class="cell acc"
									href={resolve('/settings/catalogues/[service]', { service: a.service })}
									data-sveltekit-reload>SIGN IN →</a
								>
							{/if}
						{/if}
					</div>
				</div>
				{#if !phone.current}<div class="scope"><span class="sa quiet">ALL DEVICES</span></div>{/if}
			</div>
		{/if}
	{/if}
{/snippet}

{#snippet browseRow(row: RowDef)}
	{#if data.browse}
		<div class="row" class:dim={off}>
			<div class="label tall">{row.label}</div>
			<div class="ctl">
				<form method="POST" action="?/browseLanguage" use:enhance class="chips">
					{#each data.browse.cells as l (l)}
						{@const on = data.browse.chosen.includes(l)}
						<button type="submit" name="lang" value={l} class:on aria-pressed={on} disabled={off}
							>{l.toUpperCase()}</button
						>
					{/each}
				</form>
				<div class="meta">{row.meta}</div>
				{#if phone.current}<div class="scope inline">
						<span class="sa quiet">ALL DEVICES</span>
					</div>{/if}
			</div>
			{#if !phone.current}<div class="scope"><span class="sa quiet">ALL DEVICES</span></div>{/if}
		</div>
	{/if}
{/snippet}

{#snippet devices()}
	{@const me = data.devices.find((d) => d.id === myId)}
	{#each [...(me ? [me] : []), ...others] as d (d.id)}
		{@const mine = d.id === myId}
		{@const n = mine ? myChanged : changedOn(plain(d.settings))}
		{@const shownHere = mine ? !other : other?.id === d.id}
		<div class="row device" class:dim={off}>
			<div class="label">
				{mine ? (other ? `${kindWord(d.kind)} · THIS` : 'THIS') : kindWord(d.kind)}
			</div>
			<div class="ctl">
				<div class="acct-body">
					<div class="who">
						<div class="name">{d.label}</div>
						<div class="meta">
							{mine ? 'OPEN NOW' : `LAST OPENED ${when(d.seenAt)}`} · {changedWord(n)}
						</div>
					</div>
					{#if !mine && myChanged === 0 && changedOn(plain(d.settings)) > 0}
						<!-- A new device starts on the defaults; its first visit offers another's (question 1). -->
						<button type="button" class="cell" disabled={off} onclick={() => startFromDevice(d.id)}
							>START FROM</button
						>
					{/if}
					<button
						type="button"
						class="cell"
						class:acc={shownHere}
						aria-pressed={shownHere}
						disabled={off && !mine}
						onclick={() => (showing = mine ? null : d.id)}>{shownHere ? 'SHOWING' : 'SHOW'}</button
					>
				</div>
			</div>
			{#if !phone.current}<div class="scope">
					<span class="sa">KEPT ON THE WORKSTATION</span>
				</div>{/if}
		</div>
	{/each}
{/snippet}

<style>
	/*
	 * The handoff's measurements, transcribed (Settings.dc.html): hand-set, not
	 * a spacing scale, as everywhere in tsundoku. tests/settings-frame.e2e.ts
	 * pins them so a tidy-up can't round them away.
	 */
	.settings {
		--pad: 24px;
		--label-w: 132px;
		--k-w: 84px;
		--seg-fs: 14px;
		--scope-w: 168px;
		--bar-h: 72px;
		display: flex;
		flex-direction: column;
		min-height: 100dvh;
		background: var(--surface-page);
		color: var(--text-1);
	}
	.settings.phone {
		--pad: 16px;
		--label-w: 84px;
		--k-w: 70px;
		--seg-fs: 13px;
		--bar-h: 60px;
	}
	.settings.desk {
		--bar-h: 64px;
		--scope-w: 176px;
	}
	button {
		font: inherit;
		color: inherit;
		background: none;
		border: 0;
		padding: 0;
		border-radius: 0;
		cursor: pointer;
	}
	button:disabled {
		cursor: default;
	}

	/* ---- the bar ---- */
	.bar {
		flex-shrink: 0;
		display: flex;
		align-items: stretch;
		height: var(--bar-h);
		border-bottom: var(--hairline);
	}
	.back {
		display: flex;
		align-items: center;
		gap: 14px;
		padding: 0 var(--pad);
		border-right: var(--hairline);
		color: var(--text-1);
		text-decoration: none;
		font: 500 14px var(--font-mono);
		letter-spacing: 0.04em;
	}
	.back .arrow {
		font-size: 17px;
	}
	h1 {
		flex: 1;
		margin: 0;
		display: flex;
		align-items: center;
		padding: 0 18px;
		font: 500 13px var(--font-mono);
		letter-spacing: 0.06em;
		color: var(--text-2);
	}
	.dev {
		display: flex;
		align-items: center;
		padding: 0 var(--pad);
		border-left: var(--hairline);
		font: 500 13px var(--font-mono);
		letter-spacing: 0.04em;
		color: var(--text-2);
	}
	.dev.ink {
		color: var(--text-1);
	}

	/* ---- the bands under the bar ---- */
	.topband {
		flex-shrink: 0;
		display: flex;
		align-items: stretch;
		min-height: 60px;
		border-bottom: var(--hairline);
		background: var(--surface-panel);
	}
	.tb-text {
		flex: 1;
		min-width: 0;
		display: flex;
		flex-direction: column;
		justify-content: center;
		gap: 4px;
		padding: 10px var(--pad);
	}
	.topband .a,
	.secband .a {
		font: 500 14px var(--font-mono);
	}
	.topband .b {
		font: 400 13px/1.4 var(--font-mono);
		color: var(--text-2);
	}
	.tb-cell {
		display: flex;
		align-items: center;
		padding: 0 20px;
		border-left: var(--hairline);
		font: 500 13px var(--font-mono);
		letter-spacing: 0.04em;
		white-space: nowrap;
	}

	/* ---- index and content ---- */
	.body {
		flex: 1;
		min-height: 0;
		display: flex;
	}
	/* The index is sticky and only as tall as its entries, so the rule between it
	   and the rows is the content's: it runs the page's length (2026-10-29). */
	.index {
		width: 260px;
		flex-shrink: 0;
		box-sizing: border-box;
		display: flex;
		flex-direction: column;
		position: sticky;
		top: 0;
		align-self: flex-start;
	}
	.desk .index {
		width: 232px;
	}
	.index a {
		display: flex;
		justify-content: space-between;
		align-items: center;
		gap: 8px;
		min-height: 52px;
		padding: 0 20px;
		border-bottom: var(--hairline);
		color: var(--text-1);
		text-decoration: none;
		font: 500 13px var(--font-mono);
		letter-spacing: 0.04em;
	}
	.index a .n {
		white-space: nowrap;
		font-weight: 400;
		color: var(--text-2);
	}
	.index a.on {
		background: var(--surface-inverse);
		color: var(--text-inverse);
	}
	.index a.on .n {
		color: var(--text-inverse);
	}
	.content {
		flex: 1;
		min-width: 0;
		box-sizing: border-box;
		display: flex;
		flex-direction: column;
		width: 100%;
	}
	/* The rows stop at 880px; the column closes there, or their rules run out into nothing. */
	.wide .content {
		border-left: var(--hairline);
	}
	.desk .content {
		max-width: 880px;
		border-right: var(--hairline);
	}
	.legend {
		display: grid;
		grid-template-columns: repeat(3, minmax(0, 1fr));
		border-bottom: var(--hairline);
		background: var(--surface-panel);
	}
	.phone .legend {
		grid-template-columns: repeat(1, minmax(0, 1fr));
	}
	.lg {
		display: flex;
		flex-direction: column;
		gap: 4px;
		padding: 12px var(--pad);
		border-right: var(--hairline);
	}
	.phone .lg {
		border-bottom: var(--hairline);
	}
	.lg-a {
		font: 500 12px var(--font-mono);
		letter-spacing: 0.04em;
	}
	.lg-b {
		font: 400 12px/1.4 var(--font-mono);
		color: var(--text-2);
	}
	section {
		display: flex;
		flex-direction: column;
		scroll-margin-top: 0;
	}
	.sec-head {
		display: flex;
		justify-content: space-between;
		align-items: baseline;
		gap: 12px;
		padding: 24px var(--pad) 12px;
		font: 500 13px/1.2 var(--font-mono);
		letter-spacing: 0.06em;
		color: var(--text-2);
	}
	.sec-head h2 {
		margin: 0;
		font: inherit;
	}
	.sec-right {
		display: flex;
		gap: 10px;
		white-space: nowrap;
	}
	.link {
		color: var(--text-1);
		text-decoration: underline;
		text-underline-offset: 3px;
		letter-spacing: 0.04em;
	}
	.secband {
		display: flex;
		align-items: stretch;
		min-height: 56px;
		border-top: 1px solid var(--text-1);
		background: var(--surface-panel);
	}
	.sb-text {
		flex: 1;
		display: flex;
		flex-direction: column;
		justify-content: center;
		gap: 4px;
		padding: 8px var(--pad);
	}
	.secband .b {
		font: 400 13px var(--font-mono);
		color: var(--text-2);
	}
	.sb-cell {
		display: flex;
		align-items: center;
		padding: 0 24px;
		border-left: var(--hairline);
		font: 500 13px var(--font-mono);
		letter-spacing: 0.04em;
	}
	.rows {
		border-top: var(--hairline);
	}
	.end {
		height: 96px;
	}

	/* ---- a row ---- */
	.row {
		display: flex;
		align-items: stretch;
		min-height: 64px;
		border-bottom: var(--hairline);
	}
	.row.changed {
		box-shadow: inset 3px 0 0 var(--accent);
	}
	.label {
		display: flex;
		align-items: center;
		width: var(--label-w);
		flex-shrink: 0;
		box-sizing: border-box;
		padding-left: var(--pad);
		padding-right: 8px;
		border-right: var(--hairline);
		font: 500 12px/1.3 var(--font-mono);
		letter-spacing: 0.06em;
		color: var(--text-2);
	}
	.label.tall {
		align-items: flex-start;
		padding-top: 20px;
	}
	.ctl {
		flex: 1;
		min-width: 0;
		display: flex;
		flex-direction: column;
	}
	.row.dim .label,
	.row.dim .ctl {
		opacity: 0.4;
	}
	.seg {
		display: flex;
		min-height: 52px;
	}
	.seg + .seg {
		border-top: var(--hairline);
	}
	.k {
		width: var(--k-w);
		flex-shrink: 0;
		display: flex;
		align-items: center;
		padding-left: 14px;
		box-sizing: border-box;
		border-right: var(--hairline);
		font: 500 12px var(--font-mono);
		letter-spacing: 0.04em;
		color: var(--text-2);
	}
	/* Equal, as drawn, until a word won't fit: FOLLOW THE PLAYER takes the room it needs. */
	.seg button {
		flex: 1 1 0;
		min-width: max-content;
		display: flex;
		align-items: center;
		justify-content: center;
		padding: 0 6px;
		border-right: var(--hairline);
		font: 500 var(--seg-fs) var(--font-mono);
		white-space: nowrap;
		text-align: center;
	}
	.seg button:last-child {
		border-right: 0;
	}
	.seg button.on,
	.chips button.on {
		background: var(--surface-inverse);
		color: var(--text-inverse);
	}
	.chips {
		display: flex;
		flex-wrap: wrap;
	}
	.chips button {
		flex: 0 0 auto;
		display: flex;
		align-items: center;
		min-height: 52px;
		padding: 0 16px;
		border-right: var(--hairline);
		border-bottom: var(--hairline);
		font: 500 14px var(--font-mono);
		white-space: nowrap;
	}
	.chips button.locked {
		opacity: 0.6;
	}
	.zooms {
		display: grid;
		grid-template-columns: repeat(2, minmax(0, 1fr));
	}
	.zoom {
		display: flex;
		flex-direction: column;
		border-bottom: var(--hairline);
	}
	.zoom:nth-child(odd) {
		border-right: var(--hairline);
	}
	.zoom.changed {
		box-shadow: inset 3px 0 0 var(--accent);
	}
	.zh {
		display: flex;
		justify-content: space-between;
		gap: 8px;
		padding: 10px 14px 0;
		font: 500 12px var(--font-mono);
		letter-spacing: 0.04em;
		color: var(--text-2);
	}
	.zh .flag {
		color: var(--text-1);
	}
	.zb {
		display: flex;
		align-items: center;
		height: 52px;
	}
	.zb button {
		width: 52px;
		height: 52px;
		display: flex;
		align-items: center;
		justify-content: center;
		font: 500 18px var(--font-mono);
		text-align: center;
	}
	.zv {
		flex: 1;
		text-align: center;
		font: 500 16px var(--font-mono);
	}
	.info {
		display: flex;
		align-items: center;
		min-height: 52px;
		padding: 0 14px;
		font: 500 15px var(--font-mono);
	}
	.meta {
		padding: 10px 14px 12px;
		font: 400 13px/1.45 var(--font-mono);
		color: var(--text-2);
	}
	/* A rule between the controls and what's said under them (asked 2026-10-29),
	   laid over the one a zoom cell or a chip already draws, so it's never doubled. */
	.ctl > .meta {
		border-top: var(--hairline);
		margin-top: -1px;
	}
	/* With nothing under them, the controls fill the row: its 64px, not their 52px
	   and a gap (WIDE PAGES, reported 2026-10-29). */
	.ctl > .seg:last-child,
	.ctl > .info:last-child {
		flex: 1;
	}
	.list {
		display: flex;
		flex-direction: column;
		border-top: var(--hairline);
	}
	.item {
		display: flex;
		align-items: stretch;
		min-height: 56px;
		border-bottom: var(--hairline);
	}
	.item a {
		flex: 1;
		min-width: 0;
		display: flex;
		flex-direction: column;
		justify-content: center;
		gap: 3px;
		padding: 8px 14px;
		color: var(--text-1);
		text-decoration: none;
	}
	.it-t {
		font: 500 15px var(--font-sans);
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}
	.it-v {
		font: 400 12px var(--font-mono);
		color: var(--text-2);
	}
	.item button {
		width: 56px;
		flex-shrink: 0;
		display: flex;
		align-items: center;
		justify-content: center;
		border-left: var(--hairline);
		font: 500 16px var(--font-mono);
		text-align: center;
	}
	.list-foot {
		display: flex;
		justify-content: space-between;
		align-items: center;
		min-height: 52px;
		padding: 0 14px;
		font: 500 13px var(--font-mono);
		letter-spacing: 0.04em;
	}
	.list-foot span {
		color: var(--text-2);
		font-weight: 400;
	}

	/* ---- where it applies ---- */
	.scope {
		width: var(--scope-w);
		flex-shrink: 0;
		box-sizing: border-box;
		display: flex;
		flex-direction: column;
		justify-content: center;
		gap: 8px;
		padding: 10px 14px;
		border-left: var(--hairline);
		font: 500 12px/1.3 var(--font-mono);
		letter-spacing: 0.04em;
	}
	.scope.inline {
		width: auto;
		flex-direction: row;
		justify-content: flex-start;
		flex-wrap: wrap;
		gap: 6px 12px;
		padding: 0 14px 12px;
		border-left: 0;
		font: 500 12px var(--font-mono);
	}
	.sa {
		color: var(--text-1);
	}
	.sa.quiet {
		color: var(--text-2);
	}
	.sb,
	.reset {
		color: var(--text-1);
		text-decoration: underline;
		text-underline-offset: 3px;
		text-align: left;
	}
	.sb.plain {
		text-decoration: none;
	}

	/* ---- accounts and devices ---- */
	.row.acct,
	.row.device {
		min-height: 68px;
	}
	/* Three lines, so taller than a sign-in's row (Ranobe 3a: 84px against 68px). */
	.row.acct.ranobe {
		min-height: 84px;
	}
	.acct-body {
		flex: 1;
		display: flex;
		align-items: stretch;
	}
	.who {
		flex: 1;
		min-width: 0;
		display: flex;
		flex-direction: column;
		justify-content: center;
		gap: 5px;
		padding: 10px 14px;
	}
	.name {
		font: 500 15px var(--font-sans);
	}
	.name.muted {
		color: var(--text-2);
	}
	.who .meta {
		padding: 0;
		font: 400 13px/1.35 var(--font-mono);
	}
	.who .meta.alert {
		color: var(--text-1);
	}
	.choose {
		color: var(--text-1);
	}
	.cell-form {
		display: flex;
	}
	.cell {
		display: flex;
		align-items: center;
		padding: 0 18px;
		border-left: var(--hairline);
		color: var(--text-1);
		text-decoration: none;
		font: 500 13px var(--font-mono);
		letter-spacing: 0.04em;
		white-space: nowrap;
	}
	.cell.acc {
		background: var(--accent);
		color: var(--on-accent);
	}
	.cell:disabled,
	.cell.dim {
		opacity: 0.4;
	}
</style>

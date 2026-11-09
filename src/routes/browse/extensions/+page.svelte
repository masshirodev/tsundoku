<script lang="ts">
	import HelpMark from '$lib/components/help/HelpMark.svelte';
	import HelpSheet from '$lib/components/help/HelpSheet.svelte';
	import StartTrail from '$lib/components/start/StartTrail.svelte';
	import { resolve } from '$app/paths';
	import { enhance } from '$app/forms';
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import TopBar from '$lib/components/chrome/TopBar.svelte';
	import Band from '$lib/components/chrome/Band.svelte';
	import ConfirmSheet from '$lib/components/chrome/ConfirmSheet.svelte';
	import { count } from '$lib/library/downloads';
	import { extFilterParams } from '$lib/library/ext-filters';
	import { extensionsFrom, keepOrigin } from '$lib/library/tag-search';
	import ExtFilter from './ExtFilter.svelte';
	import { ago } from '$lib/library/tracking';
	import { isSearchCommand, runSearchCommand } from '$lib/library/commands';
	import ExtRow from './ExtRow.svelte';
	import SelectBand from './SelectBand.svelte';
	import { SvelteSet } from 'svelte/reactivity';
	import { untrack } from 'svelte';
	import { registerBack } from '$lib/focus';

	/**
	 * EXTENSIONS (Index-Extensions; Browse Calls, "Extension states in words,
	 * no new colour", "Updates ask, and can be taken back", "Removing says
	 * what stays", "No repository ships"). INSTALLED sorts what needs a hand
	 * first, then UPDATES with UPDATE ALL, then the rest; AVAILABLE is every
	 * repository's listings, in the owner's languages unless ALL; REPOSITORIES
	 * adds one by its address, after saying what it holds.
	 */
	/** REPOSITORIES' "?" sheet (doc/HELP.md). */
	let helpOpen = $state(false);
	let { data, form } = $props();

	/**
	 * The bar's leading `/` runs a command, as the library's does (c697): the
	 * list keeps filtering for anything else. A refusal is the bar's to show,
	 * and the list stays as it was.
	 */
	let commandNote = $state('');
	async function onSearch(e: SubmitEvent) {
		const text = String(new FormData(e.currentTarget as HTMLFormElement).get('q') ?? '');
		if (!isSearchCommand(text)) return;
		e.preventDefault();
		const outcome = await runSearchCommand(text);
		commandNote = outcome.type === 'refused' ? outcome.message : '';
	}

	const base = resolve('/browse/extensions');
	function link(over: Record<string, string | null>): string {
		// eslint-disable-next-line svelte/prefer-svelte-reactivity -- a throwaway copy, never read reactively
		const p = new URLSearchParams(page.url.searchParams);
		for (const [k, v] of Object.entries(over)) {
			if (v === null) p.delete(k);
			else p.set(k, v);
		}
		const s = p.toString();
		return s ? `${base}?${s}` : base;
	}
	const icon = (pkg: string) => resolve('/api/browse/icon/[pkg]', { pkg });
	const hue = (s: string) => [...s].reduce((a, c) => (a * 31 + c.charCodeAt(0)) % 360, 0);
	const plural = (n: number, w: string) => `${count(n)} ${w}${n === 1 ? '' : 'S'}`;
	const langs = (ls: string[]) => [...new Set(ls.map((l) => l.toUpperCase()))].join(', ');
	const hereLine = (series: number, hidden: number) =>
		series === 0
			? ''
			: hidden === 0
				? `${count(series)} SERIES HERE`
				: hidden === series
					? `${count(series)} SERIES HERE, ALL HIDDEN`
					: `${count(series)} SERIES HERE, ${count(hidden)} HIDDEN`;

	/**
	 * The sources BROWSE lists of an installed extension (the owner's
	 * languages, and any the library reads from): MangaDex is "2 OF 61
	 * SOURCES SHOWN", and its languages EN, JA, not sixty-one.
	 */
	const listed = (shown: { lang: string; series: number }[]) =>
		shown.filter(
			(s) =>
				data.languages.includes(s.lang.toLowerCase()) ||
				['all', 'multi'].includes(s.lang) ||
				s.series > 0
		);
	const sourcesLine = (shown: { lang: string; series: number }[], total: number) => {
		const n = listed(shown).length;
		return n < total ? `${count(n)} OF ${plural(total, 'SOURCE')} SHOWN` : plural(total, 'SOURCE');
	};

	/** The form result for this package, if the last action was about it. */
	const about = (pkg: string) => (form && 'pkg' in form && form.pkg === pkg ? form : null);
	/**
	 * The answer the band's ✕ cleared (c493): only that answer, so the next
	 * action's new `form` draws its own band.
	 */
	let droppedAnswer = $state.raw<typeof form>(null);
	const latest = $derived(form === droppedAnswer ? null : form);
	const dropAnswer = () => (droppedAnswer = form);
	const refusal = $derived(
		latest && 'message' in latest && typeof latest.message === 'string' ? latest : null
	);
	/** An install refused for its signature: both keys, side by side. */
	const untrustedKeys = $derived(
		form && 'signers' in form && Array.isArray(form.signers)
			? {
					signers: form.signers as string[],
					expected: 'expected' in form ? String(form.expected) : ''
				}
			: null
	);

	/** Which package's button is working, for INSTALLING / UPDATING. */
	let busy = $state('');
	const working = (pkg: string) => () => {
		busy = pkg;
		return async ({ update }: { update: (o?: { reset?: boolean }) => Promise<void> }) => {
			await update({ reset: false });
			busy = '';
		};
	};
	let checking = $state(false);

	// ---- SELECT (card c696; doc/handoffs/extensions-select) ---------------------
	/**
	 * The four switches of a source's 01 — IN TSUNDOKU, in their order, named as
	 * that page names them. SELECT changes every source of a ticked extension,
	 * so a row here is a package and a mixed cell is counted in extensions.
	 */
	const SWITCHES = [
		{ flag: 'hidden', name: 'HIDDEN' },
		{ flag: 'addedHidden', name: 'ADDED HIDDEN' },
		{ flag: 'offHistory', name: 'OFF HISTORY' },
		{ flag: 'neverTracked', name: 'NEVER TRACKED' }
	] as const;
	type SwitchKey = (typeof SWITCHES)[number]['flag'];

	/** Selecting is the URL (`?select=1`), so a reload and a no-script press keep it. */
	const selecting = $derived(data.select);
	/**
	 * What is ticked. The URL carries it when the server answered a no-script
	 * press (`?pkg=` per row); with script a tap only moves this set, so the
	 * list is not read again per tick. A package that leaves the list (HIDE
	 * outside reveal, REMOVE, gone on another device) leaves the selection.
	 */
	let selected = new SvelteSet<string>(untrack(() => data.selected));
	$effect(() => {
		const drawn = new Set(data.drawn);
		for (const pkg of [...selected]) if (!drawn.has(pkg)) selected.delete(pkg);
	});
	// UPDATE or REMOVE succeeded and ended SELECT: the next one starts empty, as
	// ✕'s would (the redirect left the URL without the ticks).
	$effect(() => {
		if (!data.select && selected.size > 0) selected.clear();
	});

	function toggleSelection(pkg: string) {
		if (selected.has(pkg)) selected.delete(pkg);
		else selected.add(pkg);
	}
	function selectAll() {
		// Every ticked row is drawn: INSTALLED is one page, so reveal decides what it takes.
		for (const pkg of data.drawn) selected.add(pkg);
	}
	const sectionPkgs = (s: { rows: { pkg: string }[]; plugins: { id: string }[] }) => [
		...s.rows.map((r) => r.pkg),
		...s.plugins.map((p) => `ln:${p.id}`)
	];
	/** TICK n, or UNTICK n once every row of its section is ticked. */
	function toggleSection(pkgs: string[]) {
		const all = pkgs.every((p) => selected.has(p));
		for (const pkg of pkgs) {
			if (all) selected.delete(pkg);
			else selected.add(pkg);
		}
	}
	/** The same press as a link, so it works before the page hydrates. */
	function sectionHref(pkgs: string[]): string {
		const all = pkgs.every((p) => selected.has(p));
		return selectHref(
			all ? [...selected].filter((p) => !pkgs.includes(p)) : [...new Set([...selected, ...pkgs])]
		);
	}
	/** A SELECT address: the state, the ticked rows, then whatever the link adds. */
	function selectHref(pkgs: readonly string[], extra: Record<string, string | null> = {}): string {
		// eslint-disable-next-line svelte/prefer-svelte-reactivity -- a throwaway copy, never read reactively
		const p = new URLSearchParams({ select: '1' });
		for (const pkg of pkgs) p.append('pkg', pkg);
		for (const [k, v] of Object.entries(extra)) {
			if (v === null) p.delete(k);
			else p.set(k, v);
		}
		return `${base}?${p.toString()}`;
	}
	function stopSelecting() {
		selected.clear();
		// eslint-disable-next-line svelte/no-navigation-without-resolve -- link() builds it from base, the resolved path
		void goto(link({ select: null, pkg: null, removeSel: null }), {
			replaceState: true,
			noScroll: true,
			keepFocus: true
		});
	}
	// The bar's cells post the form the rows are: one press, every ticked row's
	// sources. The action name and its own fields travel in the button's
	// formaction, so one form carries all of them and each works without script.
	const flagHref = (flag: SwitchKey, on: boolean) =>
		selectHref([...selected], { '/flags': '', flag, value: on ? 'true' : 'false' });
	const updateHref = () => selectHref([...selected], { '/updateSome': '' });

	/** A switch's state across the selection: on, off, or MIXED, counted in extensions. */
	function cellFor(flag: SwitchKey) {
		const total = selected.size;
		let on = 0;
		let off = 0;
		let part = 0;
		let known = 0;
		for (const pkg of selected) {
			const f = data.packageFlags[pkg];
			if (!f || f.total === 0) continue;
			known++;
			const n = f.on[flag];
			if (n >= f.total) on++;
			else if (n === 0) off++;
			else part++;
		}
		const state = known === 0 ? 'off' : on === known ? 'on' : off === known ? 'off' : 'mixed';
		return { state: state as 'on' | 'off' | 'mixed', total, on, off, part, known };
	}
	/** The cell's second line: what the next press does, always (`Main` 03's slip fixed). */
	function cellNote(c: ReturnType<typeof cellFor>, flag: SwitchKey): string {
		if (c.known === 0) return 'SOURCES NOT KNOWN';
		const extra = c.total > c.known ? ` · ${c.total - c.known} NOT KNOWN` : '';
		if (c.state === 'on')
			return `${c.known} OF ${c.total} · TAP: ${flag === 'hidden' ? 'SHOW ALL' : 'ALL OFF'}${extra}`;
		const head =
			c.state === 'mixed'
				? `MIXED · ${c.on} OF ${c.total}${c.part ? ` · ${c.part} PART` : ''}`
				: `0 OF ${c.total}`;
		return `${head} · TAP: ALL ON${extra}`;
	}
	/** A row's read-only line in SELECT: its switches, or its split ones by source. */
	function switchesOf(pkg: string): string {
		const f = data.packageFlags[pkg];
		if (!f || f.total === 0) return "ITS SOURCES AREN'T KNOWN";
		const parts = SWITCHES
			// Hidden means hidden: outside reveal a hidden source is not hinted at.
			.filter((s) => s.flag !== 'hidden' || data.reveal)
			.map((s) => {
				const on = f.on[s.flag] ?? 0;
				if (on === 0) return '';
				if (on === f.total) return s.name;
				return `${s.name} ${on} OF ${f.total} SOURCES`;
			})
			.filter(Boolean);
		return parts.length ? parts.join(' · ') : 'NO SWITCHES ON';
	}
	/** The drawn rows' names, for a band that names a failed update. */
	const names = $derived.by(() => {
		const out: Record<string, string> = {};
		const v = data.installed;
		const pv = data.plugins;
		if (v) for (const r of [...v.needsHand, ...v.updates, ...v.current]) out[r.pkg] = r.name;
		if (pv)
			for (const p of [...pv.needsHand, ...pv.updates, ...pv.current]) out[`ln:${p.id}`] = p.name;
		return out;
	});
	const updateCount = $derived([...selected].filter((p) => data.updates.includes(p)).length);
	const removableCount = $derived([...selected].filter((p) => !data.obsolete.includes(p)).length);

	/** Escape while a tick has the focus: an `input` keeps Escape from the layer, so the form ends SELECT itself. */
	function selectKey(e: KeyboardEvent) {
		if (!selecting || e.key !== 'Escape' || data.removingSome) return;
		e.preventDefault();
		stopSelecting();
	}

	// BACK takes SELECT back down before it leaves the screen; with REMOVE's
	// sheet open the sheet closes first (it is a scope, and this step declines).
	$effect(() =>
		registerBack(() => {
			if (!selecting || data.removingSome) return false;
			stopSelecting();
			return true;
		})
	);
</script>

<svelte:head><title>extensions · tsundoku</title></svelte:head>

<!-- Escape from a focused tick: an `input` keeps it from the layer (doc/FOCUS.md). -->
<svelte:window onkeydown={selectKey} />

<!-- eslint-disable svelte/no-navigation-without-resolve -- every href below is built from resolve(), by base, link() or icon() -->

<div class="screen" class:selecting>
	{#if selecting}
		<!-- SELECT's bar (Ext-Bulk Main; tablet and phone boards): ✕, the count, SELECT ALL. -->
		<TopBar inverse sticky label="Selection">
			{#snippet left()}
				<a
					class="cell x"
					href={base}
					aria-label="Stop selecting"
					data-focus-mark="in"
					onclick={(e) => {
						e.preventDefault();
						stopSelecting();
					}}>✕<span class="esc">ESC</span></a
				>
			{/snippet}
			{#snippet middle()}
				<div class="cell count" aria-live="polite">{selected.size} SELECTED</div>
			{/snippet}
			{#snippet right()}
				<button
					type="button"
					class="cell all"
					aria-label="SELECT ALL"
					data-focus-mark="in"
					onclick={selectAll}
					><span class="all-long">SELECT ALL</span><span class="all-short">ALL</span></button
				>
			{/snippet}
		</TopBar>
	{:else}
		<TopBar sticky label="EXTENSIONS">
			{#snippet middle()}
				<a class="cell back" href={resolve('/browse')} aria-label="Back to BROWSE">←</a>
				<span class="cell title"
					><span class="name">EXTENSIONS</span><span class="sub">BROWSE</span></span
				>
				<!-- SELECT: INSTALLED's, a cell between the title and CHECK NOW (c696). Not on a TV. -->
				{#if data.tab === 'installed'}
					<a
						class="cell sel"
						href={link({ select: '1', pkg: null, removeSel: null })}
						data-focus-mark="in">SELECT</a
					>
				{/if}
				<form
					method="POST"
					action="{base}?/check"
					class="cell check"
					use:enhance={() => {
						checking = true;
						return async ({ update }) => {
							await update({ reset: false });
							checking = false;
						};
					}}
				>
					<span class="top"
						>{data.checkedAt ? `CHECKED ${ago(data.checkedAt, data.now)}` : 'NEVER CHECKED'}</span
					>
					<button type="submit" disabled={checking || data.counts.repos === 0}
						>{checking ? 'CHECKING…' : 'CHECK NOW'}</button
					>
				</form>
			{/snippet}
		</TopBar>
	{/if}

	{#if commandNote}<Band title={commandNote} ondismiss={() => (commandNote = '')} />{/if}

	<!-- The way back to GET STARTED, while step 01's or 02's trip lasts (doc/ONBOARDING.md). -->
	<StartTrail start={data.start} />

	<nav class="tabs" aria-label="Extensions">
		<a class="tab" class:on={data.tab === 'installed'} href={base}
			>INSTALLED <span class="n">{data.counts.installed}</span></a
		>
		{#if selecting}
			<!-- Leaving the tab would drop the selection without a word: dimmed and inert. -->
			<span class="tab off" aria-disabled="true"
				>AVAILABLE <span class="n"
					>{count(data.availableCounts.manga + data.availableCounts.anime)}</span
				></span
			>
			<span class="tab off" aria-disabled="true"
				>REPOSITORIES <span class="n">{data.counts.repos}</span></span
			>
		{:else}
			<a class="tab" class:on={data.tab === 'available'} href="{base}?tab=available"
				>AVAILABLE <span class="n"
					>{count(data.availableCounts.manga + data.availableCounts.anime)}</span
				></a
			>
			<a class="tab" class:on={data.tab === 'repos'} href="{base}?tab=repos"
				>REPOSITORIES <span class="n">{data.counts.repos}</span></a
			>
		{/if}
	</nav>

	<!-- SELECT's band, under the tabs (Results); one at a time, its URL. -->
	{#if !refusal}
		<SelectBand
			{base}
			flags={data.band}
			update={data.updateBand}
			remove={data.removeBand}
			back={data.backBand}
			selection={[...selected]}
			{names}
		/>
	{/if}

	{#if untrustedKeys}
		<!-- Never installed by a tap: the key it was signed with beside the one its repository lists. -->
		<div class="untrusted" role="alert">
			<div class="u-t">UNTRUSTED · NOTHING WAS INSTALLED</div>
			<div class="u-k">
				<span>SIGNED WITH</span><code
					>{untrustedKeys.signers.length ? untrustedKeys.signers.join(', ') : 'NO KEY'}</code
				>
			</div>
			<div class="u-k"><span>ITS REPOSITORY LISTS</span><code>{untrustedKeys.expected}</code></div>
		</div>
	{:else if refusal}
		<Band
			title={String(refusal.message).toUpperCase().slice(0, 160)}
			detail="NOTHING CHANGED"
			ondismiss={dropAnswer}
		/>
	{/if}

	{#if data.counts.repos === 0 && data.tab !== 'repos'}
		<div class="empty">
			<div class="lab">00 — NO REPOSITORIES YET</div>
			<p>
				Extensions come from repositories, and tsundoku ships none. Add one in REPOSITORIES: it says
				what it holds before anything is installed.
			</p>
			<a class="cta" href="{base}?tab=repos">REPOSITORIES →</a>
		</div>
	{/if}

	{#if data.installed}
		{@const v = data.installed}
		{#snippet installedRow(
			r: (typeof v.current)[number],
			section: 'hand' | 'updates' | 'current',
			selectMode: boolean
		)}
			{@const res = about(r.pkg)}
			{@const missed = data.band
				? data.band.gone.includes(r.pkg)
					? 'gone'
					: data.band.miss.includes(r.pkg)
						? 'miss'
						: null
				: null}
			<!-- The settings' ← comes back to this list, this tab and filter (card c727). -->
			{@const settings = r.shown[0]
				? keepOrigin(
						resolve('/browse/[source]/settings', { source: r.shown[0].id }),
						extensionsFrom(page.url)
					)
				: null}
			<ExtRow
				name={r.name}
				pkg={r.pkg}
				icon={icon(r.pkg)}
				hue={hue(r.pkg)}
				adult={r.adult}
				hidden={r.mostlyHidden}
				rule={section === 'hand' || !!missed}
				selecting={selectMode}
				selected={selected.has(r.pkg)}
				switches={selectMode ? switchesOf(r.pkg) : ''}
				ontoggle={() => toggleSelection(r.pkg)}
				state={missed
					? missed === 'gone'
						? 'NOT CHANGED · NO LONGER INSTALLED'
						: "NOT CHANGED · FAILED TO LOAD, SO ITS SOURCES AREN'T KNOWN"
					: busy === r.pkg
						? 'UPDATING'
						: r.failed
							? `FAILED TO LOAD · ${r.failed.toUpperCase().slice(0, 40)}`
							: r.obsolete
								? 'OBSOLETE'
								: ''}
				sub={r.obsolete && !r.failed
					? " · GONE FROM ITS REPOSITORY · STILL LOADS, WON'T UPDATE"
					: [
							(r.failed || busy === r.pkg) && '',
							sourcesLine(r.shown, r.sources.length),
							hereLine(r.series, r.hidden),
							res && 'done' in res ? 'DONE' : ''
						]
							.filter((x) => x !== false && x !== '')
							.join(' · ')
							.replace(/^/, r.failed || busy === r.pkg ? ' · ' : '')}
				kind="{r.kind.toUpperCase()} · {langs(
					(listed(r.shown).length ? listed(r.shown) : r.sources).map((s) => s.lang)
				) || '—'}"
				version={r.update ? `${r.versionName} → ${r.update}` : r.versionName}
				versionInk={!!r.update}
			>
				{#snippet actions()}
					{#if r.failed}
						<form method="POST" action="{base}?/retry" use:enhance={working(r.pkg)}>
							<input type="hidden" name="pkg" value={r.pkg} />
							<button class="act" disabled={busy === r.pkg}>TRY AGAIN</button>
						</form>
					{:else if r.backTo}
						<form method="POST" action="{base}?/back" use:enhance={working(r.pkg)}>
							<input type="hidden" name="pkg" value={r.pkg} />
							<button class="act">BACK TO {r.backTo}</button>
						</form>
					{:else if settings}
						<a class="act" href={settings}>SETTINGS</a>
					{:else}
						<span class="act muted"></span>
					{/if}
					{#if section === 'updates'}
						<form method="POST" action="{base}?/update" use:enhance={working(r.pkg)}>
							<input type="hidden" name="pkg" value={r.pkg} />
							<button class="act ink" disabled={!!busy}
								>{busy === r.pkg ? 'UPDATING…' : 'UPDATE'}</button
							>
						</form>
					{:else}
						<a class="act" href={link({ remove: r.pkg })} data-sveltekit-noscroll>REMOVE…</a>
					{/if}
				{/snippet}
			</ExtRow>
		{/snippet}

		{@const pv = data.plugins ?? { needsHand: [], updates: [], current: [] }}
		{#snippet pluginRow(
			p: (typeof pv.current)[number],
			section: 'hand' | 'updates' | 'current',
			selectMode: boolean
		)}
			{@const key = `ln:${p.id}`}
			{@const missed = data.band
				? data.band.gone.includes(key)
					? 'gone'
					: data.band.miss.includes(key)
						? 'miss'
						: null
				: null}
			<ExtRow
				name={p.name}
				pkg={key}
				icon={icon(key)}
				hue={hue(key)}
				rule={section === 'hand' || !!missed}
				selecting={selectMode}
				selected={selected.has(key)}
				switches={selectMode ? switchesOf(key) : ''}
				ontoggle={() => toggleSelection(key)}
				state={missed
					? missed === 'gone'
						? 'NOT CHANGED · NO LONGER INSTALLED'
						: "NOT CHANGED · FAILED TO LOAD, SO ITS SOURCES AREN'T KNOWN"
					: busy === key
						? 'UPDATING'
						: p.failed
							? `FAILED TO LOAD · ${p.failed.toUpperCase().slice(0, 40)}`
							: p.obsolete
								? 'OBSOLETE'
								: ''}
				sub={p.obsolete && !p.failed
					? " · GONE FROM ITS REPOSITORY · STILL LOADS, WON'T UPDATE"
					: `${p.failed || busy === key ? ' · ' : ''}1 SOURCE${p.series ? ` · ${hereLine(p.series, p.hidden)}` : ''}`}
				kind="NOVELS · {p.lang.toUpperCase() || '—'}"
				version={p.update ? `${p.version} → ${p.update}` : p.version}
				versionInk={!!p.update}
			>
				{#snippet actions()}
					{#if p.failed}
						<form method="POST" action="{base}?/retry" use:enhance={working(key)}>
							<input type="hidden" name="pkg" value={key} />
							<button class="act" disabled={busy === key}>TRY AGAIN</button>
						</form>
					{:else if p.backTo}
						<form method="POST" action="{base}?/back" use:enhance={working(key)}>
							<input type="hidden" name="pkg" value={key} />
							<button class="act">BACK TO {p.backTo}</button>
						</form>
					{:else}
						<span class="act muted"></span>
					{/if}
					{#if section === 'updates'}
						<form method="POST" action="{base}?/update" use:enhance={working(key)}>
							<input type="hidden" name="pkg" value={key} />
							<button class="act ink" disabled={!!busy}
								>{busy === key ? 'UPDATING…' : 'UPDATE'}</button
							>
						</form>
					{:else}
						<a class="act" href={link({ remove: key })} data-sveltekit-noscroll>REMOVE…</a>
					{/if}
				{/snippet}
			</ExtRow>
		{/snippet}
		{@const sections = [
			{ key: 'hand' as const, title: 'NEEDS A HAND', rows: v.needsHand, plugins: pv.needsHand },
			{ key: 'updates' as const, title: 'UPDATES', rows: v.updates, plugins: pv.updates },
			{ key: 'current' as const, title: 'INSTALLED', rows: v.current, plugins: pv.current }
		]
			.map((s) => ({ ...s, n: s.rows.length + s.plugins.length }))
			.filter((s) => s.n > 0)}
		{#snippet list(selectMode: boolean)}
			{#each sections as s, i (s.key)}
				{@const pkgs = sectionPkgs(s)}
				{@const all = pkgs.length > 0 && pkgs.every((p) => selected.has(p))}
				<div class="label" class:first={i === 0}>
					<span class="l">{String(i + 1).padStart(2, '0')} — {s.title}</span>
					<span class="r">
						<span class="r-t"
							>{s.n}{s.key === 'updates'
								? ' · NOTHING UPDATES BY ITSELF'
								: s.key === 'current'
									? ' · UP TO DATE'
									: ''}</span
						>
						{#if selectMode}
							<!-- UPDATE ALL gives way to TICK n (Main 01): the quick way to a section. -->
							<a
								class="btn"
								href={sectionHref(pkgs)}
								onclick={(e) => {
									e.preventDefault();
									toggleSection(pkgs);
								}}>{all ? 'UNTICK' : 'TICK'} {s.n}</a
							>
						{:else if s.key === 'updates'}
							<form method="POST" action="{base}?/updateAll" use:enhance={working('*')}>
								<button class="all" disabled={!!busy}
									>{busy === '*' ? 'UPDATING…' : `UPDATE ALL ${s.n}`}</button
								>
							</form>
						{/if}
					</span>
				</div>
				{#if i === 0}
					<div class="cols" aria-hidden="true">
						<span class="c0">NAME · SOURCES</span><span class="c1">KIND · LANGUAGE</span><span
							class="c2">VERSION</span
						><span class="c3">{selectMode ? 'SWITCHES' : ''}</span>
					</div>
				{/if}
				<div class="rows" class:bt={i > 0}>
					{#each s.rows as r (r.pkg)}{@render installedRow(r, s.key, selectMode)}{/each}
					{#each s.plugins as p (p.id)}{@render pluginRow(p, s.key, selectMode)}{/each}
				</div>
			{/each}
		{/snippet}
		{#if selecting}
			<!-- One form: every ticked row's `pkg`, and each bar cell its own action. -->
			<form method="POST" action="{base}?/flags" class="selform" use:enhance>
				{@render list(true)}
				<div class="bulk" role="toolbar" aria-label="Selection actions">
					<div class="swr">
						{#each SWITCHES as sw (sw.flag)}
							{@const c = cellFor(sw.flag)}
							{#if sw.flag === 'hidden' && !data.reveal}
								<!-- Outside reveal HIDE is an action, not a switch: a count would
								     hint that hidden sources exist, and hidden means hidden. -->
								<button
									type="submit"
									class="swc"
									formaction={flagHref('hidden', true)}
									disabled={c.known === 0}
								>
									<span class="w"
										><span class="k">HIDE</span><span class="n">THEY LEAVE THE LIST</span></span
									>
								</button>
							{:else}
								<button
									type="submit"
									class="swc"
									formaction={flagHref(sw.flag, c.state !== 'on')}
									role="switch"
									aria-checked={c.state === 'mixed' ? 'mixed' : c.state === 'on'}
									disabled={c.known === 0}
								>
									<span class="w"
										><span class="k">{sw.name}</span><span class="n">{cellNote(c, sw.flag)}</span
										></span
									>
									<span class="trk" class:on={c.state === 'on'} class:mix={c.state === 'mixed'}
										><i></i></span
									>
								</button>
							{/if}
						{/each}
						<button
							type="submit"
							class="swc go"
							formaction={updateHref()}
							disabled={updateCount === 0}
						>
							<span class="w"
								><span class="k">UPDATE {updateCount}</span><span class="n">OF {selected.size}</span
								></span
							>
						</button>
						{#if removableCount}
							<a class="swc go solo" href={selectHref([...selected], { removeSel: '1' })}
								>REMOVE {removableCount}…</a
							>
						{:else}
							<span class="swc go solo dis" aria-disabled="true"
								><span class="w"
									><span class="k">REMOVE</span><span class="n">NOTHING MAY GO</span></span
								></span
							>
						{/if}
					</div>
				</div>
			</form>
		{:else}
			{@render list(false)}
		{/if}
	{/if}

	{#if data.available}
		{@const a = data.available}
		<nav class="tabs kinds" aria-label="Kinds">
			<a class="tab" class:on={a.family === 'mihon'} href={link({ kind: null, n: null })}
				>MANGA <span class="n">{count(a.counts.manga)}</span></a
			>
			<a class="tab" class:on={a.family === 'aniyomi'} href={link({ kind: 'anime', n: null })}
				>ANIME <span class="n">{count(a.counts.anime)}</span></a
			>
			<a class="tab" class:on={a.family === 'lnreader'} href={link({ kind: 'novels', n: null })}
				>NOVELS <span class="n">{count(data.availableCounts.novels)}</span></a
			>
		</nav>
		{@const nv = data.novelsAvailable}
		<form method="GET" action={base} class="filter" onsubmit={onSearch}>
			<input type="hidden" name="tab" value="available" />
			{#if a.family !== 'mihon'}<input type="hidden" name="kind" value={a.kind} />{/if}
			<input
				class="find"
				type="search"
				name="q"
				value={page.url.searchParams.get('q') ?? ''}
				placeholder="/ search {count(
					a.family === 'lnreader'
						? data.availableCounts.novels
						: a.family === 'mihon'
							? a.counts.manga
							: a.counts.anime
				)}"
				aria-label="Search the available extensions"
				autocomplete="off"
			/>
			<ExtFilter
				filters={data.filters}
				mine={data.languages}
				languages={nv ? nv.languages : a.languages}
				repos={a.family === 'lnreader' ? data.filterRepos.novels : data.filterRepos.engine}
				novels={a.family === 'lnreader'}
				title="{a.kind === 'novels' ? 'NOVEL' : a.kind.toUpperCase()} EXTENSIONS"
				count="{count(nv ? nv.rows.length : a.rows.length)} FOUND"
				href={(f) => link({ ...extFilterParams(f), all: null, n: null })}
			/>
		</form>
		{@const shown = Number(page.url.searchParams.get('n')) || 150}
		{@const found = nv ? nv.rows.length : a.rows.length}
		{@const others = nv ? nv.otherLanguages : a.otherLanguages}
		<div class="label first">
			<span class="l"
				>01 — {count(found)} FOUND{(nv ? nv.asked : a.asked).length
					? ` · ${(nv ? nv.asked : a.asked).map((l) => l.toUpperCase()).join(', ')}`
					: ' · EVERY LANGUAGE'}</span
			>
			{#if others > 0}
				<a class="r more" href={link({ lang: '', all: null, n: null })}
					>+ {count(others)} IN OTHER LANGUAGES · SHOW</a
				>
			{/if}
		</div>
		<div class="cols" aria-hidden="true">
			<span class="c0">NAME</span><span class="c1">KIND · LANGUAGE</span><span class="c2"
				>VERSION</span
			><span class="c3"></span>
		</div>
		<div class="rows">
			{#each nv ? nv.rows.slice(0, shown) : [] as l (l.id)}
				{@const key = `ln:${l.id}`}
				<ExtRow
					name={l.name}
					icon={icon(key)}
					hue={hue(key)}
					quiet={l.installed}
					state={busy === key ? 'INSTALLING' : l.installed ? 'INSTALLED' : ''}
					sub={l.installed || busy === key ? '' : '1 SOURCE'}
					kind="NOVELS · {l.lang.toUpperCase() || '—'}"
					version={l.version}
				>
					{#snippet actions()}
						<span class="act muted"></span>
						{#if l.installed}
							<span class="act muted">INSTALLED ✓</span>
						{:else}
							<form method="POST" action="{base}?/install" use:enhance={working(key)}>
								<input type="hidden" name="pkg" value={key} />
								<button class="act accent" disabled={!!busy}
									>{busy === key ? 'INSTALLING…' : 'INSTALL'}</button
								>
							</form>
						{/if}
					{/snippet}
				</ExtRow>
			{/each}
			{#each nv ? [] : a.rows.slice(0, shown) as r (r.pkg)}
				{@const res = about(r.pkg)}
				{@const untrusted = !!(res && 'untrusted' in res && res.untrusted)}
				<ExtRow
					name={r.name}
					icon={icon(r.pkg)}
					hue={hue(r.pkg)}
					adult={r.adult}
					hidden={r.mostlyHidden}
					rule={untrusted}
					quiet={r.installed}
					state={busy === r.pkg
						? 'INSTALLING'
						: untrusted
							? 'UNTRUSTED'
							: r.installed
								? 'INSTALLED'
								: ''}
					sub={untrusted
						? " · SIGNED WITH A KEY ITS REPOSITORY DOESN'T LIST"
						: r.installed || busy === r.pkg
							? hereLine(r.series, r.hidden)
								? ` · ${hereLine(r.series, r.hidden)}`
								: ''
							: plural(r.sourcesShown, 'SOURCE')}
					kind="{r.kind.toUpperCase()} · {langs(
						r.sources
							.map((s) => s.lang)
							.filter(
								(l) =>
									a.asked.length === 0 ||
									a.asked.includes(l.toLowerCase()) ||
									['all', 'multi'].includes(l)
							)
					) ||
						langs(r.sources.map((s) => s.lang)) ||
						'—'}"
					version={r.versionName}
				>
					{#snippet actions()}
						<span class="act muted"></span>
						{#if r.installed}
							<span class="act muted">INSTALLED ✓</span>
						{:else if untrusted}
							<span class="act muted">NOT INSTALLED</span>
						{:else}
							<form method="POST" action="{base}?/install" use:enhance={working(r.pkg)}>
								<input type="hidden" name="pkg" value={r.pkg} />
								<button class="act accent" disabled={!!busy}
									>{busy === r.pkg ? 'INSTALLING…' : 'INSTALL'}</button
								>
							</form>
						{/if}
					{/snippet}
				</ExtRow>
			{/each}
		</div>
		{#if found > shown}
			<div class="more-row">
				<span>{count(shown)} OF {count(found)}</span>
				<a href={link({ n: String(shown + 150) })} data-sveltekit-noscroll>MORE ↓</a>
			</div>
		{/if}
		<p class="prose">
			{#if data.reveal}
				Inside reveal the mostly-hidden sources' extensions are listed too, with HIDDEN on their
				icons. Ending reveal takes them out of the list and its counts.
			{:else}
				LANGUAGE starts from SETTINGS ({data.languages.map((l) => l.toUpperCase()).join(', ')});
				FILTER changes it for this visit only. 18+ marks an extension its repository flags as adult.
				An untrusted extension is never installed: the key it was signed with is shown beside the
				one its repository lists.
			{/if}
		</p>
	{/if}

	{#if data.repos}
		<div class="label first">
			<!-- The "?" after the section's name (doc/HELP.md): 03, at EXTENSIONS AND REPOSITORIES. -->
			<button
				type="button"
				class="l ask"
				aria-label="Help: repositories"
				aria-expanded={helpOpen}
				onclick={() => (helpOpen = true)}>01 — ADD A REPOSITORY<HelpMark /></button
			><span class="r">PASTE ITS ADDRESS</span>
		</div>
		<form method="GET" action={base} class="field">
			<input type="hidden" name="tab" value="repos" />
			<input
				name="add"
				value={data.address}
				placeholder="https://…/index.min.json"
				aria-label="A repository’s address"
				autocomplete="off"
				inputmode="url"
			/>
			{#if data.address}
				<a class="f-btn" href="{base}?tab=repos" aria-label="Clear">✕</a>
			{:else}
				<button class="f-btn">ASK</button>
			{/if}
		</form>
		{#if data.preview && 'error' in data.preview}
			<div class="found rule">
				<div class="f-text">
					<div class="f-a">NOT A REPOSITORY</div>
					<div class="f-b">
						{data.preview.error.toUpperCase().slice(0, 160)} · A REPOSITORY'S ADDRESS ENDS IN index.min.json
						(MIHON, ANIYOMI) OR plugins.min.json (LNREADER), AND IS OFTEN LINKED FROM A WEB PAGE.
					</div>
				</div>
			</div>
		{:else if data.preview}
			{@const p = data.preview}
			<form method="POST" action="{base}?/addRepo" class="found" use:enhance>
				<input type="hidden" name="address" value={p.base} />
				<div class="f-text">
					<div class="f-a">
						FOUND · {p.name} · {[
							p.manga && plural(p.manga, 'MANGA EXTENSION'),
							p.anime && plural(p.anime, 'ANIME EXTENSION'),
							p.novels && plural(p.novels, 'NOVEL PLUGIN')
						]
							.filter(Boolean)
							.join(', ') || 'NOTHING LISTED'}
					</div>
					<div class="f-b">
						{p.novels
							? 'NOTHING IS INSTALLED UNTIL YOU PICK ONE · LNREADER SIGNS NOTHING: EACH PLUGIN IS PINNED BY ITS HASH WHEN INSTALLED'
							: 'NOTHING IS INSTALLED UNTIL YOU PICK ONE · ITS SIGNING KEY IS KEPT TO CHECK EVERY INSTALL'}
					</div>
				</div>
				<button class="f-add">ADD {p.name}</button>
			</form>
		{/if}

		<div class="label">
			<span class="l">02 — REPOSITORIES</span>
			<span class="r"
				>{data.repos.length + (data.novelRepos?.length ?? 0)}{data.checkedAt
					? ` · CHECKED ${ago(data.checkedAt, data.now)}`
					: ''}</span
			>
		</div>
		{#if data.repos.length + (data.novelRepos?.length ?? 0)}
			<div class="cols" aria-hidden="true">
				<span class="c0">NAME · ADDRESS</span><span class="c1">KIND</span><span class="c2"
					>HOLDS</span
				><span class="c3"></span>
			</div>
		{/if}
		<div class="rows">
			{#each data.repos as r (r.id)}
				{@const kinds = [r.counts.manga && 'MANGA', r.counts.anime && 'ANIME'].filter(Boolean)}
				<ExtRow
					name={r.name}
					icon={null}
					rule={!!r.failedAt}
					state={r.failedAt ? 'STOPPED ANSWERING' : ''}
					sub={r.failedAt
						? ` · SINCE ${new Date(r.failedAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }).toUpperCase()} · ${r.installed ? `${plural(r.installed, 'EXTENSION')} INSTALLED FROM IT KEEP RUNNING, WITHOUT UPDATES` : 'NOTHING INSTALLED FROM IT'}`
						: r.base.replace(/^https?:\/\//, '')}
					kind={kinds.join(', ') || '—'}
					version={r.failedAt
						? 'NOT REACHED'
						: plural(r.counts.manga + r.counts.anime, 'EXTENSION')}
				>
					{#snippet actions()}
						<span class="act muted">{r.installed ? `${r.installed} INSTALLED` : ''}</span>
						{#if r.installed}
							<a class="act" href={link({ removeRepo: String(r.id) })} data-sveltekit-noscroll
								>REMOVE…</a
							>
						{:else}
							<form method="POST" action="{base}?/removeRepo" use:enhance>
								<input type="hidden" name="id" value={r.id} />
								<button class="act">REMOVE</button>
							</form>
						{/if}
					{/snippet}
				</ExtRow>
			{/each}
			{#each data.novelRepos ?? [] as r (r.id)}
				<ExtRow
					name={r.name}
					icon={null}
					rule={!!r.failedAt}
					state={r.failedAt ? 'STOPPED ANSWERING' : ''}
					sub={r.failedAt
						? ` · SINCE ${new Date(r.failedAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }).toUpperCase()} · ${r.installed ? `${plural(r.installed, 'PLUGIN')} INSTALLED FROM IT KEEP RUNNING, WITHOUT UPDATES` : 'NOTHING INSTALLED FROM IT'}`
						: r.url.replace(/^https?:\/\//, '')}
					kind="NOVELS"
					version={r.failedAt ? 'NOT REACHED' : plural(r.plugins, 'PLUGIN')}
				>
					{#snippet actions()}
						<span class="act muted">{r.installed ? `${r.installed} INSTALLED` : ''}</span>
						{#if r.installed}
							<a class="act" href={link({ removeNovelRepo: String(r.id) })} data-sveltekit-noscroll
								>REMOVE…</a
							>
						{:else}
							<form method="POST" action="{base}?/removeRepo" use:enhance>
								<input type="hidden" name="id" value={r.id} />
								<input type="hidden" name="kind" value="novels" />
								<button class="act">REMOVE</button>
							</form>
						{/if}
					{/snippet}
				</ExtRow>
			{/each}
		</div>
		<p class="prose">
			Repositories are checked when you ask; CHECK NOW asks at once. REMOVE asks first when
			installed extensions came from it, and leaves them installed. A repository that stops
			answering keeps its row until you remove it. Mihon repositories hold manga, Aniyomi
			repositories anime, LNReader's novels.
		</p>
	{/if}
</div>

{#if data.removingSome}
	{@const r = data.removingSome}
	{@const n = r.pkgs.length}
	<ConfirmSheet
		open
		title="REMOVE {count(n)} {n === 1 ? 'EXTENSION' : 'EXTENSIONS'}?"
		lines={[
			`OF ${count(r.of)} SELECTED · ${r.names.map((x) => x.toUpperCase()).join(' · ')}`,
			`THE ${count(r.series)} SERIES THAT COME FROM THEM STAY, FILES AND ALL.`,
			`${count(r.queued)} QUEUED CHAPTERS LEAVE THE QUEUE. · ${count(r.followed)} FOLLOWED SERIES STOP BEING CHECKED.`,
			'THEIR SETTINGS ARE KEPT FOR A REINSTALL.',
			r.stayed.length
				? `${count(r.stayed.length)} STAY${r.stayed.length === 1 ? 'S' : ''} INSTALLED: OBSOLETE · NO REPOSITORY LISTS ${r.stayed.length === 1 ? 'IT' : 'THEM'}, SO ONCE REMOVED ${r.stayed.length === 1 ? 'IT COULD' : 'THEY COULD'} NOT BE INSTALLED AGAIN AND ${r.stayed.length === 1 ? 'ITS' : 'THEIR'} SETTINGS COULD NOT BE REACHED. REMOVE ${r.stayed.length === 1 ? 'IT' : 'THEM'} ONE AT A TIME.`
				: ''
		].filter(Boolean)}
		confirm="REMOVE {count(n)}"
		action="{base}?/removeSome"
		fields={{ pkg: r.pkgs }}
		onclose={() => goto(link({ removeSel: null }), { noScroll: true, replaceState: true })}
	/>
{/if}

{#if data.removing}
	{@const r = data.removing}
	<ConfirmSheet
		open
		title="REMOVE {r.name.toUpperCase()}?"
		lines={[
			`${plural(r.series ?? 0, 'SERIES')} HERE COME FROM IT · They stay in the library, with every chapter already on disk.`,
			`THEY STOP DOWNLOADING · ${plural(r.queued ?? 0, 'queued chapter')} leave the queue, and ${plural(r.followed ?? 0, 'followed series')} stop being checked for new ones.`.replace(
				/SERIESS/g,
				'SERIES'
			),
			`ITS SETTINGS ARE KEPT · Installing ${r.name} again brings them back.`
		]}
		confirm="REMOVE {r.name.toUpperCase()}"
		action="{base}?/remove"
		fields={{ pkg: r.pkg }}
		onclose={() => goto(link({ remove: null }), { noScroll: true, replaceState: true })}
	/>
{/if}

{#if data.removingNovelRepo}
	{@const r = data.removingNovelRepo}
	<ConfirmSheet
		open
		title="REMOVE {r.name.toUpperCase()}?"
		lines={[
			`${plural(r.installed, 'PLUGIN')} INSTALLED FROM IT STAY INSTALLED · They keep running, and stop getting updates.`,
			`ITS LISTINGS GO · Nothing from it shows in AVAILABLE until it's added again.`
		]}
		confirm="REMOVE {r.name.toUpperCase()}"
		action="{base}?/removeRepo"
		fields={{ id: String(r.id), kind: 'novels' }}
		onclose={() => goto(link({ removeNovelRepo: null }), { noScroll: true, replaceState: true })}
	/>
{/if}

{#if data.removingRepo}
	{@const r = data.removingRepo}
	<ConfirmSheet
		open
		title="REMOVE {r.name.toUpperCase()}?"
		lines={[
			`${plural(r.installed, 'EXTENSION')} INSTALLED FROM IT STAY INSTALLED · They keep running, and stop getting updates.`,
			`ITS LISTINGS GO · Nothing from it shows in AVAILABLE until it's added again.`
		]}
		confirm="REMOVE {r.name.toUpperCase()}"
		action="{base}?/removeRepo"
		fields={{ id: String(r.id) }}
		onclose={() => goto(link({ removeRepo: null }), { noScroll: true, replaceState: true })}
	/>
{/if}

<!-- eslint-enable svelte/no-navigation-without-resolve -->

{#if helpOpen}
	<HelpSheet open onclose={() => (helpOpen = false)} topic="downloading" part="extensions" />
{/if}

<style>
	/* Index-Extensions, transcribed: the mock's literals; colours are tokens. */
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
		padding: 0 18px;
	}
	.name {
		font: 500 16px/1.2 var(--font-mono);
	}
	.sub,
	.top {
		font: 400 12px/1 var(--font-mono);
		letter-spacing: 0.04em;
		color: var(--text-2);
	}
	.top {
		font: 500 11px/1 var(--font-mono);
		letter-spacing: 0.06em;
	}
	.check button {
		padding: 0;
		border: 0;
		background: transparent;
		color: var(--text-1);
		font: 500 14px/1 var(--font-mono);
		text-align: left;
		cursor: pointer;
	}
	.check button:disabled {
		opacity: 0.4;
	}
	.tabs {
		flex-shrink: 0;
		display: flex;
		border-bottom: var(--hairline);
		overflow-x: auto;
	}
	.tab {
		display: flex;
		align-items: center;
		gap: 8px;
		height: 52px;
		padding: 0 16px;
		border-right: var(--hairline);
		font: 500 14px/1.2 var(--font-mono);
		white-space: nowrap;
		color: var(--text-1);
		text-decoration: none;
	}
	.kinds .tab {
		padding: 12px 18px;
	}
	.tab.on {
		background: var(--surface-inverse);
		color: var(--text-inverse);
	}
	.tab .n {
		opacity: 0.6;
	}
	.label {
		flex-shrink: 0;
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 12px;
		padding: 22px var(--pad) 10px;
		font: 500 13px/1.2 var(--font-mono);
		letter-spacing: 0.06em;
		color: var(--text-2);
	}
	.label .l {
		padding-bottom: 0;
	}
	/* The section's "?": its name and mark, the label's height its target. */
	.label button.l.ask {
		display: flex;
		align-items: center;
		gap: 10px;
		min-height: 44px;
		padding-top: 0;
		border: 0;
		border-radius: 0;
		background: none;
		color: inherit;
		font: inherit;
		letter-spacing: inherit;
		cursor: pointer;
	}
	.label .r {
		display: flex;
		align-items: center;
		gap: 12px;
		white-space: nowrap;
	}
	.label a.r {
		color: var(--text-1);
		text-decoration: none;
	}
	@media (max-width: 599px) {
		.label {
			flex-wrap: wrap;
		}
	}
	.all {
		display: flex;
		align-items: center;
		height: 44px;
		padding: 0 var(--pad);
		border: 0;
		border-radius: 0;
		background: var(--accent);
		color: var(--on-accent);
		font: 500 14px var(--font-mono);
		cursor: pointer;
	}
	.all:disabled {
		opacity: 0.6;
	}
	.cols {
		flex-shrink: 0;
		display: flex;
		align-items: center;
		height: 34px;
		border-bottom: var(--hairline);
		font: 500 11px var(--font-mono);
		letter-spacing: 0.06em;
		color: var(--text-2);
	}
	.c0 {
		flex: 1;
		padding-left: calc(var(--pad) + 56px);
	}
	.c1 {
		width: 160px;
		flex-shrink: 0;
	}
	.c2 {
		width: 190px;
		flex-shrink: 0;
	}
	.c3 {
		width: 300px;
		flex-shrink: 0;
	}
	.rows {
		flex-shrink: 0;
		display: flex;
		flex-direction: column;
	}
	.rows.bt {
		border-top: var(--hairline);
	}
	/* The search, and FILTER beside it; the panel opens under the whole bar. */
	.filter {
		position: relative;
		flex-shrink: 0;
		display: flex;
		align-items: stretch;
		min-height: 56px;
		border-bottom: var(--hairline);
	}
	.find {
		flex: 1 1 auto;
		min-width: 120px;
		padding: 0 16px;
		border: 0;
		border-bottom: 1px solid var(--text-1);
		border-radius: 0;
		background: transparent;
		color: var(--text-1);
		font: 500 16px var(--font-mono);
		outline: none;
	}
	.more-row {
		display: flex;
		align-items: stretch;
		min-height: 56px;
		border-bottom: var(--hairline);
		font: 500 13px var(--font-mono);
		letter-spacing: 0.04em;
	}
	.more-row span {
		flex: 1;
		display: flex;
		align-items: center;
		padding: 0 var(--pad);
		color: var(--text-2);
	}
	.more-row a {
		display: flex;
		align-items: center;
		padding: 0 var(--pad);
		border-left: var(--hairline);
		color: var(--text-1);
		text-decoration: none;
	}
	.field {
		flex-shrink: 0;
		display: flex;
		align-items: stretch;
		min-height: 56px;
		margin: 0 var(--pad);
		border: 1px solid var(--text-1);
	}
	.field input {
		flex: 1;
		min-width: 0;
		padding: 0 16px;
		border: 0;
		background: transparent;
		color: var(--text-1);
		font: 500 15px var(--font-mono);
		outline: none;
	}
	.f-btn {
		display: flex;
		align-items: center;
		padding: 0 var(--pad);
		border: 0;
		border-left: 1px solid var(--text-1);
		border-radius: 0;
		background: transparent;
		color: var(--text-2);
		font: 500 14px var(--font-mono);
		text-decoration: none;
		cursor: pointer;
	}
	.found {
		flex-shrink: 0;
		display: flex;
		align-items: stretch;
		min-height: 64px;
		margin: 0 var(--pad);
		border: var(--hairline);
		border-top: 0;
		background: var(--surface-panel);
	}
	.found.rule {
		box-shadow: inset 3px 0 0 var(--text-1);
	}
	.f-text {
		flex: 1;
		min-width: 0;
		display: flex;
		flex-direction: column;
		justify-content: center;
		gap: 5px;
		padding: 10px 18px;
	}
	.f-a {
		font: 500 14px/1.3 var(--font-mono);
	}
	.f-b {
		font: 400 13px/1.4 var(--font-mono);
		color: var(--text-2);
	}
	.f-add {
		display: flex;
		align-items: center;
		padding: 0 var(--pad);
		border: 0;
		border-radius: 0;
		background: var(--accent);
		color: var(--on-accent);
		font: 500 14px var(--font-mono);
		white-space: nowrap;
		cursor: pointer;
	}
	.untrusted {
		display: flex;
		flex-direction: column;
		gap: 6px;
		padding: 14px var(--pad);
		border-bottom: var(--hairline);
		box-shadow: inset 3px 0 0 var(--text-1);
		background: var(--surface-panel);
		font: 400 13px/1.4 var(--font-mono);
	}
	.u-t {
		font: 500 14px var(--font-mono);
	}
	.u-k {
		display: flex;
		gap: 12px;
		color: var(--text-2);
		min-width: 0;
	}
	.u-k code {
		color: var(--text-1);
		overflow-wrap: anywhere;
	}
	.empty {
		display: flex;
		flex-direction: column;
		gap: 18px;
		max-width: 640px;
		padding: 40px var(--pad) 20px;
	}
	.lab {
		font: 500 13px var(--font-mono);
		letter-spacing: 0.06em;
		color: var(--text-2);
	}
	.empty p,
	.prose {
		margin: 0;
		font: 400 15px/1.5 var(--font-sans);
		color: var(--text-prose);
		text-wrap: pretty;
	}
	.prose {
		max-width: 760px;
		padding: 20px var(--pad);
	}
	.cta {
		align-self: flex-start;
		padding: 16px 24px;
		border: 1px solid var(--line-2);
		font: 500 14px var(--font-mono);
		color: var(--text-1);
		text-decoration: none;
	}
	@media (max-width: 1023px) {
		.c1 {
			display: none;
		}
		.c2 {
			width: 120px;
		}
		.c3 {
			width: 220px;
		}
	}
	@media (max-width: 599px) {
		.cols {
			display: none;
		}
	}

	/* ---- SELECT (card c696; doc/handoffs/extensions-select) ------------------ */
	/* The present tab stays; the other two dim and stop (Main 01). */
	.tab.off {
		opacity: 0.4;
	}
	.cell.sel {
		flex-shrink: 0;
		justify-content: center;
		padding: 0 18px;
		color: var(--text-1);
		text-decoration: none;
	}
	/* The inverse bar's cells: ✕, the count, SELECT ALL. */
	.cell.x,
	.cell.all,
	.cell.count {
		color: var(--text-inverse);
		text-decoration: none;
	}
	.cell.x {
		justify-content: center;
		font: 500 16px/1 var(--font-mono);
	}
	.esc {
		margin-left: 10px;
		font: 400 12px/1 var(--font-mono);
		color: var(--text-2);
	}
	.cell.count {
		flex: 1;
		font: 500 17px/1 var(--font-mono);
	}
	.cell.all {
		justify-content: center;
		padding: 0 var(--pad);
		border: 0;
		border-radius: 0;
		background: none;
		cursor: pointer;
	}
	.all-short {
		display: none;
	}
	/* The rows and the bar are one form; display: contents keeps the screen's
	   own column of labels, headers and rows exactly as it was. */
	.selform {
		display: contents;
	}
	/* A section's TICK / UNTICK, on the label's line. */
	.label .btn {
		display: flex;
		align-items: center;
		height: 36px;
		padding: 0 12px;
		border: 1px solid var(--line-2);
		color: var(--text-1);
		font: 500 13px/1.2 var(--font-mono);
		letter-spacing: 0.04em;
		text-decoration: none;
		white-space: nowrap;
	}
	.screen.selecting {
		padding-bottom: calc(64px + env(safe-area-inset-bottom));
	}
	/* The bulk bar: six cells, one row on the tablet and the desktop. */
	.bulk {
		position: fixed;
		left: var(--sheet-left, 0);
		right: 0;
		bottom: 0;
		z-index: 10;
		background: var(--surface-page);
		border-top: var(--rule-strong);
		padding-bottom: env(safe-area-inset-bottom);
	}
	.swr {
		display: grid;
		grid-template-columns: repeat(6, minmax(0, 1fr));
	}
	.swc {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 10px;
		min-width: 0;
		height: 64px;
		padding: 0 16px;
		border: 0;
		border-right: var(--hairline);
		border-bottom: var(--hairline);
		border-radius: 0;
		background: transparent;
		color: var(--text-1);
		text-align: left;
		font: inherit;
		text-decoration: none;
		cursor: pointer;
	}
	.swc .w {
		display: flex;
		flex-direction: column;
		gap: 4px;
		min-width: 0;
	}
	.swc .k {
		font: 500 14px/1.2 var(--font-mono);
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}
	.swc .n {
		font: 400 12px/1.2 var(--font-mono);
		color: var(--text-2);
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}
	.swc.go {
		justify-content: center;
	}
	.swc.go .w {
		align-items: center;
	}
	.swc.solo {
		border-right: 0;
	}
	.swc.dis,
	.swc:disabled {
		opacity: 0.4;
		cursor: default;
	}
	/* The system's square switch, with the mixed state drawn as its own. */
	.trk {
		position: relative;
		flex-shrink: 0;
		width: 44px;
		height: 24px;
		border: 1px solid var(--line-2);
	}
	.trk i {
		position: absolute;
		top: 2px;
		left: 2px;
		width: 18px;
		height: 18px;
		background: var(--text-2);
	}
	.trk.on {
		background: var(--accent);
		border-color: var(--accent);
	}
	.trk.on i {
		left: 22px;
		background: var(--on-accent);
	}
	.trk.mix {
		border-color: var(--text-1);
	}
	.trk.mix i {
		left: 12px;
		background: transparent;
	}
	.trk.mix i::after {
		content: '';
		position: absolute;
		left: 3px;
		right: 3px;
		top: 8px;
		height: 2px;
		background: var(--text-1);
	}
	@media (max-width: 599px) {
		.swr {
			grid-template-columns: repeat(2, minmax(0, 1fr));
		}
		.swc {
			padding: 0 12px;
		}
		.swc .k {
			font-size: 12px;
		}
		.all-long {
			display: none;
		}
		.all-short {
			display: inline;
		}
		.screen.selecting {
			padding-bottom: calc(192px + env(safe-area-inset-bottom));
		}
	}
	/* A TV draws no SELECT (Main 01), as the library draws none. */
	@media (pointer: none) and (min-width: 900px) {
		.cell.sel {
			display: none;
		}
	}
</style>

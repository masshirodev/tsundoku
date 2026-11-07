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
	import ExtFilter from './ExtFilter.svelte';
	import { ago } from '$lib/library/tracking';
	import { isSearchCommand, runSearchCommand } from '$lib/library/commands';
	import ExtRow from './ExtRow.svelte';

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
	const refusal = $derived(
		form && 'message' in form && typeof form.message === 'string' ? form : null
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
</script>

<svelte:head><title>extensions · tsundoku</title></svelte:head>

<!-- eslint-disable svelte/no-navigation-without-resolve -- every href below is built from resolve(), by base, link() or icon() -->

<div class="screen">
	<TopBar sticky label="EXTENSIONS">
		{#snippet middle()}
			<a class="cell back" href={resolve('/browse')} aria-label="Back to BROWSE">←</a>
			<span class="cell title"
				><span class="name">EXTENSIONS</span><span class="sub">BROWSE</span></span
			>
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

	{#if commandNote}<Band title={commandNote} />{/if}

	<!-- The way back to GET STARTED, while step 01's or 02's trip lasts (doc/ONBOARDING.md). -->
	<StartTrail start={data.start} />

	<nav class="tabs" aria-label="Extensions">
		<a class="tab" class:on={data.tab === 'installed'} href={base}
			>INSTALLED <span class="n">{data.counts.installed}</span></a
		>
		<a class="tab" class:on={data.tab === 'available'} href="{base}?tab=available"
			>AVAILABLE <span class="n"
				>{count(data.availableCounts.manga + data.availableCounts.anime)}</span
			></a
		>
		<a class="tab" class:on={data.tab === 'repos'} href="{base}?tab=repos"
			>REPOSITORIES <span class="n">{data.counts.repos}</span></a
		>
	</nav>

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
		<Band title={String(refusal.message).toUpperCase().slice(0, 160)} detail="NOTHING CHANGED" />
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
		{#snippet installedRow(r: (typeof v.current)[number], section: 'hand' | 'updates' | 'current')}
			{@const res = about(r.pkg)}
			{@const settings = r.shown[0]
				? resolve('/browse/[source]/settings', { source: r.shown[0].id })
				: null}
			<ExtRow
				name={r.name}
				icon={icon(r.pkg)}
				hue={hue(r.pkg)}
				adult={r.adult}
				hidden={r.mostlyHidden}
				rule={section === 'hand'}
				state={busy === r.pkg
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
		{#snippet pluginRow(p: (typeof pv.current)[number], section: 'hand' | 'updates' | 'current')}
			{@const key = `ln:${p.id}`}
			<ExtRow
				name={p.name}
				icon={icon(key)}
				hue={hue(key)}
				rule={section === 'hand'}
				state={busy === key
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
		{#each sections as s, i (s.key)}
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
					{#if s.key === 'updates'}
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
					><span class="c3"></span>
				</div>
			{/if}
			<div class="rows" class:bt={i > 0}>
				{#each s.rows as r (r.pkg)}{@render installedRow(r, s.key)}{/each}
				{#each s.plugins as p (p.id)}{@render pluginRow(p, s.key)}{/each}
			</div>
		{/each}
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
		padding: 16px 18px;
		border-right: var(--hairline);
		font: 500 14px var(--font-mono);
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
		align-items: flex-end;
		justify-content: space-between;
		gap: 12px;
		padding: 24px 0 0 var(--pad);
		font: 500 13px/1.2 var(--font-mono);
		letter-spacing: 0.06em;
		color: var(--text-2);
	}
	.label.first {
		padding-top: 20px;
	}
	.label .l {
		padding-bottom: 12px;
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
		align-items: stretch;
		white-space: nowrap;
	}
	/* Words alone sit on the label's line; UPDATE ALL's cell fills to the rule. */
	.label .r:not(:has(form)) {
		padding: 0 var(--pad) 12px 0;
		align-self: flex-end;
	}
	.label .r:has(form) .r-t {
		padding: 0 var(--pad) 12px 0;
		align-self: flex-end;
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
</style>

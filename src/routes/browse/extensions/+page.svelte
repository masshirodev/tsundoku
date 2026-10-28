<script lang="ts">
	import { resolve } from '$app/paths';
	import { enhance } from '$app/forms';
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import TopBar from '$lib/components/chrome/TopBar.svelte';
	import Band from '$lib/components/chrome/Band.svelte';
	import ConfirmSheet from '$lib/components/chrome/ConfirmSheet.svelte';
	import { count } from '$lib/library/downloads';
	import { ago } from '$lib/library/tracking';
	import ExtRow from './ExtRow.svelte';

	/**
	 * EXTENSIONS (Index-Extensions; Browse Calls, "Extension states in words,
	 * no new colour", "Updates ask, and can be taken back", "Removing says
	 * what stays", "No repository ships"). INSTALLED sorts what needs a hand
	 * first, then UPDATES with UPDATE ALL, then the rest; AVAILABLE is every
	 * repository's listings, in the owner's languages unless ALL; REPOSITORIES
	 * adds one by its address, after saying what it holds.
	 */
	let { data, form } = $props();

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
				adult={data.reveal && r.adult}
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

		{@const sections = [
			{ key: 'hand' as const, title: 'NEEDS A HAND', rows: v.needsHand },
			{ key: 'updates' as const, title: 'UPDATES', rows: v.updates },
			{ key: 'current' as const, title: 'INSTALLED', rows: v.current }
		].filter((s) => s.rows.length > 0)}
		{#each sections as s, i (s.key)}
			<div class="label" class:first={i === 0}>
				<span class="l">{String(i + 1).padStart(2, '0')} — {s.title}</span>
				<span class="r">
					<span class="r-t"
						>{s.rows.length}{s.key === 'updates'
							? ' · NOTHING UPDATES BY ITSELF'
							: s.key === 'current'
								? ' · UP TO DATE'
								: ''}</span
					>
					{#if s.key === 'updates'}
						<form method="POST" action="{base}?/updateAll" use:enhance={working('*')}>
							<button class="all" disabled={!!busy}
								>{busy === '*' ? 'UPDATING…' : `UPDATE ALL ${s.rows.length}`}</button
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
			</div>
		{/each}
	{/if}

	{#if data.available}
		{@const a = data.available}
		<nav class="tabs kinds" aria-label="Kinds">
			<a class="tab" class:on={a.kind === 'manga'} href={link({ kind: null, n: null })}
				>MANGA <span class="n">{count(a.counts.manga)}</span></a
			>
			<a class="tab" class:on={a.kind === 'anime'} href={link({ kind: 'anime', n: null })}
				>ANIME <span class="n">{count(a.counts.anime)}</span></a
			>
		</nav>
		<form method="GET" action={base} class="filter">
			<input type="hidden" name="tab" value="available" />
			{#if a.kind === 'anime'}<input type="hidden" name="kind" value="anime" />{/if}
			<input
				class="find"
				type="search"
				name="q"
				value={page.url.searchParams.get('q') ?? ''}
				placeholder="/ search {count(a.kind === 'manga' ? a.counts.manga : a.counts.anime)}"
				aria-label="Search the available extensions"
				autocomplete="off"
			/>
			<span class="fcell lab">LANGUAGE</span>
			{#each a.languages as l (l)}<span class="fcell on">{l.toUpperCase()}</span>{/each}
			<a
				class="fcell"
				class:on={page.url.searchParams.get('all') === '1'}
				href={link({ all: page.url.searchParams.get('all') === '1' ? null : '1', n: null })}>ALL</a
			>
			{#if data.reveal}
				{@const ad = page.url.searchParams.get('adult') ?? 'any'}
				<span class="fcell lab adult">ADULT</span>
				{#each ['any', 'only', 'none'] as o (o)}
					<a
						class="fcell"
						class:on={ad === o}
						href={link({ adult: o === 'any' ? null : o, n: null })}>{o.toUpperCase()}</a
					>
				{/each}
			{/if}
		</form>
		{@const shown = Number(page.url.searchParams.get('n')) || 150}
		<div class="label first">
			<span class="l"
				>01 — {count(a.rows.length)} FOUND{page.url.searchParams.get('all') === '1'
					? ' · ALL LANGUAGES'
					: ` · ${a.languages.map((l) => l.toUpperCase()).join(', ')}`}</span
			>
			{#if a.otherLanguages > 0}
				<a class="r more" href={link({ all: '1', n: null })}
					>+ {count(a.otherLanguages)} IN OTHER LANGUAGES · SHOW</a
				>
			{/if}
		</div>
		<div class="cols" aria-hidden="true">
			<span class="c0">NAME</span><span class="c1">KIND · LANGUAGE</span><span class="c2"
				>VERSION</span
			><span class="c3"></span>
		</div>
		<div class="rows">
			{#each a.rows.slice(0, shown) as r (r.pkg)}
				{@const res = about(r.pkg)}
				{@const untrusted = !!(res && 'untrusted' in res && res.untrusted)}
				<ExtRow
					name={r.name}
					icon={icon(r.pkg)}
					hue={hue(r.pkg)}
					adult={data.reveal && r.adult}
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
									page.url.searchParams.get('all') === '1' ||
									data.languages.includes(l.toLowerCase()) ||
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
		{#if a.rows.length > shown}
			<div class="more-row">
				<span>{count(shown)} OF {count(a.rows.length)}</span>
				<a href={link({ n: String(shown + 150) })} data-sveltekit-noscroll>MORE ↓</a>
			</div>
		{/if}
		<p class="prose">
			{#if data.reveal}
				Inside reveal the ADULT row and the 18+ marks exist, and so do the mostly-hidden sources'
				extensions, with HIDDEN on their icons. Ending reveal takes all of it out of the list and
				its counts.
			{:else}
				Languages come from SETTINGS ({a.languages.map((l) => l.toUpperCase()).join(', ')}); ALL
				widens this visit only. An untrusted extension is never installed: the key it was signed
				with is shown beside the one its repository lists.
			{/if}
		</p>
	{/if}

	{#if data.repos}
		<div class="label first">
			<span class="l">01 — ADD A REPOSITORY</span><span class="r">PASTE ITS ADDRESS</span>
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
						{data.preview.error.toUpperCase().slice(0, 160)} · A REPOSITORY'S ADDRESS ENDS IN index.min.json,
						AND IS OFTEN LINKED FROM A WEB PAGE.
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
							p.anime && plural(p.anime, 'ANIME EXTENSION')
						]
							.filter(Boolean)
							.join(', ') || 'NOTHING LISTED'}
					</div>
					<div class="f-b">
						NOTHING IS INSTALLED UNTIL YOU PICK ONE · ITS SIGNING KEY IS KEPT TO CHECK EVERY INSTALL
					</div>
				</div>
				<button class="f-add">ADD {p.name}</button>
			</form>
		{/if}

		<div class="label">
			<span class="l">02 — REPOSITORIES</span>
			<span class="r"
				>{data.repos.length}{data.checkedAt
					? ` · CHECKED ${ago(data.checkedAt, data.now)}`
					: ''}</span
			>
		</div>
		{#if data.repos.length}
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
		</div>
		<p class="prose">
			Repositories are checked when you ask; CHECK NOW asks at once. REMOVE asks first when
			installed extensions came from it, and leaves them installed. A repository that stops
			answering keeps its row until you remove it. Mihon repositories hold manga, Aniyomi
			repositories anime.
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
	.filter {
		flex-shrink: 0;
		display: flex;
		align-items: stretch;
		min-height: 56px;
		border-bottom: var(--hairline);
		overflow-x: auto;
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
	.fcell {
		display: flex;
		align-items: center;
		padding: 0 16px;
		border-left: var(--hairline);
		font: 500 14px var(--font-mono);
		white-space: nowrap;
		color: var(--text-1);
		text-decoration: none;
	}
	.fcell.lab {
		font: 500 12px var(--font-mono);
		letter-spacing: 0.06em;
		color: var(--text-2);
	}
	.fcell.lab.adult {
		color: var(--reveal);
	}
	.fcell.on {
		background: var(--surface-inverse);
		color: var(--text-inverse);
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

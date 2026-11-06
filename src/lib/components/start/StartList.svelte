<script lang="ts">
	import { enhance } from '$app/forms';
	import { resolve } from '$app/paths';
	import {
		firstOpen,
		importDoneLine,
		partOf,
		TRAIL,
		type FirstReadExtras,
		type PartId,
		type StartImport,
		type StartView,
		type Step,
		type StepId
	} from '$lib/library/start';
	import { KEEP_DAYS } from '$lib/library/keep';
	import { trail } from '$lib/start-trail.svelte';
	import { m } from '$lib/paraglide/messages';
	import { num, upper } from '$lib/i18n/format';

	/**
	 * GET STARTED's seven steps in two parts (doc/ONBOARDING.md; the Getting
	 * Started handoff, boards 1 and 1-Steps, and FIRST READ's, boards 1): on
	 * the empty library and on /start, the same list. SET UP's four, in any
	 * order, then FIRST READ's three, in order. A step that's still to do
	 * opens below its row; the first one to do opens by itself, FIRST READ's
	 * ahead of SET UP's. A finished part folds to one row. Each step ticks
	 * itself from what's really there (server/start.ts); SKIP and UNDO are
	 * kept on the computer.
	 */
	let {
		view,
		libraryRoot,
		extras = null,
		imported = null
	}: {
		view: StartView;
		libraryRoot: string;
		extras?: FirstReadExtras | null;
		/** The last import that came in, so 03's done row can name it (c511, Import-Doors B). */
		imported?: StartImport | null;
	} = $props();

	/** 03 done by an import: its name and count, and IMPORT LOG → to its entry. */
	const importLine = $derived(importDoneLine(imported));
	const metaOf = (s: Step) => (s.id === 'library' && s.state === 'done' && importLine) || s.meta;

	let opened = $state<StepId | null | undefined>(undefined);
	// The first step to do opens until the friend opens or closes one themselves.
	const open = $derived(opened === undefined ? firstOpen(view) : opened);
	const toggle = (id: StepId) => (opened = open === id ? null : id);
	let unfolded = $state<Record<PartId, boolean>>({ setup: false, read: false });

	let address = $state('');
	let copied = $state<string | null>(null);
	async function copy(text: string) {
		try {
			await navigator.clipboard.writeText(text);
		} catch {
			// Over plain http (a phone over Wi-Fi) there's no clipboard: the words are there to type.
			return;
		}
		copied = text;
		setTimeout(() => (copied = copied === text ? null : copied), 1500);
	}
	const SEEK = [
		'mihon extension repository',
		'aniyomi extension repository',
		'lnreader plugin repository'
	];

	/** Where a done step's quiet link goes: the place it was done. */
	const doneLink: Record<StepId, { label: () => string; href: string }> = {
		repo: { label: m.start_done_link_repo, href: '/browse/extensions?tab=repos' },
		ext: { label: m.start_done_link_ext, href: '/browse' },
		library: { label: m.start_done_link_library, href: '/' },
		phone: { label: m.start_done_link_phone, href: '/settings#s-devices' },
		find: { label: m.start_done_link_find, href: '/history' },
		add: { label: m.start_done_link_library, href: '/' },
		download: { label: m.start_done_link_download, href: '/downloads' }
	};
	/**
	 * A step's link starts the way back on the screen it opens (TRAIL). A
	 * FIRST READ trip remembers which of its steps were already done, so the
	 * band says only what ticks on the way.
	 */
	const go = (id: StepId) => () =>
		trail.begin(
			id,
			partOf(id) === 'read'
				? view.steps.filter((s) => s.part === 'read' && s.state === 'done').map((s) => s.id)
				: []
		);
	const KIND = {
		manga: m.first_kind_manga,
		anime: m.first_kind_anime,
		novel: m.first_kind_novel
	} as const;
	const n = $derived(extras?.sources.length ?? 0);
</script>

<div class="ob-list">
	{#each view.parts as p, i (p.id)}
		<div class="part" class:next={i > 0} id={p.id === 'read' ? 'first-read' : undefined}>
			<span class="t">{p.name}</span><span>{p.line}</span>
		</div>
		<div class="rows">
			{#if p.folds && !unfolded[p.id]}
				<div class="sum done" data-part={p.id}>
					<div class="st-box"><div class="num">✓</div></div>
					<div class="st-text">
						<div class="st-title">{p.title}</div>
						<div class="st-meta">
							<span class="long">{p.fold}</span><span class="short">{p.foldShort}</span>
						</div>
					</div>
					<div class="st-acts">
						<button type="button" onclick={() => (unfolded[p.id] = true)}>{m.start_show()}</button>
					</div>
				</div>
			{:else}
				{#each p.steps as s (s.id)}
					{@const isOpen = s.state === 'todo' && open === s.id}
					<div class="step {s.state}" class:open={isOpen} data-step={s.id}>
						<div class="step-row">
							<div class="st-box">
								<div class="num">{s.state === 'done' ? '✓' : s.n}</div>
							</div>
							<div class="st-text">
								<div class="st-title">
									{s.title}{#if s.optional}<span class="opt">{m.start_optional()}</span>{/if}
								</div>
								<div class="st-meta">
									<span class="long">{metaOf(s)}</span><span class="short">{s.short}</span>
								</div>
							</div>
							{@render acts(s, isOpen)}
						</div>
						{#if isOpen}
							<div class="st-body">{@render body(s.id)}</div>
						{/if}
					</div>
				{/each}
			{/if}
		</div>
	{/each}
</div>

{#snippet acts(s: Step, isOpen: boolean)}
	{#if s.state === 'done'}
		<div class="st-acts">
			{#if s.id === 'library' && importLine && imported}
				<!-- Import-Doors B: the quiet link opens the import's own entry in the log. -->
				<!-- eslint-disable-next-line svelte/no-navigation-without-resolve -- a fixed app path and its query -->
				<a class="quiet" href={`${resolve('/import/log')}?open=backup:${imported.id}`}
					>{m.start_done_link_import()}</a
				>
			{:else}
				<!-- eslint-disable-next-line svelte/no-navigation-without-resolve -- fixed app paths -->
				<a class="quiet" href={doneLink[s.id].href}>{doneLink[s.id].label()}</a>
			{/if}
		</div>
	{:else if s.state === 'skipped' && !s.with}
		<form method="POST" action="/start?/unskip" use:enhance class="st-acts">
			<input type="hidden" name="step" value={s.id} />
			<button type="submit">{m.start_undo()}</button>
		</form>
	{:else if s.state === 'todo'}
		<form method="POST" action="/start?/skip" use:enhance class="st-acts">
			<input type="hidden" name="step" value={s.id} />
			<button type="submit" class="quiet">{m.start_skip()}</button>
			{#if !isOpen}<button type="button" onclick={() => toggle(s.id)}>{m.start_open()}</button>{/if}
		</form>
	{/if}
{/snippet}

{#snippet sourceRows()}
	<div class="list">
		{#each extras?.sources ?? [] as src (src.id)}
			<a class="row" href={resolve('/browse/[source]', { source: src.id })} onclick={go('find')}>
				<span class="tx">
					<span class="a">{src.label}</span>
					<span class="b">{KIND[src.kind]()} · {src.lang.toUpperCase()}</span>
				</span>
				<span class="ac">{m.first_browse()}</span>
			</a>
		{/each}
	</div>
{/snippet}

{#snippet body(id: StepId)}
	{#if id === 'repo'}
		<p>
			{m.start_repo_body_a()} <b>{m.start_repo_body_b()}</b>
			{m.start_repo_body_c()}
		</p>
		<form method="GET" action={resolve('/browse/extensions')} class="field" onsubmit={go('repo')}>
			<label class="k" for="start-repo">{m.start_repo_address()}</label>
			<input type="hidden" name="tab" value="repos" />
			<div class="box">
				<input
					id="start-repo"
					class="in"
					name="add"
					type="url"
					required
					placeholder="https://…/index.min.json"
					autocomplete="off"
					bind:value={address}
				/>
				<button type="submit" class="b" disabled={!address.trim()}>{m.start_repo_ask()}</button>
			</div>
		</form>
		<div class="holds">
			<div>
				<span>{m.start_holds_manga()}</span><span
					>{m.start_holds_manga_repo({ file: 'index.min.json' })}</span
				>
			</div>
			<div>
				<span>{m.start_holds_anime()}</span><span
					>{m.start_holds_anime_repo({ file: 'index.min.json' })}</span
				>
			</div>
			<div>
				<span>{m.start_holds_novels()}</span><span
					>{m.start_holds_novels_repo({ file: 'plugins.min.json' })}</span
				>
			</div>
		</div>
		<div class="field">
			<div class="k">{m.start_seek()}</div>
			<div class="seek">
				{#each SEEK as q (q)}
					<button type="button" class="chip" onclick={() => copy(q)}
						>{q}<span class="cp">{copied === q ? m.start_copied() : m.start_copy()}</span></button
					>
				{/each}
			</div>
		</div>
	{:else if id === 'ext'}
		<p>{m.start_ext_body()}</p>
		<div class="go-row">
			<!-- eslint-disable-next-line svelte/no-navigation-without-resolve -- a fixed app path -->
			<a class="btn primary" href={TRAIL.ext!.href} onclick={go('ext')}>{m.start_ext_go()}</a>
			<span class="tick-note">{m.start_ticks_ext()}</span>
		</div>
	{:else if id === 'library'}
		<!-- Import-Doors A (c438): the three backups first, IMPORT A BACKUP on the
		     one that is read today; Aniyomi and LNReader stay NOT YET until their
		     importers land (the owner's call, 2026-11-03). The folder and START
		     SCAN drop below them, as the way for files. -->
		<p>
			{m.start_library_body_a()} <b>{m.start_library_downloads()}</b>{m.start_library_body_b()}
		</p>
		<div class="backups">
			<div>
				<span class="tx"
					><span class="a">{m.start_library_mihon_backup()}</span><span class="b"
						>{m.start_library_mihon({ path: '.tachibk' })}</span
					></span
				>
				<!-- eslint-disable-next-line svelte/no-navigation-without-resolve -- a fixed app path -->
				<a class="go" href={resolve('/import')} onclick={go('library')}>{m.start_import_go()}</a>
			</div>
			<div class="later">
				<span class="tx"
					><span class="a">{m.start_library_aniyomi_backup()}</span><span class="b">.tachibk</span
					></span
				>
				<span class="cl">{m.start_not_yet_anime()}</span>
			</div>
			<div class="later">
				<span class="tx"
					><span class="a">{m.start_library_lnreader_backup()}</span><span class="b">.zip</span
					></span
				>
				<span class="cl">{m.start_not_yet_novels()}</span>
			</div>
		</div>
		<div class="folder">
			<div class="k">{m.start_library_files()}</div>
			<form method="POST" action="/?/scan" use:enhance class="path-row">
				<div class="p" title={libraryRoot}>{libraryRoot}</div>
				<button type="submit">{m.start_scan()}</button>
			</form>
		</div>
		<span class="tick-note">{m.start_ticks_scan()}</span>
	{:else if id === 'find'}
		<p class="long">
			{m.start_find_body_a()} <b>{m.start_find_body_b()}</b>{m.start_find_body_c()}
		</p>
		<p class="short">{m.start_find_body_short()}</p>
		{#if n}
			<form method="GET" action={resolve('/downloads/search')} class="box" onsubmit={go('find')}>
				<input
					class="in"
					name="q"
					type="search"
					required
					placeholder={m.first_search_placeholder({ count: n, n: num(n) })}
					aria-label={m.first_search_label()}
				/>
				<button type="submit" class="b">{m.first_search()}</button>
			</form>
			<div class="field">
				<div class="k">{m.start_find_browse_one()}</div>
				{@render sourceRows()}
			</div>
		{/if}
		<div class="tick-note">
			<span class="long">{m.start_ticks_find()}</span><span class="short"
				>{m.start_ticks_find_short()}</span
			>
		</div>
	{:else if id === 'add'}
		{@const rec = extras?.record}
		<p>
			{m.start_add_body_a({ days: String(KEEP_DAYS) })}
			<b>{m.start_add_body_b()}</b>{m.start_add_body_c()}
		</p>
		{#if rec}
			<div class="mini" aria-hidden="true">
				<div class="mini-cta">
					<span class="go"
						>{m.start_mini_continue()}<span class="m"
							>{rec.page !== null
								? m.start_mini_at_page({ label: upper(rec.label), p: num(rec.page) })
								: upper(rec.label)}</span
						></span
					>
					<span class="add ring">{m.start_mini_add()}</span>
				</div>
			</div>
			<div class="field">
				<div class="k">{m.start_add_what()}</div>
				<div class="list">
					<a
						class="row"
						href={resolve('/downloads/source/[id]', { id: rec.previewId })}
						onclick={go('add')}
					>
						<span class="tx">
							<span class="a">{rec.title}</span>
							<span class="b"
								>{m.start_add_record({
									source: upper(rec.source),
									where: (rec.anime ? m.start_where_episode : m.start_where_chapter)({
										i: num(rec.at),
										total: num(rec.total)
									})
								})}</span
							>
						</span>
						<span class="ac go">{m.start_open_go()}</span>
					</a>
				</div>
			</div>
		{:else}
			<div class="go-row">
				<a class="btn" href={resolve('/downloads/search')} onclick={go('add')}
					>{m.start_search_go()}</a
				>
			</div>
		{/if}
		<div class="tick-note">{m.start_ticks_add()}</div>
	{:else if id === 'download'}
		{@const pick = extras?.pick}
		<p>
			{m.start_download_body_a()} <b>{m.start_download_body_b()}</b>{m.start_download_body_c()}
		</p>
		{#if pick && pick.missing > 0}
			<div class="mini" aria-hidden="true">
				<div class="dlrow">
					<div class="lb">{m.start_mini_download()}</div>
					<div class="lk">
						<div class="a">
							{m.start_mini_unread({ count: pick.missing, n: num(pick.missing) })}
						</div>
						<div class="b">
							{pick.downloaded
								? m.start_pick_some({ n: num(pick.downloaded) })
								: m.start_mini_nothing()}
						</div>
					</div>
					<div class="lc acc ring">
						{pick.downloaded ? m.start_mini_next() : m.start_mini_first()}
					</div>
					{#if pick.missing > 10}<div class="lc">
							{m.start_mini_all({ n: num(pick.missing) })}
						</div>{/if}
				</div>
			</div>
		{/if}
		<div class="holds">
			<div><span>{m.start_holds_manga()}</span><span>{m.start_dl_manga()}</span></div>
			<div><span>{m.start_holds_anime()}</span><span>{m.start_dl_anime()}</span></div>
			<div><span>{m.start_holds_novels()}</span><span>{m.start_dl_novels()}</span></div>
		</div>
		{#if pick}
			<div class="field">
				<div class="k">{m.start_dl_in_library()}</div>
				<div class="list">
					<a
						class="row"
						href={resolve('/series/[id]', { id: String(pick.id) })}
						onclick={go('download')}
					>
						<span class="tx">
							<span class="a">{pick.title}</span>
							<span class="b"
								>{(pick.anime ? m.start_pick_episodes : m.start_pick_chapters)({
									count: pick.total,
									n: num(pick.total)
								})} · {pick.downloaded
									? m.start_pick_some({ n: num(pick.downloaded) })
									: m.start_pick_none()}</span
							>
						</span>
						<span class="ac go">{m.start_open_go()}</span>
					</a>
				</div>
			</div>
		{/if}
		<div class="tick-note">
			{m.start_ticks_download()}
			<a href={resolve('/downloads')}>{m.start_done_link_download()}</a>
		</div>
	{:else}
		<div class="ways">
			<div class="way">
				<div class="wt">{m.start_wifi_title()}</div>
				<p>{m.start_wifi_body()}</p>
				<div class="wm2">{m.start_wifi_can()}<br />{m.start_wifi_cannot()}</div>
				<!-- eslint-disable-next-line svelte/no-navigation-without-resolve -- a fixed app path -->
				<a class="btn primary" href={TRAIL.phone!.href} onclick={go('phone')}
					>{m.name_settings()} › {m.name_devices_section()} →</a
				>
			</div>
			<div class="way">
				<div class="wt">{m.start_tailscale_title()}</div>
				<p>{m.start_tailscale_body()}</p>
				<div class="wm2">{m.start_tailscale_where_a()}<br />{m.start_tailscale_where_b()}</div>
				<a class="btn" href="{resolve('/help/[topic]', { topic: 'phone' })}#tailscale"
					>{m.start_tailscale_go()}</a
				>
			</div>
		</div>
		<div class="tick-note">{m.start_ticks_phone_long()}</div>
	{/if}
{/snippet}

<style>
	/* The handoffs' ob.css and fr.css (.part, .step*, .sum, .st-*, .field,
	   .box, .holds, .rows, .mini, .dlrow, .seek, .ways, .folder), transcribed;
	   colours are tokens. Every block inside the page's padding is closed on
	   all four sides (doc/design/README.md, "Close every block"), where the
	   handoffs drew rules above and below only. */
	.part {
		display: flex;
		justify-content: space-between;
		align-items: baseline;
		gap: 16px;
		padding: 0 0 12px;
		border-bottom: var(--hairline);
		font: 500 13px/1.2 var(--font-mono);
		letter-spacing: 0.06em;
		color: var(--text-2);
	}
	.part .t {
		color: var(--text-1);
	}
	.part.next {
		padding-top: 40px;
	}
	/* The part's head rules its top; the rows close the other three sides. */
	.rows {
		border: var(--hairline);
		border-top: 0;
	}
	.step + .step {
		border-top: var(--hairline);
	}
	.sum {
		display: flex;
		align-items: stretch;
		min-height: 64px;
	}
	.sum .st-title {
		font-size: 16px;
	}
	.short {
		display: none;
	}
	.step-row {
		display: flex;
		align-items: stretch;
		min-height: 76px;
	}
	.st-box {
		flex-shrink: 0;
		width: 76px;
		display: flex;
		align-items: center;
		justify-content: center;
	}
	.num {
		width: 40px;
		height: 40px;
		display: flex;
		align-items: center;
		justify-content: center;
		box-sizing: border-box;
		border: 1px solid var(--line-2);
		font: 500 14px var(--font-mono);
		color: var(--text-1);
	}
	.done .num,
	.sum .num {
		background: var(--accent);
		border-color: var(--accent);
		color: var(--on-accent);
	}
	.skipped .num {
		border-style: dashed;
		color: var(--text-2);
	}
	.open .num {
		border-color: var(--text-1);
	}
	.st-text {
		flex: 1;
		min-width: 0;
		display: flex;
		flex-direction: column;
		justify-content: center;
		gap: 6px;
		padding: 14px 16px 14px 0;
	}
	.st-title {
		font: 500 17px/1.3 var(--font-sans);
	}
	.opt {
		margin-left: 10px;
		font: 500 12px var(--font-mono);
		letter-spacing: 0.06em;
		color: var(--text-2);
		vertical-align: 2px;
	}
	.st-meta {
		font: 400 13px/1.3 var(--font-mono);
		color: var(--text-2);
		text-transform: uppercase;
	}
	.skipped .st-title {
		color: var(--text-2);
	}
	.blocked .st-box,
	.blocked .st-text {
		opacity: 0.4;
	}
	.st-acts {
		display: flex;
		align-items: stretch;
	}
	.st-acts > :global(*) {
		display: flex;
		align-items: center;
		padding: 0 24px;
		border: 0;
		border-left: var(--hairline);
		border-radius: 0;
		background: none;
		color: var(--text-1);
		font: 500 14px var(--font-mono);
		text-decoration: none;
		white-space: nowrap;
		cursor: pointer;
	}
	.st-acts > input {
		display: none;
	}
	.st-acts .quiet {
		color: var(--text-2);
	}
	.st-body {
		display: flex;
		flex-direction: column;
		gap: 22px;
		padding: 4px 32px 32px 76px;
	}
	.st-body p {
		margin: 0;
		max-width: 640px;
		font: 400 16px/1.55 var(--font-sans);
		color: var(--text-prose);
		text-wrap: pretty;
	}
	.st-body p b {
		color: var(--text-1);
		font-weight: 500;
	}
	.k {
		font: 500 12px/1.2 var(--font-mono);
		letter-spacing: 0.06em;
		color: var(--text-2);
	}
	.field {
		display: flex;
		flex-direction: column;
		gap: 8px;
	}
	.box {
		display: flex;
		height: 52px;
		border: 1px solid var(--text-1);
	}
	.box .in {
		flex: 1;
		min-width: 0;
		padding: 0 16px;
		border: 0;
		border-radius: 0;
		background: transparent;
		color: var(--text-1);
		font: 400 15px var(--font-mono);
		outline: none;
	}
	.box .in::placeholder {
		color: var(--text-2);
	}
	.box .b {
		display: flex;
		align-items: center;
		padding: 0 22px;
		border: 0;
		border-left: 1px solid var(--text-1);
		border-radius: 0;
		background: var(--accent);
		color: var(--on-accent);
		font: 500 14px var(--font-mono);
		cursor: pointer;
	}
	.box .b:disabled {
		opacity: 0.6;
		cursor: default;
	}
	.holds {
		display: flex;
		flex-direction: column;
		border: var(--hairline);
	}
	.holds > div {
		display: flex;
		justify-content: space-between;
		gap: 16px;
		padding: 13px 16px;
		font: 400 14px var(--font-mono);
	}
	.holds > div + div {
		border-top: var(--hairline);
	}
	.holds > div > span:last-child {
		color: var(--text-2);
		text-align: right;
	}
	.holds .later {
		opacity: 0.4;
	}
	.seek {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 8px;
	}
	.chip {
		display: inline-flex;
		align-items: center;
		gap: 10px;
		height: 40px;
		padding: 0 14px;
		border: 1px solid var(--line-2);
		border-radius: 0;
		background: none;
		color: var(--text-1);
		font: 400 13px var(--font-mono);
		cursor: pointer;
	}
	.chip .cp {
		color: var(--text-2);
		font-weight: 500;
		font-size: 12px;
	}
	.go-row {
		display: flex;
		align-items: center;
		flex-wrap: wrap;
		gap: 20px;
	}
	.btn {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		height: 48px;
		padding: 0 20px;
		border: 1px solid var(--line-2);
		border-radius: 0;
		background: transparent;
		color: var(--text-1);
		font: 500 14px var(--font-mono);
		text-decoration: none;
		white-space: nowrap;
		cursor: pointer;
	}
	.btn.primary {
		background: var(--accent);
		border-color: var(--accent);
		color: var(--on-accent);
	}
	.btn.lg {
		height: 56px;
		padding: 0 28px;
		font-size: 15px;
		letter-spacing: 0.04em;
	}
	.tick-note {
		font: 400 12px/1.45 var(--font-mono);
		color: var(--text-2);
	}
	.ways {
		display: grid;
		grid-template-columns: repeat(2, minmax(0, 1fr));
		gap: 1px;
		background: var(--line-1);
		border: var(--hairline);
	}
	.way {
		display: flex;
		flex-direction: column;
		gap: 12px;
		padding: 20px;
		background: var(--surface-page);
	}
	.way .wt {
		font: 500 14px var(--font-mono);
		letter-spacing: 0.04em;
	}
	.way p {
		font-size: 15px;
	}
	.way .wm2 {
		font: 400 12px/1.45 var(--font-mono);
		color: var(--text-2);
	}
	.way .btn {
		align-self: flex-start;
		white-space: normal;
		text-align: center;
	}
	/* Rows a step leads on from: a source to browse, the record, the series. */
	.list {
		border: var(--hairline);
	}
	.row {
		display: flex;
		align-items: stretch;
		min-height: 64px;
		color: var(--text-1);
		text-decoration: none;
	}
	.row + .row {
		border-top: var(--hairline);
	}
	.row .tx {
		flex: 1;
		min-width: 0;
		display: flex;
		flex-direction: column;
		justify-content: center;
		gap: 5px;
		padding: 10px 20px;
	}
	.row .tx .a {
		font: 500 16px var(--font-sans);
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}
	.row .tx .b {
		font: 400 13px var(--font-mono);
		color: var(--text-2);
	}
	.row .ac {
		display: flex;
		align-items: center;
		padding: 0 24px;
		border-left: var(--hairline);
		font: 500 14px var(--font-mono);
		white-space: nowrap;
	}
	.row .ac.go {
		color: var(--accent);
	}
	/* Replicas of the controls a step points at: drawn, not pressed. */
	.mini {
		display: flex;
		flex-direction: column;
		max-width: 600px;
		border: var(--hairline);
	}
	.mini-cta {
		display: flex;
		height: 56px;
	}
	.mini-cta .go {
		flex: 1;
		min-width: 0;
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 12px;
		padding: 0 20px;
		background: var(--accent);
		color: var(--on-accent);
		font: 500 14px var(--font-mono);
		letter-spacing: 0.04em;
		white-space: nowrap;
	}
	.mini-cta .go .m {
		font-weight: 400;
		font-size: 13px;
	}
	.mini-cta .add {
		display: flex;
		align-items: center;
		padding: 0 20px;
		font: 500 14px var(--font-mono);
		letter-spacing: 0.04em;
		white-space: nowrap;
		box-shadow: inset 0 0 0 1px var(--line-2);
	}
	.ring {
		box-shadow: inset 0 0 0 2px var(--accent) !important;
	}
	.dlrow {
		display: flex;
		align-items: stretch;
		min-height: 64px;
	}
	.dlrow .lb {
		width: 120px;
		flex-shrink: 0;
		display: flex;
		align-items: center;
		padding-left: 20px;
		border-right: var(--hairline);
		font: 500 12px var(--font-mono);
		letter-spacing: 0.06em;
		color: var(--text-2);
	}
	.dlrow .lk {
		flex: 1;
		min-width: 0;
		display: flex;
		flex-direction: column;
		justify-content: center;
		gap: 5px;
		padding: 10px 14px;
	}
	.dlrow .lk .a {
		font: 500 15px/1.3 var(--font-sans);
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}
	.dlrow .lk .b {
		font: 400 13px/1.35 var(--font-mono);
		color: var(--text-2);
	}
	.dlrow .lc {
		display: flex;
		align-items: center;
		padding: 0 18px;
		border-left: var(--hairline);
		font: 500 13px var(--font-mono);
		letter-spacing: 0.04em;
		white-space: nowrap;
	}
	.dlrow .lc.acc {
		background: var(--accent);
		color: var(--on-accent);
	}
	.tick-note a {
		color: var(--text-1);
	}
	.folder {
		display: flex;
		flex-direction: column;
		gap: 6px;
	}
	/* Import-Doors A's rows: the backup, what it holds, and its door. */
	.backups {
		display: flex;
		flex-direction: column;
		border: var(--hairline);
	}
	.backups > div {
		display: flex;
		align-items: stretch;
		min-height: 64px;
	}
	.backups > div + div {
		border-top: var(--hairline);
	}
	.backups .tx {
		flex: 1;
		min-width: 0;
		display: flex;
		flex-direction: column;
		justify-content: center;
		gap: 5px;
		padding: 12px 20px;
	}
	.backups .a {
		font: 500 16px/1.3 var(--font-sans);
	}
	.backups .b {
		font: 400 13px/1.4 var(--font-mono);
		color: var(--text-2);
	}
	.backups .go,
	.backups .cl {
		display: flex;
		align-items: center;
		justify-content: center;
		padding: 0 22px;
		border-left: var(--hairline);
		font: 500 14px var(--font-mono);
		white-space: nowrap;
		text-decoration: none;
	}
	.backups .go {
		color: var(--accent);
	}
	.backups .cl {
		color: var(--text-2);
		font-weight: 400;
		font-size: 13px;
	}
	.backups .later .tx {
		opacity: 0.4;
	}
	.path-row {
		display: flex;
		align-items: stretch;
		border: 1px solid var(--line-2);
	}
	.path-row .p {
		flex: 1;
		min-width: 0;
		border: 0;
	}
	.path-row button {
		padding: 0 22px;
		border: 0;
		border-left: 1px solid var(--line-2);
		background: transparent;
		color: var(--text-1);
		font: 500 14px var(--font-mono);
		white-space: nowrap;
		cursor: pointer;
	}
	.folder .p {
		padding: 14px 16px;
		border: 1px solid var(--line-2);
		font: 500 15px var(--font-mono);
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}
	/* The phone (Start-Phone and FirstRead-Phone boards): narrower boxes, the body under the title. */
	@media (max-width: 599px) {
		.long {
			display: none;
		}
		.short {
			display: inline;
		}
		p.short {
			display: block;
		}
		.part {
			padding: 0 16px 10px;
			font-size: 12px;
		}
		.part.next {
			padding-top: 22px;
		}
		/* Edge to edge on the phone: the screen's sides close the list. */
		.rows {
			border-left: 0;
			border-right: 0;
		}
		.step-row,
		.sum {
			min-height: 64px;
		}
		.box {
			height: 48px;
		}
		.row .tx {
			padding: 8px 12px;
		}
		.row .tx .a {
			font-size: 15px;
		}
		.row .tx .b {
			font-size: 12px;
		}
		.row .ac {
			padding: 0 14px;
			font-size: 13px;
		}
		.st-box {
			width: 60px;
		}
		.num {
			width: 36px;
			height: 36px;
			font-size: 13px;
		}
		.st-title {
			font-size: 16px;
		}
		.st-meta {
			font-size: 12px;
		}
		.st-acts > :global(*) {
			padding: 0 14px;
			font-size: 13px;
		}
		.st-body {
			padding: 0 16px 24px 60px;
			gap: 16px;
		}
		.st-body p {
			font-size: 15px;
		}
		.ways {
			grid-template-columns: minmax(0, 1fr);
		}
		.holds > div {
			flex-direction: column;
			gap: 4px;
			padding: 12px;
		}
		.holds > div > span:last-child {
			text-align: left;
		}
		.go-row .btn.primary {
			align-self: stretch;
		}
	}
</style>

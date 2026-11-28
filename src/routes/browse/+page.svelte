<script lang="ts">
	import StartTrail from '$lib/components/start/StartTrail.svelte';
	import { resolve } from '$app/paths';
	import TopBar from '$lib/components/chrome/TopBar.svelte';
	import SourceRow from './SourceRow.svelte';
	import ConcealBand from './ConcealBand.svelte';
	import AddedBand from './AddedBand.svelte';
	import OwnNetwork from '$lib/components/web/OwnNetwork.svelte';
	import { ownNetwork } from '$lib/web/own-network.svelte';
	import { ago } from '$lib/library/tracking';
	import { count } from '$lib/library/downloads';
	import {
		FOLDED,
		PREPAINT_ATTR,
		PREPAINT_TAG,
		RECENT_KEY,
		recentFolded,
		recentRight
	} from '$lib/library/browse-recent';
	import { beforeNavigate } from '$app/navigation';
	import SelectBar from './SelectBar.svelte';
	import PressBar from './PressBar.svelte';
	import PressBand from './PressBand.svelte';
	import TickSheet from './TickSheet.svelte';
	import { browseSelection } from '$lib/library/browse-selection.svelte';
	import { tickedHere } from '$lib/library/browse-select';
	import { KIND_TAB } from '../downloads/search/source-kinds';
	import type { Kind } from '$lib/library/kinds';

	/**
	 * BROWSE: a place, with extensions as its back room, and one list with the
	 * kinds as sections. RECENT (the last four browsed, any kind), then MANGA, ANIME
	 * and NOVELS, each source a row that opens its page. The bar carries
	 * EXTENSIONS, counting updates, as QUEUE counts chapters.
	 *
	 * Hidden means hidden: a mostly-hidden source is only here inside reveal,
	 * marked HIDDEN on its icon, and every count is what reveal lets you see.
	 */
	let { data, form } = $props();
	const list = $derived(data.list);

	type Row = (typeof data.list.manga)[number];
	const here = (r: Row) => {
		if (r.series === 0) return '';
		const n = `${count(r.series)} SERIES HERE`;
		if (r.hidden === 0) return n;
		return r.hidden === r.series ? `${n}, ALL HIDDEN` : `${n}, ${count(r.hidden)} HIDDEN`;
	};
	// NEEDS A WEBVIEW (doc/BROWSE.md, "Extensions that need a WebView"): a quiet
	// fact beside the language, said in words where this install can't give one.
	const needs = (r: Row) => r.webview && data.webviewMark;
	const meta = (r: Row) =>
		[r.lang.toUpperCase(), needs(r), here(r), r.check && "FIRST VISIT WAITS FOR THE SITE'S CHECK"]
			.filter(Boolean)
			.join(' · ');
	const recentMeta = (r: Row) =>
		[
			r.kind.toUpperCase(),
			r.lang.toUpperCase(),
			needs(r),
			r.browsedAt && `BROWSED ${ago(r.browsedAt, data.now)}`
		]
			.filter(Boolean)
			.join(' · ');

	const plural = (n: number, w: string) => `${count(n)} ${w}${n === 1 ? '' : 'S'}`;
	const sections = $derived(
		[
			{ title: 'MANGA', rows: list.manga },
			{ title: 'ANIME', rows: list.anime },
			{ title: 'NOVELS', rows: list.novels }
		]
			.filter((s) => s.rows.length > 0)
			.map((s) => {
				const ext = new Set(s.rows.map((r) => r.pkg)).size;
				// "8 SOURCES · 7 EXTENSIONS" where they differ; one number where they don't.
				const right =
					ext === s.rows.length
						? count(s.rows.length)
						: `${plural(s.rows.length, 'SOURCE')} · ${plural(ext, 'EXTENSION')}`;
				return { ...s, right };
			})
	);
	const total = $derived(list.manga.length + list.anime.length + list.novels.length);
	/**
	 * The KIND band (doc/BROWSE.md, "The KIND band"): the library's band, over
	 * the sources. ALL is every source, as before; a kind narrows RECENT and the
	 * sections to the sources serving it. The server counts and narrows.
	 */
	const band = $derived(data.kindBand);
	const kindHref = (k: Kind | null) => resolve('/browse') + (k ? `?kind=${k}` : '');
	const pad = (n: number) => String(n).padStart(2, '0');
	/** The sections before RECENT's number: 01 — PINNED when anything is pinned (c1142). */
	const lead = $derived(list.pinned.length ? 1 : 0);
	const extensionsHref = resolve('/browse/extensions');

	/**
	 * RECENT folds away (doc/BROWSE.md, "RECENT folds"). Open by
	 * default, remembered for the device (`RECENT_KEY`). The server draws it
	 * open; a device that folded it is folded before the first paint by the
	 * head's `PREPAINT` (it marks `<html>`, and the stylesheet folds from the
	 * mark), and the page takes the stored word as it mounts. The toggle keeps
	 * the mark in step, so the stylesheet and the page never disagree.
	 */
	let recentShut = $state(false);
	function markShut(shut: boolean) {
		if (shut) document.documentElement.setAttribute(PREPAINT_ATTR, '');
		else document.documentElement.removeAttribute(PREPAINT_ATTR);
	}
	$effect(() => {
		let stored: string | null = null;
		try {
			stored = localStorage.getItem(RECENT_KEY);
		} catch {
			// Storage unavailable: the default, open.
		}
		// Read once, as the page mounts: the effect reads nothing reactive, so a
		// toggle never runs it again (the toggle keeps the mark itself).
		const shut = recentFolded(stored);
		recentShut = shut;
		// Another tab may have changed the word since this document's head ran.
		markShut(shut);
	});
	function toggleRecent() {
		recentShut = !recentShut;
		markShut(recentShut);
		try {
			if (recentShut) localStorage.setItem(RECENT_KEY, FOLDED);
			else localStorage.removeItem(RECENT_KEY);
		} catch {
			// Storage unavailable: the fold still holds for this visit.
		}
	}
	/**
	 * SELECT made on a source's page lasts here: the bar stays inverse, each
	 * source row says how many of its series are ticked, and the bulk bar
	 * presses the lot. A source opens still selecting.
	 */
	const sel = browseSelection;
	const selecting = $derived(sel.selecting);
	let showing = $state(false);
	beforeNavigate((n) => sel.follow(n.to?.route.id));
	$effect(() => sel.checkReveal(data.reveal));
	const ticked = (r: Row) => (selecting ? tickedHere(sel.list, r.id) : '');
	function onKey(e: KeyboardEvent) {
		if (!sel.selecting || e.key !== 'Escape' || showing) return;
		if (document.querySelector('[role="dialog"]')) return;
		sel.end();
	}

	const recentOpen = $derived(recentRight(false, list.recent.length));
	const recentClosed = $derived(recentRight(true, list.recent.length));
</script>

<svelte:head>
	<title>browse · tsundoku</title>
	<!-- RECENT's fold, before the body paints (browse-recent.ts, PREPAINT). -->
	<!-- eslint-disable-next-line svelte/no-at-html-tags -- a constant of our own, no input in it -->
	{@html PREPAINT_TAG}
	<!-- Without script nothing can fold RECENT back, so it offers nothing. -->
	<noscript
		><style>
			[data-recent-toggle] {
				display: none;
			}
		</style></noscript
	>
</svelte:head>

<svelte:window onkeydown={onKey} />

<div class="screen" class:selecting>
	{#if selecting}
		<SelectBar onshow={() => (showing = true)} />
	{:else}
		<TopBar sticky label="BROWSE">
			{#snippet middle()}
				<a class="cell back" href={resolve('/')} aria-label="Back to the library">←</a>
				<span class="cell title">BROWSE</span>
				<!-- What a search will ask (c1142): the pinned when any are. -->
				<a class="cell hint" href={resolve('/downloads/search')}
					>/ search {data.pins
						? `the ${data.pins} pinned source${data.pins === 1 ? '' : 's'}`
						: 'every source'}</a
				>
				<a class="cell ext" href={extensionsHref}>
					<span class="top">EXTENSIONS</span>
					<span
						>{list.updates
							? `${count(list.updates)} UPDATE${list.updates === 1 ? '' : 'S'}`
							: 'MANAGE'}</span
					>
				</a>
			{/snippet}
		</TopBar>
	{/if}
	{#if band}
		<nav class="kinds" aria-label="Kinds">
			<div class="klabel">KIND</div>
			<div class="kscroll">
				<!-- eslint-disable svelte/no-navigation-without-resolve -- kindHref resolves -->
				<a
					class="kc"
					class:on={band.kind === null}
					href={kindHref(null)}
					aria-current={band.kind === null ? 'true' : undefined}
					><span>ALL</span><span class="n">{count(band.all)}</span></a
				>
				{#each band.cells as c (c.kind)}
					<a
						class="kc"
						class:on={band.kind === c.kind}
						href={kindHref(c.kind)}
						aria-current={band.kind === c.kind ? 'true' : undefined}
						><span>{KIND_TAB[c.kind]}</span><span class="n">{count(c.n)}</span></a
					>
				{/each}
				<!-- eslint-enable svelte/no-navigation-without-resolve -->
			</div>
		</nav>
	{/if}
	<!-- The way back to GET STARTED, while FIRST READ's trip lasts (doc/ONBOARDING.md). -->
	<StartTrail start={data.start} />
	<!-- A press's band: while it runs and its one result, on every browse screen. -->
	<PressBand reveal={data.reveal} />
	<!-- Every site refused from one address on the reader's own network: a
	     proxy, as Chromium reports one (c1156). The latest such refusal names it. -->
	{#if __WEB_EDITION__ && ownNetwork.proxy}
		{@const proxy = ownNetwork.proxy}
		{@const refused = ownNetwork.list.find((r) => r.answeredFrom === proxy.address)}
		{#if refused}
			<OwnNetwork {refused} {proxy} onallowed={() => location.reload()} />
		{/if}
	{/if}
	<!-- CONCEAL ITS SERIES outside reveal: its source is mostly
	     hidden now, so the band is here, and names no source. -->
	{#if data.concealed}
		<ConcealBand band={data.concealed} name={null} undo="?/undoConceal" />
	{/if}
	<!-- ADD outside reveal that left its source mostly hidden: the
	     source's page is not found, so the band is here. Outside reveal it
	     names no source; inside reveal it is here and does. -->
	{#if data.added}
		<AddedBand
			band={data.added}
			name={data.added.sourceName}
			reveal={data.reveal}
			undo="?/undoAdd"
			refusal={form && 'added' in form ? (form.added ?? null) : data.refused}
			shelves={data.shelves}
			onShelves={data.addedShelves}
			shelve="?/shelve"
			shelfRefusal={form && 'shelf' in form ? (form.shelf ?? null) : null}
		/>
	{/if}

	{#if total === 0}
		<!-- The first run: no repository ships. -->
		<div class="empty">
			<div class="lab">00 — NO SOURCES YET</div>
			<div class="h">Nothing to browse yet.</div>
			<p>
				Sources come from extension repositories, and tsundoku ships none. Paste the address of a
				repository you trust: it says what it holds before anything is installed.
			</p>
		</div>
		<form method="GET" action={extensionsHref} class="field">
			<input type="hidden" name="tab" value="repos" />
			<label for="repo-address">REPOSITORY ADDRESS</label>
			<div class="box">
				<input
					id="repo-address"
					name="add"
					placeholder="https://…/index.min.json"
					autocomplete="off"
					inputmode="url"
					required
				/>
				<button type="submit">ADD</button>
			</div>
		</form>
		<div class="label first"><span>WHAT A REPOSITORY HOLDS</span><span></span></div>
		<div class="holds">
			<div class="hold"><span>MANGA, MANHWA, DOUJINSHI</span><span>A MIHON REPOSITORY</span></div>
			<div class="hold"><span>ANIME</span><span>AN ANIYOMI REPOSITORY</span></div>
			<div class="hold">
				<span>NOVELS</span><span>AN LNREADER PLUGIN REPOSITORY · NOT YET</span>
			</div>
		</div>
		<p class="prose">
			The library, its search and every series still open without one. A series' DOWNLOAD row
			appears once its source is installed.
		</p>
	{:else}
		{#if list.pinned.length}
			<!-- 01 — PINNED (c1142): what a search asks by default. Pinned sources
			     also stay in their kind's section, marked, so a kind's list is whole. -->
			<div class="label first">
				<span>01 — PINNED</span>
				<span
					>A SEARCH ASKS THESE · {list.pinned.length}{list.pinned.length > 12
						? ' · A SEARCH ASKS THEM ALL'
						: ''}</span
				>
			</div>
			<div class="rows">
				{#each list.pinned as r (r.id)}<SourceRow
						{r}
						meta={meta(r)}
						ticked={ticked(r)}
						pin={!selecting}
					/>{/each}
			</div>
		{/if}
		{#if list.recent.length}
			<!-- RECENT's label is its fold: one stop on a TV, OK toggles it.
			     Its name is what it shows (`01 — RECENT 4 RECENT SHOW ↓`), so a
			     voice user's "click show" finds it: the half not drawn is
			     display: none, and out of the name. -->
			<button
				type="button"
				class="label fold"
				class:first={!list.pinned.length}
				class:shut={recentShut}
				aria-expanded={!recentShut}
				aria-controls="browse-recent"
				onclick={toggleRecent}
			>
				<span>{pad(lead + 1)} — RECENT</span>
				<span class="right">
					<span class="when-open">{recentOpen.text}</span><span class="when-shut"
						>{recentClosed.text}</span
					>
					<span class="toggle when-open" data-recent-toggle>{recentOpen.toggle}</span><span
						class="toggle when-shut"
						data-recent-toggle>{recentClosed.toggle}</span
					>
				</span>
			</button>
			<div class="rows recent-rows" class:shut={recentShut} id="browse-recent">
				{#each list.recent as r (r.id)}<SourceRow
						{r}
						meta={recentMeta(r)}
						ticked={ticked(r)}
						pin={!selecting}
					/>{/each}
			</div>
		{/if}
		{#each sections as s, i (s.title)}
			<div class="label" class:first={i === 0 && !list.recent.length && !list.pinned.length}>
				<span>{pad(i + 1 + lead + (list.recent.length ? 1 : 0))} — {s.title}</span>
				<span>{s.right}</span>
			</div>
			<div class="rows">
				{#each s.rows as r (r.id)}<SourceRow
						{r}
						meta={meta(r)}
						ticked={ticked(r)}
						pin={!selecting}
					/>{/each}
			</div>
		{/each}
	{/if}
</div>

{#if selecting}
	<PressBar />
	<TickSheet open={showing} onclose={() => (showing = false)} />
{/if}

<style>
	/* The KIND band: the library's (src/routes/+page.svelte, .kinds), not pinned
	   and with no FILTER at its end. Colours are tokens. Here, and never in the
	   head's <noscript> style: while script runs a <noscript> is text, so rules
	   put there left the band bare. */
	.kinds {
		position: sticky;
		top: var(--header-h);
		z-index: 7;
		display: flex;
		flex-shrink: 0;
		height: 40px;
		border-bottom: var(--hairline);
		background: var(--surface-page);
	}
	.klabel {
		display: flex;
		align-items: center;
		flex-shrink: 0;
		padding: 0 14px 0 var(--pad);
		border-right: var(--hairline);
		font: 500 12px/1 var(--font-mono);
		letter-spacing: 0.06em;
		color: var(--text-2);
		white-space: nowrap;
	}
	.kscroll {
		display: flex;
		flex: 1;
		min-width: 0;
		overflow-x: auto;
		scrollbar-width: none;
	}
	.kscroll::-webkit-scrollbar {
		display: none;
	}
	.kc {
		display: flex;
		align-items: center;
		gap: 6px;
		flex-shrink: 0;
		padding: 0 10px;
		border-right: var(--hairline);
		color: var(--text-1);
		font: 500 13px/1 var(--font-mono);
		letter-spacing: 0.02em;
		white-space: nowrap;
		text-decoration: none;
	}
	.kc .n {
		opacity: 0.6;
	}
	.kc.on,
	.kc.on:hover,
	.kc:active {
		background: var(--surface-inverse);
		color: var(--text-inverse);
	}
	@media (max-width: 599px) {
		.klabel {
			display: none;
		}
	}
	@media (min-width: 600px) {
		.kc {
			padding: 0 14px;
		}
	}
	/* Selecting: the bulk bar is pinned under the list, so the list ends above it. */
	.screen.selecting {
		padding-bottom: 120px;
	}
	/* Transcribed from the design: its literals; colours are tokens. */
	.screen {
		display: flex;
		flex-direction: column;
		min-height: 100dvh;
	}
	.cell {
		display: flex;
		flex-direction: column;
		justify-content: center;
		/* TopBar centres what it holds; the design's cells stretch, their text at the left. */
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
		font: 500 16px/1.2 var(--font-mono);
	}
	.hint {
		flex: 1 1 auto;
		min-width: 0;
		padding: 0 18px;
		font: 400 16px/1.2 var(--font-mono);
		color: var(--text-2);
	}
	.top {
		font: 500 11px/1 var(--font-mono);
		letter-spacing: 0.06em;
		color: var(--text-2);
	}
	.label {
		flex-shrink: 0;
		display: flex;
		justify-content: space-between;
		gap: 12px;
		padding: 24px var(--pad) 12px;
		font: 500 13px/1.2 var(--font-mono);
		letter-spacing: 0.06em;
		color: var(--text-2);
	}
	.label.first {
		padding-top: 18px;
	}
	.label span:first-child {
		flex-shrink: 0;
		white-space: nowrap;
	}
	.label span:last-child {
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	/* RECENT's fold: the label is a button that looks like the label. */
	.fold {
		width: 100%;
		margin: 0;
		border: 0;
		border-radius: 0;
		background: transparent;
		text-align: left;
		cursor: pointer;
	}
	.fold .right {
		display: flex;
		gap: 14px;
	}
	.fold .toggle {
		color: var(--text-1);
	}
	/* Folded by the page, or by the head's mark before it ran (browse-recent.ts). */
	.when-shut,
	.fold.shut .when-open,
	:global(html[data-recent-folded]) .fold .when-open,
	.recent-rows.shut,
	:global(html[data-recent-folded]) .recent-rows {
		display: none;
	}
	.fold.shut .when-shut,
	:global(html[data-recent-folded]) .fold .when-shut {
		display: inline;
	}
	.rows {
		flex-shrink: 0;
		display: flex;
		flex-direction: column;
		border-top: var(--hairline);
	}
	.empty {
		display: flex;
		flex-direction: column;
		gap: 18px;
		max-width: 640px;
		padding: 56px var(--pad) 28px;
	}
	.lab {
		font: 500 13px var(--font-mono);
		letter-spacing: 0.06em;
		color: var(--text-2);
	}
	.h {
		font: 500 28px/1.25 var(--font-sans);
	}
	.empty p {
		margin: 0;
		font: 400 17px/1.5 var(--font-sans);
		color: var(--text-prose);
		text-wrap: pretty;
	}
	.field {
		display: flex;
		flex-direction: column;
		gap: 8px;
		padding: 0 var(--pad) 28px;
	}
	.field label {
		font: 500 12px var(--font-mono);
		letter-spacing: 0.06em;
		color: var(--text-2);
	}
	.box {
		display: flex;
		align-items: stretch;
		min-height: 56px;
		border: 1px solid var(--line-2);
	}
	.box input {
		flex: 1;
		min-width: 0;
		padding: 0 16px;
		border: 0;
		background: transparent;
		color: var(--text-1);
		font: 500 15px var(--font-mono);
		outline: none;
	}
	.box button {
		padding: 0 24px;
		border: 0;
		border-left: 1px solid var(--line-2);
		border-radius: 0;
		background: transparent;
		color: var(--text-1);
		font: 500 14px var(--font-mono);
		cursor: pointer;
	}
	.box:has(input:placeholder-shown) button {
		opacity: 0.4;
	}
	.holds {
		border-top: var(--hairline);
	}
	.hold {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 12px;
		min-height: 56px;
		padding: 0 var(--pad);
		border-bottom: var(--hairline);
		font: 400 13px var(--font-mono);
		letter-spacing: 0.04em;
	}
	.hold span:last-child {
		color: var(--text-2);
		text-align: right;
	}
	.prose {
		margin: 0;
		padding: 20px var(--pad);
		font: 400 15px/1.5 var(--font-sans);
		color: var(--text-prose);
		text-wrap: pretty;
	}

	/* The phone: no room for the hint; BROWSE takes the space. */
	@media (max-width: 599px) {
		.hint {
			display: none;
		}
		.title {
			flex: 1 1 auto;
		}
	}
</style>

<script lang="ts">
	import { animeConfirm, animeContinue } from '$lib/library/anime';
	import { resolve } from '$app/paths';
	import EpisodeList from './EpisodeList.svelte';
	import { movedUnit } from './move-words';
	import ConfirmSheet from '$lib/components/chrome/ConfirmSheet.svelte';
	import { replacing, stepsBackTo } from '$lib/back';
	import type { ActionResult } from '@sveltejs/kit';
	import { backLink } from '$lib/back';
	import { enhance } from '$app/forms';
	import { SvelteSet } from 'svelte/reactivity';
	import { tick } from 'svelte';
	import { browser } from '$app/environment';
	import SeriesPanel from './SeriesPanel.svelte';
	import EntryList from './EntryList.svelte';
	import PageGrid from './PageGrid.svelte';
	import EditSheet from './EditSheet.svelte';
	import BookGrid from './BookGrid.svelte';
	import BookSheet from './BookSheet.svelte';
	import GroupSheet from '../../GroupSheet.svelte';
	import Band from '$lib/components/chrome/Band.svelte';
	import NavLine from '$lib/components/waiting/NavLine.svelte';
	import { m } from '$lib/paraglide/messages';
	import { num } from '$lib/i18n/format';
	import StartTrail from '$lib/components/start/StartTrail.svelte';
	import { trail } from '$lib/start-trail.svelte';
	import { partOf, trailHere } from '$lib/library/start';
	import { goto, invalidateAll } from '$app/navigation';
	import { page } from '$app/state';
	import { offline } from '$lib/offline.svelte';
	import { watchQueue } from '$lib/downloads-live.svelte';
	import { cacheMany, dropMany } from '$lib/cache/device';
	import { orderBooks } from '$lib/library/books';
	import { partDone } from '$lib/library/works';
	import type { TakeOutFacts } from '$lib/server/works';
	import { withParam, readHref } from '$lib/library/links';
	import {
		addedDetail,
		allToDownload,
		confirmLines,
		rowAction,
		type DownloadState
	} from '$lib/library/downloads';
	import {
		bulkCounts,
		continueAction,
		fileMeta,
		isBookSeries,
		rangeBetween,
		formatBytes,
		type SeriesEntry
	} from '$lib/library/series';

	let { data, form } = $props();
	// FIRST READ's band (doc/ONBOARDING.md, "The way back"): just after ADD it
	// takes the place of ADDED TO THE LIBRARY, with its UNDO, and the DOWNLOAD
	// row wears the ring while 07 is next.
	const readBand = $derived(
		!!data.start &&
			!!trail.step &&
			partOf(trail.step) === 'read' &&
			trailHere(trail.step, page.url.pathname)
	);
	const ring = $derived(trail.ring(data.start, page.url.pathname));
	const refusal = $derived(
		form && 'message' in form && typeof form.message === 'string' ? form.message.toUpperCase() : ''
	);

	const series = $derived(data.series);
	const doujin = $derived(series.kind === 'doujin');
	const books = $derived(isBookSeries(series));

	// ---- series of books ---------------------------------------------------------------

	/**
	 * The book whose sheet is open (long-press), by id: the sheet reads the
	 * entry from the current data, so a rating or FAV it saves shows at once.
	 */
	let sheetBookId = $state<number | null>(null);
	/** The book whose tags are being edited (TAGS on its sheet), by id so it follows the data. */
	let tagsBookId = $state<number | null>(null);
	const tagsBook = $derived(
		tagsBookId === null ? null : (series.entries.find((e) => e.id === tagsBookId) ?? null)
	);
	const sheetBook = $derived(series.entries.find((e) => e.id === sheetBookId) ?? null);
	let reordering = $state(false);
	let order = $state<number[]>([]);
	let reviewing = $state(false);

	function startOrder() {
		order = series.entries.map((e) => e.id);
		reordering = true;
	}

	function orderBy(mode: 'date' | 'title') {
		const byId = new Map(series.entries.map((e) => [e.id, e]));
		order = orderBooks(
			order
				.map((id) => byId.get(id)!)
				.map((e) => ({ id: e.id, title: e.title, addedAt: e.addedAt })),
			mode
		).map((e) => e.id);
	}

	/** A book of this series opened on its own: its page grid. */
	function openBook(e: SeriesEntry) {
		sheetBookId = null;
		// eslint-disable-next-line svelte/no-navigation-without-resolve -- withParam() keeps the current, resolved path
		void goto(withParam(page.url, 'book', String(e.id)));
	}

	/** "SERIES CREATED · 6 BOOKS", from the grouping sheet's redirect. */
	const created = $derived(Number(page.url.searchParams.get('created')) || 0);
	const added = $derived(page.url.searchParams.get('added'));
	// Grouped novels are counted by the volume (doc/BOOKS.md).
	const unit = $derived(page.url.searchParams.get('unit') === 'volumes' ? 'VOLUMES' : 'BOOKS');
	const createdOrder = $derived(page.url.searchParams.get('order') ?? 'BY DATE ADDED');
	const takenOut = $derived(form && 'takenOut' in form ? form.takenOut : null);
	const markedThrough = $derived(form && 'markedThrough' in form ? form.markedThrough : null);
	/**
	 * REFRESH's answer (card c220): what the source lists that no entry was.
	 * REFRESH never downloads, so the band says so and leaves NEXT or ALL to
	 * keep them — FOLLOW's own turn won't pick them up either, since they are
	 * no longer new to the source.
	 */
	const refreshed = $derived(
		form && 'refreshed' in form
			? (form.refreshed as { kind: 'manga' | 'anime' | 'novel'; added: number })
			: null
	);
	/**
	 * The MOVED band (doc/MOVE.md): just after a move, the series screen says
	 * where it went, what changed, and UNDO. It goes when the screen is left.
	 */
	const movedDetail = $derived(
		data.moved
			? [
					data.moved.added
						? `${data.moved.added} ${movedUnit(series.kind)}${data.moved.added === 1 ? '' : 'S'} ADDED, NOT DOWNLOADED`
						: '',
					data.moved.kept
						? `${data.moved.kept} KEPT FROM ${(data.move.former?.name ?? 'THE OLD SOURCE').toUpperCase()}`
						: ''
				]
					.filter(Boolean)
					.join(' · ') || 'NOTHING ADDED OR KEPT'
			: ''
	);

	// A long press on a chapter row: it and everything before it, read. The
	// band that follows offers UNDO for exactly the chapters that changed.
	let throughForm = $state<HTMLFormElement | null>(null);
	let throughId = $state(0);
	async function markThrough(e: SeriesEntry) {
		throughId = e.id;
		await tick();
		throughForm?.requestSubmit();
	}
	const dismissedKey = $derived(form && 'dismissed' in form ? form.dismissed : null);
	const action = $derived(
		series.kind === 'anime' ? animeContinue(series.entries) : continueAction(series)
	);
	/**
	 * The run's accent (W5; Work-Row B3): a part that is done makes CONTINUE
	 * quiet, and the WORK row offers the next part. The panel decides the same
	 * thing from `data.work`, so the header's ▶ and the bar cannot disagree.
	 */
	const quiet = $derived(!!data.work && partDone(data.work.state));

	// ---- deleting ------------------------------------------------------------------
	let deletingSeries = $state(false);
	let deletingBook = $state<SeriesEntry | null>(null);
	/**
	 * A deleted series has no page to stay on: back where it was opened from,
	 * the way ← goes (src/lib/back.ts), so the shelf comes back as it was.
	 */
	async function leaveDeleted(r: ActionResult) {
		if (r.type !== 'success') return;
		deletingSeries = false;
		const steps = stepsBackTo(new URL(data.back.href, location.href));

		if (steps) history.go(-steps);
		else await goto(data.back.href, { replaceState: true });
	}

	// ---- compact top bar ---------------------------------------------------------
	// Once CONTINUE has scrolled away, the top bar carries the title and a ▶ cell.

	let cta = $state<HTMLElement | null>(null);
	let ctaVisible = $state(true);
	$effect(() => {
		if (!cta) return;
		const io = new IntersectionObserver(([e]) => (ctaVisible = e.isIntersecting), {
			rootMargin: '-80px 0px 0px 0px'
		});
		io.observe(cta);
		return () => io.disconnect();
	});

	// ---- selection -------------------------------------------------------------------

	let selecting = $state(false);
	const selected = new SvelteSet<number>();
	let anchor = $state<number | null>(null);
	let rangeArmed = $state(false);

	function onrow(e: SeriesEntry) {
		// A tap on a chapter reads it; while selecting, it selects.
		// eslint-disable-next-line svelte/no-navigation-without-resolve -- readHref() resolves
		if (!selecting) return void goto(readHref(e.id));
		if (rangeArmed && anchor !== null) {
			for (const id of rangeBetween(series.entries, anchor, e.id)) selected.add(id);
			rangeArmed = false;
		} else if (selected.has(e.id)) {
			selected.delete(e.id);
		} else {
			selected.add(e.id);
		}
		anchor = e.id;
	}

	function stopSelecting() {
		selecting = false;
		rangeArmed = false;
		anchor = null;
		selected.clear();
	}

	const counts = $derived(bulkCounts(series.entries, selected));

	// ---- sort, remembered per series on this device --------------------------------

	let descending = $state(false);
	const sortKey = $derived(`tsundoku:series-sort:${series.id}`);
	$effect(() => {
		try {
			descending = browser && localStorage.getItem(sortKey) === 'desc';
		} catch {
			descending = false;
		}
	});
	function setDescending(v: boolean) {
		descending = v;
		try {
			if (v) localStorage.setItem(sortKey, 'desc');
			else localStorage.removeItem(sortKey);
		} catch {
			// Storage unavailable: the flip still holds for this visit.
		}
	}

	// ---- device cache ------------------------------------------------------------------
	// Which entries are cached on this device (doc/OFFLINE.md): the reader keeps
	// the next chapters, and ↓ CACHE adds the selection. A hidden series is never
	// cached, nor anything while revealed or incognito.
	const cachedEntries = $derived(new Set(offline.entries[series.id] ?? []));
	const cachedCount = $derived(offline.cached[series.id] ?? 0);
	const mayCache = $derived(!series.hidden && !data.reveal && !data.incognito && offline.online);
	const toCache = $derived(
		mayCache
			? series.entries
					.filter((e) => selected.has(e.id) && e.available && !cachedEntries.has(e.id))
					.map((e) => e.id)
			: []
	);
	const toDrop = $derived([...selected].filter((id) => cachedEntries.has(id)));
	let caching = $state(false);
	/**
	 * A phone over Wi-Fi (doc/WIFI.md, 3D): plain http on a home address, where
	 * the browser keeps no offline storage, so ↓ CACHE can't work. Dimmed, with
	 * the one line after sign-in that says why. Known after hydration only.
	 */
	const noCache = $derived(browser && !window.isSecureContext);
	async function cacheSelection() {
		caching = true;
		try {
			await cacheMany(series.id, toCache, series.kind === 'anime');
		} finally {
			caching = false;
		}
	}

	// ---- downloading (doc/DOWNLOADING.md) ----------------------------------------------------
	const dlStates = $derived(
		data.downloads.kind === 'ok'
			? new Map(
					Object.entries(data.downloads.states).map(([k, v]) => [Number(k), v as DownloadState])
				)
			: null
	);
	const canDownload = $derived(!!dlStates && offline.online);
	/** The bulk bar's DOWNLOAD: selected chapters it would queue or retry. */
	const toDownload = $derived(
		canDownload ? [...selected].filter((id) => rowAction(dlStates!.get(id)) !== null) : []
	);
	const allIds = $derived(dlStates ? allToDownload(series.entries, dlStates) : []);
	// An anime's ALL chooses its QUALITY, with each height's ABOUT size (Index Anime Series, confirm).
	let allQuality = $state(0);
	let sizes = $state<{
		sizes: { height: number; bytes: number | null }[];
		free: number | null;
	} | null>(null);
	$effect(() => {
		if (!data.anime || !data.confirmAll) return;
		allQuality ||= data.anime.quality;
		if (sizes) return;
		void fetch(resolve('/api/anime/series/[id]/sizes', { id: String(series.id) }))
			.then((r) => (r.ok ? r.json() : null))
			.then((j) => (sizes = j ?? { sizes: [], free: null }))
			.catch(() => (sizes = { sizes: [], free: null }));
	});
	const allConfirm = $derived(
		data.anime
			? animeConfirm({
					entries: series.entries,
					ids: allIds,
					elsewhere: data.downloads.kind === 'ok' ? data.downloads.queuedElsewhere : 0,
					each:
						sizes?.sizes.find((x) => x.height === allQuality)?.bytes ??
						sizes?.sizes.find((x) => x.height <= allQuality)?.bytes ??
						null,
					free: sizes?.free ?? null,
					folder: data.anime.folder
				})
			: confirmLines(
					series.entries,
					allIds,
					data.downloads.kind === 'ok' ? data.downloads.queuedElsewhere : 0
				)
	);
	const downloaded = $derived(form && 'downloaded' in form ? form.downloaded : null);
	// Live while the engine answers: only the downloading chapter moves; anything else reads the page again.
	const watching = $derived(canDownload);
	$effect(() => {
		if (!watching) return;
		return watchQueue(() => void invalidateAll());
	});
	/** ALL's confirmation lives in the URL; closing it takes the parameter away. */
	function closeAll(reload = false) {
		const u = new URL(page.url);
		u.searchParams.delete('download');
		// eslint-disable-next-line svelte/no-navigation-without-resolve -- the current, resolved path
		return goto(u, { replaceState: true, noScroll: true, keepFocus: true, invalidateAll: reload });
	}

	// `?edit=tags` (the library sheet's TAGS button) opens straight into editing.
	// svelte-ignore state_referenced_locally
	let editing = $state(data.editing);
</script>

<svelte:head><title>{series.title} · tsundoku</title></svelte:head>

<div class="series" class:selecting>
	{#if selecting}
		<header class="bar inverse" aria-label="Selection">
			<button
				type="button"
				class="cell x"
				aria-label="Stop selecting"
				data-focus-mark="in"
				onclick={stopSelecting}>✕</button
			>
			<div class="mid count" aria-live="polite">
				{selected.size} SELECTED{rangeArmed ? ' · TAP THE OTHER END' : ''}
			</div>
			<button
				type="button"
				class="cell"
				class:armed={rangeArmed}
				aria-pressed={rangeArmed}
				disabled={anchor === null}
				data-focus-mark="in"
				onclick={() => (rangeArmed = !rangeArmed)}>RANGE</button
			>
			<button
				type="button"
				class="cell"
				data-focus-mark="in"
				onclick={() =>
					series.entries.filter((e) => e.readAt === null).forEach((e) => selected.add(e.id))}
				>ALL UNREAD</button
			>
		</header>
	{:else if reordering}
		<form
			method="POST"
			action="?/reorder"
			use:enhance={() =>
				async ({ update }) => {
					await update();
					reordering = false;
				}}
			class="bar inverse"
			aria-label="Reorder"
		>
			<button
				type="button"
				class="cell x"
				aria-label="Cancel reordering"
				data-focus-mark="in"
				onclick={() => (reordering = false)}>✕</button
			>
			<div class="mid count">
				<span class="long">REORDER · {series.entries.length}</span><span class="short">REORDER</span
				>
			</div>
			<button type="button" class="cell" data-focus-mark="in" onclick={() => orderBy('date')}
				>BY DATE</button
			>
			<button type="button" class="cell" data-focus-mark="in" onclick={() => orderBy('title')}
				>BY TITLE</button
			>
			{#each order as id (id)}<input type="hidden" name="entry" value={id} />{/each}
			<button type="submit" class="cell done" data-focus-mark="in">DONE</button>
		</form>
	{:else if data.book}
		<header class="bar" aria-label="Book">
			<!-- eslint-disable-next-line svelte/no-navigation-without-resolve -- withParam() keeps the current, resolved path -->
			<a class="cell back" href={withParam(page.url, 'book', null)} data-focus-mark="in">
				<span class="arrow">←</span>
				<span class="back-label">{series.title.toUpperCase()}</span>
			</a>
			<div class="mid title shown">{data.book.title}</div>
		</header>
	{:else}
		<header class="bar" class:compact={!ctaVisible} aria-label="Series">
			<!-- eslint-disable-next-line svelte/no-navigation-without-resolve -- data.back.href is a library URL built on the server -->
			<a
				class="cell back"
				href={data.back.href}
				use:backLink
				data-focus-mark="in"
				data-focus-id="series-back"
			>
				<span class="arrow">←</span>
				<span class="back-label">{data.back.label.toUpperCase()}</span>
			</a>
			<div class="mid title">{series.title}</div>
			<!-- eslint-disable svelte/no-navigation-without-resolve -- readHref() resolves -->
			<a
				class="cell go"
				href={action.entry ? readHref(action.entry.id) : undefined}
				data-focus-mark="in"
				data-focus-id="series-continue"
				data-focus-start="true"
				>{quiet ? '↺' : '▶'} {quiet ? 'READ AGAIN' : action.short || action.label}</a
			>
			<!-- eslint-enable svelte/no-navigation-without-resolve -->
			<NavLine />
		</header>
	{/if}

	<form method="POST" action="?/markThrough" use:enhance bind:this={throughForm} hidden>
		<input type="hidden" name="through" value={throughId} />
	</form>

	{#if readBand && data.addedFrom && !refusal}
		<StartTrail
			start={data.start}
			prefix={addedDetail(series.entries.length, data.addedQueued, !!data.anime)}
		>
			{#snippet extra()}
				<form method="POST" action="?/undoSourceAdd" use:enhance>
					<input type="hidden" name="from" value={data.addedFrom} />
					<button type="submit">{m.start_undo()}</button>
				</form>
			{/snippet}
		</StartTrail>
	{:else}
		<StartTrail start={data.start} />
	{/if}

	<!-- An action refused (a move, a take-out, a delete): it says why, never silently. -->
	{#if data.addedFrom && !refusal && !readBand}
		<!-- After adding (Download States 1e): every chapter NOT DOWNLOADED, FIRST 10 offered below. -->
		<!-- ADD AND DOWNLOAD on the preview (card c205): what it queued, or that the queue didn't answer. -->
		<Band
			title="ADDED TO THE LIBRARY"
			detail={addedDetail(series.entries.length, data.addedQueued, !!data.anime)}
		>
			{#snippet action()}
				<form method="POST" action="?/undoSourceAdd" use:enhance>
					<input type="hidden" name="from" value={data.addedFrom} />
					<button type="submit">UNDO</button>
				</form>
			{/snippet}
		</Band>
	{/if}
	{#if data.moved && !refusal}
		<!-- MOVE (doc/MOVE.md; Migrate-Moved): the same series, its new source, UNDO. -->
		<Band
			title="MOVED TO {(data.move.source || 'ANOTHER SOURCE').toUpperCase()}"
			detail={movedDetail}
		>
			{#snippet action()}
				<form method="POST" action="?/undoMove" use:enhance>
					<button type="submit">UNDO</button>
				</form>
			{/snippet}
		</Band>
	{:else if refusal}
		<Band title={refusal} detail="NOTHING CHANGED" />
	{:else if downloaded && downloaded.missing > 0}
		<!-- Chapters the source no longer lists, after one refresh: queued what it could. -->
		<Band
			title="{downloaded.missing} NOT AT THE SOURCE"
			detail="{downloaded.queued} QUEUED · THE REST STAY NOT DOWNLOADED"
		/>
	{/if}

	{#if refreshed}
		<!-- REFRESH's answer (c220): it downloads nothing, so the band names the way to keep them. -->
		<Band
			title={refreshed.added === 0
				? m.series_refresh_none()
				: refreshed.kind === 'anime'
					? m.series_refresh_new_episode({ count: refreshed.added, n: num(refreshed.added) })
					: m.series_refresh_new({ count: refreshed.added, n: num(refreshed.added) })}
			detail={refreshed.added === 0 ? m.series_refresh_none_detail() : m.series_refresh_detail()}
		/>
	{:else if markedThrough}
		<Band
			title={markedThrough.ids.length === 0
				? `NOTHING TO MARK · ALL READ THROUGH ${markedThrough.label.toUpperCase()}`
				: `MARKED READ THROUGH ${markedThrough.label.toUpperCase()}`}
			detail={markedThrough.ids.length === 0
				? undefined
				: `${markedThrough.ids.length} CHAPTER${markedThrough.ids.length === 1 ? '' : 'S'}`}
		>
			{#snippet action()}
				{#if markedThrough.ids.length > 0}
					<form method="POST" action="?/mark" use:enhance>
						{#each markedThrough.ids as id (id)}<input
								type="hidden"
								name="entry"
								value={id}
							/>{/each}
						<button type="submit" name="read" value="0">UNDO</button>
					</form>
				{/if}
			{/snippet}
		</Band>
	{:else if takenOut}
		<Band
			title="TAKEN OUT · {takenOut.title?.toUpperCase()}"
			detail="A SINGLE BOOK AGAIN · KEEPS ITS RATING, FAV, TAGS AND PAGE"
		>
			{#snippet action()}
				<form method="POST" action="?/undoTakeOut" use:enhance>
					<input type="hidden" name="single" value={takenOut.single} />
					<input type="hidden" name="position" value={takenOut.position} />
					<button type="submit">UNDO</button>
				</form>
			{/snippet}
		</Band>
	{:else if created > 0 && !reordering}
		<Band
			title={added ? `${created} ${unit} ADDED` : `SERIES CREATED · ${created} ${unit}`}
			detail={added ? 'AT THE END · ORDER TO CHANGE' : `ORDERED ${createdOrder} · ORDER TO CHANGE`}
		>
			{#snippet action()}
				<form method="POST" action={added ? '?/undoAdd' : '?/ungroup'} use:enhance={replacing}>
					{#each (added ?? '').split(',').filter(Boolean) as id (id)}<input
							type="hidden"
							name="entry"
							value={id}
						/>{/each}
					<button type="submit">UNDO</button>
				</form>
			{/snippet}
		</Band>
	{/if}

	<div class="body">
		{#if !selecting && !reordering && !data.book}
			<div class="panel-col">
				<SeriesPanel
					{series}
					ringDownload={ring === 'download'}
					readOnline={!!dlStates && offline.online}
					shelves={data.shelves}
					cached={cachedCount}
					bind:cta
					onedit={() => (editing = true)}
					ondelete={() => (deletingSeries = true)}
					suggestion={data.suggestion}
					{dismissedKey}
					onreview={() => (reviewing = true)}
					ocr={data.ocr}
					twin={data.twin}
					words={data.words}
					editions={data.editions}
					link={data.link}
					tracking={data.tracking}
					ranobe={data.ranobe}
					seasons={data.seasons}
					downloads={data.downloads}
					move={data.move}
					tagSource={data.tagSource}
					noVideo={data.move.band}
					work={data.work}
					readMs={data.readMs}
					takenOut={form && 'workTakenOut' in form
						? {
								facts: form.workTakenOut as TakeOutFacts,
								from: String(('workFrom' in form && form.workFrom) || '')
							}
						: null}
					hideFacts={form && 'hideFacts' in form
						? (form.hideFacts as {
								hidden: number[];
								out: TakeOutFacts[];
								whole: number[];
								works: number;
							})
						: null}
				/>
			</div>
		{/if}
		<div class="list-col">
			{#if data.book}
				<PageGrid {series} book={data.book} cover={data.cover} />
			{:else if books}
				<BookGrid
					{series}
					{reordering}
					bind:order
					onbook={openBook}
					onlong={(e) => (sheetBookId = e.id)}
					onorder={startOrder}
				/>
			{:else if doujin}
				<PageGrid {series} cover={data.cover} editions={data.editions} />
			{:else if series.kind === 'anime'}
				<EpisodeList
					{series}
					{selecting}
					{selected}
					cached={cachedEntries}
					{onrow}
					onselect={() => (selecting = true)}
					onlong={markThrough}
					downloads={dlStates}
				/>
			{:else}
				<EntryList
					{series}
					{selecting}
					{selected}
					cached={cachedEntries}
					bind:descending={() => descending, setDescending}
					{onrow}
					onselect={() => (selecting = true)}
					onlong={markThrough}
					downloads={dlStates}
					{canDownload}
					readOnline={!!dlStates}
				/>
			{/if}
		</div>
	</div>

	{#if selecting}
		<form
			method="POST"
			action="?/mark"
			use:enhance={() =>
				async ({ update }) =>
					update({ reset: false })}
			class="bulk"
			class:wrap={!!dlStates}
			class:noted={noCache}
		>
			{#each [...selected] as id (id)}<input type="hidden" name="entry" value={id} />{/each}
			{#if dlStates}
				<!-- DOWNLOAD first, counted like the others (Index Series Download, select). -->
				<button type="submit" formaction="?/download" disabled={toDownload.length === 0}>
					<span>DOWNLOAD</span><span class="n">{toDownload.length}</span>
				</button>
			{/if}
			<button type="submit" name="read" value="1" disabled={counts.markRead === 0}>
				<span>MARK READ</span><span class="n">{counts.markRead}</span>
			</button>
			<button type="submit" name="read" value="0" disabled={counts.markUnread === 0}>
				<span>MARK UNREAD</span><span class="n">{counts.markUnread}</span>
			</button>
			<!-- The device cache (doc/OFFLINE.md): counts are what each would change. -->
			<button
				type="button"
				class="cache"
				disabled={noCache || toCache.length === 0 || caching}
				onclick={cacheSelection}
			>
				<span>{caching ? '↓ CACHING…' : '↓ CACHE'}</span><span class="n">{toCache.length}</span>
			</button>
			<button
				type="button"
				class="cache"
				disabled={noCache || toDrop.length === 0}
				onclick={() => dropMany(toDrop)}
			>
				<span>REMOVE CACHE</span><span class="n">{toDrop.length}</span>
			</button>
			{#if noCache}
				<div class="no-cache">
					OVER WI-FI THE PHONE CAN'T KEEP CHAPTERS · TAILSCALE CAN, OR READ THEM ON THE COMPUTER
				</div>
			{/if}
		</form>
	{/if}
</div>

<BookSheet
	{series}
	book={sheetBook}
	others={data.otherSeries}
	onclose={() => (sheetBookId = null)}
	onpages={openBook}
	ondelete={(b) => {
		sheetBookId = null;
		deletingBook = b;
	}}
	ontags={(b) => {
		sheetBookId = null;
		tagsBookId = b.id;
	}}
/>

<!-- ALL N asks first, with the count, the size and the queue it joins; NEXT 10 never does. -->
<ConfirmSheet
	open={data.confirmAll && allIds.length > 0}
	title={allConfirm.title}
	lines={allConfirm.lines}
	confirm="DOWNLOAD {allIds.length}"
	action="?/download"
	fields={data.anime ? { which: 'all', quality: String(allQuality) } : { which: 'all' }}
	onclose={() => void closeAll()}
	ondone={() => closeAll(true)}
	extra={data.anime ? qualityChoice : undefined}
/>

{#snippet qualityChoice()}
	<div class="q-row">
		<div class="q-label">QUALITY</div>
		<div class="q-body">
			<div class="q-seg">
				{#each [1080, 720, 360] as h (h)}
					{@const b = sizes?.sizes.find((x) => x.height === h)?.bytes ?? null}
					<button type="button" class:on={allQuality === h} onclick={() => (allQuality = h)}>
						<span>{h}P</span><span class="q-s">{b ? formatBytes(b * allIds.length) : '…'}</span>
					</button>
				{/each}
			</div>
			<div class="q-note">
				{data.anime?.quality}P IS THE DEFAULT IN SETTINGS · THIS CHOICE IS FOR THESE {allIds.length}
			</div>
		</div>
	</div>
{/snippet}

<!-- Deleting asks first (doc/DELETING.md). -->
<ConfirmSheet
	open={deletingSeries}
	title="DELETE {series.title.toUpperCase()}?"
	lines={[
		`${series.entries.length} ${series.entries.length === 1 ? 'ENTRY' : 'ENTRIES'} · ${fileMeta(series.entries)}`,
		'ITS FILES MOVE TO THE TRASH FOLDER ON THE WORKSTATION.',
		'ITS READING HISTORY GOES WITH IT.',
		'A SCAN OR A SYNC WON’T BRING IT BACK.'
	]}
	confirm="DELETE"
	action="?/delete"
	fields={{}}
	onclose={() => (deletingSeries = false)}
	ondone={leaveDeleted}
/>
<ConfirmSheet
	open={deletingBook !== null}
	title="DELETE {(deletingBook?.title || 'THIS BOOK').toUpperCase()}?"
	lines={[
		`FROM ${series.title.toUpperCase()} · ${deletingBook ? fileMeta([deletingBook]) : ''}`,
		'ITS FILES MOVE TO THE TRASH FOLDER ON THE WORKSTATION.',
		'THE SERIES KEEPS ITS OTHER BOOKS.',
		'A SCAN OR A SYNC WON’T BRING IT BACK.'
	]}
	confirm="DELETE BOOK"
	action="?/deleteBook"
	fields={{ entry: String(deletingBook?.id ?? '') }}
	onclose={() => (deletingBook = null)}
	ondone={async (r) => {
		deletingBook = null;
		// The series' last book: the series went with it.
		if (r.type === 'redirect') await goto(r.location, { replaceState: true });
		else await invalidateAll();
	}}
/>

{#if data.suggestion}
	<GroupSheet
		open={reviewing}
		suggested
		books={data.suggestion.books}
		existing={data.otherSeries}
		onclose={() => (reviewing = false)}
	/>
{/if}

<EditSheet
	open={editing}
	{series}
	shelves={data.shelves}
	tagMessage={form && 'tagMessage' in form ? form.tagMessage : undefined}
	onclose={() => (editing = false)}
/>
<!-- A book's own tags (doc/BOOKS.md): the same sheet, the book's tags only. -->
<EditSheet
	open={tagsBook !== null}
	{series}
	shelves={data.shelves}
	book={tagsBook}
	tagMessage={form && 'tagMessage' in form ? form.tagMessage : undefined}
	onclose={() => (tagsBookId = null)}
/>

<style>
	/* An anime's ALL: QUALITY, as Index Anime Series' confirm draws it. */
	.q-row {
		display: flex;
		align-items: stretch;
		border-bottom: var(--hairline);
	}
	.q-label {
		display: flex;
		align-items: center;
		width: 120px;
		padding-left: 24px;
		box-sizing: border-box;
		flex-shrink: 0;
		font: 500 12px var(--font-mono);
		letter-spacing: 0.06em;
		color: var(--text-2);
		border-right: var(--hairline);
	}
	.q-body {
		flex: 1;
		display: flex;
		flex-direction: column;
		gap: 10px;
		padding: 14px 18px;
	}
	.q-seg {
		display: flex;
		border: 1px solid var(--line-2);
		height: 56px;
		font: 500 14px var(--font-mono);
	}
	.q-seg button {
		flex: 1;
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		gap: 4px;
		border: 0;
		border-left: 1px solid var(--line-2);
		border-radius: 0;
		background: transparent;
		color: var(--text-1);
		font: inherit;
		cursor: pointer;
	}
	.q-seg button:first-child {
		border-left: 0;
	}
	.q-seg button.on {
		background: var(--text-1);
		color: var(--surface-page);
	}
	.q-s {
		font-weight: 400;
		font-size: 12px;
	}
	.q-note {
		font: 400 12px var(--font-mono);
		color: var(--text-2);
	}

	.series {
		display: flex;
		flex-direction: column;
		flex: 1;
		--list-top: var(--header-h);
	}
	.series.selecting {
		padding-bottom: 76px;
	}

	/* ---- top bar ---- */
	.bar {
		position: sticky;
		top: 0;
		z-index: 5;
		flex-shrink: 0;
		display: flex;
		align-items: stretch;
		height: var(--header-h);
		border-bottom: var(--hairline);
		background: var(--surface-page);
	}
	.bar.inverse {
		background: var(--surface-inverse);
		color: var(--text-inverse);
		border-bottom: 0;
	}
	.cell {
		display: flex;
		align-items: center;
		gap: 14px;
		padding: 0 var(--pad);
		border: 0;
		border-radius: 0;
		background: transparent;
		color: inherit;
		font: 500 14px var(--font-mono);
		letter-spacing: 0.04em;
		white-space: nowrap;
		cursor: pointer;
	}
	.cell:disabled {
		cursor: default;
	}
	.bar:not(.inverse) .cell.back {
		border-right: var(--hairline);
		color: var(--text-1);
	}
	.inverse .cell {
		border-left: 1px solid var(--text-2);
	}
	.inverse .cell.x {
		border-left: 0;
		border-right: 1px solid var(--text-2);
		font: 500 18px var(--font-mono);
	}
	.inverse .cell:disabled {
		opacity: 0.4;
	}
	.cell.done {
		background: var(--accent);
		color: var(--on-accent);
	}
	.mid .short {
		display: none;
	}
	@media (max-width: 599px) {
		.mid .long {
			display: none;
		}
		.mid .short {
			display: inline;
		}
	}
	.title.shown {
		visibility: visible;
	}
	.cell.armed {
		background: var(--accent);
		color: var(--on-accent);
	}
	.arrow {
		font-size: 17px;
	}
	.mid {
		flex: 1;
		min-width: 0;
		display: flex;
		align-items: center;
		padding: 0 18px;
	}
	.count {
		font: 500 17px var(--font-mono);
	}
	.title {
		font: 500 17px var(--font-sans);
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
		visibility: hidden;
	}
	.go {
		display: none;
		text-decoration: none;
		background: var(--accent);
		color: var(--on-accent);
	}
	/* Compact: CONTINUE has scrolled away, so the bar carries title and ▶. */
	.bar.compact .title {
		visibility: visible;
	}
	.bar.compact .go {
		display: flex;
	}
	.bar.compact .back-label {
		display: none;
	}
	@media (max-width: 599px) {
		.back-label {
			font-size: 13px;
		}
	}

	/* ---- frame: header above the list in portrait, a panel beside it in landscape ---- */
	.body {
		display: flex;
		flex-direction: column;
		flex: 1;
		min-height: 0;
	}
	.list-col {
		min-width: 0;
	}
	@media (min-width: 1024px) {
		.series {
			--list-top: 0px;
		}
		.body {
			flex-direction: row;
			height: calc(100dvh - var(--header-h) - var(--banner-h, 0px));
			flex: none;
		}
		.panel-col {
			flex-shrink: 0;
			width: 440px;
			overflow-y: auto;
			border-right: var(--hairline);
		}
		.list-col {
			flex: 1;
			overflow-y: auto;
			--rail-h: calc(100dvh - var(--header-h) - var(--banner-h, 0px) - 52px);
		}
	}

	/* ---- bulk bar ---- */
	.bulk {
		position: fixed;
		left: var(--sheet-left, 0);
		right: 0;
		bottom: 0;
		z-index: 10;
		display: flex;
		height: 76px;
		border-top: var(--rule-strong);
		background: var(--surface-page);
		padding-bottom: env(safe-area-inset-bottom);
	}
	.bulk button {
		flex: 1;
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		gap: 5px;
		border: 0;
		border-right: var(--hairline);
		border-radius: 0;
		background: transparent;
		color: var(--text-1);
		font: 500 14px var(--font-mono);
		letter-spacing: 0.04em;
		cursor: pointer;
	}
	.bulk button:last-child {
		border-right: 0;
	}
	.bulk button:disabled {
		opacity: 0.4;
		cursor: default;
	}
	.bulk button:active:not(:disabled) {
		background: var(--surface-inverse);
		color: var(--text-inverse);
	}
	/* Over Wi-Fi (doc/WIFI.md, 3D): the reason under the row, the cache cells at 0.35. */
	.bulk.noted {
		flex-wrap: wrap;
		height: auto;
	}
	.bulk.noted:not(.wrap) button {
		height: 76px;
	}
	.bulk.noted button.cache:disabled {
		opacity: 0.35;
	}
	.no-cache {
		flex-basis: 100%;
		grid-column: 1 / -1;
		padding: 10px 16px 14px;
		border-top: var(--hairline);
		font: 400 12px/1.45 var(--font-mono);
		color: var(--text-2);
	}
	.bulk .n {
		font: 400 12px var(--font-mono);
		color: var(--text-2);
	}
	@media (max-width: 599px) {
		.bulk button {
			font-size: 12px;
		}
		/* Five actions don't fit 360: two rows of cells, as the library's (Index Series Download, select). */
		.bulk.wrap {
			display: grid;
			grid-template-columns: repeat(3, 1fr);
			height: auto;
		}
		.bulk.wrap button {
			height: 60px;
			border-bottom: var(--hairline);
		}
	}

	/* ---- the TV (c238; TV-Series) ----------------------------------------- */
	@media (pointer: none) and (min-width: 900px) {
		.bar {
			margin-top: var(--safe-y);
		}
		.cell {
			font: var(--type-control);
			letter-spacing: 0.02em;
		}
		.mid {
			padding: 0 22px;
		}
		.title {
			font: var(--type-row);
		}
		/*
		 * The metadata is a 352px column at the left and the list sits beside
		 * it, 32px away, both inside the 48px safe margin (TV-Series: the
		 * panel at 48..400, the list at 432..912).
		 */
		.body {
			flex-direction: row;
			height: calc(100dvh - var(--header-h) - var(--safe-y) - var(--banner-h, 0px));
			flex: none;
			gap: 32px;
			padding: 0 var(--pad);
		}
		.panel-col {
			flex-shrink: 0;
			width: 352px;
			overflow-y: auto;
			border-right: 0;
		}
		.list-col {
			flex: 1;
			overflow-y: auto;
			--rail-h: calc(100dvh - var(--header-h) - var(--safe-y) - var(--banner-h, 0px) - 36px);
		}
		.series {
			--list-top: 0px;
		}
	}
</style>

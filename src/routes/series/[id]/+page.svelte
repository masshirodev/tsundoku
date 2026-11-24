<script lang="ts">
	import { animeConfirm, animeContinue } from '$lib/library/anime';
	import { resolve } from '$app/paths';
	import EpisodeList from './EpisodeList.svelte';
	import FilmStage from './FilmStage.svelte';
	import KindSheet from './KindSheet.svelte';
	import { showAround } from '$lib/library/surroundings';
	import { movedUnit } from './move-words';
	import { markedWords, putBackWords } from './through-words';
	import ConfirmSheet from '$lib/components/chrome/ConfirmSheet.svelte';
	import DeleteSheet from './DeleteSheet.svelte';
	import { entriesLine } from '$lib/reader/library-row';
	import { lostLine } from '$lib/library/highlights';
	import { replacing, settleReplacing, stepsBackTo } from '$lib/back';
	import type { ActionResult, SubmitFunction } from '@sveltejs/kit';
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
	import type { GroupBook } from './other-forms.server';
	import GroupSheet from '../../GroupSheet.svelte';
	import Band, { clearBandUrl } from '$lib/components/chrome/Band.svelte';
	import NavLine from '$lib/components/waiting/NavLine.svelte';
	import { m } from '$lib/paraglide/messages';
	import { num } from '$lib/i18n/format';
	import StartTrail from '$lib/components/start/StartTrail.svelte';
	import { trail } from '$lib/start-trail.svelte';
	import { partOf, trailHere } from '$lib/library/start';
	import { afterNavigate, goto, invalidateAll } from '$app/navigation';
	import { page } from '$app/state';
	import { offline } from '$lib/offline.svelte';
	import { watchQueue } from '$lib/downloads-live.svelte';
	import { cacheMany, dropMany } from '$lib/cache/device';
	import { orderBooks } from '$lib/library/books';
	import { kindFacts } from '$lib/library/kinds';
	import { partDone } from '$lib/library/works';
	import type { AddFacts, TakeOutFacts } from '$lib/server/works';
	import type { SeriesRenameFacts } from '$lib/server/series';
	import type { UnlinkFacts } from '$lib/server/catalogue';
	import type { PendingFailed, Refusal } from '$lib/server/dupes';
	import { withParam, readHref } from '$lib/library/links';
	import {
		BAND_SHELVES,
		SHELF_KEY,
		bandChips,
		bandOrder,
		collectionShelves,
		lastShelf,
		otherShelves,
		shelfLine
	} from '$lib/library/add-shelf';
	import {
		addedDetail,
		allToDownload,
		confirmLines,
		rowAction,
		type DownloadState
	} from '$lib/library/downloads';
	import {
		booksOf,
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
	// A refusal from MIGHT CONTINUE's sheet (`workMessage`) lands here only when
	// the sheet closed on it: the offer it was drawn with has gone.
	/**
	 * The answer the band's ✕ cleared: only that answer, so the next
	 * action's new `form` draws its own band.
	 */
	let droppedAnswer = $state.raw<typeof form>(null);
	const latest = $derived(form === droppedAnswer ? null : form);
	const dropAnswer = () => (droppedAnswer = form);
	const refusal = $derived(
		latest && 'message' in latest && typeof latest.message === 'string'
			? latest.message.toUpperCase()
			: latest && 'workMessage' in latest && typeof latest.workMessage === 'string'
				? latest.workMessage.toUpperCase()
				: ''
	);

	const series = $derived(data.series);
	const doujin = $derived(kindFacts(series.kind).grouping === 'books');
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
		// The books alone: reorderBooks appends an entry it was not given,
		// so an extra keeps its place behind the ordered books.
		order = booksOf(series.entries).map((e) => e.id);
		reordering = true;
	}

	function orderBy(mode: 'date' | 'title') {
		const byId = new Map(booksOf(series.entries).map((e) => [e.id, e]));
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
	/**
	 * A merged show's band: the redirect's own flag, whose UNDO is
	 * UNGROUP. Only while the journal is there: after an undo the band's URL
	 * can be stale, and a stale band must not offer a press that could reach
	 * the books' take-out.
	 */
	const mergedShow = $derived(
		!!data.merged && page.url.searchParams.get('merge') === '1' && created > 0
	);
	/** Its UNDO is in flight: a second press is the 500 this band once caused. */
	let undoingShow = $state(false);
	const undoShow: SubmitFunction = () => {
		undoingShow = true;
		return async (args) => {
			try {
				await settleReplacing(args);
			} finally {
				undoingShow = false;
			}
		};
	};
	const added = $derived(page.url.searchParams.get('added'));
	// Grouped novels are counted by the volume (doc/BOOKS.md).
	const unit = $derived(page.url.searchParams.get('unit') === 'volumes' ? 'VOLUMES' : 'BOOKS');
	const createdOrder = $derived(page.url.searchParams.get('order') ?? 'BY DATE ADDED');
	const takenOut = $derived(latest && 'takenOut' in latest ? latest.takenOut : null);
	/** MIGHT CONTINUE's REVIEW, once its sheet added this series (W7): the band and its UNDO. */
	const workJoined = $derived(
		latest && 'workJoined' in latest ? (latest.workJoined as AddFacts) : null
	);
	/** NOT THIS's key, so its band can offer UNDO. */
	const workOfferDismissed = $derived(
		latest && 'workOfferDismissed' in latest ? String(latest.workOfferDismissed) : null
	);
	/** REVIEW → on MIGHT CONTINUE <WORK>: the sheet, in ADD TO A WORK. */
	let reviewingWork = $state(false);
	/** GROUP AS A WORK on an IN LIBRARY row: the other series, while its sheet is open. */
	let groupingForm = $state<GroupBook | null>(null);
	/** A film collection's GROUP →: the GROUP sheet with the parts in the library. */
	let groupingParts = $state(false);
	/** KIND's CHANGE: the switch's sheet, and the band its move answers with. */
	let kindOpen = $state(false);
	let kindSwitched = $state<{ done: string; where: string } | null>(null);
	type MadeWork = { work: { name: string }; members: unknown[] };
	/**
	 * That sheet's answer, which the sheet hands over (see its `ondone`). It
	 * stands until the next navigation or the next action's answer, as a band
	 * read from `form` does: SvelteKit clears `form` on a navigation and reuses
	 * this component from one series to the next, so `made` is cleared by hand
	 * (`afterNavigate`) or BACK would draw it again. `refused` is its UNDO's
	 * refusal.
	 */
	let made = $state<{ facts: MadeWork; series: number; form: unknown; refused: string } | null>(
		null
	);
	const madeWork = $derived(
		made && made.series === data.series.id && made.form === form ? made : null
	);
	afterNavigate(() => {
		made = null;
	});
	/** `/?/undoWork` is the library's too: its answer is read here, not from `form`. */
	const undoMade: SubmitFunction =
		() =>
		async ({ result, update }) => {
			await update();
			if (result.type === 'success') made = null;
			else if (result.type === 'failure') {
				// `update()` re-reads the page only on a success, and a refusal means
				// what the rows drew has moved on.
				await invalidateAll();
				if (made) made.refused = String(result.data?.workMessage ?? 'COULD NOT UNDO');
			}
		};
	const markedThrough = $derived(latest && 'markedThrough' in latest ? latest.markedThrough : null);
	/** UNDO's answer: what it put back, and what had moved on since the press and was left. */
	const undoneThrough = $derived(latest && 'undoneThrough' in latest ? latest.undoneThrough : null);
	// UNLINK's band: what went, every column of it, so UNDO puts it back.
	const unlinked = $derived(
		latest && 'unlinked' in latest ? (latest.unlinked as UnlinkFacts) : null
	);
	// RENAME's band: the facts the action returned, so UNDO puts back exactly them.
	const renamed = $derived(
		latest && 'renamed' in latest ? (latest.renamed as SeriesRenameFacts) : null
	);
	/**
	 * REFRESH's answer: what the source lists that no entry was.
	 * REFRESH never downloads, so the band says so and leaves NEXT or ALL to
	 * keep them — FOLLOW's own turn won't pick them up either, since they are
	 * no longer new to the source.
	 */
	const refreshed = $derived(
		latest && 'refreshed' in latest
			? (latest.refreshed as { kind: 'manga' | 'anime' | 'novel'; added: number })
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
						: '',
					// MOVE BACK took chapters away: their highlights keep their copies.
					data.moved.lost ? lostLine(data.moved.lost) : ''
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
	const dismissedKey = $derived(latest && 'dismissed' in latest ? latest.dismissed : null);
	const action = $derived(
		kindFacts(series.kind).medium === 'video'
			? animeContinue(series.entries)
			: continueAction(series)
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
	/**
	 * Whether the details column is drawn beside the list. Only then are the two
	 * focus sections (doc/FOCUS.md, "Sections"): a lone list has nothing to be
	 * kept apart from, and as a section it would strand SELECT's fixed bulk bar,
	 * which sits over its bottom edge.
	 */
	const twoColumns = $derived(!selecting && !reordering && !data.book);
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
	 * A phone over Wi-Fi (doc/WIFI.md): plain http on a home address, where
	 * the browser keeps no offline storage, so ↓ CACHE can't work. Dimmed, with
	 * the one line after sign-in that says why. Known after hydration only.
	 */
	const noCache = $derived(browser && !window.isSecureContext);
	async function cacheSelection() {
		caching = true;
		try {
			await cacheMany(series.id, toCache, kindFacts(series.kind).medium === 'video');
		} finally {
			caching = false;
		}
	}

	// ---- downloading (doc/DOWNLOADS.md) ----------------------------------------------------
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
	// An anime's ALL chooses its QUALITY, with each height's ABOUT size.
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
	const downloaded = $derived(latest && 'downloaded' in latest ? latest.downloaded : null);
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

	/**
	 * PUT ON A SHELF under ADDED TO THE LIBRARY (doc/SERIES.md,
	 * "Shelves in the ADDED band"): the user's shelves as chips, one tap each,
	 * several allowed, a second tap takes it off; the last one chosen on this
	 * device first (`SHELF_KEY`, read once, so the chips keep their places
	 * while the band is up). The rules are `add-shelf.ts`', the band /browse
	 * draws for a hidden ADD; the write is this screen's own `?/shelf`, the
	 * SHELVES sheet's. Past `BAND_SHELVES`, and for + NEW SHELF, the SHELVES
	 * sheet itself (`EditSheet`), which has both.
	 */
	let lastAdded = $state<number | null>(null);
	$effect(() => {
		try {
			lastAdded = lastShelf(localStorage.getItem(SHELF_KEY));
		} catch {
			lastAdded = null;
		}
	});
	const addedOn = $derived(new Set<number>(series.collections));
	const addedChips = $derived(
		bandChips(bandOrder(collectionShelves(data.shelves), lastAdded), addedOn, BAND_SHELVES)
	);
	/** EDIT's sheet opened by the band's + NEW SHELF: straight to the name field. */
	let namingShelf = $state(false);
	/** Why the last chip's tap wrote nothing, drawn in the strip so the band and its UNDO stay. */
	let shelfRefused = $state('');
	/**
	 * A chip's post carries the page's own query (`added`, `queued`, `from`):
	 * without script its answer is a load of the action's URL, which would
	 * otherwise lose the band (the `?/undoSourceAdd` form needs `added` too).
	 */
	const shelfAction = $derived.by(() => {
		// eslint-disable-next-line svelte/prefer-svelte-reactivity -- a throwaway copy, never read reactively
		const q = new URLSearchParams(page.url.searchParams);
		for (const k of [...q.keys()]) if (k.startsWith('/')) q.delete(k);
		const rest = q.toString();
		return `?/shelf${rest ? `&${rest}` : ''}`;
	});
	/**
	 * A chip's answer. Put on: remembered as the last chosen once the write
	 * answered, read from what the form posted (`enhance` keeps the first
	 * submit function it is given), and the page read again without touching
	 * `form`. Refused (a shelf deleted elsewhere, the
	 * series gone after an UNDO in another tab): said in the strip and the
	 * page read again, never `form`, whose `message` would put a refusal band
	 * in place of ADDED TO THE LIBRARY and its UNDO.
	 */
	const shelfChosen: SubmitFunction = ({ formData }) => {
		const id = String(formData.get('collection') ?? '');
		const putOn = formData.get('on') === '1';
		shelfRefused = '';
		return async ({ result, update }) => {
			if (result.type === 'failure') {
				const said = result.data?.message;
				shelfRefused = typeof said === 'string' ? said : 'nothing changed';
				await invalidateAll();
				return;
			}
			if (result.type === 'error' && result.status === 404) {
				shelfRefused = 'the series is not in the library now';
				return;
			}
			if (result.type !== 'success') return update({ reset: false });
			if (putOn && lastShelf(id) !== null)
				try {
					localStorage.setItem(SHELF_KEY, id);
				} catch {
					// Storage unavailable: the shelf is still put on, only not offered first.
				}
			// The shelves read again, `form` left alone: applying `{ ok: true }`
			// would clear the bands beside the chips (FIRST 10's answer, …).
			await invalidateAll();
		};
	};
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
				<span class="long">REORDER · {booksOf(series.entries).length}</span><span class="short"
					>REORDER</span
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
				<form method="POST" action="?/undoSourceAdd" use:enhance={replacing}>
					<input type="hidden" name="from" value={data.addedFrom} />
					<input type="hidden" name="origin" value={data.addedOrigin} />
					<button type="submit">{m.start_undo()}</button>
				</form>
			{/snippet}
		</StartTrail>
	{:else}
		<StartTrail start={data.start} />
	{/if}

	<!-- An action refused (a move, a take-out, a delete): it says why, never silently. -->
	{#if data.addedFrom && !refusal && !readBand}
		<!-- After adding: every chapter NOT DOWNLOADED, FIRST 10 offered below. -->
		<!-- ADD AND DOWNLOAD on the preview: what it queued, or that the queue didn't answer. -->
		<Band
			title="ADDED TO THE LIBRARY"
			detail={addedDetail(series.entries.length, data.addedQueued, !!data.anime)}
			ondismiss={() => clearBandUrl(['added', 'queued'])}
		>
			{#snippet action()}
				<form method="POST" action="?/undoSourceAdd" use:enhance={replacing}>
					<input type="hidden" name="from" value={data.addedFrom} />
					<input type="hidden" name="origin" value={data.addedOrigin} />
					<button type="submit">UNDO</button>
				</form>
			{/snippet}
		</Band>
		<!-- PUT ON A SHELF: the band's second line, chips one tap each.
		     Its names are the shelves' own, N OTHER SHELVES and + NEW SHELF; nothing
		     here is named UNDO, HIDE, SHOW, MORE or ALL. -->
		<div class="added-shelves" role="group" aria-label="Put on a shelf">
			<span class="ask" class:on={addedOn.size > 0}>{shelfLine(addedChips.chips, addedOn)}</span>
			{#each addedChips.chips as c (c.id)}
				<form method="POST" action={shelfAction} use:enhance={shelfChosen}>
					<input type="hidden" name="collection" value={c.id} />
					<input type="hidden" name="on" value={addedOn.has(c.id) ? '0' : '1'} />
					<button
						type="submit"
						class="chip"
						class:on={addedOn.has(c.id)}
						aria-pressed={addedOn.has(c.id)}
						>{addedOn.has(c.id) ? '✓ ' : ''}{c.name.toUpperCase()}</button
					>
				</form>
			{/each}
			{#if addedChips.more > 0}
				<button type="button" class="chip" onclick={() => (editing = true)}
					>{otherShelves(addedChips.more)}</button
				>
			{/if}
			<button
				type="button"
				class="chip new"
				onclick={() => {
					namingShelf = true;
					editing = true;
				}}>+ NEW SHELF</button
			>
			{#if shelfRefused}<span class="refused">NOT SHELVED: {shelfRefused.toUpperCase()}</span>{/if}
		</div>
	{/if}
	{#if kindSwitched}
		<!-- The kind switch, done: what moved and where, and UNDO, which moves it back. -->
		<Band
			title={kindSwitched.done}
			detail={kindSwitched.where}
			ondismiss={() => (kindSwitched = null)}
		>
			{#snippet action()}
				<form
					method="POST"
					action="?/undoKindSwitch"
					use:enhance={() =>
						async ({ update }) => {
							kindSwitched = null;
							await update();
						}}
				>
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
			ondismiss={() => clearBandUrl(['moved', 'added', 'kept', 'lost'])}
		>
			{#snippet action()}
				<form method="POST" action="?/undoMove" use:enhance>
					<button type="submit">UNDO</button>
				</form>
			{/snippet}
		</Band>
	{:else if refusal}
		<Band title={refusal} detail="NOTHING CHANGED" ondismiss={dropAnswer} />
	{:else if downloaded && downloaded.missing > 0}
		<!-- Chapters the source no longer lists, after one refresh: queued what it could. -->
		<Band
			title="{downloaded.missing} NOT AT THE SOURCE"
			detail="{downloaded.queued} QUEUED · THE REST STAY NOT DOWNLOADED"
			ondismiss={dropAnswer}
		/>
	{/if}

	{#if refreshed}
		<!-- REFRESH's answer: it downloads nothing, so the band names the way to keep them. -->
		<Band
			title={refreshed.added === 0
				? m.series_refresh_none()
				: kindFacts(refreshed.kind).medium === 'video'
					? m.series_refresh_new_episode({ count: refreshed.added, n: num(refreshed.added) })
					: m.series_refresh_new({ count: refreshed.added, n: num(refreshed.added) })}
			detail={refreshed.added === 0 ? m.series_refresh_none_detail() : m.series_refresh_detail()}
			ondismiss={dropAnswer}
		/>
	{:else if markedThrough}
		<!-- EpisodeList's long press reaches it too: through-words.ts takes the kind. -->
		{@const words = markedWords(series.kind, markedThrough.ids.length, markedThrough.label)}
		<Band title={words.title} detail={words.detail} ondismiss={dropAnswer}>
			{#snippet action()}
				{#if markedThrough.ids.length > 0}
					<!-- Its own action: ?/mark read=0 is MARK UNREAD, which clears the place. -->
					<form method="POST" action="?/undoMarkThrough" use:enhance>
						<input type="hidden" name="facts" value={JSON.stringify(markedThrough.facts)} />
						<button type="submit">UNDO</button>
					</form>
				{/if}
			{/snippet}
		</Band>
	{:else if undoneThrough && undoneThrough.kept > 0}
		<!-- A chapter read or marked since the press stays as it is. -->
		{@const words = putBackWords(series.kind, undoneThrough.undone, undoneThrough.kept)}
		<Band title={words.title} detail={words.detail} ondismiss={dropAnswer} />
	{:else if madeWork}
		<!-- OTHER FORMS' GROUP AS A WORK: the library's own band and UNDO. -->
		<Band
			title={m.offer_work_made({ name: madeWork.facts.work.name.toUpperCase() })}
			detail={madeWork.refused || `${madeWork.facts.members.length} SERIES · EACH KEEPS ITS OWN`}
			ondismiss={() => (made = null)}
		>
			{#snippet action()}
				<form method="POST" action="/?/undoWork" use:enhance={undoMade}>
					<input type="hidden" name="kind" value="create" />
					<input type="hidden" name="facts" value={JSON.stringify(madeWork.facts)} />
					<button type="submit">UNDO</button>
				</form>
			{/snippet}
		</Band>
	{:else if workJoined}
		<!-- REVIEW's sheet added it (W7): the Work's name and the place it took, with UNDO. -->
		<Band
			title="ADDED TO {(workJoined.workName ?? 'THE WORK').toUpperCase()} · PART {data.work?.part ??
				'?'}"
			detail="EACH KEEPS ITS OWN RATING, FAV, FOLLOW, LINK AND FOLDER"
			ondismiss={dropAnswer}
		>
			{#snippet action()}
				<form method="POST" action="?/undoAddToWork" use:enhance>
					<input type="hidden" name="facts" value={JSON.stringify(workJoined)} />
					<button type="submit">UNDO</button>
				</form>
			{/snippet}
		</Band>
	{:else if unlinked}
		<!-- UNLINK in EDIT's ENTRY: the band with UNDO. -->
		<Band
			title="UNLINKED · {(unlinked.title || 'THE ENTRY').toUpperCase()}"
			detail="{unlinked.season !== null ? `S${unlinked.season} · ` : ''}NO PASS LINKS IT AGAIN"
			ondismiss={dropAnswer}
		>
			{#snippet action()}
				<form method="POST" action="?/undoUnlink" use:enhance>
					<input type="hidden" name="facts" value={JSON.stringify(unlinked)} />
					<button type="submit">UNDO</button>
				</form>
			{/snippet}
		</Band>
	{:else if renamed}
		<!-- RENAME: the Work screen's idiom, the new name and the old, with UNDO. -->
		<Band
			title="RENAMED · {renamed.name.toUpperCase()}"
			detail={renamed.name === renamed.title
				? 'THE SAME NAME'
				: `WAS ${renamed.title.toUpperCase()}`}
			ondismiss={dropAnswer}
		>
			{#snippet action()}
				{#if renamed.name !== renamed.title}
					<form method="POST" action="?/undoRename" use:enhance>
						<input type="hidden" name="facts" value={JSON.stringify(renamed)} />
						<button type="submit">UNDO</button>
					</form>
				{/if}
			{/snippet}
		</Band>
	{:else if takenOut}
		<Band
			title="TAKEN OUT · {takenOut.title?.toUpperCase()}"
			detail="A SINGLE BOOK AGAIN · KEEPS ITS RATING, FAV, TAGS AND PAGE"
			ondismiss={dropAnswer}
		>
			{#snippet action()}
				<form method="POST" action="?/undoTakeOut" use:enhance>
					<input type="hidden" name="single" value={takenOut.single} />
					<input type="hidden" name="position" value={takenOut.position} />
					<button type="submit">UNDO</button>
				</form>
			{/snippet}
		</Band>
	{:else if mergedShow}
		<!-- GROUP AS ONE SHOW: one tile, one CONTINUE, and UNDO is UNGROUP. -->
		<Band
			title="MERGED · {created} SEASONS INTO ONE SERIES"
			detail="ONE TILE, ONE CONTINUE · UNDO PUTS THEM BACK"
			ondismiss={() => clearBandUrl(['created', 'merge'])}
		>
			{#snippet action()}
				<form method="POST" action="?/ungroup" use:enhance={undoShow}>
					<input type="hidden" name="show" value="1" />
					<button type="submit" disabled={undoingShow}>UNDO</button>
				</form>
			{/snippet}
		</Band>
	{:else if created > 0 && !reordering && page.url.searchParams.get('merge') !== '1'}
		<Band
			title={added ? `${created} ${unit} ADDED` : `SERIES CREATED · ${created} ${unit}`}
			detail={added ? 'AT THE END · ORDER TO CHANGE' : `ORDERED ${createdOrder} · ORDER TO CHANGE`}
			ondismiss={() => clearBandUrl(['created', 'added', 'order', 'unit'])}
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
		{#if twoColumns}
			<div class="panel-col" data-focus-section="details">
				<SeriesPanel
					{series}
					ringDownload={ring === 'download'}
					highlights={data.highlights}
					readOnline={!!dlStates && offline.online}
					shelves={data.shelves}
					cached={cachedCount}
					bind:cta
					onedit={() => (editing = true)}
					ondelete={() => (deletingSeries = true)}
					suggestion={data.suggestion}
					{dismissedKey}
					onreview={() => (reviewing = true)}
					workOffer={data.workOffer}
					{workOfferDismissed}
					onworkreview={() => (reviewingWork = true)}
					ocr={data.ocr}
					twin={data.twin}
					keptBoth={form && 'refused' in form && 'failed' in form
						? (form as unknown as { refused: Refusal[]; failed: PendingFailed[] })
						: null}
					words={data.words}
					editions={data.editions}
					link={data.link}
					tmdb={data.tmdb}
					film={data.film}
					onkind={data.kindPlans.length ? () => (kindOpen = true) : undefined}
					tracking={data.tracking}
					ranobe={data.ranobe}
					seasons={data.seasons}
					downloads={data.downloads}
					move={data.move}
					tagSource={data.tagSource}
					noVideo={data.move.band}
					work={data.work}
					merged={!!data.merged}
					readMs={data.readMs}
					takenOut={latest && 'workTakenOut' in latest
						? {
								facts: latest.workTakenOut as TakeOutFacts,
								from: String(('workFrom' in latest && latest.workFrom) || '')
							}
						: null}
					{dropAnswer}
					hideFacts={latest && 'hideFacts' in latest
						? (latest.hideFacts as {
								hidden: number[];
								out: TakeOutFacts[];
								whole: number[];
								works: number;
							})
						: null}
				/>
			</div>
		{/if}
		<div class="list-col" data-focus-section={twoColumns ? 'list' : undefined}>
			{#if data.book}
				<PageGrid
					{series}
					book={data.book}
					cover={data.cover}
					downloads={dlStates}
					readOnline={data.readOnline && offline.online}
				/>
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
			{:else if data.film?.film}
				<!-- A film has no list: its column is the stage. -->
				<FilmStage
					seriesId={series.id}
					hue={series.hue}
					facts={data.film.facts}
					collection={data.film.surround?.kind === 'collection' ? data.film.surround.view : null}
					genres={series.tags.filter((t) => t.namespace === 'genre').map((t) => t.value)}
					tagSource={data.tagSource}
					ongroup={() => (groupingParts = true)}
				/>
			{:else if kindFacts(series.kind).medium === 'video'}
				<EpisodeList
					{series}
					{selecting}
					{selected}
					cached={cachedEntries}
					{onrow}
					onselect={() => (selecting = true)}
					onlong={markThrough}
					downloads={dlStates}
					around={data.film?.surround?.kind === 'seasons'
						? showAround(data.film.surround.view)
						: data.around}
					tagSource={data.tagSource}
					otherForms={data.otherForms?.rows ?? null}
					ongroup={(b) => (groupingForm = b)}
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
					otherForms={data.otherForms?.rows ?? null}
					ongroup={(b) => (groupingForm = b)}
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
				<!-- DOWNLOAD first, counted like the others. -->
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
<DeleteSheet
	open={deletingSeries}
	title="DELETE {series.title.toUpperCase()}?"
	lines={[
		entriesLine(series.entries),
		'ITS FILES MOVE TO THE TRASH FOLDER ON THE WORKSTATION.',
		'ITS READING HISTORY GOES WITH IT.',
		'A SCAN OR A SYNC WON’T BRING IT BACK.'
	]}
	confirm="DELETE"
	action="?/delete"
	fields={{}}
	highlights={data.highlights?.n ?? 0}
	why="THEIR QUOTES, COPIES AND NOTES STAY ON THE HIGHLIGHTS PAGE, FROM A SERIES NO LONGER IN THE LIBRARY."
	onclose={() => (deletingSeries = false)}
	ondone={leaveDeleted}
/>
<DeleteSheet
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
	highlights={deletingBook ? (data.highlights?.byEntry[deletingBook.id] ?? 0) : 0}
	why="THEIR QUOTES, COPIES AND NOTES STAY ON THE HIGHLIGHTS PAGE, FROM A BOOK NO LONGER IN THE SERIES."
	onclose={() => (deletingBook = null)}
	ondone={async (r) => {
		deletingBook = null;
		// The series' last book: the series went with it.
		if (r.type === 'redirect') await goto(r.location, { replaceState: true });
		else await invalidateAll();
	}}
/>

{#if data.workOffer}
	<!-- MIGHT CONTINUE's REVIEW → (W7): ADD TO A WORK, this series last and ticked. -->
	<GroupSheet
		open={reviewingWork}
		books={[data.workOffer.series]}
		existing={[]}
		answers={['work']}
		existingWorks={[
			{
				id: data.workOffer.workId,
				name: data.workOffer.name,
				createdAt: data.workOffer.createdAt,
				series: data.workOffer.parts.length
			}
		]}
		offer={{
			workId: data.workOffer.workId,
			name: data.workOffer.name,
			part: data.workOffer.part,
			key: data.workOffer.key,
			parts: data.workOffer.parts
		}}
		onclose={() => (reviewingWork = false)}
	/>
{/if}

{#if data.otherForms}
	<!-- OTHER FORMS' GROUP AS A WORK: both series picked, this one first;
	     ORDER, the name and UNDO are the flow's own. -->
	<GroupSheet
		open={groupingForm !== null}
		books={groupingForm ? [data.otherForms.self, groupingForm] : [data.otherForms.self]}
		existing={[]}
		answers={['work']}
		ondone={(answer) => {
			groupingForm = null;
			if (answer?.made)
				made = { facts: answer.made as MadeWork, series: data.series.id, form, refused: '' };
		}}
		onclose={() => (groupingForm = null)}
	/>
{/if}

{#if data.kindPlans.length}
	<KindSheet
		open={kindOpen}
		title={data.series.title}
		source={data.series.tags.find((t) => t.namespace === 'source')?.value ?? data.series.source}
		kind={data.series.kind}
		plans={data.kindPlans}
		onclose={() => (kindOpen = false)}
		ondone={async (result) => {
			if (result.type !== 'success') return;
			kindOpen = false;
			const done = result.data?.kindSwitched as { done: string; where: string } | undefined;
			if (done) kindSwitched = done;
			await invalidateAll();
		}}
	/>
{/if}

{#if data.film?.groupBooks.length}
	<!-- A film collection's GROUP →: the parts in the library ticked
	     in TMDB's order, free to reorder; a Work, never a chain. -->
	<GroupSheet
		open={groupingParts}
		books={data.film.groupBooks}
		existing={[]}
		answers={['work']}
		ondone={(answer) => {
			groupingParts = false;
			if (answer?.made)
				made = { facts: answer.made as MadeWork, series: data.series.id, form, refused: '' };
		}}
		onclose={() => (groupingParts = false)}
	/>
{/if}

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
	naming={namingShelf}
	tagMessage={form && 'tagMessage' in form ? form.tagMessage : undefined}
	onclose={() => {
		editing = false;
		namingShelf = false;
	}}
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
	/* PUT ON A SHELF: the band's second line, as /browse's AddedBand
	   draws it: the Band's panel and hairline, chips as ShelfPicker's. */
	.added-shelves {
		flex-shrink: 0;
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 8px;
		padding: 10px var(--pad) 12px;
		border-bottom: var(--hairline);
		background: var(--surface-panel);
	}
	.added-shelves .ask {
		font: var(--type-meta);
		color: var(--text-2);
		margin-right: 4px;
	}
	.added-shelves .ask.on {
		color: var(--text-1);
	}
	.added-shelves form {
		display: flex;
	}
	.added-shelves .chip {
		height: 40px;
		padding: 0 12px;
		display: flex;
		align-items: center;
		border: 1px solid var(--line-2);
		border-radius: 0;
		background: transparent;
		color: var(--text-1);
		font: 500 13px var(--font-mono);
		text-decoration: none;
		white-space: nowrap;
		cursor: pointer;
	}
	/* At the right end, under UNDO: a remote's ↓ from UNDO lands in the strip,
	   and ← walks the chips (doc/FOCUS.md: a stop overlapping across the way wins). */
	.added-shelves .chip.new {
		margin-left: auto;
	}
	.added-shelves .chip.on {
		background: var(--surface-inverse);
		color: var(--text-inverse);
	}
	.added-shelves .refused {
		font: var(--type-meta);
		color: var(--text-1);
	}

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
	/* Over Wi-Fi (doc/WIFI.md): the reason under the row, the cache cells at 0.35. */
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
		/* Five actions don't fit 360: two rows of cells, as the library's. */
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

	/* ---- the TV ----------------------------------------- */
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
			/* Under the list's 36px head, and inside its hairline border (1px above
			   and below, the TV's own): with the border counted the list was 2px
			   taller than the column, and a short list's last ↓ scrolled 2px. */
			--rail-h: calc(100dvh - var(--header-h) - var(--safe-y) - var(--banner-h, 0px) - 36px - 2px);
		}
		.series {
			--list-top: 0px;
		}
	}
</style>

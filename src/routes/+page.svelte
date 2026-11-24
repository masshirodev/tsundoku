<script lang="ts">
	import { m } from '$lib/paraglide/messages';
	import Band, { clearBandUrl } from '$lib/components/chrome/Band.svelte';
	import { backLink } from '$lib/back';
	import { enhance } from '$app/forms';
	import type { SubmitFunction } from '@sveltejs/kit';
	import { afterNavigate, beforeNavigate, goto, invalidateAll } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { onMount, tick, untrack } from 'svelte';
	import { MediaQuery, SvelteMap, SvelteSet } from 'svelte/reactivity';
	import { TV } from '$lib/device.svelte';
	import { page } from '$app/state';
	import Banner from '$lib/components/chrome/Banner.svelte';
	import { browser, version } from '$app/environment';
	import UpdateModal from './UpdateModal.svelte';
	import StartList from '$lib/components/start/StartList.svelte';
	import StartFirstDay from '$lib/components/start/StartFirstDay.svelte';
	import { countLine, readLeads } from '$lib/library/start';
	import { pollStart } from '$lib/start-trail.svelte';
	import { updateRun } from '$lib/update-run.svelte';
	import { appUpdater } from '$lib/app/update.svelte';
	import {
		APP_LATER_KEY,
		DONE_KEY,
		LATER_KEY,
		asks,
		laterFor,
		parseLater,
		runningBand,
		type Later
	} from '$lib/updates';
	import SectionLabel from '$lib/components/chrome/SectionLabel.svelte';
	import TopBar from '$lib/components/chrome/TopBar.svelte';
	import Wordmark from '$lib/components/chrome/Wordmark.svelte';
	import ContinueRow from '$lib/components/content/ContinueRow.svelte';
	import CoverTile from '$lib/components/content/CoverTile.svelte';
	import SelectionSheet from './search/SelectionSheet.svelte';
	import WorkTile from '$lib/components/content/WorkTile.svelte';
	import FocusLine from '$lib/components/content/FocusLine.svelte';
	import GridOutline from '$lib/components/waiting/GridOutline.svelte';
	import { waiting } from '$lib/waiting.svelte';
	import { postAction, saves } from '$lib/saves.svelte';
	import { seriesSaves, type Turn } from '$lib/serial-saves';
	import ShelfTabs from '$lib/components/controls/ShelfTabs.svelte';
	import FilterPanel from '$lib/components/controls/FilterPanel.svelte';
	import ChoiceMenu from '$lib/components/controls/ChoiceMenu.svelte';
	import { leave } from '$lib/motion';
	import NewShelfSheet from './NewShelfSheet.svelte';
	import MoreSheet from './MoreSheet.svelte';
	import { inUseOf, pageOrigin } from './servers-in-use';
	import { BACKUP_LABEL } from '$lib/import/backup-preview';
	import {
		activeCount,
		filterParams,
		filterWords,
		kindCells,
		matches,
		NO_FILTERS,
		parseFilters,
		withFilters,
		type FilterKind,
		type Filters
	} from '$lib/library/filters';
	import { langCode } from '$lib/library/editions';
	import SeriesSheet from './SeriesSheet.svelte';
	import SelectionBar from './search/SelectionBar.svelte';
	import PersonView from './PersonView.svelte';
	import TagChip from '$lib/components/controls/TagChip.svelte';
	import { tagHref } from '$lib/library/links';
	import { hueFor } from '$lib/library/cover';
	import { desktop, phone, wide } from '$lib/device.svelte';
	import { offline } from '$lib/offline.svelte';
	import {
		continueSub,
		count,
		dirLabel,
		kindLabel,
		naturalDir,
		newSeed,
		parseSort,
		progress,
		SORT_NAME,
		SORTS,
		sheetMeta,
		unitLabel
	} from '$lib/library/labels';
	import { coverSrc, readHref, seriesHref, shelfHref, withParam } from '$lib/library/links';
	import { upper } from '$lib/i18n/format';
	import type { Rating, RefreshBatch, SeriesCard, Shelf } from '$lib/library/types';
	import { wholeBand, wholeLine, type LibraryCard } from '$lib/library/works';
	import { pageQuery } from '$lib/library/paging';
	import {
		carrySelection,
		landing,
		pickedInOrder,
		pickedOfCard,
		pickedOfPart,
		refreshFacts,
		drawnToNote,
		takeCarried,
		UnseenFacts,
		readShowFacts,
		SHOW_FACTS_WAIT_MS,
		type Picked,
		type ShowFacts
	} from '$lib/library/selection';
	import { kindFacts } from '$lib/library/kinds';
	import type { Snapshot } from './$types';

	let { data, form } = $props();

	/**
	 * A TV lays CONTINUE's cards three across, so ↓ from the first ▶ names the
	 * shelf tabs; everywhere else the rows stack and ↓ is the next row.
	 */
	const tvScreen = new MediaQuery(TV, false);
	/**
	 * GET STARTED on the empty library asks for itself again, so a phone
	 * pairing or a download ticks its step without a reload
	 * (doc/ONBOARDING.md). Exactly while the list is drawn: the condition is
	 * the markup's own (`data.empty`, then a start view not finished), so the
	 * poll stops when the library fills or the list finishes (the effect
	 * re-runs and hands back the stop), and when the page is left (the
	 * effect is torn down), and never starts on a library with series.
	 */
	const startListDrawn = $derived(data.empty && !!data.start && !data.start.finished);
	$effect(() => {
		if (startListDrawn) return pollStart();
	});

	/**
	 * A new version's band (doc/UPDATES.md), once per version: gone once the
	 * friend follows it to SETTINGS, which marks it seen there too.
	 */
	const SEEN = 'tsundoku.update.seen';
	let seenUpdate = $state<string | null>(null);
	$effect(() => {
		try {
			seenUpdate = localStorage.getItem(SEEN);
		} catch {
			// Storage refused (a private window): the band shows until updated.
		}
	});
	const newVersion = $derived(
		data.update && data.update.version !== seenUpdate ? data.update.version : null
	);

	/**
	 * The update modal on entry (doc/UPDATES.md, "Told on entry"):
	 * on the computer, unless LATER snoozed this version within the day. The
	 * band above stays as it was; a hidden UPDATE takes its place and counts.
	 */
	let later = $state<Later | null>(null);
	let appLater = $state<Later | null>(null);
	let doneVersion = $state<string | null>(null);
	$effect(() => {
		try {
			later = parseLater(localStorage.getItem(LATER_KEY));
			appLater = parseLater(localStorage.getItem(APP_LATER_KEY));
			doneVersion = localStorage.getItem(DONE_KEY);
		} catch {
			// Storage refused: the modal asks on every open, and no UPDATED TO band.
		}
	});
	const offer = $derived(data.updateOffer);
	const modalOpen = $derived(
		!!offer?.available &&
			browser &&
			(updateRun.running
				? !updateRun.hidden
				: !!updateRun.failed || asks(offer.available.version, later, Date.now()))
	);
	function snooze() {
		if (!offer?.available) return;
		later = laterFor(offer.available.version, Date.now());
		try {
			localStorage.setItem(LATER_KEY, JSON.stringify(later));
		} catch {
			// Storage refused: closed for this visit only.
		}
	}
	/**
	 * The same modal for tsundoku's Android app, told after the computer's
	 * if both are out: its own LATER, since the two are different releases to wait on.
	 */
	const appOffer = $derived(appUpdater.offer);
	const appModalOpen = $derived(
		!modalOpen &&
			!!appOffer?.available &&
			(appUpdater.pressed
				? !appUpdater.hidden
				: appUpdater.phase === 'offer' && asks(appOffer.available.version, appLater, Date.now()))
	);
	function snoozeApp() {
		if (!appOffer?.available) return;
		appLater = laterFor(appOffer.available.version, Date.now());
		try {
			localStorage.setItem(APP_LATER_KEY, JSON.stringify(appLater));
		} catch {
			// Storage refused: closed for this visit only.
		}
	}
	const hiddenRun = $derived(
		updateRun.running && updateRun.hidden
			? runningBand(updateRun.view?.install ?? null)
			: appUpdater.pressed && appUpdater.hidden
				? runningBand(appUpdater.install)
				: null
	);
	/** UPDATED TO: once, on the reload onto the version UPDATE was pressed for. */
	const updatedTo = $derived(doneVersion === version ? version : null);
	function dropUpdated() {
		doneVersion = null;
		try {
			localStorage.removeItem(DONE_KEY);
		} catch {
			// Storage refused: the band comes back next open, harmless.
		}
	}

	const scanning = $derived(data.scan !== null && data.scan.finishedAt === null);

	/**
	 * The SERIES TO LINK band's ✕ (doc/LINKS.md, "Putting the band
	 * away"): put away on this device, remembered with the counts it was put
	 * away at, as the update band's "seen" is. It comes back only when a count
	 * grows past that: a new series to link, not the same ones again.
	 *
	 * Two counts, because reveal changes the one the band shows: `pub` is the
	 * queue without hidden series, the same number with reveal on or off, and
	 * `all` the queue with them, known only if it was put away with reveal on.
	 * Turning reveal off drops the shown count by the hidden series, and on
	 * again raises it back: measured against `pub`, neither is news. A stored
	 * count follows its own queue down (one reviewed elsewhere), so the next
	 * new one is always news, but `all` is only ever lowered with reveal on,
	 * the one state that counts it. One number, the shown one, would be lowered
	 * by reveal off and beaten by reveal on.
	 */
	const LINKS_PUT_AWAY = 'tsundoku.library.links-put-away';
	type PutAway = { pub: number; all: number | null };
	let linksPutAway = $state<PutAway | null>(null);
	const count0 = (v: unknown) =>
		typeof v === 'number' && Number.isInteger(v) && v >= 0 ? v : null;
	$effect(() => {
		try {
			const raw = localStorage.getItem(LINKS_PUT_AWAY);
			if (raw === null) return;
			const parsed: unknown = JSON.parse(raw);
			// An older build stored the shown count alone, as a bare number.
			if (typeof parsed === 'number') {
				const n = count0(parsed);
				linksPutAway = n === null ? null : { pub: n, all: null };
			} else if (parsed && typeof parsed === 'object') {
				const o = parsed as Record<string, unknown>;
				const pub = count0(o.pub);
				linksPutAway = pub === null ? null : { pub, all: count0(o.all) };
			}
		} catch {
			// Storage refused (a private window) or unreadable: the band shows.
		}
	});
	function rememberLinks(at: PutAway | null) {
		linksPutAway = at;
		try {
			if (at === null) localStorage.removeItem(LINKS_PUT_AWAY);
			else localStorage.setItem(LINKS_PUT_AWAY, JSON.stringify(at));
		} catch {
			// Storage refused: put away for this visit only.
		}
	}
	function putLinksAway() {
		rememberLinks({ pub: data.toLinkPublic, all: data.reveal ? data.toLink : null });
	}
	// Fewer to link than when it was put away: measure the next growth from here.
	$effect(() => {
		const at = linksPutAway;
		if (at === null) return;
		const pub = Math.min(at.pub, data.toLinkPublic);
		const all = data.reveal && at.all !== null ? Math.min(at.all, data.toLink) : at.all;
		if (pub !== at.pub || all !== at.all) untrack(() => rememberLinks({ pub, all }));
	});
	const linksBand = $derived(
		data.toLink > 0 &&
			!data.empty &&
			(linksPutAway === null ||
				data.toLinkPublic > linksPutAway.pub ||
				(data.reveal && linksPutAway.all !== null && data.toLink > linksPutAway.all))
	);

	/**
	 * BACK TO TOP: a corner cell once the grid is about a screen down,
	 * gone again near the top. Not on a TV, where the focus layer moves the
	 * page and BACK climbs to the top (doc/LIBRARY.md, "The top bar").
	 */
	let winY = $state(0);
	let winH = $state(0);
	const farDown = $derived(winH > 0 && winY > winH);
	function toTop() {
		const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
		// The cell goes as the page passes a screen: focus moves to the bar
		// first, or a keyboard's would drop to the page with it.
		const bar = document.querySelector<HTMLElement>('.library > header.bar');
		const first = [...(bar?.querySelectorAll<HTMLElement>('a[href], button') ?? [])].find(
			(el) => el.getClientRects().length > 0
		);
		first?.focus({ preventScroll: true });
		scrollTo({ top: 0, behavior: reduced ? 'instant' : 'smooth' });
	}

	// While an import runs on the workstation, follow it: the band's bytes and
	// the arriving grid come from the job row, re-read every two seconds.
	$effect(() => {
		if (!scanning) return;
		const timer = setInterval(() => void invalidateAll(), 2000);
		return () => clearInterval(timer);
	});
	const justImported = $derived(data.scan !== null && data.scan.finishedAt !== null);
	const isOffline = $derived(!offline.online);

	// ---- pages ------------------------------------------------------------
	// The grid arrives a page at a time (doc/LIBRARY.md, "Pages"): the server
	// sends the first, and the rest are asked for as the end of the grid comes
	// near. `more` is every page after the first.
	let more = $state<LibraryCard[]>([]);
	/**
	 * The show facts of the pages drawn after the first: the load's `groupFacts`
	 * covers its own first page only, and GROUP's sheet can hold a season from
	 * further down. Read through `/series/facts`, the same ask a by-id selection
	 * makes; a hidden series outside reveal is not answered, so nothing is read
	 * for one.
	 */
	let pageShowFacts = $state<Record<string, ShowFacts>>({});
	/**
	 * The show-fact asks still out, as one chain: GROUP's sheet takes
	 * its rows once, on open, so it waits for the last of them before it reads
	 * the selection.
	 */
	let showFactsOut: Promise<void> = Promise.resolve();
	const showFactsOf = (id: number): ShowFacts | null =>
		data.groupFacts[String(id)] ?? pageShowFacts[String(id)] ?? null;
	let loadingMore = $state(false);
	let moreFailed = $state(false);
	/** Bumped whenever the list changes under a request, so a late answer is dropped. */
	let generation = 0;
	/**
	 * The grid's cards: the load's first page, then the pages drawn after it.
	 * A tile in both is drawn once. A load's first page can change under pages
	 * already drawn -- a Work made over two series it listed, a part hidden --
	 * and the grid keys its blocks by `id`, so the same id twice stops the
	 * whole render and the grid keeps what it had (the URL band's
	 * UNDO with the pages loaded, for one). The first page's copy wins: it is the one
	 * the load just said.
	 */
	const series = $derived.by(() => {
		if (data.series.length === 0) return more;
		const have = new Set(data.series.map((c) => c.id));
		return [...data.series, ...more.filter((c) => !have.has(c.id))];
	});
	/**
	 * A page shorter than asked for is the end, whatever `total` said: the shelf
	 * can shrink after the first page (a series hidden, volumes grouped).
	 */
	let ended = $state(false);
	const hasMore = $derived(!ended && data.shelf !== 'cached' && series.length < data.total);
	/** `?dir=`, only when the sort is turned from its own direction. */
	const dirParam = $derived(data.dir === naturalDir(data.sort) ? undefined : data.dir);
	const listKey = $derived(
		`${data.shelf}|${data.tag ?? ''}|${filterParams(data.filters)}|${data.sort}|${data.dir}|${data.seed}|${data.reveal}`
	);
	let shownKey = '';

	/**
	 * How long a page may take before it counts as lost, ending in RETRY.
	 * Without one, a request that never answers leaves the loading flag on and
	 * every later ask is refused until a reload: a silent stall. 30 s against a
	 * measured 6,800-series library (doc/LIBRARY.md, "Pages").
	 */
	const PAGE_WAIT_MS = 30_000;

	/**
	 * A timer and a controller, not `AbortSignal.timeout`: that is Chrome 103
	 * and an old TV box's WebView may not have it, and a throw here would read
	 * as every page failing. The controller goes back to Chrome 66.
	 */
	async function fetchPage(offset: number, limit: number): Promise<LibraryCard[] | null> {
		const asking = new AbortController();
		const timer = setTimeout(() => asking.abort(), PAGE_WAIT_MS);
		try {
			const res = await fetch(
				`/api/library?${pageQuery({ shelf: data.shelf, tag: data.tag, filters: data.filters, sort: data.sort, dir: dirParam, seed: data.seed, offset, limit })}`,
				{ signal: asking.signal }
			);
			if (!res.ok) return null;
			return ((await res.json()) as { series: LibraryCard[] }).series;
		} catch {
			return null;
		} finally {
			clearTimeout(timer);
		}
	}

	/**
	 * Note the show facts of the cards a page brought. The load's `groupFacts`
	 * already answers its own first page; a page after it has none, so GROUP's
	 * sheet would draw the library's line for a season past the first page. One
	 * ask for the ids neither map holds yet. `refresh` re-reads the ids a write
	 * may have changed (a download's HERE count) rather than only the new ones.
	 * A failed read leaves those rows with the library's line rather than
	 * failing the page.
	 *
	 * The ask is chained (`showFactsOut`), so a sheet opened while one is out can
	 * wait for it, and an answer that lands after the list changed (a search, a
	 * filter, a sort) is dropped rather than drawn on the new page's selection,
	 * as `fetchPage`'s is. Each read is bounded (`readShowFacts`), so a
	 * request that never answers settles `null` and the chain moves on rather
	 * than holding every later ask for the life of the page.
	 */
	async function noteShowFacts(cards: readonly LibraryCard[], refresh = false) {
		// A plain record, not a `Set`: a component's `Set` is the lint's
		// `SvelteSet`, and this one is built and thrown away in one turn.
		const want: Record<string, true> = {};
		const known = (id: number) =>
			!refresh &&
			(data.groupFacts[String(id)] !== undefined || pageShowFacts[String(id)] !== undefined);
		const add = (id: number) => {
			if (!known(id)) want[String(id)] = true;
		};
		for (const c of cards) {
			if (c.tile) {
				for (const p of c.tile.parts) add(p.seriesId);
			} else add(c.id);
		}
		const ids = Object.keys(want).map(Number);
		if (ids.length === 0) return;
		const gen = generation;
		showFactsOut = showFactsOut.then(async () => {
			const got = await readShowFacts(ids);
			if (!got || gen !== generation) return;
			pageShowFacts = { ...pageShowFacts, ...got };
		});
		await showFactsOut;
	}

	/**
	 * Positions the shelf has handed back that drew nothing new, the ones a page
	 * repeated because the shelf moved under it. The next page's offset is the
	 * tiles drawn plus these, so a page of nothing but repeats moves on instead
	 * of asking for itself for ever.
	 */
	let skipped = 0;
	/**
	 * Re-reads of the loaded pages queued or out. A check that fires during one
	 * asks for nothing, because the re-read's own settle will look; a check on
	 * every frame would otherwise add requests to a HIDE's or an UNDO's one
	 * read of each page. The observer reporting a real change still asks.
	 */
	let rereads = 0;
	/** Whether a check may ask, or look again: never while something is out or failed. */
	const mayCheck = () => !loadingMore && !moreFailed && rereads === 0;

	async function loadMore() {
		if (loadingMore || !hasMore || isOffline) return;
		loadingMore = true;
		moreFailed = false;
		const gen = generation;
		const next = await fetchPage(series.length + skipped, data.pageSize);
		if (gen === generation) {
			if (next) {
				// Pages are by position, and the shelf can move under them (a series
				// hidden or grouped since): one already shown is not shown twice.
				const have = new Set(series.map((c) => c.id));
				const fresh = next.filter((c) => !have.has(c.id));
				more = [...more, ...fresh];
				void noteShowFacts(fresh);
				skipped += next.length - fresh.length;
				if (next.length < data.pageSize) ended = true;
			} else moreFailed = true;
		}
		if (gen === generation) loadingMore = false;
		void keepGoing();
	}

	/** Whether the end of the grid is in the next stretch to scroll through. */
	const endInReach = (node: HTMLElement) =>
		node.getBoundingClientRect().top < innerHeight + runway();

	/**
	 * The observer only speaks when the end comes near, and only on a change:
	 * it compares each sample with its last, so a reader who reaches the bottom
	 * before a sample sees the row leave leaves it nothing to say. So
	 * whenever the list settles -- a page in, a refresh, a page dropped because
	 * the list changed under it -- measure, and otherwise have the observer look
	 * afresh: `observe` after `unobserve` always delivers a first callback
	 * with the true state.
	 */
	async function keepGoing() {
		await tick();
		if (!mayCheck() || !endNode) return;
		if (endInReach(endNode)) void loadMore();
		else if (endObserver) {
			endObserver.unobserve(endNode);
			endObserver.observe(endNode);
		}
	}

	/**
	 * The pages after the first, read again: queued one at a time, and a write
	 * can await them. `force` asks even when they were already
	 * read for this first page, which `reloadList` does only when that page came
	 * back identical: nothing was queued for it, and a hide or UNDO
	 * past the first page still needs its answer.
	 *
	 * Why read them again at all: a write changed which tiles a loaded page
	 * holds -- a Work hidden whole, one taken out of it -- and the load's
	 * *first* page can come back identical, so SvelteKit keeps `data` and no
	 * effect re-reads the rest. The page then still draws a tile the server has
	 * stopped listing (a HIDE, and its UNDO). The pages are asked for again
	 * by position, so the answer is the list as it is now and the grid keeps
	 * its scroll.
	 */
	let refilling: Promise<void> = Promise.resolve();
	let refilledFor: LibraryCard[] | null = null;
	function refillPages(force = false): Promise<void> {
		const first = data.series;
		if (more.length === 0) return refilling;
		if (!force && refilledFor === first) return refilling;
		refilledFor = first;
		rereads += 1;
		refilling = refilling.then(async () => {
			try {
				// The list may have gone under it while it waited.
				if (more.length === 0) return;
				// The bump and the release go together, as in the effect's own
				// refill: the bump drops a page request already out, and one
				// this refill's `keepGoing` starts must not be left holding the
				// flag with its answer dropped.
				const gen = ++generation;
				loadingMore = false;
				const offset = data.series.length;
				const limit = more.length;
				const pageAgain = await fetchPage(offset, limit);
				if (gen !== generation) return;
				const have = new Set(data.series.map((c) => c.id));
				// Nothing came back: keep the pages already drawn. Emptying them
				// would fold a deep grid to its first page on a blip, and a write
				// that failed to reload would read its band off a tile now gone.
				if (pageAgain) {
					more = pageAgain.filter((c) => !have.has(c.id));
					void noteShowFacts(more, true);
					skipped = 0;
				}
				ended = false;
			} finally {
				rereads -= 1;
				void keepGoing();
			}
		});
		return refilling;
	}

	/**
	 * A write's reload: the load's first page, then the loaded pages after it,
	 * so a tile anywhere in the grid reads what the server stored before the
	 * turn settles. One refill per write: `invalidateAll`
	 * resolves after the effect has queued its own for the new `data.series`,
	 * so this awaits that one rather than asking again. Only a first
	 * page that came back identical leaves nothing queued, and then the pages
	 * past it are asked for here -- the one forced call, for the one case: a
	 * hide or UNDO past the first page moves nothing that page shows, so all of
	 * its change is in the pages after it.
	 */
	async function reloadList() {
		const before = data.series;
		await invalidateAll();
		await refillPages(data.series === before);
	}

	// A new shelf, tag or sort starts again from its first page. The same one
	// re-read (a rating saved, a scan's progress) reads the pages after the
	// first again too, so a tile deep in the grid shows what the server says.
	$effect(() => {
		const key = listKey;
		void data.series;
		untrack(() => {
			loadingMore = false;
			moreFailed = false;
			ended = false;
			if (key !== shownKey) {
				shownKey = key;
				generation += 1;
				refilledFor = null;
				more = [];
				skipped = 0;
				void keepGoing();
				return;
			}
			if (more.length === 0) {
				generation += 1;
				skipped = 0;
				return void keepGoing();
			}
			void refillPages();
		});
	});

	/**
	 * Back to the library (the back gesture) comes back to the same place: the
	 * pages loaded and the scroll. SvelteKit scrolls before it restores, when
	 * only the first page is there to scroll through, so the scroll is set
	 * again once the pages are back. Capped, since it's kept in sessionStorage.
	 */
	/**
	 * Scroll to `y` once the page is tall enough to: on a slow return the
	 * waiting outline covers the grid for a moment, and a scroll then lands
	 * short. Tried each frame for two seconds, and given up the moment the
	 * reader touches or scrolls themselves. `y` may be a measure, taken again
	 * each frame (what is over the grid can change height as the outline goes);
	 * with `whenDrawn`, it keeps trying while the grid is still the outline.
	 */
	function settleScroll(y: number | (() => number), whenDrawn = false) {
		const at = typeof y === 'number' ? () => y : y;
		const until = performance.now() + 2000;
		let stop = false;
		const halt = () => (stop = true);
		const opts = { once: true, passive: true } as const;
		addEventListener('pointerdown', halt, opts);
		addEventListener('wheel', halt, opts);
		addEventListener('keydown', halt, opts);
		const place = () => {
			if (stop) return;
			const to = at();
			scrollTo({ top: to, behavior: 'instant' });
			const there = Math.abs(scrollY - to) <= 2 && !(whenDrawn && outlined);
			if (!there && performance.now() < until) requestAnimationFrame(place);
		};
		place();
	}

	/**
	 * Where the grid was when a navigation began. By the time SvelteKit takes
	 * the snapshot, the waiting outline may have covered the library and its
	 * scroll gone to 0 (doc/WAITING.md), so the place is noted first.
	 */
	let leftAt: number | null = null;
	beforeNavigate(() => {
		leftAt = scrollY;
	});

	export const snapshot: Snapshot<{ key: string; more: LibraryCard[]; y: number }> = {
		capture: () => ({ key: listKey, more: more.slice(0, 4000), y: leftAt ?? scrollY }),
		restore: async (v) => {
			if (!v || v.key !== listKey) return;
			// Only the first page was loaded: no pages to put back, but the place
			// all the same. SvelteKit's own is read once the next screen's data
			// is in, and a load slow enough to outline the grid has moved the
			// page by then (a shelf left from under the bar came back at the
			// top).
			if (v.more.length === 0) {
				settleScroll(v.y);
				return;
			}
			// The bump drops a page already out, so the flag goes with it, as the
			// refill's does: a dropped answer never clears it.
			generation += 1;
			loadingMore = false;
			shownKey = v.key;
			skipped = 0;
			const have = new Set(data.series.map((c) => c.id));
			more = v.more.filter((c) => !have.has(c.id));
			void noteShowFacts(more);
			await tick();
			settleScroll(v.y);
			// What they say now: a rating may have changed on the series screen.
			const gen = generation;
			rereads += 1;
			try {
				const again = await fetchPage(data.series.length, v.more.length);
				if (again && gen === generation) {
					more = again.filter((c) => !have.has(c.id));
					void noteShowFacts(again, true);
				}
			} finally {
				rereads -= 1;
				void keepGoing();
			}
		}
	};

	/**
	 * How far ahead of the viewport a page is asked for: one and a half screens,
	 * and on a TV 3,600 px, because a TV's 540 px screen makes that four rows,
	 * gone in a fifth of a second under a held ↓ (doc/LIBRARY.md, "Pages", has
	 * the measurement). Only a TV holds a key down through the grid.
	 */
	const TV_RUNWAY_PX = 3600;
	const runway = () => (tvScreen.current ? TV_RUNWAY_PX : innerHeight * 1.5);

	/** Asks for the next page while the end of the grid is still a screen or two away. */
	let endNode: HTMLElement | null = null;
	let endObserver: IntersectionObserver | null = null;
	function nearEnd(node: HTMLElement) {
		endNode = node;
		const io = new IntersectionObserver(
			(seen) => {
				if (seen.some((e) => e.isIntersecting)) void loadMore();
			},
			// A percentage off a TV, so it follows a turned screen as `runway()` does.
			{ rootMargin: tvScreen.current ? `0px 0px ${TV_RUNWAY_PX}px 0px` : '0px 0px 150% 0px' }
		);
		endObserver = io;
		io.observe(node);
		/*
		 * The observer's samples are the frames the page gets, and a big page or a
		 * held ↓ takes those away, so the same measure runs on `scroll` too, once a
		 * frame at most, whatever brought the end near (`mayCheck`).
		 */
		let frame = 0;
		const onScroll = () => {
			if (frame) return;
			frame = requestAnimationFrame(() => {
				frame = 0;
				if (mayCheck() && endNode && endInReach(endNode)) void loadMore();
			});
		};
		addEventListener('scroll', onScroll, { passive: true });
		return {
			destroy: () => {
				io.disconnect();
				removeEventListener('scroll', onScroll);
				if (frame) cancelAnimationFrame(frame);
				if (endNode === node) {
					endNode = null;
					endObserver = null;
				}
			}
		};
	}

	// ---- selection -------------------------------------------------------
	let selecting = $state(false);
	let moreOpen = $state(false);
	/** What MORE opens on: its rows, or SERVERS straight from the bar's server cell. */
	let moreAt = $state<'more' | 'servers'>('more');
	const selected = new SvelteSet<number>();
	/**
	 * The facts of each selected series, noted while it was drawn: the
	 * selection outlives a shelf, a kind, a filter and a tag, so the bulk
	 * actions read these rather than the cards on screen
	 * (`src/lib/library/selection.ts`).
	 */
	const facts = new SvelteMap<number, Picked>();
	/** SHOW: the selection listed to review, and what it listed when it opened. */
	let reviewing = $state(false);
	let shownIds = $state<number[]>([]);
	/** SELECT ALL's series from pages never loaded, read by id. */
	const unseen = new UnseenFacts();
	const heldBySheet = () => new Set(reviewing ? shownIds : []);
	/**
	 * SELECT ALL's reads still out: the id GET and the by-id read behind it,
	 * as one promise (a second press joins the first). It never rejects, so a
	 * failed read ends the wait and leaves what was selected.
	 */
	let selectingAll: Promise<void> | null = null;
	/** Which selection this is: ✕ and a bulk action's success start the next. */
	let selectionRun = 0;
	/** The bar the two pages share: it holds the taps still waiting on those reads. */
	let bar = $state<SelectionBar | null>(null);
	/**
	 * Fill in what SELECT ALL took unseen, before SHOW lists it or a bulk
	 * action reads it. SELECT ALL's id read comes first, or there is nothing
	 * yet to fill (GroupSheet takes its rows once, on open).
	 */
	async function fillUnseen(): Promise<void> {
		while (selectingAll) await selectingAll;
		await unseen.fill(selected, facts, heldBySheet);
		// A read that never answers must not hold the sheet shut (DELETE's
		// HELD_READ_MS is the same rule). But a sheet waits only for a line it
		// could draw: a selection of books has no show row (`showRowFacts` answers
		// none for a kind whose medium is not video), so it opens at once however
		// long the page's own ask is out.
		const owed = pickedInOrder(selected, facts).some(
			(p) => kindFacts(p.kind).medium === 'video' && p.show == null
		);
		if (!owed) return;
		await Promise.race([
			showFactsOut,
			new Promise<void>((resolve) => setTimeout(resolve, SHOW_FACTS_WAIT_MS))
		]);
	}
	/**
	 * A selection carried back from the search (doc/LIBRARY.md, "What
	 * ends SELECT"): ←, a chip or a shelf there lands here still selecting,
	 * the ticks made there and their facts included. Taken once, at the
	 * page's start, so the first paint is already the selecting bar.
	 */
	if (browser) {
		const back = takeCarried(landing(page.url));
		if (back) {
			selecting = true;
			for (const id of back.ids) selected.add(id);
			for (const p of back.facts) if (selected.has(p.id)) facts.set(p.id, p);
		}
	}
	/** The search with SELECT on: the ids and their facts go with it. */
	beforeNavigate((nav) => {
		if (!selecting || nav.to?.route.id !== '/search') return;
		carrySelection({
			ids: [...selected],
			facts: [...facts.values()],
			to: landing(nav.to.url)
		});
	});

	// ---- the server in use (doc/ANDROID.md, "Servers") -------------
	/*
	 * Inside the TV app with two or more servers, the bar says whose library this
	 * is: ON LIVING ROOM beside the wordmark, OK opening SERVERS. The list is the
	 * app's bridge's (PairingBridge.servers(), Servers.kt's toJson). Anything
	 * else draws no cell: a page with no bridge (a phone, a computer, a browser
	 * on the TV), an older APK (no `servers`), an answer that is not
	 * a list of servers, and one server, which changes nothing.
	 */
	type TvServer = { origin: string; shown: string; inUse: boolean };
	let tvServers = $state<TvServer[] | null>(null);

	/**
	 * The bridge's answer as a list of servers, or null for anything that is
	 * not one. It may answer now (today's JavaScript interface) or later (a
	 * message listener answers a Promise): this awaits either, so the page can
	 * be moved onto the message transport without reading a Promise as a string.
	 */
	async function readTvServers(): Promise<TvServer[] | null> {
		if (typeof window === 'undefined') return null;
		const bridge = (window as unknown as { TsundokuTV?: { servers?: unknown } }).TsundokuTV;
		if (!bridge || typeof bridge.servers !== 'function') return null;
		try {
			const list: unknown = JSON.parse(String(await (bridge.servers as () => unknown)()));
			if (!Array.isArray(list)) return null;
			const ok = (s: unknown): s is TvServer =>
				!!s &&
				typeof s === 'object' &&
				typeof (s as TvServer).origin === 'string' &&
				typeof (s as TvServer).shown === 'string' &&
				typeof (s as TvServer).inUse === 'boolean';
			return list.every(ok)
				? list.map((s) => ({ origin: s.origin, shown: s.shown, inUse: s.inUse }))
				: null;
		} catch {
			return null;
		}
	}

	/**
	 * The newest read: an answer to an older question is dropped, not drawn, so
	 * a slow first answer cannot overwrite a fast second one. Nothing is drawn
	 * once the page has gone either.
	 */
	let serverRead = 0;
	let mounted = false;
	async function refreshTvServers(): Promise<boolean> {
		const at = ++serverRead;
		const list = await readTvServers();
		if (at !== serverRead || !mounted) return false;
		tvServers = list;
		return true;
	}

	/**
	 * The cell's name, or null for no cell: two or more servers, one of them in
	 * use. In use is this page's own server (`inUseOf`), not the bridge's flag,
	 * which right after a switch still names the server just left.
	 */
	const onServer = $derived.by(() => {
		if (!tvServers || tvServers.length < 2) return null;
		const shown = inUseOf(tvServers, pageOrigin())?.shown.trim();
		return shown ? upper(shown) : null;
	});

	onMount(() => {
		mounted = true;
		void refreshTvServers();
		// Again a tick later: the layout's onMount, which runs after this one,
		// tells the app the server's own name (`named`), and a server the TV
		// had not named yet would otherwise show its bare host until MORE closes.
		void tick().then(refreshTvServers);
		return () => {
			mounted = false;
		};
	});

	function openMore(at: 'more' | 'servers') {
		moreAt = at;
		moreOpen = true;
	}

	/**
	 * MORE closing: the list is read again, since FORGET inside it can leave
	 * one server, and then the cell goes. Focus was going back to the cell
	 * that opened SERVERS; with the cell gone it goes to MORE, the cell that
	 * still leads there, rather than to nothing.
	 */
	function closeMore() {
		moreOpen = false;
		// The list is read again once the sheet is closed, and the hand-back
		// waits for the answer: a bridge that answers late must land before the
		// cell and the focus are decided. Only the cell opens MORE on 'servers',
		// so the cell was there when this sheet opened, even if a late answer
		// took it away while the sheet was up.
		void refreshTvServers().then((newest) => {
			if (!newest || !mounted) return;
			if (onServer === null && moreAt === 'servers') {
				void tick().then(() => {
					if (moreOpen) return;
					const now = document.activeElement;
					// A dialog still leaving is inert; any other holds the user's focus.
					const held = now && now !== document.body && !now.closest('[role="dialog"][inert]');
					if (held) return;
					document.querySelector<HTMLElement>('[data-focus-id="library-more"]')?.focus();
				});
			}
		});
	}

	function toggle(id: number) {
		if (selected.has(id)) selected.delete(id);
		else selected.add(id);
	}

	function startSelecting() {
		passed = form;
		selecting = true;
	}

	function stopSelecting() {
		passed = form;
		selecting = false;
		reviewing = false;
		selected.clear();
		facts.clear();
		unseen.reset();
		selectingAll = null;
		selectionRun++;
		bar?.dropTaps();
	}

	/**
	 * The `/` key while selecting opens the search with SELECT on, as the bar's
	 * `/` cell does. Not while typing into a field or with
	 * a sheet open, and not with a modifier, which is the browser's or the
	 * system's.
	 */
	function slashToTick(e: KeyboardEvent) {
		if (!selecting || e.key !== '/' || e.ctrlKey || e.metaKey || e.altKey) return;
		if (e.defaultPrevented) return;
		const t = e.target as HTMLElement | null;
		if (t?.closest('input, textarea, select, [contenteditable=""], [contenteditable="true"]'))
			return;
		if (document.querySelector('[role="dialog"]')) return;
		e.preventDefault();
		void goto(resolve('/search'));
	}

	function openShow() {
		bar?.dropTaps();
		shownIds = [...selected];
		reviewing = true;
		void fillUnseen();
	}

	// ---- sheets ------------------------------------------------------------
	let sheetId = $state<number | null>(null);
	/**
	 * Every selectable series the page draws, as the facts a selection keeps:
	 * a plain tile, a Work tile's parts, a person page's series. A book inside
	 * a series is an entry, not a series, and is never selected.
	 */
	const drawnPicked = $derived.by((): Picked[] => {
		const feet = data.workFeet;
		const work = (id: number) => {
			const f = feet[String(id)];
			return f ? { id: f.id, name: f.name } : null;
		};
		const out: Picked[] = [];
		for (const i of data.person?.items ?? []) {
			if (i.entryId !== null) continue;
			out.push({
				id: i.seriesId,
				title: i.title,
				hue: hueFor(i.title),
				addedAt: i.addedAt,
				cover: i.cover,
				kind: i.kind,
				entryCount: i.entries,
				// A person page's tag item carries a READ flag, not a count, and the
				// page reads no show facts for it: its row keeps the library's line.
				readCount: 0,
				show: null,
				meta: `${kindLabel(i.kind)} · ${count(i.entries)} ${unitLabel(i.kind)}${i.read ? ' · READ' : ''}`,
				work: work(i.seriesId),
				inWork: work(i.seriesId)?.name ?? null,
				hidden: i.hidden,
				// FOLD is the grid's: a person page's series never folded from here.
				language: null,
				languages: undefined
			});
		}
		for (const c of series) {
			if (!c.tile) {
				out.push(pickedOfCard(c, work(c.id), showFactsOf(c.id)));
				continue;
			}
			// The tile's own word on its Work: `workFeet` is the first page's, so
			// a tile past it has none.
			const theWork = { id: c.tile.id, name: c.tile.name };
			for (const p of c.tile.parts)
				out.push(pickedOfPart(p, c.tile.name, theWork, showFactsOf(p.seriesId)));
		}
		return out;
	});
	// Note what is drawn of the selection, and forget what left it. The map is
	// written outside the tracking, so writing it cannot re-run this. With
	// nothing selected `drawnPicked` is not read, so it is never built.
	$effect(() => {
		const ids = new Set(selected);
		const drawn = drawnToNote(selecting, ids, () => drawnPicked);
		const held = new Set(reviewing ? shownIds : []);
		untrack(() => {
			const { set, drop } = refreshFacts(ids, facts, drawn, held);
			for (const p of set) facts.set(p.id, p);
			for (const id of drop) facts.delete(id);
		});
	});
	/**
	 * A refusal stays where it was answered, and only until the user moves on.
	 * `form` outlives both: SvelteKit keeps an action's answer
	 * until the next one, so a refusal from the bulk bar came back as a library
	 * band after ✕, and a band's UNDO refusal moved into the next selection's
	 * bar. So the page remembers which answer the user has passed (SELECT, ✕,
	 * or any other form sent since) and which one a band's UNDO brought: the
	 * second is drawn as a band whatever SELECT is doing (the
	 * bands stay up while selecting, so an UNDO pressed then refused there),
	 * every other in `.fold-refused`.
	 */
	let passed = $state.raw<typeof form>(null);
	let undoAnswer = $state.raw<typeof form>(null);
	const formMessage = $derived(
		!form || form === passed
			? ''
			: 'foldMessage' in form
				? String(form.foldMessage)
				: 'workMessage' in form
					? String(form.workMessage)
					: ''
	);
	const foldMessage = $derived(form === undoAnswer ? '' : formMessage);
	/**
	 * The answer the band's ✕ cleared: only that answer, so the next
	 * action's new `form` draws its own band.
	 */
	let droppedAnswer = $state.raw<typeof form>(null);
	const latest = $derived(form === droppedAnswer ? null : form);
	const dropAnswer = () => (droppedAnswer = form);
	const undoMessage = $derived(form === undoAnswer && latest ? formMessage : '');
	/**
	 * REFRESH's answer over the selection. It is the library's own
	 * band, above the bar that asked, and it is replaced by the next run's: a
	 * bulk answer belongs where the selection is, not on a series screen.
	 */
	const batch = $derived(
		latest && 'refreshed' in latest ? (latest.refreshed as RefreshBatch) : null
	);
	/**
	 * IMPORT FINISHED's ✕ (doc/BANDS.md): the band is the workstation's, so
	 * the page is read again and the answer never becomes `form`, where it
	 * would take a form-answer band on screen (a HIDE, its UNDO) with it.
	 */
	const keepForm: SubmitFunction =
		() =>
		async ({ result, update }) => {
			if (result.type === 'success') await invalidateAll();
			else await update();
		};
	/** The bar's bulk forms: the answer lands in `form`, and the ticks stay. */
	const keepAfterBulk: SubmitFunction =
		() =>
		async ({ update }) => {
			await update({ reset: false });
		};
	/** GROUP AS A WORK's own answer: the Work it made, or what joined one. */
	const made = $derived(
		latest && 'made' in latest
			? (latest.made as { work: { name: string }; members: unknown[] })
			: null
	);
	const addedWork = $derived(
		latest && 'addedWork' in latest
			? (latest.addedWork as { workId: number; name: string; facts: unknown[] })
			: null
	);
	/** The HIDE answer's facts: shown again, and taken out again, by UNDO. */
	const hideFacts = $derived(
		latest && 'hideFacts' in latest
			? (latest.hideFacts as {
					hidden: number[];
					out: { workId: number }[];
					whole: number[];
					works: number;
				})
			: null
	);
	/** The UNHIDE answer's facts: every part it showed, and UNDO to hide them. */
	const showFacts = $derived(
		latest && 'showFacts' in latest
			? (latest.showFacts as { shown: number[]; whole: number[]; works: number })
			: null
	);
	/** Both bands' words, from the counts: one Work or several, and the loose series apart. */
	const hiddenBand = $derived(
		hideFacts && hideFacts.works > 0
			? wholeBand('HIDDEN', {
					ids: hideFacts.hidden,
					whole: hideFacts.whole,
					works: hideFacts.works
				})
			: null
	);
	/**
	 * A HIDE band that hid no Work's part: `?/hideAll` over loose series
	 * beside a Work it only settled, or TAKE OUT, THEN HIDE. Its words are of
	 * what the press did, each half only when it happened -- the series hidden
	 * now, the ones taken out of their Works -- and what UNDO does to them: shown
	 * again, or only put back when nothing was hidden by this press (a part
	 * hidden already, taken out). So it never says TAKEN OUT OF THE WORK for
	 * series that were not, nor HIDDEN · 0 SERIES.
	 */
	const looseBand = $derived.by(() => {
		if (!hideFacts) return null;
		const n = hideFacts.hidden.length;
		const k = hideFacts.out.length;
		const from = new Set(hideFacts.out.map((o) => o.workId)).size;
		const out =
			k === 0
				? null
				: `TAKEN OUT OF ${from === 1 ? 'THE WORK' : `${from} WORKS`} · ${
						k === 1 ? 'A SERIES ON ITS OWN AGAIN' : `${k} SERIES ON THEIR OWN AGAIN`
					}`;
		return {
			title: n > 0 ? `HIDDEN · ${n} SERIES` : `TAKEN OUT · ${k} SERIES`,
			detail: [out, n > 0 ? 'SHOWN AGAIN BY UNDO' : 'PUT BACK BY UNDO'].filter(Boolean).join(' · ')
		};
	});
	const shownBand = $derived(
		showFacts && showFacts.works > 0
			? wholeBand('SHOWN', { ids: showFacts.shown, whole: showFacts.whole, works: showFacts.works })
			: null
	);
	/**
	 * UNDO after a Work was made, added to, ended or hidden: the tiles a loaded
	 * page holds change back, and the load's first page may not move, so the
	 * pages are read again (see `refillPages`).
	 *
	 * One re-read, not two: `reloadList` is the load's own, and the
	 * form's `update` is asked not to re-read on success so this is the only
	 * one. Before that, every UNDO refreshed the first page twice and refilled
	 * the loaded pages twice behind it.
	 *
	 * A redirect is the exception `invalidateAll: false` does not govern:
	 * `applyAction` sends it through `goto` with `invalidateAll: true`, so the
	 * page is re-read there and its effect queues the one refill. Asking for
	 * `reloadList` here would re-read and refill a second time.
	 */
	const undoAfter: SubmitFunction =
		() =>
		async ({ result, update }) => {
			await update({ invalidateAll: false });
			// The answer `update` just put in `form`: drawn as the band below.
			if (result.type === 'failure') undoAnswer = form;
			if (result.type === 'redirect') return;
			await reloadList();
		};
	/**
	 * Which drawn series are hidden, by id: a Work's parts as well as the cards
	 * themselves. A person's page draws a Work's series as their own tiles and a
	 * shelf draws the Work as one card, so reading only the shelf's cards left
	 * `every` over an empty list -- vacuously true -- and a person's page offered
	 * UNHIDE for series that were plainly visible.
	 */
	const hiddenById = $derived.by(() => {
		const out = new SvelteMap<number, boolean>();
		for (const c of series) {
			if (c.tile) for (const p of c.tile.parts) out.set(p.seriesId, p.hidden);
			else out.set(c.id, c.hidden);
		}
		// The page's own items last: one series, one answer.
		for (const i of data.person?.items ?? []) if (i.entryId === null) out.set(i.seriesId, i.hidden);
		return out;
	});

	/**
	 * A Work tile is the run, so selecting it selects its parts: the bulk bar's
	 * actions all act on series, and a Work is one tile over them (doc/WORKS.md).
	 */
	const cardIds = (c: LibraryCard) => (c.tile ? c.tile.parts.map((p) => p.seriesId) : [c.id]);
	const cardSelected = (c: LibraryCard) => cardIds(c).every((id) => selected.has(id));
	function toggleCard(c: LibraryCard) {
		const ids = cardIds(c);
		const on = ids.every((id) => selected.has(id));
		for (const id of ids) {
			if (on) selected.delete(id);
			else selected.add(id);
		}
	}

	/** A tap opens the series; a long press opens the sheet (see CoverTile). A Work opens its own screen. */
	function press(c: LibraryCard) {
		if (selecting) return toggleCard(c);
		if (c.tile) {
			// eslint-disable-next-line svelte/no-navigation-without-resolve -- the route is static
			void goto(`/work/${c.tile.id}`);
			return;
		}
		waiting.preview = previewOf(c);
		// eslint-disable-next-line svelte/no-navigation-without-resolve -- seriesHref() resolves
		void goto(seriesHref(c.id, data.tag ? null : data.shelf));
	}

	/** The series screen opens with what this tile already knows (doc/WAITING.md). */
	function previewOf(
		c: Pick<
			LibraryCard,
			| 'id'
			| 'title'
			| 'kind'
			| 'hue'
			| 'rating'
			| 'favourite'
			| 'hidden'
			| 'entryCount'
			| 'readCount'
			| 'cover'
		>
	) {
		return {
			id: c.id,
			title: c.title,
			kind: c.kind,
			hue: c.hue,
			rating: ratingNow.get(c.id) ?? c.rating,
			favourite: favNow.get(c.id) ?? c.favourite,
			hidden: c.hidden,
			entryCount: c.entryCount,
			readCount: c.readCount,
			cover: c.cover
		};
	}

	// A shelf tab on its way past 1 s: the grid in outline, CONTINUE and the
	// tabs kept as they are.
	const outlined = $derived(
		(waiting.phase === 'outline' || waiting.phase === 'stalled') && waiting.to.kind === 'library'
	);

	/**
	 * While `outlined` the grid is drawn as `GridOutline` instead of the
	 * tiles (`{#if outlined}` below), so a tile holding the mark is unmounted
	 * and the mark falls to `<body>`. Note it before the outline draws, and give
	 * it back once the grid is drawn again -- or the KIND band's chosen cell
	 * when the filter has taken the tile away.
	 *
	 * Only a mark on a *tile* is noted: a filter or a sort chosen with the pad
	 * keeps the mark on its own cell (`data-sveltekit-keepfocus`), and that is
	 * not the screen's to move. The give-back stands down whenever anything
	 * else holds the mark by then (a second press during the outline, BACK
	 * closing a panel over it), so it never pulls the mark off a control the
	 * reader reached in the meantime.
	 */
	let tileBeforeOutline = $state<string | null>(null);
	$effect.pre(() => {
		if (!outlined) return;
		const at = document.activeElement;
		const held =
			at instanceof HTMLElement ? at.closest<HTMLElement>('.grid [data-focus-id]') : null;
		if (held?.dataset.focusId) tileBeforeOutline = held.dataset.focusId;
	});
	$effect(() => {
		if (outlined || !tileBeforeOutline) return;
		const id = tileBeforeOutline;
		tileBeforeOutline = null;
		if (document.activeElement !== document.body) return;
		const back = document.querySelector<HTMLElement>(`[data-focus-id="${id}"]`);
		(back ?? document.querySelector<HTMLElement>('.kinds .kc.on'))?.focus();
	});

	// ---- on the tile ------------------------------------------------------
	// FAV and the rating are edited on the cover itself (see CoverTile). The
	// tile shows the change at once and saves behind it. A write that fails
	// keeps the new value, and the layout's band offers RETRY and PUT BACK
	// (doc/WAITING.md).
	const favNow = new SvelteMap<number, boolean>();
	const ratingNow = new SvelteMap<number, Rating>();

	/**
	 * Whether what the tile draws for this field is a tap that is not
	 * stored. Read from the page, not from the store: a failure
	 * outlives the page and the tap does not. A value the page does not
	 * hold is the stored one -- a tile re-drawn after a trip away shows what the
	 * server had, so it is not marked. A fresh tap still in flight is left
	 * alone until its turn says which it is; a RETRY in flight keeps the mark,
	 * because the value it sends is still not stored.
	 */
	function unsaved(field: 'fav' | 'rating', id: number, stored: boolean | Rating): boolean {
		// Read for its signal alone: a failure raised after the tap has to redraw
		// the tile, and neither `pending()` (a plain Map) nor the value maps
		// change when it is raised. Which bands are up does not decide the mark.
		void saves.failed;
		// A RETRY's turn is pending too, but unlike a fresh tap's it has already
		// failed once: `retrying` keeps the mark on through it. Without this a
		// tile redrawn while a RETRY was out (another tile's tap landing, a
		// scan's re-read) dropped the mark, and nothing redrew it when the RETRY
		// failed, because a failed retry leaves `saves.failed` as it was and
		// `pending()` signals nothing.
		const key = `${field}:${id}`;
		if (seriesSaves.pending(key) && !retrying.has(key)) return false;
		const now = field === 'fav' ? favNow.get(id) : ratingNow.get(id);
		return now !== undefined && now !== stored;
	}

	/**
	 * Keys whose RETRY (the band's, or the nudge's) is in flight. A
	 * `SvelteSet`, so its end redraws the tiles that read it.
	 */
	const retrying = new SvelteSet<string>();

	/**
	 * One save in flight per series and field, the last tap winning, on the
	 * series screen's queue (`seriesSaves`, doc/SERIES.md "FAV and the
	 * rating"): the same keys, so a tile tap and a series screen tap on
	 * one series wait for each other too.
	 */
	async function write(
		action: 'favourite' | 'rate',
		key: string,
		fields: Record<string, string>,
		failure: () => { what: string; putBackLabel: string; putBack: () => void },
		settle: () => void
	) {
		const save = () => postAction(`/?/${action}`, fields);
		saves.clear(key);
		const turn = await seriesSaves.run(key, save);
		if (!turn.latest) return;
		// The reload is this turn's: the next tap's save waits for it to land,
		// the loaded pages after the first included. `finally`, because the
		// queue is the app's: a turn never settled would hold the key for the
		// whole session.
		try {
			if (turn.ok || turn.earlierStored) await reloadList();
		} finally {
			seriesSaves.settle(key);
		}
		// Not `pending()`: an older turn still reloading is pending too.
		if (turn.newer()) return;
		if (turn.ok) return settle();
		saves.fail({
			...failure(),
			key,
			retry: async () => {
				retrying.add(key);
				let again: Turn;
				try {
					again = await seriesSaves.run(key, save);
					if (again.latest) {
						try {
							if (again.ok) await reloadList();
						} finally {
							seriesSaves.settle(key);
						}
					}
				} finally {
					retrying.delete(key);
				}
				if (!again.latest) return again.ok;
				if (again.ok && !again.newer()) settle();
				return again.ok;
			}
		});
	}

	/**
	 * A band's words, with which tile they are about when that can be said:
	 * several can be up at once, each "FAV NOT SAVED". Never a hidden card's
	 * title: the band is the app's and outlives reveal, and with reveal off a
	 * hidden title does not reach the browser (doc/LIBRARY.md). `hidden` is the
	 * card's own, a hidden root's included. A tile no longer listed has no name.
	 */
	function bandWords(what: string, id: number) {
		const card = series.find((s) => s.id === id);
		const name = card && !card.hidden ? card.title.toUpperCase() : '';
		return name ? `${what} · ${name}` : what;
	}

	function favourite(id: number, on: boolean) {
		favNow.set(id, on);
		void write(
			'favourite',
			`fav:${id}`,
			{ id: String(id), on: on ? '1' : '0' },
			() => ({
				what: bandWords(`${on ? 'FAV' : 'UNFAV'} NOT SAVED`, id),
				putBackLabel: series.find((s) => s.id === id)?.favourite
					? 'PUT BACK · FAV'
					: 'PUT BACK · NOT FAV',
				putBack: () => favNow.delete(id)
			}),
			() => {
				// A newer tap of this field may still be queued: its value stands
				// until its own turn settles (the series screen's rule).
				if (!seriesSaves.pending(`fav:${id}`)) favNow.delete(id);
			}
		);
	}

	function rate(id: number, rating: Rating) {
		ratingNow.set(id, rating);
		void write(
			'rate',
			`rating:${id}`,
			{ id: String(id), rating: String(rating) },
			() => ({
				what: bandWords(`RATING ${rating} NOT SAVED`, id),
				putBackLabel: `PUT BACK ${series.find((s) => s.id === id)?.rating ?? 0}`,
				putBack: () => ratingNow.delete(id)
			}),
			() => {
				if (!seriesSaves.pending(`rating:${id}`)) ratingNow.delete(id);
			}
		);
	}

	// ---- derived view ------------------------------------------------------
	// Layout is decided by CSS (src/lib/styles/layout.css), so the server's
	// first paint is already right for the device. Script only needs the column
	// count to pad the last row, which is cosmetic and can wait for hydration.
	const columns = $derived(phone.current ? 3 : desktop.current ? 8 : wide.current ? 9 : 6);
	const contShown = $derived(data.cont.items.slice(0, 4));

	/** The screens the service worker keeps (src/service-worker.ts, `SCREENS`). */
	const SCREENS_CACHE = 'tsundoku-screens';
	/** A CONTINUE row's own page: a Work's row to its Work, as its tile opens. */
	const rowPath = (item: (typeof contShown)[number]) =>
		item.work ? `/work/${item.work.id}` : `/series/${item.id}`;
	/**
	 * Offline, which rows' pages this device has kept. Going to one it has not
	 * is not an error anyone sees: the worker answers with the library's copy
	 * under the series' URL (measured), so such a row goes nowhere. Only a
	 * screen's document can be kept: SvelteKit sends `__data.json` as no-store,
	 * and the worker never stores that (`storable`).
	 */
	let keptScreens = $state.raw<string[]>([]);
	$effect(() => {
		if (!isOffline) return;
		const paths = contShown.map(rowPath);
		let live = true;
		void (async () => {
			const cache = await caches.open(SCREENS_CACHE);
			const kept: string[] = [];
			for (const path of paths) {
				if (await cache.match(path, { ignoreSearch: true })) kept.push(path);
			}
			if (live) keptScreens = kept;
		})();
		return () => {
			live = false;
		};
	});
	/** Where a CONTINUE row's band goes, or null where it has nowhere honest to go (doc/LIBRARY.md). */
	function continueHref(item: (typeof contShown)[number]): string | null {
		// Every tap is a pick while selecting, and a row is not one (doc/LIBRARY.md).
		if (selecting) return null;
		if (isOffline && (cachedOn(item) === 0 || !keptScreens.includes(rowPath(item)))) return null;
		return item.work ? `/work/${item.work.id}` : seriesHref(item.id, 'continue');
	}
	const showContinue = $derived(contShown.length > 0 && !scanning && !justImported);

	const cachedCount = (id: number) => offline.cached[id] ?? 0;
	/**
	 * What a tile has on the device: a Work's parts summed, not only its face's
	 * -- the part CONTINUE opens may be the one that is cached (doc/WORKS.md).
	 */
	const cachedOn = (c: { id: number; tile?: LibraryCard['tile'] }) =>
		c.tile ? c.tile.parts.reduce((n, p) => n + cachedCount(p.seriesId), 0) : cachedCount(c.id);

	/**
	 * The TV focus line's second line: the kind, the counts and where
	 * you are, +N NEW, and FAV -- the same facts the cover's sheet opens with
	 * (sheetMeta), so the line and the panel agree.
	 */
	const focusMeta = (s: SeriesCard) => `${sheetMeta(s)}${s.favourite ? ' · FAV' : ''}`;

	/** A card's languages as codes: a folded book's, else its `language:` tag. */
	const codesOf = (s: SeriesCard) => s.languages ?? (s.language ? [langCode(s.language)] : []);

	/**
	 * CACHED is a device shelf: only the tablet knows what it holds, so the
	 * server lists everything and this narrows it, filters included: the
	 * device can answer every one of them.
	 */
	const cachedSeries = $derived(series.filter((s) => cachedOn(s) > 0));
	const shown = $derived(
		data.shelf === 'cached'
			? cachedSeries.filter((s) => matches({ ...s, languages: codesOf(s) }, data.filters))
			: series
	);

	// ---- filters (doc/FILTERS.md) ---------------------------------------------
	const nFilters = $derived(activeCount(data.filters));
	const filterHref = (f: Filters) => `${resolve('/')}?${withFilters(page.url.searchParams, f)}`;
	/** What DATE ADDED's form carries without script: the URL, less its own field. */
	const keepParams = $derived(
		[...withFilters(page.url.searchParams, { ...data.filters, added: null })].filter(
			([k]) => k !== 'new'
		) as [string, string][]
	);
	/** The shelf the grid shows, before and after filtering: "44 OF 188". */
	const showing = $derived(data.shelf === 'cached' ? shown.length : data.total);
	const shelfSize = $derived.by(() => {
		if (data.shelf === 'cached') return cachedSeries.length;
		return data.shelfTotal ?? data.total;
	});
	const outOf = $derived(
		`${showing.toLocaleString('en-US')} OF ${shelfSize.toLocaleString('en-US')}`
	);
	const shelfName = $derived(
		data.shelf === 'cached'
			? 'Cached'
			: (data.shelves.find((s) => s.key === data.shelf)?.name ?? 'Shelves')
	);
	/** An empty shelf offers nothing to filter: no FILTER cell, one line on filling it. */
	const canFilter = $derived(
		data.shelf !== 'people' && !data.tag && (nFilters > 0 || shelfSize > 0)
	);
	const languagesHere = $derived(
		data.shelf === 'cached'
			? [...new Set(cachedSeries.flatMap((s) => codesOf(s)).map((l) => l.toLowerCase()))].sort()
			: data.languages
	);
	// ---- the KIND band (doc/LIBRARY.md, "The KIND band") ---------------
	/**
	 * A kind's word on the band: the plural the kind shelves had (`nav_shelf_*`),
	 * not `kindLabel`'s singular. Keyed by the registry's kinds, so a new kind
	 * names its cell here or the compiler says so; the band asks no kind by name.
	 */
	const KIND_WORD = {
		manga: m.nav_shelf_manga,
		manhwa: m.nav_shelf_manhwa,
		doujin: m.nav_shelf_doujin,
		novel: m.nav_shelf_novel,
		anime: m.nav_shelf_anime,
		movie: m.nav_shelf_movie,
		show: m.nav_shelf_show
	} satisfies Record<FilterKind, () => string>;
	const kindWord = (k: FilterKind | null) => upper(k ? KIND_WORD[k]() : m.nav_shelf_all());
	/**
	 * What each cell counts: the server's grouped count, or on CACHED, which
	 * only the device can answer, the cached tiles with every filter but KIND.
	 */
	const bandCounts = $derived.by(() => {
		if (data.shelf !== 'cached') return data.kindBand;
		const loose = { ...data.filters, kind: null };
		const here = cachedSeries.filter((s) => matches({ ...s, languages: codesOf(s) }, loose));
		const kinds: Partial<Record<FilterKind, number>> = {};
		for (const s of here) {
			const k = s.kind as FilterKind;
			kinds[k] = (kinds[k] ?? 0) + 1;
		}
		return { all: here.length, kinds };
	});
	const bandCells = $derived(
		bandCounts ? kindCells(bandCounts.kinds, bandCounts.all, data.filters.kind) : []
	);
	/**
	 * The chosen kind, kept on a shelf that has none of it (drawn at 0): the
	 * grid says why. Only while the kind is all that narrows it: with FILTER's
	 * own filters on too, "nothing matches these filters" is the truer line.
	 */
	const kindAtZero = $derived(
		data.filters.kind !== null &&
			activeCount(data.filters, false) === 0 &&
			bandCells.some((c) => c.on && c.zero)
	);
	/** A band cell's link: the same `?kind=` FILTER's KIND row wrote, every other filter kept. */
	const kindHref = (k: FilterKind | null) => filterHref({ ...data.filters, kind: k });

	/**
	 * Pinned: the band stops under the top bar as the grid
	 * scrolls and the tabs go up, and then gains a first cell naming the shelf,
	 * `TO READ ▴`, which goes back to the tabs. Measured, not guessed: the
	 * marker sits just above the band, so once the band is held while the page
	 * moves on, the two part.
	 */
	let bandEl = $state<HTMLElement | null>(null);
	let bandMark = $state<HTMLElement | null>(null);
	let bandPinned = $state(false);
	$effect(() => {
		void winY;
		void winH;
		if (!bandEl || !bandMark) {
			bandPinned = false;
			return;
		}
		bandPinned = bandEl.getBoundingClientRect().top - bandMark.getBoundingClientRect().bottom > 1;
	});
	/**
	 * The chosen cell is kept in view as the band scrolls sideways, the effect
	 * ShelfTabs runs for the active tab: choosing a kind far along scrolls ALL
	 * off the left rather than leaving the choice cut off.
	 */
	function keepChosen(node: HTMLElement, kind: FilterKind | null) {
		const show = () => {
			const on = node.querySelector<HTMLElement>('.on');
			if (on)
				node.scrollLeft += on.getBoundingClientRect().left - node.getBoundingClientRect().left;
		};
		show();
		let last = kind;
		return {
			update(next: FilterKind | null) {
				if (next === last) return;
				last = next;
				void tick().then(show);
			}
		};
	}
	/** How much of the window the top bar holds over the page: its height where it is held, else 0. */
	function heldBar(): number {
		const bar = document.querySelector<HTMLElement>('.library > header.bar');
		return bar && ['sticky', 'fixed'].includes(getComputedStyle(bar).position)
			? bar.getBoundingClientRect().height
			: 0;
	}
	/** The scroll that puts `el` just under the held top bar (unclamped: the browser clamps). */
	function placeUnderBar(el: Element | null | undefined): number {
		return el ? scrollY + el.getBoundingClientRect().top - heldBar() : 0;
	}

	/** `TO READ ▴`: back to the tabs, the mark on the shelf showing (the TV's ↑ does the same). */
	function toTabs() {
		const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
		const shown = (el: Element | null | undefined) => !!el && el.getClientRects().length > 0;
		const tab = document.querySelector<HTMLElement>('.library .tabs .tab.on');
		const held = heldBar();
		// The tabs where there are tabs; the desktop's are the sidebar, so there
		// the band's own place, just under the bar.
		const to = shown(tab) ? tab!.closest('.library > .tabs') : bandMark;
		if (shown(tab)) tab!.focus({ preventScroll: true });
		const top = placeUnderBar(to);
		scrollTo({ top: Math.max(0, top), behavior: reduced ? 'instant' : 'smooth' });
		// Unpinning redraws the band's first cell, and the page can land a pixel
		// or two off what was measured (1.4px on a tablet, the tabs' rule under
		// the bar): once it has settled, the rest of the way.
		const settle = () => {
			const off = to ? to.getBoundingClientRect().top - held : 0;
			if (Math.abs(off) > 0.5) scrollBy({ top: off, behavior: 'instant' });
		};
		if (reduced || Math.abs(Math.max(0, top) - scrollY) < 1)
			requestAnimationFrame(() => requestAnimationFrame(settle));
		else {
			// Only this scroll's end: a later one of the user's must never be corrected.
			addEventListener('scrollend', settle, { once: true });
			setTimeout(() => removeEventListener('scrollend', settle), 2000);
		}
	}

	/**
	 * A kind chosen from the pinned band: the cells keep the
	 * scroll (noscroll) so the unpinned band never jumps, but mid-grid that
	 * would open the new kind partway down its list. So once the navigation
	 * has drawn the new grid, the page goes, instantly, to the band's own
	 * place: the band under the bar, the grid's first row directly under it.
	 * Focus stays on the chosen cell (keepfocus), so a TV's ↓ takes the first tile.
	 */
	let landKind = false;
	function chooseKind(e: MouseEvent) {
		// A click that opens a new tab or window navigates nothing here.
		const elsewhere = e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey;
		landKind = bandPinned && !elsewhere;
		// The kind's own landing replaces any FILTER note.
		landFilterFrom = null;
		filterLeaving = false;
	}
	afterNavigate(() => {
		if (!landKind) return;
		landKind = false;
		landAtBand();
	});
	/** The band's own place: the band under the bar, the grid's first row under the band. */
	function landAtBand() {
		// A slow load draws the outline first, and a scroll then lands short:
		// settled each frame until the grid is drawn and the page is there.
		settleScroll(() => Math.max(0, placeUnderBar(bandMark)), true);
	}

	/**
	 * A choice made in FILTER while the band is pinned (FILTER at the
	 * band's end, or the desktop's in the top bar): its links keep the scroll
	 * as the band's cells do, so mid-grid the new results opened partway down
	 * their list. It lands as a kind does. Noted with the page it was made on,
	 * and kept to one navigation: it lands only when that page is the one
	 * left, by a link or a goto (not BACK), and the filters really changed,
	 * so a choice already on leaves the page where it is. Unpinned, nothing
	 * moves. The rating blocks' own links scroll to the top, and land the
	 * same way.
	 *
	 * The note lives only as long as the press or key that made it:
	 * a press on the blocks that navigates nothing (a right-click, a key the
	 * slider ignores, a cancelled drag) left it waiting for the next
	 * navigation, and a kind cell clicked later from the unpinned band then
	 * jumped to the band. So every new press or key anywhere drops it first
	 * (the window's capture runs before the panel's, which notes it again
	 * when that press is itself a choice), and a kind cell replaces it.
	 */
	let landFilterFrom: string | null = null;
	// Its navigation has begun: a press now (DONE, the scrim, Escape) can't undo
	// the choice, so it mustn't lose the landing.
	let filterLeaving = false;
	function chooseFilter(e?: MouseEvent) {
		const elsewhere = !!e && (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey);
		landFilterFrom = bandPinned && !elsewhere ? location.href : null;
		filterLeaving = false;
	}
	function dropFilterNote() {
		if (!filterLeaving) landFilterFrom = null;
	}
	beforeNavigate((nav) => {
		if (landFilterFrom && nav.from?.url.href === landFilterFrom) filterLeaving = true;
	});
	afterNavigate((nav) => {
		const from = landFilterFrom;
		landFilterFrom = null;
		filterLeaving = false;
		if (!from || !nav.from || !nav.to || nav.from.url.href !== from) return;
		if (nav.type !== 'link' && nav.type !== 'goto') return;
		const filtersOf = (u: URL) => JSON.stringify(filterParams(parseFilters(u.searchParams, true)));
		if (filtersOf(nav.from.url) === filtersOf(nav.to.url)) return;
		landAtBand();
	});

	const newOpen = $derived(page.url.searchParams.get('new') === 'shelf');

	const shelves = $derived(
		nFilters > 0
			? data.shelves.map((s) => (s.key === data.shelf ? { ...s, countText: outOf } : s))
			: data.shelves
	);

	const tabs = $derived.by((): Shelf[] => {
		if (!isOffline) return shelves;
		const cached: Shelf = {
			key: 'cached',
			name: 'Cached',
			kind: 'smart',
			count: Object.keys(offline.cached).length
		};
		if (data.shelf === 'cached' && nFilters > 0) cached.countText = outOf;
		return [cached, ...shelves.filter((s) => s.key !== 'new')];
	});

	const activeShelf = $derived(data.tag ? '' : data.shelf);

	const sectionText = $derived.by(() => {
		if (data.tag) {
			const [ns, value] = data.tag.includes(':') ? data.tag.split(':', 2) : ['', data.tag];
			return ns ? `${ns} · ${value}` : value;
		}
		if (scanning) return 'Arriving';
		if (isOffline) return 'On this device';
		if (justImported && data.shelf === 'new') return 'Just imported';
		// The shelf by name, and what narrows it.
		return shelfName;
	});
	const sectionExtra = $derived(
		data.tag || scanning || isOffline || nFilters === 0 ? '' : filterWords(data.filters).join(' · ')
	);

	/**
	 * Fill the last grid row, so the hairline ground never shows as a block.
	 * Not while pages remain: the next one carries on the row.
	 */
	const fillers = $derived(hasMore ? 0 : (columns - (shown.length % columns)) % columns);

	/**
	 * SELECT ALL means the whole shelf, pages not yet loaded included: their
	 * ids come without their cards.
	 */
	function selectAll() {
		// The loaded tiles at once, a Work's parts with it (a Work tile is one
		// tile over its parts, doc/WORKS.md).
		for (const s of shown) for (const id of cardIds(s)) selected.add(id);
		// CACHED narrows on the device: only the tablet knows what it holds, so
		// the server cannot answer its ids.
		if (data.shelf === 'cached') return;
		const q = pageQuery({
			shelf: data.shelf,
			tag: data.tag,
			filters: data.filters,
			sort: data.sort,
			dir: dirParam,
			offset: 0,
			limit: 0
		});
		const read = readEveryId(q, new Set(selected), selectionRun);
		const all: Promise<void> = Promise.all([selectingAll, read]).then(() => {
			if (selectingAll === all) selectingAll = null;
		});
		selectingAll = all;
	}

	/**
	 * Every page's ids, unit-aware so a Work's parts a kind shelf never picked
	 * are selected too, then their facts, so SHOW lists them and GROUP
	 * counts them. `taken` is what was selected at the press: one of those no
	 * longer selected was unticked while this was out, so it stays unticked.
	 */
	async function readEveryId(q: string, taken: Set<number>, run: number): Promise<void> {
		try {
			const res = await fetch(`/api/library?${q}&ids=1`);
			const ids = res.ok ? ((await res.json()) as { ids: number[] }).ids : [];
			// ✕ while it was out: this selection has ended.
			if (run !== selectionRun) return;
			for (const id of ids) if (!taken.has(id)) selected.add(id);
			if (reviewing) shownIds = [...new Set([...shownIds, ...selected])];
			await unseen.fill(selected, facts, heldBySheet);
		} catch {
			// Offline: the loaded pages stay selected, which is what's on screen.
		}
	}

	const gb = (bytes: number) => (bytes / 1e9).toFixed(1).replace(/\.0$/, '');

	/** The SORT menu's choices, in `SORTS`' order. */
	const SORT_CHOICES = SORTS.map((s) => ({ value: s, label: SORT_NAME[s] }));

	/** A sort from the SORT menu, in its own direction. */
	function sortTo(raw: string) {
		const next = parseSort(raw);
		const url = new URL(page.url);
		url.searchParams.set('sort', next);
		url.searchParams.delete('dir');
		// RANDOM shuffles anew each time it's chosen; the other orders need no seed.
		if (next === 'random') url.searchParams.set('seed', String(newSeed()));
		else url.searchParams.delete('seed');
		// eslint-disable-next-line svelte/no-navigation-without-resolve -- withParam() keeps the current, resolved path
		void goto(withParam(url, 'sort', next), { noScroll: true, keepFocus: true });
	}

	/** ↓ / ↑: the same sort the other way round. Its own direction leaves no `?dir=`. */
	function flipDir() {
		const to = data.dir === 'asc' ? 'desc' : 'asc';
		const url = new URL(page.url);
		url.searchParams.set('sort', data.sort);
		// eslint-disable-next-line svelte/no-navigation-without-resolve -- withParam() keeps the current, resolved path
		void goto(withParam(url, 'dir', to === naturalDir(data.sort) ? null : to), {
			noScroll: true,
			keepFocus: true
		});
	}
</script>

<svelte:head><title>tsundoku</title></svelte:head>

<svelte:window
	bind:scrollY={winY}
	bind:innerHeight={winH}
	onpointerdowncapture={dropFilterNote}
	onkeydowncapture={dropFilterNote}
	onkeydown={slashToTick}
	onsubmitcapture={() => (passed = form)}
/>

<div class="library" class:selecting class:has-band={!!batch}>
	{#if modalOpen && offer}<UpdateModal {offer} onlater={snooze} />{/if}
	{#if appModalOpen && appOffer}<UpdateModal offer={appOffer} onlater={snoozeApp} app />{/if}

	{#if selecting}
		<TopBar inverse sticky label="Selection">
			{#snippet left()}
				<button
					type="button"
					class="cell-btn x"
					aria-label="Stop selecting"
					data-focus-mark="in"
					onclick={stopSelecting}>✕</button
				>
			{/snippet}
			{#snippet middle()}
				<div class="selected-count" aria-live="polite">{selected.size} SELECTED</div>
				<!-- SHOW: the selection outlives the shelf, so what it holds is not
				     all on screen; this lists it to review or untick. -->
				<button
					type="button"
					class="cell-btn show-cell"
					data-focus-mark="in"
					disabled={selected.size === 0}
					onclick={openShow}>SHOW</button
				>
				<!-- The way to the search with SELECT on:
				     the bar's empty middle, drawn like the library's own search hint; on a
				     phone `/` alone. -->
				<a
					class="to-tick"
					href={resolve('/search')}
					aria-label={m.library_search_to_tick_label()}
					data-focus-mark="in"><b>/</b><span class="long">{m.library_search_to_tick()}</span></a
				>
			{/snippet}
			{#snippet right()}
				<!-- ALL on a phone, to make room for `/`, as in GROUP's own select bar; its
				     name stays SELECT ALL. -->
				<button
					type="button"
					class="cell-btn"
					aria-label="SELECT ALL"
					data-focus-mark="in"
					onclick={selectAll}
					><span class="all-long">SELECT ALL</span><span class="all-short"
						>{m.library_select_all_short()}</span
					></button
				>
			{/snippet}
		</TopBar>
	{:else if data.person}
		<TopBar sticky label="Library">
			{#snippet left()}
				<a class="cell-btn back" href={resolve('/')} aria-label="Back to library" use:backLink>←</a>
			{/snippet}
			{#snippet middle()}
				<div class="tag-title">
					<span class="ns">{data.person?.namespace || 'tag'}</span><span>{data.person?.value}</span>
				</div>
			{/snippet}
			{#snippet right()}
				<button type="button" class="cell-btn select-cell" onclick={startSelecting}>SELECT</button>
			{/snippet}
		</TopBar>
	{:else}
		<TopBar sticky label="Library">
			{#snippet left()}
				<!-- The app's name goes home: the library as it opens. -->
				<!-- With the server cell, the wordmark is not an arrow stop: in the
				     design's bar it is no control, and the cell is the first one ↑
				     reaches from the library. Tab still reaches it. -->
				<a
					class="brand"
					href={resolve('/')}
					aria-label="Library"
					data-focus-skip={onServer ? '' : undefined}><Wordmark /></a
				>
				{#if onServer}
					<!-- The server in use, with two or more. -->
					<button
						type="button"
						class="cell-btn server-cell"
						class:on={moreOpen && moreAt === 'servers'}
						aria-expanded={moreOpen && moreAt === 'servers'}
						data-focus-mark="in"
						data-focus-id="library-server"
						onclick={() => openMore('servers')}
						><span class="srv-on">{m.tv_servers_on()}</span><span class="srv-name">{onServer}</span
						></button
					>
				{/if}
			{/snippet}
			{#snippet middle()}
				<!-- A library filtered to one kind hands it to the search, which hands it
				     to SEARCH THE SOURCES. -->
				<!-- eslint-disable svelte/no-navigation-without-resolve -- resolve() builds it -->
				<a
					class="search-hint"
					href={data.filters.kind
						? `${resolve('/search')}?kind=${data.filters.kind}`
						: resolve('/search')}
					aria-label="Search"
					data-focus-mark="in"
					><span class="short">/<span class="word"> search</span></span><span class="long"
						>/ search title, tag, artist</span
					></a
				>
				<!-- eslint-enable svelte/no-navigation-without-resolve -->
			{/snippet}
			{#snippet right()}
				{#if page.data.browse}
					<!-- BROWSE, a cell before QUEUE on the tablet; the
					     phone reaches it from the empty search, the desktop from the sidebar. -->
					<a class="browse-cell" href={resolve('/browse')}>BROWSE</a>
				{/if}
				{#if data.queue && data.queue.queued > 0}
					<!-- QUEUE over its count, a cell before SELECT, only while something is queued.
					     Offline or unanswered: the last count, dimmed. -->
					<a
						class="queue-cell"
						class:stale={data.queue.stale || isOffline}
						href={resolve('/downloads')}
						aria-label="Download queue, {data.queue.queued} chapters"
					>
						<span class="q-label">QUEUE</span>
						<span class="q-n">{count(data.queue.queued)}</span>
					</a>
				{/if}
				{#if canFilter}
					<!-- The desktop's FILTER, beside SELECT; the tablet's sits on the tabs. -->
					<div class="filter-desk">
						<FilterPanel
							wide
							filters={data.filters}
							languages={languagesHere}
							kindRow={false}
							formRow
							countKind={false}
							reveal={data.reveal}
							following={data.following}
							title={shelfName.toUpperCase()}
							count={nFilters ? outOf : shelfSize.toLocaleString('en-US')}
							href={filterHref}
							formAction={resolve('/')}
							keep={keepParams}
							onchoose={chooseFilter}
						/>
					</div>
				{/if}
				<button
					type="button"
					class="cell-btn select-cell"
					data-focus-mark="in"
					onclick={startSelecting}
					disabled={data.empty}>SELECT</button
				>
				<!-- MORE: the sidebar's foot as a sheet, on the tablet and phone. -->
				<button
					type="button"
					class="cell-btn more-cell"
					class:on={moreOpen && moreAt === 'more'}
					aria-expanded={moreOpen && moreAt === 'more'}
					data-focus-mark="in"
					data-focus-id="library-more"
					onclick={() => openMore('more')}>MORE</button
				>
			{/snippet}
		</TopBar>
	{/if}
	{#if data.gone}
		{@const gone = data.gone}
		<!-- A Work ended on its own screen: the band and its UNDO live here, on the
		     library it went back to (doc/NAVIGATION.md). HIDE ALL n
		     from a series screen with reveal off arrives the same way, and TAKE OUT
		     says what it did -- one series hidden, on its own again -- rather than
		     claiming the Work was hidden whole. -->
		<Band
			title={gone.kind === 'ended'
				? `${gone.name.toUpperCase()} IS NO LONGER A WORK`
				: gone.kind === 'hidden'
					? `${gone.name.toUpperCase()} HIDDEN`
					: gone.kind === 'taken-out'
						? 'HIDDEN · TAKEN OUT'
						: `UNGROUPED · ${gone.name.toUpperCase()}`}
			detail={gone.kind === 'ended'
				? 'ONE SERIES WAS LEFT'
				: gone.kind === 'hidden'
					? `${wholeLine(1)}${gone.n > 0 ? ` · ${gone.n} SERIES` : ''}`
					: gone.kind === 'taken-out'
						? `A SERIES ON ITS OWN AGAIN${gone.ended ? ` · ${gone.name.toUpperCase()} IS NO LONGER A WORK` : ''} · SHOWN AGAIN BY UNDO`
						: 'EVERY SERIES IS ITS OWN AGAIN'}
			ondismiss={() => clearBandUrl(['band', 'facts', 'name', 'n'])}
		>
			{#snippet action()}
				<form
					method="POST"
					action={gone.kind === 'hidden' || gone.kind === 'taken-out' ? '?/undoHide' : '?/undoWork'}
					use:enhance={undoAfter}
				>
					{#if gone.kind !== 'hidden' && gone.kind !== 'taken-out'}<input
							type="hidden"
							name="kind"
							value={gone.kind}
						/>{/if}
					<!-- This band came from the URL, so its UNDO leaves the page that
					     carried it: a form's answer would not clear it. -->
					<input type="hidden" name="from" value="band" />
					<input type="hidden" name="facts" value={gone.facts} />
					<button type="submit">UNDO</button>
				</form>
			{/snippet}
		</Band>
	{/if}
	{#if made || addedWork}
		<!-- A Work's create and add answer here, where the sheet was opened: the Work's
		     own screen would replace the library being looked at. -->
		<div class="lib-band">
			<Band
				title={made
					? m.offer_work_made({ name: made.work.name.toUpperCase() })
					: m.offer_added_to({ name: addedWork!.name.toUpperCase() })}
				detail={made
					? `${made.members.length} SERIES · EACH KEEPS ITS OWN`
					: `${addedWork!.facts.length} SERIES · AT THE END OF THE RUN`}
				ondismiss={dropAnswer}
			>
				{#snippet action()}
					<form method="POST" action="?/undoWork" use:enhance={undoAfter}>
						<input type="hidden" name="kind" value={made ? 'create' : 'add'} />
						<input type="hidden" name="facts" value={JSON.stringify(made ?? addedWork!.facts)} />
						<button type="submit">UNDO</button>
					</form>
				{/snippet}
			</Band>
		</div>
	{/if}
	{#if hideFacts}
		<!-- HIDE ALL n or TAKE OUT, THEN HIDE: the library's own band, with UNDO. -->
		<div class="lib-band">
			<Band
				title={(hiddenBand ?? looseBand)?.title ?? ''}
				detail={(hiddenBand ?? looseBand)?.detail ?? ''}
				ondismiss={dropAnswer}
			>
				{#snippet action()}
					<form method="POST" action="?/undoHide" use:enhance={undoAfter}>
						<input type="hidden" name="facts" value={JSON.stringify(hideFacts)} />
						<button type="submit">UNDO</button>
					</form>
				{/snippet}
			</Band>
		</div>
	{/if}
	{#if undoMessage}
		<!-- A refusal of a band's UNDO: an UNDO on one of the bands above
		     refused, the library having moved on. It is drawn whatever
		     `selecting` is: the bands stay up while a selection is open, so an
		     UNDO pressed then refused there too, and the bar's `.fold-refused`
		     line is not where a band's own answer belongs. The band's own
		     refusal shape, as the series and Work screens draw theirs. A refusal
		     from the bulk bar or the GROUP sheet stays in the bar's line, and
		     goes with ✕; this one goes when any form is sent or ✕/SELECT is
		     pressed (`passed`). -->
		<div class="lib-band">
			<Band title={undoMessage} detail="NOTHING CHANGED" ondismiss={dropAnswer} />
		</div>
	{/if}
	{#if showFacts}
		<!-- UNHIDE on a part shows the Work whole: the same band and UNDO as
		     HIDE, the other way round, because the same rule runs both ways. -->
		<div class="lib-band">
			<Band
				title={shownBand?.title ?? `SHOWN · ${showFacts.shown.length} SERIES`}
				detail={shownBand?.detail ?? `${showFacts.shown.length} SERIES · HIDDEN AGAIN BY UNDO`}
				ondismiss={dropAnswer}
			>
				{#snippet action()}
					<form method="POST" action="?/undoShow" use:enhance={undoAfter}>
						<input type="hidden" name="facts" value={JSON.stringify(showFacts)} />
						<button type="submit">UNDO</button>
					</form>
				{/snippet}
			</Band>
		</div>
	{/if}
	<MoreSheet
		open={moreOpen}
		initial={moreAt}
		onclose={closeMore}
		queued={data.queue?.queued ?? null}
		lastImport={data.lastImportAt}
		start={data.start && !data.start.finished
			? { done: data.start.done + data.start.skipped, total: data.start.steps.length }
			: null}
	/>

	{#if data.scan && scanning && data.scan.sourceLabel === BACKUP_LABEL}
		<!-- A backup importing:
		     the scan's band, named, counting series rather than bytes. LOG → opens
		     the job's own entry in IMPORT LOG, which the band knows by its
		     id (`?job=`). -->
		<Banner
			kind="progress"
			title="IMPORTING · {BACKUP_LABEL}"
			detail="{count(data.scan.bytesDone)} OF {count(data.scan.bytesTotal)} SERIES"
			progress={data.scan.bytesTotal > 0 ? data.scan.bytesDone / data.scan.bytesTotal : 0}
			meta="{count(data.scan.seriesFound)} SO FAR ON NEW"
			metaRight="LOG →"
			metaHref="/import/log?job={data.scan.id}"
		/>
	{:else if data.scan && scanning}
		<Banner
			kind="progress"
			title="SCANNING ON WORKSTATION"
			detail="{gb(data.scan.bytesDone)} / {gb(data.scan.bytesTotal)} GB"
			progress={data.scan.bytesTotal > 0 ? data.scan.bytesDone / data.scan.bytesTotal : 0}
			meta="{count(data.scan.seriesFound)} SERIES SO FAR"
			metaRight={data.scan.sourceLabel
				? `${data.scan.sourceLabel.toUpperCase()} · ${data.scan.step} OF ${data.scan.steps}`
				: undefined}
		/>
	{:else if data.scan && justImported}
		<!-- SEE LOG opens the job's entry, the same `?job=` the importing
		     band's LOG → uses. -->
		<Banner
			kind="action"
			title="IMPORT FINISHED · {count(data.scan.seriesFound)} SERIES"
			detail={data.scan.failedFiles > 0
				? `${count(data.scan.failedFiles)} FILES FAILED · SEE LOG`
				: undefined}
			detailHref={data.scan.failedFiles > 0 ? `/import/log?job=${data.scan.id}` : undefined}
		>
			{#snippet action()}
				<form method="POST" action="?/dismissScan" use:enhance>
					<input type="hidden" name="scan" value={data.scan?.id} />
					<button type="submit">TIDY NEW →</button>
				</form>
				<!-- TIDY NEW also goes to the NEW shelf; this only clears the band.
				     A stored band's ✕, not a form answer: its answer is not applied
				     as `form`, which would retire a HIDE band on screen, UNDO and all.
				     The page is read again, so the band goes as the workstation says. -->
				<form method="POST" action="?/dismissScan" use:enhance={keepForm}>
					<input type="hidden" name="scan" value={data.scan?.id} />
					<input type="hidden" name="stay" value="1" />
					<button type="submit" aria-label={m.band_dismiss()}>✕</button>
				</form>
			{/snippet}
		</Banner>
	{/if}

	{#if isOffline}
		<Banner kind="info" title="○ OFFLINE" detail="CACHED STILL OPENS" />
	{/if}

	{#if hiddenRun}
		<Banner kind="action" title={hiddenRun.title} detail={hiddenRun.detail}>
			{#snippet action()}
				<button type="button" onclick={() => (updateRun.hidden = false)}>{m.update_show()}</button>
			{/snippet}
		</Banner>
	{:else if updatedTo}
		<Banner
			kind="action"
			title={m.update_updated_to({ version: updatedTo })}
			detail="{m.update_whats_new_stays()} {m.name_settings()} › {m.name_devices_section()}"
		>
			{#snippet action()}
				<button type="button" aria-label={m.chrome_close()} onclick={dropUpdated}>✕</button>
			{/snippet}
		</Banner>
	{:else if newVersion}
		<Banner
			kind="action"
			title={m.update_out({ version: newVersion })}
			detail={m.update_out_detail()}
		>
			{#snippet action()}
				<a href="{resolve('/settings')}#s-devices">{m.name_settings()} →</a>
			{/snippet}
		</Banner>
	{/if}

	{#if data.queue && data.queue.failed > 0 && !data.empty}
		<!-- Failures are a band like POSSIBLE DUPLICATES, so the library says when something needs a hand. -->
		<Banner
			kind="action"
			title="{String(data.queue.failed).padStart(2, '0')} DOWNLOAD{data.queue.failed === 1
				? ''
				: 'S'} FAILED"
			detail="{data.queue.failedSeries.length} SERIES · {data.queue.failedSeries
				.join(', ')
				.toUpperCase()}"
		>
			{#snippet action()}
				<a href={resolve('/downloads')}>REVIEW →</a>
			{/snippet}
		</Banner>
	{/if}

	{#if data.dupes > 0 && !data.empty}
		<!-- Only while there are pairs the viewer can see (doc/DUPLICATE-BOOKS.md). -->
		<Banner
			kind="action"
			title="{String(data.dupes).padStart(2, '0')} POSSIBLE DUPLICATE{data.dupes === 1 ? '' : 'S'}"
			detail="SAME COVER, DOWNLOADED TWICE"
		>
			{#snippet action()}
				<a href={resolve('/duplicates')}>REVIEW →</a>
			{/snippet}
		</Banner>
	{/if}

	{#if linksBand}
		<!-- Below duplicates, which are older and fewer (doc/LINKS.md). -->
		<Banner
			kind="action"
			title="{String(data.toLink).padStart(2, '0')} SERIES TO LINK"
			detail={isOffline ? 'THE REVIEW NEEDS THE WORKSTATION' : 'FOUND ON ANILIST, NOT FOR CERTAIN'}
		>
			{#snippet action()}
				<!-- One block at the band's end: the band spreads its children apart. -->
				<span class="link-acts">
					{#if isOffline}
						<span class="dimmed" aria-disabled="true">REVIEW →</span>
					{:else}
						<a href={resolve('/links')} aria-label="Review the series to link">REVIEW →</a>
					{/if}
					<!-- The name says "grows", never "more": a name holding MORE is a
					     second button for anyone asking for the bar's MORE by name. -->
					<button
						type="button"
						class="put-away"
						aria-label="Put away the series to link until the count grows"
						data-focus-mark="in"
						onclick={putLinksAway}>✕</button
					>
				</span>
			{/snippet}
		</Banner>
	{/if}

	{#if data.empty}
		<!-- GET STARTED (doc/ONBOARDING.md): until every step is done or
		     skipped the empty library is the list; then the first day's sources. -->
		{#if data.start && !data.start.finished}
			<section class="ob" aria-label={m.start_page_label()}>
				<div class="ob-head">
					<div class="ob-k">{readLeads(data.start) ? m.start_head_read() : m.start_head()}</div>
					<div class="ob-k">{countLine(data.start)}</div>
				</div>
				<h1>{readLeads(data.start) ? m.start_read_title() : m.start_empty_title()}</h1>
				<p class="lede">{readLeads(data.start) ? m.start_read_lede() : m.start_empty_lede()}</p>
				<div class="ob-list">
					<StartList
						view={data.start}
						libraryRoot={data.libraryRoot}
						extras={data.firstRead}
						imported={data.imported}
					/>
				</div>
				{#if form && 'scanMessage' in form}<div class="scan-message">{form.scanMessage}</div>{/if}
			</section>
		{:else}
			<StartFirstDay
				sources={data.firstDay}
				libraryRoot={data.libraryRoot}
				scanMessage={form && 'scanMessage' in form ? String(form.scanMessage) : ''}
			/>
		{/if}
	{:else if data.person}
		<PersonView
			page={data.person}
			reveal={data.reveal}
			workFeet={data.workFeet}
			works={data.works}
			{selecting}
			{selected}
			onselect={(i) =>
				selected.has(i.seriesId) ? selected.delete(i.seriesId) : selected.add(i.seriesId)}
		/>
	{:else}
		{#if showContinue}
			<div class="cont-section">
				<SectionLabel index={1} text="Continue" top={18}>
					{#snippet right()}
						{#if isOffline}
							{contShown.filter((c) => cachedOn(c) > 0).length} OF {contShown.length} CACHED
						{:else}
							<!-- History is CONTINUE going further back. -->
							<a class="to-history" href={resolve('/history')}
								>{count(data.cont.total)} OPEN · HISTORY →</a
							>
						{/if}
					{/snippet}
				</SectionLabel>
				<div class="cont">
					{#each contShown as item, i (item.id)}
						{@const cached = cachedOn(item) > 0}
						<ContinueRow
							title={item.title}
							meta={item.work
								? item.entryLabel.toUpperCase()
								: continueSub(item, isOffline ? { cached } : undefined)}
							work={item.work ?? null}
							progress={item.entryFraction ?? progress(item)}
							src={coverSrc(item.id, item.cover)}
							hue={item.hue}
							unavailable={isOffline && !cached}
							href={continueHref(item)}
							onopen={item.work ? undefined : () => (waiting.preview = previewOf(item))}
							focusId={`continue-${item.id}`}
							linkFocusId={`cont-${item.id}`}
							focusDown={i === 0 && tvScreen.current ? '.tabs nav .tab' : undefined}
							startFocus={i === 0}
							onresume={item.resumeId !== null
								? // eslint-disable-next-line svelte/no-navigation-without-resolve -- readHref() resolves
									() => goto(readHref(item.resumeId!))
								: undefined}
							onlongpress={item.work || selecting ? undefined : () => (sheetId = item.id)}
						/>
					{/each}
				</div>
			</div>
		{/if}

		<SectionLabel index={2} text={sectionText} extra={sectionExtra}>
			{#snippet right()}
				{#if nFilters > 0}<span class="desk-count">{outOf} ·&nbsp;</span>{/if}
				{#if selecting}
					TAP TO ADD
				{:else if scanning}
					{outlined ? 'LOADING' : 'NEWEST FIRST'}
				{:else}
					<!-- A sort past 1 s outlines the grid: SORT stays drawn, dimmed, with
					     LOADING beside it, so the cell holding focus never leaves the page
					     (LOADING in its place would drop the mark to the body for as long
					     as the outline lasted). -->
					{#if outlined}<span class="loading">LOADING</span>{/if}
					<span class="sort" class:busy={outlined} aria-busy={outlined}>
						<ChoiceMenu label="Sort" choices={SORT_CHOICES} value={data.sort} onpick={sortTo} />
						{#if data.sort !== 'random'}
							<button type="button" class="dir" onclick={flipDir} aria-label="Reverse order"
								>{dirLabel(data.sort, data.dir)}</button
							>
						{/if}
					</span>
				{/if}
			{/snippet}
		</SectionLabel>

		<div class="tabs">
			<ShelfTabs
				bare
				shelves={tabs}
				active={activeShelf}
				href={(k) => shelfHref(page.url, k)}
				newHref={isOffline ? undefined : withParam(page.url, 'new', 'shelf')}
			/>
		</div>

		{#if bandCounts}
			<!-- The KIND band: one row under the tabs and over
			     the grid, which kind on whichever shelf shows. FILTER sits at its end
			     on the phone and tablet; the desktop's stays in the top bar. It pins
			     under the top bar where the tabs don't, and pinned names the shelf. -->
			<div class="band-mark" bind:this={bandMark} aria-hidden="true"></div>
			<div
				class="kinds"
				class:pinned={bandPinned}
				role="group"
				aria-label={m.nav_kind_band()}
				bind:this={bandEl}
			>
				{#if bandPinned}
					<button
						type="button"
						class="klabel shelf"
						data-focus-mark="in"
						data-focus-id="kind-shelf"
						onclick={toTabs}>{shelfName.toUpperCase()} <span aria-hidden="true">▴</span></button
					>
				{:else}
					<div class="klabel">{upper(m.nav_kind_band())}</div>
				{/if}
				<!-- ↓ from any cell enters the grid at its first tile, not the one under
				     the cell: a kind chosen opens at its start. -->
				<div class="kscroll" use:keepChosen={data.filters.kind} data-focus-down=".grid .tile .open">
					{#each bandCells as c (c.kind ?? 'all')}
						<!-- eslint-disable svelte/no-navigation-without-resolve -- filterHref resolves -->
						<a
							class="kc"
							class:on={c.on}
							class:zero={c.zero}
							href={kindHref(c.kind)}
							aria-current={c.on ? 'true' : undefined}
							data-sveltekit-noscroll
							data-sveltekit-keepfocus
							onclick={chooseKind}
							data-focus-mark="in"
							data-focus-id={`kind-${c.kind ?? 'all'}`}
							data-focus-line
							data-focus-title="{kindWord(c.kind)} · {count(c.n)} ON {shelfName.toUpperCase()}"
							data-focus-meta={c.on ? 'SHOWING' : 'OK SHOWS THEM · THE GRID WAITS'}
							><span>{kindWord(c.kind)}</span><span class="n">{count(c.n)}</span></a
						>
						<!-- eslint-enable svelte/no-navigation-without-resolve -->
					{/each}
				</div>
				{#if canFilter}
					<div class="kfilter">
						<FilterPanel
							band
							filters={data.filters}
							languages={languagesHere}
							kindRow={false}
							formRow
							countKind={false}
							reveal={data.reveal}
							following={data.following}
							title={shelfName.toUpperCase()}
							count={nFilters ? outOf : shelfSize.toLocaleString('en-US')}
							href={filterHref}
							formAction={resolve('/')}
							keep={keepParams}
							onchoose={chooseFilter}
						/>
					</div>
				{/if}
			</div>
		{/if}

		<!-- The TV's focus line, under the pinned tabs (only a TV draws it). -->
		<FocusLine />

		{#if outlined}
			<GridOutline />
		{:else if data.shelf !== 'people'}
			<!-- BACK from the grid climbs to what is pinned over it: the KIND band's
			     chosen cell.
			     In full view, so BACK goes on to the screen's start (doc/FOCUS.md). -->
			<div class="grid" data-back-climb=".kinds .kc.on">
				{#each shown as s, i (s.id)}
					{@const cached = cachedOn(s)}
					{#if s.tile}
						<!-- Browsing shows the run as one tile (doc/WORKS.md). -->
						<WorkTile
							tile={s.tile}
							cached={isOffline && cached > 0 ? cached : null}
							dimmed={isOffline && cached === 0}
							selectable={selecting}
							selected={cardSelected(s)}
							focusId={`work-${s.tile.id}`}
							startFocus={!showContinue && i === 0}
							meta={focusMeta(s)}
							onpress={() => press(s)}
						/>
					{:else}
						<CoverTile
							src={coverSrc(s.id, s.cover)}
							title={s.title}
							hue={s.hue}
							rating={ratingNow.get(s.id) ?? s.rating}
							favourite={favNow.get(s.id) ?? s.favourite}
							favUnsaved={unsaved('fav', s.id, s.favourite)}
							ratingUnsaved={unsaved('rating', s.id, s.rating)}
							newCount={s.newCount}
							hidden={s.hidden}
							indexing={!s.indexed}
							languages={s.languages}
							cached={isOffline && cached > 0 ? cached : null}
							dimmed={isOffline && cached === 0}
							selectable={selecting}
							selected={selected.has(s.id)}
							focusId={`series-${s.id}`}
							startFocus={!showContinue && i === 0}
							meta={focusMeta(s)}
							onpress={() => press(s)}
							onlongpress={() => (selecting ? toggle(s.id) : (sheetId = s.id))}
							onfavourite={isOffline ? undefined : (on) => favourite(s.id, on)}
							onrate={isOffline ? undefined : (r) => rate(s.id, r)}
						/>
					{/if}
				{/each}
				{#each { length: fillers }, i (i)}
					<div class="filler" aria-hidden="true"></div>
				{/each}
			</div>
			{#if hasMore}
				<!-- The end of what's loaded: coming near it asks for the next page. -->
				<div class="more" use:nearEnd>
					{#if moreFailed}
						<span
							>{series.length.toLocaleString('en-US')} OF {data.total.toLocaleString('en-US')} · THE REST
							DID NOT LOAD</span
						>
						<button type="button" onclick={() => void loadMore()}>RETRY</button>
					{:else if isOffline}
						<span
							>{series.length.toLocaleString('en-US')} OF {data.total.toLocaleString('en-US')} · THE REST
							NEEDS THE WORKSTATION</span
						>
					{:else}
						<span
							>{series.length.toLocaleString('en-US')} OF {data.total.toLocaleString('en-US')}</span
						>
						<span>{loadingMore ? 'LOADING' : ''}</span>
					{/if}
				</div>
			{/if}
		{/if}

		{#if data.shelf === 'people'}
			<!-- The PEOPLE shelf: favourite people, each opening their page. -->
			<div class="people">
				{#each data.people as p (p.namespace + ':' + p.value)}
					<TagChip
						namespace={p.namespace}
						value={p.value}
						count={p.count}
						href={tagHref(`${p.namespace}:${p.value}`)}
					/>
				{/each}
			</div>
			{#if data.people.length === 0}
				<p class="none">NO FAVOURITE PEOPLE · FAV ONE FROM THEIR PAGE</p>
			{/if}
		{:else if shown.length === 0 && data.shelf.startsWith('c:') && (shelfSize === 0 || nFilters === 0) && !outlined}
			<!-- A new shelf: empty until something is added, and says how. First,
			     since a kind is carried across shelves: an empty shelf with a
			     kind or a filter on is still empty, not "no manga here". -->
			<div class="empty-shelf">
				<p class="empty-title">Nothing on {shelfName} yet.</p>
				<p class="empty-sub">
					Long-press a cover and tick it under SHELVES, or SELECT several and + SHELF.
				</p>
				<button type="button" class="empty-select" onclick={startSelecting}>SELECT</button>
			</div>
		{:else if shown.length === 0 && kindAtZero && !outlined}
			<!-- The kind chosen elsewhere, none of it here: the band
			     keeps it at 0, and this says so with the way back to every kind. -->
			{@const all = bandCounts?.all ?? 0}
			<div class="empty-result">
				<p class="empty-title">No {kindWord(data.filters.kind).toLowerCase()} on {shelfName}.</p>
				<p class="empty-sub">The shelf holds {all.toLocaleString('en-US')}.</p>
				<!-- eslint-disable-next-line svelte/no-navigation-without-resolve -- kindHref resolves -->
				<a class="empty-clear" href={kindHref(null)} data-sveltekit-noscroll
					>✕ ALL KINDS · SHOW {all.toLocaleString('en-US')}</a
				>
			</div>
		{:else if shown.length === 0 && nFilters > 0 && !outlined}
			<!-- Filters that leave nothing: a narrow question about one shelf, not an empty library. -->
			<div class="empty-result">
				<p class="empty-title">Nothing on {shelfName} matches these filters.</p>
				<p class="empty-sub">The shelf holds {shelfSize.toLocaleString('en-US')}.</p>
				<!-- eslint-disable-next-line svelte/no-navigation-without-resolve -- filterHref resolves -->
				<a class="empty-clear" href={filterHref(NO_FILTERS)} data-sveltekit-noscroll
					>✕ CLEAR · SHOW {shelfSize.toLocaleString('en-US')}</a
				>
			</div>
		{:else if shown.length === 0}
			<p class="none">NOTHING ON THIS SHELF</p>
		{/if}
	{/if}
	{#if farDown && !selecting}
		<button type="button" class="to-top appear" data-focus-mark="in" onclick={toTop} out:leave
			>BACK TO TOP ↑</button
		>
	{/if}
</div>

<SelectionBar
	bind:this={bar}
	{selecting}
	{selected}
	{facts}
	workFeet={data.workFeet}
	existing={data.existing}
	existingVolumes={data.existingVolumes}
	existingWorks={data.existingWorks}
	shelves={data.shelves}
	hiddenOf={(id) => hiddenById.get(id)}
	fill={fillUnseen}
	{foldMessage}
	{batch}
	bulkAnswer={keepAfterBulk}
	ondismissBatch={dropAnswer}
	ongrouped={stopSelecting}
	onhide={async () => {
		stopSelecting();
		// The sheet's `update` did not re-read: this is the one reload,
		// and `reloadList` asks for the loaded pages once behind it.
		await reloadList();
	}}
	ondeleted={async () => {
		stopSelecting();
		await invalidateAll();
	}}
/>

{#if newOpen}
	<NewShelfSheet closeHref={withParam(page.url, 'new', null)} />
{/if}

<SeriesSheet
	id={sheetId}
	shelves={data.shelves}
	onclose={() => (sheetId = null)}
	onchange={() => invalidateAll()}
/>

<!-- SHOW: the selection, wherever it was ticked, in the order it was
     ticked; the search draws the same sheet. -->
<SelectionSheet
	open={reviewing}
	ids={shownIds}
	{facts}
	{selected}
	{unseen}
	ontoggle={toggle}
	onclose={() => (reviewing = false)}
/>

<style>
	.tag-title {
		flex: 1;
		gap: 10px;
		padding: 0 18px;
		font: 500 16px var(--font-mono);
		white-space: nowrap;
		overflow: hidden;
	}
	.tag-title .ns {
		color: var(--text-2);
	}
	.back {
		font: 500 16px var(--font-mono);
	}
	.people {
		display: flex;
		flex-wrap: wrap;
		gap: 8px;
		padding: 18px var(--pad);
	}
	.library {
		display: flex;
		flex-direction: column;
		flex: 1;
	}
	/* The top bar stays on a desktop too: the sidebar stays, and so
	   does the search beside it. TopBar pins it on a phone, the tablet and a
	   TV already, and lets it go on a desktop. */
	@media (min-width: 1024px) and (pointer: fine) {
		.library > :global(header.bar.sticky) {
			position: sticky;
			z-index: 8;
		}
	}
	/* BACK TO TOP: a corner cell, ruled on its two inner sides, over
	   the tiles and under the bulk bar and sheets, as the top bar is. The
	   page keeps room under the last row for it. Not on a TV. */
	.to-top {
		position: fixed;
		right: 0;
		bottom: 0;
		z-index: 8;
		display: flex;
		align-items: center;
		height: 52px;
		padding: 0 var(--pad) env(safe-area-inset-bottom);
		border: 0;
		border-top: var(--hairline);
		border-left: var(--hairline);
		border-radius: 0;
		background: var(--surface-page);
		color: var(--text-1);
		font: var(--type-control);
		white-space: nowrap;
		cursor: pointer;
	}
	.library:not(.selecting) {
		padding-bottom: calc(53px + env(safe-area-inset-bottom));
	}
	/* Not while FILTER's panel or SORT's list is open: their scrims sit in a
	   pinned bar's stacking context, so the cell, at the bar's z-index later in
	   the page, was drawn lit above the dimmed screen. Read off the two
	   components' own open states, the <details> and the cell's aria-expanded.
	   Each FILTER counts only where it is drawn: the top bar's on a
	   desktop, the KIND band's elsewhere. A <details> CSS has hidden stays
	   open, so a FILTER left open at 1200px and the window narrowed to 900px
	   hid BACK TO TOP for good. A person's page's FILTER is drawn everywhere. */
	.library:has(:global(.menu > .cell[aria-expanded='true'])) .to-top,
	.library:has(:global(details.filter[open]:not(.filter-desk *):not(.kfilter *))) .to-top {
		display: none;
	}
	@media (min-width: 1024px) and (pointer: fine) {
		.library:has(.filter-desk :global(details.filter[open])) .to-top {
			display: none;
		}
	}
	@media (max-width: 1023px), (pointer: coarse), (pointer: none) {
		.library:has(.kfilter :global(details.filter[open])) .to-top {
			display: none;
		}
	}
	@media (pointer: none) and (min-width: 900px) {
		.to-top {
			display: none;
		}
		/* The room above is BACK TO TOP's, which a TV does not draw; it keeps
		   its own safe margin instead, as the TV block below sets for every
		   other case. This rule outranks that one, so it says it again. */
		.library:not(.selecting) {
			padding-bottom: var(--safe-y);
		}
	}
	/* On a TV the focus layer brings a focused tile clear of the pinned bars
	   (the tabs and the focus line) by its button's own edge, and the cover's
	   ring is drawn 7px outside the cover, which is that edge: coming back up
	   the grid, the focus line covered the ring by 7px. So the button reaches
	   7px up into the tile's 10px padding, and the ring comes clear with
	   it. Nothing drawn moves; a TV has no pointer for the larger box. */
	@media (pointer: none) and (min-width: 900px) {
		.grid :global(.tile > .open) {
			margin-top: -7px;
			padding-top: 7px;
		}
	}
	/* The SERIES TO LINK band's ✕: a plain cell after REVIEW, not a
	   second accent action. */
	.link-acts {
		align-self: stretch;
		display: flex;
	}
	.library .put-away {
		min-width: 60px;
		justify-content: center;
		padding: 0 18px;
		border-left: var(--hairline);
		background: transparent;
		color: var(--text-1);
		font: 500 18px var(--font-mono);
	}
	/* Room for the pinned bulk bar: two 60px rows and the rule above them. */
	.library.selecting {
		padding-bottom: 122px;
	}
	/* And the extra row REFRESH's band takes above it. */
	.library.selecting.has-band {
		padding-bottom: 182px;
	}
	.brand {
		padding: 0 var(--pad);
		color: inherit;
		text-decoration: none;
	}
	.search-hint .long,
	.search-hint .short {
		display: none;
	}
	.cont-section {
		display: contents;
	}
	.to-history {
		color: inherit;
		text-decoration: none;
	}
	.to-history:active {
		color: var(--text-1);
	}
	/* Phone: the Japanese wordmark, four continue rows and the long search hint
	   do not fit, and multi-select needs the room the continue shelf takes. */
	@media (max-width: 599px) {
		.brand :global(.jp) {
			display: none;
		}
		.search-hint .short {
			display: inline;
		}
		.cont > :global(:nth-child(n + 3)) {
			display: none;
		}
		.selecting .cont-section {
			display: none;
		}
	}
	@media (min-width: 600px) {
		.search-hint .long {
			display: inline;
		}
	}
	/* The shelf tabs: the whole width, FILTER being at the KIND band's end. */
	.tabs {
		position: relative;
		z-index: 5;
		display: flex;
		border-top: var(--hairline);
		border-bottom: var(--hairline);
	}
	.tabs > :global(nav) {
		position: relative;
		background: var(--surface-page);
	}
	/* ---- the KIND band (literals for sizes, not the ladder, and the tokens
	   for colour). One 40px row, 13px mono against the
	   tabs' 46px and 14px, so the two never read as one double row. It pins
	   under the top bar (z 7, the bar is 8) as the grid scrolls; the tabs
	   don't. The marker above it is what says it has pinned. */
	.band-mark {
		height: 0;
	}
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
		border: 0;
		border-right: var(--hairline);
		border-radius: 0;
		background: var(--surface-page);
		font: 500 12px/1 var(--font-mono);
		letter-spacing: 0.06em;
		color: var(--text-2);
		white-space: nowrap;
	}
	/* Pinned, the label is the shelf's name and the way back to the tabs. */
	.klabel.shelf {
		gap: 6px;
		font-size: 13px;
		letter-spacing: 0.02em;
		color: var(--text-1);
		cursor: pointer;
	}
	.klabel.shelf:active {
		background: var(--surface-inverse);
		color: var(--text-inverse);
	}
	/* Scrolls sideways, never wraps: a cut-off cell is the cue.
	   Above FILTER's scrim, as the tabs were, so the band stays lit. */
	.kscroll {
		position: relative;
		z-index: 5;
		display: flex;
		flex: 1;
		min-width: 0;
		overflow-x: auto;
		scrollbar-width: none;
		background: var(--surface-page);
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
	/* The chosen kind kept on a shelf with none of it: drawn at 0, dimmed. */
	.kc.zero {
		opacity: 0.4;
	}
	.kc.on,
	.kc.on:hover,
	.kc:active {
		background: var(--surface-inverse);
		color: var(--text-inverse);
	}
	.kfilter {
		display: flex;
		flex-shrink: 0;
	}
	/* An open menu is over everything in the page's flow, and still
	   under the top bar (8) and its sheets (20). SORT's list is 7 in the same
	   stacking context as the band (no ancestor between them makes one: the
	   section label and the SORT block are not stacked), so the band, at 7
	   later in the page (9 on a TV), drew over the list. Raising the list
	   would lift it over the top bar too, so while it is open the band steps
	   down to 6: still over the grid, whose highest layer is 3. FILTER's
	   panel needs nothing: on a phone, tablet and TV it is inside the band's
	   own context, on the desktop inside the top bar's (8). A TV's focus line
	   (9) is not drawn while either menu has focus (no data-focus-line). */
	.library:has(.sort :global(.menu > .cell[aria-expanded='true'])) .kinds {
		z-index: 6;
	}
	/* The phone drops the KIND label for room, and has the shelf's cell only pinned. */
	@media (max-width: 599px) {
		.klabel:not(.shelf) {
			display: none;
		}
	}
	@media (min-width: 600px) {
		.kc {
			padding: 0 14px;
		}
	}
	/* The desktop: under the section label, ruled above too; FILTER is the top bar's. */
	@media (min-width: 1024px) and (pointer: fine) {
		.kinds {
			border-top: var(--hairline);
		}
		.kfilter {
			display: none;
		}
	}
	/* SORT: one closed block of square cells, the menu (▾ says it opens) and
	   the direction beside it, as the panel rows draw a sort ("cells plus
	   ↓ / ↑"). The menu is the house's own (ChoiceMenu); its list hangs
	   from the whole block, so the block is what is positioned. */
	.sort {
		position: relative;
		display: inline-flex;
		align-items: stretch;
		height: 32px;
		border: 1px solid var(--line-2);
		color: var(--text-1);
	}
	/* Loading: still there and still the cell focus is on, dimmed. */
	.sort.busy {
		opacity: 0.5;
	}
	.loading {
		margin-right: 12px;
	}
	.sort .dir {
		display: flex;
		align-items: center;
		justify-content: center;
		min-width: 44px;
		box-sizing: border-box;
		cursor: pointer;
		padding: 0 10px;
		border-left: 1px solid var(--line-2);
	}
	.sort .dir:focus-visible {
		outline: 2px solid var(--accent);
		outline-offset: -2px;
	}
	.sort .dir:active {
		background: var(--surface-inverse);
		color: var(--text-inverse);
	}
	.filter-desk,
	.desk-count {
		display: none;
	}
	/* Not positioned: its panel hangs from the top bar's right edge, 640 wide.
	   FILTER's own left rule is the tabs' divider; here the cell before it
	   draws that one, and FILTER draws the rule against SELECT. */
	.filter-desk {
		align-self: stretch;
		border-right: var(--hairline);
	}
	.filter-desk :global(summary) {
		border-left: 0;
	}
	/* Desktop: the wordmark and the shelves move into the sidebar, FILTER into
	   the top bar beside SELECT, and the count into the section label. */
	@media (min-width: 1024px) and (pointer: fine) {
		.library :global(header .left:has(.brand)),
		.tabs {
			display: none;
		}
		.filter-desk {
			display: flex;
		}
		.desk-count {
			display: inline;
		}
	}
	/* Filters that leave nothing, and a shelf with nothing yet. */
	.empty-result,
	.empty-shelf {
		display: flex;
		flex-direction: column;
		align-items: flex-start;
		gap: 20px;
		padding: 64px var(--pad);
	}
	.empty-shelf {
		gap: 16px;
		padding: 48px var(--pad);
	}
	.empty-title,
	.empty-sub {
		margin: 0;
	}
	.empty-result .empty-title {
		font: 500 22px/1.3 var(--font-sans);
		text-wrap: pretty;
	}
	.empty-shelf .empty-title {
		font: 500 20px/1.3 var(--font-sans);
	}
	.empty-sub {
		font: 400 15px/1.5 var(--font-sans);
		color: var(--text-prose);
		text-wrap: pretty;
	}
	.empty-clear {
		display: flex;
		align-items: center;
		height: 52px;
		padding: 0 24px;
		background: var(--accent);
		color: var(--on-accent);
		font: 500 14px var(--font-mono);
	}
	.empty-select {
		display: flex;
		align-items: center;
		height: 48px;
		padding: 0 20px;
		border: 1px solid var(--line-2);
		border-radius: 0;
		background: transparent;
		color: var(--text-1);
		font: 500 14px var(--font-mono);
		cursor: pointer;
	}
	.search-hint {
		flex: 1;
		padding: 0 18px;
		font: 400 16px var(--font-mono);
		color: var(--text-2);
		white-space: nowrap;
		overflow: hidden;
	}
	.search-hint:hover {
		color: var(--text-1);
	}
	.cell-btn {
		padding: 0 var(--pad);
		border: 0;
		border-radius: 0;
		background: transparent;
		color: inherit;
		font: var(--type-control);
		cursor: pointer;
		white-space: nowrap;
	}
	.queue-cell {
		display: flex;
		flex-direction: column;
		justify-content: center;
		gap: 4px;
		padding: 0 var(--pad);
		border-right: var(--hairline);
		color: var(--text-1);
		text-decoration: none;
		white-space: nowrap;
	}
	@media (max-width: 599px) {
		.queue-cell {
			padding: 0 12px;
		}
	}
	/* The top bar's rules. The right-hand cell draws the first one, on
	   its left; every cell before SELECT draws the one after it, on its right
	   (BROWSE, QUEUE, the desktop's FILTER); MORE draws its own on its left,
	   so the rule goes with it where MORE is hidden. One rule per pair, never
	   two: a cell that also drew a left rule doubled the right-hand cell's. */
	.browse-cell {
		display: flex;
		align-items: center;
		padding: 0 var(--pad);
		border-right: var(--hairline);
		font: 500 14px/1.2 var(--font-mono);
		color: var(--text-1);
		text-decoration: none;
	}
	@media (max-width: 599px), (min-width: 1024px) and (pointer: fine) {
		.browse-cell {
			display: none;
		}
	}
	.queue-cell.stale {
		opacity: 0.35;
	}
	.q-label {
		font: 500 11px/1 var(--font-mono);
		letter-spacing: var(--tracking-label);
		color: var(--text-2);
	}
	.q-n {
		font: 500 14px/1 var(--font-mono);
	}
	.more-cell {
		border-left: var(--hairline);
	}
	/* The server cell: the wordmark's cell, then ON <NAME>. The
	   left cell draws the rule after it; this draws the one between it and the
	   wordmark. The cell stops at 200 px and the padding is the design's 22 px,
	   not `.cell-btn`'s --pad: a TV's --pad is 48, which
	   left a name 72 px and cut ARCHLINUX after four letters. At 22 the
	   name has 124 px, eleven characters in the TV's type, and a longer one ends
	   in an ellipsis; the 180 px on the name is the design's, and never the
	   limit that binds. Only the TV app draws it, so it carries the TV's control
	   type at every size. */
	.server-cell {
		display: flex;
		align-items: center;
		gap: 10px;
		max-width: 200px;
		padding: 0 22px;
		border-left: var(--hairline);
		letter-spacing: 0.02em;
	}
	.srv-on {
		color: var(--text-2);
	}
	.srv-name {
		max-width: 180px;
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
	}
	.server-cell.on {
		background: var(--surface-inverse);
		color: var(--text-inverse);
	}
	.server-cell.on .srv-on {
		color: inherit;
	}
	/* The phone's bar cells are 14px a side. */
	@media (max-width: 599px) {
		.more-cell {
			padding: 0 14px;
		}
	}
	/* A narrow phone's bar is the brand, /, SELECT and MORE: the word doesn't fit. */
	@media (max-width: 419px) {
		.search-hint .word {
			display: none;
		}
	}
	.more-cell.on {
		background: var(--surface-inverse);
		color: var(--text-inverse);
	}
	/* The desktop has the sidebar's foot itself. */
	@media (min-width: 1024px) and (pointer: fine) {
		.more-cell {
			display: none;
		}
	}
	.cell-btn:active:not(:disabled) {
		background: var(--surface-inverse);
		color: var(--text-inverse);
	}
	.cell-btn:disabled {
		opacity: 0.4;
		cursor: default;
	}
	.x {
		font: 500 18px var(--font-mono);
	}
	/* SHOW's sheet: GROUP's sheet's head and rows, drawn the same way. */
	.selected-count {
		padding: 0 18px;
		font: 500 17px var(--font-mono);
	}
	/* `/ SEARCH TO TICK`: the bar's empty middle,
	   the library's search hint in inverse. A phone has `/` alone,
	   and the count takes the room instead. */
	.to-tick {
		flex: 1;
		min-width: 0;
		gap: 1ch;
		padding: 0 18px;
		border-left: 1px solid var(--text-2);
		color: var(--text-inverse);
		font: 400 16px var(--font-mono);
		text-decoration: none;
		white-space: nowrap;
		overflow: hidden;
	}
	.to-tick b {
		font-weight: 500;
	}
	.to-tick:active {
		background: var(--surface-page);
		color: var(--text-1);
	}
	.all-short {
		display: none;
	}
	@media (max-width: 599px) {
		.selecting .selected-count {
			flex: 1;
		}
		.to-tick {
			flex: 0 0 auto;
			padding: 0 var(--pad);
			font: 500 16px var(--font-mono);
		}
		.to-tick .long,
		.all-long {
			display: none;
		}
		.all-short {
			display: inline;
		}
	}
	.cont {
		flex-shrink: 0;
		display: grid;
		grid-template-columns: repeat(var(--cont-cols), minmax(0, 1fr));
		border-top: var(--hairline);
	}
	/* Two columns: the left one of each pair draws the divider. */
	@media (min-width: 1024px) {
		.cont > :global(:nth-child(odd)) {
			border-right-color: var(--line-1);
		}
	}
	.grid {
		display: grid;
		grid-template-columns: repeat(var(--grid-cols), minmax(0, 1fr));
		gap: 1px;
		background: var(--line-1);
		/* Both rules, on purpose: under the tabs this doubles the tabs' own
		   bottom hairline. */
		border-top: var(--hairline);
		border-bottom: var(--hairline);
	}
	.filler {
		background: var(--surface-page);
	}
	/* The end of the loaded pages: a label row, like the section labels. */
	.more {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 16px;
		min-height: 44px;
		padding: 0 var(--pad);
		font: var(--type-label);
		letter-spacing: var(--tracking-label);
		color: var(--text-2);
		border-top: var(--hairline);
	}
	.more button {
		min-height: 44px;
		padding: 0 12px;
		font: inherit;
		letter-spacing: inherit;
		color: var(--text-1);
		background: none;
		border: 0;
		cursor: pointer;
	}
	.none {
		margin: 0;
		padding: 24px var(--pad);
		font: var(--type-label);
		letter-spacing: var(--tracking-label);
		color: var(--text-2);
	}

	/* ---- empty: GET STARTED (ob.css .ob); the list itself is StartList ---- */
	.ob {
		display: flex;
		flex-direction: column;
		max-width: 980px;
		padding: 48px 64px 56px;
	}
	.ob-head {
		display: flex;
		justify-content: space-between;
		align-items: baseline;
		gap: 12px;
		margin-bottom: 18px;
	}
	.ob-k {
		font: 500 12px/1.2 var(--font-mono);
		letter-spacing: 0.06em;
		color: var(--text-2);
	}
	.ob h1 {
		margin: 0;
		font: 500 34px/1.2 var(--font-sans);
	}
	.lede {
		margin: 14px 0 0;
		max-width: 680px;
		font: 400 18px/1.5 var(--font-sans);
		color: var(--text-2);
		text-wrap: pretty;
	}
	.ob-list {
		margin-top: 32px;
	}
	.scan-message {
		padding-top: 12px;
		font: var(--type-meta);
		color: var(--text-2);
	}
	@media (max-width: 599px) {
		.ob {
			padding: 24px 0 32px;
		}
		.ob-head,
		.ob h1,
		.lede {
			padding: 0 16px;
		}
		.ob h1 {
			font-size: 26px;
		}
		.lede {
			font-size: 16px;
		}
	}
	/* FOLD AS LANGUAGES: the accent cell, its languages under it. */
	/* ---- the TV ---------------------------------------- */
	@media (pointer: none) and (min-width: 900px) {
		.library {
			padding-bottom: var(--safe-y);
		}
		/* Bulk tidying is not a couch job. */
		.select-cell {
			display: none;
		}
		.search-hint {
			gap: 10px;
			justify-content: flex-start;
			padding: 0 22px;
			font: 400 17px/1.2 var(--font-mono);
			/* The design's computed 0.32px, as measured. */
			letter-spacing: 0.32px;
		}
		/* CONTINUE: three cards across, 288x120, inside the safe margin. */
		.cont {
			margin: 0 var(--pad);
			gap: 1px;
			background: var(--line-1);
			border: var(--hairline);
		}
		.cont > :global(.row) {
			background: var(--surface-page);
		}
		.cont > :global(:nth-child(n + 4)) {
			display: none;
		}
		/* The shelf tabs, in the safe margin. The KIND band pins under the safe
		   top in their place, so the pinned rows are 56 + 64px. */
		.tabs {
			height: var(--tv-tab-h);
			margin: 0 var(--pad);
			border: var(--hairline);
			background: var(--surface-page);
		}
		.tabs > :global(nav) {
			height: 100%;
		}
		/* The band: a 56px focus row of its own under the tabs. Moving along it
		   moves focus only; a cell is a link, so nothing changes until OK. */
		.kinds {
			top: 0;
			z-index: 9;
			height: var(--tv-tab-h);
			margin: 0 var(--pad);
			border: var(--hairline);
			border-top: 0;
		}
		.kinds.pinned {
			border-top: var(--hairline);
		}
		.klabel {
			padding: 0 18px;
			font-size: 15px;
		}
		.klabel.shelf {
			font-size: 17px;
		}
		.kc {
			padding: 0 18px;
			font-size: 17px;
		}
		/* Six 144px cells inside the safe margin; the grid's own hairline. */
		.grid {
			margin: 0 var(--pad);
			border-left: var(--hairline);
			border-right: var(--hairline);
		}
	}
</style>

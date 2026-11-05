<script lang="ts">
	import { m } from '$lib/paraglide/messages';
	import ConfirmSheet from '$lib/components/chrome/ConfirmSheet.svelte';
	import Band from '$lib/components/chrome/Band.svelte';
	import { backLink } from '$lib/back';
	import { enhance } from '$app/forms';
	import type { SubmitFunction } from '@sveltejs/kit';
	import { afterNavigate, beforeNavigate, goto, invalidateAll } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { onMount, tick, untrack } from 'svelte';
	import { SvelteMap, SvelteSet } from 'svelte/reactivity';
	import { page } from '$app/state';
	import Banner from '$lib/components/chrome/Banner.svelte';
	import { browser, version } from '$app/environment';
	import UpdateModal from './UpdateModal.svelte';
	import StartList from '$lib/components/start/StartList.svelte';
	import StartFirstDay from '$lib/components/start/StartFirstDay.svelte';
	import { countLine, readLeads } from '$lib/library/start';
	import { updateRun } from '$lib/update-run.svelte';
	import {
		DONE_KEY,
		LATER_KEY,
		asks,
		laterFor,
		parseLater,
		runningBand,
		type Later
	} from '$lib/updates';
	import BulkBar from '$lib/components/chrome/BulkBar.svelte';
	import SectionLabel from '$lib/components/chrome/SectionLabel.svelte';
	import TopBar from '$lib/components/chrome/TopBar.svelte';
	import Wordmark from '$lib/components/chrome/Wordmark.svelte';
	import ContinueRow from '$lib/components/content/ContinueRow.svelte';
	import CoverTile from '$lib/components/content/CoverTile.svelte';
	import WorkTile from '$lib/components/content/WorkTile.svelte';
	import FocusLine from '$lib/components/content/FocusLine.svelte';
	import GridOutline from '$lib/components/waiting/GridOutline.svelte';
	import { waiting } from '$lib/waiting.svelte';
	import { postAction, saves } from '$lib/saves.svelte';
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
		withFilters,
		type FilterKind,
		type Filters
	} from '$lib/library/filters';
	import { langCode } from '$lib/library/editions';
	import SeriesSheet from './SeriesSheet.svelte';
	import ShelfPicker from './ShelfPicker.svelte';
	import PersonView from './PersonView.svelte';
	import GroupSheet from './GroupSheet.svelte';
	import HideSheet from './HideSheet.svelte';
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
	import { num, upper } from '$lib/i18n/format';
	import type { Rating, Kind, RefreshBatch, SeriesCard, Shelf } from '$lib/library/types';
	import { groupAnswers } from '$lib/library/books';
	import {
		allHiddenAmong,
		isFinished,
		wholeBand,
		wholeLine,
		type LibraryCard
	} from '$lib/library/works';
	import { pageQuery } from '$lib/library/paging';
	import type { Snapshot } from './$types';

	let { data, form } = $props();

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
	 * The update modal on entry (doc/UPDATES.md, "Told on entry"; card c208):
	 * on the computer, unless LATER snoozed this version within the day. The
	 * band above stays as it was; a hidden UPDATE takes its place and counts.
	 */
	let later = $state<Later | null>(null);
	let doneVersion = $state<string | null>(null);
	$effect(() => {
		try {
			later = parseLater(localStorage.getItem(LATER_KEY));
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
	const hiddenRun = $derived(
		updateRun.running && updateRun.hidden ? runningBand(updateRun.view?.install ?? null) : null
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
	 * The SERIES TO LINK band's ✕ (c430; doc/LINKS.md, "Putting the band
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
	 * the one state that counts it. Until c430's second half it was one
	 * number, the shown one, which reveal off lowered and reveal on beat.
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
			// Wave 19 stored the shown count alone, as a bare number.
			if (typeof parsed === 'number') {
				const n = count0(parsed);
				linksPutAway = n === null ? null : { pub: n, all: null };
			} else if (parsed && typeof parsed === 'object') {
				const o = parsed as Record<string, unknown>;
				const pub = count0(o.pub);
				linksPutAway = pub === null ? null : { pub, all: count0(o.all) };
			}
		} catch {
			// Storage refused (a private window) or unreadable: the band shows, as it always did.
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
	 * BACK TO TOP (c433): a corner cell once the grid is about a screen down,
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
	let loadingMore = $state(false);
	let moreFailed = $state(false);
	/** Bumped whenever the list changes under a request, so a late answer is dropped. */
	let generation = 0;
	const series = $derived(data.series.length ? [...data.series, ...more] : more);
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

	async function fetchPage(offset: number, limit: number): Promise<LibraryCard[] | null> {
		try {
			const res = await fetch(
				`/api/library?${pageQuery({ shelf: data.shelf, tag: data.tag, filters: data.filters, sort: data.sort, dir: dirParam, seed: data.seed, offset, limit })}`
			);
			if (!res.ok) return null;
			return ((await res.json()) as { series: LibraryCard[] }).series;
		} catch {
			return null;
		}
	}

	async function loadMore() {
		if (loadingMore || !hasMore || isOffline) return;
		loadingMore = true;
		moreFailed = false;
		const gen = generation;
		const next = await fetchPage(series.length, data.pageSize);
		if (gen === generation) {
			if (next) {
				// Pages are by position, and the shelf can move under them (a series
				// hidden or grouped since): one already shown is not shown twice.
				const have = new Set(series.map((c) => c.id));
				more = [...more, ...next.filter((c) => !have.has(c.id))];
				if (next.length < data.pageSize) ended = true;
			} else moreFailed = true;
		}
		if (gen === generation) loadingMore = false;
		void keepGoing();
	}

	/**
	 * The observer only speaks when the end comes near. Whenever the list
	 * settles -- a page in, a refresh, a page dropped because the list changed
	 * under it -- the end may still be near without having moved, so ask again
	 * rather than leave the grid stalled.
	 */
	async function keepGoing() {
		await tick();
		if (loadingMore || moreFailed || !endNode) return;
		if (endNode.getBoundingClientRect().top < innerHeight * 2.5) void loadMore();
	}

	/**
	 * A write changed which tiles a page already loaded holds -- a Work hidden
	 * whole, one taken out of it -- and the load's *first* page can come back
	 * identical, so SvelteKit keeps `data` and no effect re-reads the rest. The
	 * page then still draws a tile the server has stopped listing (W4's HIDE,
	 * and its UNDO). Ask for the loaded pages again by position: the answer is
	 * the list as it is now, and the grid keeps its scroll.
	 */
	async function refillPages() {
		if (more.length === 0) return;
		const gen = ++generation;
		const pageAgain = await fetchPage(data.series.length, more.length);
		if (gen !== generation) return;
		const have = new Set(data.series.map((c) => c.id));
		more = pageAgain ? pageAgain.filter((c) => !have.has(c.id)) : [];
		ended = false;
		void keepGoing();
	}

	// A new shelf, tag or sort starts again from its first page. The same one
	// re-read (a rating saved, a scan's progress) reads the pages after the
	// first again too, so a tile deep in the grid shows what the server says.
	$effect(() => {
		const key = listKey;
		const first = data.series;
		untrack(() => {
			generation += 1;
			loadingMore = false;
			moreFailed = false;
			ended = false;
			if (key !== shownKey) {
				shownKey = key;
				more = [];
				void keepGoing();
				return;
			}
			if (more.length === 0) return void keepGoing();
			const gen = generation;
			void fetchPage(first.length, more.length).then((pageAgain) => {
				if (gen !== generation) return;
				if (pageAgain) {
					const have = new Set(data.series.map((c) => c.id));
					more = pageAgain.filter((c) => !have.has(c.id));
				}
				void keepGoing();
			});
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
			if (!v || v.key !== listKey || v.more.length === 0) return;
			generation += 1;
			shownKey = v.key;
			const have = new Set(data.series.map((c) => c.id));
			more = v.more.filter((c) => !have.has(c.id));
			await tick();
			settleScroll(v.y);
			// What they say now: a rating may have changed on the series screen.
			const gen = generation;
			const again = await fetchPage(data.series.length, v.more.length);
			if (again && gen === generation) more = again.filter((c) => !have.has(c.id));
		}
	};

	/** Asks for the next page while the end of the grid is still a screen or two away. */
	let endNode: HTMLElement | null = null;
	function nearEnd(node: HTMLElement) {
		endNode = node;
		const io = new IntersectionObserver(
			(seen) => {
				if (seen.some((e) => e.isIntersecting)) void loadMore();
			},
			{ rootMargin: '0px 0px 150% 0px' }
		);
		io.observe(node);
		return {
			destroy: () => {
				io.disconnect();
				if (endNode === node) endNode = null;
			}
		};
	}

	// ---- selection -------------------------------------------------------
	let selecting = $state(false);
	let moreOpen = $state(false);
	/** What MORE opens on: its rows, or SERVERS straight from the bar's server cell (S1). */
	let moreAt = $state<'more' | 'servers'>('more');
	const selected = new SvelteSet<number>();

	// ---- the server in use (c261, S1; doc/TV-APP.md, "Servers") -------------
	/*
	 * Inside the TV app with two or more servers, the bar says whose library this
	 * is: ON LIVING ROOM beside the wordmark, OK opening SERVERS. The list is the
	 * app's bridge's (PairingBridge.servers(), Servers.kt's toJson). Anything
	 * else draws no cell: a page with no bridge (a phone, a computer, a browser
	 * on the TV), an APK older than c261 (no `servers`), an answer that is not
	 * a list of servers, and one server, which changes nothing (the designer's
	 * first call).
	 */
	type TvServer = { origin: string; shown: string; inUse: boolean };
	let tvServers = $state<TvServer[] | null>(null);

	function readTvServers(): TvServer[] | null {
		if (typeof window === 'undefined') return null;
		const bridge = (window as unknown as { TsundokuTV?: { servers?: unknown } }).TsundokuTV;
		if (!bridge || typeof bridge.servers !== 'function') return null;
		try {
			const list: unknown = JSON.parse(String((bridge.servers as () => unknown)()));
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
		tvServers = readTvServers();
		// Again a tick later: the layout's onMount, which runs after this one,
		// tells the app the server's own name (`named`), and a server the TV
		// had not named yet would otherwise show its bare host until MORE closes.
		void tick().then(() => (tvServers = readTvServers()));
	});

	function openMore(at: 'more' | 'servers') {
		moreAt = at;
		moreOpen = true;
	}

	/**
	 * MORE closing: the list is read again, since FORGET inside it can leave
	 * one server, and then the cell goes. Focus was going back to the cell
	 * that opened SERVERS; with the cell gone it goes to MORE, the door that
	 * still leads there, rather than to nothing.
	 */
	function closeMore() {
		moreOpen = false;
		const had = onServer !== null;
		tvServers = readTvServers();
		if (had && onServer === null && moreAt === 'servers') {
			void tick().then(() => {
				const now = document.activeElement;
				if (now && now !== document.body && !now.closest('[role="dialog"]')) return;
				document.querySelector<HTMLElement>('[data-focus-id="library-more"]')?.focus();
			});
		}
	}

	function toggle(id: number) {
		if (selected.has(id)) selected.delete(id);
		else selected.add(id);
	}

	function stopSelecting() {
		selecting = false;
		selected.clear();
	}

	// ---- sheets ------------------------------------------------------------
	let deleting = $state(false);
	/** The first few titles, so the question names what it's about. */
	const deletingTitles = $derived.by(() => {
		const names = series.filter((c) => selected.has(c.id)).map((c) => c.title);
		if (names.length === 0) return '';
		const shown = names.slice(0, 3).join(', ').toUpperCase();
		return names.length > 3 ? `${shown} AND ${selected.size - 3} MORE` : shown;
	});
	let sheetId = $state<number | null>(null);
	let pickerOpen = $state(false);
	let grouping = $state(false);
	/** HIDE on a part of a Work asks first (W4). */
	let hiding = $state(false);

	/**
	 * What GROUP would take (W4; doc/BOOKS.md, "The AS row"): every selected
	 * series, with the facts the sheet's AS row needs -- its kind and how many
	 * books it has -- and the Work it is in now. A Work tile contributes its
	 * parts, since a Work is one tile over them (doc/WORKS.md). The rows keep
	 * the order they were selected in, which is what a Work's BY HAND means.
	 */
	type GroupRow = {
		seriesId: number;
		title: string;
		hue: number;
		addedAt: number;
		cover: number | null;
		kind: Kind;
		entryCount: number;
		/** "MANGA · 58 CH. · 41 READ": the row's second line. */
		meta: string;
		/** The Work it is in now: "IN <WORK> · MOVES HERE". */
		inWork: string | null;
	};
	const groupRows = $derived.by((): GroupRow[] => {
		const out: GroupRow[] = [];
		const push = (r: GroupRow) => {
			if (selected.has(r.seriesId) && !out.some((o) => o.seriesId === r.seriesId)) out.push(r);
		};
		if (data.person) {
			for (const i of data.person.items) {
				// A book inside a series is an entry, not a series: a Work and a
				// series of books both take series.
				if (i.entryId !== null) continue;
				push({
					seriesId: i.seriesId,
					title: i.title,
					hue: hueFor(i.title),
					addedAt: i.addedAt,
					cover: i.cover,
					kind: i.kind,
					entryCount: i.entries,
					meta: `${kindLabel(i.kind)} · ${count(i.entries)} ${unitLabel(i.kind)}${i.read ? ' · READ' : ''}`,
					inWork: data.workFeet[String(i.seriesId)]?.name ?? null
				});
			}
		} else {
			for (const c of series) {
				if (!c.tile) {
					push({
						seriesId: c.id,
						title: c.title,
						hue: c.hue,
						addedAt: c.addedAt,
						cover: c.cover,
						kind: c.kind,
						entryCount: c.entryCount,
						meta: sheetMeta(c),
						inWork: data.workFeet[String(c.id)]?.name ?? null
					});
					continue;
				}
				for (const p of c.tile.parts)
					push({
						seriesId: p.seriesId,
						title: p.title,
						hue: hueFor(p.title),
						addedAt: p.addedAt,
						cover: p.cover,
						kind: p.kind,
						entryCount: p.entries,
						meta: `${kindLabel(p.kind)} · ${count(p.entries)} ${unitLabel(p.kind)}${isFinished(p) ? ' · READ ✓' : ''}`,
						inWork: c.tile.name
					});
			}
		}
		// Selection order, which SvelteSet keeps: a Work's rows start as selected.
		const at = new Map([...selected].map((id, i) => [id, i]));
		return out.sort((a, b) => (at.get(a.seriesId) ?? 0) - (at.get(b.seriesId) ?? 0));
	});
	const answers = $derived(
		groupAnswers(groupRows.map((r) => ({ kind: r.kind, entryCount: r.entryCount })))
	);
	/** The noun the sheet's title reads: the first answer the selection allows. */
	const noun = $derived(answers[0] === 'volumes' ? 'VOLUMES' : 'BOOKS');
	/** The Works the selection touches: HIDE asks when there is one (W4). */
	const selectedWorks = $derived([
		...new Set(
			[...selected]
				.map((id) => data.workFeet[String(id)]?.id)
				.filter((id): id is number => typeof id === 'number')
		)
	]);
	/** HIDE ALL n: every part of the Works touched, and the selected series in none. */
	const hideWholeCount = $derived(
		selectedWorks.reduce(
			(n, id) => n + (data.existingWorks.find((w) => w.id === id)?.series ?? 0),
			0
		) + [...selected].filter((id) => !data.workFeet[String(id)]).length
	);
	/** TAKE OUT: how many series stay behind in their Works. */
	const hideRemainCount = $derived(
		selectedWorks.reduce((n, id) => {
			const work = data.existingWorks.find((w) => w.id === id);
			const here = [...selected].filter((s) => data.workFeet[String(s)]?.id === id).length;
			return n + Math.max(0, (work?.series ?? here) - here);
		}, 0)
	);
	/**
	 * FOLD AS LANGUAGES (doc/EDITIONS.md): two or three single books, each in
	 * a language of its own, none folded already. Their codes, or null.
	 */
	const foldCodes = $derived.by(() => {
		if (selected.size < 2 || selected.size > 3) return null;
		const picked = series.filter((s) => selected.has(s.id));
		if (picked.length !== selected.size) return null;
		if (picked.some((s) => s.kind !== 'doujin' || s.entryCount !== 1 || !s.language || s.languages))
			return null;
		const langs = picked.map((s) => s.language!);
		return new Set(langs).size === langs.length ? langs.map(langCode) : null;
	});
	const foldMessage = $derived(
		form && 'foldMessage' in form
			? String(form.foldMessage)
			: form && 'workMessage' in form
				? String(form.workMessage)
				: ''
	);
	/**
	 * REFRESH's answer over the selection (card c221). It is the library's own
	 * band, above the bar that asked, and it is replaced by the next run's: a
	 * bulk answer belongs where the selection is, not on a series screen.
	 */
	const batch = $derived(form && 'refreshed' in form ? (form.refreshed as RefreshBatch) : null);
	/** GROUP AS A WORK's own answer (W4): the Work it made, or what joined one. */
	const made = $derived(
		form && 'made' in form ? (form.made as { work: { name: string }; members: unknown[] }) : null
	);
	const addedWork = $derived(
		form && 'addedWork' in form
			? (form.addedWork as { workId: number; name: string; facts: unknown[] })
			: null
	);
	/** The HIDE answer's facts (W4): shown again, and taken out again, by UNDO. */
	const hideFacts = $derived(
		form && 'hideFacts' in form
			? (form.hideFacts as { hidden: number[]; out: unknown[]; whole: number[]; works: number })
			: null
	);
	/** The UNHIDE answer's facts (W4): every part it showed, and UNDO to hide them. */
	const showFacts = $derived(
		form && 'showFacts' in form
			? (form.showFacts as { shown: number[]; whole: number[]; works: number })
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
	const shownBand = $derived(
		showFacts && showFacts.works > 0
			? wholeBand('SHOWN', { ids: showFacts.shown, whole: showFacts.whole, works: showFacts.works })
			: null
	);
	/** How many failed titles the band names; the count is always the whole truth. */
	const FAILED_SHOWN = 3;
	const batchTitle = $derived(
		!batch
			? ''
			: batch.asked === 0
				? m.library_refresh_nothing()
				: m.library_refresh_asked({ n: num(batch.asked), found: num(batch.found) })
	);
	const batchDetail = $derived.by(() => {
		if (!batch) return '';
		const parts: string[] = [];
		if (batch.failed.length > 0) {
			// A source that is down fails the whole selection: name the first few,
			// since the band cannot hold twenty-four titles.
			const named = batch.failed.slice(0, FAILED_SHOWN).map(upper);
			if (batch.failed.length > named.length) named.push('…');
			parts.push(
				m.library_refresh_failed({
					count: batch.failed.length,
					n: num(batch.failed.length),
					titles: named.join(', ')
				})
			);
		} else if (batch.asked > 0) parts.push(m.library_refresh_all_answered());
		if (batch.skipped > 0)
			parts.push(
				batch.asked === 0
					? m.library_refresh_skipped_all({ count: batch.skipped, n: num(batch.skipped) })
					: m.library_refresh_skipped({ count: batch.skipped, n: num(batch.skipped) })
			);
		if (batch.remaining.length > 0)
			parts.push(
				m.library_refresh_not_asked({
					count: batch.remaining.length,
					n: num(batch.remaining.length)
				})
			);
		return parts.join(' · ');
	});
	/** The band's own submit: the rest of a selection the run was too full to ask. */
	const batchAfter: SubmitFunction =
		() =>
		async ({ update }) => {
			await update({ reset: false });
		};
	/**
	 * UNDO after a Work was made, added to, ended or hidden: the tiles a loaded
	 * page holds change back, and the load's first page may not move, so the
	 * pages are read again (see `refillPages`).
	 */
	const undoAfter: SubmitFunction =
		() =>
		async ({ update }) => {
			await update();
			await invalidateAll();
			await refillPages();
		};
	/**
	 * Which drawn series are hidden, by id: a Work's parts as well as the cards
	 * themselves. A person's page draws a Work's series as their own tiles and a
	 * shelf draws the Work as one card, so reading only the shelf's cards left
	 * `every` over an empty list -- vacuously true -- and a person's page offered
	 * UNHIDE for series that were plainly visible (W4's round 2).
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
	/** Every series selected is hidden, and the page can see at least one. */
	const allHidden = $derived(allHiddenAmong(selected, (id) => hiddenById.get(id)));

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
		// The series screen opens with what this tile already knows (doc/WAITING.md).
		waiting.preview = {
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
		// eslint-disable-next-line svelte/no-navigation-without-resolve -- seriesHref() resolves
		void goto(seriesHref(c.id, data.tag ? null : data.shelf));
	}

	// A shelf tab on its way past 1 s: the grid in outline, CONTINUE and the
	// tabs kept as they are (Loading States 1c).
	const outlined = $derived(
		(waiting.phase === 'outline' || waiting.phase === 'stalled') && waiting.to.kind === 'library'
	);

	/*
	 * The outline says LOADING where SORT and ↓ / ↑ were, so a sort picked by
	 * the remote that takes past 1 s unmounted the cell holding focus, and the
	 * mark was on nothing when SORT came back (tv-library-top's "the remote
	 * reaches SORT…", red 4 in 10 loaded; wave 24's probe saw focus go to the
	 * body at the outline's first frame and stay there). Which of the two had
	 * it is noted before the outline is drawn (`pre`), and focus goes back to
	 * it once SORT is, unless something else has taken focus meanwhile.
	 */
	let sortFocus = -1;
	$effect.pre(() => {
		if (!outlined) return;
		untrack(() => {
			const sort = document.querySelector('.sort');
			const at = document.activeElement;
			sortFocus =
				sort && at ? [...sort.querySelectorAll('button')].indexOf(at as HTMLButtonElement) : -1;
		});
	});
	$effect(() => {
		if (outlined || sortFocus === -1) return;
		const at = sortFocus;
		sortFocus = -1;
		const now = document.activeElement;
		if (now && now !== document.body) return;
		const buttons = document.querySelectorAll<HTMLElement>('.sort button');
		(buttons[at] ?? buttons[0])?.focus({ preventScroll: true });
	});

	// ---- on the tile ------------------------------------------------------
	// FAV and the rating are edited on the cover itself (see CoverTile). The
	// tile shows the change at once and saves behind it. A write that fails
	// keeps the new value, and the layout's band offers RETRY and PUT BACK
	// (doc/WAITING.md).
	const favNow = new SvelteMap<number, boolean>();
	const ratingNow = new SvelteMap<number, Rating>();

	async function write(
		action: 'favourite' | 'rate',
		key: string,
		fields: Record<string, string>,
		failure: { what: string; putBackLabel: string; putBack: () => void },
		settle: () => void
	) {
		const save = async () => {
			const ok = await postAction(`/?/${action}`, fields);
			if (ok) {
				await invalidateAll();
				settle();
			}
			return ok;
		};
		saves.clear(key);
		if (!(await save())) saves.fail({ ...failure, key, retry: save });
	}

	function favourite(id: number, on: boolean) {
		favNow.set(id, on);
		void write(
			'favourite',
			`fav:${id}`,
			{ id: String(id), on: on ? '1' : '0' },
			{
				what: on ? 'FAV NOT SAVED' : 'UNFAV NOT SAVED',
				putBackLabel: on ? 'PUT BACK · NOT FAV' : 'PUT BACK · FAV',
				putBack: () => favNow.delete(id)
			},
			() => favNow.delete(id)
		);
	}

	function rate(id: number, rating: Rating) {
		const was = series.find((s) => s.id === id)?.rating ?? 0;
		ratingNow.set(id, rating);
		void write(
			'rate',
			`rating:${id}`,
			{ id: String(id), rating: String(rating) },
			{
				what: `RATING ${rating} NOT SAVED`,
				putBackLabel: `PUT BACK ${was}`,
				putBack: () => ratingNow.delete(id)
			},
			() => ratingNow.delete(id)
		);
	}

	// ---- derived view ------------------------------------------------------
	// Layout is decided by CSS (src/lib/styles/layout.css), so the server's
	// first paint is already right for the device. Script only needs the column
	// count to pad the last row, which is cosmetic and can wait for hydration.
	const columns = $derived(phone.current ? 3 : desktop.current ? 8 : wide.current ? 9 : 6);
	const contShown = $derived(data.cont.items.slice(0, 4));
	const showContinue = $derived(contShown.length > 0 && !scanning && !justImported);

	const cachedCount = (id: number) => offline.cached[id] ?? 0;
	/**
	 * What a tile has on the device: a Work's parts summed, not only its face's
	 * -- the part CONTINUE opens may be the one that is cached (doc/WORKS.md).
	 */
	const cachedOn = (c: { id: number; tile?: LibraryCard['tile'] }) =>
		c.tile ? c.tile.parts.reduce((n, p) => n + cachedCount(p.seriesId), 0) : cachedCount(c.id);

	/**
	 * The TV focus line's second line (c238): the kind, the counts and where
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
	/** An empty shelf offers nothing to filter (3h): no FILTER cell, one line on filling it. */
	const canFilter = $derived(
		data.shelf !== 'people' && !data.tag && (nFilters > 0 || shelfSize > 0)
	);
	const languagesHere = $derived(
		data.shelf === 'cached'
			? [...new Set(cachedSeries.flatMap((s) => codesOf(s)).map((l) => l.toLowerCase()))].sort()
			: data.languages
	);
	// ---- the KIND band (c436; doc/LIBRARY.md, "The KIND band") ---------------
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
		anime: m.nav_shelf_anime
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
	 * Pinned (c436, with c433): the band stops under the top bar as the grid
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
	 * The chosen cell is kept in view as the band scrolls sideways (Kinds Calls
	 * 2), the effect ShelfTabs runs for the active tab: choosing a kind far
	 * along scrolls ALL off the left rather than leaving the choice cut off.
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
			// Only this scroll's end: a later one of the owner's must never be corrected.
			addEventListener('scrollend', settle, { once: true });
			setTimeout(() => removeEventListener('scrollend', settle), 2000);
		}
	}

	/**
	 * A kind chosen from the pinned band (c436, round 2): the cells keep the
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
	}
	afterNavigate(() => {
		if (!landKind) return;
		landKind = false;
		// A slow load draws the outline first, and a scroll then lands short:
		// settled each frame until the grid is drawn and the page is there.
		settleScroll(() => Math.max(0, placeUnderBar(bandMark)), true);
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
		// The shelf by name, and what narrows it (Library Filters 3b).
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
	async function selectAll() {
		// The loaded tiles at once, a Work's parts with it (a Work tile is one
		// tile over its parts, doc/WORKS.md).
		for (const s of shown) for (const id of cardIds(s)) selected.add(id);
		// CACHED narrows on the device: only the tablet knows what it holds, so
		// the server cannot answer its ids.
		if (data.shelf === 'cached') return;
		try {
			const q = pageQuery({
				shelf: data.shelf,
				tag: data.tag,
				filters: data.filters,
				sort: data.sort,
				dir: dirParam,
				offset: 0,
				limit: 0
			});
			// Every page, not only the loaded ones -- and unit-aware, so a Work's
			// parts a kind shelf never picked are selected too.
			const res = await fetch(`/api/library?${q}&ids=1`);
			if (res.ok) for (const id of ((await res.json()) as { ids: number[] }).ids) selected.add(id);
		} catch {
			// Offline: the loaded pages stay selected, which is what's on screen.
		}
	}

	const gb = (bytes: number) => (bytes / 1e9).toFixed(1).replace(/\.0$/, '');

	/** The SORT menu's choices, in `SORTS`' order (c432). */
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

<svelte:window bind:scrollY={winY} bind:innerHeight={winH} />

<div class="library" class:selecting class:has-band={!!batch}>
	{#if modalOpen && offer}<UpdateModal {offer} onlater={snooze} />{/if}

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
			{/snippet}
			{#snippet right()}
				<button type="button" class="cell-btn" data-focus-mark="in" onclick={() => void selectAll()}
					>SELECT ALL</button
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
				<button type="button" class="cell-btn select-cell" onclick={() => (selecting = true)}
					>SELECT</button
				>
			{/snippet}
		</TopBar>
	{:else}
		<TopBar sticky label="Library">
			{#snippet left()}
				<!-- The app's name goes home: the library as it opens. -->
				<!-- With the server cell, the wordmark is not an arrow stop: in the
				     design's bar it is no control, and the cell is "the first cell ↑
				     reaches from the library" (TV-Servers' calls). Tab still reaches it. -->
				<a
					class="brand"
					href={resolve('/')}
					aria-label="Library"
					data-focus-skip={onServer ? '' : undefined}><Wordmark /></a
				>
				{#if onServer}
					<!-- S1 (TV-Servers.dc.html, `bar`): the server in use, with two or more. -->
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
				<a class="search-hint" href={resolve('/search')} aria-label="Search" data-focus-mark="in"
					><span class="short">/<span class="word"> search</span></span><span class="long"
						>/ search title, tag, artist</span
					></a
				>
			{/snippet}
			{#snippet right()}
				{#if page.data.browse}
					<!-- BROWSE, a cell before QUEUE on the tablet (Index-Browse, barTablet); the
					     phone reaches it from the empty search, the desktop from the sidebar. -->
					<a class="browse-cell" href={resolve('/browse')}>BROWSE</a>
				{/if}
				{#if data.queue && data.queue.queued > 0}
					<!-- QUEUE over its count, a cell before SELECT, only while something is queued
					     (Index Downloads 10). Offline or unanswered: the last count, dimmed. -->
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
					<!-- The desktop's FILTER, beside SELECT (3j); the tablet's sits on the tabs. -->
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
						/>
					</div>
				{/if}
				<button
					type="button"
					class="cell-btn select-cell"
					data-focus-mark="in"
					onclick={() => (selecting = true)}
					disabled={data.empty}>SELECT</button
				>
				<!-- MORE: the sidebar's foot as a sheet, on the tablet and phone (Reach; card c171). -->
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
		     library it went back to (Work-States 2; doc/NAVIGATION.md). HIDE ALL n
		     from a series screen with reveal off arrives the same way, and TAKE OUT
		     says what it did -- one series hidden, on its own again -- rather than
		     claiming the Work was hidden whole (W4). -->
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
		<!-- W4's create and add answer here, where the sheet was opened: the Work's
		     own screen would replace the library the owner was looking at. -->
		<div class="lib-band">
			<Band
				title={made
					? `${made.work.name.toUpperCase()} IS A WORK`
					: `ADDED TO ${addedWork!.name.toUpperCase()}`}
				detail={made
					? `${made.members.length} SERIES · EACH KEEPS ITS OWN`
					: `${addedWork!.facts.length} SERIES · AT THE END OF THE RUN`}
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
		<!-- HIDE ALL n or TAKE OUT, THEN HIDE: the library's own band, with UNDO (W4). -->
		<div class="lib-band">
			<Band
				title={hiddenBand?.title ?? `HIDDEN · ${hideFacts.hidden.length} SERIES`}
				detail={hiddenBand?.detail ?? 'TAKEN OUT OF THE WORK · A SERIES ON ITS OWN AGAIN'}
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
	{#if showFacts}
		<!-- UNHIDE on a part shows the Work whole (W4): the same band and UNDO as
		     HIDE, the other way round, because the same rule runs both ways. -->
		<div class="lib-band">
			<Band
				title={shownBand?.title ?? `SHOWN · ${showFacts.shown.length} SERIES`}
				detail={shownBand?.detail ?? `${showFacts.shown.length} SERIES · HIDDEN AGAIN BY UNDO`}
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
		<!-- A backup importing (c438; Import-Progress, "on the library, meanwhile"):
		     the scan's band, named, counting series rather than bytes. -->
		<Banner
			kind="progress"
			title="IMPORTING · {BACKUP_LABEL}"
			detail="{count(data.scan.bytesDone)} OF {count(data.scan.bytesTotal)} SERIES"
			progress={data.scan.bytesTotal > 0 ? data.scan.bytesDone / data.scan.bytesTotal : 0}
			meta="{count(data.scan.seriesFound)} SO FAR ON NEW"
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
		<Banner
			kind="action"
			title="IMPORT FINISHED · {count(data.scan.seriesFound)} SERIES"
			detail={data.scan.failedFiles > 0
				? `${count(data.scan.failedFiles)} FILES FAILED · SEE LOG`
				: undefined}
		>
			{#snippet action()}
				<form method="POST" action="?/dismissScan" use:enhance>
					<input type="hidden" name="scan" value={data.scan?.id} />
					<button type="submit">TIDY NEW →</button>
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
		<!-- Below duplicates, which are older and fewer (Catalogue Links 1a; doc/LINKS.md). -->
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
		<!-- GET STARTED (doc/ONBOARDING.md; card c208): until every step is done or
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
					<StartList view={data.start} libraryRoot={data.libraryRoot} extras={data.firstRead} />
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
							<!-- History is CONTINUE going further back (Index Addendum). -->
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
							focusId={`continue-${item.id}`}
							startFocus={i === 0}
							onresume={item.resumeId !== null
								? // eslint-disable-next-line svelte/no-navigation-without-resolve -- readHref() resolves
									() => goto(readHref(item.resumeId!))
								: undefined}
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
				{:else if outlined}
					LOADING
				{:else if scanning}
					NEWEST FIRST
				{:else}
					<span class="sort">
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
			<!-- The KIND band (c436; Kinds Calls 1-4): one row under the tabs and over
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
				     the cell: a kind chosen opens at its start (round 2 of c436). -->
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
						/>
					</div>
				{/if}
			</div>
		{/if}

		<!-- The TV's focus line, under the pinned tabs (c238; only a TV draws it). -->
		<FocusLine />

		{#if outlined}
			<GridOutline />
		{:else if data.shelf !== 'people'}
			<!-- BACK from the grid climbs to what is pinned over it: the KIND band's
			     chosen cell since c436 (the shelf tab's, pinned in its place, before).
			     In full view, so BACK goes on to the screen's start (doc/FOCUS.md). -->
			<div class="grid" data-back-climb=".kinds .kc.on">
				{#each shown as s, i (s.id)}
					{@const cached = cachedOn(s)}
					{#if s.tile}
						<!-- Browsing shows the run as one tile (Work-Library; doc/WORKS.md). -->
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
			<!-- A new shelf (3h): empty until something is added, and says how. First,
			     since a kind is carried across shelves (c436): an empty shelf with a
			     kind or a filter on is still empty, not "no manga here". -->
			<div class="empty-shelf">
				<p class="empty-title">Nothing on {shelfName} yet.</p>
				<p class="empty-sub">
					Long-press a cover and tick it under SHELVES, or SELECT several and + SHELF.
				</p>
				<button type="button" class="empty-select" onclick={() => (selecting = true)}>SELECT</button
				>
			</div>
		{:else if shown.length === 0 && kindAtZero && !outlined}
			<!-- The kind chosen elsewhere, none of it here (Kinds Calls 4): the band
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
			<!-- Filters that leave nothing (3f): a narrow question about one shelf, not an empty library. -->
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

{#if selecting}
	<form
		method="POST"
		action="?/bulk"
		use:enhance={() =>
			async ({ update }) => {
				await update({ reset: false });
			}}
	>
		{#each [...selected] as id (id)}<input type="hidden" name="id" value={id} />{/each}
		{#if foldMessage}
			<div class="fold-refused" role="status">{foldMessage}</div>
		{/if}
		<BulkBar columns={7}>
			{#snippet actions()}
				<button type="submit" name="do" value="fav" disabled={selected.size === 0}>FAV</button>
				<button type="button" disabled={selected.size === 0} onclick={() => (pickerOpen = true)}
					>+ SHELF</button
				>
				<!-- No tag editor is designed yet; see doc/LIBRARY.md. -->
				<button type="button" disabled>TAG</button>
				{#if foldCodes}
					<!-- Editions 1f: books in different languages fold, rather than group. -->
					<button type="submit" class="fold" formaction="?/fold"
						><span class="long">FOLD AS LANGUAGES</span><span class="short">FOLD</span><span
							class="sub">{foldCodes.join(' · ')}</span
						></button
					>
				{:else}
					<!-- Index Books: GROUP, and W4's AS sheet asks what they become. -->
					<button
						type="button"
						class="group"
						disabled={selected.size === 0}
						onclick={() => (grouping = true)}>GROUP</button
					>
				{/if}
				<!-- REFRESH (c221): asks each selected series' source once, and downloads nothing. -->
				<button type="submit" formaction="?/refresh" disabled={selected.size === 0}
					>{m.library_refresh()}</button
				>
				<!-- With reveal on and only hidden tiles selected, the same cell unhides them.
				     A selection that holds part of a Work asks first: a Work is hidden
				     whole, or the part leaves it (W4; doc/WORKS.md, "The one rule").
				     UNHIDE follows the same rule the other way: on a person's page a
				     Work's parts are their own tiles, so showing one must show the Work. -->
				{#if allHidden}
					{#if selectedWorks.length > 0}
						<button type="submit" formaction="?/showAll" disabled={selected.size === 0}
							>UNHIDE</button
						>
					{:else}
						<button type="submit" name="do" value="unhide" disabled={selected.size === 0}
							>UNHIDE</button
						>
					{/if}
				{:else if selectedWorks.length > 0}
					<button type="button" disabled={selected.size === 0} onclick={() => (hiding = true)}
						>HIDE</button
					>
				{:else}
					<button type="submit" name="do" value="hide" disabled={selected.size === 0}>HIDE</button>
				{/if}
				<!-- Asks first (doc/DELETING.md): duplicates are cleared in bulk. -->
				<button type="button" disabled={selected.size === 0} onclick={() => (deleting = true)}
					>DELETE</button
				>
			{/snippet}
		</BulkBar>
	</form>
	{#if batch}
		<!-- REFRESH's answer (c221): pinned over the bar that asked, so it is read where it was pressed. -->
		<div class="refresh-band">
			<Band title={batchTitle} detail={batchDetail}>
				{#snippet action()}
					{#if batch.remaining.length > 0}
						<form method="POST" action="?/refresh" use:enhance={batchAfter}>
							{#each batch.remaining as id (id)}<input type="hidden" name="id" value={id} />{/each}
							<button type="submit"
								>{m.library_refresh_more({ n: num(batch.remaining.length) })}</button
							>
						</form>
					{/if}
				{/snippet}
			</Band>
		</div>
	{/if}
{/if}

{#if newOpen}
	<NewShelfSheet closeHref={withParam(page.url, 'new', null)} />
{/if}

<SeriesSheet
	id={sheetId}
	shelves={data.shelves}
	onclose={() => (sheetId = null)}
	onchange={() => invalidateAll()}
/>

<GroupSheet
	open={grouping}
	books={groupRows}
	existing={data.existing.filter((s) => !selected.has(s.id))}
	existingVolumes={data.existingVolumes.filter((s) => !selected.has(s.id))}
	existingWorks={data.existingWorks.filter(
		(w) => selectedWorks.length === 0 || !selectedWorks.includes(w.id)
	)}
	{answers}
	{noun}
	ondone={() => {
		grouping = false;
		stopSelecting();
	}}
	onclose={() => (grouping = false)}
/>

{#if hiding}
	<HideSheet
		open
		title="HIDE {selected.size} {selected.size === 1 ? 'SERIES' : 'SERIES'}?"
		detail={selectedWorks.length === 1
			? `PART OF ${data.existingWorks.find((w) => w.id === selectedWorks[0])?.name.toUpperCase() ?? 'A WORK'}`
			: `PART OF ${selectedWorks.length} WORKS`}
		ids={[...selected].map(String)}
		wholeCount={hideWholeCount}
		remainCount={hideRemainCount}
		actionAll="?/hideAll"
		actionPart="?/hideParts"
		ondone={async () => {
			hiding = false;
			stopSelecting();
			await invalidateAll();
			await refillPages();
		}}
		onclose={() => (hiding = false)}
	/>
{/if}

<ConfirmSheet
	open={deleting}
	title="DELETE {selected.size} SERIES?"
	lines={[
		`${selected.size} SELECTED${deletingTitles ? ` · ${deletingTitles}` : ''}`,
		'THEIR FILES MOVE TO THE TRASH FOLDER ON THE WORKSTATION.',
		'THEIR READING HISTORY GOES WITH THEM.',
		'A SCAN OR A SYNC WON’T BRING THEM BACK.'
	]}
	confirm="DELETE {selected.size}"
	action="?/delete"
	fields={{ id: [...selected].map(String) }}
	onclose={() => (deleting = false)}
	ondone={async () => {
		deleting = false;
		stopSelecting();
		await invalidateAll();
	}}
/>

<ShelfPicker
	open={pickerOpen}
	ids={[...selected]}
	shelves={data.shelves}
	onclose={() => (pickerOpen = false)}
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
	/* The top bar stays on a desktop too (c433): the sidebar stays, and so
	   does the search beside it. TopBar pins it on a phone, the tablet and a
	   TV already, and lets it go on a desktop. */
	@media (min-width: 1024px) and (pointer: fine) {
		.library > :global(header.bar.sticky) {
			position: sticky;
			z-index: 8;
		}
	}
	/* BACK TO TOP (c433): a corner cell, ruled on its two inner sides, over
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
	   Each FILTER counts only where it is drawn (c474): the top bar's on a
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
		   other case (c238). This rule outranks that one, so it says it again. */
		.library:not(.selecting) {
			padding-bottom: var(--safe-y);
		}
	}
	/* On a TV the focus layer brings a focused tile clear of the pinned bars
	   (the tabs and the focus line) by its button's own edge, and the cover's
	   ring is drawn 7px outside the cover, which is that edge: coming back up
	   the grid, the focus line covered the ring by 7px. So the button reaches
	   7px up into the tile's 10px padding, and the ring comes clear with it
	   (c433). Nothing drawn moves; a TV has no pointer for the larger box. */
	@media (pointer: none) and (min-width: 900px) {
		.grid :global(.tile > .open) {
			margin-top: -7px;
			padding-top: 7px;
		}
	}
	/* The SERIES TO LINK band's ✕ (c430): a plain cell after REVIEW, not a
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
	/* And the extra row REFRESH's band takes above it (c221). */
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
	/* The shelf tabs: the whole width since c436, FILTER having moved to the
	   KIND band's end (Kinds Calls, "04 — THE SIDEBAR"). */
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
	/* ---- the KIND band (c436; Kinds Calls 05, "SIZES": literals, not the
	   ladder, and the tokens for colour). One 40px row, 13px mono against the
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
	/* Scrolls sideways, never wraps: a cut-off cell is the cue (Kinds Calls 2).
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
	/* An open menu is over everything in the page's flow (c590), and still
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
	   ↓ / ↑"). The menu is the house's own (ChoiceMenu, c432); its list hangs
	   from the whole block, so the block is what is positioned. */
	.sort {
		position: relative;
		display: inline-flex;
		align-items: stretch;
		height: 32px;
		border: 1px solid var(--line-2);
		color: var(--text-1);
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
	/* Not positioned: its panel hangs from the top bar's right edge, 640 wide (3j).
	   FILTER's own left rule is the tabs' divider; here the cell before it
	   draws that one, and FILTER draws the rule against SELECT (c431). */
	.filter-desk {
		align-self: stretch;
		border-right: var(--hairline);
	}
	.filter-desk :global(summary) {
		border-left: 0;
	}
	/* Desktop: the wordmark and the shelves move into the sidebar, FILTER into
	   the top bar beside SELECT, and the count into the section label (3j). */
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
	/* Filters that leave nothing (3f), and a shelf with nothing yet (3h). */
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
	/* The top bar's rules (c431). The right-hand cell draws the first one, on
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
	/* S1: the wordmark's cell, then ON <NAME> (TV-Servers.dc.html, `bar`). The
	   left cell draws the rule after it; this draws the one between it and the
	   wordmark. The name clips at 180 px, the cell at 200. Only the TV app
	   draws it, so it carries the TV's control type at every size. */
	.server-cell {
		display: flex;
		align-items: center;
		gap: 10px;
		max-width: 200px;
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
	/* The phone's bar cells are 14px a side (Reach, phoneMore). */
	@media (max-width: 599px) {
		.more-cell {
			padding: 0 14px;
		}
	}
	/* A narrow phone's bar is the brand, /, SELECT and MORE (Reach, phoneMore): the word doesn't fit. */
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
	.selected-count {
		padding: 0 18px;
		font: 500 17px var(--font-mono);
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
		/* Both rules, as the mock draws them: under the tabs this doubles the
		   tabs' own bottom hairline, which is how Index Library.dc.html has it. */
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
	/* FOLD AS LANGUAGES: the accent cell, its languages under it (Editions 1f). */
	.fold {
		flex-direction: column;
		gap: 2px;
		background: var(--accent) !important;
		color: var(--on-accent) !important;
	}
	.fold .sub {
		font: 400 12px var(--font-mono);
	}
	.fold .short {
		display: none;
	}
	@media (max-width: 599px) {
		.fold .long {
			display: none;
		}
		.fold .short {
			display: inline;
		}
	}
	.fold-refused {
		position: fixed;
		left: var(--sheet-left, 0);
		right: 0;
		bottom: calc(121px + env(safe-area-inset-bottom));
		z-index: 10;
		padding: 14px var(--pad, 24px);
		background: var(--surface-panel);
		border-top: var(--hairline);
		font: 500 13px var(--font-mono);
		color: var(--accent);
	}

	/* REFRESH's answer (c221), pinned over the bulk bar it came from. A band is
	   an answer, not a wall: the grid under it stays tappable, and only the band
	   itself takes a press (its UNDO, its ASK N MORE). */
	.refresh-band {
		position: fixed;
		left: var(--sheet-left, 0);
		right: 0;
		bottom: calc(121px + env(safe-area-inset-bottom));
		z-index: 10;
		pointer-events: none;
	}
	.refresh-band > :global(.band) {
		pointer-events: auto;
	}

	/* ---- the TV (c238; TV-Library) ---------------------------------------- */
	@media (pointer: none) and (min-width: 900px) {
		.library {
			padding-bottom: var(--safe-y);
		}
		/* Bulk tidying is not a couch job (TV Calls, "03 — SIDEBAR"). */
		.select-cell {
			display: none;
		}
		.search-hint {
			gap: 10px;
			justify-content: flex-start;
			padding: 0 22px;
			font: 400 17px/1.2 var(--font-mono);
			/* The handoff's computed 0.32px, transcribed as the extraction reads it. */
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
		/* The shelf tabs, in the safe margin. They pinned under the safe top
		   until c436 (state 3B); the KIND band does now, in their place, so the
		   pinned rows are still 56 + 64px (Kinds Calls 3, "TV"). */
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

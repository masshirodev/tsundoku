<script lang="ts">
	import { m } from '$lib/paraglide/messages';
	import ConfirmSheet from '$lib/components/chrome/ConfirmSheet.svelte';
	import Band from '$lib/components/chrome/Band.svelte';
	import { backLink } from '$lib/back';
	import { enhance } from '$app/forms';
	import type { SubmitFunction } from '@sveltejs/kit';
	import { beforeNavigate, goto, invalidateAll } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { tick, untrack } from 'svelte';
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
	import NewShelfSheet from './NewShelfSheet.svelte';
	import MoreSheet from './MoreSheet.svelte';
	import {
		activeCount,
		filterParams,
		filterWords,
		kindsAmong,
		matches,
		NO_FILTERS,
		withFilters,
		type Filters
	} from '$lib/library/filters';
	import { langCode } from '$lib/library/editions';
	import SeriesSheet from './SeriesSheet.svelte';
	import ShelfPicker from './ShelfPicker.svelte';
	import PersonView from './PersonView.svelte';
	import GroupSheet from './GroupSheet.svelte';
	import TagChip from '$lib/components/controls/TagChip.svelte';
	import { tagHref } from '$lib/library/links';
	import { hueFor } from '$lib/library/cover';
	import { desktop, phone, wide } from '$lib/device.svelte';
	import { offline } from '$lib/offline.svelte';
	import {
		continueSub,
		count,
		dirLabel,
		naturalDir,
		newSeed,
		parseSort,
		progress,
		SORT_NAME,
		SORTS,
		sheetMeta
	} from '$lib/library/labels';
	import { coverSrc, readHref, seriesHref, shelfHref, withParam } from '$lib/library/links';
	import { num, upper } from '$lib/i18n/format';
	import type { Rating, RefreshBatch, SeriesCard, Shelf } from '$lib/library/types';
	import type { LibraryCard } from '$lib/library/works';
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
	 * reader touches or scrolls themselves.
	 */
	function settleScroll(y: number) {
		const until = performance.now() + 2000;
		let stop = false;
		const halt = () => (stop = true);
		const opts = { once: true, passive: true } as const;
		addEventListener('pointerdown', halt, opts);
		addEventListener('wheel', halt, opts);
		addEventListener('keydown', halt, opts);
		const place = () => {
			if (stop) return;
			scrollTo(0, y);
			if (Math.abs(scrollY - y) > 2 && performance.now() < until) requestAnimationFrame(place);
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
	const selected = new SvelteSet<number>();

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

	/**
	 * What GROUP would take: selected doujin singletons, or selected novels
	 * (volumes, doc/BOOKS.md), from the library grid or a person page. GROUP is
	 * offered only when every selected item is one, all of one kind -- a manga,
	 * or books mixed with novels, can't be grouped.
	 */
	const groupPick = $derived.by(() => {
		const out: {
			seriesId: number;
			title: string;
			hue: number;
			addedAt: number;
			kind: string;
			cover: number | null;
		}[] = [];
		const pool = data.person
			? data.person.items
					.filter((i) => i.groupable || (i.kind === 'novel' && i.entryId === null))
					.map((i) => ({
						id: i.seriesId,
						title: i.title,
						hue: hueFor(i.title),
						addedAt: i.addedAt,
						kind: i.kind,
						cover: i.cover
					}))
			: series
					.filter((c) => (c.kind === 'doujin' && c.entryCount === 1) || c.kind === 'novel')
					.map((c) => ({
						id: c.id,
						title: c.title,
						hue: c.hue,
						addedAt: c.addedAt,
						kind: c.kind,
						cover: c.cover
					}));
		for (const b of pool) if (selected.has(b.id)) out.push({ seriesId: b.id, ...b });
		return out;
	});
	const groupKinds = $derived(new Set(groupPick.map((b) => b.kind)));
	const groupBooks = $derived(groupKinds.size === 1 ? groupPick : []);
	const volumes = $derived(groupKinds.has('novel'));
	const canGroup = $derived(selected.size > 0 && groupBooks.length === selected.size);
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
	const allHidden = $derived(
		selected.size > 0 && series.filter((s) => selected.has(s.id)).every((s) => s.hidden)
	);

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
	const cachedSeries = $derived(series.filter((s) => cachedCount(s.id) > 0));
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
	const kindsHere = $derived(data.shelf === 'cached' ? kindsAmong(cachedSeries) : data.kinds);
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
		shown.forEach((s) => selected.add(s.id));
		if (!hasMore) return;
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
			const res = await fetch(`/api/library?${q}&ids=1`);
			if (res.ok) for (const id of ((await res.json()) as { ids: number[] }).ids) selected.add(id);
		} catch {
			// Offline: the loaded pages stay selected, which is what's on screen.
		}
	}

	const gb = (bytes: number) => (bytes / 1e9).toFixed(1).replace(/\.0$/, '');

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
				<a class="brand" href={resolve('/')} aria-label="Library"><Wordmark /></a>
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
							kinds={kindsHere}
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
					class:on={moreOpen}
					aria-expanded={moreOpen}
					data-focus-mark="in"
					data-focus-id="library-more"
					onclick={() => (moreOpen = true)}>MORE</button
				>
			{/snippet}
		</TopBar>
	{/if}
	{#if data.gone}
		{@const gone = data.gone}
		<!-- A Work ended on its own screen: the band and its UNDO live here, on the
		     library it went back to (Work-States 2; doc/NAVIGATION.md). -->
		<Band
			title={gone.kind === 'ended'
				? `${gone.name.toUpperCase()} IS NO LONGER A WORK`
				: `UNGROUPED · ${gone.name.toUpperCase()}`}
			detail={gone.kind === 'ended' ? 'ONE SERIES WAS LEFT' : 'EVERY SERIES IS ITS OWN AGAIN'}
		>
			{#snippet action()}
				<form method="POST" action="?/undoWork" use:enhance>
					<input type="hidden" name="kind" value={gone.kind} />
					<input type="hidden" name="facts" value={gone.facts} />
					<button type="submit">UNDO</button>
				</form>
			{/snippet}
		</Band>
	{/if}
	<MoreSheet
		open={moreOpen}
		onclose={() => (moreOpen = false)}
		queued={data.queue?.queued ?? null}
		start={data.start && !data.start.finished
			? { done: data.start.done + data.start.skipped, total: data.start.steps.length }
			: null}
	/>

	{#if data.scan && scanning}
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

	{#if data.toLink > 0 && !data.empty}
		<!-- Below duplicates, which are older and fewer (Catalogue Links 1a; doc/LINKS.md). -->
		<Banner
			kind="action"
			title="{String(data.toLink).padStart(2, '0')} SERIES TO LINK"
			detail={isOffline ? 'THE REVIEW NEEDS THE WORKSTATION' : 'FOUND ON ANILIST, NOT FOR CERTAIN'}
		>
			{#snippet action()}
				{#if isOffline}
					<span class="dimmed" aria-disabled="true">REVIEW →</span>
				{:else}
					<a href={resolve('/links')} aria-label="Review the series to link">REVIEW →</a>
				{/if}
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
							{contShown.filter((c) => cachedCount(c.id) > 0).length} OF {contShown.length} CACHED
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
						{@const cached = cachedCount(item.id) > 0}
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
						<span class="menu">
							<select
								aria-label="Sort"
								value={data.sort}
								onchange={(e) => sortTo(e.currentTarget.value)}
							>
								{#each SORTS as s (s)}<option value={s}>{SORT_NAME[s]}</option>{/each}
							</select>
							<span class="caret" aria-hidden="true">▾</span>
						</span>
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
			{#if canFilter}
				<FilterPanel
					filters={data.filters}
					languages={languagesHere}
					kinds={kindsHere}
					reveal={data.reveal}
					following={data.following}
					title={shelfName.toUpperCase()}
					count={nFilters ? outOf : shelfSize.toLocaleString('en-US')}
					href={filterHref}
					formAction={resolve('/')}
					keep={keepParams}
				/>
			{/if}
		</div>

		<!-- The TV's focus line, under the pinned tabs (c238; only a TV draws it). -->
		<FocusLine />

		{#if outlined}
			<GridOutline />
		{:else if data.shelf !== 'people'}
			<div class="grid" data-back-climb="nav[aria-label=Shelves] .tab.on">
				{#each shown as s, i (s.id)}
					{@const cached = cachedCount(s.id)}
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
		{:else if shown.length === 0 && data.shelf.startsWith('c:') && !outlined}
			<!-- A new shelf (3h): empty until something is added, and says how. -->
			<div class="empty-shelf">
				<p class="empty-title">Nothing on {shelfName} yet.</p>
				<p class="empty-sub">
					Long-press a cover and tick it under SHELVES, or SELECT several and + SHELF.
				</p>
				<button type="button" class="empty-select" onclick={() => (selecting = true)}>SELECT</button
				>
			</div>
		{:else if shown.length === 0}
			<p class="none">NOTHING ON THIS SHELF</p>
		{/if}
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
				{:else if canGroup}
					<!-- Index Books: GROUP, for singles only. -->
					<button type="button" class="group" onclick={() => (grouping = true)}>GROUP</button>
				{:else}
					<!-- Anything else that can be one run: a Work (doc/WORKS.md). W4's AS
					     sheet replaces this cell with the choice. -->
					<button type="submit" class="group" formaction="?/work" disabled={selected.size < 2}
						>WORK</button
					>
				{/if}
				<!-- REFRESH (c221): asks each selected series' source once, and downloads nothing. -->
				<button type="submit" formaction="?/refresh" disabled={selected.size === 0}
					>{m.library_refresh()}</button
				>
				<!-- With reveal on and only hidden tiles selected, the same cell unhides them. -->
				<button
					type="submit"
					name="do"
					value={allHidden ? 'unhide' : 'hide'}
					disabled={selected.size === 0}>{allHidden ? 'UNHIDE' : 'HIDE'}</button
				>
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
	books={groupBooks}
	existing={(volumes ? data.existingVolumes : data.existing).filter((s) => !selected.has(s.id))}
	noun={volumes ? 'VOLUMES' : 'BOOKS'}
	onclose={() => (grouping = false)}
/>

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
	/* The tabs and, pinned at their end, FILTER (Library Filters 3a): the bar
	   draws the rules, the tabs scroll under the pinned cell. */
	.tabs {
		position: relative;
		z-index: 5;
		display: flex;
		border-top: var(--hairline);
		border-bottom: var(--hairline);
	}
	/* The tabs stay lit above FILTER's scrim, as the mock draws them. */
	.tabs > :global(nav) {
		position: relative;
		z-index: 5;
		background: var(--surface-page);
	}
	/* SORT: one closed block of square cells, the menu (▾ says it opens) and
	   the direction beside it, as the panel rows draw a sort ("cells plus
	   ↓ / ↑"). The native box is dropped for the block's own. */
	.sort {
		display: inline-flex;
		align-items: stretch;
		height: 32px;
		border: 1px solid var(--line-2);
		color: var(--text-1);
	}
	.menu {
		position: relative;
		display: flex;
	}
	.sort select {
		appearance: none;
		border: 0;
		border-radius: 0;
		margin: 0;
		padding: 0 30px 0 12px;
		background: none;
		font: inherit;
		letter-spacing: inherit;
		color: inherit;
		cursor: pointer;
	}
	.sort select option {
		background: var(--surface-panel);
		color: var(--text-1);
	}
	.caret {
		position: absolute;
		top: 0;
		bottom: 0;
		right: 12px;
		display: flex;
		align-items: center;
		pointer-events: none;
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
	.sort select:focus-visible,
	.sort .dir:focus-visible {
		outline: 2px solid var(--accent);
		outline-offset: -2px;
	}
	.sort select:active,
	.sort .dir:active {
		background: var(--surface-inverse);
		color: var(--text-inverse);
	}
	.filter-desk,
	.desk-count {
		display: none;
	}
	/* Not positioned: its panel hangs from the top bar's right edge, 640 wide (3j). */
	.filter-desk {
		align-self: stretch;
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
		border-left: var(--hairline);
		color: var(--text-1);
		text-decoration: none;
		white-space: nowrap;
	}
	@media (max-width: 599px) {
		.queue-cell {
			padding: 0 12px;
		}
	}
	/* The right-hand cell's own rule is on BROWSE's left; BROWSE draws the next one. */
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
	.browse-cell + .queue-cell {
		border-left: 0;
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

	/* REFRESH's answer (c221), pinned over the bulk bar it came from. */
	.refresh-band {
		position: fixed;
		left: var(--sheet-left, 0);
		right: 0;
		bottom: calc(121px + env(safe-area-inset-bottom));
		z-index: 10;
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
		/* The shelf tabs pin under the safe top as the header and CONTINUE
		   scroll away (state 3B). */
		.tabs {
			position: sticky;
			top: 0;
			z-index: 9;
			height: var(--tv-tab-h);
			margin: 0 var(--pad);
			border: var(--hairline);
			background: var(--surface-page);
		}
		.tabs > :global(nav) {
			height: 100%;
		}
		/* Six 144px cells inside the safe margin; the grid's own hairline. */
		.grid {
			margin: 0 var(--pad);
			border-left: var(--hairline);
			border-right: var(--hairline);
		}
	}
</style>

<script lang="ts">
	import { backLink } from '$lib/back';
	import { onMount, tick, untrack } from 'svelte';
	import type { PageData } from './$types';
	import { MediaQuery } from 'svelte/reactivity';
	import { clampZoom, keptZoom, pinchZoom, resetZoom, stepZoom, zoomKey } from '$lib/reader/zoom';
	import { afterNavigate, beforeNavigate, goto, replaceState } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { page as appPage } from '$app/state';
	import { offline } from '$lib/offline.svelte';
	import { keepAhead } from '$lib/cache/device';
	import { flushPending, queuePending } from '$lib/cache/pending';
	import { SvelteMap } from 'svelte/reactivity';
	import PageMenu from '$lib/components/content/PageMenu.svelte';
	import { bandFor, menuRows, type MenuKind, type MenuRow } from '$lib/library/cover-menu';
	import { saves } from '$lib/saves.svelte';
	import {
		ProgressClock,
		metaLine,
		pageLabel,
		settingsLabel,
		spreadOf,
		spreads,
		swipeAction,
		mouseAction,
		hoverAction,
		tapAction,
		type Fit,
		type Mode,
		type Page,
		wideTreatment,
		firstHalf,
		type Wide,
		pagesAhead,
		nearEnd,
		stripWindow,
		type StripChapter
	} from '$lib/reader/reader';
	import PageImage from './PageImage.svelte';
	import Chrome from './Chrome.svelte';
	import ReadingSheet from './ReadingSheet.svelte';
	import EndPage from './EndPage.svelte';
	import Strip from './Strip.svelte';
	import type { Inset } from '$lib/reader/crop';
	import type { TextBlock } from '$lib/japanese/ocr';
	import {
		hitBlock,
		outlined,
		rings,
		shownBlocks,
		type BlocksShown,
		type Ring
	} from '$lib/japanese/blocks';
	import { placement, type Placement } from '$lib/japanese/panel';
	import { flushLookups } from '$lib/japanese/lookups';
	import LookupPanel from '$lib/components/japanese/LookupPanel.svelte';
	import { between } from '$lib/library/editions';

	/**
	 * The image reader (Index Reader; doc/READER.md). The page is the
	 * interface: nothing is on screen but the art until a tap in the middle
	 * asks for the controls.
	 */
	let {
		data
	}: {
		data: Exclude<Extract<PageData, { text: false }>, { video: true } | { online: true }>;
	} = $props();

	// ---- settings -------------------------------------------------------------------
	// Mode is the session's, starting from the series; fit, spreads and dim are
	// the device's, kept in this browser only (they're about the screen).
	const KEY = 'tsundoku.reader.';
	function stored<T>(name: string, fallback: T): T {
		try {
			const v = localStorage.getItem(KEY + name);
			return v === null ? fallback : (JSON.parse(v) as T);
		} catch {
			return fallback;
		}
	}
	function store(name: string, value: unknown) {
		try {
			localStorage.setItem(KEY + name, JSON.stringify(value));
		} catch {
			// Private windows and blocked storage: the setting lasts this session.
		}
	}

	// The series' mode is where a session starts, not a binding to it.
	// svelte-ignore state_referenced_locally
	let mode = $state<Mode>(data.series.mode);
	// svelte-ignore state_referenced_locally
	let seriesMode = $state<Mode>(data.series.mode);
	let fit = $state<Fit>('screen');
	let spreadsOn = $state(false);
	let dim = $state(0);
	/** Vertical: each side's margin, percent of the width (doc/READER.md, "Vertical"). */
	let sides = $state(0);
	/** A wide page outside spreads: whole, in halves, or turned (doc/READER.md, "Wide pages"). */
	let wide = $state<Wide>('fit');
	/** Paged: crop each page's plain border (doc/READER.md, "Crop borders"). */
	let crop = $state(false);
	/** Japanese: when the text blocks are outlined (doc/JAPANESE.md, "The tap rule"). */
	let blocksShown = $state<BlocksShown>('controls');
	let shift = $state(false);
	onMount(() => {
		fit = stored<Fit>('fit', 'screen');
		spreadsOn = stored('spreads', false);
		dim = stored('dim', 0);
		sides = stored('sides', 0);
		wide = stored('wide', 'fit');
		crop = stored('crop', false);
		blocksShown = stored<BlocksShown>('blocks', 'controls');
	});

	const landscape = new MediaQuery('(orientation: landscape)', false);

	// ---- zoom (doc/READER.md, "Zoom"; card c169) -----------------------------------
	// The session's zoom starts from the kept one: per mode (manga paged, manhwa the
	// strip) and per screen class on this device, so a phone never overwrites the PC.
	const narrow = new MediaQuery('(max-width: 599px)', false);
	const zoomAt = $derived(
		zoomKey(mode === 'vertical' ? 'vertical' : 'paged', narrow.current ? 'phone' : 'wide')
	);
	let zoom = $state(1);
	let kept = $state(1);
	$effect(() => {
		kept = keptZoom(stored<unknown>(zoomAt, null)) ?? 1;
		zoom = kept;
	});
	const setZoom = (z: number) => (zoom = clampZoom(z));
	/** KEEP: this zoom is where every series of this mode starts, on this screen. */
	function keepZoom() {
		kept = zoom;
		store(zoomAt, zoom);
	}
	// Ctrl + wheel and a two-finger pinch zoom the pages, never the browser's page.
	onMount(() => {
		const wheel = (e: WheelEvent) => {
			if (!e.ctrlKey || sheet || lookup || menu) return;
			e.preventDefault();
			setZoom(zoom * (e.deltaY < 0 ? 1.1 : 1 / 1.1));
		};
		let pinch: { zoom: number; dist: number } | null = null;
		const spread = (t: TouchList) =>
			Math.hypot(t[0].clientX - t[1].clientX, t[0].clientY - t[1].clientY);
		const touchstart = (e: TouchEvent) => {
			pinch = e.touches.length === 2 ? { zoom, dist: spread(e.touches) } : null;
		};
		const touchmove = (e: TouchEvent) => {
			if (!pinch || e.touches.length !== 2) return;
			e.preventDefault();
			setZoom(pinchZoom(pinch.zoom, pinch.dist, spread(e.touches)));
		};
		const touchend = (e: TouchEvent) => {
			if (e.touches.length < 2) pinch = null;
		};
		addEventListener('wheel', wheel, { passive: false });
		addEventListener('touchstart', touchstart, { passive: true });
		addEventListener('touchmove', touchmove, { passive: false });
		addEventListener('touchend', touchend, { passive: true });
		return () => {
			removeEventListener('wheel', wheel);
			removeEventListener('touchstart', touchstart);
			removeEventListener('touchmove', touchmove);
			removeEventListener('touchend', touchend);
		};
	});
	/** A zoomed screen starts each page at the top, and in R→L at its right. */
	function startAtTop(node: HTMLElement) {
		node.scrollTop = 0;
		node.scrollLeft = mode === 'rtl' ? node.scrollWidth : 0;
	}
	const useSpreads = $derived(mode !== 'vertical' && spreadsOn && landscape.current);

	// ---- the series' own fields, optimistic ------------------------------------------
	// svelte-ignore state_referenced_locally
	let rating = $state<number>(data.series.books ? data.entry.rating : data.series.rating);
	// svelte-ignore state_referenced_locally
	let favourite = $state(data.series.books ? data.entry.favourite : data.series.favourite);

	async function action(name: string, form: Record<string, string>) {
		const body = new FormData();
		for (const [k, v] of Object.entries(form)) body.set(k, v);
		await fetch(`${resolve('/series/[id]', { id: String(data.series.id) })}?/${name}`, {
			method: 'POST',
			body,
			headers: { 'x-sveltekit-action': 'true' }
		}).catch(() => undefined);
	}
	function rate(n: number) {
		rating = n;
		// A book in a series of books keeps its own rating (doc/BOOKS.md).
		if (data.series.books)
			void action('bookRate', { entry: String(data.entry.id), rating: String(n) });
		else void action('rate', { rating: String(n) });
	}
	function toggleFav() {
		favourite = !favourite;
		const on = favourite ? '1' : '0';
		if (data.series.books) void action('bookFavourite', { entry: String(data.entry.id), on });
		else void action('favourite', { on });
	}
	function remember() {
		seriesMode = mode;
		void action('direction', { direction: mode });
	}

	// ---- pages and position ------------------------------------------------------------
	const pages = $derived<Page[]>(data.pages);
	const groups = $derived(spreads(pages, useSpreads, shift));
	const pageSrc = (entryId: number, version: string, i: number) =>
		`${resolve('/api/entries/[id]/pages/[n]', { id: String(entryId), n: String(i) })}?v=${encodeURIComponent(version)}`;
	const src = $derived((i: number) => pageSrc(data.entry.id, data.manifest?.version ?? '', i));

	/** The page the reader is on (0-based); the end page is `pages.length`. */
	let at = $state(0);
	let atEnd = $state(false);
	/** A split wide page: 0 is the half read first, 1 the other. */
	let half = $state<0 | 1>(0);
	let chrome = $state(false);
	let sheet = $state(false);

	// ---- editions (doc/EDITIONS.md): one book, read in any of its languages -------------
	const editions = $derived(data.editions);
	const here = $derived(editions?.list.find((e) => e.entryId === data.entry.id) ?? null);
	/**
	 * After a switch: where it landed, said until the next page turn. Set just
	 * before the new edition loads, and kept by the page it landed on.
	 */
	let switched = $state<{
		at: number;
		main: string;
		short: string;
		detail: string;
		miss: boolean;
	} | null>(null);
	let landing: typeof switched = null;
	/** The same page in another edition: the matched one, or the nearest that has a match. */
	function switchTo(entryId: number, page = at) {
		const to = editions?.list.find((e) => e.entryId === entryId);
		if (!here || !to || to === here) return;
		const land = between(here, to, page);
		landing = land.exact
			? {
					at: land.page,
					main: `${to.code} P. ${land.page + 1} · THE SAME PAGE AS ${here.code} P. ${page + 1}`,
					short: `${to.code} P. ${land.page + 1} · SAME PAGE AS ${here.code}`,
					detail: 'SHOWN UNTIL THE NEXT PAGE TURN',
					miss: false
				}
			: {
					at: land.page,
					main: `${here.code} P. ${page + 1} ISN’T IN ${to.code}`,
					short: `${here.code} P. ${page + 1} ISN’T IN ${to.code}`,
					detail: `OPENED ${to.code} P. ${land.page + 1}, THE NEAREST MATCHED PAGE`,
					miss: true
				};
		lookup = null;
		// `ed`: this edition, asked for -- not the one the book opens in.
		const href = `${resolve('/read/[entry]', { entry: String(to.entryId) })}?p=${land.page + 1}&ed=1`;
		// eslint-disable-next-line svelte/no-navigation-without-resolve -- built from resolve()
		void goto(href, { replaceState: true, noScroll: true });
	}
	/** From the lookup panel: the page in the book's other language, read side by side in time. */
	const otherEdition = $derived(
		here && editions ? (editions.list.find((e) => e !== here) ?? null) : null
	);

	// A new entry (or the first): start where the server says.
	let shown = 0;
	$effect(() => {
		const id = data.entry.id;
		if (id === shown) return;
		shown = id;
		// `?p` from the URL itself too: offline, the page and its data come
		// from the cache, rendered for whatever page it was cached at.
		const asked = appPage.url.searchParams.get('p');
		const n = Number(asked);
		at =
			asked === 'last'
				? Math.max(0, pages.length - 1)
				: Number.isInteger(n) && n >= 1
					? Math.min(n - 1, Math.max(0, pages.length - 1))
					: data.start;
		atEnd = false;
		half = 0;
		shift = false;
		switched = landing;
		landing = null;
		sheet = false;
		finished = false;
		// A book in a series of books shows its own rating and FAV.
		rating = data.series.books ? data.entry.rating : data.series.rating;
		favourite = data.series.books ? data.entry.favourite : data.series.favourite;
		clock.resume(Date.now());
		void send('open', at);
		// Keep this chapter and the next ones on the tablet -- never for a
		// hidden series, while revealed, or incognito: those leave nothing.
		if (!data.series.hidden && !data.reveal && !data.incognito)
			void keepAhead(data.series.id, data.series.entries, id);
	});

	const group = $derived(groups[spreadOf(groups, at)] ?? [at]);

	// ---- crop borders ----------------------------------------------------------------------
	// Measured on the workstation, once per page (src/lib/server/pages/crops.ts);
	// asked for only while CROP BORDERS is on and the pages are paged.
	let crops = $state<{ entry: number; insets: Inset[] } | null>(null);
	$effect(() => {
		if (!crop || mode === 'vertical' || !data.manifest) return;
		const id = data.entry.id;
		if (crops?.entry === id) return;
		let cancelled = false;
		void fetch(resolve('/api/entries/[id]/crops', { id: String(id) }))
			.then((r) => (r.ok ? (r.json() as Promise<{ crops: Inset[] }>) : null))
			.then((r) => {
				if (!cancelled && r) crops = { entry: id, insets: r.crops };
			})
			.catch(() => undefined);
		return () => {
			cancelled = true;
		};
	});
	const insetOf = (i: number) =>
		crop && mode !== 'vertical' && crops?.entry === data.entry.id
			? (crops.insets[i] ?? null)
			: null;

	const treatment = (i: number) => wideTreatment(pages[i], { mode, spreads: useSpreads, wide });
	/** This screen is half of a split wide page. */
	const splitHere = $derived(group.length === 1 && treatment(group[0]) === 'split');

	function go(to: number) {
		if (pages.length === 0) return;
		lookup = null;
		atEnd = false;
		half = 0;
		at = Math.max(0, Math.min(pages.length - 1, to));
	}

	function next() {
		if (atEnd) return continueOn();
		if (splitHere && half === 0) {
			half = 1;
			return;
		}
		half = 0;
		const g = spreadOf(groups, at);
		if (g >= groups.length - 1) {
			atEnd = true;
			markFinished();
			return;
		}
		at = groups[g + 1][0];
	}

	function prev() {
		if (atEnd) {
			atEnd = false;
			return;
		}
		if (splitHere && half === 1) {
			half = 0;
			return;
		}
		const g = spreadOf(groups, at);
		if (g > 0) {
			at = groups[g - 1][0];
			// Back into a split page: its second half, the one just before.
			half = treatment(at) === 'split' ? 1 : 0;
		} else if (data.prev?.available)
			// eslint-disable-next-line svelte/no-navigation-without-resolve -- built from resolve()
			void goto(`${resolve('/read/[entry]', { entry: String(data.prev.id) })}?p=last`, {
				replaceState: true
			});
	}

	// ---- preloading -----------------------------------------------------------------------
	// Paged: the next screens and the one before are fetched and decoded before
	// they're turned to, so a turn shows a finished page, not a box saying
	// "P. 15" (doc/READER.md, "Preloading"). The browser's cache keeps the bytes;
	// the images are held here so they stay decoded. Vertical has every page of
	// its strip in the page already.
	// Not state: nothing draws from it, it only keeps the images alive.
	// eslint-disable-next-line svelte/prefer-svelte-reactivity
	const preloaded = new Map<string, HTMLImageElement>();
	function preload(url: string) {
		if (preloaded.has(url)) return;
		const img = new Image();
		img.decoding = 'async';
		img.src = url;
		void img.decode?.().catch(() => undefined);
		preloaded.set(url, img);
		// A handful is plenty: the ones around the page being read.
		if (preloaded.size > 12) preloaded.delete(preloaded.keys().next().value!);
	}
	let nextFirst = 0;
	$effect(() => {
		if (mode === 'vertical' || !data.manifest || pages.length === 0) return;
		const g = spreadOf(groups, at);
		untrack(() => {
			for (const i of pagesAhead(groups, g)) preload(src(i));
			// The end in sight: the next chapter's first pages too.
			const n = data.next;
			if (!nearEnd(groups, g) || !n?.available || nextFirst === n.id || !offline.online) return;
			nextFirst = n.id;
			void fetch(resolve('/api/entries/[id]/pages', { id: String(n.id) }))
				.then((r) => (r.ok ? (r.json() as Promise<{ pages: Page[]; version: string }>) : null))
				.then((m) => {
					if (m) for (const i of [0, 1]) if (m.pages[i]) preload(pageSrc(n.id, m.version, i));
				})
				.catch(() => undefined);
		});
	});

	// ---- the slide between pages ------------------------------------------------------------
	// Paged turns slide (doc/READER.md, "Turning pages"): the page follows the
	// finger, and a turn -- swipe, tap, key or click -- carries it the rest of
	// the way with the neighbouring screen sliding in beside it. The track
	// holds the screen being read and, while one is showing, that neighbour.
	type Screen = { key: string; pos: -1 | 0 | 1; pages: number[]; split: boolean; half: 0 | 1 };
	const TURN_MS = 220;
	const reduceMotion = new MediaQuery('(prefers-reduced-motion: reduce)', false);
	/** How far the track is dragged, in px; or while sliding, where it's going. */
	let drag = $state(0);
	let slideTo = $state<string | null>(null);
	let animating = $state(false);
	/** The side a neighbour is shown on, while dragging or sliding. */
	let peek = $state<-1 | 1 | null>(null);

	/** Which way the screen on a side is: in R->L the next page lies to the left. */
	const dirAt = (side: -1 | 1): 'next' | 'prev' =>
		(side === 1) === (mode !== 'rtl') ? 'next' : 'prev';
	const sideOf = (dir: 'next' | 'prev'): -1 | 1 => (dirAt(1) === dir ? 1 : -1);

	/** The screen a turn would show, when it's another screen of pages in this chapter. */
	function after(dir: 'next' | 'prev'): { at: number; half: 0 | 1 } | null {
		if (atEnd || pages.length === 0) return null;
		const g = spreadOf(groups, at);
		if (dir === 'next') {
			if (splitHere && half === 0) return { at, half: 1 };
			if (g >= groups.length - 1) return null;
			return { at: groups[g + 1][0], half: 0 };
		}
		if (splitHere && half === 1) return { at, half: 0 };
		if (g <= 0) return null;
		const to = groups[g - 1][0];
		return { at: to, half: treatment(to) === 'split' ? 1 : 0 };
	}

	function screenAt(atI: number, halfV: 0 | 1, pos: -1 | 0 | 1): Screen {
		const g = groups[spreadOf(groups, atI)] ?? [atI];
		const split = g.length === 1 && treatment(g[0]) === 'split';
		return {
			key: `${g.join(',')}${split ? `:${halfV}` : ''}`,
			pos,
			pages: mode === 'rtl' ? [...g].reverse() : g,
			split,
			half: halfV
		};
	}
	const screens = $derived.by((): Screen[] => {
		const out = [screenAt(at, half, 0)];
		if (peek !== null) {
			const n = after(dirAt(peek));
			if (n) out.push(screenAt(n.at, n.half, peek));
		}
		return out;
	});
	const halfSide = (h: 0 | 1) =>
		h === 0 ? firstHalf(mode) : firstHalf(mode) === 'left' ? 'right' : 'left';

	/** Turn a page, sliding: the neighbour comes in, then becomes the page being read. */
	/** A turn asked for mid-slide: taken as soon as this one lands, so quick taps all count. */
	let queued: 'next' | 'prev' | null = null;
	async function turn(dir: 'next' | 'prev') {
		lookup = null;
		if (animating) {
			queued = dir;
			return;
		}
		const n = after(dir);
		if (!n || reduceMotion.current) {
			drag = 0;
			peek = null;
			return dir === 'next' ? next() : prev();
		}
		peek = sideOf(dir);
		await tick();
		await new Promise((r) => requestAnimationFrame(r));
		animating = true;
		slideTo = `${-peek * 100}%`;
		await new Promise((r) => setTimeout(r, TURN_MS));
		// The neighbour's element becomes the page's (same key), so nothing redraws.
		animating = false;
		slideTo = null;
		drag = 0;
		peek = null;
		if (dir === 'next') next();
		else prev();
		const then = queued;
		queued = null;
		if (then) void turn(then);
	}

	/** A drag that didn't turn: back into place. */
	async function settleBack() {
		if (reduceMotion.current || drag === 0) {
			drag = 0;
			peek = null;
			return;
		}
		animating = true;
		drag = 0;
		await new Promise((r) => setTimeout(r, TURN_MS));
		animating = false;
		peek = null;
	}

	/** The next chapter is on the tablet: it opens with no network. */
	const nextCached = $derived(
		data.next ? (offline.entries[data.series.id] ?? []).includes(data.next.id) : false
	);
	const endVariant = $derived(
		!data.next
			? 'series'
			: !data.next.available
				? 'missing'
				: !offline.online && !nextCached
					? 'offline'
					: 'chapter'
	);

	function continueOn() {
		if (endVariant !== 'chapter' || !data.next) return;
		markFinished();
		// eslint-disable-next-line svelte/no-navigation-without-resolve -- built from resolve()
		void goto(`${resolve('/read/[entry]', { entry: String(data.next.id) })}?p=1`, {
			replaceState: true,
			noScroll: true
		});
	}

	// Moving to another chapter or book starts it at page 1, never where it was
	// left: resuming is for opening one from outside the reader (doc/READER.md).
	function chapter(to: 'prev' | 'next') {
		const target = to === 'next' ? data.next : data.prev;
		if (!target) return;
		// eslint-disable-next-line svelte/no-navigation-without-resolve -- built from resolve()
		void goto(`${resolve('/read/[entry]', { entry: String(target.id) })}?p=1`, {
			replaceState: true
		});
	}

	// ---- progress ------------------------------------------------------------------------
	// Everything goes through /api/reading, which refuses to write while
	// incognito (doc/PRIVACY.md). Nothing here decides that.
	const clock = new ProgressClock(Date.now());
	let finished = false;
	let saved = $state(true);

	async function send(kind: 'open' | 'page' | 'finish' | 'close', page: number) {
		if (!data.manifest) return;
		const now = Date.now();
		const body = JSON.stringify({
			seriesId: data.series.id,
			entryId: data.entry.id,
			kind,
			page,
			durationMs: kind === 'open' ? 0 : clock.lap(now),
			at: now
		});
		if (kind === 'close') {
			const sent =
				offline.online &&
				navigator.sendBeacon?.(
					resolve('/api/reading'),
					new Blob([body], { type: 'application/json' })
				);
			if (!sent) queuePending(body);
			return;
		}
		try {
			const res = await fetch(resolve('/api/reading'), {
				method: 'POST',
				body,
				headers: { 'content-type': 'application/json' },
				keepalive: true
			});
			if (res.ok) {
				saved = ((await res.json()) as { saved: boolean }).saved;
				void flushPending();
			}
		} catch {
			// Offline: kept on the tablet with its own time, and sent when the
			// workstation answers again (doc/OFFLINE.md).
			queuePending(body);
		}
	}

	function markFinished() {
		if (finished || pages.length === 0) return;
		finished = true;
		void send('finish', pages.length - 1);
	}

	// A page event once the reader has settled on a page, not on every flick.
	let settle: ReturnType<typeof setTimeout> | undefined;
	$effect(() => {
		const page = group[group.length - 1];
		if (data.entry.id !== shown || atEnd) return;
		clearTimeout(settle);
		settle = setTimeout(() => {
			void send('page', page);
			// Keep the URL on the page, so a reload resumes here.
			const url = new URL(appPage.url);
			url.searchParams.set('p', String(group[0] + 1));
			// eslint-disable-next-line svelte/no-navigation-without-resolve -- the current URL, with ?p
			replaceState(url, {});
			if (page >= pages.length - 1 && mode !== 'vertical') markFinished();
		}, 800);
		return () => clearTimeout(settle);
	});

	beforeNavigate(({ to }) => {
		// Moving between chapters is not leaving: the next one sends its own open.
		if (to?.route.id !== '/read/[entry]') void send('close', group[0]);
	});

	// ---- the vertical strip -------------------------------------------------------------
	// The strip holds the chapter being read and its neighbours, and reading
	// carries on across a band in either direction (doc/READER.md, "Vertical").
	// Crossing one moves the reader to that chapter with replaceState-like
	// navigation, so the URL, the controls and progress follow; the strip
	// itself stays, so nothing on screen moves.
	let strip = $state<StripChapter[]>([]);
	/** Bumped when the strip starts over: the chapter jumped to isn't on it. */
	let stripSession = $state(0);
	/** Set while a scroll across a band is navigating: the strip is already there. */
	let crossing: number | null = null;

	const chapterPosition = (id: number) =>
		`${data.series.entries.findIndex((e) => e.id === id) + 1} OF ${data.series.count}`;
	const isCached = (id: number) => (offline.entries[data.series.id] ?? []).includes(id);
	/** A neighbour the strip can show: on disk, and reachable from here. */
	const readable = (n: typeof data.next) =>
		n?.available && (offline.online || isCached(n.id)) ? n : null;
	const stripChapter = (
		n: NonNullable<typeof data.next>,
		pages: Page[] | null = null,
		version = ''
	): StripChapter => ({
		id: n.id,
		name: n.name,
		title: n.title,
		pageCount: n.pageCount,
		position: chapterPosition(n.id),
		cached: isCached(n.id),
		pages,
		version
	});

	/**
	 * Change the strip without moving what's on screen. A chapter arriving or
	 * leaving above the page being read would shove it down or up; the page
	 * under the middle of the screen is put back where it was. By hand, since
	 * the browser's scroll anchoring does nothing at the very top of a page.
	 */
	async function keepPlace(change: () => void) {
		const anchor = document
			.elementFromPoint(innerWidth / 2, innerHeight / 2)
			?.closest<HTMLElement>('[data-role="page"], .band');
		const before = anchor?.getBoundingClientRect().top;
		change();
		await tick();
		if (anchor?.isConnected && before !== undefined)
			window.scrollBy(0, anchor.getBoundingClientRect().top - before);
	}

	async function loadStripPages(id: number) {
		try {
			const r = await fetch(resolve('/api/entries/[id]/pages', { id: String(id) }));
			const m = r.ok ? ((await r.json()) as { pages: Page[]; version: string }) : null;
			if (!m) return;
			void keepPlace(() => {
				strip = strip.map((c) => (c.id === id ? { ...c, pages: m.pages, version: m.version } : c));
			});
		} catch {
			// Offline and not kept: the band says LOADING, and the chapter opens from the controls.
		}
	}

	$effect(() => {
		if (mode !== 'vertical' || !data.manifest) return;
		const id = data.entry.id;
		untrack(() => {
			const current = stripChapter(
				{
					id,
					name: data.entry.name,
					title: data.entry.title,
					pageCount: pages.length,
					available: true,
					online: !!data.manifest?.online,
					ocr: false
				},
				pages,
				data.manifest?.version ?? ''
			);
			const onStrip = strip.some((c) => c.id === id);
			const scrolledHere = crossing === id;
			crossing = null;
			const prev = readable(data.prev);
			const next = readable(data.next);
			const held = stripWindow(
				onStrip ? strip : [],
				current,
				prev && stripChapter(prev),
				next && stripChapter(next)
			);
			if (!onStrip) {
				// Opened here, or jumped to a chapter not on the strip: start over at it.
				strip = held;
				stripSession += 1;
				placeAt = { id, page: at };
				void tick().then(place);
			} else {
				void keepPlace(() => (strip = held));
				// CH. → from the controls, to a neighbour already on the strip: go to it.
				if (!scrolledHere) {
					placeAt = { id, page: at };
					void tick().then(place);
				}
			}
			for (const c of held) if (!c.pages) void loadStripPages(c.id);
		});
	});

	/**
	 * Where the strip should open: a page's top at the top of the screen. Done
	 * once the page is laid out, and again after SvelteKit's own scroll on
	 * arrival, which would otherwise put it back at the top of the document.
	 */
	let placeAt: { id: number; page: number } | null = null;
	function place() {
		if (!placeAt) return;
		document
			.querySelector(`[data-entry="${placeAt.id}"][data-index="${placeAt.page}"]`)
			?.scrollIntoView({ block: 'start' });
	}
	afterNavigate(() => {
		place();
		placeAt = null;
	});

	/** A page crossed the middle of the screen, maybe in another chapter. */
	function stripPage(chapter: number, i: number) {
		if (chapter === data.entry.id) {
			at = i;
			// A fast scroll can skip the end marker; the last page is enough.
			if (i >= pages.length - 1) markFinished();
			return;
		}
		if (crossing !== null) return;
		// Onward past the band: the chapter just left is read.
		if (chapter === data.next?.id) markFinished();
		crossing = chapter;
		// eslint-disable-next-line svelte/no-navigation-without-resolve -- built from resolve()
		void goto(`${resolve('/read/[entry]', { entry: String(chapter) })}?p=${i + 1}`, {
			replaceState: true,
			noScroll: true,
			keepFocus: true
		});
	}

	// ---- Japanese: text blocks and lookup ---------------------------------------------------
	// A Japanese series' pages carry the text blocks OCR read on the workstation
	// (doc/JAPANESE.md). A tap on one opens the lookup; every other tap does
	// what it always did. Kept chapters carry their text for offline.
	let text = $state<{ entry: number; pages: (TextBlock[] | null)[]; lookedUp: number } | null>(
		null
	);
	async function loadText(id: number) {
		try {
			const r = await fetch(resolve('/api/entries/[id]/text', { id: String(id) }));
			if (!r.ok) return;
			const t = (await r.json()) as { pages: (TextBlock[] | null)[]; lookedUp: number };
			if (id === data.entry.id) text = { entry: id, ...t };
		} catch {
			// Offline and not kept: the pages read as they do without OCR.
		}
	}
	$effect(() => {
		if (!data.ocr.japanese || !data.manifest) return;
		const id = data.entry.id;
		untrack(() => {
			lookup = null;
			dropped = null;
			if (text?.entry !== id) void loadText(id);
		});
	});
	// The end page's WORDS row counts this chapter's lookups, these included.
	$effect(() => {
		if (atEnd && data.ocr.japanese && offline.online) untrack(() => void loadText(data.entry.id));
	});
	onMount(() => {
		void flushLookups();
		const online = () => void flushLookups();
		addEventListener('online', online);
		return () => removeEventListener('online', online);
	});

	/** Blocks on a split or turned wide page aren't offered: the page isn't where OCR saw it. */
	const blocksOn = (entry: number, i: number) =>
		text?.entry === entry && treatment(i) !== 'split' && treatment(i) !== 'rotate'
			? shownBlocks(text.pages[i] ?? null, mode === 'vertical' ? null : insetOf(i))
			: [];

	type Lookup = { entry: number; page: number; index: number; block: TextBlock; place: Placement };
	let lookup = $state<Lookup | null>(null);
	const ringsOn = (entry: number, i: number): Ring[] =>
		rings(
			blocksOn(entry, i),
			outlined(blocksShown, chrome),
			lookup?.entry === entry && lookup.page === i ? lookup.index : null
		);

	/** The text block under a point on screen, on the page being read. */
	function blockUnder(x: number, y: number): (Omit<Lookup, 'place'> & { rect: DOMRect }) | null {
		for (const el of document.elementsFromPoint(x, y)) {
			const pg = el.closest<HTMLElement>('[data-page]');
			if (!pg) continue;
			// A neighbour screen, mid-slide: not the page being read.
			if (pg.closest('[aria-hidden="true"]')) return null;
			const slot = pg.closest<HTMLElement>('[data-entry]');
			const entry = slot ? Number(slot.dataset.entry) : data.entry.id;
			const page = Number(pg.dataset.page) - 1;
			// The drawn image, not the page's box: they differ wherever it's letterboxed.
			const r = (pg.querySelector('[data-text-frame]') ?? pg).getBoundingClientRect();
			const hit = hitBlock(blocksOn(entry, page), (x - r.left) / r.width, (y - r.top) / r.height);
			const block = hit && text?.pages[page]?.[hit.index];
			if (!hit || !block) return null;
			const [bx, by, bw, bh] = hit.box;
			return {
				entry,
				page,
				index: hit.index,
				block,
				rect: new DOMRect(r.left + bx * r.width, r.top + by * r.height, bw * r.width, bh * r.height)
			};
		}
		return null;
	}

	/**
	 * The tap rule (Japanese States 1a): with the lookup open, a block moves it
	 * and anywhere else closes it; otherwise a block opens it, winning over the
	 * edge strips. True when the tap was the lookup's.
	 */
	function tapBlocks(x: number, y: number): boolean {
		dropped = null;
		const hit = text ? blockUnder(x, y) : null;
		if (!hit && !lookup) return false;
		if (!hit) {
			lookup = null;
			return true;
		}
		const { rect, ...at } = hit;
		lookup = { ...at, place: placement(rect, innerWidth, innerHeight) };
		chrome = false;
		return true;
	}

	const lookupContext = $derived(
		lookup
			? `${mode === 'vertical' ? `${data.entry.name} · ` : ''}P. ${lookup.page + 1} · BLOCK ${lookup.index + 1}`
			: ''
	);
	/** Phone: the page slides up so the block clears the panel, and back on close. */
	const lift = $derived(lookup?.place.kind === 'phone' ? lookup.place.lift : 0);
	// Vertical: the strip holds still while the panel is open.
	$effect(() => {
		if (mode !== 'vertical' || !lookup) return;
		const html = document.documentElement;
		html.style.overflow = 'hidden';
		return () => {
			html.style.overflow = '';
		};
	});

	/** NOT TEXT: the block goes for good; the band offers UNDO until the next tap. */
	let dropped = $state<{ entry: number; page: number; index: number; block: TextBlock } | null>(
		null
	);
	const textUrl = (id: number) => resolve('/api/entries/[id]/text', { id: String(id) });
	function setBlocks(page: number, blocks: TextBlock[]) {
		if (text) text.pages[page] = blocks;
	}
	async function notText() {
		const l = lookup;
		const blocks = l && text?.entry === l.entry ? text.pages[l.page] : null;
		if (!l || !blocks) return;
		lookup = null;
		setBlocks(
			l.page,
			blocks.filter((_, k) => k !== l.index)
		);
		dropped = { entry: l.entry, page: l.page, index: l.index, block: l.block };
		const ok = await fetch(textUrl(l.entry), {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ drop: { page: l.page, index: l.index } })
		})
			.then((r) => r.ok)
			.catch(() => false);
		if (!ok) {
			// The workstation didn't take it: the block is back, as it still is there.
			setBlocks(l.page, blocks);
			dropped = null;
		}
	}
	async function undoNotText() {
		const d = dropped;
		dropped = null;
		const blocks = d && text?.entry === d.entry ? text.pages[d.page] : null;
		if (!d || !blocks) return;
		setBlocks(d.page, [...blocks.slice(0, d.index), d.block, ...blocks.slice(d.index)]);
		await fetch(textUrl(d.entry), {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ restore: { page: d.page, index: d.index, block: d.block } })
		}).catch(() => undefined);
	}

	/** The top bar says a Japanese page has no text yet, with the controls up. */
	const noText = $derived(
		data.ocr.japanese &&
			!atEnd &&
			mode !== 'vertical' &&
			(text?.entry !== data.entry.id || text.pages[at] == null)
			? { done: data.ocr.done, total: data.ocr.total }
			: null
	);

	// ---- the page menu: a long-pressed page as a cover (Page Menu, c26) ----------------------
	// doc/COVERS.md, "Chosen". Held 450ms without moving: a finger, or the left
	// button on desktop. The release that follows turns nothing.
	const HOLD_MS = 450;
	let press: ReturnType<typeof setTimeout> | undefined;
	/** The press opened the menu: the pointerup (and click) after it are its own. */
	let pressed = false;
	type Menu = {
		entry: number;
		page: number;
		pages: number;
		rect: { left: number; top: number; width: number; height: number };
		preview: string;
		title: string;
		meta: string;
	};
	let menu = $state<Menu | null>(null);
	// The covers as they stand, updated as the owner chooses (the tile follows on the workstation).
	// svelte-ignore state_referenced_locally
	let seriesCover = $state(data.series.cover);
	// svelte-ignore state_referenced_locally
	const bookCovers = new SvelteMap(data.series.entries.map((e) => [e.id, e.coverPage]));
	// svelte-ignore state_referenced_locally
	const coverFiles = new Set(data.series.entries.filter((e) => e.hasCoverFile).map((e) => e.id));
	const labelOf = (id: number) => data.series.entries.find((e) => e.id === id)?.label ?? '';
	const menuKind = $derived<MenuKind>(
		data.series.kind !== 'doujin' ? 'series' : data.series.books ? 'book' : 'single'
	);
	const menuRowsNow = $derived(
		menu
			? menuRows({
					kind: menuKind,
					entry: menu.entry,
					page: menu.page,
					book: {
						coverPage: bookCovers.get(menu.entry) ?? null,
						hasFile: coverFiles.has(menu.entry)
					},
					series: seriesCover,
					labelOf
				})
			: []
	);

	function startPress(e: PointerEvent) {
		clearTimeout(press);
		pressed = false;
		if (e.pointerType === 'mouse' && e.button !== 0) return;
		const { clientX: x, clientY: y } = e;
		press = setTimeout(() => openMenu(x, y), HOLD_MS);
	}
	const cancelPress = () => clearTimeout(press);

	/** The page under the finger -- not the one under the middle of the screen -- and its place. */
	function openMenu(x: number, y: number) {
		if (lookup || sheet || !data.manifest) return;
		for (const el of document.elementsFromPoint(x, y)) {
			const pg = el.closest<HTMLElement>('[data-page]');
			if (!pg) continue;
			if (pg.closest('[aria-hidden="true"]')) return;
			const slot = pg.closest<HTMLElement>('[data-entry]');
			const entry = slot ? Number(slot.dataset.entry) : data.entry.id;
			const page = Number(pg.dataset.page) - 1;
			const c = entry === data.entry.id ? null : strip.find((s) => s.id === entry);
			const r = pg.getBoundingClientRect();
			pressed = true;
			chrome = false;
			coverBand = null;
			const name = c ? c.name : data.entry.name;
			menu = {
				entry,
				page,
				pages: c ? c.pageCount : pages.length,
				rect: { left: r.left, top: r.top, width: r.width, height: r.height },
				preview: c ? pageSrc(c.id, c.version, page) : src(page),
				title:
					menuKind === 'book'
						? c
							? c.title || c.name
							: data.entry.title || data.entry.name
						: data.series.title,
				meta:
					menuKind === 'book'
						? `DOUJIN · ${name.toUpperCase()} OF ${data.series.count} · ${data.series.title.toUpperCase()}`
						: menuKind === 'single'
							? `DOUJIN · ${pages.length} PAGES`
							: `${data.series.kind.toUpperCase()} · ${name.toUpperCase()} · ${
									data.series.entries.findIndex((e) => e.id === entry) + 1
								} OF ${data.series.count}`
			};
			return;
		}
	}
	// The strip holds still while the menu is open.
	$effect(() => {
		if (mode !== 'vertical' || !menu) return;
		const html = document.documentElement;
		html.style.overflow = 'hidden';
		return () => {
			html.style.overflow = '';
		};
	});

	type CoverBody = {
		entryId: number;
		book?: number | null;
		series?: { entry: number; page: number } | null;
	};
	let coverBand = $state<{ title: string; detail: string; undo: CoverBody } | null>(null);
	let bandTimer: ReturnType<typeof setTimeout> | undefined;

	/** Apply a choice here at once; the workstation is told behind it. */
	function applyLocal(b: CoverBody) {
		if ('book' in b) bookCovers.set(b.entryId, b.book ?? null);
		if ('series' in b) seriesCover = { ...seriesCover, chosen: b.series ?? null };
	}
	function undoOf(b: CoverBody): CoverBody {
		const u: CoverBody = { entryId: b.entryId };
		if ('book' in b) u.book = bookCovers.get(b.entryId) ?? null;
		if ('series' in b) u.series = seriesCover.chosen;
		return u;
	}
	async function postCover(b: CoverBody): Promise<boolean> {
		try {
			const r = await fetch(resolve('/api/covers'), {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify(b)
			});
			return r.ok;
		} catch {
			return false;
		}
	}
	function showBand(b: { title: string; detail: string; undo: CoverBody }) {
		coverBand = b;
		clearTimeout(bandTimer);
		bandTimer = setTimeout(() => (coverBand = null), 6000);
	}

	async function choose(row: MenuRow) {
		const m = menu;
		if (!m) return;
		const at = { entry: m.entry, page: m.page };
		const b: CoverBody = { entryId: m.entry };
		if (row.target !== 'series') b.book = row.isThis ? null : m.page;
		if (row.target !== 'book') b.series = row.isThis ? null : at;
		const undo = undoOf(b);
		const band = bandFor(row, m.page, m.title);
		menu = null;
		applyLocal(b);
		showBand({ ...band, undo });
		if (await postCover(b)) return;
		// Not stored: the choice stays, dashed, with RETRY and PUT BACK (doc/WAITING.md).
		coverBand = null;
		const what =
			row.target === 'book' ? 'BOOK COVER' : row.target === 'series' ? 'SERIES COVER' : 'COVER';
		saves.fail({
			what: `${what} NOT SAVED`,
			putBackLabel: 'PUT BACK',
			key: `cover:${m.entry}`,
			retry: () => postCover(b),
			putBack: () => applyLocal(undo)
		});
	}
	async function undoCover() {
		const band = coverBand;
		if (!band) return;
		coverBand = null;
		applyLocal(band.undo);
		if (!(await postCover(band.undo)))
			saves.fail({
				what: 'COVER NOT PUT BACK',
				putBackLabel: 'LEAVE IT',
				key: `cover:${band.undo.entryId}`,
				retry: () => postCover(band.undo),
				putBack: () => undefined
			});
	}
	// The band goes on the next turn or scroll, or when the controls open.
	$effect(() => {
		void at;
		void chrome;
		untrack(() => {
			if (coverBand && chrome) coverBand = null;
		});
	});
	let bandAt = -1;
	$effect(() => {
		const a = at;
		untrack(() => {
			if (coverBand && bandAt !== -1 && a !== bandAt) coverBand = null;
			bandAt = a;
		});
	});

	// ---- touch -----------------------------------------------------------------------------
	let down: { x: number; y: number } | null = null;
	let dragging = false;
	function pointerdown(e: PointerEvent) {
		down = { x: e.clientX, y: e.clientY };
		dragging = false;
		startPress(e);
	}
	/**
	 * The page follows a sideways drag. Not under FIT HEIGHT, where the browser
	 * pans the page sideways itself, nor with reduced motion.
	 */
	function pointermove(e: PointerEvent) {
		if (down && Math.hypot(e.clientX - down.x, e.clientY - down.y) > 10) cancelPress();
		// A zoomed page pans under a drag rather than turning (edges and keys still turn).
		if (!down || animating || fit === 'height' || zoom > 1 || reduceMotion.current) return;
		const dx = e.clientX - down.x;
		const dy = e.clientY - down.y;
		if (!dragging && (Math.abs(dx) < 8 || Math.abs(dx) < Math.abs(dy))) return;
		dragging = true;
		const side: -1 | 1 = dx < 0 ? 1 : -1;
		peek = side;
		// Nothing more that way in this chapter: it gives, but only a little.
		drag = after(dirAt(side)) ? dx : dx / 4;
	}
	function pointercancel() {
		cancelPress();
		down = null;
		if (dragging) void settleBack();
		dragging = false;
	}
	/** A right click turns back (mouseAction), so the page never opens the browser's menu. */
	function contextmenu(e: MouseEvent) {
		if (mode !== 'vertical' || menu || pressed) e.preventDefault();
	}
	function pointerup(e: PointerEvent) {
		cancelPress();
		if (pressed) {
			// The press opened the page menu; lifting the finger is part of it.
			pressed = false;
			down = null;
			dragging = false;
			return;
		}
		if (!down) return;
		// A link or button on the end page is its own; the page doesn't turn under it.
		if ((e.target as Element | null)?.closest?.('a, button')) {
			down = null;
			return;
		}
		const dx = e.clientX - down.x;
		const dy = e.clientY - down.y;
		down = null;
		const swipe = zoom > 1 ? null : swipeAction(dx, dy, mode);
		const dragged = dragging;
		dragging = false;
		if (swipe && swipe !== 'chrome') {
			chrome = false;
			return void turn(swipe);
		}
		if (dragged) return void settleBack();
		if (Math.hypot(dx, dy) > 10) return;
		// A text block, touched or clicked (not the right or middle button).
		if ((e.pointerType !== 'mouse' || e.button === 0) && tapBlocks(e.clientX, e.clientY)) return;
		// With the controls up, a tap on the page only puts them away.
		if (chrome) {
			chrome = false;
			return;
		}
		const action =
			(e.pointerType === 'mouse' ? mouseAction(e.button, mode) : null) ??
			tapAction(e.clientX, window.innerWidth, mode);
		if (action === 'chrome') chrome = true;
		else void turn(action);
	}

	// ---- the mouse at the window's edge ------------------------------------------------------
	/** The controls came up because the pointer reached an edge: they go when it leaves. */
	let byHover = false;
	function hover(e: PointerEvent) {
		if (e.pointerType !== 'mouse' || e.buttons !== 0 || sheet || lookup || !data.manifest) return;
		const overBars = !!(e.target as Element | null)?.closest?.(
			'header[aria-label="Reader"], footer[aria-label="Reader controls"]'
		);
		const act = hoverAction(e.clientY, innerHeight, { shown: chrome, byHover, overBars });
		if (act === 'show') {
			chrome = true;
			byHover = true;
		} else if (act === 'hide') chrome = false;
	}
	// Opened or closed any other way, they're no longer the pointer's.
	$effect(() => {
		if (!chrome) byHover = false;
	});

	function keydown(e: KeyboardEvent) {
		// The lookup, or the page menu, has the keyboard: Escape closes it (their own).
		if (lookup || menu) return;
		if (sheet) {
			if (e.key === 'Escape') sheet = false;
			return;
		}
		if (e.key === 'Escape') chrome = !chrome;
		if (e.key === '+' || e.key === '=') return setZoom(stepZoom(zoom, 1));
		if (e.key === '-') return setZoom(stepZoom(zoom, -1));
		if (e.key === '0') return setZoom(resetZoom(zoom, kept));
		if (mode === 'vertical') return;
		const left = e.key === 'ArrowLeft';
		const right = e.key === 'ArrowRight';
		if (left || right) {
			e.preventDefault();
			// Arrows are spatial: in R->L, left is forward.
			void turn(left === (mode === 'rtl') ? 'next' : 'prev');
		} else if (e.key === ' ' || e.key === 'PageDown') {
			e.preventDefault();
			void turn('next');
		} else if (e.key === 'PageUp') {
			e.preventDefault();
			void turn('prev');
		}
	}

	// ---- the screen stays awake while a page is showing -------------------------------
	onMount(() => {
		let lock: { release(): Promise<void> } | null = null;
		const wake = async () => {
			try {
				lock =
					(await (
						navigator as Navigator & {
							wakeLock?: { request(t: 'screen'): Promise<{ release(): Promise<void> }> };
						}
					).wakeLock?.request('screen')) ?? null;
			} catch {
				// Not allowed (no secure context, battery saver): the screen may sleep.
			}
		};
		const visible = () => {
			if (document.visibilityState === 'visible') {
				clock.resume(Date.now());
				void wake();
			}
		};
		void wake();
		document.addEventListener('visibilitychange', visible);
		const leave = () => send('close', group[0]);
		addEventListener('pagehide', leave);
		return () => {
			document.removeEventListener('visibilitychange', visible);
			removeEventListener('pagehide', leave);
			void lock?.release().catch(() => undefined);
		};
	});

	// Preload the next screen's pages so a turn is instant.
	$effect(() => {
		const g = spreadOf(groups, at);
		for (const i of groups[g + 1] ?? []) {
			const img = new Image();
			img.src = src(i);
		}
	});

	// ---- what the chrome says -----------------------------------------------------------
	const seriesHref = $derived(resolve('/series/[id]', { id: String(data.series.id) }));
	const libraryHref = resolve('/');
	const wordsHref = $derived(`${resolve('/words')}?series=${data.series.id}`);
	const meta = $derived(
		metaLine({
			kind: data.series.kind,
			entry: data.entry.name,
			count: data.series.count,
			page: atEnd ? 'END' : pageLabel(group, pages.length),
			incognito: data.incognito || !saved,
			single: data.series.single,
			online: !!data.manifest?.online,
			record: !!data.record
		})
	);
	const position = $derived(`${data.entry.index + 1} OF ${data.series.count}`);
	const title = $derived(
		data.series.books
			? `${data.series.title} · ${data.entry.title || data.entry.name}`
			: data.series.title
	);
	/** "DOUJIN · EN · P. 13 OF 29": a folded book says which language this is. */
	const metaShown = $derived(here ? meta.replace(/^([^·]+) · /, `$1 · ${here.code} · `) : meta);
	// In R->L the first page sits on the right of a spread.
</script>

<svelte:head><title>{data.series.title} · {data.entry.name}</title></svelte:head>
<svelte:window onkeydown={keydown} onpointermove={hover} />

<div class="reader" class:vertical={mode === 'vertical'} class:incognito={data.incognito}>
	{#if !data.manifest}
		<div class="missing">
			<div class="mt">{data.entry.name} IS NOT DOWNLOADED</div>
			<div class="md">IT WAS READ ONLINE, OR ISN'T COPIED OVER YET</div>
			<!-- eslint-disable-next-line svelte/no-navigation-without-resolve -- resolved above -->
			<a href={seriesHref} use:backLink>← SERIES</a>
		</div>
	{:else if mode === 'vertical'}
		{#key stripSession}
			<!-- svelte-ignore a11y_no_static_element_interactions -->
			<div
				class="lane-lift"
				style:transform={lift ? `translateY(${-lift}px)` : undefined}
				onpointerdown={(e) => {
					down = { x: e.clientX, y: e.clientY };
					startPress(e);
				}}
				onpointermove={(e) => {
					if (down && Math.hypot(e.clientX - down.x, e.clientY - down.y) > 10) cancelPress();
				}}
				onpointerup={() => {
					cancelPress();
					down = null;
				}}
				onpointercancel={cancelPress}
				oncontextmenu={(e) => (menu || pressed) && e.preventDefault()}
			>
				<Strip
					chapters={strip}
					{sides}
					{zoom}
					src={(c, i) => pageSrc(c.id, c.version, i)}
					onpage={stripPage}
					onend={(id) => id === data.entry.id && markFinished()}
					ontap={(e) => {
						// The click after a long press belongs to the page menu.
						if (pressed) {
							pressed = false;
							return;
						}
						if (!tapBlocks(e.clientX, e.clientY)) chrome = !chrome;
					}}
					rings={ringsOn}
				/>
			</div>
		{/key}
		{#if !data.next?.available}
			<EndPage
				variant={endVariant}
				entryName={data.entry.name}
				{position}
				kind={data.series.kind}
				seriesTitle={data.series.title}
				next={data.next}
				{nextCached}
				{rating}
				{favourite}
				incognito={data.incognito}
				mode="ltr"
				lastPage={pageLabel([pages.length - 1], pages.length)}
				{seriesHref}
				{libraryHref}
				onrate={rate}
				onfav={toggleFav}
				onback={() => undefined}
				words={text?.entry === data.entry.id ? text.lookedUp : 0}
				{wordsHref}
				nextOcr={data.next?.ocr ?? false}
			/>
		{/if}
	{:else if atEnd}
		<!-- svelte-ignore a11y_no_static_element_interactions -->
		<div
			class="stage"
			onpointerdown={pointerdown}
			onpointerup={pointerup}
			oncontextmenu={contextmenu}
		>
			<EndPage
				variant={endVariant}
				entryName={data.entry.name}
				{position}
				kind={data.series.kind}
				seriesTitle={data.series.title}
				next={data.next}
				{nextCached}
				{rating}
				{favourite}
				incognito={data.incognito}
				{mode}
				lastPage={pageLabel([pages.length - 1], pages.length)}
				{seriesHref}
				{libraryHref}
				onrate={rate}
				onfav={toggleFav}
				onback={() => (atEnd = false)}
				words={text?.entry === data.entry.id ? text.lookedUp : 0}
				{wordsHref}
				nextOcr={data.next?.ocr ?? false}
			/>
		</div>
	{:else}
		<!-- Taps and swipes are read here; the keyboard has its own path above. -->
		<!-- svelte-ignore a11y_no_static_element_interactions -->
		<div
			class="stage fit-{fit}"
			class:zoomed={zoom > 1}
			style:--zoom={zoom}
			style:transform={lift ? `translateY(${-lift}px)` : undefined}
			onpointerdown={pointerdown}
			onpointermove={pointermove}
			onpointerup={pointerup}
			onpointercancel={pointercancel}
			oncontextmenu={contextmenu}
		>
			<div
				class="track"
				class:animating
				style:transform="translateX({slideTo ?? `${drag}px`})"
				style:--turn-ms="{TURN_MS}ms"
			>
				{#each screens as sc (sc.key)}
					<div
						class="screen fit-{fit}"
						class:zoomed={zoom > 1}
						use:startAtTop
						style:transform={sc.pos === 0 ? undefined : `translateX(${sc.pos * 100}%)`}
						aria-hidden={sc.pos === 0 ? undefined : 'true'}
					>
						{#each sc.pages as i, k (src(i))}
							<PageImage
								src={src(i)}
								number={i + 1}
								chapter={i === 0 ? data.entry.name : ''}
								w={pages[i].w}
								h={pages[i].h}
								{fit}
								share={sc.pages.length}
								side={sc.pages.length === 1 ? 'center' : k === 0 ? 'left' : 'right'}
								half={sc.split ? halfSide(sc.half) : null}
								rotate={sc.pages.length === 1 && treatment(i) === 'rotate'}
								inset={insetOf(i)}
								online={!!data.manifest?.online}
								rings={sc.pos === 0 ? ringsOn(data.entry.id, i) : []}
							/>
						{/each}
					</div>
				{/each}
			</div>
		</div>
	{/if}

	{#if data.incognito}<div class="dashed" aria-hidden="true"></div>{/if}
	{#if dim > 0}<div class="dim" style:opacity={dim} aria-hidden="true"></div>{/if}

	{#if menu}
		<PageMenu
			page={menu.page}
			pages={menu.pages}
			rect={menu.rect}
			title={menu.title}
			meta={menu.meta}
			preview={menu.preview}
			rows={menuRowsNow}
			offline={!offline.online}
			onchoose={choose}
			onclose={() => (menu = null)}
		/>
	{/if}

	{#if coverBand}
		<div class="cover-band" role="status">
			<div class="cb-text">
				<div class="cb-t">{coverBand.title}</div>
				<div class="cb-d">{coverBand.detail}</div>
			</div>
			<button
				type="button"
				onpointerdown={(e) => e.stopPropagation()}
				onpointerup={(e) => e.stopPropagation()}
				onclick={(e) => {
					e.stopPropagation();
					void undoCover();
				}}>UNDO</button
			>
		</div>
	{/if}

	{#if lookup}
		<LookupPanel
			text={lookup.block.lines.join('')}
			context={lookupContext}
			placement={lookup.place}
			incognito={data.incognito}
			seriesId={data.series.id}
			entryId={lookup.entry}
			place="P. {lookup.page + 1}"
			other={otherEdition && here
				? {
						label: `${otherEdition.code} P. ${between(here, otherEdition, lookup.page).page + 1} →`,
						go: () => switchTo(otherEdition.entryId, lookup!.page)
					}
				: null}
			onclose={() => (lookup = null)}
			onnottext={notText}
		/>
	{/if}

	{#if dropped}
		<div class="dropped" role="status">
			<span>BLOCK {dropped.index + 1} · NOT TEXT · NO LONGER TAPPABLE</span>
			<button
				type="button"
				onpointerdown={(e) => e.stopPropagation()}
				onpointerup={(e) => e.stopPropagation()}
				onclick={(e) => {
					e.stopPropagation();
					void undoNotText();
				}}>UNDO</button
			>
		</div>
	{/if}

	{#if switched && switched.at === at && !atEnd}
		<!-- After a language switch (Editions 2b, 2c): where it landed, until the next turn. -->
		<div class="switched" class:under={chrome} role="status">
			<div class="sw-main" class:miss={switched.miss}>
				<span class="long">{switched.main}</span><span class="short">{switched.short}</span>
			</div>
			<div class="sw-detail">
				<span class="long">{switched.detail}</span><span class="short"
					>{switched.miss ? switched.detail : 'UNTIL THE NEXT TURN'}</span
				>
			</div>
		</div>
	{/if}

	{#if chrome && data.manifest}
		<Chrome
			{noText}
			{title}
			meta={metaShown}
			languages={editions && here
				? editions.list.map((e) => ({ code: e.code, on: e === here, entryId: e.entryId }))
				: []}
			onlanguage={(id) => switchTo(id)}
			backHref={seriesHref}
			incognito={data.incognito}
			{rating}
			{favourite}
			mode={mode === 'vertical' ? 'ltr' : mode}
			page={group[0]}
			total={pages.length}
			prev={data.prev?.name ?? null}
			next={data.next?.name ?? null}
			settings={settingsLabel(mode, fit, useSpreads)}
			shift={useSpreads}
			onfav={toggleFav}
			onsheet={() => (sheet = true)}
			addHref={data.record
				? `${resolve('/downloads/source/[id]', { id: data.record })}?/add`
				: null}
			onscrub={(p) =>
				mode === 'vertical'
					? document
							.querySelector(`[data-entry="${data.entry.id}"][data-index="${p}"]`)
							?.scrollIntoView({ block: 'start' })
					: go(p)}
			onchapter={chapter}
			onshift={() => (shift = !shift)}
		/>
	{/if}

	{#if sheet}
		<ReadingSheet
			{mode}
			{seriesMode}
			{fit}
			spreads={spreadsOn}
			{sides}
			{wide}
			{crop}
			landscape={landscape.current}
			{dim}
			{rating}
			blocks={data.ocr.japanese ? blocksShown : null}
			onblocks={(b) => {
				blocksShown = b;
				store('blocks', b);
			}}
			onmode={(m) => (mode = m)}
			onremember={remember}
			onfit={(f) => {
				fit = f;
				store('fit', f);
			}}
			onspreads={(on) => {
				spreadsOn = on;
				store('spreads', on);
			}}
			oncrop={(on) => {
				crop = on;
				store('crop', on);
			}}
			onwide={(w) => {
				wide = w;
				half = 0;
				store('wide', w);
			}}
			onsides={(n) => {
				sides = n;
				store('sides', n);
			}}
			ondim={(d) => {
				dim = d;
				store('dim', d);
			}}
			{zoom}
			keptZoom={kept}
			onzoom={setZoom}
			onkeepzoom={keepZoom}
			onrate={rate}
			onclose={() => (sheet = false)}
		/>
	{/if}
</div>

<style>
	/*
	 * The reader is always dark, whatever the library's theme: its ground is
	 * true black so letterboxing disappears on OLED, and light chrome over a
	 * black page would glare. The tokens are pinned here to the dark set.
	 */
	.reader {
		--surface-page: var(--graphite-950);
		--surface-panel: var(--graphite-900);
		--surface-inverse: var(--graphite-100);
		--line-1: var(--graphite-700);
		--line-2: var(--graphite-600);
		--text-1: var(--graphite-100);
		--text-2: var(--graphite-400);
		--text-inverse: var(--graphite-950);
		--on-accent: var(--graphite-950);
		--hairline: 1px solid var(--graphite-700);
		--rule-strong: 1px solid var(--graphite-100);
		--rating-off: var(--graphite-600);
		position: relative;
		min-height: 100dvh;
		background: #000;
		color: var(--text-1);
		user-select: none;
		-webkit-user-select: none;
		-webkit-touch-callout: none;
	}
	.stage {
		position: relative;
		width: 100vw;
		height: 100dvh;
		overflow: hidden;
		touch-action: none;
	}
	.stage.fit-width {
		touch-action: pan-y;
	}
	.stage.fit-height {
		touch-action: pan-x;
	}
	/* The screens side by side, moved as one: by the finger, or sliding. */
	.track {
		position: absolute;
		inset: 0;
		will-change: transform;
	}
	.track.animating {
		transition: transform var(--turn-ms) cubic-bezier(0.2, 0.8, 0.2, 1);
	}
	.screen {
		position: absolute;
		inset: 0;
		display: flex;
		align-items: center;
		justify-content: center;
		overflow: hidden;
	}
	/* Zoomed, the page box grows past the screen and scrolls both ways; the
	   browser pans it, so the stage hands panning back (doc/READER.md, "Zoom"). */
	.stage.zoomed {
		touch-action: pan-x pan-y;
	}
	.screen.zoomed {
		overflow: auto;
		align-items: safe center;
		justify-content: safe center;
	}
	/* Fit width and fit height let the page overflow and scroll the other way. */
	.screen.fit-width {
		align-items: flex-start;
		overflow-y: auto;
	}
	.screen.fit-height {
		overflow-x: auto;
		justify-content: safe center;
	}
	@media (prefers-reduced-motion: reduce) {
		.track.animating {
			transition: none;
		}
	}
	.dashed {
		position: fixed;
		top: 0;
		left: 0;
		right: 0;
		z-index: 25;
		border-top: 2px dashed var(--text-2);
		pointer-events: none;
	}
	/* Phone: the page slides up under the lookup, and back. */
	.stage,
	.lane-lift {
		transition: transform 220ms cubic-bezier(0.2, 0.8, 0.2, 1);
	}
	@media (prefers-reduced-motion: reduce) {
		.stage,
		.lane-lift {
			transition: none;
		}
	}
	/* Page Menu 1c: the band after a cover is chosen, where SaveBand sits. */
	.cover-band {
		position: fixed;
		left: 0;
		right: 0;
		bottom: 0;
		z-index: 30;
		display: flex;
		align-items: stretch;
		justify-content: space-between;
		gap: 12px;
		height: 60px;
		padding-left: 24px;
		background: var(--surface-panel);
		border-top: var(--rule-strong);
	}
	.cb-text {
		display: flex;
		flex-direction: column;
		justify-content: center;
		gap: 3px;
		min-width: 0;
	}
	.cb-t {
		font: 500 14px/1.2 var(--font-mono);
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}
	.cb-d {
		font: 400 13px/1.3 var(--font-mono);
		color: var(--text-2);
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}
	.cover-band button {
		display: flex;
		align-items: center;
		padding: 0 24px;
		border: 0;
		border-left: var(--hairline);
		border-radius: 0;
		background: transparent;
		color: var(--text-1);
		font: 500 14px/1.2 var(--font-mono);
		cursor: pointer;
	}
	.cover-band button:active {
		background: var(--surface-inverse);
		color: var(--text-inverse);
	}
	/* Index Japanese 1c, NOT TEXT: a band at the foot, UNDO until the next tap. */
	.dropped {
		position: fixed;
		left: 0;
		right: 0;
		bottom: 0;
		z-index: 30;
		height: 64px;
		display: flex;
		align-items: stretch;
		background: var(--surface-page);
		border-top: var(--rule-strong);
		font: 500 14px var(--font-mono);
		letter-spacing: 0.04em;
	}
	.dropped span {
		flex: 1;
		display: flex;
		align-items: center;
		padding: 0 24px;
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.dropped button {
		display: flex;
		align-items: center;
		padding: 0 24px;
		border: 0;
		border-left: var(--hairline);
		border-radius: 0;
		background: transparent;
		color: var(--text-1);
		font: inherit;
		cursor: pointer;
	}
	.dropped button:active {
		background: var(--surface-inverse);
		color: var(--text-inverse);
	}
	.dim {
		position: fixed;
		inset: 0;
		z-index: 15;
		background: #000;
		pointer-events: none;
	}
	.missing {
		width: 100vw;
		height: 100dvh;
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		gap: 12px;
		padding: 24px;
		text-align: center;
	}
	.mt {
		font: 500 16px var(--font-mono);
	}
	.md {
		font: 400 13px var(--font-mono);
		color: var(--text-2);
	}
	.missing a {
		margin-top: 18px;
		display: flex;
		align-items: center;
		height: 56px;
		padding: 0 32px;
		border: 1px solid var(--line-2);
		color: var(--text-1);
		font: 500 15px var(--font-mono);
		text-decoration: none;
	}
	.switched {
		position: fixed;
		left: 0;
		right: 0;
		top: 0;
		z-index: 19;
		min-height: 60px;
		display: flex;
		flex-direction: column;
		justify-content: center;
		gap: 4px;
		padding: 10px 18px;
		background: var(--surface-panel);
		border-bottom: var(--hairline);
		color: var(--text-1);
		pointer-events: none;
	}
	.switched.under {
		top: 64px;
	}
	.sw-main {
		font: 500 14px/1.3 var(--font-mono);
	}
	.sw-main.miss {
		color: var(--accent);
	}
	.sw-detail {
		font: 400 12px/1.3 var(--font-mono);
		color: var(--text-2);
	}
	.switched .short {
		display: none;
	}
	@media (max-width: 599px) {
		.switched {
			padding: 10px 16px;
		}
		.switched .long {
			display: none;
		}
		.switched .short {
			display: inline;
		}
	}
</style>

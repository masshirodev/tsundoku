<script lang="ts">
	import { END_PAGE_CONTROLS, endSheetOpen, holdWheelForEndSheet } from '$lib/reader/library-row';
	import { leave } from '$lib/motion';
	import { readLocal, writeLocal } from '$lib/settings/local';
	import type { Json } from '$lib/settings/catalog';
	import { onMount, tick, untrack } from 'svelte';
	import { SvelteSet } from 'svelte/reactivity';
	import { afterNavigate, beforeNavigate, replaceState } from '$app/navigation';
	import { forgetReaderMove, leavingReader, readerMovedTo } from '$lib/reader/leaving';
	import { keepHistoryUrl } from '$lib/reader/history';
	import { resolve } from '$app/paths';
	import { page as appPage } from '$app/state';
	import type { PageData } from './$types';
	import { offline } from '$lib/offline.svelte';
	import { cacheBook } from '$lib/cache/device';
	import { MemberUnavailable } from '$lib/epub/remote';
	import { closeReading, flushPending, postReading } from '$lib/cache/pending';
	import { entryDocs } from '$lib/epub/epub';
	import {
		HOLD_TURN_MS,
		atPageEnd,
		barPlace,
		flatten,
		bookLocale,
		joinSpans,
		ordered,
		quoteParts,
		reanchor,
		quoteSheetHead,
		quoteSheetLine,
		wordAround,
		type AnchorChange,
		type Colour,
		type Flat,
		type KeptQuote,
		type QuoteBody,
		type TextSpan
	} from '$lib/library/highlights';
	import {
		MARK_SELECTOR,
		blockWords,
		cellAround,
		copyText,
		onRect,
		paintSpan,
		shiftWord,
		unpaint,
		type BlockWords
	} from '$lib/reader/text-marks';
	import {
		carriedBy,
		isQuoteKey,
		onQueueChange,
		queueCovering,
		queueHighlight,
		quoteKey,
		refusedDetail,
		refusedHighlights,
		reviseHighlight,
		supersedeHighlight,
		takeBackHighlight,
		waitingHighlights,
		dismissRefused,
		type CoveredHighlight,
		type NewHighlight,
		type QueuedHighlight
	} from '$lib/cache/pending-highlights';
	import { PHONE_W, type Placement } from '$lib/japanese/panel';
	import { flushLookups } from '$lib/japanese/lookups';
	import LookupPanel from '$lib/components/lookup/LookupPanel.svelte';
	import { packFor } from '$lib/languages';
	import {
		CURSOR_IDLE_MS,
		CURSOR_KEY,
		IDLE_CAPS,
		ProgressClock,
		TEXT_EDGE,
		TURN_EASE,
		TURN_MS,
		WheelTurn,
		dragGive,
		dragStarts,
		forwardBy,
		hoverAction,
		swipeAction,
		tapAction,
		wheelForward
	} from '$lib/reader/reader';
	import { BookFailure, bookUrl, openBook, type OpenBook } from '$lib/reader/book';
	import { OnePointer } from '$lib/reader/pointer';
	import { focusScope, registerBack } from '$lib/focus';
	import { MediaQuery } from 'svelte/reactivity';
	import { TV } from '$lib/device.svelte';
	import {
		chapterBlocks,
		charsAfter,
		positionAt,
		rectOf,
		type Chapter,
		type TextPosition
	} from '$lib/reader/text-dom';
	import {
		DEFAULT_SETTINGS,
		aboutMinutes,
		addReading,
		bookFraction,
		fontOf,
		frame,
		loadReadingFonts,
		minutesLeft,
		settingsLabel,
		textMetaLine,
		textMode,
		textPageLabel,
		textSettings,
		type Layout,
		type Speed,
		type TextDirection,
		type TextSettings,
		type TextWidth,
		DEFAULT_WIDTH,
		WIDTH_KEY,
		formatAt,
		parseAt,
		widthFor,
		widthKeyOf
	} from '$lib/reader/text';
	import { bandTitle, leadLines } from '$lib/reader/start-band';
	import EntryList from '../../series/[id]/EntryList.svelte';
	import TextSelection from './TextSelection.svelte';
	import QuoteSheet from './QuoteSheet.svelte';
	import TextChrome from './TextChrome.svelte';
	import TextSheet from './TextSheet.svelte';
	import TextScreen from './TextScreen.svelte';
	import EndPage from './EndPage.svelte';
	import ImageView from './ImageView.svelte';
	import WideView from './WideView.svelte';

	/**
	 * The text reader (doc/TEXT-READER.md). The text is the
	 * interface: nothing is on screen but the page and a 2px progress line
	 * until a tap in a margin, or for now anywhere in the text, asks for the
	 * controls. The first chapter opens file by file while the whole book
	 * downloads behind it (src/lib/reader/book.ts); moving between chapters
	 * happens here, without a page load.
	 */
	let { data }: { data: Extract<PageData, { text: true }> } = $props();

	const series = $derived(data.series);
	const entries = $derived(series.entries);
	const chapters = $derived(entries.filter((e) => !e.matter));
	// Web-novel compilations space their paragraphs; books indent them.
	const webNovel = $derived(chapters.length >= 100);

	// ---- settings: the device's, kept in this browser -----------------------------------
	// Through settings/local.ts, which stamps each change for the workstation's
	// copy of this device's settings (doc/SETTINGS.md, "Devices").
	const KEY = 'tsundoku.text.';
	const keyOf = (name: string) => (name.includes('.') ? name : KEY + name);
	const stored = <T,>(name: string, fallback: T): T => readLocal(keyOf(name), fallback);
	const store = (name: string, value: Json) => writeLocal(keyOf(name), value);
	let settings = $state<TextSettings>({ ...DEFAULT_SETTINGS });
	let dim = $state(0);
	let speed = $state<Speed>({ chars: 0, ms: 0 });
	// svelte-ignore state_referenced_locally
	let layout = $state<Layout>(data.layout);
	// svelte-ignore state_referenced_locally
	let seriesLayout = $state<Layout>(data.layout);
	/**
	 * Which way PAGED turns a horizontal book: this session's, until
	 * REMEMBER makes it the series', as LAYOUT is and as the image reader's MODE is.
	 */
	// svelte-ignore state_referenced_locally
	let direction = $state<TextDirection>(data.textDirection);
	// svelte-ignore state_referenced_locally
	let seriesDirection = $state<TextDirection>(data.textDirection);
	let sw = $state(800);
	let sh = $state(1280);
	onMount(() => {
		// A FONT this build doesn't know (a newer build's) reads as the default.
		settings = textSettings(stored<Partial<TextSettings>>('settings', {}));
		// DIM is shared with the image reader: it's about the room, not the book.
		dim = stored('tsundoku.reader.dim', 0);
		speed = stored('speed', { chars: 0, ms: 0 });
		// The cursor's idle hide is off unless asked for, and shared with
		// the image reader and the player.
		cursorOn = stored<boolean>(CURSOR_KEY, false);
		const size = () => {
			sw = innerWidth;
			sh = innerHeight;
		};
		size();
		addEventListener('resize', size);
		return () => removeEventListener('resize', size);
	});
	function setSettings(p: Partial<TextSettings>) {
		settings = { ...settings, ...p };
		store('settings', settings);
	}
	function setDim(d: number) {
		dim = d;
		store('tsundoku.reader.dim', d);
	}
	/**
	 * WIDTH: the series' own, kept in this browser beside the device's
	 * default, which is the width last chosen here, so a new series opens at it
	 * and a series once set keeps its own. Read in the browser, as the rest of
	 * the device's settings are (the server's first paint is 100%, the column
	 * before WIDTH), and again if this reader is handed another series.
	 */
	let width = $state<TextWidth>(DEFAULT_WIDTH);
	$effect(() => {
		const id = series.id;
		untrack(() => (width = widthFor(stored(widthKeyOf(id), null), stored(WIDTH_KEY, null))));
	});
	function setWidth(w: TextWidth) {
		width = w;
		store(widthKeyOf(series.id), w);
		store(WIDTH_KEY, w);
	}

	// ---- the book ----------------------------------------------------------------------------
	let book = $state<OpenBook | null>(null);
	/** The file `book` is: a novel grouped from several EPUBs has one per volume. */
	let bookFile = $state<string | null>(null);
	let failure = $state<BookFailure | null>(null);
	let downloaded = $state(0);
	const volumes = $derived(Object.keys(data.versions).length);
	/** The URL names the file only for a series of volumes: a single book keeps its old URL. */
	const fileParam = (file: string) => (volumes > 1 ? file : undefined);
	const versionOf = (file: string) => data.versions[file] ?? null;
	/** "1 EPUB · 3.1 MB" while a volume opens: its size, from its version. */
	const bytesOf = (file: string | undefined) => {
		const v = file ? versionOf(file) : null;
		return v && /^\d+-/.test(v) ? Number(v.split('-')[0]) : 0;
	};
	/** Open the volume `file`, the one on screen until it's ready. False when it didn't open. */
	async function openFile(file: string): Promise<boolean> {
		failure = null;
		if (bookFile === file && book) return true;
		const version = versionOf(file);
		if (!version) {
			failure = new BookFailure('missing', 'THE FILE IS NOT THERE');
			return false;
		}
		downloaded = 0;
		try {
			book = await openBook(series.id, version, (f) => (downloaded = f), fileParam(file));
			bookFile = file;
			return true;
		} catch (e) {
			failure =
				e instanceof BookFailure
					? e
					: file.startsWith('online:')
						? // Read from its source, which didn't send it (doc/READING-ONLINE.md, "Novels online").
							new BookFailure('online', 'THE SOURCE DID NOT SEND THE CHAPTER')
						: new BookFailure('broken', 'THE PACKAGE WOULD NOT PARSE');
			return false;
		}
	}
	async function load() {
		const e = entries[index];
		// A chapter of a novel downloaded so far has no file yet (doc/NOVELS.md).
		if (e && !e.available)
			failure = new BookFailure('undownloaded', `${short(e)} IS NOT DOWNLOADED`);
		else if (e) await openFile(e.file);
	}
	onMount(() => {
		void load();
	});

	const vertical = $derived(book?.vertical ?? false);
	// SCROLL is one column whatever COLUMNS says: WIDTH's share is of that one.
	const f = $derived(
		frame(sw, sh, layout === 'paged' ? settings : { ...settings, columns: false }, vertical, width)
	);
	const mode = $derived(textMode(layout, vertical, direction));
	/**
	 * The page reads right to left: vertical Japanese always, a horizontal book
	 * in PAGED when its DIRECTION is R→L. The controls mirror for both
	 * (TextChrome's `rtl`), and the band's arrow points the way on.
	 */
	const rtl = $derived(vertical || mode === 'rtl');
	/** A horizontal book turning R→L: its columns run right to left (`.flow.rtl`). */
	const flowRtl = $derived(!vertical && mode === 'rtl');
	const landscape = $derived(sw > sh);
	/**
	 * One page to the next. Horizontal text is columns side by side; vertical
	 * text is columns too, but a vertical-rl multicol fragments along its width
	 * and stacks the overflow downward, so its pages are a column each, one
	 * below the next, and a line is never cut at the edge.
	 */
	const step = $derived(vertical ? f.h + f.gap : f.w + f.gap);

	// ---- the chapter on screen ------------------------------------------------------------------
	// svelte-ignore state_referenced_locally
	let index = $state(data.entry.index);
	const entry = $derived(entries[index]);
	const chapterNo = $derived(entry && !entry.matter ? chapters.indexOf(entry) + 1 : null);
	const nextEntry = $derived(entries[index + 1] ?? null);
	const prevEntry = $derived(entries[index - 1] ?? null);
	/**
	 * A novel downloaded so far (doc/NOVELS.md, "Downloading"): reading stops
	 * at a chapter not downloaded, as at the end of the book, and says which.
	 */
	const nextReadable = $derived(nextEntry?.available ? nextEntry : null);
	const prevReadable = $derived(prevEntry?.available ? prevEntry : null);
	/** Chapters up to the one on screen: where END · LAST AVAILABLE says reading got to. */
	const reached = $derived(chapters.filter((c) => entries.indexOf(c) <= index).length);

	let chapter = $state<Chapter | null>(null);
	let nextChapter = $state<Chapter | null>(null);
	let pos = $state<TextPosition>({ block: 0, offset: 0 });
	/**
	 * Scroll: `pos` is read 250 ms after the reader stops (`onscroll`), so
	 * while they scroll it is where they were, not where they are. A relayout
	 * then (a face arriving, an illustration loading) must not take them back
	 * there: `ownTop` is the scrollTop the reader last put itself at, and a
	 * scroll away from it is the reader's, which `readerMoved` holds until
	 * `pos` is read again.
	 */
	let ownTop = 0;
	let readerMoved = false;
	/**
	 * SCROLL: how far below the top of the page `pos`'s character stood when
	 * the place was read. A relayout puts it back there. Read as the
	 * line crossing the top margin, the character stood up to a line above that
	 * margin, and putting it on the margin moved the reader a line on every
	 * relayout after a scroll. Null: the margin, as a place opened from the URL
	 * or the server has no finer offset than its character.
	 */
	let posY: number | null = null;
	/**
	 * PAGED: the reader is on a chapter's last page and it is the band
	 * alone. That page has no character, so `pos` stands for the one before it,
	 * which is on the page before; a relayout keeps the reader on the band's
	 * page instead of taking it a page back.
	 */
	let onBand = false;
	/**
	 * PAGED: the reader is on a chapter's first page and it is the start band
	 * alone, as it is when the chapter opens on a full-page
	 * illustration, which the band leaves no room for. That page has no
	 * character either, and `pos` (the chapter's first) is on the page after,
	 * so a relayout keeps the reader on the band's page, as `onBand` does at
	 * the other end.
	 */
	let onLead = false;
	let page = $state(0);
	/**
	 * Counts the reader's own moves (`go`, `openChapter`), so a slide can tell
	 * whether something newer moved it while it slid. A relayout is not
	 * a move and doesn't count.
	 */
	let moves = 0;
	let pages = $state(1);
	let atEnd = $state(false);
	let scrollFraction = $state(0);

	let pageEl = $state<HTMLElement | null>(null);
	let flowEl = $state<HTMLElement | null>(null);
	let blocksEl = $state<HTMLElement | null>(null);
	let nextEl = $state<HTMLElement | null>(null);
	/** SCROLL: what a crossing keeps of the chapter before; never the chapter. */
	let keptEl = $state<HTMLElement | null>(null);

	const short = (e: (typeof entries)[number] | null | undefined) =>
		!e ? '' : e.matter ? e.label.toUpperCase() : `CH. ${chapters.indexOf(e) + 1}`;

	/** Wrap one- and two-digit numbers so a vertical line sets them upright (tate-chū-yoko). */
	function tateChuYoko(root: HTMLElement) {
		const walk = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
		const hits: Text[] = [];
		for (let t = walk.nextNode(); t; t = walk.nextNode())
			if (/(^|\D)\d{1,2}(?!\d)/.test(t.textContent ?? '')) hits.push(t as Text);
		for (const t of hits) {
			const parts = (t.textContent ?? '').split(/(?<!\d)(\d{1,2})(?!\d)/);
			const frag = document.createDocumentFragment();
			parts.forEach((p, i) => {
				if (i % 2 === 1) {
					const s = document.createElement('span');
					s.className = 'tcy';
					s.textContent = p;
					frag.append(s);
				} else if (p) frag.append(p);
			});
			t.replaceWith(frag);
		}
	}

	/** Label the wide blocks once laid out: how much is hidden, and OPEN when anything is. */
	function labelWide(root: HTMLElement) {
		for (const box of root.querySelectorAll<HTMLElement>('.wide')) labelOne(box);
	}

	// A block measured before its column had its final width would never
	// offer OPEN. The browser says when each one's size settles or changes, so
	// every wide block is labelled from its real layout, whenever that is.
	let wideObserver: ResizeObserver | null = null;
	onMount(() => {
		wideObserver = new ResizeObserver((entries) => {
			for (const e of entries) {
				const box = (e.target as HTMLElement).closest<HTMLElement>('.wide');
				if (box) labelOne(box);
			}
		});
		return () => wideObserver?.disconnect();
	});
	function watchWide(root: HTMLElement | null) {
		if (!root || !wideObserver) return;
		for (const body of root.querySelectorAll<HTMLElement>('.wide .wide-body')) {
			wideObserver.observe(body);
			if (body.firstElementChild) wideObserver.observe(body.firstElementChild);
		}
	}

	/** A wide block's label as it reads: what it is, and how much of it is hidden. */
	const wideLabel = (box: Element) => {
		const label = box.querySelector<HTMLElement>('.wlabel');
		return [label?.textContent, label?.dataset.shown].filter(Boolean).join(' ');
	};

	function labelOne(box: HTMLElement) {
		const body = box.querySelector<HTMLElement>('.wide-body');
		const inner = body?.firstElementChild as HTMLElement | null;
		const label = box.querySelector<HTMLElement>('.wlabel');
		if (!body || !inner || !label) return;
		const cut = inner.scrollWidth > body.clientWidth + 1;
		box.classList.toggle('cut', cut);
		if (box.classList.contains('code')) {
			const cols = Math.max(...(inner.textContent ?? '').split('\n').map((l) => l.length));
			const shown = Math.floor((body.clientWidth - 28) / (inner.scrollWidth / Math.max(1, cols)));
			label.dataset.shown = cut ? `· ${cols} COLUMNS, ${shown} SHOWN` : '';
		} else {
			label.dataset.shown = cut ? `· ${inner.scrollWidth}PX, ${body.clientWidth} SHOWN` : '';
		}
	}

	/** Where the first character on the page is now. */
	function positionOnPage(): TextPosition | null {
		if (!pageEl) return null;
		const box = pageEl.getBoundingClientRect();
		if (layout === 'scroll') {
			// The first line of text on screen, not the first thing hit, which
			// on an illustration is the figure's start, often a screen higher: a
			// reload or relayout would go back up to it.
			// A screen with no text on it at all keeps the figure.
			let figure: TextPosition | null = null;
			for (let y = box.top + f.y; y < box.bottom; y += 12) {
				const p = positionAt(box.left + f.x + 4, y);
				if (!p) continue;
				const r = flowEl ? rectOf(flowEl, p) : null;
				// A character's box is a line high; a block without text answers its whole box.
				if (r && r.height < f.fontSize * 3 && r.bottom > box.top && r.top < box.bottom) return p;
				figure ??= p;
			}
			return figure;
		}
		// The caret snaps to the nearest text where a point has none, so on a
		// page that is the band alone it names a character pages back: only a
		// character on this page counts.
		const here = (p: TextPosition | null) => {
			const r = p && flowEl ? rectOf(flowEl, p) : null;
			if (!r) return false;
			const cx = r.left + r.width / 2;
			const cy = r.top + r.height / 2;
			return cx >= box.left && cx <= box.right && cy >= box.top && cy <= box.bottom;
		};
		if (vertical) {
			for (let x = box.right - 4; x > box.left; x -= 12)
				for (const y of [box.top + 6, box.top + f.fontSize * 2]) {
					const p = positionAt(x, y);
					if (here(p)) return p;
				}
			return null;
		}
		const colW = f.cols > 1 ? (f.w - f.gap) / 2 : f.w;
		// The page's first column: the left one, or in R->L the right one.
		const first = flowRtl ? box.right - colW : box.left;
		for (let y = box.top + 4; y < box.bottom; y += 12)
			for (const x of [first + 4, first + colW / 2]) {
				const p = positionAt(x, y);
				if (here(p)) return p;
			}
		return null;
	}

	/** The page a position is on, in the current layout. */
	function pageOf(p: TextPosition): number {
		if (!flowEl) return 0;
		const r = rectOf(flowEl, p);
		if (!r) return 0;
		const box = flowEl.getBoundingClientRect();
		const n = vertical
			? Math.floor((r.top - box.top + 1) / step)
			: flowRtl
				? Math.floor((box.right - r.right + 1) / step)
				: Math.floor((r.left - box.left + 1) / step);
		return Math.max(0, Math.min(pages - 1, n));
	}

	function measure() {
		if (!flowEl) return;
		if (layout === 'scroll') {
			pages = 1;
			return;
		}
		pages = vertical
			? Math.max(1, Math.round((flowEl.scrollHeight + f.gap) / step))
			: Math.max(1, Math.round((flowEl.scrollWidth + f.gap) / step));
	}

	/** Lay the chapter out again and go back to the same character. */
	async function relayout() {
		await tick();
		if (!flowEl || !chapter) return;
		if (blocksEl) labelWide(blocksEl);
		measure();
		if (layout === 'scroll') {
			// Mid-scroll, the reader's own scroll is the place: `pos` is stale.
			if (readerMoved || !pageEl) return;
			const r = rectOf(flowEl, pos);
			if (r) pageEl.scrollTop += r.top - pageEl.getBoundingClientRect().top - (posY ?? f.y);
			ownTop = pageEl.scrollTop;
		} else {
			page = onBand ? pages - 1 : onLead ? 0 : pageOf(pos);
		}
		placeSelection();
	}

	/**
	 * An entry's documents, from the book it lives in: among a series of
	 * volumes, an entry runs up to the next entry of its own file.
	 */
	function docsOf(b: OpenBook, i: number) {
		const same = entries.filter((e) => e.file === entries[i].file);
		return entryDocs(
			b.pkg.spine,
			same.map((e) => e.locator),
			same.indexOf(entries[i])
		);
	}

	/** The chapter a move into another volume is opening, so RETRY opens it again. */
	let switching: { i: number; at: 'start' | 'end' | TextPosition } | null = null;
	function retry() {
		if (switching) void openChapter(switching.i, switching.at);
		else void load();
	}

	/**
	 * `y`: in SCROLL, how far below the top the character's line stood when its
	 * place was kept in the URL (`?at=b.o.y`). Null opens it on the top
	 * margin, as a place from the server or an older link does.
	 */
	async function openChapter(
		i: number,
		at: 'start' | 'end' | TextPosition,
		y: number | null = null,
		kept: Node[] = []
	) {
		moves++;
		if (!book || !entries[i]) return;
		if (entries[i].file !== bookFile) {
			// Into another volume: its book downloads once, the OPENING screen over it.
			switching = { i, at };
			chapter = null;
			if (!(await openFile(entries[i].file)) || !book) return;
		}
		switching = null;
		clearSelection();
		let ch: Awaited<ReturnType<typeof chapterBlocks>>;
		try {
			ch = await chapterBlocks(book.zip, docsOf(book, i), book.images);
		} catch (e) {
			// Offline, and this chapter isn't one kept on the tablet: RETRY once it's back.
			switching = { i, at };
			chapter = null;
			failure =
				e instanceof MemberUnavailable
					? new BookFailure('offline', 'THIS CHAPTER IS NOT ON THE TABLET')
					: new BookFailure('broken', 'THE CHAPTER WOULD NOT READ');
			return;
		}
		// A saved place the chapter no longer has (its text changed, or the place
		// is from another book's numbering): the top, rather than a block nothing
		// answers. Here because only the chapter knows how long it is;
		// parseAt reads a URL and has no chapter to ask.
		if (typeof at === 'object' && !ch.blocks[at.block]) at = 'start';
		index = i;
		atEnd = false;
		chapter = ch;
		nextChapter = null;
		// Nothing of the last chapter's may be read against this one's numbers.
		quotes = [];
		goneHere.clear();
		openId = null;
		// The blocks container is empty as far as Svelte knows: it only ever holds
		// the book's text, rebuilt by text-dom.ts, which Svelte never renders.
		// eslint-disable-next-line svelte/no-dom-manipulating
		blocksEl?.replaceChildren(...ch.blocks);
		// Every way in but a crossing empties it: only a crossing has an end above it.
		// eslint-disable-next-line svelte/no-dom-manipulating -- as blocksEl, above
		keptEl?.replaceChildren(...kept);
		if (vertical && blocksEl) tateChuYoko(blocksEl);
		watchWide(blocksEl);
		readWords(ch);
		void loadMarks(i);
		finished = false;
		page = 0;
		if (pageEl) pageEl.scrollTop = 0;
		ownTop = 0;
		readerMoved = false;
		// Kept on screen whatever the URL says: no higher than a line above the
		// top, no lower than a line above the bottom.
		const line = f.fontSize * f.lineHeight;
		posY =
			y !== null && layout === 'scroll' && typeof at === 'object'
				? Math.max(-line, Math.min(sh - line, y))
				: null;
		onBand = false;
		// The chapter's first character is its start, the band before it:
		// 'start' and that place open alike, and the band's own page comes as
		// that place, its URL keeping that character. SCROLL's `?at=0.0.<y>`
		// keeps its line's height instead.
		const first = typeof at === 'object' && at.block === 0 && at.offset === 0;
		// Opened at its start, the chapter opens on its first page, the band's.
		onLead = layout === 'paged' && (at === 'start' || first);
		pos = at === 'start' || at === 'end' ? { block: 0, offset: 0 } : at;
		await relayout();
		if ((at === 'start' || (first && y === null)) && layout === 'scroll' && pageEl && flowEl) {
			// SCROLL opens at the top, the band above the first line, and
			// the first line is kept at the height it stands at under the band:
			// on the margin, a relayout (a face arriving) scrolled the band away.
			pageEl.scrollTop = 0;
			ownTop = 0;
			const r = rectOf(flowEl, pos);
			posY = r ? r.top - pageEl.getBoundingClientRect().top : null;
		}
		if (at === 'end') {
			page = pages - 1;
			// Read once the flow has moved there: read before, it was the
			// chapter's first character, and the next relayout (a font arriving)
			// took the reader back from the last page.
			await tick();
			// A last page that is the band alone has no character to read: the
			// chapter's last one stands for it, so a relayout keeps the reader at
			// the end rather than taking it back to the start.
			const last = ch.blocks.length - 1;
			const here = positionOnPage();
			// And the reader is on the band's page, which that character is not.
			onBand = !here && layout === 'paged';
			pos =
				here ??
				(last >= 0
					? { block: last, offset: Math.max(0, (ch.blocks[last].textContent ?? '').length - 1) }
					: pos);
		}
		clock.resume(Date.now());
		void send('open');
		keepBook();
		// The chapters either side, ready in memory: turning into one never waits.
		for (const j of [i - 1, i + 1])
			if (entries[j]?.file === bookFile)
				for (const d of docsOf(book, j)) void book.zip.bytesOf(d.href).catch(() => undefined);
		if (layout === 'scroll') void loadNext();
	}

	/** Scroll: the next chapter is already below this one, so reading carries on. */
	async function loadNext() {
		// The next volume is another download: it opens when reading reaches it,
		// its start being the room drawn below the band, which crosses the
		// middle of the screen as a chapter's start does (`onscroll`).
		if (!book || !nextReadable || layout !== 'scroll' || nextReadable.file !== bookFile) return;
		try {
			nextChapter = await chapterBlocks(book.zip, docsOf(book, index + 1), book.images);
		} catch {
			// Offline and not kept: the band says so, and reading stops at it.
			return;
		}
		await tick();
		// eslint-disable-next-line svelte/no-dom-manipulating -- as blocksEl, above
		nextEl?.replaceChildren(...nextChapter.blocks);
		// Its blocks are numbered from 0 too: only the current chapter answers positions.
		for (const b of nextChapter.blocks) delete b.dataset.b;
		// Its highlights are ready for the crossing, so they don't arrive after the text.
		void fetchQuotes(nextReadable.id).then((q) => quotesOf.set(nextReadable.id, q));
	}

	// Once only: moving into another volume empties `chapter` too, while its book opens.
	let started = false;
	// The first chapter, once the book is open: where the URL, or the server, says.
	$effect(() => {
		if (!book || chapter || !blocksEl || started) return;
		started = true;
		untrack(() => {
			const at = appPage.url.searchParams.get('at');
			const p = appPage.url.searchParams.get('p');
			// A place in the URL wins, `?at=0.0` included; no `?at=` (every link into
			// a chapter goes without one) is the server's saved place below.
			const place = parseAt(at);
			const start: 'start' | 'end' | TextPosition =
				p === 'last'
					? 'end'
					: place
						? { block: place.block, offset: place.offset }
						: data.entry.readAt === null && data.entry.lastPosition !== null
							? { block: data.entry.lastPosition, offset: data.entry.lastOffset ?? 0 }
							: 'start';
			void openChapter(data.entry.index, start, p === 'last' ? null : (place?.y ?? null));
		});
	});

	// A lazy face is declared once it is chosen; its file then arrives on
	// first use, and `loadingdone` below lays the pages out again for it.
	$effect(() => {
		if (fontOf(settings.font).lazy) void loadReadingFonts();
	});

	// Anything that moves text around lays it out again, keeping the character.
	$effect(() => {
		void f;
		void layout;
		void flowRtl;
		void settings.justify;
		void settings.font;
		void settings.furigana;
		untrack(() => void relayout());
	});
	onMount(() => {
		void document.fonts?.ready.then(() => relayout());
		// An illustration that arrives late changes the pages after it.
		const loaded = () => void relayout();
		addEventListener('load', loaded, true);
		// So does a face: `ready` above has usually settled before the book's
		// text asks for its font, and the pages counted before the font
		// arrived left the last one (the band's, when the text fills the page
		// before it) out of reach of a turn.
		document.fonts?.addEventListener('loadingdone', loaded);
		return () => {
			removeEventListener('load', loaded, true);
			document.fonts?.removeEventListener('loadingdone', loaded);
		};
	});

	// ---- turning ----------------------------------------------------------------------------------
	let lastTurn = Date.now();
	let lastChars = 0;
	function noteSpeed() {
		if (!chapter) return;
		const left = charsAfter(chapter, pos);
		const now = Date.now();
		if (lastChars > left) {
			speed = addReading(speed, lastChars - left, now - lastTurn);
			store('speed', speed);
		}
		lastChars = left;
		lastTurn = now;
	}

	async function go(to: number) {
		moves++;
		// A slide in flight is the old place's: the page shown is this one.
		sliding = false;
		drag = 0;
		atEnd = false;
		page = Math.max(0, Math.min(pages - 1, to));
		await tick();
		// Wide blocks are measured again as they come into view: one measured
		// before its column had a width would otherwise never offer OPEN.
		if (blocksEl) labelWide(blocksEl);
		const here = positionOnPage();
		// The band's page alone has no character: `pos` stays the one before,
		// and a relayout keeps the reader here.
		onBand = !here && layout === 'paged' && page === pages - 1;
		// And the start band's page alone, at the other end, which stands
		// for the chapter's first character, as it does when the chapter opens
		// there: a scrub onto it from pages on would otherwise keep, and save,
		// the place it came from.
		onLead = !here && layout === 'paged' && page === 0;
		posY = null;
		pos = here ?? (onLead ? { block: 0, offset: 0 } : pos);
		noteSpeed();
		if (page >= pages - 1) markFinished();
	}

	function next() {
		if (layout === 'scroll' || !chapter) return;
		if (atEnd) return;
		if (page < pages - 1) return void go(page + 1);
		if (nextReadable) {
			markFinished();
			void openChapter(index + 1, 'start');
		} else {
			markFinished();
			atEnd = true;
		}
	}

	function prev() {
		if (atEnd) {
			atEnd = false;
			return;
		}
		if (layout === 'scroll') return;
		if (page > 0) return void go(page - 1);
		if (prevReadable) void openChapter(index - 1, 'end');
	}

	// ---- the slide (doc/TEXT-READER.md, "Turning") ------------------------------------
	// A paged turn slides and a drag follows the finger, as a manga's page does
	// (doc/READER.md, "Turning pages"), on the image reader's numbers
	// (src/lib/reader/reader.ts). The chapter is one CSS-columns flow, so the
	// page either side is already laid out beside this one: a turn is a
	// transition on the flow's transform and nothing else, and nothing lays the
	// columns out again while it moves.
	/**
	 * The axis the pages follow each other along, and which way. Horizontal
	 * text's next page lies to the right (x, +1). Vertical Japanese's lies below
	 * (y, +1), so its turn translates up while the finger, as everywhere in an
	 * R->L book, pulls it in by dragging right (`forwardBy`). A horizontal R->L
	 * book is x with -1: its columns run right to left, so the next page
	 * lies to the left. This pair is the only place that knows.
	 */
	const pageAxis = $derived<'X' | 'Y'>(vertical ? 'Y' : 'X');
	const pageSign = $derived<1 | -1>(flowRtl ? -1 : 1);
	/** How far the flow is moved past `page`, in px towards the next page: a drag, or where a slide is going. */
	let drag = $state(0);
	/** The flow's transform is transitioning (the CSS class). */
	let sliding = $state(false);
	/** A turn is under way (sliding, or opening the chapter it slides into): another one waits for it. */
	let turning = false;
	/** A turn asked for mid-turn: taken as soon as this one lands, so quick taps all count. */
	let queuedTurn: 'next' | 'prev' | null = null;
	let dragging = false;
	const reduceMotion = new MediaQuery('(prefers-reduced-motion: reduce)', false);
	const shift = $derived(-pageSign * (page * step + drag));
	const pause = (ms: number) => new Promise((r) => setTimeout(r, ms));
	const painted = () => new Promise((r) => requestAnimationFrame(() => r(undefined)));

	/** The chapter on screen has another page that way (the end page has none). */
	const pageThat = (dir: 'next' | 'prev') =>
		!atEnd && (dir === 'next' ? page < pages - 1 : page > 0);
	/** That way is a chapter's page: the next chapter's first, or the previous one's last. */
	const chapterThat = (dir: 'next' | 'prev') =>
		!atEnd && (dir === 'next' ? page >= pages - 1 && !!nextReadable : page <= 0 && !!prevReadable);

	/**
	 * Turn, sliding: within the chapter the flow moves one page over and the
	 * page turned to becomes the one read where it stands, so nothing moves at
	 * the end. Into the next chapter its first page slides in from where the
	 * next page lies, and back into the previous one its last page from the
	 * other side. The end page arrives, and leaves, as it always has; reduced
	 * motion turns at once.
	 */
	async function turn(dir: 'next' | 'prev') {
		if (layout === 'scroll' || !chapter) return;
		// A swipe, a key or the wheel turns and clears; HOLD TO TURN carries it on.
		if (!carrying) clearSelection();
		if (turning) {
			queuedTurn = dir;
			return;
		}
		if (reduceMotion.current || (!pageThat(dir) && !chapterThat(dir))) {
			drag = 0;
			return dir === 'next' ? next() : prev();
		}
		turning = true;
		if (pageThat(dir)) {
			// Anything else that moves the reader while it slides (the scrubber,
			// CONTENTS, a chapter opening) is the newer ask, and the turn gives way
			// to it: turning from where that left off went one past it. The
			// move counter says so, not `pos`: a scrub onto the band's page alone
			// leaves `pos` as it was. A relayout moves `page` without counting as
			// a move, so the page after the character being read is still the one
			// to land on.
			const fromMoves = moves;
			const fromIndex = index;
			sliding = true;
			drag = dir === 'next' ? step : -step;
			await pause(TURN_MS);
			sliding = false;
			drag = 0;
			if (moves === fromMoves && index === fromIndex && !atEnd)
				await go(dir === 'next' ? page + 1 : page - 1);
		} else {
			drag = 0;
			if (dir === 'next') markFinished();
			await openChapter(dir === 'next' ? index + 1 : index - 1, dir === 'next' ? 'start' : 'end');
			// Opened (another volume may have failed to): the page starts a step
			// short of where it is read, and slides the rest of the way.
			if (chapter) await slideIn(dir === 'next' ? -step : step);
		}
		turning = false;
		const then = queuedTurn;
		queuedTurn = null;
		if (then) void turn(then);
	}

	async function slideIn(from: number) {
		drag = from;
		await tick();
		// The start has to be a style the browser has resolved, or the move to 0
		// is one change and nothing transitions: a frame callback runs before
		// that frame's styles, so read the computed transform to settle it.
		if (flowEl) void getComputedStyle(flowEl).transform;
		await painted();
		sliding = true;
		drag = 0;
		await pause(TURN_MS);
		sliding = false;
	}

	/** A drag that didn't turn: back into place. */
	async function settleBack() {
		if (reduceMotion.current || drag === 0) {
			drag = 0;
			return;
		}
		turning = true;
		sliding = true;
		drag = 0;
		await pause(TURN_MS);
		sliding = false;
		turning = false;
		const then = queuedTurn;
		queuedTurn = null;
		if (then) void turn(then);
	}

	function jump(i: number) {
		contents = false;
		chrome = false;
		void openChapter(i, 'start');
	}

	// Scroll: where you are, and crossing into the next chapter once its start
	// passes the middle of the screen, with nothing on screen moving.
	let scrolling: ReturnType<typeof setTimeout> | undefined;

	/** The page element is scrolled as far as it goes: a chapter may be shorter than the screen. */
	function scrollAtEnd() {
		return !!pageEl && pageEl.scrollHeight - pageEl.scrollTop - pageEl.clientHeight <= 2;
	}

	/**
	 * Scroll: the end of the last chapter is the end of the series, as it is at
	 * the last page in the paged layouts -- the one way to EndPage, and so to
	 * the Work's next part. A last chapter too short to scroll never
	 * fires `onscroll`, so a wheel or a key at its bottom reaches it too (see
	 * `wheel` and `keydown`).
	 */
	function reachScrollEnd(): boolean {
		if (layout !== 'scroll' || atEnd || nextReadable || !scrollAtEnd()) return false;
		markFinished();
		atEnd = true;
		return true;
	}

	/**
	 * SCROLL: the scrollTop at which the chapter's last line reaches the bottom
	 * of the screen, the 1 of `scrollFraction` and the scrubber's 99. The
	 * blocks' bottom, not their height: the start band and the flow's
	 * padding sit above `.blocks`, so their height alone reached 1 (and
	 * finished the chapter) one band early. `offsetTop` is measured
	 * from `.page`, the blocks' offsetParent (it is the one positioned box
	 * between them; `.flow` is static and untransformed in SCROLL), and does
	 * not move as the page scrolls.
	 */
	function scrollEnd(page: HTMLElement, blocks: HTMLElement | null): number {
		const bottom = blocks ? blocks.offsetTop + blocks.offsetHeight : 1;
		return bottom - page.clientHeight;
	}

	/** SCROLL: how far down the page this chapter starts, past what a crossing kept. */
	const keptHeight = () => keptEl?.offsetHeight ?? 0;

	/**
	 * SCROLL: a screen of this chapter's end and its END band, as copies, to
	 * stand above the next chapter after a crossing, so the line being read stays
	 * where it was. The whole chapter, its start band too, if it is shorter
	 * than that. Copies with no `data-b` or `id`: only the current chapter
	 * answers positions, and `.kept` is inert, so a press or a lookup goes
	 * through it.
	 */
	function keepForCrossing(): Node[] {
		if (!pageEl || !blocksEl || !flowEl) return [];
		const room = pageEl.clientHeight;
		const tail: HTMLElement[] = [];
		let height = 0;
		for (
			let el = blocksEl.lastElementChild as HTMLElement | null;
			el && height < room;
			el = el.previousElementSibling as HTMLElement | null
		) {
			tail.unshift(el);
			height += el.offsetHeight;
		}
		const text = document.createElement('div');
		text.className = 'kept-text';
		for (const el of tail) {
			const copy = el.cloneNode(true) as HTMLElement;
			// A kept copy is no chapter: no highlight is drawn on it, and no selection.
			unpaint(copy, `${MARK_SELECTOR}, .sel`);
			delete copy.dataset.b;
			copy.removeAttribute('id');
			for (const n of copy.querySelectorAll<HTMLElement>('[data-b], [id]')) {
				delete n.dataset.b;
				n.removeAttribute('id');
			}
			text.append(copy);
		}
		const copyOf = (selector: string) =>
			flowEl?.querySelector(`:scope > ${selector}`)?.cloneNode(true) as HTMLElement | undefined;
		const band = copyOf('.sband');
		const start = height < room ? copyOf('.cstart') : undefined;
		return [start, text, band].filter((n): n is HTMLElement => !!n);
	}

	function onscroll() {
		if (!pageEl || layout !== 'scroll') return;
		placeSelection();
		// The end page is over the text: what happens under it is not the reader's.
		if (atEnd) return;
		const kept = keptHeight();
		const max = Math.max(1, scrollEnd(pageEl, blocksEl) - kept);
		// Nothing kept above is this chapter: its progress starts at its own top.
		scrollFraction = Math.max(0, Math.min(1, (pageEl.scrollTop - kept) / max));
		const first = nextEl?.firstElementChild as HTMLElement | null;
		if (first && first.getBoundingClientRect().top < pageEl.clientHeight / 2) {
			const y = first.getBoundingClientRect().top;
			markFinished();
			// Before the blocks are replaced, while they're still the old chapter's. A
			// next volume is an empty room crossed under OPENING: nothing on screen
			// runs on into it, so it opens at its own top, with nothing kept.
			const kept = nextReadable?.file === bookFile ? keepForCrossing() : [];
			void openChapter(index + 1, 'start', null, kept).then(async () => {
				await tick();
				const top = blocksEl?.firstElementChild as HTMLElement | null;
				if (top && pageEl) {
					pageEl.scrollTop += top.getBoundingClientRect().top - y;
					ownTop = pageEl.scrollTop;
					// The first line stays where it was when it crossed: the band above
					// it is the one that was already on screen.
					const r = flowEl ? rectOf(flowEl, pos) : null;
					posY = r ? r.top - pageEl.getBoundingClientRect().top : null;
				}
			});
			return;
		}
		if (Math.abs(pageEl.scrollTop - ownTop) > 1) readerMoved = true;
		clearTimeout(scrolling);
		scrolling = setTimeout(() => {
			pos = positionOnPage() ?? pos;
			onBand = false;
			onLead = false;
			// Where its character stands now, so a relayout leaves it there.
			const r = flowEl && pageEl ? rectOf(flowEl, pos) : null;
			posY = r && pageEl ? r.top - pageEl.getBoundingClientRect().top : null;
			readerMoved = false;
			if (pageEl) ownTop = pageEl.scrollTop;
			noteSpeed();
			if (scrollFraction >= 0.999) markFinished();
			reachScrollEnd();
		}, 250);
	}

	// ---- progress ----------------------------------------------------------------------------------
	const clock = new ProgressClock(Date.now(), IDLE_CAPS.text);
	let saved = $state(true);
	let finished = false;

	async function send(kind: 'open' | 'page' | 'finish' | 'close') {
		// Opened incognito: nothing here is saved, whatever the cookie says
		// later. The hide that ends incognito is a beacon (doc/PRIVACY.md, step
		// 2) and this page outlives it until the app comes back, so a settle or
		// the close on the way out would otherwise be written as ordinary
		// reading with no cookie to stop it.
		if (data.incognito) return;
		if (!entry || !chapter) return;
		const now = Date.now();
		const body = JSON.stringify({
			seriesId: series.id,
			entryId: entry.id,
			kind,
			page: pos.block,
			offset: pos.offset,
			total: Math.max(1, chapter.blocks.length),
			durationMs: kind === 'open' ? 0 : clock.lap(now),
			at: now
		});
		// Kept until the server has it, and on leaving kept for the next
		// start where the server goes with the page (src/lib/cache/pending.ts).
		if (kind === 'close') return closeReading(body, offline.online);
		const res = await postReading(body);
		if (res?.ok) {
			saved = ((await res.json()) as { saved: boolean }).saved;
			void flushPending();
		}
	}

	function markFinished() {
		if (finished) return;
		finished = true;
		void send('finish');
	}

	// A page event once the reader has settled, and the URL kept on the place.
	let settle: ReturnType<typeof setTimeout> | undefined;
	$effect(() => {
		const p = pos;
		const id = entry?.id;
		if (!chapter || id === undefined) return;
		clearTimeout(settle);
		settle = setTimeout(() => {
			// On the way out the window's entry may be the next screen's.
			if (leavingReader()) return;
			void send('page');
			// eslint-disable-next-line svelte/prefer-svelte-reactivity -- a one-off copy, never read reactively
			const url = new URL(appPage.url);
			url.pathname = resolve('/read/[entry]', { entry: String(id) });
			url.search = '';
			// SCROLL keeps the line's height too, so a reload lands on it.
			url.searchParams.set('at', formatAt(p, layout === 'scroll' ? posY : null));
			// eslint-disable-next-line svelte/no-navigation-without-resolve -- the path is resolve()d above
			replaceState(url, {});
			// The chapter may be another than the page was opened at: the guard
			// above must take this path as the reader's own.
			readerMovedTo(url.pathname);
			// And history must name it too, or a popstate back into this entry
			// opens the chapter the reader was opened at.
			keepHistoryUrl();
		}, 800);
		return () => clearTimeout(settle);
	});

	afterNavigate(forgetReaderMove);
	beforeNavigate(({ to }) => {
		if (to?.route.id === '/read/[entry]') return;
		// The close carries the place; a settle still to come would write the
		// reader's URL onto the screen being opened.
		clearTimeout(settle);
		void send('close');
	});

	/**
	 * Keep the book on the tablet once the whole of it has arrived (it
	 * downloads behind the first chapter), never for a hidden series, while
	 * revealed, or incognito.
	 */
	function keepBook() {
		if (!book || !bookFile || series.hidden || data.reveal || data.incognito || !entry) return;
		const version = versionOf(bookFile);
		if (!version) return;
		const file = bookFile;
		const openEntryId = entry.id;
		const seriesId = series.id;
		const entryIds = entries.filter((e) => e.file === file).map((e) => e.id);
		void book.whole.then((bytes) => {
			if (!bytes) return;
			void cacheBook({
				seriesId,
				entryIds,
				openEntryId,
				url: bookUrl(seriesId, version, fileParam(file)),
				bytes,
				version
			});
		});
	}

	// ---- the series' own fields, optimistic ------------------------------------------------------
	// svelte-ignore state_referenced_locally
	let rating = $state<number>(data.series.rating);
	// svelte-ignore state_referenced_locally
	let favourite = $state(data.series.favourite);
	async function action(name: string, form: Record<string, string>) {
		const body = new FormData();
		for (const [k, v] of Object.entries(form)) body.set(k, v);
		await fetch(`${resolve('/series/[id]', { id: String(series.id) })}?/${name}`, {
			method: 'POST',
			body,
			headers: { 'x-sveltekit-action': 'true' }
		}).catch(() => undefined);
	}
	function rate(n: number) {
		rating = n;
		void action('rate', { rating: String(n) });
	}
	function toggleFav() {
		favourite = !favourite;
		void action('favourite', { on: favourite ? '1' : '0' });
	}
	function remember() {
		seriesLayout = layout;
		void action('direction', { direction: layout });
	}
	/** REMEMBER on DIRECTION: the series' from now on, on every device. */
	function rememberDirection() {
		seriesDirection = direction;
		const body = new FormData();
		body.set('direction', direction);
		void fetch(`${resolve('/read/[entry]', { entry: String(data.entry.id) })}?/textDirection`, {
			method: 'POST',
			body,
			headers: { 'x-sveltekit-action': 'true' }
		}).catch(() => undefined);
	}
	// Asked at the end of the book only while unrated, so it never asks twice.
	// svelte-ignore state_referenced_locally
	const askRating = data.series.rating === 0;

	// ---- touch ----------------------------------------------------------------------------------------
	let chrome = $state(false);
	let sheet = $state(false);
	let contents = $state(false);
	let fullImage = $state<{ src: string; alt: string } | null>(null);
	let wide = $state<{ title: string; meta: string; html: string; code: boolean } | null>(null);
	const tvScreen = new MediaQuery(TV, false);
	/** The reader's root, for the scrubber the chrome focuses when a remote brings it up. */
	let readerEl = $state<HTMLElement | null>(null);

	// ---- Japanese: a long press looks a word up (doc/JAPANESE.md, "In a book") -------------
	// A book's page is all text, so a tap can't be the lookup's as it is on a
	// manga page: taps keep turning and showing the controls, and a long press
	// on a word opens the shared panel, in a column away from it.
	/** The pack that reads this book's language, or none (doc/LANGUAGES.md). */
	const lookupPack = $derived(packFor(bookLocale(book?.pkg.language)));
	type Lookup = {
		text: string;
		at: number;
		n: number;
		place: Placement;
		/** Where the paragraph is, for the foot's HIGHLIGHT: its block, and the words before it there. */
		block: number | null;
		base: number;
	};
	let lookup = $state<Lookup | null>(null);
	let press: ReturnType<typeof setTimeout> | undefined;
	/** The long press fired: the finger lifting afterwards isn't a tap. */
	let pressed = false;
	const PRESS_MS = 450;
	$effect(() => {
		if (!lookupPack) return;
		void flushLookups();
		const online = () => void flushLookups();
		addEventListener('online', online);
		return () => removeEventListener('online', online);
	});

	// ---- highlights (doc/TEXT-READER.md, "Highlights") ----------------------------------
	/** What the bar may keep. A browsing record is on no shelf, and incognito makes none. */
	const canKeep = $derived(!data.incognito && !data.record);
	/** Long press and drag select, except on a TV, on the end page and with something over the page. */
	const selectable = $derived(!tvScreen.current && !atEnd && !!chapter && !failure);
	const QUOTES_URL = resolve('/api/highlights/quotes');
	/** A quote on screen; `waiting` is its queue key while it waits on the device. */
	type Shown = KeptQuote & { waiting?: string };
	let quotes = $state<Shown[]>([]);
	/** Rows this chapter has since lost, so a list asked for before that can't bring them back. */
	// eslint-disable-next-line svelte/prefer-svelte-reactivity -- bookkeeping, never drawn
	const goneHere = new Set<number>();
	/** A chapter's quotes fetched ahead of its opening (the first with the page, the next in SCROLL). */
	// eslint-disable-next-line svelte/prefer-svelte-reactivity -- a cache read once per chapter opening
	const quotesOf = new Map<number, KeptQuote[]>();
	// svelte-ignore state_referenced_locally
	quotesOf.set(data.entry.id, data.quotes);

	/** The chapter's words, and the flat text the rules read. Remade as a chapter opens. */
	let words: BlockWords[] = [];
	let flat: Flat | null = null;
	const blockOf = (n: number) => chapter?.blocks[n] ?? null;
	function readWords(ch: Chapter) {
		words = ch.blocks.map(blockWords);
		flat = flatten(words.map((w) => w.words));
	}
	/** A position, in the words the rules compare. */
	const toWords = (s: TextSpan): TextSpan => ({
		block: s.block,
		offset: words[s.block]?.wordsAt(s.offset) ?? s.offset,
		endBlock: s.endBlock,
		endOffset: words[s.endBlock]?.wordsAt(s.endOffset) ?? s.endOffset
	});
	/** And back: a place in the words, as the reader's own position. */
	const toFull = (s: TextSpan): TextSpan => ({
		block: s.block,
		offset: words[s.block]?.fullAt(s.offset) ?? s.offset,
		endBlock: s.endBlock,
		endOffset: (words[s.endBlock]?.fullAt(s.endOffset - 1) ?? s.endOffset - 1) + 1
	});

	const fetchQuotes = (id: number): Promise<KeptQuote[]> =>
		fetch(`${QUOTES_URL}?entry=${id}`)
			.then((r) => (r.ok ? (r.json() as Promise<{ quotes: KeptQuote[] }>) : { quotes: [] }))
			.then((j) => j.quotes)
			.catch(() => []);

	/** Bumped as each chapter opens, so an answer for an older one is dropped. */
	let marksLoad = 0;
	/** The chapter on screen has opened: re-find what it holds, say what moved, and draw. */
	async function loadMarks(i: number) {
		const load = ++marksLoad;
		const id = entries[i].id;
		// Taken before this chapter opened: the page's own load, or SCROLL's prefetch.
		const early = quotesOf.has(id);
		const list = quotesOf.get(id) ?? (await fetchQuotes(id));
		quotesOf.delete(id);
		// A newer chapter opened while this one's were on their way.
		if (load !== marksLoad) return;
		const waiting = (await waitingHighlights()).filter((i) => isQuoteKey(i.key) && i.entry === id);
		if (load !== marksLoad) return;
		// A saved row a press has taken in since this list was asked for: the answer
		// still names it, and drawing it here would stand a second marker over the
		// words the press already covers. `settleQuote` puts it back
		// if the press doesn't take, so nothing needs this copy.
		const joining = new Set([...joinedBy.values()].flat().map((j) => j.id));
		// Likewise a waiting quote a press took in: it stays on the device until the
		// press is kept, and the press is what is drawn over its words.
		const covering = new Set([...joinedWaiting.keys()].flatMap((id) => waitingKeysOf(id)));
		const fresh = anchored(list, id).filter((q) => !goneHere.has(q.id) && !joining.has(q.id));
		// Made while this list was out: `quotes` was emptied as the chapter opened, so all of it is this chapter's.
		const pressed = quotes.filter((q) => !fresh.some((f) => f.id === q.id));
		const drawn = new Set(pressed.map((q) => q.waiting));
		quotes = [
			...fresh,
			...pressed,
			...waiting
				.filter((i) => !drawn.has(i.key) && !covering.has(i.key))
				.map((i): Shown => ({ ...(i.body as KeptQuote), id: nextTemp--, waiting: i.key }))
		];
		drawMarks();
		// A list taken early can predate a quote this browser sent since (another page
		// of the app, or this one from another chapter): its row is not in the list
		// and the device no longer holds it, so it was drawn nowhere. Asked
		// again now that the device has been read, what is new is drawn.
		if (early && offline.online) void redrawNewer(id, load);
	}

	const spanOf = (q: TextSpan) => `${q.block}.${q.offset}-${q.endBlock}.${q.endOffset}`;

	/** Rows the workstation holds for chapter [id] that the page doesn't draw yet. */
	async function redrawNewer(id: number, load: number) {
		const newer = await fetchQuotes(id);
		if (load !== marksLoad) return;
		const have = new Set(quotes.map((q) => q.id));
		const joining = new Set([...joinedBy.values()].flat().map((j) => j.id));
		const fresh = newer.filter((q) => !have.has(q.id) && !goneHere.has(q.id) && !joining.has(q.id));
		if (fresh.length === 0) return;
		const added = anchored(fresh, id);
		// A waiting quote over exactly a row's words is that row: the endpoint answers
		// its POST with it (the `same` branch), so the row is what is drawn.
		const spans = new Set(added.map(spanOf));
		quotes = [...quotes.filter((q) => !(q.waiting && spans.has(spanOf(q)))), ...added];
		drawMarks();
	}

	/** Every quote against the words as they are now; what changed is told, not asked. */
	function anchored(list: KeptQuote[], id: number): KeptQuote[] {
		if (!flat) return list;
		const changes: AnchorChange[] = [];
		const next = list.map((q): KeptQuote => {
			const found = reanchor(flat!, { ...q, ...toWords(q) });
			if (found.state === 'detached') {
				if (q.state !== 'detached') changes.push({ id: q.id, state: 'detached' });
				return { ...q, state: 'detached' };
			}
			const span = toFull(found.span);
			if (!found.moved && q.state === 'ok') return q;
			changes.push({ id: q.id, state: 'ok', ...span });
			return { ...q, ...span, state: 'ok' };
		});
		// Incognito moves nothing; offline, the next open finds the same thing again.
		if (changes.length && !data.incognito && offline.online)
			void fetch(QUOTES_URL, {
				method: 'PUT',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ entry: id, changes })
			}).catch(() => undefined);
		return next;
	}

	function makeMark(q: KeptQuote) {
		const el = document.createElement('span');
		el.className = `mk ${q.colour}`;
		el.dataset.h = String(q.id);
		return el;
	}

	/** The markers, from `quotes`. The selection is painted over them, so it is painted again. */
	function drawMarks() {
		if (!blocksEl) return;
		unpaint(blocksEl, `${MARK_SELECTOR}, .sel`);
		for (const q of quotes) {
			if (q.state !== 'ok') continue;
			const pieces = paintSpan(blockOf, q, () => makeMark(q));
			if (!q.note.trim() || pieces.length === 0) continue;
			// A note's cell after the last word; empty, so a block's text doesn't change.
			const cell = document.createElement('span');
			cell.className = 'nm';
			cell.dataset.h = String(q.id);
			cell.setAttribute('aria-hidden', 'true');
			pieces[pieces.length - 1].after(cell);
		}
		if (selection) paintSelection();
	}

	let selection = $state<TextSpan | null>(null);
	/** Where the bar and the handles stand; null while a selection has no line on this page. */
	let selGeom = $state<{
		bar: { left: number; top: number } | null;
		start: { x: number; y: number; h: number } | null;
		end: { x: number; y: number; h: number } | null;
	} | null>(null);
	let barWidth = 320;
	let handleDragging = $state(false);
	let copied = $state(false);
	let copiedTimer: ReturnType<typeof setTimeout> | undefined;

	function paintSelection() {
		if (!blocksEl || !selection) return;
		unpaint(blocksEl, '.sel');
		paintSpan(blockOf, selection, () => {
			const el = document.createElement('span');
			el.className = 'sel';
			return el;
		});
	}

	function setSelection(span: TextSpan | null) {
		selection = span;
		if (blocksEl) unpaint(blocksEl, '.sel');
		if (span) paintSelection();
		placeSelection();
	}

	function clearSelection() {
		if (!selection && !selGeom) return;
		setSelection(null);
		copied = false;
		stopHold();
	}

	function placeSelection() {
		if (!selection || !blocksEl || !pageEl) {
			selGeom = null;
			return;
		}
		const box = pageEl.getBoundingClientRect();
		const rects = [...blocksEl.querySelectorAll<HTMLElement>('.sel')].flatMap((p) => [
			...p.getClientRects()
		]);
		const here = (r: DOMRect) => {
			const cx = r.left + r.width / 2;
			const cy = r.top + r.height / 2;
			return cx >= box.left && cx <= box.right && cy >= box.top && cy <= box.bottom;
		};
		const shown = rects.filter(here);
		const first = shown[0];
		if (!first) {
			selGeom = { bar: null, start: null, end: null };
			return;
		}
		const a = rects[0];
		const b = rects[rects.length - 1];
		const lineH = (r: DOMRect) => (vertical ? r.width : r.height);
		const at = (r: DOMRect, end: boolean) => ({
			x: vertical ? r.left + r.width / 2 : end ? r.right : r.left,
			y: end ? (vertical ? r.bottom : r.bottom) : r.top,
			h: lineH(r)
		});
		selGeom = {
			bar:
				selecting || handleDragging
					? null
					: barPlace(first, { w: innerWidth, h: innerHeight }, barWidth, vertical),
			start: here(a) ? at(a, false) : null,
			end: here(b) ? at(b, true) : null
		};
	}

	/** The character under the press, or nothing when the press isn't on the words. */
	function onText(x: number, y: number) {
		const p = positionAt(x, y);
		return !!p && !!flowEl && onRect(rectOf(flowEl, p), x, y);
	}

	/** A long press selects the word. */
	function selectWordAt(x: number, y: number) {
		const p = positionAt(x, y);
		const w = p && words[p.block];
		if (!p || !w) return;
		const at = w.wordsAt(p.offset);
		const language = book?.pkg.language || undefined;
		// A table's cells have nothing between them, so a cell is what a word can't leave.
		const cell = chapter ? cellAround(chapter.blocks[p.block], at) : null;
		const word = cell
			? shiftWord(wordAround(w.words.slice(cell.start, cell.end), at - cell.start, language), cell)
			: wordAround(w.words, at, language);
		if (!word) return;
		pressed = true;
		chrome = false;
		setSelection({
			block: p.block,
			offset: w.fullAt(word.start),
			endBlock: p.block,
			endOffset: w.fullAt(word.end - 1) + 1
		});
	}

	// A drag with a mouse, or a handle: the fixed end and where the other is now.
	type DragSelect = { anchor: { block: number; offset: number } };
	let selecting: DragSelect | null = null;
	let lastPoint = { x: 0, y: 0 };

	function extendTo(anchor: DragSelect['anchor'], x: number, y: number) {
		const p = positionAt(x, y);
		if (!p) return;
		const s = ordered(anchor, p);
		if (s.block !== s.endBlock || s.offset !== s.endOffset) setSelection(s);
	}

	// HOLD TO TURN. Paged, a handle or a mouse held at the page's end shows the cue
	// and after 0.6 s the page turns under it and the selection carries on; never
	// into the next chapter, where positions stop. SCROLL just scrolls as the handle
	// nears the bottom.
	let holdCue = $state(false);
	let holdTimer: ReturnType<typeof setTimeout> | undefined;
	let carrying = false;
	let autoScrollFrame = 0;
	let carryAnchor: DragSelect['anchor'] | null = null;
	const AUTOSCROLL_ZONE = 64;
	const AUTOSCROLL_PX = 8;

	function stopHold() {
		clearTimeout(holdTimer);
		holdTimer = undefined;
		holdCue = false;
		if (autoScrollFrame) cancelAnimationFrame(autoScrollFrame);
		autoScrollFrame = 0;
	}

	function holdCheck(anchor: DragSelect['anchor'], forward: boolean) {
		const { x, y } = lastPoint;
		carryAnchor = anchor;
		if (layout === 'scroll') {
			if (!autoScrollFrame) autoScrollFrame = requestAnimationFrame(autoScroll);
			return;
		}
		const atEndOfPage =
			forward &&
			!turning &&
			pageThat('next') &&
			atPageEnd({ x, y }, { w: innerWidth, h: innerHeight }, { rtl, vertical });
		if (!atEndOfPage) {
			clearTimeout(holdTimer);
			holdTimer = undefined;
			holdCue = false;
			return;
		}
		if (holdTimer !== undefined) return;
		holdCue = true;
		holdTimer = setTimeout(async () => {
			holdTimer = undefined;
			holdCue = false;
			carrying = true;
			await turn('next');
			carrying = false;
			// Whatever the finger is over now, the selection reaches the new page: its
			// first character, at least, or it would end on a page no longer on screen.
			const first = positionOnPage();
			const box = pageEl?.getBoundingClientRect();
			const onPage =
				!!box &&
				lastPoint.x >= box.left &&
				lastPoint.x <= box.right &&
				lastPoint.y >= box.top &&
				lastPoint.y <= box.bottom;
			if (onPage && onText(lastPoint.x, lastPoint.y)) extendTo(anchor, lastPoint.x, lastPoint.y);
			else if (first) carryTo(anchor, first);
			if (selecting || handleDragging) holdCheck(anchor, forward);
		}, HOLD_TURN_MS);
	}

	/** A selection held over a turn reaches at least the first word of the page turned to. */
	function carryTo(anchor: DragSelect['anchor'], first: TextPosition) {
		for (let b = first.block; b < words.length; b++) {
			const w = words[b];
			const at = b === first.block ? w.wordsAt(first.offset) : 0;
			const i = at + w.words.slice(at).search(/\S/);
			if (i >= at && w.words.slice(at).search(/\S/) >= 0) {
				setSelection(ordered(anchor, { block: b, offset: w.fullAt(i) + 1 }));
				return;
			}
		}
	}

	function autoScroll() {
		autoScrollFrame = 0;
		if (!pageEl || !carryAnchor || !(selecting || handleDragging)) return;
		const { x, y } = lastPoint;
		const down = y >= innerHeight - AUTOSCROLL_ZONE;
		const up = y <= AUTOSCROLL_ZONE;
		if (!down && !up) return;
		pageEl.scrollTop += down ? AUTOSCROLL_PX : -AUTOSCROLL_PX;
		extendTo(carryAnchor, x, y);
		autoScrollFrame = requestAnimationFrame(autoScroll);
	}

	/** A handle is taken: the other end stays and this one follows the finger. */
	function handleDown(edge: 'start' | 'end', e: PointerEvent) {
		if (!selection) return;
		e.preventDefault();
		const s = selection;
		const anchor =
			edge === 'start'
				? { block: s.endBlock, offset: s.endOffset }
				: { block: s.block, offset: s.offset };
		const id = e.pointerId;
		handleDragging = true;
		lastPoint = { x: e.clientX, y: e.clientY };
		const move = (ev: PointerEvent) => {
			if (ev.pointerId !== id) return;
			lastPoint = { x: ev.clientX, y: ev.clientY };
			extendTo(anchor, ev.clientX, ev.clientY);
			holdCheck(anchor, edge === 'end');
		};
		const done = (ev: PointerEvent) => {
			if (ev.pointerId !== id) return;
			removeEventListener('pointermove', move);
			removeEventListener('pointerup', done);
			removeEventListener('pointercancel', done);
			handleDragging = false;
			stopHold();
			placeSelection();
		};
		addEventListener('pointermove', move);
		addEventListener('pointerup', done);
		addEventListener('pointercancel', done);
		placeSelection();
	}

	// ---- keeping one: HIGHLIGHT, NOTE, H and N ----------------------------------------------
	const COLOUR_KEY = 'tsundoku.text.colour';
	let colour = $state<Colour>('yellow');
	onMount(() => {
		colour = stored<Colour>(COLOUR_KEY, 'yellow');
	});

	let nextTemp = -1;
	/** How a press's trip ended: its row, or that the workstation couldn't be reached. */
	type Sent = { row: KeptQuote | null; unreachable: boolean };
	/** What's kept while its POST is on its way: its id then is its own, its answer the row's. */
	// eslint-disable-next-line svelte/prefer-svelte-reactivity -- bookkeeping, never drawn
	const inFlight = new Map<number, Promise<Sent>>();
	/** A temp's row once it has one, for what outlives the answer: a sheet's draft, a band. */
	// eslint-disable-next-line svelte/prefer-svelte-reactivity -- bookkeeping, never drawn
	const settledAs = new Map<number, number>();
	/** DELETE pressed while its POST was out: that POST's end mustn't bring it back. */
	// eslint-disable-next-line svelte/prefer-svelte-reactivity -- bookkeeping, never drawn
	const deletedInFlight = new Set<number>();
	/** Saved highlights a press took in, put back if the press doesn't take. */
	// eslint-disable-next-line svelte/prefer-svelte-reactivity -- bookkeeping, never drawn
	const joinedBy = new Map<number, Shown[]>();
	/**
	 * Waiting quotes a press took in. A refusal restores only saved rows, and the
	 * device no longer holds these (`supersedeHighlight` removed them), so they
	 * are kept here until the press has an answer.
	 */
	// eslint-disable-next-line svelte/prefer-svelte-reactivity -- bookkeeping, never drawn
	const joinedWaiting = new Map<number, Shown[]>();
	/**
	 * What the device wrote for a temp just before its DELETE: `takeBackHighlight`
	 * clears `remembered` for the item's own key, so the in-flight UNDO's only
	 * copy of what an exact re-press carried is the item the take-back returned.
	 */
	// eslint-disable-next-line svelte/prefer-svelte-reactivity -- bookkeeping, never drawn
	const takenInFlight = new Map<number, QueuedHighlight>();

	/** The quote as it is now: a temp that has been answered is its row. */
	function currentOf(held: Shown): Shown {
		const id = settledAs.get(held.id) ?? held.id;
		const now = quotes.find((q) => q.id === id);
		if (now) return now;
		return id === held.id ? held : { ...held, id, waiting: undefined };
	}

	/**
	 * Keep a span, and answer the highlight it became. Every way to keep comes
	 * here (the bar, H and N, the lookup panel's foot), and this is where a selection
	 * overlapping a highlight joins it: the span sent covers them all, and the
	 * workstation folds what it covers (the oldest's note kept).
	 */
	function keepSpan(span: TextSpan, openNote: boolean) {
		if (!flat || !entry || !canKeep) return;
		const { span: covered, joined } = joinSpans(
			span,
			quotes.filter((q) => q.state === 'ok')
		);
		const parts = quoteParts(flat, toWords(covered));
		if (!parts) return;
		const place = toFull(parts.span);
		const oldest = joined[0];
		// What joined was waiting too stays on the device until this press is kept
		// somewhere: the queue's own write (`queueCovering`) or the
		// workstation's answer (`sendQuote`) supersedes it, and a press that is kept
		// nowhere leaves it waiting as it was, note and all.
		const temp: KeptQuote = {
			...place,
			id: nextTemp--,
			quote: parts.quote,
			before: parts.before,
			after: parts.after,
			paragraph: parts.paragraph,
			context: parts.context,
			colour: oldest?.colour ?? colour,
			// The oldest note there is, as the workstation's fold keeps.
			note: joined.find((j) => j.note.trim() !== '')?.note ?? '',
			madeAt: oldest?.madeAt ?? Date.now(),
			state: 'ok'
		};
		quotes = [...quotes.filter((q) => !joined.includes(q)), temp];
		const saved = joined.filter((j) => !j.waiting);
		if (saved.length) joinedBy.set(temp.id, saved);
		const waiting = joined.filter((j) => j.waiting);
		if (waiting.length) joinedWaiting.set(temp.id, waiting);
		clearSelection();
		drawMarks();
		const body: QuoteBody = { ...temp, entry: entry.id };
		// Offline too: a DELETE during the device's own write has to find it in flight.
		const going = offline.online
			? sendQuote(temp.id, body)
			: waitOnDevice(temp.id, body).then((): Sent => ({ row: null, unreachable: true }));
		inFlight.set(
			temp.id,
			going.finally(() => inFlight.delete(temp.id))
		);
		if (openNote) openHighlight(temp.id, place, true);
	}

	/**
	 * Nothing a hidden series' reader must not leave behind goes on the device:
	 * the item holds the words. Those presses are told the reader needs the
	 * workstation, as a page's are.
	 */
	const mayWait = () => !series.hidden && !data.reveal;

	/**
	 * What a press at [key] carries for the item that will stand for it: the
	 * quotes it covers, and what the reader changed of an item whose own span was
	 * pressed again. Both paths build the same thing — `waitOnDevice` queues it,
	 * and the DELETE-inside-the-POST path hands it to UNDO — so a re-press keeps
	 * its inner covers and its `revised` whichever end the press meets. The
	 * own-span item is read from the take-back the device just made when there is
	 * one: its `remembered` entry is gone by then.
	 */
	function carryFor(
		id: number,
		key: string,
		of: number
	): { covers: CoveredHighlight[]; revised: string[] } {
		const covers: CoveredHighlight[] = [];
		const revised: string[] = [];
		for (const j of joinedWaiting.get(id) ?? []) {
			if (!j.waiting) continue;
			if (j.waiting === key) {
				// The press is that item's own span again: it is this item, not
				// something this item covers. What it covered is carried on.
				const own = takenInFlight.get(id) ?? carriedBy(j.waiting);
				if (own?.covers?.length) covers.push(...own.covers);
				for (const field of own?.revised ?? []) if (!revised.includes(field)) revised.push(field);
				continue;
			}
			covers.push(coverOf(j, of));
		}
		takenInFlight.delete(id);
		return { covers, revised };
	}

	/** The workstation can't be reached: it waits on the device, drawn, and `waiting` says so. */
	async function waitOnDevice(id: number, body: QuoteBody) {
		if (deletedInFlight.has(id)) return;
		if (!mayWait()) {
			// A third end that leaves no row and no queue item: a reader that may
			// no longer queue still owes the quotes the press took in their place.
			restoreJoinedWaiting(id, body.entry);
			settleQuote(id, null, [], body.entry);
			say('○ OFFLINE · HIGHLIGHT NEEDS THE WORKSTATION');
			return;
		}
		const key = quoteKey(body.entry, body.block, body.offset, body.endBlock, body.endOffset);
		// What this press took in waits inside its own item, so a refusal of that
		// item can put them back (a refusal the page may not be open to hear).
		const { covers, revised } = carryFor(id, key, body.entry);
		// The press first, then what it covers leaves the device: refused, they stay.
		const queued = await queueCovering(
			{
				key,
				url: QUOTES_URL,
				body: body as unknown as Record<string, unknown>,
				entry: body.entry,
				label: `¶ ${body.block + 1}`,
				...(covers.length ? { covers } : {}),
				...(revised.length ? { revised } : {})
			},
			waitingKeysOf(id)
		);
		if (!queued) {
			// The browser won't keep it: nothing here may claim that it waits.
			restoreJoinedWaiting(id, body.entry);
			settleQuote(id, null, [], body.entry);
			say('NOT KEPT · THE WORKSTATION DID NOT ANSWER');
			return;
		}
		// Deleted while the device was writing it down: the item goes, but what it
		// covered stays in `joinedWaiting`, the one copy left. `deleteQuote`'s
		// in-flight path reads it there and deletes it, so its UNDO is DELETE's
		// inverse here too, covers and all.
		if (deletedInFlight.has(id)) {
			const taken = await takeBackHighlight(key);
			// The take-back cleared `remembered` for the item's own key: keep it
			// for that path's UNDO, which builds the same carry `waitOnDevice` did.
			if (taken) takenInFlight.set(id, taken);
			return;
		}
		// The join is the item now: what it covered waits inside it, not beside it.
		joinedWaiting.delete(id);
		quotes = quotes.map((q) => (q.id === id ? { ...q, waiting: key } : q));
	}

	/**
	 * Whichever is showing now as `id`, replaced by what the workstation says of
	 * it. `of` is the entry the press was made on: an answer for a chapter no
	 * longer on screen is a row that is right where it is, and nothing to draw here.
	 */
	function settleQuote(id: number, q: KeptQuote | null, folded: number[], of: number) {
		const joined = joinedBy.get(id) ?? [];
		joinedBy.delete(id);
		joinedWaiting.delete(id);
		if (q) settledAs.set(id, q.id);
		if (of !== entry?.id) return;
		for (const row of folded) goneHere.add(row);
		if (openId === id) {
			openId = q?.id ?? null;
			if (q) openNoteFocus = false;
		}
		const gone = new Set([...folded, id]);
		quotes = q
			? [...quotes.filter((x) => !gone.has(x.id) && x.id !== q.id), q]
			: [...quotes.filter((x) => !gone.has(x.id)), ...(deletedInFlight.has(id) ? [] : joined)];
		drawMarks();
	}

	/**
	 * What a waiting quote was, for the press that covers it.
	 * The drawn quote is the body: the device's copy was taken back with the
	 * press, and a note or colour typed then is on the drawn quote. What the
	 * queue last knew of it adds the fields only the item has — what the reader
	 * changed while it waited, and anything that item itself covered.
	 */
	function coverOf(j: Shown, of: number): NewHighlight {
		const key = j.waiting!;
		const body: Shown = { ...j };
		delete body.waiting;
		const carried = carriedBy(key);
		return {
			key,
			url: QUOTES_URL,
			body: { ...body, entry: of } as unknown as Record<string, unknown>,
			entry: of,
			label: `¶ ${j.block + 1}`,
			revised: carried?.revised,
			covers: carried?.covers
		};
	}

	/**
	 * A join the workstation refused took each waiting quote it covered off the
	 * device first (`keepSpan`), and the refusal restores only saved rows. Put
	 * them back, each under its own body and key, as the UNDO band's re-queue
	 * does, and draw it waiting again. A join deleted in flight is wanted gone,
	 * so its quotes stay taken back.
	 */
	function restoreJoinedWaiting(id: number, of: number) {
		const joined = joinedWaiting.get(id) ?? [];
		joinedWaiting.delete(id);
		const waiting = joined.filter((j) => j.waiting);
		if (waiting.length === 0) return;
		// Deleted in flight: what it took in goes with it. Those quotes
		// are still on the device (nothing superseded them), so they are
		// taken back here, as DELETE takes back a waiting quote.
		if (deletedInFlight.has(id)) {
			for (const j of waiting) void takeBackHighlight(j.waiting!);
			return;
		}
		void waitingHighlights().then((items) => {
			const held = new Set(items.map((i) => i.key));
			for (const j of waiting) {
				// Never taken off the device: it waits as it was; draw it.
				if (held.has(j.waiting!)) {
					putBack(j, of);
					continue;
				}
				// Gone meanwhile (the queue sent it while the press was out): put it
				// back as it was, and the endpoint answers the repeat with its row.
				const cover = coverOf(j, of);
				void queueHighlight(cover).then((queued) => {
					if (queued) putBack({ ...j, waiting: cover.key }, of);
				});
			}
		});
	}

	/** The waiting quotes a press at temp [id] took in, by their keys on the device. */
	function waitingKeysOf(id: number): string[] {
		return (joinedWaiting.get(id) ?? []).flatMap((j) => (j.waiting ? [j.waiting] : []));
	}

	/** Band's say-so for a press that didn't take, and marks taken back. */
	async function sendQuote(id: number, body: QuoteBody): Promise<Sent> {
		try {
			const res = await fetch(QUOTES_URL, {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify(body)
			});
			if (!res.ok) {
				restoreJoinedWaiting(id, body.entry);
				settleQuote(id, null, [], body.entry);
				if (!deletedInFlight.has(id))
					say(`NOT KEPT · ${refusedDetail(res.status === 404 ? 'gone' : 'refused')}`);
				return { row: null, unreachable: false };
			}
			const j = (await res.json()) as { highlight: KeptQuote; folded: number[] };
			// Kept by the workstation, which folded what it covers: those leave the
			// device now (superseded, so a POST of theirs still out DELETEs nothing).
			for (const key of waitingKeysOf(id)) void supersedeHighlight(key);
			// Deleted on its way: the row is DELETE's now, and it isn't drawn again.
			settleQuote(id, deletedInFlight.has(id) ? null : j.highlight, j.folded, body.entry);
			return { row: j.highlight, unreachable: false };
		} catch {
			// The device says it's online and the workstation didn't answer.
			await waitOnDevice(id, body);
			return { row: null, unreachable: true };
		}
	}

	// Sent, or refused, from any page of the app: the layout's flush is what sends.
	onMount(() => {
		const tellRefused = async () => {
			const refused = (await refusedHighlights()).filter((i) => isQuoteKey(i.key));
			if (refused.length === 0) return;
			const keys = refused.map((i) => i.key);
			say(
				`${refused.length === 1 ? `${refused[0].label} NOT KEPT` : `${refused.length} HIGHLIGHTS NOT KEPT`} · ${refusedDetail(refused[0].refused ?? 'refused')}`,
				'DISMISS',
				() => {
					hlBand = null;
					void dismissRefused(keys);
				}
			);
		};
		void tellRefused();
		return onQueueChange(({ sent, refused }) => {
			const mine = entry?.id;
			for (const { item, answer } of sent) {
				if (!isQuoteKey(item.key) || item.entry !== mine) continue;
				const made = (answer as { highlight?: KeptQuote; folded?: number[] } | null)?.highlight;
				const showing = quotes.find((q) => q.waiting === item.key);
				if (showing && made)
					settleQuote(showing.id, made, (answer as { folded?: number[] }).folded ?? [], item.entry);
			}
			if (refused.some((i) => isQuoteKey(i.key) && i.entry === mine)) {
				const gone = quotes.filter((q) => refused.some((i) => i.key === q.waiting));
				for (const q of gone) {
					joinedBy.delete(q.id);
					joinedWaiting.delete(q.id);
				}
				quotes = quotes.filter((q) => !gone.includes(q));
				drawMarks();
				// A refused join puts back the waiting quotes it covered: read them
				// from the device and draw them waiting again.
				if (entry) void loadMarks(index);
			}
			if (refused.some((i) => isQuoteKey(i.key))) void tellRefused();
		});
	});

	// ---- the open highlight's sheet --------------------------------------------
	let openId = $state<number | null>(null);
	let openNoteFocus = $state(false);
	let sheetSide = $state<'left' | 'right'>('right');
	const openQuote = $derived(
		openId === null ? null : (quotes.find((q) => q.id === openId) ?? null)
	);
	/** The open sheet's quote, kept past its closing: a draft still has to reach it. */
	let heldQuote: Shown | null = null;
	$effect.pre(() => {
		if (openQuote) heldQuote = openQuote;
	});
	let quoteCopied = $state(false);

	function openHighlight(id: number, at: TextSpan | null, focusNote: boolean) {
		const r = at && flowEl ? rectOf(flowEl, { block: at.block, offset: at.offset }) : null;
		sheetSide = r && r.left + r.width / 2 < innerWidth / 2 ? 'right' : 'left';
		openId = id;
		openNoteFocus = focusNote;
		quoteCopied = false;
		chrome = false;
	}

	function changeQuote(id: number, patch: Partial<Shown>) {
		quotes = quotes.map((q) => (q.id === id ? { ...q, ...patch } : q));
		drawMarks();
	}

	async function patchQuote(held: Shown, body: Record<string, string>): Promise<boolean> {
		let q = currentOf(held);
		// On its way: it will have a row, or a place in the queue, when that's over.
		if (q.id < 0 && !q.waiting) {
			await inFlight.get(q.id);
			q = currentOf(held);
		}
		if (q.waiting) {
			if (await reviseHighlight(q.waiting, body)) return true;
			// Sent in the moment: the row is what's left to change.
			q = currentOf(held);
			if (q.waiting) return false;
		}
		if (q.id < 0) return false;
		try {
			const res = await fetch(resolve('/api/highlights/[id]', { id: String(q.id) }), {
				method: 'PATCH',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify(body)
			});
			return res.ok;
		} catch {
			return false;
		}
	}

	async function saveNote(held: Shown, note: string): Promise<boolean> {
		const ok = await patchQuote(held, { note });
		if (ok) changeQuote(currentOf(held).id, { note: note.trim() });
		return ok;
	}

	/** Counts colour presses, so only the last one's failure speaks for what's on screen. */
	let colourPresses = 0;
	/** The colour the workstation last agreed to, across presses still out. */
	let colourSure: Colour | null = null;

	async function setColour(held: Shown, c: Colour) {
		const press = ++colourPresses;
		colourSure ??= currentOf(held).colour;
		colour = c;
		store(COLOUR_KEY, c);
		changeQuote(currentOf(held).id, { colour: c });
		const ok = await patchQuote(held, { colour: c });
		if (ok && colourSure !== null) colourSure = c;
		if (press !== colourPresses) return;
		const sure = colourSure ?? c;
		colourSure = null;
		if (ok) return;
		changeQuote(currentOf(held).id, { colour: sure });
		say('COLOUR NOT CHANGED · THE WORKSTATION DID NOT ANSWER');
	}

	async function copyQuote(q: KeptQuote) {
		quoteCopied = await copyText(q.quote);
	}

	// HIGHLIGHT DELETED · UNDO: the app's band, at once, and six seconds to take it back.
	type Band = { text: string; label?: string; act?: () => void };
	let hlBand = $state<Band | null>(null);
	let hlBandTimer: ReturnType<typeof setTimeout> | undefined;
	const UNDO_BAND_MS = 6000;

	function say(text: string, label?: string, act?: () => void) {
		clearTimeout(hlBandTimer);
		hlBand = { text, label, act };
		hlBandTimer = setTimeout(() => (hlBand = null), UNDO_BAND_MS);
	}

	/** Back on the page it was taken off, unless the reader has since left that chapter. */
	function putBack(q: Shown, of: number) {
		if (of !== entry?.id) return;
		goneHere.delete(q.id);
		quotes = [...quotes.filter((x) => x.id !== q.id), q];
		drawMarks();
	}

	/**
	 * Nothing the workstation holds was touched, so UNDO waits on the device
	 * again, as the entry it was pressed on: the band outlives a chapter's turn.
	 * `carried` is what the DELETE took off the item — what it covered and what
	 * the reader had changed of it — so the UNDO puts back all of it, not a
	 * body rebuilt from the page that cannot say what waited inside it.
	 */
	function offerRequeue(
		q: Shown,
		of: number,
		carried?: { covers?: CoveredHighlight[]; revised?: string[] }
	) {
		if (!mayWait()) {
			say('HIGHLIGHT DELETED');
			return;
		}
		const key = quoteKey(of, q.block, q.offset, q.endBlock, q.endOffset);
		const body: Shown = { ...q };
		delete body.waiting;
		say('HIGHLIGHT DELETED', 'UNDO', () => {
			hlBand = null;
			void queueHighlight({
				key,
				url: QUOTES_URL,
				body: { ...body, entry: of } as unknown as Record<string, unknown>,
				entry: of,
				label: `¶ ${q.block + 1}`,
				...(carried?.covers?.length ? { covers: carried.covers } : {}),
				...(carried?.revised?.length ? { revised: carried.revised } : {})
			}).then((queued) => {
				if (queued) putBack({ ...q, waiting: key }, of);
				else say('NOT BROUGHT BACK · THE WORKSTATION DID NOT ANSWER');
			});
		});
	}

	async function deleteQuote(q: Shown) {
		const of = entry?.id ?? 0;
		openId = null;
		quotes = quotes.filter((x) => x.id !== q.id);
		goneHere.add(q.id);
		drawMarks();
		// Deleted before it was sent: nothing was asked of the workstation.
		if (q.waiting) {
			// The take-back hands back what the item was: the UNDO puts all of it back.
			const taken = await takeBackHighlight(q.waiting);
			offerRequeue(q, of, { covers: taken?.covers, revised: taken?.revised });
			return;
		}
		// Its POST is still out: that POST's own end is what decides what's left to do.
		let trip: Sent | undefined;
		if (q.id < 0 && inFlight.has(q.id)) {
			deletedInFlight.add(q.id);
			trip = await inFlight.get(q.id);
			deletedInFlight.delete(q.id);
		}
		const id = q.id > 0 ? q.id : (trip?.row?.id ?? settledAs.get(q.id) ?? null);
		if (id === null) {
			if (trip?.unreachable) {
				// The press went to the device, but the DELETE came first: `waitOnDevice`
				// returned without putting what it carried on an item, so the reader's
				// map still holds it (and, for a write already made, a take-back does).
				// UNDO carries exactly what the queue would have.
				const key = quoteKey(of, q.block, q.offset, q.endBlock, q.endOffset);
				const carried = carryFor(q.id, key, of);
				// What it took in is DELETE's too: still on the device unless the
				// device's write already superseded it.
				for (const k of waitingKeysOf(q.id)) void takeBackHighlight(k);
				joinedWaiting.delete(q.id);
				offerRequeue(q, of, {
					covers: carried.covers.length ? carried.covers : undefined,
					revised: carried.revised.length ? carried.revised : undefined
				});
			} else say('HIGHLIGHT DELETED');
			return;
		}
		const ok = await fetch(resolve('/api/highlights/[id]', { id: String(id) }), {
			method: 'DELETE'
		}).then(
			(r) => r.ok,
			() => false
		);
		if (!ok) {
			putBack({ ...q, id, waiting: undefined }, of);
			say('NOT DELETED · THE WORKSTATION DID NOT ANSWER');
			return;
		}
		if (of === entry?.id) goneHere.add(id);
		say('HIGHLIGHT DELETED', 'UNDO', () => {
			hlBand = null;
			void undoDelete(id, q, of);
		});
	}

	async function undoDelete(id: number, q: Shown, of: number) {
		const ok = await fetch(resolve('/api/highlights/[id]', { id: String(id) }), {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ undo: true })
		}).then(
			(r) => r.ok,
			() => false
		);
		if (!ok) {
			say('NOT BROUGHT BACK · THE WORKSTATION DID NOT ANSWER');
			return;
		}
		// Its row and its note, where its words still are.
		putBack({ ...q, id, waiting: undefined }, of);
	}

	/** The lookup panel's foot: HIGHLIGHT and NOTE the looked-up word, SELECT MORE. */
	function footAction(
		what: 'highlight' | 'note' | 'more',
		block: number,
		from: number,
		to: number
	) {
		const span = toFull({ block, offset: from, endBlock: block, endOffset: to });
		lookup = null;
		if (what === 'more') setSelection(span);
		else keepSpan(span, what === 'note');
	}

	/** The selection's words, for COPY and Ctrl+C: what would be kept. */
	function selectedWords(): string | null {
		if (!selection || !flat) return null;
		return quoteParts(flat, toWords(selection))?.quote ?? null;
	}

	async function copySelection() {
		const text = selectedWords();
		if (text === null) return;
		copied = await copyText(text);
		clearTimeout(copiedTimer);
		copiedTimer = setTimeout(() => (copied = false), 1200);
	}

	/** LOOK UP: the panel, on the selection's first word. */
	function lookUpSelection() {
		if (!selection || !flowEl) return;
		const { block, offset } = selection;
		const w = words[block];
		const r = rectOf(flowEl, { block, offset });
		if (!w || !r) return;
		clearSelection();
		// Built from the selection and not from a point: the bar stands over the words.
		chrome = false;
		lookup = {
			text: w.words,
			at: w.wordsAt(offset),
			n: block + 1,
			block,
			base: 0,
			place:
				innerWidth < PHONE_W
					? { kind: 'phone', lift: 0 }
					: { kind: 'side', side: r.left < innerWidth / 2 ? 'right' : 'left' }
		};
	}

	let down: { x: number; y: number; text: boolean } | null = null;
	/** The press's own pointer: a second finger cancels it (src/lib/reader/pointer.ts). */
	const finger = new OnePointer();
	function pointerdown(e: PointerEvent) {
		const which = finger.down(e);
		if (which === 'cancel') return dropPress();
		if (which === 'ignore') return;
		// A press on the controls, a sheet or an overlay is theirs, not the page's.
		const t = e.target as HTMLElement;
		down = t.closest(
			'header, footer, [role="dialog"], .contents, .scrim, .screen, .loading, [aria-label="Lookup"], .sb, .hd, .hl-band'
		)
			? null
			: {
					x: e.clientX,
					y: e.clientY,
					text: selectable && onText(e.clientX, e.clientY)
				};
		pressed = false;
		dragging = false;
		clearTimeout(press);
		if (down?.text) {
			const { x, y } = down;
			press = setTimeout(() => selectWordAt(x, y), PRESS_MS);
		}
	}
	/**
	 * The page follows a sideways drag in the paged layouts, all the way
	 * where there's a page that way in the chapter and a quarter as much where
	 * there isn't. Not in scroll, not with the lookup open, not on the end
	 * page, and not with reduced motion.
	 */
	function pointermove(e: PointerEvent) {
		if (!finger.owns(e)) return;
		if (selecting) {
			lastPoint = { x: e.clientX, y: e.clientY };
			extendTo(selecting.anchor, e.clientX, e.clientY);
			holdCheck(selecting.anchor, true);
			return;
		}
		if (down && Math.hypot(e.clientX - down.x, e.clientY - down.y) > 10) clearTimeout(press);
		// A mouse's drag on the words selects, and never turns a page.
		if (
			down?.text &&
			e.pointerType === 'mouse' &&
			pointerFine.current &&
			!lookup &&
			Math.hypot(e.clientX - down.x, e.clientY - down.y) > 4
		) {
			const anchor = positionAt(down.x, down.y);
			if (anchor) {
				clearTimeout(press);
				selecting = { anchor };
				chrome = false;
				lastPoint = { x: e.clientX, y: e.clientY };
				extendTo(anchor, e.clientX, e.clientY);
				return;
			}
		}
		if (!down || layout === 'scroll' || turning || lookup || atEnd || reduceMotion.current) return;
		const dx = e.clientX - down.x;
		const dy = e.clientY - down.y;
		if (!dragging && !dragStarts(dx, dy)) return;
		// A drag is not a hold: see the image reader's pointermove.
		if (!dragging) clearTimeout(press);
		dragging = true;
		drag = dragGive(forwardBy(dx, mode), pageThat('next'), pageThat('prev'));
	}
	function pointercancel(e: PointerEvent) {
		if (finger.owns(e)) dropPress();
	}
	/** The press ends without a tap or a turn: a drag goes back into place. */
	function dropPress() {
		finger.end();
		clearTimeout(press);
		endDragSelect();
		down = null;
		if (dragging) void settleBack();
		dragging = false;
	}
	/** The drag let go: the selection stands and the bar comes up over it. */
	function endDragSelect() {
		if (!selecting) return false;
		selecting = null;
		stopHold();
		placeSelection();
		return true;
	}
	function pointerup(e: PointerEvent) {
		if (!finger.owns(e)) return;
		finger.end();
		clearTimeout(press);
		if (endDragSelect()) {
			down = null;
			return;
		}
		if (pressed) {
			pressed = false;
			down = null;
			return;
		}
		if (!down) return;
		// A control on the end page, or DELETE's confirmation over it, is its own:
		// a press near the edge must not read as ‹ back.
		if (atEnd && (e.target as Element | null)?.closest?.(END_PAGE_CONTROLS)) {
			down = null;
			return;
		}
		// With the lookup open, a tap anywhere else closes it.
		if (lookup) {
			down = null;
			lookup = null;
			return;
		}
		const dx = e.clientX - down.x;
		const dy = e.clientY - down.y;
		down = null;
		const swipe = swipeAction(dx, dy, mode);
		const dragged = dragging;
		dragging = false;
		if (swipe) {
			chrome = false;
			return void turn(swipe === 'next' ? 'next' : 'prev');
		}
		if (dragged) return void settleBack();
		if (Math.hypot(dx, dy) > 10) return;
		// With a selection up a tap anywhere else only clears it.
		if (selection) return clearSelection();
		if (atEnd) {
			if (tapAction(e.clientX, window.innerWidth, mode, TEXT_EDGE) === 'prev') prev();
			return;
		}
		const target = e.target as HTMLElement;
		// A tap on a highlight opens it, a note's cell included.
		const marked = target.closest<HTMLElement>('[data-h]');
		if (marked && !chrome) {
			const id = Number(marked.dataset.h);
			return openHighlight(id, quotes.find((q) => q.id === id) ?? null, false);
		}
		// An illustration opens full screen; OPEN opens a wide block.
		const img = target.closest('figure.illus img') as HTMLImageElement | null;
		if (img?.src && !chrome) {
			fullImage = { src: img.src, alt: img.alt };
			return;
		}
		const open = target.closest('.wide .open');
		if (open && !chrome) {
			const box = open.closest('.wide') as HTMLElement;
			const inner = box.querySelector('.wide-body')?.firstElementChild;
			wide = {
				title: box.classList.contains('code') ? 'Listing' : 'Table',
				meta: `${series.title.toUpperCase()} · ${short(entry)} · ${wideLabel(box)}`,
				html: inner?.outerHTML ?? '',
				code: box.classList.contains('code')
			};
			return;
		}
		// With the controls up, a tap on the page only puts them away.
		if (chrome) {
			chrome = false;
			return;
		}
		const action = tapAction(e.clientX, window.innerWidth, mode, TEXT_EDGE);
		if (action === 'chrome') chrome = true;
		else void turn(action);
	}

	/** The controls came up because the mouse reached an edge: they go when it leaves. */
	let byHover = false;
	/**
	 * CURSOR: with the option on, the cursor goes after three
	 * seconds without the mouse moving, and a move or a press brings it back at
	 * once. Keys and the wheel do not. It never hides while the bars, the
	 * sheet, CONTENTS, the lookup, a full-screen image, a wide block or the end
	 * page is open: the reader is about to click something.
	 */
	const pointerFine = new MediaQuery('(pointer: fine)', false);
	let cursorOn = $state(false);
	let idle = $state(false);
	let idleTimer: ReturnType<typeof setTimeout> | undefined;
	function wakeCursor() {
		idle = false;
		clearTimeout(idleTimer);
		if (!cursorOn || !pointerFine.current) return;
		if (chrome || sheet || contents || lookup || fullImage || wide || atEnd) return;
		idleTimer = setTimeout(() => (idle = true), CURSOR_IDLE_MS);
	}
	$effect(() => {
		void chrome;
		void sheet;
		void contents;
		void lookup;
		void fullImage;
		void wide;
		void atEnd;
		void cursorOn;
		void pointerFine.current;
		untrack(wakeCursor);
	});
	function setCursor(on: boolean) {
		cursorOn = on;
		store(CURSOR_KEY, on);
	}
	function hover(e: PointerEvent) {
		if (e.pointerType === 'mouse') wakeCursor();
		if (e.pointerType !== 'mouse' || e.buttons !== 0) return;
		if (sheet || contents || lookup || fullImage || wide || atEnd) return;
		const overBars = !!(e.target as Element | null)?.closest?.('header, footer');
		const act = hoverAction(e.clientY, innerHeight, { shown: chrome, byHover, overBars });
		if (act === 'show') {
			chrome = true;
			byHover = true;
		} else if (act === 'hide') chrome = false;
	}
	$effect(() => {
		if (!chrome) byHover = false;
	});

	/** The keys that turn a page or scroll: the reader's own while its chrome is hidden. */
	const TURNS = new Set([
		'ArrowLeft',
		'ArrowRight',
		'ArrowUp',
		'ArrowDown',
		' ',
		'PageUp',
		'PageDown'
	]);

	/**
	 * OK brings the chrome up, and on a TV puts the pad on its scrubber:
	 * the next ↓ reaches CONTENTS and READING.
	 */
	async function showChrome() {
		chrome = true;
		if (!tvScreen.current) return;
		await tick();
		padToScrub();
	}

	function padToScrub() {
		readerEl?.querySelector<HTMLElement>('footer [data-focus-start]')?.focus();
	}

	/**
	 * A sheet takes the footer's place (`bottom={!sheet}`), so the cell that
	 * opened READING is gone by the time it closes: on a TV the pad goes back to
	 * the scrubber rather than nowhere.
	 */
	let hadSheet = false;
	$effect(() => {
		const open = sheet;
		if (hadSheet && !open && tvScreen.current) void tick().then(padToScrub);
		hadSheet = open;
	});

	function keydown(e: KeyboardEvent) {
		// The lookup, and DELETE's confirmation, have the keyboard (their own Escape).
		if (lookup || endSheetOpen()) return;
		if (openQuote) {
			if (e.key === 'Escape') openId = null;
			else if (e.key === 'Delete' && !(e.target as HTMLElement).closest?.('textarea, input'))
				void deleteQuote(openQuote);
			return;
		}
		if (fullImage || wide) {
			if (e.key === 'Escape') fullImage = wide = null;
			return;
		}
		if (sheet || contents) {
			if (e.key === 'Escape') sheet = contents = false;
			return;
		}
		if (selection) {
			const key = e.key.toLowerCase();
			if (e.key === 'Escape') {
				e.preventDefault();
				clearSelection();
				return;
			}
			if ((e.ctrlKey || e.metaKey) && key === 'c') {
				e.preventDefault();
				void copySelection();
				return;
			}
			if (!e.ctrlKey && !e.metaKey && !e.altKey) {
				if ((key === 'h' || key === 'n') && canKeep) {
					e.preventDefault();
					keepSpan(selection, key === 'n');
					return;
				}
				if (key === 'l' && lookupPack) {
					e.preventDefault();
					lookUpSelection();
					return;
				}
			}
		}
		if (e.key === 'Enter' && !e.repeat) {
			// OK on a TV: the chrome, as it is in the image reader (doc/TV.md).
			e.preventDefault();
			showChrome();
			return;
		}
		// The layer's BACK step hides the chrome first; Escape itself is the
		// keyboard's toggle, and brings it up when nothing was open (doc/TEXT-READER.md).
		if (e.key === 'Escape') {
			if (chrome) chrome = false;
			else showChrome();
		}
		// On a TV with the chrome up the pad owns the arrows and the turn keys:
		// an arrow moves among the chrome's cells, BACK hides it.
		// An arrow that found no cell is not the browser's either: on a strip
		// its own scroll moved the chapter 40px under the chrome. Space
		// is left alone: on a focused cell it presses it.
		if (tvScreen.current && chrome && TURNS.has(e.key)) {
			if (e.key !== ' ') e.preventDefault();
			return;
		}
		if (layout === 'scroll') {
			// The end page is over the text: BACK's own keys return to it, as
			// ← does in the paged layouts.
			if (atEnd) {
				if (e.key === 'ArrowUp' || e.key === 'PageUp') {
					e.preventDefault();
					prev();
				}
				return;
			}
			// A chapter too short to scroll has no onscroll to end it (above).
			if ((e.key === 'ArrowDown' || e.key === 'PageDown' || e.key === ' ') && reachScrollEnd())
				e.preventDefault();
			return;
		}
		const left = e.key === 'ArrowLeft';
		const right = e.key === 'ArrowRight';
		if (left || right) {
			e.preventDefault();
			void turn(left === (mode === 'rtl') ? 'next' : 'prev');
		} else if (e.key === ' ' || e.key === 'PageDown') {
			e.preventDefault();
			void turn('next');
		} else if (e.key === 'PageUp') {
			e.preventDefault();
			void turn('prev');
		}
	}

	// BACK: what is open first, then the chrome, then the series. The
	// layer hands it here because this screen reads its own keys.
	$effect(() =>
		registerBack(() => {
			if (selection) {
				clearSelection();
				return true;
			}
			if (openId !== null) {
				openId = null;
				return true;
			}
			if (fullImage || wide) {
				fullImage = wide = null;
				return true;
			}
			if (sheet || contents) {
				sheet = contents = false;
				return true;
			}
			// The lookup panel closes itself on Escape, and stays open on BACK.
			if (lookup) return false;
			if (chrome) {
				chrome = false;
				return true;
			}
			return false;
		})
	);

	// The wheel turns the page in paged layout (doc/TEXT-READER.md, "Mouse").
	const wheelTurn = new WheelTurn();
	function wheel(e: WheelEvent) {
		// Ctrl is the browser's zoom, and a touchpad's pinch.
		if (e.ctrlKey) return;
		if (
			lookup ||
			openId !== null ||
			fullImage ||
			wide ||
			sheet ||
			contents ||
			holdWheelForEndSheet(e)
		)
			return;
		if (layout === 'scroll') {
			// A last chapter too short to scroll never fires onscroll, so the
			// wheel that would have scrolled it is the one that ends it. The end
			// page is over the text, so a wheel back up is the way back to it,
			// as ← is in the paged layouts.
			if (atEnd) {
				if (e.deltaY < 0) {
					e.preventDefault();
					prev();
				}
				return;
			}
			if (e.deltaY > 0 && scrollAtEnd()) {
				e.preventDefault();
				reachScrollEnd();
			}
			return;
		}
		// Not passive, so a sideways scroll can't also go back in history.
		e.preventDefault();
		const action = wheelTurn.feed(wheelForward(e, mode), e.timeStamp);
		if (action) void turn(action);
	}
	onMount(() => {
		addEventListener('wheel', wheel, { passive: false });
		return () => removeEventListener('wheel', wheel);
	});

	// ---- the screen stays awake ---------------------------------------------------------------------
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
		const leave = () => send('close');
		addEventListener('pagehide', leave);
		return () => {
			document.removeEventListener('visibilitychange', visible);
			removeEventListener('pagehide', leave);
			void lock?.release().catch(() => undefined);
		};
	});

	// ---- what the controls say --------------------------------------------------------------------
	const seriesHref = $derived(resolve('/series/[id]', { id: String(series.id) }));
	const workHref = $derived(data.work ? resolve('/work/[id]', { id: String(data.work.id) }) : '');
	/** A browsing record's ADD, where its rating is asked: the same link BROWSE uses. */
	const recordAddHref = $derived(
		data.record ? `${resolve('/downloads/source/[id]', { id: data.record })}?/add` : null
	);
	const libraryHref = resolve('/');
	const inChapter = $derived(
		layout === 'scroll' ? scrollFraction : pages <= 1 ? 1 : page / (pages - 1)
	);
	const meta = $derived(
		textMetaLine({
			chapters: chapters.length,
			chapter: chapterNo,
			label: entry?.label ?? '',
			bookFraction: bookFraction(entries, index, inChapter),
			incognito: data.incognito || !saved
		})
	);
	const left = $derived(chapter ? minutesLeft(charsAfter(chapter, pos), speed) : null);
	const pageText = $derived(
		layout === 'scroll'
			? left === null
				? ''
				: `${left} MIN LEFT`
			: textPageLabel(page, pages, left)
	);
	const readingLabel = $derived(
		settingsLabel({
			layout,
			font: settings.font,
			size: f.fontSize,
			theme: settings.theme,
			vertical,
			furigana: settings.furigana,
			direction
		})
	);
	/** END's estimate of a chapter's length, so the band that opens it says the same. */
	const aboutOf = (e: (typeof entries)[number]) =>
		aboutMinutes(Math.round((e.bytes || 0) * 0.6), speed);
	const nextAbout = $derived(nextReadable ? aboutOf(nextReadable) : '');
	/**
	 * The band at a chapter's start: the table-of-contents title, only
	 * when the chapter doesn't open by printing it (src/lib/reader/start-band.ts).
	 * Matter is already named by the band (COVER), so it never repeats.
	 */
	const titleOf = (e: (typeof entries)[number] | null | undefined, ch: Chapter | null) =>
		e && ch && !e.matter
			? bandTitle(
					e.label,
					leadLines(ch.blocks.map((b) => ({ tag: b.localName, text: b.textContent ?? '' })))
				)
				? e.label
				: null
			: null;
	const startTitle = $derived(titleOf(entry, chapter));
	const nextStartTitle = $derived(titleOf(nextReadable, nextChapter));
	/** The band's count, END's: chapters, or entries for matter. */
	const countOf = (e: (typeof entries)[number]) =>
		e.matter
			? `${entries.indexOf(e) + 1} OF ${entries.length}`
			: `${chapters.indexOf(e) + 1} OF ${chapters.length}`;
	const noSelection = new SvelteSet<number>();
	const noCache = new SvelteSet<number>();
</script>

{#snippet startBand(e: (typeof entries)[number], title: string | null)}
	<div class="cstart">
		<div class="ab">
			<div>{short(e)}</div>
			<div>{countOf(e)}</div>
		</div>
		{#if title}<div class="t">{title}</div>{/if}
		{#if aboutOf(e)}<div class="m">{aboutOf(e)}</div>{/if}
	</div>
{/snippet}

<svelte:head><title>{series.title} · {entry?.label ?? ''}</title></svelte:head>
<svelte:window onkeydown={keydown} onpointermove={hover} onmousedown={wakeCursor} />

<div
	class="text-reader"
	class:cursor-idle={idle}
	class:paper={settings.theme === 'paper'}
	class:vertical
	class:scroll={layout === 'scroll'}
	class:web={webNovel}
	class:justify={settings.justify}
	class:no-ruby={settings.furigana === 'none'}
	style:--text-font={fontOf(settings.font).family}
	style:--fs="{f.fontSize}px"
	style:--lh={f.lineHeight}
	style:--hs="{f.headSize}px"
	style:--page-h="{f.h}px"
	style:--side="{f.x}px"
	role="presentation"
	bind:this={readerEl}
	data-focus-off={!atEnd && !(tvScreen.current && chrome) ? '' : undefined}
	onpointerdown={pointerdown}
	onpointermove={pointermove}
	onpointerup={pointerup}
	onpointercancel={pointercancel}
	oncontextmenu={(e) => e.preventDefault()}
>
	<div
		class="page"
		bind:this={pageEl}
		{onscroll}
		style:left={layout === 'scroll' ? '0' : `${f.x}px`}
		style:top={layout === 'scroll' ? '0' : `${f.y}px`}
		style:width={layout === 'scroll' ? '100%' : `${f.w}px`}
		style:height={layout === 'scroll' ? '100%' : `${f.h}px`}
	>
		<div
			class="flow"
			class:sliding
			class:moving={sliding || drag !== 0}
			class:rtl={flowRtl}
			bind:this={flowEl}
			style:column-width={layout === 'paged'
				? `${vertical ? f.h : f.cols > 1 ? (f.w - f.gap) / 2 : f.w}px`
				: undefined}
			style:column-gap={layout === 'paged' ? `${f.gap}px` : undefined}
			style:height={layout === 'paged' ? `${f.h}px` : undefined}
			style:width={layout === 'paged' && vertical ? `${f.w}px` : undefined}
			style:padding={layout === 'scroll' ? `${f.y}px ${f.x}px` : undefined}
			style:transform={layout === 'paged' ? `translate${pageAxis}(${shift}px)` : undefined}
			style:--turn-ms="{TURN_MS}ms"
			style:--turn-ease={TURN_EASE}
		>
			{#if layout === 'scroll'}
				<!-- What a crossing kept of the chapter before, filled by
				     keepForCrossing and only ever by it: copies, unnumbered and inert. -->
				<div class="kept" bind:this={keptEl} inert aria-hidden="true"></div>
			{/if}
			{#if chapter && entry}
				<!-- The chapter's start, END's twin: not a block, so `data-b` and
				     every saved place are what they were. -->
				{@render startBand(entry, startTitle)}
			{/if}
			<div class="blocks" bind:this={blocksEl}></div>
			{#if chapter && nextReadable && layout === 'paged'}
				<!-- The chapter ends where it ends; the rest of its last page names the next. -->
				<div class="band">
					<div class="ab">
						<div>END · {short(entry)}</div>
						<div>{chapterNo ?? index + 1} OF {chapterNo ? chapters.length : entries.length}</div>
					</div>
					<div class="nx">
						<div class="k">NEXT</div>
						<div class="t">{nextReadable.label}</div>
						{#if nextAbout}<div class="m">{nextAbout}</div>{/if}
					</div>
					<div class="go">
						{rtl ? '← TAP OR SWIPE TO CONTINUE' : 'TAP OR SWIPE TO CONTINUE →'}
					</div>
				</div>
			{/if}
			{#if chapter && nextReadable && layout === 'scroll'}
				<div class="sband">
					<div class="ab">
						<div>END · {short(entry)}</div>
						<div>{chapterNo ?? index + 1} OF {chapterNo ? chapters.length : entries.length}</div>
					</div>
					<div class="rule"></div>
					<div class="nx">
						<div class="k">NEXT</div>
						<div class="t">{nextReadable.label}</div>
						{#if nextAbout}<div class="m">{nextAbout}</div>{/if}
					</div>
					<div class="go">↓ KEEP SCROLLING</div>
				</div>
				{#if nextReadable.file !== bookFile}
					<!-- The next volume is another download: a screen of room where
					     its first chapter will be, so its start crosses the middle of the
					     screen as any next chapter's does, and the crossing opens it, with
					     OPENING over it while it downloads, as a turn does in PAGED. -->
					<div class="blocks next" bind:this={nextEl}>
						<div class="volume-room" aria-hidden="true"></div>
					</div>
				{:else}
					<!-- END, then the next chapter's start band, then its text, as it
					     will stand once the crossing opens it. -->
					{#if nextChapter}{@render startBand(nextReadable, nextStartTitle)}{/if}
					<div class="blocks next" bind:this={nextEl}></div>
				{/if}
			{/if}
		</div>
	</div>

	{#if selection && selGeom}
		<TextSelection
			bar={selGeom.bar}
			start={selGeom.start}
			end={selGeom.end}
			{vertical}
			dragging={handleDragging}
			cue={holdCue}
			incognito={data.incognito}
			{canKeep}
			lookUp={!!lookupPack}
			fine={pointerFine.current}
			{copied}
			onwidth={(w) => {
				barWidth = w;
				placeSelection();
			}}
			onhandle={handleDown}
			onkeep={() => selection && keepSpan(selection, false)}
			onnote={() => selection && keepSpan(selection, true)}
			oncopy={() => void copySelection()}
			onlookup={lookUpSelection}
		/>
	{/if}

	{#if chapter && !chrome && !atEnd}
		<div
			class="progress"
			class:rtl
			style:width="{(layout === 'scroll' ? scrollFraction : (page + 1) / pages) * 100}%"
		></div>
	{/if}
	{#if data.incognito}<div class="dashed" aria-hidden="true"></div>{/if}
	{#if !offline.online && chapter && page >= pages - 1 && !chrome}
		<div class="offline-band">
			<div>○ OFFLINE</div>
			<div class="m">CACHED STILL OPENS</div>
		</div>
	{/if}

	{#if chrome && chapter && entry}
		<TextChrome
			{atEnd}
			title={series.title}
			{meta}
			incognito={data.incognito}
			{rating}
			{favourite}
			chapter={entry.label}
			{pageText}
			page={layout === 'scroll' ? Math.round(scrollFraction * 99) : page}
			pages={layout === 'scroll' ? 100 : pages}
			{rtl}
			prevLabel={prevReadable ? short(prevReadable) : null}
			nextLabel={nextReadable ? short(nextReadable) : null}
			settings={readingLabel}
			{seriesHref}
			bottom={!sheet}
			onfav={toggleFav}
			onscrub={(p) => {
				if (layout === 'scroll' && pageEl && blocksEl)
					pageEl.scrollTop =
						keptHeight() + (p / 99) * Math.max(0, scrollEnd(pageEl, blocksEl) - keptHeight());
				else void go(p);
			}}
			onprev={() => prevReadable && jump(index - 1)}
			onnext={() => nextReadable && jump(index + 1)}
			oncontents={() => (contents = true)}
			onreading={() => (sheet = true)}
		/>
	{/if}

	{#if sheet}
		<TextSheet
			{layout}
			{seriesLayout}
			{settings}
			size={f.fontSize}
			lineHeight={f.lineHeight}
			{landscape}
			{vertical}
			{direction}
			{seriesDirection}
			{width}
			{dim}
			{rating}
			onlayout={(l) => {
				layout = l;
				if (l === 'scroll') void loadNext();
			}}
			onremember={remember}
			ondirection={(d) => (direction = d)}
			onrememberdirection={rememberDirection}
			onwidth={setWidth}
			onsettings={setSettings}
			ondim={setDim}
			cursor={cursorOn}
			oncursor={setCursor}
			onrate={rate}
			onclose={() => (sheet = false)}
		/>
	{/if}

	{#if contents}
		<button
			type="button"
			class="scrim appear"
			out:leave
			aria-label="Close contents"
			onclick={() => (contents = false)}
		></button>
		<!-- A focus scope: on a TV with the chrome up the pad goes in, on the
		     row being read, and BACK gives it to CONTENTS again. Off a TV the reader
		     is opted out and the scope is the no-op it is for READING. -->
		<div
			class="contents rise"
			out:leave={'down'}
			class:short={entries.length < 60}
			use:focusScope={{
				start: entry ? [`#entry-${entry.id} .entry-btn`, '.entry-btn'] : ['.entry-btn']
			}}
		>
			<EntryList
				{series}
				selecting={false}
				selected={noSelection}
				cached={noCache}
				onrow={(e) => e.available && jump(entries.indexOf(e))}
				onselect={() => undefined}
				onclose={() => (contents = false)}
			/>
		</div>
	{/if}

	{#if openQuote && entry}
		<QuoteSheet
			head={quoteSheetHead(short(entry) || entry.label, openQuote)}
			quote={openQuote.quote}
			colour={openQuote.colour}
			note={openQuote.note}
			line={quoteSheetLine(openQuote.madeAt, Date.now())}
			side={sheetSide}
			focusNote={openNoteFocus}
			copied={quoteCopied}
			waiting={!!openQuote.waiting}
			onnote={(n) => saveNote(heldQuote ?? openQuote, n)}
			oncolour={(c) => setColour(openQuote, c)}
			oncopy={() => void copyQuote(openQuote)}
			ondelete={() => void deleteQuote(currentOf(heldQuote ?? openQuote))}
			onclose={() => (openId = null)}
		/>
	{/if}

	{#if hlBand}
		<div class="hl-band appear" out:leave role="status">
			<span>{hlBand.text}</span>{#if hlBand.act}<button type="button" onclick={hlBand.act}
					>{hlBand.label}</button
				>{/if}
		</div>
	{/if}

	{#if lookup && entry && lookupPack}
		<LookupPanel
			pack={lookupPack}
			onfoot={lookup.block === null
				? undefined
				: (what, from, to) =>
						footAction(what, lookup!.block!, lookup!.base + from, lookup!.base + to)}
			{canKeep}
			text={lookup.text}
			start={lookup.at}
			context="{short(entry)} · ¶ {lookup.n}"
			placement={lookup.place}
			incognito={data.incognito}
			seriesId={series.id}
			entryId={entry.id}
			place="¶ {lookup.n}"
			onclose={() => (lookup = null)}
		/>
	{/if}

	{#if dim > 0}<div class="dim" style:opacity={dim} aria-hidden="true"></div>{/if}

	{#if atEnd}
		{#if nextEntry}
			<!-- A volume that isn't the last ends as it did: it names the chapter that isn't here. -->
			<TextScreen
				kind="end"
				title={series.title}
				where="{webNovel ? 'WEB NOVEL' : 'NOVEL'} · {reached.toLocaleString(
					'en-US'
				)} OF {chapters.length.toLocaleString('en-US')}"
				missing={!nextEntry.available ? short(nextEntry) : null}
				{askRating}
				{rating}
				{favourite}
				{seriesHref}
				{libraryHref}
				onrate={rate}
				onfav={toggleFav}
			/>
		{:else}
			<!-- The last volume is the reader's end page, so it offers the Work's next
			     part too (Work-End, "A novel's last volume"): one page, one rating ask. -->
			<div class="endwrap">
				<EndPage
					variant="series"
					entryName={entry?.label ?? ''}
					position="{reached} OF {chapters.length}"
					kind={webNovel ? 'WEB NOVEL' : 'NOVEL'}
					unit="CH"
					seriesTitle={series.title}
					next={null}
					{rating}
					{favourite}
					incognito={data.incognito || !saved}
					mode="ltr"
					lastPage=""
					{seriesHref}
					{libraryHref}
					onrate={rate}
					onfav={toggleFav}
					onback={() => (atEnd = false)}
					work={data.work}
					{workHref}
					inLibrary={!data.record}
					deleteAsk={data.deleteAsk}
					seriesHidden={data.series.hidden}
					addHref={recordAddHref}
				/>
			</div>
		{/if}
	{/if}
	{#if failure}
		<TextScreen
			kind="failed"
			title={series.title}
			bytes={bytesOf(entries[index]?.file)}
			reason={failure.kind}
			detail={failure.detail}
			{seriesHref}
			{libraryHref}
			onretry={retry}
		/>
	{:else if !chapter}
		<TextScreen
			kind="loading"
			chapters={chapters.length}
			bytes={bytesOf(entries[index]?.file)}
			progress={downloaded}
		/>
	{/if}

	{#if fullImage}
		<ImageView src={fullImage.src} alt={fullImage.alt} onclose={() => (fullImage = null)} />
	{/if}
	{#if wide}
		<WideView {...wide} onclose={() => (wide = null)} />
	{/if}
</div>

<style>
	/* The last volume's page is the image reader's end page: over the reader's chrome. */
	.endwrap {
		position: absolute;
		inset: 0;
		z-index: 40;
	}
	/*
	 * The controls are the image reader's: always dark. The page itself follows
	 * THEME -- DARK is true black with --text-prose, so white text doesn't
	 * bloom; PAPER is the library's own light palette with full ink.
	 */
	.text-reader {
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
		--ground: #000;
		--prose: #b4b6b8;
		--ink: var(--graphite-100);
		--mut: var(--graphite-400);
		--pl1: var(--graphite-700);
		--pl2: var(--graphite-600);
		--ill: 0.85;
		/* The marker's three colours and its ink, and a selection's tint. */
		--mk-y: oklch(0.5 0.09 95);
		--mk-o: oklch(0.44 0.1 52);
		--mk-b: oklch(0.38 0.08 250);
		--mk-ink: #e8e8e6;
		--hl-accent: var(--lime-400);
		--hl-select: oklch(0.86 0.17 125 / 0.24);
		position: fixed;
		inset: 0;
		overflow: hidden;
		background: var(--ground);
		color: var(--text-1);
		user-select: none;
		-webkit-user-select: none;
		-webkit-touch-callout: none;
	}
	/* CURSOR on, and the mouse still for three seconds: the class is
	   the whole change, so nothing reflows. Every descendant is covered because
	   a cell or a button sets its own pointer cursor. */
	.text-reader.cursor-idle,
	.text-reader.cursor-idle * {
		cursor: none;
	}
	.text-reader.paper {
		--ground: var(--paper-50);
		--prose: var(--paper-950);
		--ink: var(--paper-950);
		--mut: var(--paper-600);
		--pl1: var(--paper-200);
		--pl2: var(--paper-300);
		--ill: 1;
		--mk-y: oklch(0.9 0.12 98);
		--mk-o: oklch(0.85 0.09 62);
		--mk-b: oklch(0.82 0.06 240);
		--mk-ink: oklch(0.2 0.01 95);
		--hl-accent: var(--green-600);
		--hl-select: oklch(0.52 0.13 150 / 0.22);
	}
	.page {
		position: absolute;
		overflow: hidden;
	}
	.scroll .page {
		overflow-y: auto;
		overflow-x: hidden;
		touch-action: pan-y;
	}
	.flow {
		box-sizing: border-box;
		column-fill: auto;
		color: var(--prose);
		font: 400 var(--fs) / var(--lh) var(--text-font, var(--font-serif));
		hyphens: auto;
		-webkit-hyphens: auto;
		overflow-wrap: break-word;
	}
	/*
	 * Paged, the flow moves by its transform alone: following a drag, or
	 * sliding a turn, and the columns are never laid out again for it. It is a
	 * layer of its own only while it moves: kept as one, a long chapter's flow
	 * (56 pages, 45,000px wide) made the slides' frames worse, not better
	 * (measured). Horizontal pans are the reader's, so a drag reaches it rather
	 * than the browser.
	 */
	.text-reader:not(.scroll) {
		touch-action: pan-y pinch-zoom;
	}
	/*
	 * Novel 02, transcribed. The marker fills the lower two-thirds of the line and
	 * the words on it go to full ink; a selection tints the whole line. Square
	 * ends, each line of a run its own band. The 1px each side is drawn outside
	 * the layout (the negative margin), so a mark never moves the words.
	 */
	.flow :global(.mk) {
		--mc: var(--mk-y);
		padding: 0 1px;
		margin: 0 -1px;
		color: var(--mk-ink);
		box-shadow: inset 0 -0.66em 0 var(--mc);
		-webkit-box-decoration-break: clone;
		box-decoration-break: clone;
	}
	.flow :global(.mk.orange) {
		--mc: var(--mk-o);
	}
	.flow :global(.mk.blue) {
		--mc: var(--mk-b);
	}
	.vertical .flow :global(.mk) {
		box-shadow: inset 0.66em 0 0 var(--mc);
	}
	.flow :global(.nm) {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		box-sizing: border-box;
		width: 17px;
		height: 17px;
		margin-inline-start: 3px;
		vertical-align: 0.15em;
		border: 1px solid var(--mk-ink);
		text-indent: 0;
		font: 500 11px/1 var(--font-mono);
		color: var(--mk-ink);
	}
	.flow :global(.nm::before) {
		content: '≡';
	}
	.flow :global(.sel) {
		background: var(--hl-select);
		color: var(--mk-ink);
		-webkit-box-decoration-break: clone;
		box-decoration-break: clone;
	}
	.kept {
		pointer-events: none;
		user-select: none;
	}
	.flow.moving {
		will-change: transform;
	}
	/*
	 * R->L: the columns run right to left, so the next page lies to the
	 * left and slides in from there. Only the column order: the text inside
	 * runs as it always did.
	 */
	.flow.rtl {
		direction: rtl;
	}
	.flow.rtl > :global(*) {
		direction: ltr;
	}
	.flow.sliding {
		transition: transform var(--turn-ms) var(--turn-ease);
	}
	@media (prefers-reduced-motion: reduce) {
		.flow.sliding {
			transition: none;
		}
	}
	.justify .flow {
		text-align: justify;
	}
	.vertical .flow {
		writing-mode: vertical-rl;
		font-family: 'IBM Plex Sans JP', var(--font-sans);
		line-height: 1.9;
		text-align: justify;
	}
	.flow :global(p) {
		margin: 0;
		text-indent: 1.5em;
	}
	.web .flow :global(p) {
		margin: 0 0 0.9em;
		text-indent: 0;
	}
	.flow :global(:is(h1, h2, h3, h4, h5, h6) + p),
	.flow :global(.blocks > p:first-child) {
		text-indent: 0;
	}
	.vertical .flow :global(p) {
		margin: 0;
		text-indent: 1em;
	}
	.flow :global(:is(h1, h2, h3, h4, h5, h6)) {
		margin: 0;
		padding: 0 0 40px;
		font: 500 var(--hs) / 1.25 var(--font-sans);
		color: var(--ink);
		text-align: left;
		text-wrap: pretty;
		break-after: avoid;
		break-inside: avoid;
		hyphens: none;
	}
	.flow :global(:is(h3, h4, h5, h6)) {
		font-size: calc(var(--fs) * 1.1);
		padding-bottom: 16px;
	}
	.vertical .flow :global(:is(h1, h2, h3)) {
		padding: 0 0 0 1.2em;
		font:
			500 26px / 1.5 'IBM Plex Sans JP',
			var(--font-sans);
	}
	.flow :global(blockquote) {
		margin: 0 0 0.9em 1.5em;
	}
	.flow :global(:is(ul, ol)) {
		margin: 0 0 0.9em;
		padding-left: 1.5em;
	}
	.flow :global(hr) {
		height: 1px;
		margin: 1.5em 20%;
		border: 0;
		background: var(--pl1);
	}
	.flow :global(rt) {
		font-size: 0.5em;
		color: var(--mut);
	}
	.no-ruby .flow :global(rt) {
		display: none;
	}
	.flow :global(.tcy) {
		text-combine-upright: all;
	}
	.flow :global(figure.illus) {
		display: flex;
		justify-content: center;
		margin: 28px 0;
		break-inside: avoid;
	}
	.flow :global(figure.illus img) {
		max-width: 100%;
		max-height: calc(var(--page-h) - 56px);
		opacity: var(--ill);
		cursor: zoom-in;
	}
	.flow :global(.wide) {
		margin: 10px 0 28px;
		border: 1px solid var(--pl2);
		text-align: left;
		break-inside: avoid;
		hyphens: none;
	}
	.flow :global(.wide-head) {
		display: flex;
		align-items: stretch;
		height: 40px;
		border-bottom: 1px solid var(--pl1);
	}
	.flow :global(.wlabel) {
		flex: 1;
		min-width: 0;
		display: flex;
		align-items: center;
		padding: 0 14px;
		font: 500 12px var(--font-mono);
		letter-spacing: 0.06em;
		color: var(--mut);
		white-space: nowrap;
		overflow: hidden;
	}
	/* What's cut is an attribute, so no position in the block ever counts it. */
	.flow :global(.wlabel)::after {
		content: attr(data-shown);
		margin-left: 0.5em;
	}
	.flow :global(.wide .open) {
		display: none;
		align-items: center;
		padding: 0 14px;
		border-left: 1px solid var(--pl1);
		font: 500 12px var(--font-mono);
		letter-spacing: 0.04em;
		color: var(--ink);
		cursor: pointer;
	}
	.flow :global(.wide.cut .open) {
		display: flex;
	}
	.flow :global(.wide-body) {
		overflow: hidden;
		padding: 14px;
	}
	.flow :global(.wide pre) {
		margin: 0;
		white-space: pre;
		font: 400 14px / 1.6 var(--font-mono);
		color: var(--ink);
	}
	.flow :global(.wide table) {
		border-collapse: collapse;
		margin: -14px;
	}
	.flow :global(.wide :is(td, th)) {
		padding: 9px 14px;
		border-bottom: 1px solid var(--pl1);
		white-space: nowrap;
		font: 400 15px var(--font-sans);
		color: var(--ink);
		text-align: left;
	}
	.flow :global(.wide th) {
		font: 500 12px var(--font-mono);
		color: var(--mut);
	}
	.band {
		display: flex;
		flex-direction: column;
		gap: 24px;
		margin-top: 56px;
		padding-top: 28px;
		border-top: 1px solid var(--ink);
		text-align: left;
		break-inside: avoid;
	}
	.band .ab,
	.sband .ab {
		display: flex;
		justify-content: space-between;
		gap: 12px;
		font: 500 13px var(--font-mono);
		letter-spacing: 0.06em;
		color: var(--mut);
	}
	.band .nx {
		display: flex;
		flex-direction: column;
		gap: 10px;
	}
	.nx .k {
		font: 500 13px var(--font-mono);
		letter-spacing: 0.06em;
		color: var(--mut);
	}
	.band .nx .t {
		font: 500 30px / 1.2 var(--font-sans);
		color: var(--ink);
	}
	.nx .m {
		font: 400 14px var(--font-mono);
		color: var(--mut);
	}
	.band .go {
		font: 500 15px var(--font-mono);
		color: var(--accent);
	}
	/*
	 * A chapter's start: END's type, rule and colours, closing above the
	 * text instead of opening below it. Logical sides, so vertical Japanese's
	 * rule is on the left, between the band and the first column of text.
	 */
	.cstart {
		display: flex;
		flex-direction: column;
		gap: 12px;
		margin: 0;
		margin-block-end: 40px;
		padding-block-end: 20px;
		border-block-end: 1px solid var(--ink);
		text-align: left;
		break-inside: avoid;
	}
	.cstart .ab {
		display: flex;
		justify-content: space-between;
		gap: 12px;
		font: 500 13px var(--font-mono);
		letter-spacing: 0.06em;
		color: var(--mut);
	}
	.cstart .t {
		font: 500 30px / 1.2 var(--font-sans);
		color: var(--ink);
		text-wrap: balance;
		hyphens: none;
	}
	.cstart .m {
		font: 400 14px var(--font-mono);
		color: var(--mut);
	}
	.vertical .band {
		margin: 0 56px 0 0;
		padding: 0 28px 0 0;
		border-top: 0;
		border-right: 1px solid var(--ink);
	}
	.sband {
		display: flex;
		flex-direction: column;
		justify-content: center;
		gap: 18px;
		height: 320px;
		box-sizing: border-box;
		margin: 56px calc(var(--side, 72px) * -1);
		padding: 0 72px;
		/* END's colours are the page's, as PAGED's band takes them: no ground of
		   its own, so PAPER's END is not a dark block on a paper page. */
		border-top: 1px solid var(--ink);
		border-bottom: 1px solid var(--ink);
		text-align: left;
	}
	/* As tall as the screen, so the room's top can reach the middle of it. */
	.volume-room {
		height: 100dvh;
	}
	.sband .rule {
		height: 1px;
		background: var(--pl1);
	}
	.sband .nx {
		display: flex;
		flex-direction: column;
		gap: 8px;
	}
	.sband .nx .t {
		font: 500 34px / 1.2 var(--font-sans);
		color: var(--ink);
	}
	.sband .go {
		font: 500 14px var(--font-mono);
		color: var(--accent);
	}
	.progress {
		position: absolute;
		left: 0;
		bottom: 0;
		height: 2px;
		background: var(--pl2);
		pointer-events: none;
	}
	.progress.rtl {
		left: auto;
		right: 0;
	}
	.dashed {
		position: absolute;
		left: 0;
		right: 0;
		top: 0;
		border-top: 2px dashed var(--text-2);
		pointer-events: none;
		z-index: 25;
	}
	.offline-band {
		position: absolute;
		left: 0;
		right: 0;
		top: 0;
		z-index: 15;
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 12px;
		height: 48px;
		padding: 0 24px;
		border-bottom: var(--hairline);
		background: var(--surface-panel);
		font: 500 14px var(--font-mono);
		color: var(--text-1);
	}
	.offline-band .m {
		color: var(--text-2);
	}
	.scrim {
		position: absolute;
		left: 0;
		right: 0;
		top: 65px;
		bottom: 0;
		z-index: 29;
		border: 0;
		background: var(--scrim, rgba(0, 0, 0, 0.6));
	}
	.contents {
		position: absolute;
		left: 0;
		right: 0;
		top: 160px;
		bottom: 0;
		z-index: 30;
		overflow-y: auto;
		/* The reader scrolls its own page, not the document, so CONTENTS takes
		   no page lock; its scroll just ends at its edge. */
		overscroll-behavior: contain;
		background: var(--surface-page);
		border-top: 1px solid var(--text-1);
	}
	.contents.short {
		top: 120px;
	}
	/* The app's band along the foot, while UNDO can still take it back. */
	.hl-band {
		position: absolute;
		left: 0;
		right: 0;
		bottom: 0;
		z-index: 45;
		display: flex;
		align-items: stretch;
		min-height: 52px;
		background: var(--surface-inverse);
		color: var(--text-inverse);
		font: 500 13px/1.3 var(--font-mono);
		letter-spacing: 0.06em;
	}
	.hl-band span {
		flex: 1;
		display: flex;
		align-items: center;
		padding: 10px 18px;
	}
	.hl-band button {
		display: flex;
		align-items: center;
		padding: 0 18px;
		border: 0;
		border-left: 1px solid color-mix(in oklab, var(--text-inverse) 35%, transparent);
		background: transparent;
		color: inherit;
		font: inherit;
		letter-spacing: inherit;
		cursor: pointer;
	}
	.dim {
		position: absolute;
		inset: 0;
		z-index: 50;
		background: #000;
		pointer-events: none;
	}
</style>

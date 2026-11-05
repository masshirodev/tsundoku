<script lang="ts">
	import { leave } from '$lib/motion';
	import { readLocal, writeLocal } from '$lib/settings/local';
	import type { Json } from '$lib/settings/catalog';
	import { onMount, tick, untrack } from 'svelte';
	import { SvelteSet } from 'svelte/reactivity';
	import { afterNavigate, beforeNavigate, replaceState } from '$app/navigation';
	import { forgetReaderMove, leavingReader, readerMovedTo } from '$lib/reader/leaving';
	import { resolve } from '$app/paths';
	import { page as appPage } from '$app/state';
	import type { PageData } from './$types';
	import { offline } from '$lib/offline.svelte';
	import { cacheBook } from '$lib/cache/device';
	import { MemberUnavailable } from '$lib/epub/remote';
	import { flushPending, queuePending } from '$lib/cache/pending';
	import { entryDocs } from '$lib/epub/epub';
	import { paragraphAt } from '$lib/japanese/paragraph';
	import { PHONE_W, type Placement } from '$lib/japanese/panel';
	import { flushLookups } from '$lib/japanese/lookups';
	import LookupPanel from '$lib/components/japanese/LookupPanel.svelte';
	import {
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
	import EntryList from '../../series/[id]/EntryList.svelte';
	import TextChrome from './TextChrome.svelte';
	import TextSheet from './TextSheet.svelte';
	import TextScreen from './TextScreen.svelte';
	import EndPage from './EndPage.svelte';
	import ImageView from './ImageView.svelte';
	import WideView from './WideView.svelte';

	/**
	 * The text reader (Index Text Reader; doc/TEXT-READER.md). The text is the
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
	 * Which way PAGED turns a horizontal book (c440): this session's, until
	 * REMEMBER makes it the series', as LAYOUT is and as the image reader's MODE is.
	 */
	// svelte-ignore state_referenced_locally
	let direction = $state<TextDirection>(data.textDirection);
	// svelte-ignore state_referenced_locally
	let seriesDirection = $state<TextDirection>(data.textDirection);
	let sw = $state(800);
	let sh = $state(1280);
	onMount(() => {
		// A FONT this build doesn't know (a newer build's) reads as the default (c442).
		settings = textSettings(stored<Partial<TextSettings>>('settings', {}));
		// DIM is shared with the image reader: it's about the room, not the book.
		dim = stored('tsundoku.reader.dim', 0);
		speed = stored('speed', { chars: 0, ms: 0 });
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
	 * WIDTH (c437): the series' own, kept in this browser beside the device's
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
						? // Read from its source, which didn't send it (doc/BROWSING.md, "Novels online").
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
	// SCROLL is one column whatever COLUMNS says: WIDTH's share is of that one (c437).
	const f = $derived(
		frame(sw, sh, layout === 'paged' ? settings : { ...settings, columns: false }, vertical, width)
	);
	const mode = $derived(textMode(layout, vertical, direction));
	/**
	 * The page reads right to left: vertical Japanese always, a horizontal book
	 * in PAGED when its DIRECTION is R→L (c440). The controls mirror for both
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
	 * the place was read (c516). A relayout puts it back there. Read as the
	 * line crossing the top margin, the character stood up to a line above that
	 * margin, and putting it on the margin moved the reader a line on every
	 * relayout after a scroll. Null: the margin, as a place opened from the URL
	 * or the server has no finer offset than its character.
	 */
	let posY: number | null = null;
	/**
	 * PAGED: the reader is on a chapter's last page and it is the band alone
	 * (c516). That page has no character, so `pos` stands for the one before it,
	 * which is on the page before; a relayout keeps the reader on the band's
	 * page instead of taking it a page back.
	 */
	let onBand = false;
	let page = $state(0);
	/**
	 * Counts the reader's own moves (`go`, `openChapter`), so a slide can tell
	 * whether something newer moved it while it slid (c515). A relayout is not
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
			label.textContent = cut ? `LISTING · ${cols} COLUMNS, ${shown} SHOWN` : 'LISTING';
		} else {
			label.textContent = cut
				? `TABLE · ${inner.scrollWidth}PX, ${body.clientWidth} SHOWN`
				: 'TABLE';
		}
	}

	/** Where the first character on the page is now. */
	function positionOnPage(): TextPosition | null {
		if (!pageEl) return null;
		const box = pageEl.getBoundingClientRect();
		if (layout === 'scroll') {
			// The first line of text on screen (c516). Before c516 it was the
			// first thing hit, which on an illustration is the figure's start,
			// often a screen higher: a reload or relayout went back up to it.
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
		// page that is the band alone it named a character pages back (found
		// with c441): only a character on this page counts.
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
		// The page's first column: the left one, or in R->L the right one (c440).
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
			page = onBand ? pages - 1 : pageOf(pos);
		}
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
	 * place was kept in the URL (c554, `?at=b.o.y`). Null opens it on the top
	 * margin, as a place from the server or an older link does.
	 */
	async function openChapter(
		i: number,
		at: 'start' | 'end' | TextPosition,
		y: number | null = null
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
		index = i;
		atEnd = false;
		chapter = ch;
		nextChapter = null;
		// The blocks container is empty as far as Svelte knows: it only ever holds
		// the book's text, rebuilt by text-dom.ts, which Svelte never renders.
		// eslint-disable-next-line svelte/no-dom-manipulating
		blocksEl?.replaceChildren(...ch.blocks);
		if (vertical && blocksEl) tateChuYoko(blocksEl);
		watchWide(blocksEl);
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
		pos = at === 'start' || at === 'end' ? { block: 0, offset: 0 } : at;
		await relayout();
		if (at === 'end') {
			page = pages - 1;
			// Read once the flow has moved there: read before, it was the
			// chapter's first character, and the next relayout (a font arriving)
			// took the reader back from the last page (found with c441).
			await tick();
			// A last page that is the band alone has no character to read: the
			// chapter's last one stands for it, so a relayout keeps the reader at
			// the end rather than taking it back to the start (c441).
			const last = ch.blocks.length - 1;
			const here = positionOnPage();
			// And the reader is on the band's page, which that character is not (c516).
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
		// its start being the room drawn below the band (c347), which crosses the
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
			// No `?at=` reads as the chapter's first character, as it always has:
			// the old split read '' as paragraph 0, so the server's place below is
			// reached only by an `?at=` that isn't a place (reader notes, wave 25).
			const place = at === null ? { block: 0, offset: 0, y: null } : parseAt(at);
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

	// A lazy face is declared once it is chosen (c442); its file then arrives on
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
		// before it) out of reach of a turn (found with c441).
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
		// A slide in flight is the old place's: the page shown is this one (c515).
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
		// and a relayout keeps the reader here (c516).
		onBand = !here && layout === 'paged' && page === pages - 1;
		posY = null;
		pos = here ?? pos;
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

	// ---- the slide (c441; doc/TEXT-READER.md, "Turning") ------------------------------------
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
	 * book (c440) is x with -1: its columns run right to left, so the next page
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
			// to it (c515): turning from where that left off went one past it. The
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
	 * the last page in the paged layouts -- the one door to EndPage, and so to
	 * the Work's next part (Work-End). A last chapter too short to scroll never
	 * fires `onscroll`, so a wheel or a key at its bottom reaches it too (see
	 * `wheel` and `keydown`).
	 */
	function reachScrollEnd(): boolean {
		if (layout !== 'scroll' || atEnd || nextReadable || !scrollAtEnd()) return false;
		markFinished();
		atEnd = true;
		return true;
	}

	function onscroll() {
		if (!pageEl || layout !== 'scroll') return;
		// The end page is over the text: what happens under it is not the reader's.
		if (atEnd) return;
		const max = Math.max(1, (blocksEl?.offsetHeight ?? 1) - pageEl.clientHeight);
		scrollFraction = Math.min(1, pageEl.scrollTop / max);
		const first = nextEl?.firstElementChild as HTMLElement | null;
		if (first && first.getBoundingClientRect().top < pageEl.clientHeight / 2) {
			const y = first.getBoundingClientRect().top;
			markFinished();
			void openChapter(index + 1, 'start').then(async () => {
				await tick();
				const top = blocksEl?.firstElementChild as HTMLElement | null;
				if (top && pageEl) {
					pageEl.scrollTop += top.getBoundingClientRect().top - y;
					ownTop = pageEl.scrollTop;
				}
			});
			return;
		}
		if (Math.abs(pageEl.scrollTop - ownTop) > 1) readerMoved = true;
		clearTimeout(scrolling);
		scrolling = setTimeout(() => {
			pos = positionOnPage() ?? pos;
			onBand = false;
			// Where its character stands now, so a relayout leaves it there (c516).
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
			queuePending(body);
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
			// On the way out the window's entry may be the next screen's (c565).
			if (leavingReader()) return;
			void send('page');
			// eslint-disable-next-line svelte/prefer-svelte-reactivity -- a one-off copy, never read reactively
			const url = new URL(appPage.url);
			url.pathname = resolve('/read/[entry]', { entry: String(id) });
			url.search = '';
			// SCROLL keeps the line's height too (c554), so a reload lands on it.
			url.searchParams.set('at', formatAt(p, layout === 'scroll' ? posY : null));
			// eslint-disable-next-line svelte/no-navigation-without-resolve -- the path is resolve()d above
			replaceState(url, {});
			// The chapter may be another than the page was opened at: the guard
			// above must take this path as the reader's own (c565, round 2).
			readerMovedTo(url.pathname);
		}, 800);
		return () => clearTimeout(settle);
	});

	afterNavigate(forgetReaderMove);
	beforeNavigate(({ to }) => {
		if (to?.route.id === '/read/[entry]') return;
		// The close carries the place; a settle still to come would write the
		// reader's URL onto the screen being opened (c565).
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
	/** REMEMBER on DIRECTION (c440): the series' from now on, on every device. */
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
	const japanese = $derived(/^ja\b/i.test(book?.pkg.language ?? ''));
	type Lookup = { text: string; at: number; n: number; place: Placement };
	let lookup = $state<Lookup | null>(null);
	let press: ReturnType<typeof setTimeout> | undefined;
	/** The long press fired: the finger lifting afterwards isn't a tap. */
	let pressed = false;
	const PRESS_MS = 450;
	function lookUpAt(x: number, y: number) {
		const root = blocksEl?.contains(document.elementFromPoint(x, y)) ? blocksEl : nextEl;
		const hit = root ? paragraphAt(root, x, y) : null;
		if (!hit) return;
		pressed = true;
		chrome = false;
		lookup = {
			text: hit.text,
			at: hit.at,
			n: hit.n,
			place:
				innerWidth < PHONE_W
					? { kind: 'phone', lift: 0 }
					: { kind: 'side', side: x < innerWidth / 2 ? 'right' : 'left' }
		};
	}
	$effect(() => {
		if (!japanese) return;
		void flushLookups();
		const online = () => void flushLookups();
		addEventListener('online', online);
		return () => removeEventListener('online', online);
	});

	let down: { x: number; y: number } | null = null;
	/** The press's own pointer: a second finger cancels it (c515, src/lib/reader/pointer.ts). */
	const finger = new OnePointer();
	function pointerdown(e: PointerEvent) {
		const which = finger.down(e);
		if (which === 'cancel') return dropPress();
		if (which === 'ignore') return;
		// A press on the controls, a sheet or an overlay is theirs, not the page's.
		const t = e.target as HTMLElement;
		down = t.closest(
			'header, footer, [role="dialog"], .contents, .scrim, .screen, .loading, [aria-label="Lookup"]'
		)
			? null
			: { x: e.clientX, y: e.clientY };
		pressed = false;
		dragging = false;
		clearTimeout(press);
		if (down && japanese && !atEnd) {
			const { x, y } = down;
			press = setTimeout(() => lookUpAt(x, y), PRESS_MS);
		}
	}
	/**
	 * The page follows a sideways drag in the paged layouts (c441), all the way
	 * where there's a page that way in the chapter and a quarter as much where
	 * there isn't. Not in scroll, not with the lookup open, not on the end
	 * page, and not with reduced motion.
	 */
	function pointermove(e: PointerEvent) {
		if (!finger.owns(e)) return;
		if (down && Math.hypot(e.clientX - down.x, e.clientY - down.y) > 10) clearTimeout(press);
		if (!down || layout === 'scroll' || turning || lookup || atEnd || reduceMotion.current) return;
		const dx = e.clientX - down.x;
		const dy = e.clientY - down.y;
		if (!dragging && !dragStarts(dx, dy)) return;
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
		down = null;
		if (dragging) void settleBack();
		dragging = false;
	}
	function pointerup(e: PointerEvent) {
		if (!finger.owns(e)) return;
		finger.end();
		clearTimeout(press);
		if (pressed) {
			pressed = false;
			down = null;
			return;
		}
		if (!down) return;
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
		if (atEnd) {
			if (tapAction(e.clientX, window.innerWidth, mode, TEXT_EDGE) === 'prev') prev();
			return;
		}
		const target = e.target as HTMLElement;
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
				meta: `${series.title.toUpperCase()} · ${short(entry)} · ${box.querySelector('.wlabel')?.textContent ?? ''}`,
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
	function hover(e: PointerEvent) {
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
	 * OK brings the chrome up (c235), and on a TV puts the pad on its scrubber
	 * (c241): the next ↓ reaches CONTENTS and READING.
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
		// The lookup has the keyboard: Escape closes it (the panel's own).
		if (lookup) return;
		if (fullImage || wide) {
			if (e.key === 'Escape') fullImage = wide = null;
			return;
		}
		if (sheet || contents) {
			if (e.key === 'Escape') sheet = contents = false;
			return;
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
		// On a TV with the chrome up the pad owns the arrows and the turn keys
		// (c241): an arrow moves among the chrome's cells, BACK hides it.
		// An arrow that found no cell is not the browser's either: on a strip
		// its own scroll moved the chapter 40px under the chrome (c253). Space
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

	// BACK (c235): what is open first, then the chrome, then the series. The
	// layer hands it here because this screen reads its own keys.
	$effect(() =>
		registerBack(() => {
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
		if (lookup || fullImage || wide || sheet || contents) return;
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
	const nextAbout = $derived(
		nextReadable ? aboutMinutes(Math.round((nextReadable.bytes || 0) * 0.6), speed) : ''
	);
	const noSelection = new SvelteSet<number>();
	const noCache = new SvelteSet<number>();
</script>

<svelte:head><title>{series.title} · {entry?.label ?? ''}</title></svelte:head>
<svelte:window onkeydown={keydown} onpointermove={hover} />

<div
	class="text-reader"
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
	oncontextmenu={(e) => japanese && e.preventDefault()}
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
					<!-- The next volume is another download (c347): a screen of room where
					     its first chapter will be, so its start crosses the middle of the
					     screen as any next chapter's does, and the crossing opens it, with
					     OPENING over it while it downloads, as a turn does in PAGED. -->
					<div class="blocks next" bind:this={nextEl}>
						<div class="volume-room" aria-hidden="true"></div>
					</div>
				{:else}
					<div class="blocks next" bind:this={nextEl}></div>
				{/if}
			{/if}
		</div>
	</div>

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
					pageEl.scrollTop = (p / 99) * Math.max(0, blocksEl.offsetHeight - pageEl.clientHeight);
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
		<!-- A focus scope (c250): on a TV with the chrome up the pad goes in, on the
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

	{#if lookup && entry}
		<LookupPanel
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
		position: fixed;
		inset: 0;
		overflow: hidden;
		background: var(--ground);
		color: var(--text-1);
		user-select: none;
		-webkit-user-select: none;
		-webkit-touch-callout: none;
	}
	.text-reader.paper {
		--ground: var(--paper-50);
		--prose: var(--paper-950);
		--ink: var(--paper-950);
		--mut: var(--paper-600);
		--pl1: var(--paper-200);
		--pl2: var(--paper-300);
		--ill: 1;
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
	 * Paged, the flow moves by its transform alone (c441): following a drag,
	 * or sliding a turn, and the columns are never laid out again for it. It
	 * is a layer of its own only while it moves: kept as one, a long
	 * chapter's flow (56 pages, 45,000px wide) made the slides' frames worse,
	 * not better (measured, doc/handoff-notes/reader.md, wave 20). Horizontal
	 * pans are the reader's, so a drag reaches it rather than the browser.
	 */
	.text-reader:not(.scroll) {
		touch-action: pan-y pinch-zoom;
	}
	.flow.moving {
		will-change: transform;
	}
	/*
	 * R->L (c440): the columns run right to left, so the next page lies to the
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
		background: var(--surface-page);
		border-top: 1px solid var(--text-1);
		border-bottom: 1px solid var(--text-1);
		text-align: left;
	}
	/* As tall as the screen, so the room's top can reach the middle of it. */
	.volume-room {
		height: 100dvh;
	}
	.sband .rule {
		height: 1px;
		background: var(--line-1);
	}
	.sband .nx {
		display: flex;
		flex-direction: column;
		gap: 8px;
	}
	.sband .nx .t {
		font: 500 34px / 1.2 var(--font-sans);
		color: var(--text-1);
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
		background: var(--surface-page);
		border-top: 1px solid var(--text-1);
	}
	.contents.short {
		top: 120px;
	}
	.dim {
		position: absolute;
		inset: 0;
		z-index: 50;
		background: #000;
		pointer-events: none;
	}
</style>

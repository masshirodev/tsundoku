import type { Mode } from './reader';

/**
 * The text reader's rules (Index Text Reader; doc/TEXT-READER.md), pure so
 * they're tested without a browser. The DOM side -- turning a chapter's XHTML
 * into blocks, laying them out, finding the first character on a page -- is
 * src/lib/reader/text-dom.ts.
 */

export type Layout = 'paged' | 'scroll';
export type Theme = 'dark' | 'paper';
export type TextFont = 'serif' | 'sans' | 'opendyslexic';
export type Margins = 'narrow' | 'normal' | 'wide';
export type Furigana = 'all' | 'unknown' | 'none';
export type Device = 'tablet' | 'landscape' | 'phone';

/** What belongs to the device, kept in this browser like the image reader's FIT. */
export type TextSettings = {
	theme: Theme;
	font: TextFont;
	/** Null: the device's own default size, and line height. */
	size: number | null;
	line: number | null;
	margins: Margins;
	justify: boolean;
	/** Two columns in landscape. */
	columns: boolean;
	furigana: Furigana;
};

export const DEFAULT_SETTINGS: TextSettings = {
	theme: 'dark',
	font: 'serif',
	size: null,
	line: null,
	margins: 'normal',
	justify: true,
	columns: true,
	furigana: 'all'
};

/**
 * The reading fonts (doc/TEXT-READER.md, "FONT"), in the FONT row's order.
 * `family` is the flow's whole stack: a face without a glyph falls through to
 * Plex's Japanese and Korean, so a mixed novel shows no boxes. `lazy` faces
 * are declared by src/lib/styles/fonts-reading.css, which the page imports
 * once one is chosen or the FONT row is drawn (`loadReadingFonts`); their
 * woff2 are precached by the service worker regardless. Plex is the app's own
 * and always there.
 */
export const TEXT_FONTS: readonly {
	id: TextFont;
	/** The FONT row's name, drawn in the font itself. */
	name: string;
	/** The READING cell's word: "PAGED · SERIF 20 · DARK". */
	word: string;
	family: string;
	lazy: boolean;
}[] = [
	{ id: 'serif', name: 'Plex Serif', word: 'SERIF', family: 'var(--font-serif)', lazy: false },
	{ id: 'sans', name: 'Plex Sans', word: 'SANS', family: 'var(--font-sans)', lazy: false },
	{
		id: 'opendyslexic',
		name: 'OpenDyslexic',
		word: 'DYSLEXIC',
		family: "'OpenDyslexic', 'IBM Plex Sans JP', 'IBM Plex Sans KR', var(--font-sans)",
		lazy: true
	}
];

/**
 * A stored FONT as one this build knows: anything else (a value from a newer
 * build, a hand-edited one) is the default, never an empty font-family.
 */
export function textFont(v: unknown): TextFont {
	return TEXT_FONTS.find((f) => f.id === v)?.id ?? DEFAULT_SETTINGS.font;
}

export const fontOf = (font: TextFont) => TEXT_FONTS.find((f) => f.id === font) ?? TEXT_FONTS[0];

/** The device's stored settings over the defaults, each value one this build knows. */
export function textSettings(stored: Partial<TextSettings> | null | undefined): TextSettings {
	const s = { ...DEFAULT_SETTINGS, ...(stored ?? {}) };
	return { ...s, font: textFont(s.font) };
}

let readingFonts: Promise<unknown> | null = null;
/**
 * Declare the lazy faces, once: called when such a font is chosen or READING
 * is open, since the FONT row draws each name in its own face, so opening
 * READING fetches OpenDyslexic's woff2 too. Declaring costs a stylesheet of
 * three @font-face rules. The woff2 files are in the build either way, so the
 * service worker precaches them on every installed device (doc/OFFLINE.md),
 * which is what lets the font work offline once chosen; this only decides
 * when the page asks for them, and after install that is answered from cache.
 */
export function loadReadingFonts(): Promise<unknown> {
	readingFonts ??= import('$lib/styles/fonts-reading.css').catch(() => {
		readingFonts = null;
	});
	return readingFonts;
}

export const SIZE_MIN = 14;
export const SIZE_MAX = 30;
export const LINES = [1.4, 1.6, 1.8] as const;

export function deviceOf(w: number, h: number): Device {
	if (Math.min(w, h) < 600) return 'phone';
	return w > h ? 'landscape' : 'tablet';
}

/**
 * The page's frame, from the handoff's three devices: tablet portrait
 * (72px sides, 88px top and bottom, 20/1.6), landscape (72/64, 19/1.6, two
 * columns 96px apart) and phone (24/56, 18/1.55). MARGINS scales the sides.
 */
export type Frame = {
	x: number;
	y: number;
	w: number;
	h: number;
	cols: number;
	gap: number;
	fontSize: number;
	lineHeight: number;
	headSize: number;
};

const BASE: Record<Device, { side: number; top: number; fs: number; lh: number; hs: number }> = {
	tablet: { side: 72, top: 88, fs: 20, lh: 1.6, hs: 30 },
	landscape: { side: 72, top: 64, fs: 19, lh: 1.6, hs: 28 },
	phone: { side: 24, top: 56, fs: 18, lh: 1.55, hs: 24 }
};
const SIDE: Record<Margins, number> = { narrow: 2 / 3, normal: 1, wide: 14 / 9 };

/** The size a device reads at until SIZE is changed: what the SETTINGS stepper starts from. */
export const baseFontSize = (device: Device) => BASE[device].fs;

/**
 * WIDTH (card c437; doc/TEXT-READER.md, "WIDTH"): how much of the screen's
 * width the text takes, or PAGE, a page of A4's proportion (1 : √2) as tall
 * as the text area, centred. 100% is the column every device drew before
 * WIDTH (the screen less MARGINS), so it is the default and nobody's page
 * changed on upgrade. The owner, 2026-11-03: "in case you want a A4 page on
 * center or the content area with text"; on a PC the whole screen less its
 * margins was a line too long to read.
 */
export type TextWidth = 50 | 65 | 80 | 100 | 'page';
export const TEXT_WIDTHS: readonly [TextWidth, string][] = [
	[50, '50%'],
	[65, '65%'],
	[80, '80%'],
	[100, '100%'],
	['page', 'PAGE']
];
export const DEFAULT_WIDTH: TextWidth = 100;
/** A stored width this build knows, or null for anything else (a newer build's, a hand edit). */
export const parseTextWidth = (raw: unknown): TextWidth | null =>
	TEXT_WIDTHS.find(([w]) => w === raw)?.[0] ?? null;
/** The WIDTH row's name for a width: "65%", "PAGE". */
export const textWidthName = (w: TextWidth) => TEXT_WIDTHS.find(([v]) => v === w)![1];
/**
 * The narrowest a column is drawn, in ems of the body text: about forty
 * characters, the shortest line that still reads as prose. A step that would
 * go below it stops there, so on a phone 50% is the phone's whole column
 * (50% of 412 px is 206 px, a dozen words a line), and the narrow steps only
 * narrow where there is room.
 */
export const MIN_MEASURE_EM = 20;

/**
 * Where the browser keeps WIDTH: the series' own, and the device's default,
 * which is the last width chosen on this device, for a series with none.
 */
export const WIDTH_KEY = 'tsundoku.text.width';
export const widthKeyOf = (seriesId: number) => `${WIDTH_KEY}.${seriesId}`;
/** The width a series opens at: its own, else the device's, else 100%. */
export const widthFor = (own: unknown, device: unknown): TextWidth =>
	parseTextWidth(own) ?? parseTextWidth(device) ?? DEFAULT_WIDTH;

/**
 * One column's width at `width`: a share of the screen (both columns and the
 * gap between them, in landscape's two), or a page of A4's proportion as tall
 * as the column; never past the full column, never under MIN_MEASURE_EM.
 */
function columnAt(
	width: TextWidth,
	o: { screenW: number; full: number; cols: number; gap: number; h: number; fontSize: number }
): number {
	const gaps = (o.cols - 1) * o.gap;
	const full = (o.full - gaps) / o.cols;
	const want = width === 'page' ? o.h / Math.SQRT2 : ((o.screenW * width) / 100 - gaps) / o.cols;
	const floor = Math.min(full, MIN_MEASURE_EM * o.fontSize);
	return Math.min(full, Math.max(floor, want));
}

export function frame(
	screenW: number,
	screenH: number,
	s: TextSettings,
	vertical = false,
	width: TextWidth = DEFAULT_WIDTH
): Frame {
	const device = deviceOf(screenW, screenH);
	const b = BASE[device];
	const side = Math.round(b.side * SIDE[s.margins]);
	const fontSize = s.size ?? b.fs;
	const cols = device === 'landscape' && s.columns && !vertical ? 2 : 1;
	const full = Math.max(120, screenW - side * 2);
	const h = Math.max(120, screenH - b.top * 2);
	const gap = cols > 1 ? 96 : side * 2;
	// Vertical text's column runs down the page, so WIDTH is how wide the page
	// of columns is, not a line's length: fewer lines a page, the same lines.
	const w =
		width === 100
			? full
			: Math.round(columnAt(width, { screenW, full, cols, gap, h, fontSize }) * cols) +
				(cols - 1) * gap;
	return {
		// Centred: the margin each side takes up what the column gave back.
		x: side + Math.floor((full - w) / 2),
		y: b.top,
		w,
		h,
		cols,
		gap,
		fontSize,
		lineHeight: s.line ?? b.lh,
		// Headings keep the handoff's proportion to the body (30 to 20).
		headSize: s.size === null ? b.hs : Math.round(fontSize * 1.5)
	};
}

/**
 * The READING cell in the controls: "PAGED · SERIF 20 · DARK", and "PAGED R→L ·
 * …" when a horizontal book's pages turn right to left (c440).
 */
export function settingsLabel(o: {
	layout: Layout;
	font: TextFont;
	size: number;
	theme: Theme;
	vertical: boolean;
	furigana: Furigana;
	direction?: TextDirection;
}): string {
	if (o.vertical) return `VERTICAL · SANS JP ${o.size} · FURIGANA ${o.furigana.toUpperCase()}`;
	const way = o.layout === 'paged' && o.direction === 'rtl' ? ' R→L' : '';
	return `${o.layout.toUpperCase()}${way} · ${fontOf(o.font).word} ${o.size} · ${o.theme.toUpperCase()}`;
}

/**
 * Which way a horizontal book's paged pages turn (card c440): L→R, reading on
 * to the right, or R→L, reading on to the left. Never how the text runs. The
 * series' own, else L→R; vertical Japanese and SCROLL don't use it.
 */
export type TextDirection = 'ltr' | 'rtl';
export const TEXT_DIRECTIONS: readonly [TextDirection, string][] = [
	['ltr', 'L→R'],
	['rtl', 'R→L']
];
/** A stored or posted direction, or null for anything else. */
export const parseTextDirection = (raw: unknown): TextDirection | null =>
	raw === 'ltr' || raw === 'rtl' ? raw : null;
/** The direction's name on the sheet: "L→R", "R→L". */
export const textDirectionName = (d: TextDirection) => TEXT_DIRECTIONS.find(([v]) => v === d)![1];

/**
 * The reader's touch mode: turning left-to-right, right-to-left, or none.
 * SCROLL never turns; vertical Japanese always turns right to left; a
 * horizontal book in PAGED turns the way its DIRECTION says (c440).
 */
export function textMode(
	layout: Layout,
	vertical: boolean,
	direction: TextDirection = 'ltr'
): Mode {
	if (layout === 'scroll') return 'vertical';
	return vertical ? 'rtl' : direction;
}

/**
 * A book is set vertically when it's Japanese, or when its spine says pages
 * turn right to left. Other languages keep horizontal lines.
 */
export const isVerticalBook = (language: string, rtl: boolean) =>
	/^ja\b/i.test(language.trim()) || rtl;

// ---- where you are --------------------------------------------------------------

export type BookEntry = { bytes: number; matter: '' | 'front' | 'back' };

/**
 * How far through the whole book: the entries before this one, plus the
 * fraction of this one, weighed by size. Sizes come from the importer; where
 * one is missing, every entry counts the same.
 */
export function bookFraction(entries: BookEntry[], index: number, inEntry: number): number {
	if (entries.length === 0) return 0;
	const sized = entries.every((e) => e.bytes > 0);
	const weight = (e: BookEntry) => (sized ? e.bytes : 1);
	const total = entries.reduce((a, e) => a + weight(e), 0);
	const before = entries.slice(0, index).reduce((a, e) => a + weight(e), 0);
	const here = entries[index] ? weight(entries[index]) : 0;
	return Math.max(0, Math.min(1, (before + here * Math.max(0, Math.min(1, inEntry))) / total));
}

const pct = (f: number) => `${Math.floor(f * 100)}%`;

/**
 * The top bar's meta line. Front and back matter are named, not numbered:
 * "NOVEL · COVER · 0% OF BOOK".
 */
export function textMetaLine(o: {
	chapters: number;
	/** 1-based among the chapters, or null for matter. */
	chapter: number | null;
	label: string;
	bookFraction: number;
	incognito: boolean;
}): string {
	const kind = o.chapters >= 100 ? 'WEB NOVEL' : 'NOVEL';
	const where =
		o.chapter === null
			? o.label.toUpperCase()
			: `CH. ${o.chapter.toLocaleString('en-US')} OF ${o.chapters.toLocaleString('en-US')}`;
	const line = `${kind} · ${where} · ${pct(o.bookFraction)} OF BOOK`;
	return o.incognito ? `${line} · NOT SAVED` : line;
}

/** Page within the chapter, and time left when there's enough history to guess it. */
export function textPageLabel(page: number, pages: number, minutesLeft: number | null): string {
	const p = `P. ${page + 1} OF ${Math.max(1, pages)}`;
	return minutesLeft === null ? p : `${p} · ${minutesLeft} MIN LEFT`;
}

// ---- reading speed ----------------------------------------------------------------

/** Characters read and the time it took, summed across sessions on this device. */
export type Speed = { chars: number; ms: number };

/** Below ten minutes of history a guess is noise, so time left is left out. */
export const SPEED_MIN_MS = 10 * 60_000;
/** A page held longer than this is a pause, not reading. */
const PAGE_CAP_MS = 2 * 60_000;

export function addReading(speed: Speed, chars: number, ms: number): Speed {
	if (chars <= 0 || ms <= 0) return speed;
	return { chars: speed.chars + chars, ms: speed.ms + Math.min(ms, PAGE_CAP_MS) };
}

export function minutesLeft(charsLeft: number, speed: Speed): number | null {
	if (speed.ms < SPEED_MIN_MS || speed.chars <= 0) return null;
	const perMinute = (speed.chars / speed.ms) * 60_000;
	return Math.max(1, Math.ceil(charsLeft / perMinute));
}

/** "ABOUT 12 MIN" on a boundary, for the next chapter, from its size. */
export function aboutMinutes(chars: number, speed: Speed): string {
	const m = minutesLeft(chars, speed);
	return m === null ? '' : `ABOUT ${m} MIN`;
}

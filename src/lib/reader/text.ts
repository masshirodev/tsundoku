import type { Mode } from './reader';

/**
 * The text reader's rules (Index Text Reader; doc/TEXT-READER.md), pure so
 * they're tested without a browser. The DOM side -- turning a chapter's XHTML
 * into blocks, laying them out, finding the first character on a page -- is
 * src/lib/reader/text-dom.ts.
 */

export type Layout = 'paged' | 'scroll';
export type Theme = 'dark' | 'paper';
export type TextFont = 'serif' | 'sans';
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

export function frame(screenW: number, screenH: number, s: TextSettings, vertical = false): Frame {
	const device = deviceOf(screenW, screenH);
	const b = BASE[device];
	const side = Math.round(b.side * SIDE[s.margins]);
	const fontSize = s.size ?? b.fs;
	const cols = device === 'landscape' && s.columns && !vertical ? 2 : 1;
	return {
		x: side,
		y: b.top,
		w: Math.max(120, screenW - side * 2),
		h: Math.max(120, screenH - b.top * 2),
		cols,
		gap: cols > 1 ? 96 : side * 2,
		fontSize,
		lineHeight: s.line ?? b.lh,
		// Headings keep the handoff's proportion to the body (30 to 20).
		headSize: s.size === null ? b.hs : Math.round(fontSize * 1.5)
	};
}

/** The READING cell in the controls: "PAGED · SERIF 20 · DARK". */
export function settingsLabel(o: {
	layout: Layout;
	font: TextFont;
	size: number;
	theme: Theme;
	vertical: boolean;
	furigana: Furigana;
}): string {
	if (o.vertical) return `VERTICAL · SANS JP ${o.size} · FURIGANA ${o.furigana.toUpperCase()}`;
	return `${o.layout.toUpperCase()} · ${o.font.toUpperCase()} ${o.size} · ${o.theme.toUpperCase()}`;
}

/** The reader's touch mode: turning left-to-right, right-to-left (vertical Japanese), or none. */
export function textMode(layout: Layout, vertical: boolean): Mode {
	if (layout === 'scroll') return 'vertical';
	return vertical ? 'rtl' : 'ltr';
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

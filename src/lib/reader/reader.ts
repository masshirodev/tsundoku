import type { Direction } from '$lib/library/series';
import type { Kind } from '$lib/library/types';
import type { Medium } from '$lib/library/kinds';

/**
 * The image reader's rules (doc/READER.md), pure so they can be tested
 * without a browser: which tap does what, how pages pair into spreads, what
 * the chrome says, and when progress is worth sending.
 */

export type Mode = 'rtl' | 'ltr' | 'vertical';
export type Fit = 'width' | 'height' | 'screen';
export type Action = 'next' | 'prev' | 'chrome';

/** The reader's mode for a series direction; a novel's layouts aren't image modes. */
export function modeOf(direction: Direction): Mode {
	return direction === 'ltr' ? 'ltr' : direction === 'vertical' ? 'vertical' : 'rtl';
}

// ---- touch ----------------------------------------------------------------------

/**
 * Tap zones (Reader States 1f): two 16% edge strips turn, the middle shows or
 * hides the controls. Right-to-left reads forward to the left, so the left
 * strip turns forward there; left-to-right mirrors it. Vertical scroll has no
 * turn: every tap is the controls. Phase 2 adds one rule on top -- a tap on
 * an OCR'd bubble opens the lookup -- and these zones stay as they are.
 */
export const EDGE = 0.16;
/**
 * A novel's strips are wider (doc/TEXT-READER.md, "Touch"): text has no panel
 * to tap into, so the middle only has to be big enough to reach the controls.
 * The owner asked for this on 2026-10-22.
 */
export const TEXT_EDGE = 0.3;

export function tapAction(x: number, width: number, mode: Mode, edge = EDGE): Action {
	if (mode === 'vertical' || width <= 0) return 'chrome';
	const f = x / width;
	if (f < edge) return mode === 'rtl' ? 'next' : 'prev';
	if (f > 1 - edge) return mode === 'rtl' ? 'prev' : 'next';
	return 'chrome';
}

/**
 * A mouse, on a PC (doc/READER.md, "Mouse"): in L->R and R->L a click anywhere
 * turns forward and a right click turns back, whichever way the pages run --
 * the buttons are about reading on, not about sides. The middle button shows
 * the controls, as Esc does. Vertical scrolls with the wheel, so its clicks
 * keep the touch rules (null).
 */
export function mouseAction(button: number, mode: Mode): Action | null {
	if (mode === 'vertical') return null;
	if (button === 0) return 'next';
	if (button === 2) return 'prev';
	if (button === 1) return 'chrome';
	return null;
}

/** A swipe turns anywhere: dragging the page towards the reading direction's start. */
export const SWIPE_PX = 40;

export function swipeAction(dx: number, dy: number, mode: Mode): Action | null {
	if (mode === 'vertical' || Math.abs(dx) < SWIPE_PX || Math.abs(dx) < Math.abs(dy) * 1.5)
		return null;
	// R->L: the next page lies to the left, so it is pulled in by dragging right.
	return dx > 0 === (mode === 'rtl') ? 'next' : 'prev';
}

// ---- spreads ---------------------------------------------------------------------

export type Page = { w: number; h: number };

/**
 * A page's shape for its box. A page read online has none until it arrives:
 * sources don't say how big their images are (src/lib/server/pages/online.ts).
 * So the shape its image had once it loaded (`learned`), or else the last
 * shape any page of this reader loaded with (`last`), on the bet that a
 * chapter's pages are mostly alike: a manhwa's tall slices above all, which a
 * manga-shaped guess drew as a narrow column (2026-10-29). Neither, and it
 * stays unknown, which PageImage draws as a manga page.
 */
export function shapeOf(p: Page, learned?: Page | null, last?: Page | null): Page {
	if (p.w > 0 && p.h > 0) return p;
	return learned ?? last ?? p;
}

/** A page wider than it is tall is a spread already: it is shown alone. */
export const isWide = (p: Page) => p.w > 0 && p.h > 0 && p.w > p.h * 1.1;

/**
 * Pages grouped into what one screen shows. Without spreads, one page each.
 * With spreads (landscape only), pages pair up after the first, which is a
 * cover shown alone; a wide page stands alone and restarts the pairing after
 * it. `shift` moves the pairing by one, for a chapter whose spreads split
 * wrong (SHIFT PAIRING). Indices are in reading order; which one sits on the
 * left is the view's business.
 */
export function spreads(pages: Page[], on: boolean, shift = false): number[][] {
	if (!on) return pages.map((_, i) => [i]);
	const out: number[][] = [];
	let i = 0;
	// The cover stands alone; shifting pairs it instead.
	if (pages.length && !shift) out.push([i++]);
	while (i < pages.length) {
		if (isWide(pages[i]) || i + 1 >= pages.length || isWide(pages[i + 1])) {
			out.push([i]);
			i += 1;
		} else {
			out.push([i, i + 1]);
			i += 2;
		}
	}
	return out;
}

/** The spread holding page `page`. */
export const spreadOf = (groups: number[][], page: number) =>
	Math.max(
		0,
		groups.findIndex((g) => g.includes(page))
	);

// ---- what the chrome says --------------------------------------------------------

export type EntryRef = { id: number; label: string; number: number };

/** "CH. 41", "BOOK 2", "VOL. 3": an entry as the chrome names it. */
export function entryName(e: { label: string } | null, kind: Kind, bookIndex?: number): string {
	if (!e) return '';
	if (kind === 'doujin' && bookIndex !== undefined) return `BOOK ${bookIndex + 1}`;
	return e.label.toUpperCase();
}

/** "Ch. 42" -> "Chapter 42", as the boundary pages name what comes next. */
export function spelledOut(label: string): string {
	return label
		.replace(/^ch\.?\s*/i, 'Chapter ')
		.replace(/^vol\.?\s*/i, 'Volume ')
		.replace(/^book\b/i, 'Book');
}

/** "P. 14 OF 22", or "P. 14–15 OF 22" for a spread. */
export function pageLabel(group: number[], total: number): string {
	if (group.length === 0) return '';
	const a = group[0] + 1;
	const b = group[group.length - 1] + 1;
	return a === b ? `P. ${a} OF ${total}` : `P. ${Math.min(a, b)}–${Math.max(a, b)} OF ${total}`;
}

/** "MANGA · CH. 41 OF 58 · P. 14 OF 22", and NOT SAVED while incognito. */
export function metaLine(o: {
	kind: Kind;
	entry: string;
	count: number;
	page: string;
	incognito: boolean;
	single: boolean;
	/** Read from its source (doc/BROWSING.md): "CH. 396 OF 612 · ONLINE · P. 14 OF 54". */
	online?: boolean;
	/** A browsing record: the line ends NOT IN LIBRARY. */
	record?: boolean;
}): string {
	const parts = [o.kind.toUpperCase()];
	if (!o.single) parts.push(`${o.entry} OF ${o.count}`);
	if (o.online) parts.push('ONLINE');
	if (o.page) parts.push(o.page);
	if (o.incognito) parts.push('NOT SAVED');
	if (o.record) parts.push('NOT IN LIBRARY');
	return parts.join(' · ');
}

const MODE_NAME: Record<Mode, string> = { rtl: 'R→L', ltr: 'L→R', vertical: 'VERTICAL' };
const FIT_NAME: Record<Fit, string> = {
	width: 'FIT WIDTH',
	height: 'FIT HEIGHT',
	screen: 'FIT SCREEN'
};
export const modeName = (m: Mode) => MODE_NAME[m];

/** The middle cell: "R→L · SPREAD · FIT SCREEN". */
export function settingsLabel(mode: Mode, fit: Fit, spread: boolean): string {
	if (mode === 'vertical') return 'VERTICAL · FIT WIDTH';
	return [MODE_NAME[mode], spread ? 'SPREAD' : null, FIT_NAME[fit]].filter(Boolean).join(' · ');
}

/**
 * The chapter cells follow the reading direction: in R->L the next chapter
 * is on the left ("← CH. 42") and the previous on the right ("CH. 40 →").
 */
export function chapterCells(
	mode: Mode,
	prev: string | null,
	next: string | null
): {
	left: { label: string; to: 'prev' | 'next' } | null;
	right: { label: string; to: 'prev' | 'next' } | null;
} {
	const cell = (label: string | null, to: 'prev' | 'next', arrow: 'l' | 'r') =>
		label ? { label: arrow === 'l' ? `← ${label}` : `${label} →`, to } : null;
	return mode === 'rtl'
		? { left: cell(next, 'next', 'l'), right: cell(prev, 'prev', 'r') }
		: { left: cell(prev, 'prev', 'l'), right: cell(next, 'next', 'r') };
}

/**
 * The scrubber fills with the reading direction: from the right in R->L.
 * Returns the fill's left edge and width, as percentages, and the page a
 * point on the track means.
 */
export function scrubFill(
	page: number,
	total: number,
	mode: Mode
): { left: number; width: number } {
	const width = total <= 0 ? 0 : ((page + 1) / total) * 100;
	return mode === 'rtl' ? { left: 100 - width, width } : { left: 0, width };
}

export function scrubPage(fraction: number, total: number, mode: Mode): number {
	const f = Math.min(1, Math.max(0, mode === 'rtl' ? 1 - fraction : fraction));
	return Math.min(total - 1, Math.max(0, Math.floor(f * total)));
}

// ---- progress ------------------------------------------------------------------------

/**
 * Reading time, as the reading log wants it (doc/READING-LOG.md): the gap
 * since the last event in the same sitting, capped, so a tablet left open on
 * a page overnight is not eight hours of reading.
 *
 * The cap is the longest a page can plausibly hold someone, so it is the
 * medium's (card c443), asked of the registry (`kindFacts(kind).medium`):
 *
 * - **pages**: 2 minutes, as since the log began. A manga page or a strip's
 *   screen is read in seconds.
 * - **text**: 5 minutes. A page of prose at the default size holds 352 words
 *   on a tablet held upright and 391 on one held sideways (two columns),
 *   counted on screen in the text reader (doc/READING-LOG.md, "The caps").
 *   At 80 words a minute, a slow and careful pace well under the ~260 of
 *   adult fiction reading, 391 words is 4.9 minutes.
 *
 * Video has no idle cap: its time is what played, counted by `WatchClock`.
 */
export const IDLE_CAPS = { pages: 2 * 60_000, text: 5 * 60_000 } as const satisfies Partial<
	Record<Medium, number>
>;
/** The image reader's cap, the one the log started with. */
export const IDLE_CAP_MS = IDLE_CAPS.pages;

export class ProgressClock {
	private last: number;
	private readonly cap: number;
	constructor(now: number, cap: number = IDLE_CAP_MS) {
		this.last = now;
		this.cap = cap;
	}
	/** Time read since the last event, capped, and restart the clock. */
	lap(now: number): number {
		const d = Math.max(0, Math.min(this.cap, now - this.last));
		this.last = now;
		return d;
	}
	/** Coming back from the background: time away is not reading. */
	resume(now: number): void {
		this.last = now;
	}
}

/**
 * Watching time (card c443): only what actually played. The player reports
 * each `timeupdate` -- the wall clock and the position -- and a step counts
 * only when the position moved forward about as far as the clock did:
 *
 * - **paused, buffering** (`waiting`, `stalled`): the position stands still,
 *   so the step adds nothing however long it was;
 * - **a seek** jumps the position further than the clock moved, or back:
 *   nothing, and the next step counts from where it landed;
 * - **a hidden document** is not watching, unless the picture is in a
 *   floating window: the player says so with `watching: false`;
 * - **faster or slower playback** counts the wall time, which is the time
 *   spent: a step is the smaller of the two, the position read at the rate.
 *
 * A step is believed up to `STEP_SLACK_MS` past the clock (timeupdate's own
 * jitter); `lap` hands what built up since the last event to the log, capped
 * at `WATCH_LAP_CAP_MS`. The player sends a `page` event every 15 s while
 * playing, so a lap past the cap means the heartbeat stopped while time kept
 * running, which is not watching anyone can vouch for.
 */
export const STEP_SLACK_MS = 1_000;
export const WATCH_LAP_CAP_MS = 60_000;

export class WatchClock {
	private at: number | null = null;
	private position = 0;
	private banked = 0;

	/** One `timeupdate`: `now` in ms, `position` in seconds into the episode. */
	tick(now: number, position: number, opts: { rate?: number; watching?: boolean } = {}): void {
		const rate = opts.rate && opts.rate > 0 ? opts.rate : 1;
		if (this.at !== null && opts.watching !== false) {
			const wall = now - this.at;
			const played = ((position - this.position) * 1000) / rate;
			if (wall > 0 && played > 0 && played <= wall + STEP_SLACK_MS)
				this.banked += Math.min(wall, played);
		}
		this.at = now;
		this.position = position;
	}

	/** Paused, ended or left: the next tick starts a new step rather than spanning the gap. */
	stop(): void {
		this.at = null;
	}

	/** What played since the last lap, capped, and start counting again. */
	lap(): number {
		const d = Math.min(WATCH_LAP_CAP_MS, Math.round(this.banked));
		this.banked = 0;
		return d;
	}
}

/**
 * A chapter on the vertical strip (doc/READER.md, "Vertical"): the strip holds
 * the one being read and its neighbours, as Mihon's webtoon reader does.
 */
export type StripChapter = {
	id: number;
	name: string;
	title: string;
	pageCount: number;
	/** "213 OF 243" */
	position: string;
	cached: boolean;
	/** Null while its manifest is on its way. */
	pages: Page[] | null;
	version: string;
};

/**
 * The strip's chapters once `current` is the one being read: it and its
 * neighbours, in reading order. What the strip already holds is kept (its
 * pages are loaded); a neighbour it doesn't hold yet comes as `make` builds it.
 * Anything further away goes.
 */
export function stripWindow<C extends { id: number }>(
	held: C[],
	current: C,
	prev: C | null,
	next: C | null
): C[] {
	const keep = (c: C) => held.find((h) => h.id === c.id) ?? c;
	return [...(prev ? [keep(prev)] : []), keep(current), ...(next ? [keep(next)] : [])];
}

/**
 * A wide page outside spreads (doc/READER.md, "Wide pages"): shown whole
 * (FIT), as its two halves one after the other (SPLIT), or turned a quarter
 * to fill a portrait screen (ROTATE). Spreads show a wide page whole anyway.
 */
export type Wide = 'fit' | 'split' | 'rotate';

export function wideTreatment(
	p: Page | undefined,
	o: { mode: Mode; spreads: boolean; wide: Wide }
): Wide {
	if (!p || o.mode === 'vertical' || o.spreads || !isWide(p)) return 'fit';
	return o.wide;
}

/** The half read first: the right one in R->L, where reading starts on the right. */
export const firstHalf = (mode: Mode): 'left' | 'right' => (mode === 'rtl' ? 'right' : 'left');

/**
 * The pages to have loaded before they're asked for (doc/READER.md,
 * "Preloading"): the next two screens and the one before, in the order
 * they're likely needed. `groups` are the screens (spreads or single pages),
 * `g` the one showing.
 */
export function pagesAhead(groups: number[][], g: number): number[] {
	return [g + 1, g - 1, g + 2].flatMap((k) => groups[k] ?? []);
}

/** Close enough to the chapter's end to fetch the next chapter's first pages. */
export const nearEnd = (groups: number[][], g: number) => g >= groups.length - 2;

/** How near the top or bottom of the window the pointer brings the controls up. */
export const HOVER_EDGE = 56;

/**
 * A mouse resting at the top or bottom of the window shows the controls, as
 * a PC reader's bars do (doc/READER.md, "Mouse"): a click turns the page, so
 * clicking can't be how they're reached. Controls the pointer brought up go
 * away when it leaves the bars and the edge; ones opened otherwise (the
 * middle button, Esc) stay until put away.
 *
 * Not over the end of a chapter (`overEnd`): that page has its own cells
 * along the bottom (← SERIES, LIBRARY, NEXT), and the bars came up over them
 * as the pointer went to click one (the owner, 2026-11-01). Over it, the
 * pointer brings nothing up and puts away what it brought.
 */
export function hoverAction(
	y: number,
	height: number,
	o: { shown: boolean; byHover: boolean; overBars: boolean; overEnd?: boolean }
): 'show' | 'hide' | null {
	if (o.overEnd) return o.shown && o.byHover && !o.overBars ? 'hide' : null;
	const atEdge = y <= HOVER_EDGE || y >= height - HOVER_EDGE;
	if (!o.shown) return atEdge ? 'show' : null;
	return o.byHover && !atEdge && !o.overBars ? 'hide' : null;
}

// ---- the wheel -------------------------------------------------------------------

/** How far one gesture has to scroll before it turns, in pixels. */
export const WHEEL_PX = 40;
/** A pause this long between wheel events ends the gesture. */
export const WHEEL_QUIET_MS = 200;

/**
 * How far a wheel event moves forward, in pixels: down reads on, up goes
 * back, and a sideways scroll is spatial like the arrows, so in R->L a scroll
 * to the left reads on. Scroll mode scrolls, so nothing turns there (0).
 */
export function wheelForward(
	e: { deltaX: number; deltaY: number; deltaMode: number },
	mode: Mode
): number {
	if (mode === 'vertical') return 0;
	// DOM_DELTA_LINE and DOM_DELTA_PAGE, as Firefox reports some wheels.
	const unit = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? 800 : 1;
	if (Math.abs(e.deltaY) >= Math.abs(e.deltaX)) return e.deltaY * unit;
	return (mode === 'rtl' ? -e.deltaX : e.deltaX) * unit;
}

/**
 * The wheel turns a novel's pages on a PC (doc/TEXT-READER.md, "Mouse"). A
 * touchpad sends a stream of small deltas and its inertia keeps sending them
 * long after the fingers lift, so one gesture turns one page: the deltas add
 * up until they pass WHEEL_PX, and after a turn the rest of the gesture is
 * spent until the wheel has been quiet for WHEEL_QUIET_MS.
 */
export class WheelTurn {
	private sum = 0;
	private last = -Infinity;
	private spent = false;

	feed(forward: number, now: number): 'next' | 'prev' | null {
		if (now - this.last > WHEEL_QUIET_MS) {
			this.sum = 0;
			this.spent = false;
		}
		this.last = now;
		if (this.spent || forward === 0) return null;
		this.sum += forward;
		if (Math.abs(this.sum) < WHEEL_PX) return null;
		this.spent = true;
		return this.sum > 0 ? 'next' : 'prev';
	}
}

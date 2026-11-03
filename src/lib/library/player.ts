import { clock, isWatchedAt } from './anime.ts';
import { formatNumber } from './series.ts';

/**
 * The player's decisions, the pure part (doc/ANIME.md, "The player"; card
 * c156; Anime Calls 02 and Player Waiting): where an episode opens, when the
 * next one offers itself, which server comes next, what a subtitle says now,
 * and the words the chrome reads. The component (VideoPlayer.svelte) only
 * wires these to a <video>.
 */

export type Cue = { start: number; end: number; text: string };

const seconds = (t: string): number => {
	const parts = t.trim().replace(',', '.').split(':').map(Number);
	return parts.reduce((a, p) => a * 60 + p, 0);
};

/** WebVTT's cues, their markup dropped: tsundoku draws subtitles itself (Anime Calls, "Subtitles"). */
export function parseVtt(text: string): Cue[] {
	const out: Cue[] = [];
	const blocks = text.replace(/\r\n?/g, '\n').split(/\n{2,}/);
	for (const b of blocks) {
		const lines = b.split('\n');
		const at = lines.findIndex((l) => l.includes('-->'));
		if (at < 0) continue;
		const m = /^\s*([\d:.,]+)\s*-->\s*([\d:.,]+)/.exec(lines[at]);
		if (!m) continue;
		const words = lines
			.slice(at + 1)
			.join('\n')
			.replace(/<[^>]+>/g, '')
			.replace(/&amp;/g, '&')
			.replace(/&lt;/g, '<')
			.replace(/&gt;/g, '>')
			.replace(/&nbsp;/g, ' ')
			.trim();
		if (words) out.push({ start: seconds(m[1]), end: seconds(m[2]), text: words });
	}
	return out.sort((a, b) => a.start - b.start);
}

/** The line on screen at [t], or null; two at once are shown together, as a player shows overlapping cues. */
export function cueAt(cues: Cue[], t: number): string | null {
	const on = cues.filter((c) => c.start <= t && t < c.end);
	return on.length ? on.map((c) => c.text).join('\n') : null;
}

/**
 * Where an episode opens (Anime Calls, "Resume"): where it stopped, unless
 * it counts as watched (past its ending's start, or its last 3 %), which
 * opens from 0:00. `resumed` says whether to say RESUMED AT.
 */
export function openAt(e: {
	lastPosition: number | null;
	readAt: number | null;
	durationS: number | null;
	endingAt: number | null;
}): { at: number; resumed: boolean } {
	const p = e.lastPosition;
	if (e.readAt !== null || p === null || p < 5) return { at: 0, resumed: false };
	if (e.durationS && isWatchedAt(p, e.durationS, e.endingAt)) return { at: 0, resumed: false };
	return { at: p, resumed: true };
}

/**
 * When the next episode offers itself (Anime Calls 01, default 4): from the
 * ending's start, or 30 s before the end without timestamps.
 */
export const offerNextAt = (durationS: number, endingAt: number | null) =>
	endingAt !== null && endingAt > 0 && endingAt < durationS
		? endingAt
		: Math.max(0, durationS - 30);

/** The NEXT page counts this long before playing (default 4); STAY stops it. */
export const NEXT_COUNT_S = 5;
/** A stall this long moves to the next server by itself (Player Waiting, "Servers fail all the time"). */
export const STALL_S = 15;
/** Controls go after this long playing: 4 s on a touch screen, 2 s after the mouse stops. */
export const HIDE_TOUCH_MS = 4000;
export const HIDE_MOUSE_MS = 2000;
/** RESUMED AT stays this long; SKIP INTRO, alone, this long. */
export const RESUME_MS = 5000;
export const SKIP_ALONE_MS = 8000;

/**
 * The next server to try, after [current] stopped: the next in the source's
 * order that hasn't failed this time, or null when none is left (NO SERVER
 * ANSWERED).
 */
export function nextServer(order: number[], current: number, failed: Set<number>): number | null {
	const i = order.indexOf(current);
	const rest = [...order.slice(i + 1), ...order.slice(0, Math.max(0, i))];
	return rest.find((n) => !failed.has(n)) ?? null;
}

/**
 * Where a stall goes: the next server that hasn't failed, as before; with
 * none left, a lower quality on this one at the same second; else null, and
 * the list is asked for afresh. A source with one server had nowhere to go:
 * KickAssAnime's 1080p runs at 20–34 Mbps through a heavy scene, a link that
 * can't carry that stalled there every time, and 720p (a third of it) was
 * one tap away in the sheet. [heights] are the server's qualities, best
 * first; a quality without a height steps to the next one listed.
 */
export type StallStep = { server: number } | { quality: number } | null;

export function stallStep(
	order: number[],
	current: number,
	failed: Set<number>,
	heights: (number | null)[],
	qualityIndex: number
): StallStep {
	const server = nextServer(order, current, failed);
	if (server !== null) return { server };
	const now = heights[qualityIndex] ?? null;
	const i = heights.findIndex(
		(h, j) => j > qualityIndex && (now === null || (h !== null && h < now))
	);
	return i >= 0 ? { quality: i } : null;
}

/**
 * A double-tap on a side third seeks 10 s, and each further tap within the
 * burst adds 10 (Anime Calls, "The picture is the interface"): [taps] is the
 * count in the burst, from 2.
 */
export const seekFor = (taps: number) => Math.max(1, taps - 1) * 10;

/**
 * How far the pointer must move before the controls come back (card c217):
 * a mouse resting on a desk jitters a pixel or two, and the chrome used to
 * flash in on every one of them. A move of this much from where the pointer
 * was, or from where the controls last left it, is a person moving the mouse.
 */
export const CHROME_MOVE_PX = 12;

/** Whether a pointer's travel from [from] to [to] is a move, not a jitter. */
export function movedEnough(
	from: { x: number; y: number },
	to: { x: number; y: number },
	px = CHROME_MOVE_PX
): boolean {
	return Math.hypot(to.x - from.x, to.y - from.y) >= px;
}

/**
 * How far a press may wander and still be a click (card c218): a drag across
 * the picture, or a finger that slid as it lifted, is neither a tap on the
 * controls nor a play/pause.
 */
export const TAP_SLOP_PX = 10;

export const isTap = (
	from: { x: number; y: number } | null,
	to: { x: number; y: number },
	px = TAP_SLOP_PX
): boolean => !from || Math.hypot(to.x - from.x, to.y - from.y) <= px;

/**
 * What a click on the picture does (card c218): on a mouse it plays or pauses,
 * as every video player's does, and the controls are reached by moving the
 * pointer (c217); on a touch screen a tap shows or hides the controls, as
 * Anime Calls draws it.
 */
export const pictureClick = (pointer: 'mouse' | 'touch'): 'toggle' | 'chrome' =>
	pointer === 'mouse' ? 'toggle' : 'chrome';

/** "−14:32": the time left, as the bar's right end reads. */
export const leftLabel = (position: number, duration: number) =>
	`−${clock(Math.max(0, duration - position))}`;

type Ep = { number: number; season: number | null };

/** "S2 · EP. 7 OF 12": where the episode sits in its season (or the series, without seasons). */
export function placeLabel(e: Ep, ofSeason: number, seasons: boolean): string {
	const ep = `EP. ${formatNumber(e.number)} OF ${ofSeason}`;
	return seasons && e.season !== null ? `S${e.season} · ${ep}` : ep;
}

/**
 * The bottom bar's middle cell: what's playing, which opens the sheet
 * ("JA · EN SUBS · 1080P · 1×", Anime Calls, "Settings").
 */
export function playingLabel(o: {
	audio: string | null;
	subtitles: string | null;
	burnedIn: boolean;
	quality: string | null;
	speed: number;
	cached?: boolean;
}): string {
	const parts: string[] = [];
	if (o.audio) parts.push(o.audio);
	if (o.subtitles) parts.push(`${o.subtitles} SUBS`);
	else if (o.burnedIn) parts.push('SUBS IN THE PICTURE');
	if (o.quality) parts.push(o.quality.toUpperCase());
	if (o.cached) parts.push('CACHED');
	else parts.push(`${o.speed === 1 ? '1' : o.speed}×`);
	return parts.join(' · ');
}

export const SPEEDS = [0.75, 1, 1.25, 1.5, 2] as const;
export const SUB_SIZES = ['S', 'M', 'L'] as const;
export type SubSize = (typeof SUB_SIZES)[number];

/** Per device, as Player States draws it: the tablet's 30px, the phone's 20px, the desktop's 26/34. */
export function subtitlePx(size: SubSize, base: number): number {
	return Math.round(base * (size === 'S' ? 0.8 : size === 'L' ? 1.25 : 1));
}

/**
 * The challenge's scale (Player Waiting 3a): 0 to 60 s, the known 20–45 s
 * range marked, and where the wait is now. Never a fill toward an end it
 * can't see.
 */
export function challengeScale(elapsedS: number): { at: number; from: number; to: number } {
	return { at: Math.min(1, elapsedS / 60), from: 20 / 60, to: 45 / 60 };
}

/**
 * The track to start an episode with, of those the source offers (asked for
 * on 2026-10-29: settings remembered across anime). The first choice that
 * applies wins: this series' own, then the last one made on any anime, then
 * the device's language. `null` is a choice too (subtitles OFF); `undefined`
 * is none made. Undefined back means none applied: the caller takes the
 * source's first.
 */
export function preferredLang(
	offered: string[],
	choices: (string | null | undefined)[]
): string | null | undefined {
	for (const c of choices) {
		if (c === undefined) continue;
		if (c === null) return null;
		if (offered.includes(c)) return c;
	}
	return undefined;
}

/** Where a choice comes from: a series', SETTINGS' default, or the last on any anime. */
export type TrackChoice = { audio?: string; subs?: string | null; subsize?: SubSize };

/**
 * The tracks an anime starts on (doc/ANIME.md, "The player"; card c171):
 * the series' own choice, else SETTINGS' default, else the last made on
 * any anime (FOLLOW THE PLAYER). Then audio takes the source's first track,
 * which is its original (the owner's answer to question 3), and subtitles
 * the device's language, else the first offered. Null subtitles are off.
 */
export function startTracks(o: {
	audio: string[];
	subs: string[];
	series: TrackChoice;
	defaults: TrackChoice;
	last: TrackChoice;
	device?: string;
}): { audio: string | null; subs: string | null; subsize: SubSize } {
	const chain = [o.series, o.defaults, o.last];
	const audio = preferredLang(
		o.audio,
		chain.map((c) => c.audio)
	);
	const subs = preferredLang(o.subs, [...chain.map((c) => c.subs), o.device]);
	return {
		audio: audio ?? null,
		subs: subs === undefined ? (o.subs[0] ?? null) : subs,
		subsize: o.series.subsize ?? o.defaults.subsize ?? o.last.subsize ?? 'M'
	};
}

/** The device's language as the sheet names tracks: `en-GB` is EN. */
export const deviceLang = (tag: string | undefined) =>
	tag ? tag.slice(0, 2).toUpperCase() : undefined;

/**
 * How far the buffer reaches from [t]: the end of the buffered range [t] is
 * in, else [t] itself. Not the last range's end: after a seek back that's
 * somewhere else in the episode, and the bar drew a buffer the playhead
 * didn't have (reported 2026-10-29).
 */
export function bufferedTo(ranges: [number, number][], t: number): number {
	const r = ranges.find(([start, end]) => start <= t + 0.5 && t <= end);
	return r ? r[1] : t;
}

/** The VOL slider's and the wheel's step, and ↑ ↓'s (c385). */
export const WHEEL_STEP = 0.05;
export const KEY_STEP = 0.1;

/**
 * A volume as the player keeps it (c385): 0 to 1, in whole percent, and the
 * full volume for anything that is not a number (a value another build or a
 * hand edit left in the device's storage). Whole percent because the cell
 * prints it so, and ten ↑ presses must land on 100 %, not 0.9999999.
 */
export function cleanVolume(v: unknown): number {
	const n = typeof v === 'number' ? v : Number.NaN;
	if (!Number.isFinite(n)) return 1;
	return Math.round(Math.max(0, Math.min(1, n)) * 100) / 100;
}

/** Where on a vertical slider a pointer is, 0 at the bottom to 1 at the top. */
export function verticalFraction(clientY: number, box: { top: number; height: number }): number {
	if (!(box.height > 0)) return 0;
	return Math.max(0, Math.min(1, 1 - (clientY - box.top) / box.height));
}

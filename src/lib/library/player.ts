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
 * A double-tap on a side third seeks 10 s, and each further tap within the
 * burst adds 10 (Anime Calls, "The picture is the interface"): [taps] is the
 * count in the burst, from 2.
 */
export const seekFor = (taps: number) => Math.max(1, taps - 1) * 10;

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

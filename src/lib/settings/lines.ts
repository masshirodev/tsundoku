/**
 * What the SETTINGS page says, the pure part (doc/SETTINGS.md; card c171):
 * the lines a row derives from what's set, what stands in, and when.
 */

import { langName as trackLangName } from '$lib/library/streams';

/**
 * A language as the page says it: "JAPANESE", "PORTUGUESE (BRAZIL)". The
 * player's one table names it (c419), so a variant, or any language the
 * player knows, reads as a name here too, never as its code.
 */
export const langName = (code: string) => trackLangName(code).toUpperCase();

const DAY = 24 * 3600_000;

/** "2 H AGO", "YESTERDAY", "12 OCT": when a choice was made, as the page says it. */
export function when(at: number, now = Date.now()): string {
	const ms = now - at;
	if (ms < 60_000) return 'JUST NOW';
	if (ms < 3600_000) return `${Math.floor(ms / 60_000)} MIN AGO`;
	const today = new Date(now);
	today.setHours(0, 0, 0, 0);
	if (at >= today.getTime()) return `${Math.floor(ms / 3600_000)} H AGO`;
	if (at >= today.getTime() - DAY) return 'YESTERDAY';
	return new Date(at)
		.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })
		.toUpperCase()
		.replace('SEPT', 'SEP');
}

export type Stand = { v: string | null; title: string | null; at: number } | null;

/** A track as the meta line says it: "JA", "OFF". */
const track = (v: string | null) => (v === null ? 'OFF' : v);

/**
 * AUDIO's meta line: what every anime starts in when a default is set; else
 * what stands in (the last choice, where and when), else the original.
 */
export function audioLine(def: string | undefined, last: Stand, now = Date.now()): string {
	if (def) return `EVERY ANIME STARTS IN ${langName(def)}, UNLESS A SERIES DIFFERS`;
	if (!last?.v) return "NONE SET · THE SOURCE'S ORIGINAL PLAYS FIRST";
	const where = last.title ? `, ON ${last.title.toUpperCase()}` : '';
	return `NONE SET · THE PLAYER'S LAST CHOICE STANDS IN: ${last.v}${where} ${when(last.at, now)} · BEFORE ANY CHOICE, THE SOURCE'S ORIGINAL`;
}

/** SUBTITLES' meta line, with the size beside the track. */
export function subsLine(
	def: { subs?: string | null; size?: string },
	last: { subs: Stand; size: Stand }
): string {
	if (def.subs !== undefined) {
		const t = def.subs === null ? 'NO SUBTITLES' : langName(def.subs);
		return `${t}${def.subs !== null ? `, AT ${def.size ?? last.size?.v ?? 'M'}` : ''}, UNLESS A SERIES DIFFERS`;
	}
	if (!last.subs) return "NONE SET · THE DEVICE'S LANGUAGE, WHERE THE SOURCE HAS IT";
	return `NONE SET · THE PLAYER'S LAST CHOICE STANDS IN: ${track(last.subs.v)}, ${def.size ?? last.size?.v ?? 'M'}`;
}

/** An override's line in the opened list (2A): "EN AUDIO · CHOSEN IN THE PLAYER, 12 OCT". */
export function overrideLine(
	what: 'audio' | 'subs',
	value: string | null,
	at: number,
	now = Date.now()
): string {
	const v =
		what === 'audio' ? `${value} AUDIO` : value === null ? 'SUBTITLES OFF' : `${value} SUBTITLES`;
	return `${v} · CHOSEN IN THE PLAYER, ${when(at, now)}`;
}

/** "14 SERIES DIFFER →", "1 SERIES DIFFERS →", "3 BOOKS DIFFER →"; nothing at none. */
export function differ(n: number, noun = 'SERIES'): string {
	if (n <= 0) return '';
	const word = noun === 'SERIES' || n === 1 ? noun : `${noun}S`;
	return `${n} ${word} ${n === 1 ? 'DIFFERS' : 'DIFFER'} →`;
}

/** A zoom cell's IN USE: the screen class this device is on now. */
export const inUse = (cell: string, narrow: boolean) =>
	cell.endsWith(narrow ? '· PHONE' : '· WIDER');

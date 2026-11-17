import { kindFacts, kindUnit } from './kinds.ts';
import type { ContinueItem, Kind, SeriesCard } from './types.ts';

/**
 * Copy for the library screen. The voice is a catalogue card: uppercase mono
 * for chrome, sentence case for titles, a middle dot between facts, and bare
 * numbers for counts. See doc/design/README.md, "House rules".
 */

export const kindLabel = (kind: Kind) => kind.toUpperCase();

/** 1,284 -- counts are grouped, never abbreviated. */
export function count(n: number): string {
	return n.toLocaleString('en-US');
}

export function progress(item: Pick<SeriesCard, 'entryCount' | 'readCount'>): number {
	if (item.entryCount <= 0) return 0;
	return Math.min(1, Math.max(0, item.readCount / item.entryCount));
}

export function percent(fraction: number): string {
	return `${Math.round(fraction * 100)}%`;
}

/** "MANHWA · Ch. 214 of 243" */
export function continueSub(item: ContinueItem, offline?: { cached: boolean }): string {
	const kind = kindLabel(item.kind);
	if (offline && !offline.cached) return `${kind} · NOT CACHED`;
	// A single book has nothing to count: "DOUJIN", not "DOUJIN · Book of 1".
	// An episode says the time left instead (doc/ANIME.md): "S2 EP. 7 · 14:32 LEFT".
	const where =
		kindFacts(item.kind).medium === 'video'
			? item.entryLabel
			: kindFacts(item.kind).grouping === 'books' && item.entryCount <= 1
				? null
				: item.entryCount > 0
					? `${item.entryLabel} of ${item.entryCount}`
					: item.entryLabel;
	const parts = [kind, where, offline ? 'CACHED' : null].filter((p) => p !== null);
	return parts.join(' · ');
}

/** Novels are counted in volumes, anime in episodes, everything with pages in chapters. */
export const unitLabel = (kind: Kind) => kindUnit(kind).short;

/** "MANGA · 58 CH · 41 READ · +3 NEW"; an anime's are WATCHED. */
export function sheetMeta(item: SeriesCard): string {
	const unit = kindUnit(item.kind);
	// A film has no unit and no list: its one entry is watched, and no count
	// would be true (card c987).
	const parts = [kindLabel(item.kind)];
	if (unit.short) parts.push(`${item.entryCount} ${unit.short}`);
	parts.push(`${item.readCount} ${unit.done}`);
	if (item.newCount > 0) parts.push(`+${item.newCount} NEW`);
	return parts.join(' · ');
}

export type Sort = 'recent' | 'progress' | 'title' | 'rating' | 'added' | 'random';

/** The SORT menu's order. */
export const SORTS: readonly Sort[] = ['recent', 'added', 'progress', 'title', 'rating', 'random'];

/** What each sort is called in the menu, without a direction. */
export const SORT_NAME: Record<Sort, string> = {
	recent: 'RECENTLY READ',
	added: 'RECENTLY ADDED',
	progress: 'PROGRESS',
	title: 'TITLE',
	rating: 'RATING',
	random: 'RANDOM'
};

export function parseSort(raw: string | null): Sort {
	return SORTS.includes(raw as Sort) ? (raw as Sort) : 'recent';
}

/**
 * ↓ or ↑ beside the sort (`?dir=`). Each sort has its natural direction --
 * newest, best and most recently read first, titles A to Z -- and `dir` only
 * appears in the URL when it's turned the other way. RANDOM has none.
 */
export type Dir = 'asc' | 'desc';

export const naturalDir = (sort: Sort): Dir => (sort === 'title' ? 'asc' : 'desc');

/** The direction in a URL, or the sort's own. */
export function parseDir(raw: string | null, sort: Sort): Dir {
	return raw === 'asc' || raw === 'desc' ? raw : naturalDir(sort);
}

/**
 * The direction toggle's face: A–Z / Z–A beside TITLE, an arrow beside the
 * rest (↓ is high to low: newest, best, most recent first; beside PROGRESS,
 * ↓ is the begun on top and ↑ the begun at the bottom).
 */
export function dirLabel(sort: Sort, dir: Dir): string {
	if (sort === 'title') return dir === 'asc' ? 'A–Z' : 'Z–A';
	return dir === 'desc' ? '↓' : '↑';
}

/**
 * RANDOM's shuffle, from the URL (doc/LIBRARY.md, "Random"): the same seed is
 * the same order, so pages never overlap and back comes back to it. Any
 * other value is 1.
 */
export function parseSeed(raw: string | null): number {
	const n = Number(raw);
	return Number.isInteger(n) && n > 0 && n < 2 ** 31 ? n : 1;
}

/** A new shuffle, each time RANDOM is chosen. */
export const newSeed = () => 1 + Math.floor(Math.random() * (2 ** 31 - 2));

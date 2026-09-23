import type { ContinueItem, Kind, SeriesCard } from './types';

/**
 * Copy for the library screen. The voice is a catalogue card: uppercase mono
 * for chrome, sentence case for titles, a middle dot between facts, and bare
 * numbers for counts. See doc/design/README.md, "Content fundamentals".
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
	const where = item.entryCount > 0 ? `${item.entryLabel} of ${item.entryCount}` : item.entryLabel;
	return offline ? `${kind} · ${where} · CACHED` : `${kind} · ${where}`;
}

/** Novels are counted in volumes, everything with pages in chapters. */
export const unitLabel = (kind: Kind) => (kind === 'novel' ? 'VOL' : 'CH');

/** "MANGA · 58 CH · 41 READ · +3 NEW" */
export function sheetMeta(item: SeriesCard): string {
	const parts = [kindLabel(item.kind), `${item.entryCount} ${unitLabel(item.kind)}`];
	parts.push(`${item.readCount} READ`);
	if (item.newCount > 0) parts.push(`+${item.newCount} NEW`);
	return parts.join(' · ');
}

export type Sort = 'recent' | 'title' | 'rating' | 'added';

export const SORTS: readonly Sort[] = ['recent', 'title', 'rating', 'added'];

export const SORT_LABEL: Record<Sort, string> = {
	recent: 'RECENTLY READ ↓',
	title: 'A–Z ↓',
	rating: 'RATING ↓',
	added: 'RECENTLY ADDED ↓'
};

export function nextSort(sort: Sort): Sort {
	return SORTS[(SORTS.indexOf(sort) + 1) % SORTS.length];
}

export function parseSort(raw: string | null): Sort {
	return SORTS.includes(raw as Sort) ? (raw as Sort) : 'recent';
}

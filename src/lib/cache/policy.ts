/**
 * The device cache policy (doc/OFFLINE.md), from Mihon's download-ahead and
 * delete-after-read: while a chapter is read, it and the next few available
 * ones are kept on the tablet; a chapter read to the end is let go; and the
 * whole cache stays under a budget, oldest first out.
 */

export type EntryRef = { id: number; position: number; readAt: number | null; available: boolean };

/** How many chapters past the current one are kept ready. */
export const AHEAD = 2;

/**
 * What to keep for one series while `currentId` is open: the current entry
 * unless it is read, and the next `ahead` available entries after it in
 * reading order, read or not -- rereading still wants them.
 */
export function keepFor(entries: EntryRef[], currentId: number, ahead = AHEAD): number[] {
	const ordered = [...entries].sort((a, b) => a.position - b.position);
	const at = ordered.findIndex((e) => e.id === currentId);
	if (at < 0) return [];
	const keep: number[] = [];
	if (ordered[at].readAt === null && ordered[at].available) keep.push(currentId);
	for (const e of ordered.slice(at + 1)) {
		if (keep.length >= ahead + 1) break;
		if (e.available) keep.push(e.id);
	}
	return keep;
}

export type Cached = { seriesId: number; entryId: number; at: number; bytes: number };

/** Hundreds of pages, not the whole library: the tablet has other things on it. */
export const BUDGET_BYTES = 2 * 1024 ** 3;

/**
 * Which cached entries to let go so the rest fits the budget: the ones
 * cached longest ago first, never one in `keep` (what is being read now).
 */
export function evict(cached: Cached[], keep: number[], budget = BUDGET_BYTES): number[] {
	let total = cached.reduce((n, c) => n + c.bytes, 0);
	const out: number[] = [];
	for (const c of [...cached].sort((a, b) => a.at - b.at)) {
		if (total <= budget) break;
		if (keep.includes(c.entryId)) continue;
		out.push(c.entryId);
		total -= c.bytes;
	}
	return out;
}

/** The marker kept beside an entry's pages: what the offline screens count. */
export const markerPath = (seriesId: number, entryId: number) =>
	`/__cache/series/${seriesId}/entries/${entryId}`;

export function parseMarker(path: string): { seriesId: number; entryId: number } | null {
	const m = /^\/__cache\/series\/(\d+)\/entries\/(\d+)$/.exec(path);
	return m ? { seriesId: Number(m[1]), entryId: Number(m[2]) } : null;
}

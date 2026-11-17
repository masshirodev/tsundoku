/**
 * One chapter, several copies (doc/DUPLICATE-CHAPTERS.md). Mihon keeps a chapter once
 * per scanlator, so a series can carry "Ch. 64" twice. Both copies stay in the
 * database, since either may be the one with a file on disk. One of them
 * represents the chapter, and the others are shadowed: the series screen, the
 * counts, CONTINUE and the reader see only the representative.
 *
 * Pure, so the choice is tested without a database. src/lib/server/duplicates.ts
 * applies it.
 */

export type Copy = {
	id: number;
	available: boolean;
	scanlator: string;
	readAt: number | null;
	lastOpenedAt: number | null;
	lastPosition: number | null;
};

/**
 * The scanlator a series prefers when none is picked: whoever
 * has the most chapters on disk, else the most chapters at all. Ties go
 * alphabetically, so the choice doesn't flip between scans.
 */
export function automaticScanlator(copies: Pick<Copy, 'scanlator' | 'available'>[]): string {
	const tally = (pool: Pick<Copy, 'scanlator'>[]) => {
		const n = new Map<string, number>();
		for (const c of pool) if (c.scanlator) n.set(c.scanlator, (n.get(c.scanlator) ?? 0) + 1);
		return [...n].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0]?.[0] ?? '';
	};
	return tally(copies.filter((c) => c.available)) || tally(copies);
}

/**
 * Which copy represents the chapter: one you can open beats one you can't,
 * then the preferred scanlator, then the one you've opened, then the oldest.
 */
export function representative(copies: Copy[], preferred: string): Copy {
	const score = (c: Copy) => [
		c.available ? 1 : 0,
		preferred !== '' && c.scanlator === preferred ? 1 : 0,
		c.lastOpenedAt !== null ? 1 : 0
	];
	return copies.slice().sort((a, b) => {
		const sa = score(a);
		const sb = score(b);
		for (let i = 0; i < sa.length; i++) if (sa[i] !== sb[i]) return sb[i] - sa[i];
		return a.id - b.id;
	})[0];
}

/**
 * What the representative carries once the copies are one chapter. Having read
 * any copy counts as having read the chapter. The chapter was last opened when
 * any copy was, and where you stopped comes from the copy opened most
 * recently, unless the representative has a place of its own.
 */
export function mergedState(
	copies: Copy[],
	rep: Copy
): Pick<Copy, 'readAt' | 'lastOpenedAt' | 'lastPosition'> {
	const max = (xs: (number | null)[]) =>
		xs.reduce<number | null>((a, x) => (x !== null && (a === null || x > a) ? x : a), null);
	const latest = copies
		.filter((c) => c.lastOpenedAt !== null && c.lastPosition !== null)
		.sort((a, b) => b.lastOpenedAt! - a.lastOpenedAt!)[0];
	return {
		readAt: rep.readAt ?? max(copies.map((c) => c.readAt)),
		lastOpenedAt: max(copies.map((c) => c.lastOpenedAt)),
		lastPosition: rep.lastPosition ?? latest?.lastPosition ?? null
	};
}

/**
 * Duplicate books (doc/DUPLICATE-BOOKS.md): the same book downloaded twice,
 * found by its cover, and settled by the owner one pair at a time. Pure: the
 * workstation (src/lib/server/dupes.ts) feeds these the hashes and the rows.
 *
 * Hashes are 64-bit perceptual hashes as 16 hex digits: Hentoid's for covers,
 * tsundoku's own for pages. Images that look alike differ in few bits.
 */

/** Past this many bits apart, covers stop being the same book (measured: 151 pairs at 8, 3,266 at 12). */
export const COVER_BITS = 8;
/**
 * Pages are matched a little more loosely: scans of one page differ more than
 * covers. Measured on the owner's pairs (2026-09-24): the same page lands at
 * 0–12 bits, a different one at 23 and up, and almost nothing between.
 */
export const PAGE_BITS = 12;

/**
 * Covers alike aren't enough: two books can share a cover template, or an
 * artist's same drawing. A pair is the same book only when at least half the
 * shorter one's pages match the other's (a volume inside its collection
 * matches all of its own).
 */
export function sameBook(rows: PageRow[], pagesA: number, pagesB: number): boolean {
	const matched = rows.filter((r) => r.a !== null && r.b !== null).length;
	const shorter = Math.min(pagesA, pagesB);
	return shorter > 0 && matched >= shorter / 2;
}

const halves = (hex: string): [number, number] => [
	parseInt(hex.slice(0, 8), 16) >>> 0,
	parseInt(hex.slice(8, 16), 16) >>> 0
];

function popcount(n: number): number {
	n = n - ((n >>> 1) & 0x55555555);
	n = (n & 0x33333333) + ((n >>> 2) & 0x33333333);
	return (((n + (n >>> 4)) & 0x0f0f0f0f) * 0x01010101) >>> 24;
}

/** How many bits two hashes differ in. */
export function distance(a: string, b: string): number {
	const [a1, a2] = halves(a);
	const [b1, b2] = halves(b);
	return popcount(a1 ^ b1) + popcount(a2 ^ b2);
}

/**
 * A hash worth comparing: 16 hex digits, and not a blank or single-colour
 * image, whose hash is all (or all but one) zeros or ones and "matches"
 * every other blank (Hentoid's `8000000000000000`, 36 books).
 */
export function usable(hex: string | null | undefined): hex is string {
	if (!hex || !/^[0-9a-f]{16}$/i.test(hex)) return false;
	const [h, l] = halves(hex);
	const bits = popcount(h) + popcount(l);
	return bits > 1 && bits < 63;
}

/** A pair's key, whichever way round: the dismissals' and decisions' identity. */
export const pairKey = (a: number, b: number) => (a < b ? `${a},${b}` : `${b},${a}`);

export type BookHash = { entryId: number; seriesId: number; hash: string };

/**
 * Pairs of books whose covers are alike, closest first. Two books of one
 * series are never a pair (grouped already, or one book's two volumes), nor
 * is a pair the owner settled.
 */
export function candidatePairs(
	books: BookHash[],
	settled: Set<string>,
	maxBits = COVER_BITS
): { a: number; b: number; bits: number }[] {
	const usableBooks = books.filter((b) => usable(b.hash));
	const split = usableBooks.map((b) => halves(b.hash));
	const out: { a: number; b: number; bits: number }[] = [];
	for (let i = 0; i < usableBooks.length; i++) {
		for (let j = i + 1; j < usableBooks.length; j++) {
			if (usableBooks[i].seriesId === usableBooks[j].seriesId) continue;
			const bits = popcount(split[i][0] ^ split[j][0]) + popcount(split[i][1] ^ split[j][1]);
			if (bits > maxBits) continue;
			const [a, b] = [usableBooks[i].entryId, usableBooks[j].entryId].sort((x, y) => x - y);
			if (!settled.has(pairKey(a, b))) out.push({ a, b, bits });
		}
	}
	return out.sort((x, y) => x.bits - y.bits || x.a - y.a || x.b - y.b);
}

/** One row of the pages comparison: a page of each copy that match, or a page only one has. 1-based. */
export type PageRow = { a: number | null; b: number | null };

/**
 * The two copies' pages, lined up: the longest run of matching pages in
 * order (a page matches when its hash is within `maxBits`), and every page
 * without a match on its own row where it falls. A credits page one site
 * added, or a page the other lost, shows up as a row with one side empty.
 */
export function matchPages(a: string[], b: string[], maxBits = PAGE_BITS): PageRow[] {
	const n = a.length;
	const m = b.length;
	const same = (i: number, j: number) =>
		usable(a[i]) && usable(b[j]) && distance(a[i], b[j]) <= maxBits;
	// Longest common subsequence, where "equal" is "alike".
	const L = Array.from({ length: n + 1 }, () => new Uint16Array(m + 1));
	for (let i = n - 1; i >= 0; i--)
		for (let j = m - 1; j >= 0; j--)
			L[i][j] = same(i, j) ? L[i + 1][j + 1] + 1 : Math.max(L[i + 1][j], L[i][j + 1]);
	const rows: PageRow[] = [];
	let i = 0;
	let j = 0;
	while (i < n && j < m) {
		if (same(i, j) && L[i][j] === L[i + 1][j + 1] + 1) rows.push({ a: ++i, b: ++j });
		else if (L[i + 1][j] >= L[i][j + 1]) rows.push({ a: ++i, b: null });
		else rows.push({ a: null, b: ++j });
	}
	while (i < n) rows.push({ a: ++i, b: null });
	while (j < m) rows.push({ a: null, b: ++j });
	return rows;
}

/** "P 12–13", "P 4, 9": pages, runs joined. */
export function pageList(pages: number[]): string {
	const runs: string[] = [];
	for (let k = 0; k < pages.length;) {
		let e = k;
		while (e + 1 < pages.length && pages[e + 1] === pages[e] + 1) e += 1;
		runs.push(e === k ? String(pages[k]) : `${pages[k]}–${pages[e]}`);
		k = e + 1;
	}
	return `P ${runs.join(', ')}`;
}

/** What the review knows of one copy. */
export type Copy = {
	entryId: number;
	seriesId: number;
	title: string;
	/** The site it came from: Hentoid's `site`, as the library's source. */
	site: string;
	/** Its `language:` tag, lower case; '' when it has none. */
	language: string;
	pages: number;
	/** A typical page's size in pixels; 0 when unknown. */
	width: number;
	height: number;
	addedAt: number;
	rating: number;
	favourite: boolean;
	/** Read to the end, or the page reached (1-based), or neither. */
	read: 'read' | number | null;
	/** Its shelves' names. */
	shelves: string[];
	/** The series of books it's in, and its place there; null for a single. */
	series: { id: number; title: string; position: number } | null;
	hidden: boolean;
};

export type PairKind = 'dup' | 'fold';
export type Confidence = 'likely' | 'maybe' | 'lang';

/** Two languages are two editions of one book, not a copy to throw away. */
export const kindOf = (a: Copy, b: Copy): PairKind =>
	a.language && b.language && a.language !== b.language ? 'fold' : 'dup';

/** Likely when the lengths agree (within two pages or a tenth), maybe otherwise. */
export function confidence(a: Copy, b: Copy): Confidence {
	if (kindOf(a, b) === 'fold') return 'lang';
	const most = Math.max(a.pages, b.pages);
	return Math.abs(a.pages - b.pages) <= Math.max(2, most * 0.1) ? 'likely' : 'maybe';
}

export type Pick = {
	keep: 'a' | 'b';
	/** Which rule decided: 1 far more pages, 2 sharper, 3 a few more pages, 4 the owner's, 5 older. */
	rule: 1 | 2 | 3 | 4 | 5;
	ruleName: string;
	/** Why, in the review's words: "MORE PAGES · B IS MISSING P 12–13". */
	why: string;
};

export const RULES = [
	'COMPLETE OVER PARTIAL',
	'SHARPER',
	'MORE PAGES',
	'WHAT YOU CHOSE',
	'OLDER'
] as const;

/** How much the owner has done with a copy: read, rated, FAV, shelved, in a series. */
const tended = (c: Copy) =>
	(c.read !== null ? 1 : 0) +
	(c.rating > 0 ? 1 : 0) +
	(c.favourite ? 1 : 0) +
	(c.shelves.length > 0 ? 1 : 0) +
	(c.series ? 1 : 0);

const day = (at: number) => new Date(at).toISOString().slice(0, 10);

/** Page counts far apart: more than two pages and a tenth (the "maybe" line, as `confidence` draws it). */
export const farApart = (a: Copy, b: Copy) =>
	Math.abs(a.pages - b.pages) > Math.max(2, Math.max(a.pages, b.pages) * 0.1);

/**
 * Which copy to keep (doc/DUPLICATE-BOOKS.md, "How the pick is made"): the
 * first rule that tells them apart decides. Sharper pages win over a page or
 * two more (a credits page one site added); far more pages win over sharper
 * (the owner, 2026-09-24).
 */
export function pick(a: Copy, b: Copy, rows: PageRow[]): Pick {
	const onlyA = rows.filter((r) => r.a !== null && r.b === null).map((r) => r.a!);
	const onlyB = rows.filter((r) => r.b !== null && r.a === null).map((r) => r.b!);
	const decide = (keep: 'a' | 'b', rule: Pick['rule'], why: string): Pick => ({
		keep,
		rule,
		ruleName: RULES[rule - 1],
		why
	});
	const morePages = (rule: 1 | 3): Pick => {
		const keep = onlyA.length > onlyB.length ? 'a' : 'b';
		const lacks = keep === 'a' ? onlyA : onlyB;
		const other = keep === 'a' ? 'B' : 'A';
		return decide(
			keep,
			rule,
			lacks.length
				? `MORE PAGES · ${other} IS MISSING ${pageList(lacks)}`
				: `MORE PAGES · ${(keep === 'a' ? a : b).pages} AGAINST ${(keep === 'a' ? b : a).pages}`
		);
	};
	// 1. Far more pages: the complete book over a part of it, however sharp.
	if (farApart(a, b) && onlyA.length !== onlyB.length) return morePages(1);
	// 2. Sharper: larger pages, by a tenth or more.
	const area = (c: Copy) => c.width * c.height;
	if (area(a) && area(b) && Math.max(area(a), area(b)) >= 1.1 * Math.min(area(a), area(b))) {
		const keep = area(a) > area(b) ? 'a' : 'b';
		const [k, o] = keep === 'a' ? [a, b] : [b, a];
		const [K, O] = keep === 'a' ? ['A', 'B'] : ['B', 'A'];
		return decide(
			keep,
			2,
			`SHARPER · ${K} IS ${k.width} × ${k.height}, ${O} IS ${o.width} × ${o.height}`
		);
	}
	// 3. A few more pages, when the pages are as sharp.
	if (onlyA.length !== onlyB.length) return morePages(3);
	// 4. What the owner already chose.
	if (tended(a) !== tended(b)) {
		const keep = tended(a) > tended(b) ? 'a' : 'b';
		return decide(keep, 4, `YOU READ, RATED OR SHELVED ${keep === 'a' ? 'A' : 'B'}`);
	}
	// 5. Older: downloaded first.
	const keep = a.addedAt <= b.addedAt ? 'a' : 'b';
	return decide(keep, 5, `DOWNLOADED FIRST · ${day(keep === 'a' ? a.addedAt : b.addedAt)}`);
}

/**
 * What the copy kept takes over from the one that goes, where the other had
 * more: the words the review shows ("RATING 3 · FAV · READ · SHELF WEEKEND").
 * The workstation carries the same things over (src/lib/server/dupes.ts).
 */
export function carryOver(keep: Copy, lose: Copy): string[] {
	const bits: string[] = [];
	if (lose.rating > keep.rating) bits.push(`RATING ${lose.rating}`);
	if (lose.favourite && !keep.favourite) bits.push('FAV');
	const reached = (c: Copy) => (c.read === 'read' ? Infinity : (c.read ?? 0));
	if (reached(lose) > reached(keep))
		bits.push(lose.read === 'read' ? 'READ' : `READ TO P ${lose.read}`);
	const shelves = lose.shelves.filter((s) => !keep.shelves.includes(s));
	if (shelves.length) bits.push(`SHELF ${shelves.join(', ').toUpperCase()}`);
	if (lose.series && !keep.series) bits.push(`PLACE IN ${lose.series.title.toUpperCase()}`);
	return bits;
}

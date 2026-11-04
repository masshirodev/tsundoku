/**
 * One book in several languages (Editions, card c60; doc/EDITIONS.md). Pure:
 * the workstation (src/lib/server/books.ts, `foldEditions`) stores the pages
 * lined up, and the book screen and the reader draw from these.
 *
 * An edition's pages are lined up with the book's own (the edition it was
 * folded into, its base) by image, as the duplicates review lines up two
 * copies: `rows`, each a page of the base and the page of the edition that
 * shows the same art, or one side alone.
 */

import type { PageRow } from './dupes.ts';

/** A `language:` tag's value, as the switch names it. */
const CODES: Record<string, string> = {
	english: 'EN',
	japanese: 'JA',
	chinese: 'ZH',
	korean: 'KO',
	spanish: 'ES',
	french: 'FR',
	german: 'DE',
	portuguese: 'PT',
	russian: 'RU',
	italian: 'IT'
};
export const langCode = (language: string) =>
	CODES[language.toLowerCase()] ?? language.slice(0, 2).toUpperCase();
export const langName = (language: string) => language.toUpperCase();

/** The languages the SETTINGS screen offers for OPENS IN. */
export const PREFERRED = ['english', 'japanese', 'chinese', 'korean'] as const;

export type Edition = {
	entryId: number;
	language: string;
	/** Lined up with the base's pages; empty for the base itself. */
	rows: PageRow[];
	base: boolean;
};

/** Where a page lands: the matched page, or the nearest one that has a match. */
export type Landing = { page: number; exact: boolean };

/**
 * A page of the base (0-based) in an edition: its matched page, or, where the
 * edition lacks it, the page matched to the nearest base page that has one.
 */
export function baseToEdition(rows: PageRow[], basePage: number): Landing {
	const pairs = rows.filter((r) => r.a !== null && r.b !== null) as { a: number; b: number }[];
	if (!pairs.length) return { page: 0, exact: false };
	const hit = pairs.find((r) => r.a === basePage + 1);
	if (hit) return { page: hit.b - 1, exact: true };
	const near = pairs.reduce((best, r) =>
		Math.abs(r.a - (basePage + 1)) < Math.abs(best.a - (basePage + 1)) ? r : best
	);
	return { page: near.b - 1, exact: false };
}

/** A page of an edition (0-based) in the base: the inverse. */
export function editionToBase(rows: PageRow[], editionPage: number): Landing {
	const flipped = rows.map((r) => ({ a: r.b, b: r.a }));
	return baseToEdition(flipped, editionPage);
}

/** A page from one edition to another, through the base: exact only when both steps are. */
export function between(
	from: Pick<Edition, 'rows' | 'base'>,
	to: Pick<Edition, 'rows' | 'base'>,
	page: number
): Landing {
	const base = from.base ? { page, exact: true } : editionToBase(from.rows, page);
	if (to.base) return base;
	const there = baseToEdition(to.rows, base.page);
	return { page: there.page, exact: base.exact && there.exact };
}

/**
 * Which edition a folded book opens in: the book's own choice (its LANGUAGE
 * row), else the owner's preferred language (SETTINGS, English by default),
 * else the one last read, else the base.
 */
export function openingEdition(
	editions: Edition[],
	o: { own: string | null; preferred: string; lastRead: string | null }
): Edition {
	const by = (l: string | null) => (l ? editions.find((e) => e.language === l) : undefined);
	return (
		by(o.own) ?? by(o.preferred) ?? by(o.lastRead) ?? editions.find((e) => e.base) ?? editions[0]
	);
}

/** Pages only one edition has, 1-based: "P. 29 · EN ONLY". */
export const onlyIn = (rows: PageRow[], side: 'a' | 'b'): number[] =>
	rows.filter((r) => r[side] !== null && r[side === 'a' ? 'b' : 'a'] === null).map((r) => r[side]!);

/**
 * A pair of books is part of a bigger one, not an edition of it, when the
 * longer has many pages the shorter's art doesn't match (Pair Review 3c): a
 * switch from the short one would land in the middle of the long one, and
 * one progress can't cover both.
 */
export function partOfBigger(rows: PageRow[], pagesA: number, pagesB: number): boolean {
	const longer = Math.max(pagesA, pagesB);
	const matched = rows.filter((r) => r.a !== null && r.b !== null).length;
	return longer > 0 && matched / longer < 0.6;
}

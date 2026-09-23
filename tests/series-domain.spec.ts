import { describe, expect, it } from 'vitest';
import {
	bulkCounts,
	continueAction,
	currentEntry,
	defaultDirection,
	effectiveDirection,
	entryAtFraction,
	entryStatus,
	entryTitle,
	fileMeta,
	findByNumber,
	listCount,
	listRows,
	parseDirection,
	parseTag,
	railTicks,
	rangeBetween,
	seriesMeta,
	tagGroups,
	type SeriesEntry
} from '$lib/library/series';

/** A series of `n` chapters, the first `read` finished, the next one open at page `page`. */
function chapters(n: number, read: number, page: number | null = null, pages = 54): SeriesEntry[] {
	return Array.from({ length: n }, (_, i) => {
		const number = i + 1;
		const done = number <= read;
		const open = page !== null && number === read + 1;
		return {
			id: 1000 + number,
			number,
			label: `Ch. ${number}`,
			title: '',
			readAt: done ? 1 : null,
			lastPosition: open ? page - 1 : null,
			lastOpenedAt: open ? 100 : done ? 1 : null,
			pageCount: pages,
			file: `Chapter ${number}.cbz`,
			bytes: 16_000_000
		};
	});
}

describe('direction', () => {
	it('defaults by kind: manhwa scrolls, manga and doujin read right to left, novels page', () => {
		expect(defaultDirection('manhwa')).toBe('vertical');
		expect(defaultDirection('manga')).toBe('rtl');
		expect(defaultDirection('doujin')).toBe('rtl');
		expect(defaultDirection('novel')).toBe('paged');
	});

	it('uses the chosen direction only when it fits the kind', () => {
		expect(effectiveDirection({ kind: 'manga', direction: 'ltr' })).toBe('ltr');
		expect(effectiveDirection({ kind: 'manga', direction: null })).toBe('rtl');
		// A novel cannot read right to left page images; fall back.
		expect(effectiveDirection({ kind: 'novel', direction: 'rtl' })).toBe('paged');
		expect(parseDirection('scroll', 'novel')).toBe('scroll');
		expect(parseDirection('scroll', 'manga')).toBeUndefined();
	});
});

describe('the list', () => {
	// The handoff's own example: 612 chapters, 387 read, Ch. 388 open at p. 12.
	const long = chapters(612, 387, 12);

	it('folds everything read before the last two chapters', () => {
		const rows = listRows(long);
		expect(rows[0]).toEqual({ type: 'fold', from: 1, to: 385, count: 385 });
		const first = rows[1];
		expect(first.type === 'entry' && first.entry.number).toBe(386);
		const current = rows.find((r) => r.type === 'entry' && r.state === 'progress');
		expect(current?.type === 'entry' && current.entry.number).toBe(388);
		expect(rows).toHaveLength(1 + 612 - 385);
	});

	it('does not fold when there is too little to fold, or when expanded', () => {
		expect(listRows(chapters(10, 3, 5)).some((r) => r.type === 'fold')).toBe(false);
		expect(listRows(long, { expanded: true })).toHaveLength(612);
	});

	it('flips to newest first with the fold at the bottom', () => {
		const rows = listRows(long, { descending: true });
		expect(rows[0].type === 'entry' && rows[0].entry.number).toBe(612);
		expect(rows[rows.length - 1].type).toBe('fold');
	});

	it('counts and labels', () => {
		expect(listCount(long)).toBe('612 · 387 READ');
		const cur = currentEntry(long)!;
		expect(entryStatus(cur, 'progress', 'manhwa')).toBe('P. 12 / 54');
		expect(entryStatus(cur, 'progress', 'manhwa', true)).toBe('P. 12');
		expect(entryStatus(long[0], 'read', 'manhwa')).toBe('READ');
		expect(entryTitle({ ...long[387], title: 'Ashes at Veyne' }, 'manhwa')).toBe(
			'Chapter 388 - Ashes at Veyne'
		);
		expect(entryTitle({ ...long[211], title: 'The Commission' }, 'novel')).toBe(
			'212 — The Commission'
		);
		expect(entryTitle({ ...long[12], label: 'Vol. 13' }, 'novel')).toBe('Vol. 13');
	});
});

describe('continue', () => {
	it('names the open chapter and the page', () => {
		expect(continueAction({ kind: 'manhwa', entries: chapters(612, 387, 12) })).toMatchObject({
			label: 'CONTINUE',
			meta: 'CH. 388 · P. 12 OF 54',
			short: 'CH. 388'
		});
	});

	it('starts an untouched series and rereads a finished one', () => {
		expect(continueAction({ kind: 'manga', entries: chapters(10, 0) }).label).toBe('START');
		expect(continueAction({ kind: 'manga', entries: chapters(10, 10) }).label).toBe('READ AGAIN');
	});

	it('reads a doujin as a book, from its last page', () => {
		const book = chapters(1, 0, 18, 30);
		expect(continueAction({ kind: 'doujin', entries: book })).toMatchObject({
			label: 'READ FROM P. 18',
			meta: '30 PAGES'
		});
	});

	it('gives a novel its percentage', () => {
		const novel = chapters(591, 211, 38, 100);
		expect(continueAction({ kind: 'novel', entries: novel }).meta).toBe('CH. 212 · 38%');
	});
});

describe('selection and jumping', () => {
	const list = chapters(20, 5);

	it('selects a range whichever end was tapped first', () => {
		expect(rangeBetween(list, 1003, 1006)).toEqual([1003, 1004, 1005, 1006]);
		expect(rangeBetween(list, 1006, 1003)).toEqual([1003, 1004, 1005, 1006]);
		expect(rangeBetween(list, 1003, 9999)).toEqual([]);
	});

	it('counts what each bulk action would change', () => {
		expect(bulkCounts(list, new Set([1004, 1005, 1006, 1007]))).toEqual({
			markRead: 2,
			markUnread: 2
		});
	});

	it('finds a typed number, or the next one after it', () => {
		const gappy = list.filter((e) => e.number !== 7);
		expect(findByNumber(gappy, 7)?.number).toBe(8);
		expect(findByNumber(gappy, 999)?.number).toBe(20);
		expect(findByNumber(gappy, Number.NaN)).toBeNull();
	});

	it('maps the rail to entries and ticks the ends and round numbers', () => {
		const long = chapters(612, 0);
		expect(entryAtFraction(long, 0)?.number).toBe(1);
		expect(entryAtFraction(long, 1)?.number).toBe(612);
		expect(railTicks(long).map((t) => t.label)).toEqual([
			'1',
			'100',
			'200',
			'300',
			'400',
			'500',
			'612'
		]);
	});
});

describe('metadata', () => {
	it('writes the meta line in the design voice', () => {
		expect(seriesMeta({ kind: 'manhwa', source: 'mihon', status: 'ongoing', entries: [] })).toBe(
			'MANHWA · MIHON · ONGOING'
		);
		expect(
			seriesMeta({ kind: 'doujin', source: 'hentoid', status: '', entries: chapters(1, 0) })
		).toBe('DOUJIN · HENTOID · 1 BOOK');
	});

	it('groups tags by namespace, the useful ones first, and counts the rest', () => {
		const { groups, more } = tagGroups(
			[
				{ namespace: 'language', value: 'korean' },
				{ namespace: 'genre', value: 'action' },
				{ namespace: 'genre', value: 'fantasy' },
				{ namespace: 'artist', value: 'Seo Haram' },
				{ namespace: 'source', value: 'mihon' },
				{ namespace: 'zzz', value: 'a' },
				{ namespace: 'zzz', value: 'b' }
			],
			4
		);
		expect(groups.map((g) => g.namespace)).toEqual(['genre', 'artist', 'language', 'source']);
		expect(groups[0].values).toEqual(['action', 'fantasy']);
		expect(more).toBe(2);
	});

	it('parses namespace:value, refusing a malformed namespace', () => {
		expect(parseTag('artist:Seo Haram')).toEqual({ namespace: 'artist', value: 'Seo Haram' });
		expect(parseTag('/ Genre: isekai ')).toEqual({ namespace: 'genre', value: 'isekai' });
		expect(parseTag('oneshot')).toEqual({ namespace: '', value: 'oneshot' });
		expect(parseTag('bad ns:x')).toBeNull();
		expect(parseTag('artist:')).toBeNull();
	});

	it('summarises the files by type and size', () => {
		expect(fileMeta(chapters(612, 0))).toBe('612 CBZ · 9.8 GB');
	});
});

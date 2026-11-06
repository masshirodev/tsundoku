import { describe, expect, it } from 'vitest';
import {
	addedMonth,
	bookMeta,
	booksCount,
	isBookSeries,
	isVolumeSeries,
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
import { SerialSaves } from '../src/routes/series/[id]/serial-saves';

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
			bytes: 16_000_000,
			rating: 0 as const,
			favourite: false,
			addedAt: number,
			coverPage: null,
			available: true,
			locator: '',
			matter: '' as const,
			lastOffset: null,
			volume: '',
			originSource: '',
			tags: []
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

describe('a series of books', () => {
	const books = chapters(6, 3, 12, 30).map((e, i) => ({ ...e, title: `Kaori Mama ${i + 1}` }));
	const doujins = { kind: 'doujin' as const, entries: books };

	it('is a doujin series of two or more books, never one', () => {
		expect(isBookSeries(doujins)).toBe(true);
		expect(isBookSeries({ kind: 'doujin', entries: books.slice(0, 1) })).toBe(false);
		expect(isBookSeries({ kind: 'manga', entries: books })).toBe(false);
	});

	// c558's Gap 1: an extra is not a book, as FORM and `isSingleton` already
	// say (doc/FILTERS.md); this screen's question answers the same way.
	it('does not count an extra beside a single book as a second book', () => {
		const book = books.slice(0, 1);
		const extra = { ...books[1], matter: 'back' as const };
		expect(isBookSeries({ kind: 'doujin', entries: [...book, extra] })).toBe(false);
		expect(isBookSeries({ kind: 'doujin', entries: [...books.slice(0, 2), extra] })).toBe(true);
	});

	it('continues at the book in progress, naming it by position', () => {
		expect(continueAction(doujins)).toMatchObject({
			label: 'CONTINUE',
			meta: 'BOOK 4 · P. 12 OF 30',
			short: 'BOOK 4'
		});
		expect(seriesMeta({ ...doujins, source: 'hentoid', status: '' })).toBe(
			'DOUJIN SERIES · 6 BOOKS'
		);
		expect(booksCount(books)).toBe('6 · 3 READ');
	});

	it('writes each tile’s meta line', () => {
		const cur = currentEntry(books);
		expect(bookMeta(books[0], cur)).toEqual({ text: '30 P · READ', state: 'read' });
		expect(bookMeta(books[3], cur)).toMatchObject({ text: 'P. 12 / 30', state: 'progress' });
		expect(bookMeta(books[4], cur)).toEqual({ text: '30 P', state: 'unread' });
		expect(addedMonth(Date.UTC(2023, 4, 9))).toBe('2023-05');
	});
});

describe('formatNumber', () => {
	it('writes a chapter number as people do, whatever precision it was stored at', async () => {
		const { formatNumber } = await import('$lib/library/series');
		expect(formatNumber(2.0999999046325684)).toBe('2.1');
		expect(formatNumber(2.200000047683716)).toBe('2.2');
		expect(formatNumber(41)).toBe('41');
		expect(formatNumber(12.5)).toBe('12.5');
	});
});

describe('volumes of a novel', () => {
	/** Two books of 12 chapters each, grouped: the first read through, the second at chapter 3. */
	function volumes(): SeriesEntry[] {
		return chapters(24, 14, 3).map((e, i) => ({
			...e,
			file: i < 12 ? 'Vol 1.epub' : 'Vol 2.epub',
			volume: i < 12 ? 'Frieren: Volume 1' : 'Frieren: Volume 2',
			matter: i === 0 || i === 12 ? ('front' as const) : ('' as const)
		}));
	}

	it('heads each volume in CONTENTS, with its own matter and one current entry', () => {
		const rows = listRows(volumes());
		const sections = rows.filter((r) => r.type === 'section');
		expect(sections.map((r) => r.label)).toEqual([
			'VOL. 1 · FRIEREN: VOLUME 1',
			'FRONT MATTER',
			'VOL. 2 · FRIEREN: VOLUME 2',
			'FRONT MATTER'
		]);
		expect(sections[0].detail).toBe('11 · 11 READ');
		expect(new Set(rows.map((r) => (r.type === 'section' ? r.key : ''))).size).toBe(5);
		expect(rows.filter((r) => r.type === 'entry' && r.state === 'progress')).toHaveLength(1);
		// The volume being read holds the only fold; the first is shown whole.
		expect(rows.filter((r) => r.type === 'fold')).toHaveLength(0);
		expect(rows.filter((r) => r.type === 'entry')).toHaveLength(24);
	});

	it('is a series of volumes only with two or more books', () => {
		expect(isVolumeSeries({ kind: 'novel', entries: volumes() })).toBe(true);
		expect(isVolumeSeries({ kind: 'novel', entries: chapters(5, 0) })).toBe(false);
		expect(
			isVolumeSeries({ kind: 'novel', entries: volumes().filter((e) => e.file === 'Vol 1.epub') })
		).toBe(false);
	});
});

describe('SerialSaves: one save in flight per field, the last tap winning (c566)', () => {
	/** A save the test answers by hand, in any order it likes. */
	function held() {
		const order: string[] = [];
		const answers = new Map<string, (ok: boolean) => void>();
		const save = (name: string) => () => {
			order.push(`sent ${name}`);
			return new Promise<boolean>((done) =>
				answers.set(name, (ok) => {
					order.push(`answered ${name}`);
					done(ok);
				})
			);
		};
		const answer = (name: string, ok = true) => answers.get(name)!(ok);
		return { order, save, answer, sent: (name: string) => answers.has(name) };
	}
	const tick = () => new Promise((r) => setTimeout(r, 0));

	it('a second tap waits for the first to answer, and only the second is the latest', async () => {
		const q = new SerialSaves();
		const h = held();
		const one = q.run('fav:1', h.save('1'));
		const two = q.run('fav:1', h.save('0'));
		await tick();
		expect(h.sent('0')).toBe(false);
		h.answer('1');
		expect(await one).toMatchObject({ ok: true, latest: false, earlierStored: false });
		await tick();
		expect(h.sent('0')).toBe(true);
		expect(q.pending('fav:1')).toBe(true);
		h.answer('0');
		expect(await two).toMatchObject({ ok: true, latest: true, earlierStored: true });
		expect(h.order).toEqual(['sent 1', 'answered 1', 'sent 0', 'answered 0']);
		// Pending until the latest says its reload is done.
		expect(q.pending('fav:1')).toBe(true);
		q.settle('fav:1');
		expect(q.pending('fav:1')).toBe(false);
	});

	it('three taps: the first and the third are sent, in order; the second, superseded before its turn, never is', async () => {
		const q = new SerialSaves();
		const h = held();
		const turns = ['5', '7', '2'].map((n) => q.run('rating:1', h.save(n)));
		await tick();
		h.answer('5');
		await tick();
		expect(h.sent('7')).toBe(false);
		h.answer('2');
		const got = await Promise.all(turns);
		expect(got.map((t) => ({ ok: t.ok, latest: t.latest }))).toEqual([
			{ ok: true, latest: false },
			{ ok: false, latest: false },
			{ ok: true, latest: true }
		]);
		expect(h.order).toEqual(['sent 5', 'answered 5', 'sent 2', 'answered 2']);
		// 5 went through before 2's turn: a failing 2 would reload before naming it.
		expect(got[2].earlierStored).toBe(true);
	});

	it('a queued save superseded before its turn is not sent, and a skipped one is no earlier store', async () => {
		const q = new SerialSaves();
		const h = held();
		const a = q.run('fav:1', h.save('a'));
		const b = q.run('fav:1', h.save('b'));
		const c = q.run('fav:1', h.save('c'));
		await tick();
		h.answer('a', false);
		expect((await b).ok).toBe(false);
		expect(h.sent('b')).toBe(false);
		await tick();
		h.answer('c', false);
		expect(await a).toMatchObject({ ok: false, latest: false });
		expect(await c).toMatchObject({ ok: false, latest: true, earlierStored: false });
		expect(h.order).toEqual(['sent a', 'answered a', 'sent c', 'answered c']);
	});

	it('a first save that fails does not stop the second, and the second does not hear of an earlier store', async () => {
		const q = new SerialSaves();
		const h = held();
		const one = q.run('fav:1', h.save('1'));
		const two = q.run('fav:1', h.save('0'));
		await tick();
		h.answer('1', false);
		expect((await one).ok).toBe(false);
		await tick();
		h.answer('0', false);
		expect(await two).toMatchObject({ ok: false, latest: true, earlierStored: false });
	});

	it('a save that throws is not stored and still lets the next one run', async () => {
		const q = new SerialSaves();
		const h = held();
		const one = q.run('fav:1', () => Promise.reject(new Error('offline')));
		const two = q.run('fav:1', h.save('0'));
		expect(await one).toMatchObject({ ok: false, latest: false, earlierStored: false });
		await tick();
		h.answer('0');
		expect((await two).ok).toBe(true);
	});

	it('keys are independent: FAV does not wait for the rating, nor one series for another', async () => {
		const q = new SerialSaves();
		const h = held();
		void q.run('rating:1', h.save('r'));
		void q.run('fav:1', h.save('f'));
		void q.run('rating:2', h.save('r2'));
		await tick();
		expect([h.sent('r'), h.sent('f'), h.sent('r2')]).toEqual([true, true, true]);
	});

	it('a tap after the last settled starts a fresh burst, which has heard of no earlier store', async () => {
		const q = new SerialSaves();
		const h = held();
		const a = q.run('fav:1', h.save('a'));
		const b = q.run('fav:1', h.save('b'));
		await tick();
		h.answer('a');
		await tick();
		h.answer('b');
		expect((await b).earlierStored).toBe(true);
		await a;
		q.settle('fav:1');
		const c = q.run('fav:1', h.save('c'));
		await tick();
		h.answer('c', false);
		expect(await c).toMatchObject({ ok: false, latest: true, earlierStored: false });
	});

	it('a tap during the latest turn’s reload is not sent until that turn settles, and its failure is the newest’s (round 2)', async () => {
		const q = new SerialSaves();
		const h = held();
		const one = q.run('fav:1', h.save('1'));
		await tick();
		h.answer('1');
		const first = await one;
		expect(first).toMatchObject({ ok: true, latest: true });
		expect(first.newer()).toBe(false);
		// A tap during the first's reload: queued, not sent.
		const two = q.run('fav:1', h.save('0'));
		await tick();
		await tick();
		expect(h.sent('0')).toBe(false);
		// The first's caller asks after its reload: a newer tap came, so the band and the clear are not its.
		expect(first.newer()).toBe(true);
		q.settle('fav:1');
		expect(q.pending('fav:1')).toBe(true);
		await tick();
		expect(h.sent('0')).toBe(true);
		h.answer('0', false);
		const second = await two;
		// The newest, failing, with no tap after it: its band must show.
		expect(second).toMatchObject({ ok: false, latest: true, earlierStored: false });
		expect(second.newer()).toBe(false);
		expect(q.pending('fav:1')).toBe(true);
		q.settle('fav:1');
		expect(q.pending('fav:1')).toBe(false);
		expect(second.newer()).toBe(false);
		expect(h.order).toEqual(['sent 1', 'answered 1', 'sent 0', 'answered 0']);
	});

	it('a turn whose caller settles it from a finally lets the next save go even when its reload throws', async () => {
		const q = new SerialSaves();
		const h = held();
		const one = q.run('fav:1', h.save('1'));
		await tick();
		h.answer('1');
		await one;
		const two = q.run('fav:1', h.save('0'));
		const reload = async () => {
			try {
				await Promise.reject(new Error('reload failed'));
			} finally {
				q.settle('fav:1');
			}
		};
		await expect(reload()).rejects.toThrow('reload failed');
		await tick();
		expect(h.sent('0')).toBe(true);
		h.answer('0');
		expect((await two).latest).toBe(true);
		q.settle('fav:1');
		expect(q.pending('fav:1')).toBe(false);
	});

	it('a tap after the whole burst settled is newer than every turn of it', async () => {
		const q = new SerialSaves();
		const h = held();
		const one = q.run('fav:1', h.save('1'));
		await tick();
		h.answer('1');
		const first = await one;
		q.settle('fav:1');
		expect(first.newer()).toBe(false);
		void q.run('fav:1', h.save('0'));
		expect(first.newer()).toBe(true);
	});
});

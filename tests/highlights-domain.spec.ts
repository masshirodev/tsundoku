import { describe, expect, it } from 'vitest';
import {
	cellLabel,
	cellState,
	keepKey,
	keptOn,
	pageSheetHead,
	pageSheetLine,
	pageTicks,
	pagesOf,
	ruleSide,
	spreadChoices,
	type CellState,
	type KeptPage
} from '$lib/library/highlights';
import {
	byDay,
	byEntry,
	clipLength,
	clock,
	copyName,
	dayHeading,
	deleteWithLine,
	filterHighlights,
	foundIn,
	HIGHLIGHT_KINDS,
	inReadingOrder,
	keptAcrossLine,
	keptLine,
	kindCounts,
	lostLine,
	metaLine,
	moveLine,
	NO_FILTER,
	placeOf,
	seriesLine,
	seriesOf,
	sizeWord,
	slug,
	stateTag,
	toMarkdown,
	startSecond,
	wayBackHref,
	wayBackLabel,
	type Highlight,
	type PointerState
} from '$lib/library/highlights';

/**
 * Highlights' pure rules (c701; doc/HIGHLIGHTS.md): what each screen says,
 * in which order, and what leaves as Markdown. The words are the handoff's
 * (doc/handoffs/highlights/: Main, Page, Series, Out).
 */

const NOW = new Date(2026, 10, 7, 21, 14).getTime();
const DAY = 86_400_000;

let next = 1;
function h(o: Partial<Highlight> = {}): Highlight {
	return {
		id: next++,
		kind: 'quote',
		seriesId: 1,
		entryId: 10,
		number: 3,
		season: null,
		block: 3,
		offset: 12,
		endBlock: 3,
		endOffset: 40,
		page: null,
		pageEnd: null,
		clipIn: null,
		clipOut: null,
		seriesTitle: 'Hoshizora no Shisho',
		seriesKind: 'novel',
		entryLabel: 'Ch. 3',
		entryTitle: 'The Thirteenth Lamp',
		volume: '',
		quote: 'Nothing is only anything',
		paragraph: '“Nothing is only anything,” she said.',
		context: '',
		colour: 'yellow',
		note: '',
		madeAt: NOW,
		hidden: false,
		copyPath: '',
		stillPath: '',
		copyBytes: 0,
		width: null,
		height: null,
		quality: '',
		tracks: [],
		track: null,
		state: 'ok',
		orphanedAt: null,
		...o
	};
}
const page = (o: Partial<Highlight> = {}) =>
	h({
		kind: 'page',
		seriesTitle: 'Kaze no Tou no Shoujo',
		seriesKind: 'manga',
		entryLabel: 'Ch. 42',
		entryTitle: '',
		number: 42,
		page: 13,
		block: null,
		offset: null,
		colour: null,
		quote: '',
		paragraph: '',
		...o
	});
const clip = (o: Partial<Highlight> = {}) =>
	h({
		kind: 'clip',
		seriesTitle: 'Toudai no Mukou',
		seriesKind: 'anime',
		entryLabel: 'Ep. 7',
		entryTitle: '',
		number: 7,
		season: 1,
		clipIn: 724,
		clipOut: 816,
		block: null,
		offset: null,
		colour: null,
		quote: '',
		paragraph: '',
		...o
	});

describe('the player’s ?t= (c734)', () => {
	it('takes plain seconds, 0 included, which wins over a saved place like any other', () => {
		for (const [raw, t] of [
			['0', 0],
			['734', 734],
			['734.5', 734.5],
			['00012', 12]
		] as const)
			expect(startSecond(raw, 1440), raw).toBe(t);
	});

	it('is nothing for anything else, so the saved place stands', () => {
		for (const raw of [
			null,
			'',
			' ',
			'abc',
			'NaN',
			'-1',
			'-0',
			'+5',
			'1e3',
			'0x10',
			'Infinity',
			'12s',
			'1:30',
			'1.',
			'.5'
		])
			expect(startSecond(raw, 1440), String(raw)).toBeNull();
	});

	it('is nothing at or past a known length, and waits for the file’s when none is known', () => {
		expect(startSecond('1439.9', 1440)).toBe(1439.9);
		expect(startSecond('1440', 1440)).toBeNull();
		expect(startSecond('5000', 1440)).toBeNull();
		expect(startSecond('5000', null)).toBe(5000);
		expect(startSecond('5000', 0)).toBe(5000);
	});

	it('reads back what wayBackHref writes', () => {
		const t = new URL(`http://x${wayBackHref(clip({ clipIn: 734.5004 }))}`).searchParams.get('t');
		expect(startSecond(t, 1440)).toBe(734.5);
	});
});

describe('what a highlight is called', () => {
	it('says a clip’s points and length as the player does', () => {
		expect(clock(0)).toBe('0:00');
		expect(clock(92)).toBe('1:32');
		expect(clock(180)).toBe('3:00');
		expect(clock(3729)).toBe('1:02:09');
		expect(clipLength(clip())).toBe('1:32');
		expect(clipLength(page())).toBe('');
	});

	it('says where in the entry: ¶, P., and the clip’s points', () => {
		expect(placeOf(h())).toBe('CH. 3 · ¶ 4');
		expect(placeOf(page())).toBe('CH. 42 · P. 14');
		expect(placeOf(page({ pageEnd: 14 }))).toBe('CH. 42 · P. 14–15');
		expect(placeOf(clip())).toBe('S1 · EP. 7 · 12:04–13:36');
		expect(placeOf(clip(), { season: false, points: false })).toBe('EP. 7');
		// No label kept: the registry's unit and the number.
		expect(placeOf(page({ entryLabel: '' }))).toBe('CH. 42 · P. 14');
		expect(placeOf(clip({ entryLabel: '', season: null }))).toBe('EP. 7 · 12:04–13:36');
	});

	it('the list row’s meta: kind, place, the orphan’s day, ≡ for a note', () => {
		expect(metaLine(h(), NOW)).toBe('QUOTE · CH. 3 · ¶ 4');
		expect(metaLine(page({ note: 'the tower' }), NOW)).toBe('PAGE · CH. 42 · P. 14 · ≡');
		expect(
			metaLine(h({ state: 'orphan_series', orphanedAt: new Date(2026, 10, 1).getTime() }), NOW)
		).toBe('QUOTE · CH. 3 · ¶ 4 · DELETED 1 NOV');
		expect(metaLine(clip(), NOW, { short: true })).toBe('CLIP · EP. 7');
	});

	it('names every state, in full and as the phone shortens it', () => {
		const all: [PointerState, string | null, string | null][] = [
			['ok', null, null],
			['orphan_series', 'FROM A SERIES NO LONGER IN THE LIBRARY', 'NO LONGER IN THE LIBRARY'],
			// A novel's entry is a VOLUME to the registry (kinds.ts), so its orphan says so.
			['orphan_entry', 'FROM A VOLUME NO LONGER IN THE SERIES', 'NO LONGER IN THE SERIES'],
			['detached', 'DETACHED · THE CHAPTER CHANGED', 'DETACHED · THE CHAPTER CHANGED']
		];
		for (const [state, long, short] of all) {
			expect(stateTag(h({ state })), state).toBe(long);
			expect(stateTag(h({ state }), true), state).toBe(short);
		}
		expect(stateTag(clip({ state: 'orphan_entry' }))).toBe(
			'FROM AN EPISODE NO LONGER IN THE SERIES'
		);
		expect(stateTag(page({ state: 'orphan_entry' }))).toBe(
			'FROM A CHAPTER NO LONGER IN THE SERIES'
		);
	});

	it('the way back goes to the place, and nowhere once it is gone', () => {
		expect(wayBackHref(h())).toBe('/read/10?at=3.12');
		expect(wayBackHref(h({ state: 'detached' }))).toBe('/read/10?at=3.0');
		expect(wayBackHref(page())).toBe('/read/10?p=14');
		expect(wayBackHref(clip())).toBe(`/read/10?t=${clip().clipIn}`);
		expect(wayBackHref(clip({ clipIn: null }))).toBe('/read/10');
		expect(wayBackHref(clip({ clipIn: 734.5004 }))).toBe('/read/10?t=734.5');
		expect(wayBackHref(clip({ clipIn: 0.0000001 }))).toBe('/read/10?t=0');
		expect(wayBackHref(h({ state: 'orphan_entry', entryId: null }))).toBeNull();
		expect(wayBackHref(page({ state: 'orphan_series', entryId: null, seriesId: null }))).toBeNull();
		expect(wayBackLabel(h())).toBe('CH. 3 →');
		expect(wayBackLabel(page())).toBe('CH. 42 · P. 14 →');
		expect(wayBackLabel(clip())).toBe('EPISODE · 12:04 →');
	});
});

describe('the page’s orders, filters and search', () => {
	it('newest first, by day: TODAY, then the day', () => {
		const a = h({ madeAt: NOW - 2 * DAY });
		const b = page({ madeAt: NOW - 1000 });
		const c = clip({ madeAt: NOW - 3 * 60_000 });
		const days = byDay([a, b, c], NOW);
		expect(days.map((d) => d.day)).toEqual(['TODAY', '5 NOV']);
		expect(days[0].items.map((x) => x.id)).toEqual([b.id, c.id]);
		expect(dayHeading(new Date(2025, 0, 2).getTime(), NOW)).toBe('2 JAN 2025');
	});

	it('a series in reading order: season, number, then where in the entry, whenever made', () => {
		const late = h({
			number: 1,
			block: 0,
			offset: 0,
			madeAt: NOW,
			entryLabel: 'Ch. 1',
			entryTitle: 'The Harbour'
		});
		const mid2 = h({ number: 3, block: 9, offset: 0, madeAt: NOW - 5 * DAY });
		const mid1 = h({ number: 3, block: 3, offset: 12, madeAt: NOW - DAY });
		const gone = h({ number: 9, state: 'orphan_entry', entryId: null, entryLabel: 'Ch. 9' });
		const order = inReadingOrder([gone, mid2, late, mid1]);
		expect(order.map((x) => x.id)).toEqual([late.id, mid1.id, mid2.id, gone.id]);
		const groups = byEntry([gone, mid2, late, mid1]);
		expect(groups.map((g) => [g.heading, g.items.length, g.gone])).toEqual([
			['CH. 1 — THE HARBOUR', 1, false],
			['CH. 3 — THE THIRTEENTH LAMP', 2, false],
			['CH. 9 · NO LONGER IN THE SERIES', 1, true]
		]);
	});

	it('an anime by season and episode', () => {
		const s2 = clip({ season: 2, number: 1, entryTitle: 'Fog' });
		const s1 = clip({ season: 1, number: 11, entryLabel: 'Ep. 11' });
		expect(byEntry([s2, s1]).map((g) => g.heading)).toEqual(['S1 · EP. 11', 'S2 · EP. 7 — FOG']);
	});

	it('finds by the quote, then the note, then the series’ name; pages and clips by note', () => {
		const q = h({ quote: 'the thirteenth lamp finally went dark' });
		const n = clip({ note: 'The lamp scene, the same as the novel’s.' });
		const s = page({ seriesTitle: 'Lamplighter' });
		const none = page();
		expect(foundIn(q, 'LAMP')).toBe('quote');
		expect(foundIn(n, 'lamp')).toBe('note');
		expect(foundIn(s, 'lamp')).toBe('series');
		expect(foundIn(none, 'lamp')).toBeNull();
		expect(foundIn(q, '   ')).toBeNull();
		// A page's own text is not searched: it has none.
		expect(foundIn(page({ quote: 'lamp' }), 'lamp')).toBeNull();
		const list = [q, n, s, none];
		expect(filterHighlights(list, { ...NO_FILTER, q: 'lamp' })).toEqual([q, n, s]);
	});

	it('filters by kind, series and NO WAY BACK, and counts every kind', () => {
		const a = h();
		const b = page({ seriesId: 2 });
		const c = clip({ seriesId: null, state: 'orphan_series', entryId: null });
		const d = h({ state: 'orphan_entry', entryId: null });
		const e = h({ state: 'detached' });
		const list = [a, b, c, d, e];
		expect(kindCounts(list)).toEqual({ all: 5, quote: 3, page: 1, clip: 1, lost: 2 });
		expect(filterHighlights(list, { ...NO_FILTER, lost: true })).toEqual([c, d]);
		expect(filterHighlights(list, { ...NO_FILTER, series: 2 })).toEqual([b]);
		for (const k of HIGHLIGHT_KINDS)
			expect(filterHighlights(list, { ...NO_FILTER, kind: k }).every((x) => x.kind === k)).toBe(
				true
			);
		expect(seriesOf(list)).toEqual([
			{ id: 1, title: 'Hoshizora no Shisho', n: 3 },
			{ id: 2, title: 'Kaze no Tou no Shoujo', n: 1 }
		]);
	});
});

describe('the lines other screens say', () => {
	it('the series row: a book’s quotes bare, pages and clips by their word, notes after', () => {
		expect(seriesLine([])).toBe('');
		expect(seriesLine(Array.from({ length: 14 }, (_, i) => h({ note: i < 3 ? 'n' : '' })))).toBe(
			'14 · 3 NOTES'
		);
		expect(seriesLine(Array.from({ length: 14 }, () => h()))).toBe('14');
		expect(seriesLine([...Array.from({ length: 5 }, () => page()), page({ note: 'n' })])).toBe(
			'6 PAGES · 1 NOTE'
		);
		expect(seriesLine([page()])).toBe('1 PAGE');
		expect(seriesLine(Array.from({ length: 4 }, () => clip()))).toBe('4 CLIPS');
		expect(seriesLine([clip()])).toBe('1 CLIP');
		expect(seriesLine([h(), page()])).toBe('2');
	});

	it('DELETE’s and MOVE’s words, one and many', () => {
		expect(keptLine(14)).toBe('14 HIGHLIGHTS ARE KEPT');
		expect(keptLine(1)).toBe('1 HIGHLIGHT IS KEPT');
		expect(keptAcrossLine(31, 4)).toBe('31 HIGHLIGHTS IN 4 SERIES ARE KEPT');
		expect(keptAcrossLine(2, 1)).toBe('2 HIGHLIGHTS ARE KEPT');
		expect(deleteWithLine(14)).toBe('DELETE WITH 14 HIGHLIGHTS');
		expect(deleteWithLine(1)).toBe('DELETE WITH 1 HIGHLIGHT');
		expect(moveLine(14, 2)).toBe('14 FOLLOW · 2 LOSE THEIR WAY BACK');
		expect(moveLine(6, 1)).toBe('6 FOLLOW · 1 LOSES ITS WAY BACK');
		expect(moveLine(1, 0)).toBe('1 FOLLOWS');
		expect(lostLine(2)).toBe('2 HIGHLIGHTS LOST THEIR WAY BACK');
		expect(lostLine(1)).toBe('1 HIGHLIGHT LOST ITS WAY BACK');
	});

	it('the disk line’s sizes', () => {
		expect(sizeWord(0)).toBe('0 MB');
		expect(sizeWord(200)).toBe('1 KB');
		expect(sizeWord(640 * 1024)).toBe('640 KB');
		expect(sizeWord(14 * 1024 ** 2)).toBe('14 MB');
		expect(sizeWord(1.25 * 1024 ** 3)).toBe('1.3 GB');
	});
});

describe('getting them out', () => {
	it('names a file by series, chapter and page, or episode and in point', () => {
		expect(slug('Kaze no Tou no Shoujo')).toBe('kaze-no-tou-no-shoujo');
		expect(slug('Kōhai no Himitsu: Nikki!')).toBe('kohai-no-himitsu-nikki');
		expect(slug('積ん読')).toBe('highlights');
		// Its own output is already a slug.
		expect(slug(slug('Kaze no Tou'))).toBe('kaze-no-tou');
		expect(copyName(page(), 'jpg')).toBe('kaze-no-tou-no-shoujo-ch42-p14.jpg');
		expect(copyName(clip(), 'mp4')).toBe('toudai-no-mukou-ep07-1204.mp4');
	});

	it('a book as Markdown: a heading per chapter in reading order, quotes, notes, the detached said', () => {
		const list = [
			h({
				number: 9,
				entryLabel: 'Ch. 9',
				entryTitle: 'A Boat',
				quote: 'watch the one that stays',
				colour: 'orange',
				state: 'detached'
			}),
			h({
				number: 1,
				block: 0,
				entryLabel: 'Ch. 1',
				entryTitle: 'The Harbour',
				quote: 'The lamps along the harbour went out one by one.'
			}),
			h({
				quote: '“Nothing is only anything,” she said.',
				note: 'Her mother’s line, the one she won’t say out loud.'
			})
		];
		expect(toMarkdown(list, 'Hoshizora no Shisho', { colours: 'leave', now: NOW })).toBe(
			[
				'# Hoshizora no Shisho',
				'',
				'3 highlights · 1 note · from tsundoku, 7 Nov 2026',
				'',
				'## Ch. 1 — The Harbour',
				'',
				'> The lamps along the harbour went out one by one.',
				'',
				'## Ch. 3 — The Thirteenth Lamp',
				'',
				'> “Nothing is only anything,” she said.',
				'',
				'Her mother’s line, the one she won’t say out loud.',
				'',
				'## Ch. 9 — A Boat',
				'',
				'> watch the one that stays',
				'',
				'*Detached: the chapter changed after this was kept.*',
				''
			].join('\n')
		);
		const tagged = toMarkdown(list, 'Hoshizora no Shisho', { colours: 'tag', now: NOW });
		expect(tagged).toContain('> watch the one that stays\n\n#orange');
	});

	it('every series the filters leave, grouped by series; a page and a clip as where they are', () => {
		const md = toMarkdown(
			[
				page({ note: 'the tower', seriesId: 2 }),
				clip({ state: 'orphan_series', seriesId: null }),
				h()
			],
			'Highlights',
			{ colours: 'leave', now: NOW, bySeries: true }
		);
		expect(md.split('\n').filter((l) => l.startsWith('## '))).toEqual([
			'## Hoshizora no Shisho',
			'## Kaze no Tou no Shoujo',
			'## Toudai no Mukou'
		]);
		expect(md).toContain('### Ch. 42\n\n*page: CH. 42 · P. 14*\n\nthe tower');
		expect(md).toContain(
			'*clip: S1 · EP. 7 · 12:04–13:36*\n\n*From a series no longer in the library.*'
		);
	});
});

// ---- H3: a page kept from the image reader (c703) ------------------------------------------

const kp = (id: number, page: number, pageEnd: number | null = null): KeptPage => ({
	id,
	page,
	pageEnd,
	note: '',
	madeAt: Date.UTC(2026, 10, 4, 12),
	bytes: 1.4 * 1024 * 1024
});

describe('the reader’s HIGHLIGHT cell (c703, Manga M1, M3, M4, M7)', () => {
	it('ranks its states as the handoff does: every combination of the four facts', () => {
		const states: string[] = [];
		for (const incognito of [false, true])
			for (const keeping of [false, true])
				for (const kept of [false, true])
					for (const online of [false, true]) {
						const s = cellState({
							kept: kept ? [kp(1, 4)] : [],
							group: [4],
							keeping,
							online,
							incognito
						});
						const want: CellState = incognito
							? 'incognito'
							: keeping
								? 'keeping'
								: kept
									? 'kept'
									: online
										? 'idle'
										: 'offline';
						expect(s, JSON.stringify({ incognito, keeping, kept, online })).toBe(want);
						states.push(s);
					}
		expect(new Set(states)).toEqual(new Set(['idle', 'kept', 'keeping', 'offline', 'incognito']));
	});

	it('names each state, and the strip names its page', () => {
		const all: CellState[] = ['idle', 'kept', 'keeping', 'offline', 'incognito'];
		expect(all.map((s) => cellLabel(s, { strip: false, page: 13 }))).toEqual([
			'HIGHLIGHT',
			'✓ HIGHLIGHTED',
			'KEEPING…',
			'○ HIGHLIGHT',
			'INCOGNITO'
		]);
		expect(all.map((s) => cellLabel(s, { strip: true, page: 22 }))).toEqual([
			'HIGHLIGHT P. 23',
			'✓ HIGHLIGHTED',
			'KEEPING…',
			'○ HIGHLIGHT',
			'INCOGNITO'
		]);
	});

	it('a spread is kept when either page or BOTH is, and a page on another screen is not', () => {
		const kept = [kp(1, 3), kp(2, 10, 11)];
		expect(keptOn(kept, [3, 4]).map((k) => k.id)).toEqual([1]);
		expect(keptOn(kept, [11, 12]).map((k) => k.id)).toEqual([2]);
		expect(keptOn(kept, [5, 6])).toEqual([]);
		expect(keptOn(kept, [10]).map((k) => k.id)).toEqual([2]);
		expect(pagesOf(kp(3, 7, 8))).toEqual([7, 8]);
		expect(pagesOf(kp(3, 7))).toEqual([7]);
	});

	it('ticks every page covered once, in order', () => {
		expect(pageTicks([kp(1, 9), kp(2, 2, 3), kp(3, 3), kp(4, 0)])).toEqual([0, 2, 3, 9]);
		expect(pageTicks([])).toEqual([]);
	});

	it('knows one ask by its page, so the same page twice is one', () => {
		expect(keepKey(5, 13, null)).toBe(keepKey(5, 13, null));
		expect(keepKey(5, 13, null)).not.toBe(keepKey(5, 13, 14));
		expect(keepKey(5, 13, null)).not.toBe(keepKey(6, 13, null));
	});
});

describe('a spread’s choice (c703, Manga M2)', () => {
	it('R→L: the right page first, then the left, then BOTH as one', () => {
		expect(spreadChoices([13, 14], true, [])).toEqual([
			{ label: 'P. 14', where: 'RIGHT', page: 13, pageEnd: null, keptId: null },
			{ label: 'P. 15', where: 'LEFT', page: 14, pageEnd: null, keptId: null },
			{ label: 'BOTH', where: 'AS ONE', page: 13, pageEnd: 14, keptId: null }
		]);
	});

	it('L→R: the left page first; a kept choice carries its id, and BOTH is not either page', () => {
		const c = spreadChoices([13, 14], false, [kp(7, 14), kp(8, 13, 14)]);
		expect(c.map((x) => [x.label, x.where, x.keptId])).toEqual([
			['P. 14', 'LEFT', null],
			['P. 15', 'RIGHT', 7],
			['BOTH', 'AS ONE', 8]
		]);
	});
});

describe('the gutter rule and the page sheet (c703, Manga M3, M6)', () => {
	it('sits on the outer side, away from the spine: every side in both directions', () => {
		expect(
			(['left', 'right', 'center'] as const).flatMap((side) =>
				[true, false].map((rtl) => [side, rtl, ruleSide(side, rtl)])
			)
		).toEqual([
			['left', true, 'left'],
			['left', false, 'left'],
			['right', true, 'right'],
			['right', false, 'right'],
			['center', true, 'right'],
			['center', false, 'left']
		]);
	});

	it('heads the sheet with the chapter and the page, or the spread', () => {
		expect(pageSheetHead('Ch. 42', kp(1, 13))).toBe('HIGHLIGHT · CH. 42 · P. 14');
		expect(pageSheetHead('Ch. 42', kp(1, 13, 14))).toBe('HIGHLIGHT · CH. 42 · P. 14–15');
		expect(pageSheetHead('', kp(1, 0))).toBe('HIGHLIGHT · P. 1');
		expect(pageSheetLine(kp(1, 0), Date.UTC(2026, 10, 7, 12))).toBe(
			'MADE 4 NOV · A COPY ON THE WORKSTATION · 1 MB'
		);
	});
});

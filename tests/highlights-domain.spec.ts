import { describe, expect, it } from 'vitest';
import { isVerticalBook } from '$lib/reader/text';
import {
	atPageEnd,
	BAR_H,
	barPlace,
	bookLocale,
	contains,
	flatIndex,
	flatten,
	HOLD_STRIP,
	joinSpans,
	mergeNotes,
	NOTE_LIMIT,
	ordered,
	overlaps,
	quoteParts,
	quoteSheetHead,
	quoteSheetLine,
	reanchor,
	wordAround,
	type TextSpan,
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
	type KeptPage,
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
	clipAsk,
	clipRange,
	cutCues,
	startSecond,
	toVtt,
	wayBackHref,
	wayBackLabel,
	type Highlight,
	type PointerState
} from '$lib/library/highlights';
import { parseVtt } from '$lib/library/player';

/**
 * Highlights' pure rules (doc/HIGHLIGHTS.md): what each screen says,
 * in which order, and what leaves as Markdown.
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

describe('a clip’s range (c704)', () => {
	it('follows the playhead until MARK OUT, and stops at 3:00', () => {
		expect(clipRange({ in: 724, out: null }, 816)).toEqual({
			from: 724,
			to: 816,
			length: 92,
			capped: false
		});
		expect(clipRange({ in: 724, out: null }, 904)).toEqual({
			from: 724,
			to: 904,
			length: 180,
			capped: false
		});
		expect(clipRange({ in: 724, out: null }, 904.04)).toEqual({
			from: 724,
			to: 904,
			length: 180,
			capped: true
		});
	});
	it('swaps an out before the in, and holds three minutes from the IN on that side', () => {
		expect(clipRange({ in: 800, out: 700 }, 0)).toEqual({
			from: 700,
			to: 800,
			length: 100,
			capped: false
		});
		expect(clipRange({ in: 1000, out: 700 }, 0)).toEqual({
			from: 820,
			to: 1000,
			length: 180,
			capped: true
		});
		// The range has the point the viewer marked in it, however far back the out went.
		const r = clipRange({ in: 1000, out: 100 }, 0);
		expect(r.from).toBeLessThanOrEqual(1000);
		expect(r.to).toBeGreaterThanOrEqual(1000);
		expect(clipRange({ in: 1000, out: 820 }, 0)).toMatchObject({ length: 180, capped: false });
	});
	it('a range of nothing has no length, and a negative mark is at zero', () => {
		expect(clipRange({ in: 5, out: 5 }, 0).length).toBe(0);
		expect(clipRange({ in: -3, out: null }, 4)).toMatchObject({ from: 0, to: 4 });
	});
	it('KEEP’s ask is in order, three minutes at most, or nothing', () => {
		expect(clipAsk(10, 190)).toEqual({ from: 10, to: 190, capped: false });
		expect(clipAsk(10, 190.5)).toEqual({ from: 10, to: 190, capped: true });
		expect(clipAsk(20, 10)).toEqual({ from: 10, to: 20, capped: false });
		for (const bad of [
			[5, 5],
			['a', 1],
			[NaN, 1],
			[-1, 4],
			[1, Infinity]
		])
			expect(clipAsk(bad[0], bad[1]), String(bad)).toBeNull();
	});
	it('cuts a track’s cues to the range and shifts them to zero, a cue over the edge trimmed', () => {
		const cues = [
			{ start: 8, end: 11, text: 'before over' },
			{ start: 12, end: 13, text: 'in' },
			{ start: 19, end: 22, text: 'over the end' },
			{ start: 22, end: 25, text: 'after' }
		];
		expect(cutCues(cues, 10, 20)).toEqual([
			{ start: 0, end: 1, text: 'before over' },
			{ start: 2, end: 3, text: 'in' },
			{ start: 9, end: 10, text: 'over the end' }
		]);
	});
	it('writes WEBVTT its own reader reads back', () => {
		const cues = [{ start: 0, end: 1.5, text: 'line' }];
		expect(parseVtt(toVtt(cues))).toEqual(cues);
	});
});

describe('the player’s ?t=', () => {
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

// ---- H3: a page kept from the image reader ------------------------------------------

const kp = (id: number, page: number, pageEnd: number | null = null): KeptPage => ({
	id,
	page,
	pageEnd,
	note: '',
	madeAt: Date.UTC(2026, 10, 4, 12),
	bytes: 1.4 * 1024 * 1024
});

describe('the reader’s HIGHLIGHT cell', () => {
	it('ranks its states as the design does: every combination of the four facts', () => {
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

describe('a spread’s choice', () => {
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

describe('the gutter rule and the page sheet', () => {
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

// ---- H2: a passage kept from the text reader ------------------------------------

describe('flatten: a chapter as the rules read it', () => {
	it('collapses white space, drops the ends and joins blocks by a newline', () => {
		const f = flatten(['  one\n   two ', '', 'three']);
		expect(f.text).toBe('one two\nthree');
		// Each character says where it came from in its own block.
		expect(flatIndex(f, 0, 2)).toBe(0);
		expect(f.offsetAt[f.text.indexOf('t')]).toBe(9);
		expect(f.blockAt[f.text.indexOf('r')]).toBe(2);
	});
	it('holds on its own output (a normaliser must)', () => {
		for (const blocks of [[' a  b '], ['a', '', ' b\nc']]) {
			const once = flatten(blocks).text;
			expect(flatten(once.split('\n')).text).toBe(once);
		}
	});
	it('an illustration has no words and is not in it, so it never moves a quote', () => {
		expect(flatten(['a', '', 'b']).text).toBe(flatten(['a', 'b']).text);
	});
});

describe('quoteParts: the copy of a span', () => {
	const f = flatten([
		'First paragraph of the chapter, long enough to have context.',
		'Nothing is only anything, she said.'
	]);
	const span = { block: 1, offset: 0, endBlock: 1, endOffset: 7 };
	it('keeps the quote, its 32 characters either side, the paragraph and the one before', () => {
		const q = quoteParts(f, span)!;
		expect(q.quote).toBe('Nothing');
		expect(q.before).toBe('r, long enough to have context.\n');
		expect(q.before).toHaveLength(32);
		expect(q.after).toBe(' is only anything, she said.');
		expect(q.paragraph).toBe('Nothing is only anything, she said.');
		expect(q.context).toBe('First paragraph of the chapter, long enough to have context.');
	});
	it('a span of white space is no quote, and white space at its ends is not part of it', () => {
		const g = flatten(['one two three']);
		expect(quoteParts(g, { block: 0, offset: 3, endBlock: 0, endOffset: 4 })).toBeNull();
		const q = quoteParts(g, { block: 0, offset: 3, endBlock: 0, endOffset: 8 })!;
		expect(q.quote).toBe('two');
		expect(q.span).toEqual({ block: 0, offset: 4, endBlock: 0, endOffset: 7 });
	});
	it('across two blocks the quote has its newline and the paragraph is both', () => {
		const q = quoteParts(f, { block: 0, offset: 52, endBlock: 1, endOffset: 7 })!;
		expect(q.quote).toBe('context.\nNothing');
		expect(q.paragraph).toContain(q.quote);
	});
	it('never splits a character at the edge of the 32', () => {
		const clef = '𝄞';
		// One letter either side, so the 32 lands between a character's two halves.
		const text = clef.repeat(20) + 'x' + 'word' + 'x' + clef.repeat(20);
		const f2 = flatten([text]);
		const at = text.indexOf('word');
		expect((at - 32) % 2).toBe(1);
		const q = quoteParts(f2, { block: 0, offset: at, endBlock: 0, endOffset: at + 4 })!;
		const whole = (s: string) => /^(?:[^\uD800-\uDFFF]|[\uD800-\uDBFF][\uDC00-\uDFFF])*$/.test(s);
		expect(whole(q.before)).toBe(true);
		expect(whole(q.after)).toBe(true);
		expect(q.before.length).toBeGreaterThan(0);
	});
});

/** A span's words, at its place. */
function kept(blocks: string[], s: TextSpan) {
	const f = flatten(blocks);
	const q = quoteParts(f, s)!;
	return { ...q.span, quote: q.quote, before: q.before, after: q.after };
}

describe('reanchor: re-finding a quote, never fuzzy', () => {
	const old = ['The fog came up the steps.', 'She said nothing at all.'];
	const span = { block: 1, offset: 4, endBlock: 1, endOffset: 8 }; // "said"
	it('unchanged: where it was, and no write', () => {
		const k = kept(old, span);
		expect(reanchor(flatten(old), k)).toEqual({ state: 'ok', span, moved: false });
	});
	it('a paragraph added above: one match, re-anchored', () => {
		const r = reanchor(flatten(['New opening line.', ...old]), kept(old, span));
		expect(r).toEqual({
			state: 'ok',
			moved: true,
			span: { block: 2, offset: 4, endBlock: 2, endOffset: 8 }
		});
	});
	it('its words gone: DETACHED', () => {
		expect(reanchor(flatten(['The fog came up.']), kept(old, span)).state).toBe('detached');
	});
	it('the same words and sides twice: DETACHED', () => {
		const k = kept(old, span);
		const twice = ['Other.', ...old, 'Between.', ...old];
		expect(reanchor(flatten(twice), k).state).toBe('detached');
	});
	it('one letter different is no match: never fuzzy', () => {
		const k = kept(old, span);
		expect(reanchor(flatten([old[0], 'She sald nothing at all.']), k).state).toBe('detached');
	});
	it('a two-block quote whose second block went: DETACHED', () => {
		const k = kept(old, { block: 0, offset: 8, endBlock: 1, endOffset: 3 });
		expect(k.quote).toContain('\n');
		expect(reanchor(flatten([old[0]]), k).state).toBe('detached');
	});
	it('a chapter that comes back: DETACHED finds its place again by the same search', () => {
		const k = kept(old, span);
		expect(reanchor(flatten(['Nope']), k).state).toBe('detached');
		expect(reanchor(flatten(old), k).state).toBe('ok');
	});
	it('the same words twice with different sides: each finds its own', () => {
		const blocks = ['alpha lamp beta', 'gamma lamp delta'];
		const a = kept(blocks, { block: 0, offset: 6, endBlock: 0, endOffset: 10 });
		const b = kept(blocks, { block: 1, offset: 6, endBlock: 1, endOffset: 10 });
		expect(reanchor(flatten(['intro', ...blocks]), a)).toMatchObject({
			state: 'ok',
			span: { block: 1, offset: 6 }
		});
		expect(reanchor(flatten(['intro', ...blocks]), b)).toMatchObject({
			state: 'ok',
			span: { block: 2, offset: 6 }
		});
	});
});

describe('reanchor against a naive search: a finite domain, all of it', () => {
	// Every text of up to five letters from {a, b, space}, as one block or two,
	// every span of every one, against every other text. The model is the rule
	// written the slow, obvious way, over the same flat text.
	const letters = ['a', 'b', ' '];
	const texts: string[] = [''];
	for (let n = 1, layer = ['']; n <= 5; n++) {
		layer = layer.flatMap((t) => letters.map((l) => t + l));
		texts.push(...layer);
	}
	const blockings = texts.flatMap((t) =>
		t.length < 2 ? [[t]] : [[t], [t.slice(0, 2), t.slice(2)]]
	);
	// Over a million pairs: a few seconds here, past the default 5 s on a 4-core runner.
	it('agrees on every pair', () => {
		let ran = 0;
		let different = 0;
		for (const original of blockings) {
			const f0 = flatten(original);
			if (f0.text.length === 0 || f0.text.length > 4) continue;
			for (let from = 0; from < f0.text.length; from++) {
				for (let to = from + 1; to <= f0.text.length; to++) {
					if (f0.text[from] === ' ' || f0.text[to - 1] === ' ') continue;
					if (f0.text.slice(from, to).includes('\n')) continue;
					const b = f0.blockAt[from];
					const span = {
						block: b,
						offset: f0.offsetAt[from],
						endBlock: b,
						endOffset: f0.offsetAt[to - 1] + 1
					};
					const q = quoteParts(f0, span)!;
					for (const target of blockings) {
						ran++;
						const f = flatten(target);
						const needle = q.before + q.quote + q.after;
						const at = flatIndex(f, span.block, span.offset);
						const here = at >= q.before.length && f.text.startsWith(needle, at - q.before.length);
						const hits: number[] = [];
						for (let i = 0; i + needle.length <= f.text.length; i++)
							if (f.text.startsWith(needle, i)) hits.push(i);
						const expected = here ? 'ok' : hits.length === 1 ? 'ok' : 'detached';
						const got = reanchor(f, { ...span, quote: q.quote, before: q.before, after: q.after });
						if (got.state !== expected) different++;
						if (expected === 'ok' && !here && got.state === 'ok') {
							const i = hits[0] + q.before.length;
							if (got.span.block !== f.blockAt[i] || got.span.offset !== f.offsetAt[i]) different++;
							if (!got.moved) different++;
						}
					}
				}
			}
		}
		expect(ran).toBeGreaterThan(1_000_000);
		expect(different).toBe(0);
		console.info(`reanchor differential: ${ran} pairs, ${different} differences`);
	}, 30_000);
});

describe('spans', () => {
	const at = (block: number, offset: number, endBlock: number, endOffset: number): TextSpan => ({
		block,
		offset,
		endBlock,
		endOffset
	});
	it('overlaps means a shared character: touching does not count', () => {
		expect(overlaps(at(0, 0, 0, 5), at(0, 5, 0, 9))).toBe(false);
		expect(overlaps(at(0, 0, 0, 6), at(0, 5, 0, 9))).toBe(true);
		expect(overlaps(at(0, 0, 2, 1), at(1, 0, 1, 2))).toBe(true);
		expect(overlaps(at(1, 0, 1, 2), at(0, 0, 2, 1))).toBe(true);
	});
	it('every order of two small spans agrees with a character-by-character model', () => {
		const spans: TextSpan[] = [];
		for (let s = 0; s < 8; s++)
			for (let e = s + 1; e <= 8; e++) spans.push(at(s >> 2, s & 3, e >> 2, e & 3));
		const cells = (a: TextSpan) => {
			const out = new Set<number>();
			for (let i = a.block * 4 + a.offset; i < a.endBlock * 4 + a.endOffset; i++) out.add(i);
			return out;
		};
		let ran = 0;
		for (const a of spans)
			for (const b of spans) {
				ran++;
				const ca = cells(a);
				const cb = cells(b);
				expect(overlaps(a, b)).toBe([...ca].some((c) => cb.has(c)));
				expect(contains(a, b)).toBe([...cb].every((c) => ca.has(c)));
			}
		expect(ran).toBe(spans.length ** 2);
	});
	it('a start and an end, whichever was dragged first', () => {
		expect(ordered({ block: 3, offset: 1 }, { block: 1, offset: 9 })).toEqual(at(1, 9, 3, 1));
		expect(ordered({ block: 1, offset: 2 }, { block: 1, offset: 5 })).toEqual(at(1, 2, 1, 5));
	});
});

describe('joinSpans: a selection overlapping a highlight joins it', () => {
	const k = (id: number, madeAt: number, s: TextSpan, state: 'ok' | 'detached' = 'ok') => ({
		id,
		madeAt,
		state,
		...s
	});
	const span = (a: number, b: number): TextSpan => ({
		block: 0,
		offset: a,
		endBlock: 0,
		endOffset: b
	});
	it('takes the highlights it touches, the oldest first', () => {
		const list = [k(1, 20, span(0, 5)), k(2, 10, span(8, 12)), k(3, 30, span(20, 25))];
		const r = joinSpans(span(4, 9), list);
		expect(r.span).toEqual(span(0, 12));
		expect(r.joined.map((j) => j.id)).toEqual([2, 1]);
	});
	it('joins through a chain: joining reaches what the selection alone did not', () => {
		const list = [k(1, 1, span(0, 5)), k(2, 2, span(4, 9)), k(3, 3, span(8, 12))];
		const r = joinSpans(span(0, 2), list);
		expect(r.span).toEqual(span(0, 12));
		expect(r.joined).toHaveLength(3);
	});
	it('nothing touched: the selection alone', () => {
		const r = joinSpans(span(6, 7), [k(1, 1, span(0, 5))]);
		expect(r).toEqual({ span: span(6, 7), joined: [] });
	});
	it('a DETACHED quote is on no words', () => {
		const r = joinSpans(span(0, 5), [k(1, 1, span(0, 5), 'detached')]);
		expect(r.joined).toEqual([]);
	});
});

describe('a book’s language as the platform takes it', () => {
	// What `firstText(xml, 'language')` hands over: whatever the book's maker typed.
	it.each([
		['en_US', 'en-US'],
		['pt_BR', 'pt-BR'],
		['EN-us', 'en-US'],
		[' ja ', 'ja'],
		['ja_JP', 'ja-JP'],
		['zh-Hant-TW', 'zh-Hant-TW']
	])('%s reads as %s', (raw, want) => {
		expect(bookLocale(raw)).toBe(want);
		// A normaliser holds on its own output.
		expect(bookLocale(bookLocale(raw))).toBe(want);
	});
	it.each(['', '   ', 'not a language', 'x', '!!', 'en_', '_'])('%j is no language', (raw) => {
		expect(bookLocale(raw)).toBeUndefined();
	});
	it('nothing and null are no language', () => {
		expect(bookLocale(undefined)).toBeUndefined();
		expect(bookLocale(null)).toBeUndefined();
	});
	it.each(['en_US', 'pt_BR', '', 'not a language', '!!', 'x'])(
		'a long press on a book tagged %j finds the word and does not throw',
		(tag) => {
			expect(wordAround('Nothing is only', 8, tag)).toEqual({ start: 8, end: 10 });
		}
	);
	it('Japanese with an underscore is still set vertically', () => {
		expect(isVerticalBook('ja_JP', false)).toBe(true);
		expect(isVerticalBook('ja', false)).toBe(true);
		expect(isVerticalBook('ja-JP', false)).toBe(true);
		expect(isVerticalBook('jav', false)).toBe(false);
		expect(isVerticalBook('en_US', false)).toBe(false);
	});
});

describe('mergeNotes: a reader’s words are never dropped', () => {
	const AB = 'a\n\nb';
	it('nothing asked is no change', () => {
		expect(mergeNotes('kept', '')).toBe('kept');
		expect(mergeNotes('kept', '   ')).toBe('kept');
		expect(mergeNotes('', '')).toBe('');
	});
	it('a row with none takes it', () => expect(mergeNotes('', 'new')).toBe('new'));
	it('a note the row already holds is no change, wherever it stands', () => {
		expect(mergeNotes('same', 'same')).toBe('same');
		expect(mergeNotes(AB, 'a')).toBe(AB);
		expect(mergeNotes(AB, 'b')).toBe(AB);
		expect(mergeNotes(`x\n\n${AB}\n\ny`, AB)).toBe(`x\n\n${AB}\n\ny`);
	});
	it('words that only look like part of it are not it', () => {
		expect(mergeNotes('this is a hint', 'hi')).toBe('this is a hint\n\nhi');
	});
	it('typing that went on replaces what it continues', () => {
		expect(mergeNotes('abc', 'abcd')).toBe('abcd');
	});
	it('two different notes: both, the row first', () => {
		expect(mergeNotes('row', 'mine')).toBe('row\n\nmine');
	});
	it('held to the limit', () => {
		const long = 'x'.repeat(NOTE_LIMIT);
		expect(mergeNotes(long, 'more')).toBe(long);
		expect(mergeNotes('', 'y'.repeat(NOTE_LIMIT + 9))).toHaveLength(NOTE_LIMIT);
		expect(mergeNotes('ab', 'c', 3)).toBe('ab\n');
	});
	it('every pair of a finite domain: nothing lost, and a resend changes nothing', () => {
		const notes = ['', ' ', 'a', 'ab', 'abc', 'b', AB, `b\n\na`, 'a b', ' a '];
		let pairs = 0;
		for (const row of notes)
			for (const asked of notes) {
				pairs++;
				const once = mergeNotes(row, asked);
				const label = JSON.stringify([row, asked]);
				// Idempotent: what the queue's resend relies on.
				expect(mergeNotes(once, asked), label).toBe(once);
				// The reader's words are in it, as written (trimmed).
				expect(once.includes(asked.trim()), label).toBe(true);
				// The row's are too, unless the reader's only continued them.
				if (!asked.trim().startsWith(row.trim()))
					expect(once.includes(row.trim()), label).toBe(true);
			}
		expect(pairs).toBe(100);
	});
});

describe('wordAround', () => {
	it('the word under the character', () => {
		expect(wordAround('Nothing is only', 3)).toEqual({ start: 0, end: 7 });
		expect(wordAround('Nothing is only', 8)).toEqual({ start: 8, end: 10 });
	});
	it('on a space or a mark, the next word; past the last, the last', () => {
		expect(wordAround('Nothing is', 7)).toEqual({ start: 8, end: 10 });
		expect(wordAround('“Nothing', 0)).toEqual({ start: 1, end: 8 });
		expect(wordAround('word.', 4)).toEqual({ start: 0, end: 4 });
	});
	it('no word in the block', () => {
		expect(wordAround('…', 0)).toBeNull();
		expect(wordAround('', 0)).toBeNull();
	});
	it('Japanese splits by the language', () => {
		const w = wordAround('港の灯りが', 2, 'ja')!;
		expect(w.start).toBeLessThanOrEqual(2);
		expect(w.end).toBeGreaterThan(2);
		expect(w.end - w.start).toBeLessThan(5);
	});
});

describe('the sheet and the page end', () => {
	it('says where it is', () => {
		expect(quoteSheetHead('Ch. 3', { block: 3 })).toBe('HIGHLIGHT · CH. 3 · ¶ 4');
		expect(quoteSheetLine(Date.UTC(2026, 10, 2, 12), Date.UTC(2026, 10, 9, 12))).toBe(
			'MADE 2 NOV · KEPT ON THE WORKSTATION'
		);
	});
	const view = { w: 390, h: 780 };
	it('the page ends in the bottom strip, and at the edge the next page lies past', () => {
		const horizontal = { rtl: false, vertical: false };
		expect(atPageEnd({ x: 100, y: 780 - HOLD_STRIP }, view, horizontal)).toBe(true);
		expect(atPageEnd({ x: 100, y: 780 - HOLD_STRIP - 1 }, view, horizontal)).toBe(false);
		expect(atPageEnd({ x: 380, y: 100 }, view, horizontal)).toBe(true);
		expect(atPageEnd({ x: 10, y: 100 }, view, horizontal)).toBe(false);
		expect(atPageEnd({ x: 10, y: 100 }, view, { rtl: true, vertical: false })).toBe(true);
		expect(atPageEnd({ x: 380, y: 100 }, view, { rtl: true, vertical: false })).toBe(false);
	});
	it('a vertical page ends bottom left: the last column, or the last of a column', () => {
		const v = { rtl: true, vertical: true };
		expect(atPageEnd({ x: 40, y: 100 }, view, v)).toBe(true);
		expect(atPageEnd({ x: 300, y: 770 }, view, v)).toBe(true);
		expect(atPageEnd({ x: 300, y: 300 }, view, v)).toBe(false);
	});
});

describe('barPlace', () => {
	const view = { w: 390, h: 780 };
	const barW = 320;
	it('above the first line, clearing the handle', () => {
		const p = barPlace({ left: 24, right: 90, top: 96, bottom: 126 }, view, barW, false);
		expect(p).toEqual({ left: 24, top: 96 - BAR_H - 14 });
	});
	it('below it at the top of the page', () => {
		const p = barPlace({ left: 24, right: 90, top: 30, bottom: 60 }, view, barW, false);
		expect(p.top).toBe(60 + 14);
	});
	it('never off the screen', () => {
		for (const left of [-50, 0, 16, 200, 390, 900])
			for (const top of [-20, 0, 60, 400, 760, 1000]) {
				const p = barPlace({ left, right: left + 30, top, bottom: top + 28 }, view, barW, false);
				expect(p.left).toBeGreaterThanOrEqual(16);
				expect(p.left + barW).toBeLessThanOrEqual(view.w - 16);
				expect(p.top).toBeGreaterThanOrEqual(16);
				expect(p.top + BAR_H).toBeLessThanOrEqual(view.h - 16);
			}
	});
	it('vertical: across the top, over the first column selected', () => {
		const p = barPlace({ left: 300, right: 330, top: 200, bottom: 400 }, view, barW, true);
		expect(p.top).toBe(24);
		expect(p.left).toBe(16);
	});
});

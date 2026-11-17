import { describe, expect, it } from 'vitest';
import {
	activeCount,
	filterParams,
	filterRows,
	filterWords,
	isOneOff,
	kindCells,
	kindsAmong,
	languagesAmong,
	legacyShelf,
	matches,
	NO_FILTERS,
	parseDay,
	parseFilters,
	withFilters,
	FILTER_KINDS,
	type Filters
} from '$lib/library/filters';

const q = (s: string) => new URLSearchParams(s);
const f = (patch: Partial<Filters>): Filters => ({ ...NO_FILTERS, ...patch });

describe('the filters in a URL', () => {
	it('reads each parameter, and nothing malformed', () => {
		expect(parseFilters(q('min=7&fav=0&lang=JA&added=2026-08-01&dl=1'), false)).toEqual(
			f({ min: 7, fav: 0, lang: 'ja', added: '2026-08-01', dl: 1 })
		);
		expect(parseFilters(q('min=11&fav=2&lang=japanese&added=2026-02-30&dl=yes'), false)).toEqual(
			NO_FILTERS
		);
	});

	it('reads READING as unread or read, nothing else', () => {
		expect(parseFilters(q('progress=unread'), false).progress).toBe('unread');
		expect(parseFilters(q('progress=read'), false).progress).toBe('read');
		// An old IN PROGRESS link: that is the PROGRESS sort, not a filter.
		expect(parseFilters(q('progress=reading'), false).progress).toBeNull();
		expect(activeCount(f({ progress: 'read' }))).toBe(1);
		expect(filterWords(f({ progress: 'read' }))).toEqual(['READ']);
	});

	it('tells unread, begun and read apart on the device: one page opened is begun', () => {
		const card = { rating: 0, favourite: false, hidden: true, addedAt: 0 };
		const fresh = { ...card, entryCount: 3, readCount: 0, opened: false };
		const begun = { ...card, entryCount: 3, readCount: 0, opened: true };
		const done = { ...card, entryCount: 3, readCount: 3, opened: true };
		expect(matches(fresh, f({ progress: 'unread' }))).toBe(true);
		expect(matches(begun, f({ progress: 'unread' }))).toBe(false);
		expect(matches(begun, f({ progress: 'read' }))).toBe(false);
		expect(matches(done, f({ progress: 'read' }))).toBe(true);
		expect(matches(done, f({ progress: 'unread' }))).toBe(false);
		// A card that doesn't know its progress isn't asked.
		expect(matches(card, f({ progress: 'unread' }))).toBe(true);
	});

	it('drops HIDDEN without reveal, so no query asks for what the viewer can’t see', () => {
		expect(parseFilters(q('hidden=1'), false).hidden).toBe(false);
		expect(parseFilters(q('hidden=1'), true).hidden).toBe(true);
	});

	it('lets UNRATED win over a threshold: both can’t hold', () => {
		expect(parseFilters(q('rated=0&min=8'), false)).toEqual(f({ unrated: true }));
	});

	it('refuses a day that doesn’t exist', () => {
		expect(parseDay('2026-02-29')).toBeNull();
		expect(parseDay('2028-02-29')).toBe('2028-02-29');
		expect(parseDay('26-8-1')).toBeNull();
	});
});

describe('links', () => {
	it('keep the shelf, the sort and the seed, and replace only the filters', () => {
		const next = withFilters(q('shelf=k:manhwa&sort=random&seed=4&fav=1&min=8'), f({ fav: 0 }));
		expect(next.toString()).toBe('shelf=k%3Amanhwa&sort=random&seed=4&fav=0');
	});

	it('are one URL for one set of filters, whatever order they were chosen in', () => {
		const a = withFilters(q('shelf=all'), f({ dl: 1, min: 6 }));
		const b = withFilters(q('shelf=all&dl=1'), f({ min: 6, dl: 1 }));
		expect(a.toString()).toBe(b.toString());
	});

	it('clear to the shelf alone', () => {
		expect(withFilters(q('shelf=all&rated=0&lang=ja&hidden=1'), NO_FILTERS).toString()).toBe(
			'shelf=all'
		);
	});
});

describe('words', () => {
	it('name the filters for the label and the empty result', () => {
		const all = f({ min: 7, fav: 0, lang: 'ja', added: '2026-08-01', dl: 1 });
		expect(filterWords(all)).toEqual(['RATED 3.5+', 'NOT FAV', 'JA', 'SINCE 1 AUG', 'DOWNLOADED']);
		expect(activeCount(all)).toBe(5);
		expect(activeCount(f({ unrated: true, hidden: true }))).toBe(2);
	});
});

describe('the retired shelves that became filters', () => {
	it('become the filters that replace them', () => {
		expect(legacyShelf('favourites', q('shelf=favourites&sort=title'))?.toString()).toBe(
			'shelf=all&sort=title&fav=1'
		);
		expect(legacyShelf('rated4', q('shelf=rated4&min=7'))?.toString()).toBe('shelf=all&min=7');
		expect(legacyShelf('rated4', q('shelf=rated4'))?.toString()).toBe('shelf=all&min=8');
		expect(legacyShelf('downloaded', q('shelf=downloaded'))?.toString()).toBe('shelf=all&dl=1');
	});

	it('keep a filter the old link already carried (the rated4 one alone replaces min)', () => {
		expect(legacyShelf('favourites', q('shelf=favourites&min=6'))?.toString()).toBe(
			'shelf=all&min=6&fav=1'
		);
	});
});

describe('the retired shelves: SERIES, ONE-OFF and each kind', () => {
	it('SERIES and ONE-OFF become FORM, keeping the rest of the link', () => {
		expect(legacyShelf('series', q('shelf=series&sort=title'))?.toString()).toBe(
			'shelf=all&sort=title&form=series'
		);
		expect(legacyShelf('oneoff', q('shelf=oneoff&fav=1'))?.toString()).toBe(
			'shelf=all&fav=1&form=oneoff'
		);
	});

	it('every kind of the registry’s shelf becomes its ?kind=, and nothing else does', () => {
		for (const kind of FILTER_KINDS)
			expect(legacyShelf(`k:${kind}`, q(`shelf=k:${kind}&sort=title`))?.toString()).toBe(
				`shelf=all&sort=title&kind=${kind}`
			);
		// The shelf's kind wins over a kind the link also named.
		expect(legacyShelf('k:manga', q('shelf=k:manga&kind=novel'))?.get('kind')).toBe('manga');
		for (const shelf of ['k:', 'k:comic', 'k:MANGA', 'all', 'new', 'c:3', 'r:1', 'people'])
			expect(legacyShelf(shelf, q(`shelf=${shelf}`))).toBeNull();
	});

	it('lands somewhere legacyShelf leaves alone: one redirect, never a loop', () => {
		for (const shelf of ['series', 'oneoff', 'favourites', ...FILTER_KINDS.map((k) => `k:${k}`)]) {
			const once = legacyShelf(shelf, q(`shelf=${shelf}`))!;
			expect(legacyShelf(once.get('shelf')!, once)).toBeNull();
		}
	});
});

describe('FORM (SERIES and ONE-OFF, as a filter)', () => {
	it('is a filter in the URL, in words and in the count, and nothing else is a form', () => {
		expect(parseFilters(q('form=series'), false).form).toBe('series');
		expect(parseFilters(q('form=oneoff'), false).form).toBe('oneoff');
		for (const raw of ['one-off', 'SERIES', 'book', ''])
			expect(parseFilters(q(`form=${raw}`), false).form).toBeNull();
		expect(filterParams(f({ form: 'oneoff' }))).toEqual([['form', 'oneoff']]);
		expect(filterWords(f({ form: 'series' }))).toEqual(['SERIES']);
		expect(filterWords(f({ form: 'oneoff' }))).toEqual(['ONE-OFF']);
		expect(activeCount(f({ form: 'series' }))).toBe(1);
		// Read back from what it writes, unchanged.
		for (const form of ['series', 'oneoff'] as const)
			expect(parseFilters(withFilters(q(''), f({ form })), false)).toEqual(f({ form }));
	});

	it('tells a single book from a series on the device, as ONE_OFF_SQL does', () => {
		// Every kind of the registry: only the one GROUP binds into books is ever a one-off.
		for (const kind of FILTER_KINDS)
			for (const entryCount of [0, 1, 2])
				expect(isOneOff({ kind, entryCount })).toBe(kind === 'doujin' && entryCount <= 1);
		expect(isOneOff({ kind: 'doujin' })).toBeUndefined();
		expect(isOneOff({ entryCount: 1 })).toBeUndefined();
		const book = {
			rating: 0,
			favourite: false,
			hidden: false,
			addedAt: 0,
			kind: 'doujin',
			entryCount: 1
		};
		expect(matches(book, f({ form: 'oneoff' }))).toBe(true);
		expect(matches(book, f({ form: 'series' }))).toBe(false);
		expect(matches({ ...book, entryCount: 3 }, f({ form: 'series' }))).toBe(true);
		// A card that can't say isn't asked.
		expect(matches({ ...book, entryCount: undefined }, f({ form: 'series' }))).toBe(true);
	});

	it('is a row on the library’s panel, and KIND is not; a person’s page has KIND and no FORM', () => {
		const kinds = ['manga', 'doujin'] as const;
		const library = filterRows(NO_FILTERS, [], false, false, true, kinds, {
			kind: false,
			form: true
		});
		expect(library.map((r) => r.key)).toContain('form');
		expect(library.map((r) => r.key)).not.toContain('kind');
		// Even with a kind chosen: the band shows it, the panel does not.
		expect(
			filterRows(f({ kind: 'manga' }), [], false, false, true, kinds, {
				kind: false,
				form: true
			}).map((r) => r.key)
		).not.toContain('kind');
		const person = filterRows(NO_FILTERS, [], false, false, true, kinds);
		expect(person.map((r) => r.key)).toContain('kind');
		expect(person.map((r) => r.key)).not.toContain('form');
		const form = library.find((r) => r.key === 'form')!;
		expect(form.choices.map((c) => [c.label, c.on])).toEqual([
			['ANY', true],
			['SERIES', false],
			['ONE-OFF', false]
		]);
		expect(form.choices.map((c) => c.to.form)).toEqual([null, 'series', 'oneoff']);
	});
});

describe('the KIND band', () => {
	it('the library’s FILTER badge leaves the kind out: the band says it', () => {
		const both = f({ kind: 'anime', min: 8 });
		expect(activeCount(both)).toBe(2);
		expect(activeCount(both, false)).toBe(1);
		expect(activeCount(f({ kind: 'anime' }), false)).toBe(0);
	});

	it('ALL first, then the kinds on the shelf in the registry’s order, with their counts', () => {
		const cells = kindCells({ anime: 23, manga: 22, manhwa: 19 }, 64, null);
		expect(cells.map((c) => [c.kind, c.n, c.on, c.zero])).toEqual([
			[null, 64, true, false],
			...FILTER_KINDS.filter((k) => ['manga', 'manhwa', 'anime'].includes(k)).map((k) => [
				k,
				{ manga: 22, manhwa: 19, anime: 23 }[k as 'manga'],
				false,
				false
			])
		]);
	});

	it('a kind with none here is gone; the chosen one stays at 0, dimmed and chosen', () => {
		const counts = { manga: 18, manhwa: 13 };
		const gone = kindCells(counts, 31, null).map((c) => c.kind);
		expect(gone).toEqual([null, 'manga', 'manhwa']);
		const kept = kindCells(counts, 31, 'anime');
		expect(kept.find((c) => c.kind === 'anime')).toEqual({
			kind: 'anime',
			n: 0,
			on: true,
			zero: true
		});
		expect(kept[0]).toMatchObject({ kind: null, on: false });
	});

	it('with one kind or none to tell apart, ALL alone, unless one is chosen', () => {
		expect(kindCells({ manhwa: 22 }, 22, null).map((c) => c.kind)).toEqual([null]);
		expect(kindCells({}, 0, null).map((c) => c.kind)).toEqual([null]);
		expect(kindCells({ manhwa: 22 }, 22, 'manhwa').map((c) => [c.kind, c.on])).toEqual([
			[null, false],
			['manhwa', true]
		]);
	});

	it('over every kind chosen or none: exactly one cell is on, and only the chosen can be 0', () => {
		const counts = { manga: 3, novel: 2 };
		for (const chosen of [null, ...FILTER_KINDS]) {
			const cells = kindCells(counts, 5, chosen);
			expect(cells.filter((c) => c.on).map((c) => c.kind)).toEqual([chosen]);
			expect(cells.filter((c) => c.zero).every((c) => c.kind === chosen)).toBe(true);
		}
	});
});

describe('on the device', () => {
	const item = {
		rating: 7,
		favourite: false,
		hidden: true,
		addedAt: new Date(2026, 7, 15).getTime(),
		downloaded: true,
		languages: ['EN', 'JA']
	};

	it('matches each filter as the workstation would', () => {
		expect(matches(item, f({ min: 7, fav: 0, lang: 'ja', added: '2026-08-15', dl: 1 }))).toBe(true);
		expect(matches(item, f({ min: 8 }))).toBe(false);
		expect(matches(item, f({ unrated: true }))).toBe(false);
		expect(matches(item, f({ lang: 'zh' }))).toBe(false);
		expect(matches(item, f({ added: '2026-08-16' }))).toBe(false);
		expect(matches(item, f({ dl: 0 }))).toBe(false);
		expect(matches({ ...item, hidden: false }, f({ hidden: true }))).toBe(false);
	});

	it('offers the languages present, once each', () => {
		expect(
			languagesAmong([item, { ...item, languages: ['en'] }, { ...item, languages: [] }])
		).toEqual(['en', 'ja']);
	});
});

describe('the panel', () => {
	it('draws LANGUAGE only with languages, and HIDDEN only while reveal is on', () => {
		const keys = (langs: string[], reveal: boolean) =>
			filterRows(NO_FILTERS, langs, reveal).map((r) => r.key);
		expect(keys([], false)).toEqual(['rating', 'fav', 'added', 'dl', 'progress']);
		expect(keys(['ja'], true)).toEqual([
			'rating',
			'fav',
			'lang',
			'added',
			'dl',
			'progress',
			'hidden'
		]);
		// A person's page has its own UNREAD tab, so no READING row.
		expect(filterRows(NO_FILTERS, [], false, false, false).map((r) => r.key)).not.toContain(
			'progress'
		);
	});

	it('AT LEAST starts at 4+, and UNRATED and a threshold replace each other', () => {
		const rating = filterRows(NO_FILTERS, [], false)[0].choices;
		expect(rating.map((c) => [c.label, c.on])).toEqual([
			['ANY', true],
			['UNRATED', false],
			['AT LEAST', false]
		]);
		expect(rating[2].to.min).toBe(8);
		const fromUnrated = filterRows(f({ unrated: true }), [], false)[0].choices[2].to;
		expect(fromUnrated).toMatchObject({ min: 8, unrated: false });
	});
});

describe('FOLLOWED (doc/DOWNLOADS.md)', () => {
	it('is a filter in the URL, in words, and on the device', () => {
		const f = parseFilters(new URLSearchParams('followed=1'), false);
		expect(f.followed).toBe(true);
		expect(activeCount(f)).toBe(1);
		expect(filterParams(f)).toEqual([['followed', '1']]);
		expect(filterWords(f)).toEqual(['FOLLOWED']);
		const card = { rating: 0, favourite: false, hidden: false, addedAt: 0 };
		expect(matches({ ...card, followed: true }, f)).toBe(true);
		expect(matches(card, f)).toBe(false);
	});

	it('is offered only while something is followed, or while it is on', () => {
		expect(filterRows(NO_FILTERS, [], false).map((r) => r.key)).not.toContain('followed');
		expect(filterRows(NO_FILTERS, [], false, true).map((r) => r.key)).toContain('followed');
		expect(filterRows({ ...NO_FILTERS, followed: true }, [], false).map((r) => r.key)).toContain(
			'followed'
		);
	});
});

describe('KIND (one kind inside any shelf: TO READ’s manga)', () => {
	it('is a filter in the URL, in words, and on the device, and nothing else is a kind', () => {
		const k = parseFilters(q('kind=manhwa'), false);
		expect(k.kind).toBe('manhwa');
		expect(activeCount(k)).toBe(1);
		expect(filterParams(k)).toEqual([['kind', 'manhwa']]);
		expect(filterWords(k)).toEqual(['MANHWA']);
		expect(parseFilters(q('kind=comic'), false).kind).toBeNull();
		const card = { rating: 0, favourite: false, hidden: false, addedAt: 0 };
		expect(matches({ ...card, kind: 'manhwa' }, k)).toBe(true);
		expect(matches({ ...card, kind: 'manga' }, k)).toBe(false);
		// A card that doesn't say its kind isn't asked.
		expect(matches(card, k)).toBe(true);
	});

	it('offers the kinds present, in its own order, and only where two can be told apart', () => {
		const card = { rating: 0, favourite: false, hidden: false, addedAt: 0 };
		expect(kindsAmong([{ ...card, kind: 'novel' }, { ...card, kind: 'manga' }, card])).toEqual([
			'manga',
			'novel'
		]);
		const keys = (fs: Filters, kinds: Parameters<typeof filterRows>[5]) =>
			filterRows(fs, [], false, false, true, kinds).map((r) => r.key);
		expect(keys(NO_FILTERS, ['manga'])).not.toContain('kind');
		expect(keys(NO_FILTERS, ['manga', 'novel'])).toContain('kind');
		expect(keys(f({ kind: 'anime' }), [])).toContain('kind');
		const row = filterRows(NO_FILTERS, [], false, false, true, ['manga', 'doujin']).find(
			(r) => r.key === 'kind'
		)!;
		expect(row.choices.map((c) => c.label)).toEqual(['ANY', 'MANGA', 'DOUJINS']);
	});
});

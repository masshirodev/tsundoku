import { describe, expect, it } from 'vitest';
import {
	activeCount,
	filterParams,
	filterRows,
	filterWords,
	languagesAmong,
	legacyShelf,
	matches,
	NO_FILTERS,
	parseDay,
	parseFilters,
	withFilters,
	type Filters
} from '$lib/library/filters';

const q = (s: string) => new URLSearchParams(s);
const f = (patch: Partial<Filters>): Filters => ({ ...NO_FILTERS, ...patch });

describe('the filters in a URL (c68)', () => {
	it('reads each parameter, and nothing malformed', () => {
		expect(parseFilters(q('min=7&fav=0&lang=JA&added=2026-08-01&dl=1'), false)).toEqual(
			f({ min: 7, fav: 0, lang: 'ja', added: '2026-08-01', dl: 1 })
		);
		expect(parseFilters(q('min=11&fav=2&lang=japanese&added=2026-02-30&dl=yes'), false)).toEqual(
			NO_FILTERS
		);
	});

	it('reads READING as unread or in progress, nothing else', () => {
		expect(parseFilters(q('progress=unread'), false).progress).toBe('unread');
		expect(parseFilters(q('progress=reading'), false).progress).toBe('reading');
		expect(parseFilters(q('progress=done'), false).progress).toBeNull();
		expect(activeCount(f({ progress: 'reading' }))).toBe(1);
		expect(filterWords(f({ progress: 'reading' }))).toEqual(['IN PROGRESS']);
	});

	it('tells unread, in progress and finished apart on the device', () => {
		const card = { rating: 0, favourite: false, hidden: true, addedAt: 0 };
		const fresh = { ...card, entryCount: 3, readCount: 0, opened: false };
		const begun = { ...card, entryCount: 3, readCount: 0, opened: true };
		const done = { ...card, entryCount: 3, readCount: 3, opened: true };
		expect(matches(fresh, f({ progress: 'unread' }))).toBe(true);
		expect(matches(begun, f({ progress: 'unread' }))).toBe(false);
		expect(matches(begun, f({ progress: 'reading' }))).toBe(true);
		expect(matches(done, f({ progress: 'reading' }))).toBe(false);
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

describe('the shelves turn 3 retired', () => {
	it('become the filters that replace them', () => {
		expect(legacyShelf('favourites', q('shelf=favourites&sort=title'))?.toString()).toBe(
			'shelf=all&sort=title&fav=1'
		);
		expect(legacyShelf('rated4', q('shelf=rated4&min=7'))?.toString()).toBe('shelf=all&min=7');
		expect(legacyShelf('rated4', q('shelf=rated4'))?.toString()).toBe('shelf=all&min=8');
		expect(legacyShelf('downloaded', q('shelf=downloaded'))?.toString()).toBe('shelf=all&dl=1');
		expect(legacyShelf('k:manga', q('shelf=k:manga'))).toBeNull();
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

describe('FOLLOWED (doc/DOWNLOADING.md)', () => {
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

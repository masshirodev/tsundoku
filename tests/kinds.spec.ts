import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
	anilistType,
	KIND_FACTS,
	kindFacts,
	KEY_PREFIX,
	KINDS,
	anilistTypeOf,
	kindLayout,
	kindsGrouped,
	isMovable,
	MOVE_MAP,
	MOVABLE_KINDS,
	moveKindOf,
	SOURCE_FAMILIES,
	SOURCE_KINDS,
	SOURCE_KIND_CHOICES,
	sourceFamilyOf,
	type Kind,
	type KindFacts,
	type Medium,
	type MovableKind,
	type SourceFamily
} from '$lib/library/kinds';
import { FILTER_KINDS } from '$lib/library/filters';
import { sheetMeta, unitLabel } from '$lib/library/labels';
import {
	anilistUrl,
	candidateKind,
	coverOnly,
	malUrl,
	parsePasted,
	sameKind,
	wrongKind
} from '$lib/library/catalogue';
import { movesVideo, type MoveKind } from '$lib/library/move';
import type { SeriesCard } from '$lib/library/types';
import {
	animeKeyOf,
	keyFamily,
	keyKind,
	keyOf,
	novelKeyOf,
	parseAnimeKey,
	parseKey,
	parseNovelKey
} from '$lib/library/downloads';
import { readTvshowNfo, tvshowNfo } from '$lib/library/anime-files';
import { isGallerySource, kindOf, planMihon } from '$lib/import/mihon-plan';
import type { MihonManga } from '$lib/import/mihon-backup';
import { planNovel } from '$lib/import/novel-plan';
import { planAnime } from '$lib/import/anime-plan';
import { planEpub } from '$lib/import/epub-plan';
import { planHentoidBook } from '$lib/import/hentoid-plan';
import { defaultDirection } from '$lib/library/series';
import { familyOfKind } from '$lib/server/engine/repo-index';
import { groupAnswers } from '$lib/library/books';

/**
 * The kind registry's own invariants, and the behaviour its first users read
 * (doc/KINDS.md; card c301). Every assertion here is about what ships: this
 * slice changes no behaviour, so the strings and answers below are the ones
 * the code gave before it read the registry.
 */

const card = (kind: SeriesCard['kind'], over: Partial<SeriesCard> = {}): SeriesCard => ({
	id: 1,
	title: 'A Series',
	kind,
	rating: 0,
	favourite: false,
	hidden: false,
	newCount: 3,
	entryCount: 58,
	readCount: 41,
	hue: 0,
	cover: null,
	indexed: true,
	addedAt: 0,
	...over
});

describe('the registry', () => {
	it('has exactly five entries, and each literal kind reaches its own facts', () => {
		// A hand-written list, not `KINDS` or `Object.keys(KIND_FACTS)`: those
		// *are* the registry's own keys, so comparing them proves nothing. This
		// goes red if a key is renamed or an entry dropped (round 2, c301).
		const literals: Kind[] = ['manga', 'manhwa', 'doujin', 'novel', 'anime', 'movie', 'show'];
		expect(Object.keys(KIND_FACTS)).toHaveLength(literals.length);
		for (const kind of literals) expect(KIND_FACTS[kind].kind).toBe(kind);
		expect(KINDS).toEqual(literals);
	});

	it('gives every kind a medium and a catalogue, and a unit unless it has one entry', () => {
		const media: Medium[] = ['pages', 'text', 'video'];
		for (const kind of KINDS) {
			const facts: KindFacts = kindFacts(kind);
			expect(media).toContain(facts.medium);
			// A film is one entry: no unit, and `kindUnit` answers none (c987).
			if (kind === 'movie') expect(facts.unit).toBeUndefined();
			else {
				expect(facts.unit!.short).not.toBe('');
				expect(facts.unit!.long).not.toBe('');
				expect(['READ', 'WATCHED']).toContain(facts.unit!.done);
			}
			expect(['anilist', 'tmdb']).toContain(facts.catalogue.provider);
			if (facts.layout) expect(['paged', 'vertical', 'rtl', 'ltr']).toContain(facts.layout);
		}
		// Text and video are the two that are not pages: the readers and the player.
		expect(KINDS.filter((k) => kindFacts(k).medium === 'text')).toEqual(['novel']);
		expect(KINDS.filter((k) => kindFacts(k).medium === 'video')).toEqual([
			'anime',
			'movie',
			'show'
		]);
	});

	it('lets a kind match itself, and only kinds the registry names', () => {
		for (const kind of KINDS) {
			const { matches } = kindFacts(kind);
			expect(matches).toContain(kind);
			for (const m of matches) expect(KINDS).toContain(m);
		}
	});

	it('states the layout the reader starts from, as defaultDirection decides it', () => {
		// `defaultDirection` (library/series.ts:89-93) still decides; the fact
		// copies it until K2 makes series.ts read the registry. This goes red if
		// either one changes without the other.
		for (const kind of KINDS)
			if (kindFacts(kind).medium !== 'video') expect(kindLayout(kind)).toBe(defaultDirection(kind));
	});

	it('keeps KINDS readonly, because FILTER_KINDS shares the object', () => {
		// Type-level proof, not a runtime one: `FILTER_KINDS` is the same array,
		// so one in-place `sort()` in a screen would reorder the panel and the
		// registry together. If `KINDS` widened back to `Kind[]`, the assignment
		// below would compile and this directive would be an unused-error, which
		// `yarn run check` fails on (round 2, c301).
		// @ts-expect-error KINDS is readonly.
		const mutable: Kind[] = KINDS;
		expect(mutable).toBe(KINDS);
	});

	it('derives the FILTER panel\u2019s list from the one list, in the same order', () => {
		// The order is load-bearing: the panel lists chips in it (kindsAmong) and
		// the library counts by it (`kindCounts`, src/lib/server/library.ts). The
		// literal list is what can go red; `FILTER_KINDS` being `KINDS` is a
		// tautology.
		expect(FILTER_KINDS).toEqual(['manga', 'manhwa', 'doujin', 'novel', 'anime', 'movie', 'show']);
	});
});

describe('MOVABLE', () => {
	it('is the kinds MOVE is offered for, which is five, not the map kind', () => {
		const movable: MovableKind[] = ['manga', 'manhwa', 'anime', 'movie', 'show'];
		expect(MOVABLE_KINDS).toEqual(movable);
		expect(KINDS.filter((k) => KIND_FACTS[k].movable)).toEqual(movable);
		// Not movable, although both can carry a family's key (a gallery's
		// `mihon:`, LNReader's `lnreader:`): `movableKind` leaves them out
		// (src/lib/server/move.ts:56-57).
		expect(KIND_FACTS.doujin.movable).toBe(false);
		expect(KIND_FACTS.novel.movable).toBe(false);
	});

	it('has a map for each movable kind, and MOVE knows only its two', () => {
		expect(Object.keys(MOVE_MAP).sort()).toEqual([...MOVABLE_KINDS].sort());
		// MOVE's own kind is the map's shape, not the movable list: a manhwa is
		// movable and maps as a manga (src/lib/server/move.ts:268).
		expect(MOVE_MAP.manhwa).toBe('manga');
		expect(new Set(Object.values(MOVE_MAP))).toEqual(new Set(['manga', 'anime']));
		// Type-level: Record<MoveKind, true> needs exactly the map's own kinds,
		// so a widened MoveKind would fail to compile here.
		const mapKinds: Record<MoveKind, true> = { manga: true, anime: true };
		expect(Object.keys(mapKinds)).toEqual(['manga', 'anime']);
	});
});

/**
 * K4 (card c304): MOVE asks the registry. Each replacement is asserted for
 * every member of `KINDS` against the answer the code gave at `fb2bd3a7`,
 * written out here as the old expressions, not derived from the registry,
 * so a wrong fact goes red rather than agreeing with itself.
 */
describe('MOVE asks the registry', () => {
	// `movableKind` at fb2bd3a7 (src/lib/server/move.ts:56-57).
	const oldMovable = (k: Kind) =>
		k === 'manga' || k === 'manhwa' || k === 'anime' || k === 'movie' || k === 'show';
	// The map kind at fb2bd3a7 (src/lib/server/move.ts:268, :556, :720, :923, :1079).
	const oldMoveKind = (k: Kind): MoveKind => {
		// c987: the two video kinds move as an anime does (they did not exist at fb2bd3a7).
		if (k === 'movie' || k === 'show') return 'anime';
		return k === 'anime' ? 'anime' : 'manga';
	};

	it('offers MOVE to exactly the kinds it offered it to', () => {
		for (const k of KINDS) expect(isMovable(k), k).toBe(oldMovable(k));
		// Every kind is asked: the registry's five, none skipped.
		expect(KINDS).toHaveLength(7);
	});

	it('reads the map kind from the medium, as every kind read it', () => {
		for (const k of KINDS) expect(moveKindOf(k), k).toBe(oldMoveKind(k));
		// On the movable kinds it is MOVE_MAP, the registry's own rule.
		for (const k of MOVABLE_KINDS) expect(moveKindOf(k), k).toBe(MOVE_MAP[k]);
	});

	it('says video only for the anime map, which is what every branch asked', () => {
		const kinds: MoveKind[] = ['manga', 'anime'];
		// Each `kind === 'anime'` in both move modules is now this question.
		for (const k of kinds) expect(movesVideo(k), k).toBe(k === 'anime');
		// The words the move says come from the map kind's unit.
		expect(kindFacts('anime').unit.long).toBe('EPISODE');
		expect(kindFacts('manga').unit.long).toBe('CHAPTER');
	});
});

/**
 * The family a key belongs to, by the parsers that route it to a worker
 * (`keyKind`, library/downloads.ts): the code that decides, not the registry.
 * Null for a key no family parses (`hentoid:`, `hentoid-dir:`, `mihon-dir:`,
 * `epub:`).
 */
const familyOf = (key: string): SourceFamily | null =>
	parseKey(key) ? 'mihon' : parseNovelKey(key) ? 'lnreader' : parseAnimeKey(key) ? 'aniyomi' : null;

/** A Mihon source's series, the way the backup and browse's ADD both hand it to `planMihon`. */
const mihonManga = (source: string, url: string, over: Partial<MihonManga> = {}): MihonManga => ({
	source,
	url,
	title: url,
	artist: '',
	author: '',
	description: '',
	genres: [],
	status: 2,
	thumbnailUrl: '',
	dateAdded: 1,
	viewer: 0,
	chapters: [],
	categories: [],
	favorite: true,
	history: [],
	trackers: [],
	...over
});

describe('the source families', () => {
	it('name a kind each, and that kind is fed by that family', () => {
		expect(SOURCE_KINDS).toEqual({ mihon: 'manga', lnreader: 'novel', aniyomi: 'anime' });
		for (const [family, kind] of Object.entries(SOURCE_KINDS)) {
			expect(KIND_FACTS[kind].sources).toContain(family);
		}
	});

	it('decode a stored kind back to its family, for every kind and no other word', () => {
		// card c420: `familyOfKind` replaces each `kind === SOURCE_KINDS.x`; c508
		// moved it into the registry as `sourceFamilyOf`, and repo-index.ts's
		// `familyOfKind` is the same function, re-exported.
		// The oracle is written out, not derived from SOURCE_KINDS.
		const expected: Record<Kind, SourceFamily | null> = {
			manga: 'mihon',
			manhwa: null,
			doujin: null,
			novel: 'lnreader',
			anime: 'aniyomi',
			movie: null,
			show: null
		};
		expect(familyOfKind).toBe(sourceFamilyOf);
		for (const kind of KINDS) expect(sourceFamilyOf(kind), kind).toBe(expected[kind]);
		for (const word of ['', 'MANGA', 'novels', 'mihon', 'none'])
			expect(sourceFamilyOf(word), word).toBeNull();
		// The decoder holds on its own output: a family's kind gives that family back.
		for (const family of SOURCE_FAMILIES)
			expect(sourceFamilyOf(SOURCE_KINDS[family]), family).toBe(family);
	});

	it('include Mihon for a doujin, because a gallery source keeps its mihon: key', () => {
		// Round 2's medium (c301): `sources: []` was copied from a comment
		// ("a doujin is Hentoid's"). The importer disproves it: a gallery
		// source's series is a doujin and its key is `mihon:<source>:<url>`
		// (src/lib/import/mihon-plan.ts:106,128,388; doc/IMPORT-MIHON.md).
		expect(isGallerySource('NHentai')).toBe(true);
		const kind = kindOf([], 0, 'NHentai');
		expect(kind).toBe('doujin');
		const NH = '7309872737163460316';
		const plan = planMihon(
			{
				categories: [],
				sources: new Map([[NH, 'NHentai']]),
				manga: [mihonManga(NH, '/g/1/', { genres: ['Manga'] })]
			},
			[],
			1
		).series[0];
		expect(plan.kind).toBe('doujin');
		expect(familyOf(plan.originKey)).toBe('mihon');
		expect(KIND_FACTS[kind].sources).toContain(familyOf(plan.originKey));
	});

	it('hold the family of every key an importer writes for a kind', () => {
		// Each importer's plan is what `writeSeries` stores as kind and
		// origin_key (browse's ADD plans through the same functions). A key no
		// family parses is the gap the registry records, not a family.
		const ASURA = '6247824327199706550';
		const NH = '7309872737163460316';
		const mihon = planMihon(
			{
				categories: [],
				sources: new Map([
					[ASURA, 'Asura Scans'],
					[NH, 'NHentai']
				]),
				manga: [
					mihonManga(ASURA, '/manga/a', { genres: ['Manga'] }),
					mihonManga(ASURA, '/manga/b', { genres: ['Manhwa'] }),
					mihonManga(NH, '/g/2/')
				]
			},
			[],
			1
		).series;
		const planned = [
			...mihon,
			planNovel(
				{ name: 'A Novel', path: '/novel/a', chapters: [] },
				{ plugin: 'rr', name: 'RR' },
				1
			),
			planAnime(
				{
					sourceId: '7000',
					sourceName: 'KickAssAnime',
					url: '/a-show',
					title: 'A Show',
					status: 2
				},
				[{ url: '/ep-1', name: 'Episode 1', episode_number: 1 }],
				1
			)
		];
		expect(planned.map((p) => [p.kind, familyOf(p.originKey)])).toEqual([
			['manga', 'mihon'],
			['manhwa', 'mihon'],
			['doujin', 'mihon'],
			['novel', 'lnreader'],
			['anime', 'aniyomi']
		]);
		for (const p of planned) expect(KIND_FACTS[p.kind].sources).toContain(familyOf(p.originKey));

		// The keys that are no family yet: Hentoid's folder and an EPUB.
		const hentoid = planHentoidBook(
			{ folder: 'nhentai/A Book', files: ['1.jpg'], bytes: 0, content: null },
			'/hentoid',
			1
		);
		expect([hentoid.kind, hentoid.originKey]).toEqual(['doujin', 'hentoid-dir:nhentai/A Book']);
		expect(familyOf(hentoid.originKey)).toBeNull();
		const epub = planEpub({
			relPath: 'a/b.epub',
			dir: 'a',
			file: 'b.epub',
			addedAt: 1,
			pkg: null,
			toc: [],
			sizes: new Map()
		});
		expect([epub.kind, familyOf(epub.originKey)]).toEqual(['novel', null]);
	});
});

/**
 * K3 (card c303): a key's family is `keyFamily`, built on `KEY_PREFIX`. The
 * old answers are written out here as the regular expressions
 * library/downloads.ts had at fb2bd3a7, not derived from the new code, and
 * every key prefix a writer stores is asked, plus the edges.
 */
describe('a key\u2019s family', () => {
	const OLD_MIHON = /^mihon:(\d+):(.+)$/;
	const OLD_NOVEL = /^lnreader:([A-Za-z0-9._-]+):(.+)$/;
	const OLD_ANIME = /^aniyomi:(\d+):(.+)$/;
	// `keyKind` at fb2bd3a7 (library/downloads.ts:78-83).
	const oldKeyKind = (key: string | null): 'manga' | 'novel' | 'anime' | null =>
		key && OLD_MIHON.test(key)
			? 'manga'
			: key && OLD_NOVEL.test(key)
				? 'novel'
				: key && OLD_ANIME.test(key)
					? 'anime'
					: null;

	const ASURA = '6247824327199706550';
	const NH = '7309872737163460316';
	const mihonKeys = planMihon(
		{
			categories: [],
			sources: new Map([
				[ASURA, 'Asura Scans'],
				[NH, 'NHentai']
			]),
			manga: [mihonManga(ASURA, '/manga/k3'), mihonManga(NH, '/g/k3/')]
		},
		[],
		1
	).series.map((p) => p.originKey);
	const nfoKey = readTvshowNfo(
		tvshowNfo({
			title: 'A Show',
			key: animeKeyOf('7000', '/a-show'),
			plot: '',
			status: '',
			genres: [],
			source: 'KAA'
		})
	)?.key;
	/** Every prefix a writer stores (the audit table in doc/handoff-notes/kinds.md), and the edges. */
	const KEYS: (string | null)[] = [
		...mihonKeys,
		planNovel({ name: 'N', path: '/novel/k3', chapters: [] }, { plugin: 'rr', name: 'RR' }, 1)
			.originKey,
		planAnime(
			{ sourceId: '7000', sourceName: 'KAA', url: '/k3', title: 'K3', status: 2 },
			[{ url: '/ep-1', name: 'Episode 1', episode_number: 1 }],
			1
		).originKey,
		nfoKey ?? 'missing nfo key',
		keyOf('100', '/moved'),
		animeKeyOf('300', '/moved'),
		novelKeyOf('rr', '/moved'),
		planHentoidBook(
			{ folder: 'nhentai/A Book', files: ['1.jpg'], bytes: 0, content: null },
			'/hentoid',
			1
		).originKey,
		'hentoid:NHENTAI:/g/111/',
		'mihon-dir:Asura Scans (EN)/A Series',
		planEpub({
			relPath: 'a/b.epub',
			dir: 'a',
			file: 'b.epub',
			addedAt: 1,
			pkg: null,
			toc: [],
			sizes: new Map()
		}).originKey,
		// Malformed family keys: a Mihon or Aniyomi source is a number.
		'mihon:abc:/x',
		'aniyomi::/x',
		'lnreader:bad plugin:/x',
		'ln:rr',
		'',
		null
	];

	it('answers every key a writer stores as the old keyKind did', () => {
		expect(nfoKey).toBe('aniyomi:7000:/a-show');
		for (const key of KEYS) {
			expect(keyKind(key), String(key)).toBe(oldKeyKind(key));
			const family = keyFamily(key);
			expect(family === null ? null : SOURCE_KINDS[family], String(key)).toBe(oldKeyKind(key));
		}
		// The families the writers produce, in order: every family is reached.
		expect(KEYS.map(keyFamily)).toEqual([
			'mihon',
			'mihon',
			'lnreader',
			'aniyomi',
			'aniyomi',
			'mihon',
			'aniyomi',
			'lnreader',
			null,
			null,
			null,
			null,
			null,
			null,
			null,
			null,
			null,
			null
		]);
	});

	it('has one prefix per family, and each builder writes it', () => {
		expect(SOURCE_FAMILIES).toEqual(['mihon', 'lnreader', 'aniyomi']);
		expect(Object.keys(KEY_PREFIX)).toEqual([...SOURCE_FAMILIES]);
		expect(KEY_PREFIX).toEqual({ mihon: 'mihon', lnreader: 'lnreader', aniyomi: 'aniyomi' });
		expect(keyOf('1', '/u')).toBe('mihon:1:/u');
		expect(novelKeyOf('p', '/u')).toBe('lnreader:p:/u');
		expect(animeKeyOf('1', '/u')).toBe('aniyomi:1:/u');
		// No family's prefix starts another's, so one key is one family's.
		for (const f of SOURCE_FAMILIES)
			for (const g of SOURCE_FAMILIES)
				if (f !== g) expect(`${KEY_PREFIX[f]}:`.startsWith(`${KEY_PREFIX[g]}:`)).toBe(false);
	});

	it('is a family each kind\u2019s sources name, or no family', () => {
		for (const kind of KINDS)
			for (const family of KIND_FACTS[kind].sources) expect(SOURCE_FAMILIES).toContain(family);
		// Hentoid's two keys are no family: a doujin's Sources stay `mihon`.
		expect(keyFamily('hentoid:NHENTAI:/g/1/')).toBeNull();
		expect(keyFamily('hentoid-dir:nhentai/A Book')).toBeNull();
		expect(KIND_FACTS.doujin.sources).toEqual(['mihon']);
	});
});

/**
 * K3 (card c303): books.ts and covers.ts ask `grouping` and `medium` where
 * they named a doujin, a novel or an anime. Every kind, against the old
 * expressions written out.
 */
describe('what GROUP binds, and which covers a kind has', () => {
	it('binds books for exactly the kinds books.ts named doujin, volumes for novel', () => {
		for (const k of KINDS) {
			expect(KIND_FACTS[k].grouping === 'books', k).toBe(k === 'doujin');
			expect(KIND_FACTS[k].grouping === 'volumes', k).toBe(k === 'novel');
		}
		expect(kindsGrouped('books')).toEqual(['doujin']);
		expect(kindsGrouped('volumes')).toEqual(['novel']);
	});

	it('offers GROUP\u2019s answers by the registry, for every kind (card c375)', () => {
		// The old expressions of books.ts:140-142 at d5c4bf6f, written out: one
		// series of books is doujin singletons, one of volumes is novels.
		const oldAnswers = (items: { kind: Kind; entryCount: number }[]) => [
			...(items.length > 0 && items.every((i) => i.kind === 'doujin' && i.entryCount === 1)
				? ['books']
				: []),
			...(items.length > 0 && items.every((i) => i.kind === 'novel') ? ['volumes'] : []),
			'work'
		];
		const selections: { kind: Kind; entryCount: number }[][] = [[]];
		for (const a of KINDS)
			for (const n of [1, 2]) {
				selections.push([{ kind: a, entryCount: n }]);
				for (const b of KINDS)
					selections.push([
						{ kind: a, entryCount: n },
						{ kind: b, entryCount: 1 }
					]);
			}
		// Every kind alone, both ways of one book or more, and every pair.
		expect(selections).toHaveLength(1 + 7 * 2 * 8);
		for (const items of selections)
			expect(groupAnswers(items), JSON.stringify(items)).toEqual(oldAnswers(items));
	});

	it('reads an EPUB cover for text and a first page only for pages, as covers.ts did', () => {
		for (const k of KINDS) {
			// covers.ts:87 and :121 at fb2bd3a7.
			expect(kindFacts(k).medium === 'text', k).toBe(k === 'novel');
			expect(kindFacts(k).medium !== 'pages', k).toBe(
				k === 'novel' || kindFacts(k).medium === 'video'
			);
		}
	});
});

describe('the AniList catalogue', () => {
	it('asks MANGA for every comic and novel, ANIME for an anime', () => {
		expect(KINDS.filter((k) => anilistTypeOf(k) === 'ANIME')).toEqual(['anime']);
		expect(KINDS.filter((k) => anilistTypeOf(k) === 'MANGA')).toEqual([
			'manga',
			'manhwa',
			'doujin',
			'novel'
		]);
		for (const kind of KINDS) {
			const type = anilistTypeOf(kind);
			if (type) expect(kindFacts(kind).catalogue.type).toBe(type);
			// A film or a show is TMDB's; the loud question refuses it.
			else expect(() => anilistType(kind), kind).toThrow();
		}
	});

	it('builds the entry path its kind lives under', () => {
		expect(anilistUrl(171204)).toBe('https://anilist.co/manga/171204');
		expect(anilistUrl(171204, 'anime')).toBe('https://anilist.co/anime/171204');
		expect(malUrl(160388, 'novel')).toBe('https://myanimelist.net/manga/160388');
		expect(malUrl(21, 'anime')).toBe('https://myanimelist.net/anime/21');
	});

	it('accepts a pasted link only under the series\u2019 own kind\u2019s path', () => {
		expect(parsePasted('https://anilist.co/anime/21')).toBeNull();
		expect(parsePasted('https://anilist.co/anime/21', 'anime')).toEqual({
			service: 'anilist',
			id: 21
		});
		expect(parsePasted('anilist.co/manga/171204', 'anime')).toBeNull();
		expect(parsePasted('https://myanimelist.net/manga/160388/x', 'novel')).toEqual({
			service: 'mal',
			id: 160388
		});
	});
});

describe('what may match what (doc/LINKS.md, "A novel never matches a comic")', () => {
	it('keeps manga, manhwa and doujin one comic family, and a novel alone', () => {
		const yes: [Parameters<typeof sameKind>[0], Parameters<typeof sameKind>[1]][] = [
			['manga', 'manga'],
			['manga', 'manhwa'],
			['manhwa', 'manga'],
			['doujin', 'manga'],
			['manga', 'doujin'],
			['manhwa', 'doujin'],
			['novel', 'novel'],
			['anime', 'anime']
		];
		for (const [series, candidate] of yes) expect(sameKind(series, candidate)).toBe(true);
		const no: [Parameters<typeof sameKind>[0], Parameters<typeof sameKind>[1]][] = [
			['novel', 'manga'],
			['manga', 'novel'],
			['novel', 'manhwa'],
			['manhwa', 'novel'],
			['novel', 'doujin'],
			['anime', 'manga'],
			['manga', 'anime'],
			['anime', 'novel'],
			['novel', 'anime'],
			['anime', 'doujin'],
			['doujin', 'anime'],
			['manga', null],
			['anime', null]
		];
		for (const [series, candidate] of no) expect(sameKind(series, candidate)).toBe(false);
	});

	it('answers all 49 ordered pairs as the pre-K1 sameKind did', () => {
		// The lists above are the readable half; this is the exhaustive one.
		// The oracle is `sameKind` as it shipped at a698f974, before it read
		// `matches` (`git show a698f974:src/lib/library/catalogue.ts`,
		// :168-175), transcribed here rather than derived from KIND_FACTS: an
		// anime only with an anime, and otherwise novel-or-not must agree.
		const before = (series: Kind, candidate: Kind): boolean => {
			// c987: a film and a show are each their own work, as an anime is.
			if (
				['anime', 'movie', 'show'].includes(series) ||
				['anime', 'movie', 'show'].includes(candidate)
			)
				return series === candidate;
			return (series !== 'novel') === (candidate !== 'novel');
		};
		const pairs = KINDS.flatMap((s) => KINDS.map((c) => [s, c] as const));
		expect(pairs).toHaveLength(49);
		for (const [series, candidate] of pairs)
			expect(sameKind(series, candidate), `${series} against ${candidate}`).toBe(
				before(series, candidate)
			);
	});

	it('flags a wrong-kind link, but never the cover-only crossing', () => {
		expect(wrongKind('anime', 'TV')).toBe(false);
		expect(wrongKind('anime', 'MANGA')).toBe(true);
		expect(wrongKind('manga', 'TV')).toBe(true);
		expect(wrongKind('manga', 'MANGA')).toBe(false);
		// The novel across to its comic is a cover, not a wrong kind (c298).
		expect(wrongKind('novel', 'MANGA')).toBe(false);
		expect(wrongKind('manga', 'NOVEL')).toBe(false);
		expect(wrongKind('doujin', 'NOVEL')).toBe(false);
		expect(wrongKind('manga', '')).toBe(false);
	});

	it('leaves coverOnly exactly as it was: a novel and a comic, never an anime', () => {
		expect(coverOnly('novel', 'MANGA')).toBe(true);
		expect(coverOnly('manga', 'NOVEL')).toBe(true);
		expect(coverOnly('doujin', 'NOVEL')).toBe(true);
		expect(coverOnly('anime', 'MANGA')).toBe(false);
		expect(coverOnly('novel', 'TV')).toBe(false);
		expect(coverOnly('manga', 'MANGA')).toBe(false);
		expect(coverOnly('novel', '')).toBe(false);
	});

	it('reads a candidate\u2019s kind from AniList\u2019s format and country', () => {
		expect(candidateKind({ format: 'NOVEL', country: 'JP' })).toBe('novel');
		expect(candidateKind({ format: 'TV', country: 'JP' })).toBe('anime');
		expect(candidateKind({ format: 'MOVIE', country: 'JP' })).toBe('anime');
		expect(candidateKind({ format: 'MANGA', country: 'JP' })).toBe('manga');
		expect(candidateKind({ format: 'MANGA', country: 'KR' })).toBe('manhwa');
		expect(candidateKind({ format: 'ONE_SHOT', country: 'JP' })).toBe('manga');
		expect(candidateKind({ format: '', country: 'JP' })).toBeNull();
	});
});

describe('the unit and READ/WATCHED words (labels.ts)', () => {
	it('says CH, VOL or EP as it did before the registry', () => {
		expect(unitLabel('manga')).toBe('CH');
		expect(unitLabel('manhwa')).toBe('CH');
		expect(unitLabel('doujin')).toBe('CH');
		expect(unitLabel('novel')).toBe('VOL');
		expect(unitLabel('anime')).toBe('EP');
	});

	it('says READ, or WATCHED for an anime, as it did before the registry', () => {
		expect(sheetMeta(card('manga'))).toBe('MANGA · 58 CH · 41 READ · +3 NEW');
		expect(sheetMeta(card('manhwa'))).toBe('MANHWA · 58 CH · 41 READ · +3 NEW');
		expect(sheetMeta(card('doujin'))).toBe('DOUJIN · 58 CH · 41 READ · +3 NEW');
		expect(sheetMeta(card('novel'))).toBe('NOVEL · 58 VOL · 41 READ · +3 NEW');
		expect(sheetMeta(card('anime'))).toBe('ANIME · 58 EP · 41 WATCHED · +3 NEW');
		// A series with nothing new has no NEW part.
		expect(sheetMeta(card('anime', { newCount: 0 }))).toBe('ANIME · 58 EP · 41 WATCHED');
	});
});

/**
 * The registry's guard (doc/KINDS.md, "No new kind checks"; cards c301 and
 * c305): outside the registry and a short allow-list, no `kind` is compared
 * against a kind's name.
 *
 * What it counts: one line in any `src/**\/*.ts` or `src/**\/*.svelte` where a
 * `kind` (a series', a source's, a candidate's) is compared against one of
 * `KINDS`' own names, either way round:
 *
 *   s.kind === 'anime'      kind !== 'novel'      'manga' === row.kind
 *
 * and, since card c420, the same comparison spelled through the families'
 * kinds, either way round and dotted or bracketed:
 *
 *   s.kind === SOURCE_KINDS.lnreader      SOURCE_KINDS[f] === r.kind
 *
 * It is the same textual scan the command in doc/KINDS.md prints, so a line
 * holding two comparisons counts once and a mention in a comment counts too.
 * It does not count a comparison against another word (`kind === 'none'`, a
 * download's state), nor a helper (`movableKind`), nor a question asked
 * through one (`familyOfKind(l.kind) === 'mihon'` names a family, not a kind).
 *
 * The allow-list is by file, with the reason that file may name kinds. What
 * is left is not "not yet migrated": it is another service's vocabulary
 * (AniList's formats and ids), Ranobe's own kinds, SQL that cannot ask the
 * registry, fixtures, or a tracker's rule. A new check in an allowed file is
 * still a decision someone must be able to justify in its reason, and a kind
 * added to the registry must be answered everywhere the compiler asks.
 */
const ALLOWED: { file: string; reason: string }[] = [
	{
		file: 'src/lib/server/db.ts',
		reason:
			'The migrations are history: each rung says what the schema was when it ran, and a rung is never edited.'
	},
	{
		file: 'src/lib/server/anime/marks.ts',
		reason:
			"SQL: AniSkip is looked up by a MAL id, which only an anime's link carries; a film or a show has nothing to ask it with."
	},
	{
		file: 'src/lib/server/anime/choices.ts',
		reason:
			'SQL: the browser keys before c171 were only ever written for an anime, so only an anime can have one to adopt.'
	},
	{
		file: 'src/lib/server/dupes.ts',
		reason:
			'SQL: likely twin books are found among doujin books by cover hash (doc/DUPLICATE-BOOKS.md, "Finding"). A new kind of single book must change the line.'
	},
	{
		file: 'src/lib/server/duplicates.ts',
		reason:
			"SQL: books aren't chapters (doc/DUPLICATE-CHAPTERS.md): a series of doujin books is never collapsed, nor a novel, whose entries are places in one EPUB. A new kind like either must change the line."
	},
	{
		file: 'src/lib/server/epub.ts',
		reason: "SQL: an EPUB is a novel's file. A new text kind must change the line."
	},
	{
		file: 'src/lib/server/novels/online.ts',
		reason: "SQL: a chapter read online is a novel's (LNReader's), by construction."
	},
	{
		file: 'src/lib/server/people.ts',
		reason:
			"SQL: a person's page lists a doujin of one book as a book, and only a doujin of several as a series. A new kind of single book must change the line."
	},
	{
		file: 'src/lib/server/settings-page.ts',
		reason:
			"SQL: MODE's and LAYOUT's N SERIES DIFFER is about reading direction, which only the kinds read in pages or text have (c552). A new kind read that way must change the line."
	},
	{
		file: 'src/lib/library/catalogue.ts',
		reason:
			"AniList's own words: a format and a country become a kind, and the cover-only crossing is between a novel and its comic."
	},
	{
		file: 'src/lib/server/catalogue.ts',
		reason:
			"AniList's transport: the MAL id family, the GraphQL type, and the format list each kind is asked with."
	},
	{
		file: 'src/lib/server/fixtures.ts',
		reason: 'Fixtures: one series of each kind, shaped like what an importer makes.'
	},
	{
		file: 'src/lib/server/japanese/ocr.ts',
		reason:
			"SQL: OCR is for pages and the registry's medium is not a column. The one text kind is named; a new text kind must change the line."
	},
	{
		file: 'src/lib/server/ranobe.ts',
		reason: "Ranobe's own kinds and its work-versus-edition rule (doc/RANOBE.md)."
	},
	{
		file: 'src/lib/library/ranobe.ts',
		reason: "`RANOBE_KINDS`/`byWork`: which kinds Ranobe tracks, which is Ranobe's list."
	},
	{
		file: 'src/lib/server/tracking.ts',
		reason:
			'MAL and AniList track a comic and an anime, never a doujin or a novel: the trackers’ rule, not a kind fact.'
	}
];
/** One of `KINDS`' own names, as a bare alternation. */
const NAME = String.raw`(?:manga|manhwa|doujin|novel|anime|movie|show)`;
/** A kind written down: a name in quotes, or a family's kind (`SOURCE_KINDS.x`, `SOURCE_KINDS[f]`). */
const FIXED = String.raw`(?:['"]${NAME}['"]|SOURCE_KINDS(?:\.\w+|\[[^\]]*\]))`;
const COMPARED = new RegExp(
	String.raw`\bkind\s*[!=]==?\s*(?:['"]${NAME}['"]|SOURCE_KINDS\b)|${FIXED}\s*[!=]==?\s*[A-Za-z_$][\w$.]*kind\b` +
		// SQL (c991): `s.kind = 'anime'`, `kind != 'novel'`, `kind IN ('movie', …)`.
		// The registry is not a column, so SQL spells the kinds; `videoKindsSql`
		// (kinds.ts) is where it does, and any other spelling is counted here.
		String.raw`|\bkind\s*(?:=|!=|<>)\s*'${NAME}'|\bkind\s+(?:NOT\s+)?IN\s*\(\s*'${NAME}'`
);

describe('what the ratchet sees (card c420)', () => {
	// Every spelling of a kind check the scan must count, and the questions it
	// must not: a family asked through its decoder, or a download's own kind.
	const counted = [
		`s.kind === 'anime'`,
		`kind !== "novel"`,
		`'manga' === row.kind`,
		`data.source.kind === SOURCE_KINDS.lnreader`,
		`l.kind !== SOURCE_KINDS.mihon`,
		`r.kind === SOURCE_KINDS[family]`,
		`SOURCE_KINDS[f] === r.kind`,
		`SOURCE_KINDS.aniyomi !== x.kind`,
		`kind === 'movie'`,
		"WHERE e.id = ? AND s.kind = 'anime'",
		"AND kind IN ('movie', 'show')"
	];
	const notCounted = [
		`familyOfKind(l.kind) === 'mihon'`,
		`s.family === 'lnreader'`,
		`kind === 'none'`,
		`const kind = SOURCE_KINDS[family]`,
		`kind: family === 'lnreader' ? SOURCE_KINDS.mihon : SOURCE_KINDS[family]`,
		`movableKind(k)`
	];
	it('counts a kind compared with a name or a family\u2019s kind, either way round', () => {
		for (const line of counted) expect(COMPARED.test(line), line).toBe(true);
	});
	it('does not count a family, an assignment or another word', () => {
		for (const line of notCounted) expect(COMPARED.test(line), line).toBe(false);
	});
});

function sourceFiles(dir: string): string[] {
	return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
		const path = join(dir, entry.name);
		if (entry.isDirectory()) return sourceFiles(path);
		return /\.(ts|svelte)$/.test(entry.name) ? [path] : [];
	});
}

describe('no new kind checks', () => {
	it('finds none outside the registry and the files that own a kind\u2019s peculiarity', () => {
		const root = join(process.cwd(), 'src');
		const registry = join(root, 'lib', 'library', 'kinds.ts');
		const found: string[] = [];
		for (const file of sourceFiles(root)) {
			if (file === registry) continue;
			const lines = readFileSync(file, 'utf8').split('\n');
			lines.forEach((line, i) => {
				if (COMPARED.test(line))
					found.push(`${relative(process.cwd(), file)}:${i + 1}: ${line.trim()}`);
			});
		}
		// The message is the diff: every line that counts, so a merge that adds
		// one names it instead of only moving a number.
		const outside = found.filter(
			(line) => !ALLOWED.some((allowed) => line.startsWith(`${allowed.file}:`))
		);
		expect(
			outside,
			`${outside.length} kind comparisons outside the allow-list:\n${outside.join('\n')}`
		).toEqual([]);
	});
});

describe('the kinds a source family may serve (c986)', () => {
	it('defaults every family to the first kind it may serve', () => {
		for (const family of SOURCE_FAMILIES)
			expect(SOURCE_KIND_CHOICES[family][0], family).toBe(SOURCE_KINDS[family]);
	});
	it('lists only kinds whose sources include that family', () => {
		for (const family of SOURCE_FAMILIES)
			for (const kind of SOURCE_KIND_CHOICES[family])
				expect(kindFacts(kind).sources, `${kind} from ${family}`).toContain(family);
	});
});

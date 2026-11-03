import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
	anilistType,
	KIND_FACTS,
	kindFacts,
	KINDS,
	MOVE_MAP,
	MOVABLE_KINDS,
	SOURCE_KINDS,
	type Kind,
	type KindFacts,
	type Medium,
	type MovableKind
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
import type { MoveKind } from '$lib/library/move';
import type { SeriesCard } from '$lib/library/types';

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
		const literals: Kind[] = ['manga', 'manhwa', 'doujin', 'novel', 'anime'];
		expect(Object.keys(KIND_FACTS)).toHaveLength(literals.length);
		for (const kind of literals) expect(KIND_FACTS[kind].kind).toBe(kind);
		expect(KINDS).toEqual(literals);
	});

	it('gives every kind a medium, a unit, a catalogue and a storage', () => {
		const media: Medium[] = ['pages', 'text', 'video'];
		for (const kind of KINDS) {
			const facts: KindFacts = kindFacts(kind);
			expect(media).toContain(facts.medium);
			expect(facts.unit.short).not.toBe('');
			expect(facts.unit.long).not.toBe('');
			expect(['READ', 'WATCHED']).toContain(facts.unit.done);
			// Every kind is catalogued by AniList today; TMDB is the movies card's.
			expect(facts.catalogue.provider).toBe('anilist');
			expect(['library', 'jellyfin']).toContain(facts.storage);
			if (facts.layout) expect(['paged', 'vertical', 'rtl', 'ltr']).toContain(facts.layout);
		}
		// Text and video are the two that are not pages: the readers and the player.
		expect(KINDS.filter((k) => kindFacts(k).medium === 'text')).toEqual(['novel']);
		expect(KINDS.filter((k) => kindFacts(k).medium === 'video')).toEqual(['anime']);
	});

	it('lets a kind match itself, and only kinds the registry names', () => {
		for (const kind of KINDS) {
			const { matches } = kindFacts(kind);
			expect(matches).toContain(kind);
			for (const m of matches) expect(KINDS).toContain(m);
		}
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
		// the library counts by it (src/lib/server/library.ts:440). The literal
		// list is what can go red; `FILTER_KINDS` being `KINDS` is a tautology.
		expect(FILTER_KINDS).toEqual(['manga', 'manhwa', 'doujin', 'novel', 'anime']);
	});
});

describe('MOVABLE', () => {
	it('is the kinds MOVE is offered for, which is three, not the map kind', () => {
		const movable: MovableKind[] = ['manga', 'manhwa', 'anime'];
		expect(MOVABLE_KINDS).toEqual(movable);
		expect(KINDS.filter((k) => KIND_FACTS[k].movable)).toEqual(movable);
		// Not movable: a doujin is Hentoid's, and a novel has no extension family.
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

describe('the source families', () => {
	it('name a kind each, and that kind is fed by that family', () => {
		expect(SOURCE_KINDS).toEqual({ mihon: 'manga', lnreader: 'novel', aniyomi: 'anime' });
		for (const [family, kind] of Object.entries(SOURCE_KINDS)) {
			expect(KIND_FACTS[kind].sources).toContain(family);
		}
		// A doujin has no extension family: Hentoid's folder is not one.
		expect(KIND_FACTS.doujin.sources).toEqual([]);
	});
});

describe('the AniList catalogue', () => {
	it('asks MANGA for every comic and novel, ANIME for an anime', () => {
		expect(KINDS.filter((k) => anilistType(k) === 'ANIME')).toEqual(['anime']);
		expect(KINDS.filter((k) => anilistType(k) === 'MANGA')).toEqual([
			'manga',
			'manhwa',
			'doujin',
			'novel'
		]);
		for (const kind of KINDS) expect(kindFacts(kind).catalogue.type).toBe(anilistType(kind));
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
 * The ratchet (doc/KINDS.md, "No new kind checks"): the number of places that
 * still compare a kind by name, which may only go down.
 *
 * What it counts: one line in any `src/**\/*.ts` or `src/**\/*.svelte` where a
 * `kind` (a series', a source's, a candidate's) is compared against one of
 * `KINDS`' own names, either way round:
 *
 *   s.kind === 'anime'      kind !== 'novel'      'manga' === row.kind
 *
 * It is the same textual scan the command in doc/KINDS.md prints, so a line
 * holding two comparisons counts once and a mention in a comment counts too.
 * It does not count a comparison against another word (`kind === 'none'`, a
 * download's state), nor a helper (`movableKind`).
 *
 * What is allow-listed: `src/lib/library/kinds.ts` alone, because that file
 * is where a kind may be named -- its `matches` and `MOVE_MAP` are the rules.
 * The modules that own a kind's own peculiarity (`series.ts`'s doujin books
 * and manhwa strip, `ImageReader.svelte`'s vertical strip, `catalogue.ts`'s
 * cover-only crossing and format lists, `labels.ts`'s doujin book line) are
 * counted: they are what K2-K5 lower by moving the question into the registry.
 *
 * How to lower it: delete or replace a check, then lower BASELINE by exactly
 * the count removed. Never raise it without a card saying which check and why.
 */
const BASELINE = 152;
/** One of `KINDS`' own names, as a bare alternation. */
const NAME = String.raw`(?:manga|manhwa|doujin|novel|anime)`;
const COMPARED = new RegExp(
	String.raw`\bkind\s*[!=]==?\s*['"]${NAME}['"]|['"]${NAME}['"]\s*[!=]==?\s*[A-Za-z_$][\w$.]*kind\b`
);

function sourceFiles(dir: string): string[] {
	return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
		const path = join(dir, entry.name);
		if (entry.isDirectory()) return sourceFiles(path);
		return /\.(ts|svelte)$/.test(entry.name) ? [path] : [];
	});
}

describe('no new kind checks', () => {
	it(`holds the baseline of ${BASELINE} comparisons outside the registry`, () => {
		const root = join(process.cwd(), 'src');
		const allowed = join(root, 'lib', 'library', 'kinds.ts');
		const found: string[] = [];
		for (const file of sourceFiles(root)) {
			if (file === allowed) continue;
			const lines = readFileSync(file, 'utf8').split('\n');
			lines.forEach((line, i) => {
				if (COMPARED.test(line))
					found.push(`${relative(process.cwd(), file)}:${i + 1}: ${line.trim()}`);
			});
		}
		// The message is the diff: every line that counts, so a merge that adds
		// one names it instead of only moving a number.
		expect(
			found.length,
			`${found.length} kind comparisons, baseline ${BASELINE}:\n${found.join('\n')}`
		).toBe(BASELINE);
	});
});

import { mkdtempSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import type { Candidate } from '$lib/library/catalogue';

/**
 * OTHER FORMS (c700; doc/SERIES.md, "OTHER FORMS"): the same work's manga,
 * novel or anime, from the relation cache the link pass fills.
 *
 * The answer below is AniList's own, recorded on 2026-11-08 by posting
 * relations.ts' query for `Media(id: 178533, type: ANIME)` to
 * https://graphql.anilist.co, the card's example (Ranma 1/2 (2024) and manga
 * 30023). Trimmed of nothing but the `SEQUEL`'s and the second `ALTERNATIVE`'s
 * titles. Two edits, for the card's own case: `SOURCE` where AniList says
 * `ADAPTATION` for the manga, and one `ADAPTATION` added for a novel, which
 * Ranma has none of. The `ALTERNATIVE` anime and the `MUSIC` are left as
 * answered, and are what the rule must refuse.
 */
process.env.DATABASE_PATH = ':memory:';
process.env.TRASH_DIR = mkdtempSync(
	join(process.env.TMPDIR ?? join(process.cwd(), 'temp'), 'tsundoku-forms-trash-')
);

const { getDb } = await import('$lib/server/db');
const { seedSample } = await import('$lib/server/fixtures');
const rel = await import('$lib/server/relations');
const cat = await import('$lib/server/catalogue');
const seasons = await import('$lib/server/season-links');
const works = await import('$lib/server/works');
const { candidateKind } = await import('$lib/library/catalogue');
const { otherFormsView } = await import('../src/routes/series/[id]/other-forms.server');

const NOW = Date.UTC(2026, 10, 8, 12);
const db = getDb();
seedSample(db, NOW);

const title = (english: string | null, romaji: string, native: string | null = null) => ({
	english,
	romaji,
	native
});
const node = (
	id: number,
	type: string,
	format: string,
	o: { episodes?: number; chapters?: number; volumes?: number; year?: number; t?: string } = {}
) => ({
	id,
	type,
	format,
	status: 'FINISHED',
	episodes: o.episodes ?? null,
	chapters: o.chapters ?? null,
	volumes: o.volumes ?? null,
	startDate: { year: o.year ?? null },
	title: title(o.t ?? `Entry ${id}`, o.t ?? `Entry ${id}`)
});

const RANMA = {
	...node(178533, 'ANIME', 'TV', { episodes: 12, year: 2024, t: 'Ranma1/2 (2024)' }),
	relations: {
		edges: [
			{
				relationType: 'SOURCE',
				node: node(30023, 'MANGA', 'MANGA', {
					chapters: 407,
					volumes: 38,
					year: 1987,
					t: 'Ranma ½'
				})
			},
			{
				relationType: 'ADAPTATION',
				node: node(50001, 'MANGA', 'NOVEL', { volumes: 5, year: 1990, t: 'Ranma ½ Novel' })
			},
			{
				relationType: 'ALTERNATIVE',
				node: node(149939, 'ANIME', 'TV', { episodes: 143, year: 1989 })
			},
			{ relationType: 'ALTERNATIVE', node: node(210, 'ANIME', 'TV', { episodes: 18, year: 1989 }) },
			{ relationType: 'OTHER', node: node(183390, 'ANIME', 'MUSIC', { episodes: 1, year: 2024 }) },
			{ relationType: 'SEQUEL', node: node(185731, 'ANIME', 'TV', { episodes: 12, year: 2025 }) }
		]
	}
};
const SEQUEL = {
	...node(185731, 'ANIME', 'TV', { episodes: 12, year: 2025 }),
	relations: {
		edges: [
			{ relationType: 'PREQUEL', node: node(178533, 'ANIME', 'TV', { year: 2024 }) },
			{ relationType: 'ADAPTATION', node: node(30023, 'MANGA', 'MANGA', { year: 1987 }) }
		]
	}
};
const MANGA = {
	...node(30023, 'MANGA', 'MANGA', { chapters: 407, volumes: 38, year: 1987, t: 'Ranma ½' }),
	relations: {
		edges: [
			{
				relationType: 'ADAPTATION',
				node: node(178533, 'ANIME', 'TV', { episodes: 12, year: 2024, t: 'Ranma1/2 (2024)' })
			}
		]
	}
};
const WORLD = new Map<number, unknown>([
	[178533, RANMA],
	[185731, SEQUEL],
	[30023, MANGA]
]);

const asks: string[] = [];
/** Answers as relations.ts asks: aliased `Media(id: $iN, type: X)`, unknown ids null. */
const ask = async (query: string, vars: Record<string, unknown>) => {
	asks.push(query);
	const out: Record<string, unknown> = {};
	for (const m of query.matchAll(/m(\d+):\s*Media\(id:\s*\$i(\d+),\s*type:\s*(\w+)\)/g))
		out[`m${m[1]}`] = WORLD.get(Number(vars[`i${m[2]}`])) ?? null;
	return out;
};

const root = (db.prepare(`SELECT id FROM roots WHERE hidden = 0 LIMIT 1`).get() as { id: number })
	.id;
const hiddenRoot = () =>
	Number(
		db
			.prepare(`INSERT INTO roots (name, path, hidden) VALUES (?, ?, 1)`)
			.run(`Hidden ${Math.random()}`, `/hidden/${Math.random()}`).lastInsertRowid
	);
let serial = 0;
const series = (t: string, kind: string, inRoot = root) =>
	Number(
		db
			.prepare(
				`INSERT INTO series (root_id, title, kind, added_at, origin_key, in_library, hue)
				VALUES (?, ?, ?, ?, ?, 1, 30)`
			)
			.run(inRoot, t, kind, NOW, `forms:${++serial}`).lastInsertRowid
	);
const entry = (anilistId: number, format: string): Candidate => ({
	anilistId,
	malId: null,
	title: `Linked ${anilistId}`,
	alts: [],
	format,
	country: 'JP',
	year: 2000,
	chapters: null,
	volumes: null,
	episodes: 12,
	season: null,
	seasonYear: null,
	status: 'FINISHED',
	coverUrl: ''
});
const anime = (t: string, ...ids: number[]) => {
	const id = series(t, 'anime');
	ids.forEach((a, i) => {
		db.prepare(
			`INSERT INTO entries (series_id, position, label, added_at, source_url, season, episode_number)
			VALUES (?, ?, 'Ep.', ?, ?, ?, 1)`
		).run(id, i + 1, NOW, `/f/${id}/${i}`, i + 1);
		expect(seasons.linkSeason(id, i + 1, 1, entry(a, 'TV'), 'review', NOW)).toBe(true);
	});
	return id;
};
const comic = (t: string, kind: string, anilist: number, format: string) => {
	const id = series(t, kind);
	cat.link(id, entry(anilist, format), 'review', NOW);
	return id;
};
const pass = () => rel.refreshRelations(ask, { now: NOW, limit: 50 });
/** Each case starts with no cached graph and no links, so its pass is its own. */
const fresh = () => {
	for (const t of ['series_relations', 'series_season_links', 'series_links'])
		db.prepare(`DELETE FROM ${t}`).run();
	asks.length = 0;
};

describe('what counts as another form (c700)', () => {
	it('is a SOURCE, an ADAPTATION or an ALTERNATIVE of another kind, each with its facts', async () => {
		fresh();
		const show = anime('Ranma Show', 178533);
		await pass();
		expect(rel.otherFormsOf(show, false)).toEqual([
			{
				anilistId: 30023,
				kind: 'manga',
				word: 'MANGA',
				title: 'Ranma ½',
				facts: ['MANGA', 'FINISHED', '407 CH.', '38 VOL.'],
				seriesId: null
			},
			{
				anilistId: 50001,
				kind: 'novel',
				word: 'LIGHT NOVEL',
				title: 'Ranma ½ Novel',
				facts: ['NOVEL', 'FINISHED', '5 VOL.'],
				seriesId: null
			}
		]);
	});

	it('reads the cache alone: a screen’s read asks AniList nothing', async () => {
		fresh();
		const show = anime('Ranma Quiet', 178533);
		await pass();
		const fetchSpy = vi.fn();
		vi.stubGlobal('fetch', fetchSpy);
		asks.length = 0;
		try {
			expect(rel.otherFormsOf(show, false)).toHaveLength(2);
			expect(otherFormsView(show, false)?.rows).toHaveLength(2);
			expect(fetchSpy).not.toHaveBeenCalled();
			expect(asks).toEqual([]);
		} finally {
			vi.unstubAllGlobals();
		}
	});

	it('maps every AniList format to a kind, or to none (the whole of MediaFormat)', () => {
		const kindOf = (format: string) => candidateKind({ format, country: '' });
		expect(
			Object.fromEntries(
				[
					'TV',
					'TV_SHORT',
					'MOVIE',
					'SPECIAL',
					'OVA',
					'ONA',
					'MUSIC',
					'MANGA',
					'NOVEL',
					'ONE_SHOT'
				].map((f) => [f, kindOf(f)])
			)
		).toEqual({
			TV: 'anime',
			TV_SHORT: 'anime',
			MOVIE: 'anime',
			SPECIAL: 'anime',
			OVA: 'anime',
			ONA: 'anime',
			MUSIC: null,
			MANGA: 'manga',
			NOVEL: 'novel',
			ONE_SHOT: 'manga'
		});
	});

	/** A season linked between the outer two, on no chain the walk would follow. */
	const OFF_CHAIN = 900100;
	WORLD.set(OFF_CHAIN, {
		...node(OFF_CHAIN, 'ANIME', 'TV', { year: 2024 }),
		relations: {
			edges: [{ relationType: 'ADAPTATION', node: node(900200, 'MANGA', 'NOVEL', { year: 2010 }) }]
		}
	});
	WORLD.set(185732, { ...node(185732, 'ANIME', 'TV', { year: 2026 }), relations: { edges: [] } });

	it('reads one hop from every linked season, a middle one on no chain included', async () => {
		fresh();
		const show = anime('Three Seasons', 185731, OFF_CHAIN, 185732);
		await pass();
		expect(rel.otherFormsOf(show, false)?.map((f) => f.anilistId)).toContain(900200);
	});

	it('calls a graph stale that lacks a middle season’s edges', async () => {
		fresh();
		const show = anime('Stale Middle', 185731, OFF_CHAIN, 185732);
		await pass();
		expect(rel.relationsStale(show, NOW)).toBe(false);
		const row = db.prepare(`SELECT graph FROM series_relations WHERE series_id = ?`).get(show) as {
			graph: string;
		};
		const graph = JSON.parse(row.graph);
		graph.nodes[String(OFF_CHAIN)].edges = null;
		db.prepare(`UPDATE series_relations SET graph = ? WHERE series_id = ?`).run(
			JSON.stringify(graph),
			show
		);
		expect(rel.relationsStale(show, NOW)).toBe(true);
	});

	it('takes an ALTERNATIVE of another kind, and refuses a relation of no kind it knows', async () => {
		fresh();
		WORLD.set(900300, {
			...node(900300, 'ANIME', 'TV', { year: 2020 }),
			relations: {
				edges: [
					{ relationType: 'ALTERNATIVE', node: node(900301, 'MANGA', 'ONE_SHOT', { year: 2019 }) },
					{ relationType: 'ALTERNATIVE', node: node(900302, 'ANIME', 'MUSIC', { year: 2020 }) }
				]
			}
		});
		const show = anime('Alternatives', 900300);
		await pass();
		expect(rel.otherFormsOf(show, false)?.map((f) => [f.anilistId, f.word])).toEqual([
			[900301, 'ONE-SHOT']
		]);
	});
});

describe('IN LIBRARY (c700)', () => {
	it('is the other series’ own link, by season or by series, never its title', async () => {
		fresh();
		const show = anime('Ranma Show', 178533);
		// The same title, unlinked: not it.
		series('Ranma ½', 'manga');
		const linked = comic('A Differently Titled Manga', 'manga', 30023, 'MANGA');
		await pass();
		expect(rel.otherFormsOf(show, false)?.[0]).toMatchObject({
			anilistId: 30023,
			seriesId: linked
		});
		// A season link answers for an anime form, from the manga's side.
		await pass();
		expect(rel.otherFormsOf(linked, false)?.map((f) => [f.anilistId, f.seriesId])).toEqual([
			[178533, show]
		]);
	});

	it('is not a series of another kind holding the entry for its cover', async () => {
		fresh();
		const show = anime('Ranma Cover', 178533);
		// A novel linked to the manga's entry for its cover: not the manga.
		comic('A Novel On The Comic', 'novel', 30023, 'MANGA');
		await pass();
		expect(rel.otherFormsOf(show, false)?.[0]).toMatchObject({ anilistId: 30023, seriesId: null });
	});

	it('does not offer a hidden series outside reveal', async () => {
		fresh();
		const show = anime('Ranma Hides', 178533);
		const hidden = series('Hidden Manga', 'manga', hiddenRoot());
		cat.link(hidden, entry(30023, 'MANGA'), 'review', NOW);
		await pass();
		expect(rel.otherFormsOf(show, false)?.[0].seriesId).toBeNull();
		expect(rel.otherFormsOf(show, true)?.[0].seriesId).toBe(hidden);
	});
});

describe('the Work on an IN LIBRARY row (c700)', () => {
	const setup = async () => {
		fresh();
		const show = anime('Ranma Work', 178533);
		const manga = comic('Ranma Work Manga', 'manga', 30023, 'MANGA');
		await pass();
		const row = () => otherFormsView(show, false)?.rows.find((r) => r.seriesId === manga);
		return { show, manga, row };
	};

	it('offers GROUP when neither is in a Work, and hands the sheet both series, this one first', async () => {
		const { show, manga, row } = await setup();
		expect(row()?.work).toEqual({ state: 'group' });
		expect(row()?.book).toMatchObject({ seriesId: manga, title: 'Ranma Work Manga' });
		expect(otherFormsView(show, false)?.self).toMatchObject({ seriesId: show });
	});

	it('reads IN THIS WORK at the other’s part once the two are one Work, and no GROUP', async () => {
		const { show, manga, row } = await setup();
		works.createWork({ seriesIds: [show, manga], name: 'Ranma', order: 'hand' });
		expect(row()?.work).toMatchObject({ state: 'same', part: 2 });
	});

	it('offers nothing when one is in another Work, or each in its own', async () => {
		const { show, manga, row } = await setup();
		const a = series('Beside A', 'manga');
		const b = series('Beside B', 'manga');
		works.createWork({ seriesIds: [manga, a], name: 'Theirs', order: 'hand' });
		expect(row()?.work).toBeNull();
		works.createWork({ seriesIds: [show, b], name: 'Mine', order: 'hand' });
		expect(row()?.work).toBeNull();
	});
});

describe('the comics’ and novels’ side (c700)', () => {
	it('is one more MANGA ask in the same pass, cached in the same table', async () => {
		fresh();
		const manga = comic('Ranma Comic', 'manga', 30023, 'MANGA');
		const r = await pass();
		expect(r.refreshed).toBe(1);
		expect(asks).toHaveLength(1);
		expect(asks[0]).toContain('type: MANGA');
		expect(rel.otherFormsOf(manga, false)?.map((f) => [f.anilistId, f.word])).toEqual([
			[178533, 'ANIME']
		]);
		// Fresh: the next pass does not ask again.
		asks.length = 0;
		await pass();
		expect(asks).toEqual([]);
	});

	it('does not ask for a link to another kind’s entry (a novel on its comic, for the cover)', async () => {
		fresh();
		const novel = comic('Cover Only Novel', 'novel', 30023, 'MANGA');
		await pass();
		expect(asks).toEqual([]);
		expect(rel.otherFormsOf(novel, false)).toBeNull();
	});

	it('asks again when the graph has aged, and keeps it when the ask fails', async () => {
		fresh();
		const manga = comic('Ranma Aged', 'manga', 30023, 'MANGA');
		await pass();
		const later = NOW + rel.RELATIONS_STALE_MS + 1;
		asks.length = 0;
		const failing = async (q: string) => {
			asks.push(q);
			throw new Error('down');
		};
		const r = await rel.refreshRelations(failing, { now: later, limit: 50 });
		expect(asks).toHaveLength(1);
		expect(r.failed).toBe(1);
		expect(rel.otherFormsOf(manga, false)).toHaveLength(1);
	});

	it('draws nothing for a relink until the pass has asked, and asks for the new entry', async () => {
		fresh();
		const manga = comic('Ranma Relink', 'manga', 30023, 'MANGA');
		await pass();
		cat.link(manga, entry(777, 'MANGA'), 'review', NOW);
		expect(rel.otherFormsOf(manga, false)).toBeNull();
		WORLD.set(777, { ...node(777, 'MANGA', 'MANGA'), relations: { edges: [] } });
		asks.length = 0;
		await pass();
		expect(asks).toHaveLength(1);
	});

	it('leaves a comic’s row when the anime prune runs, and drops it after UNLINK', async () => {
		fresh();
		const manga = comic('Ranma Pruned', 'manga', 30023, 'MANGA');
		await pass();
		await pass();
		const row = () => db.prepare(`SELECT 1 FROM series_relations WHERE series_id = ?`).get(manga);
		expect(row()).toBeDefined();
		cat.unlink(manga, NOW);
		await pass();
		expect(row()).toBeUndefined();
	});

	it('gives a comic’s turn apart from an anime’s, so neither limit starves the other', async () => {
		fresh();
		const a = anime('Limited Anime', 178533);
		const m = comic('Limited Comic', 'manga', 30023, 'MANGA');
		await rel.refreshRelations(ask, { now: NOW, limit: 1 });
		const has = (id: number) =>
			db.prepare(`SELECT graph FROM series_relations WHERE series_id = ?`).get(id);
		expect(has(a)).toBeDefined();
		expect(has(m)).toBeDefined();
	});
});

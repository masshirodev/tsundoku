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
/** Every id asked, in order: `asks` says how many requests, this says for what. */
const asked: number[] = [];
const aliases = (query: string) => [
	...query.matchAll(/m(\d+):\s*Media\(id:\s*\$i(\d+),\s*type:\s*(\w+)\)/g)
];
/** The entry AniList holds under that id in that catalogue: a manga is no `type: ANIME`. */
const held = (id: number, type: string) => {
	const m = WORLD.get(id) as { type: string } | undefined;
	return m?.type === type ? m : null;
};
/**
 * Answers as AniList does, measured on 2026-11-08 by posting two aliases to
 * https://graphql.anilist.co, a good id with one AniList doesn't have (and
 * again with a manga's id under `type: ANIME`): HTTP 404,
 * `{"errors":[{"message":"Not Found.","status":404,…}],"data":{"m0":null,"m1":null}}`.
 * One id it can't answer nulls **every** alias of the request, the good ones
 * too, in either order. `post` in catalogue.ts hands that over as an answer.
 */
const ask = async (query: string, vars: Record<string, unknown>) => {
	asks.push(query);
	const wanted = aliases(query).map((m) => ({
		alias: `m${m[1]}`,
		id: Number(vars[`i${m[2]}`]),
		type: m[3]
	}));
	asked.push(...wanted.map((w) => w.id));
	const voided = wanted.some((w) => !held(w.id, w.type));
	return Object.fromEntries(wanted.map((w) => [w.alias, voided ? null : held(w.id, w.type)]));
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
/** An id is linked as a TV entry; `[id, format]` says what the link stored. */
const anime = (t: string, ...ids: (number | [number, string])[]) => {
	const id = series(t, 'anime');
	ids.forEach((link, i) => {
		const [a, format] = typeof link === 'number' ? [link, 'TV'] : link;
		db.prepare(
			`INSERT INTO entries (series_id, position, label, added_at, source_url, season, episode_number)
			VALUES (?, ?, 'Ep.', ?, ?, ?, 1)`
		).run(id, i + 1, NOW, `/f/${id}/${i}`, i + 1);
		expect(seasons.linkSeason(id, i + 1, 1, entry(a, format), 'review', NOW)).toBe(true);
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
	heard();
};
/** Forget what was asked, so a case's assertion is about the pass after it. */
const heard = () => {
	asks.length = 0;
	asked.length = 0;
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

describe('a middle season AniList answers nothing for (c700, round 2)', () => {
	/**
	 * Its own world per case, so a case that kills an entry kills nobody
	 * else's: P <- FIRST (manga source), MIDDLE, LAST (novel adaptation) -> NEXT.
	 * MIDDLE is in no chain and in no one's edges: deleted on AniList, or some
	 * other catalogue's. It is not in the world until a case puts it there.
	 */
	let block = 910_000;
	const gap = () => {
		block += 100;
		const ids = {
			before: block,
			first: block + 1,
			middle: block + 2,
			last: block + 3,
			next: block + 4,
			manga: block + 11,
			novel: block + 13,
			middleForm: block + 12
		};
		WORLD.set(ids.before, {
			...node(ids.before, 'ANIME', 'TV', { year: 1999 }),
			relations: { edges: [] }
		});
		WORLD.set(ids.first, {
			...node(ids.first, 'ANIME', 'TV', { year: 2000 }),
			relations: {
				edges: [
					{ relationType: 'PREQUEL', node: node(ids.before, 'ANIME', 'TV', { year: 1999 }) },
					{ relationType: 'SOURCE', node: node(ids.manga, 'MANGA', 'MANGA', { year: 1990 }) }
				]
			}
		});
		WORLD.set(ids.last, {
			...node(ids.last, 'ANIME', 'TV', { year: 2004 }),
			relations: {
				edges: [
					{ relationType: 'SEQUEL', node: node(ids.next, 'ANIME', 'TV', { year: 2006 }) },
					{ relationType: 'ADAPTATION', node: node(ids.novel, 'MANGA', 'NOVEL', { year: 2001 }) }
				]
			}
		});
		return ids;
	};
	const middleAnswers = (g: ReturnType<typeof gap>) =>
		WORLD.set(g.middle, {
			...node(g.middle, 'ANIME', 'TV', { year: 2002 }),
			relations: {
				edges: [
					{ relationType: 'ADAPTATION', node: node(g.middleForm, 'MANGA', 'MANGA', { year: 2002 }) }
				]
			}
		});
	const forms = (show: number) => rel.otherFormsOf(show, false)?.map((f) => f.anilistId);
	const stored = (show: number) =>
		db
			.prepare(`SELECT graph, fetched_at, tried_at FROM series_relations WHERE series_id = ?`)
			.get(show) as
			{ graph: string | null; fetched_at: number | null; tried_at: number } | undefined;
	const LATER = NOW + rel.RELATIONS_STALE_MS;
	const passAt = (now: number) => rel.refreshRelations(ask, { now, limit: 50 });

	it('stores the graph from what answered: the seasons around as without it, both forms', async () => {
		const g = gap();
		fresh();
		const without = anime('Gap Show', g.first, g.last);
		await pass();
		const around = rel.seasonsAroundOf(without, false);
		expect(around?.before.map((h) => h.key)).toEqual([g.before]);
		expect(around?.next!.key).toBe(g.next);

		fresh();
		const show = anime('Gap Show', g.first, g.middle, g.last);
		expect(await pass()).toMatchObject({ refreshed: 1, failed: 0 });
		expect(stored(show)?.graph).not.toBeNull();
		expect(rel.seasonsAroundOf(show, false)).toEqual(around);
		expect(forms(show)).toEqual([g.manga, g.novel]);
	});

	it('asks nothing on a second pass at the same moment, and calls the series fresh', async () => {
		const g = gap();
		fresh();
		const show = anime('Gap Twice', g.first, g.middle, g.last);
		await pass();
		heard();
		expect(await pass()).toMatchObject({ refreshed: 0, failed: 0 });
		expect(asks).toEqual([]);
		expect(rel.relationsStale(show, NOW)).toBe(false);
	});

	it('survives the JSON round trip: what ends the wait is in the stored graph', async () => {
		const g = gap();
		fresh();
		const show = anime('Gap Stored', g.first, g.middle, g.last);
		await pass();
		expect(JSON.parse(stored(show)!.graph!).unanswered).toEqual([g.middle]);
	});

	it('waits out the seven days to the millisecond, then asks again', async () => {
		const g = gap();
		fresh();
		const show = anime('Gap Week', g.first, g.middle, g.last);
		await pass();
		expect(rel.relationsStale(show, LATER - 1)).toBe(false);
		heard();
		await passAt(LATER - 1);
		expect(asks).toEqual([]);

		expect(rel.relationsStale(show, LATER)).toBe(true);
		expect(await passAt(LATER)).toMatchObject({ refreshed: 1, failed: 0 });
		expect(asked).toContain(g.middle);
		expect(stored(show)?.fetched_at).toBe(LATER);
		// Still answering nothing: the record starts another seven days.
		heard();
		await passAt(LATER);
		expect(asks).toEqual([]);
	});

	it('reads the season once it answers again, at the refresh after the seven days', async () => {
		const g = gap();
		fresh();
		const show = anime('Gap Returns', g.first, g.middle, g.last);
		await pass();
		middleAnswers(g);
		// Answering again ends nothing by itself: it waits, like any graph.
		heard();
		await pass();
		expect(asks).toEqual([]);
		expect(forms(show)).not.toContain(g.middleForm);

		await passAt(LATER);
		expect(forms(show)).toEqual(expect.arrayContaining([g.manga, g.novel, g.middleForm]));
		expect(JSON.parse(stored(show)!.graph!).unanswered).toBeUndefined();
		expect(rel.relationsStale(show, LATER)).toBe(false);
	});

	it('does not ask for a middle season whose stored format is another kind’s', async () => {
		const g = gap();
		fresh();
		WORLD.set(g.middle, { ...node(g.middle, 'MANGA', 'MANGA'), relations: { edges: [] } });
		const show = anime('Gap Manga Link', g.first, [g.middle, 'MANGA'], g.last);
		expect(await pass()).toMatchObject({ refreshed: 1, failed: 0 });
		expect(asked).not.toContain(g.middle);
		// One request and the walk's one step back: nothing voided, nothing re-asked.
		expect(asks).toHaveLength(2);
		expect(forms(show)).toEqual([g.manga, g.novel]);
		expect(rel.relationsStale(show, NOW)).toBe(false);
	});

	it('tolerates a middle season that is a manga when the link stored no format', async () => {
		const g = gap();
		fresh();
		WORLD.set(g.middle, { ...node(g.middle, 'MANGA', 'MANGA'), relations: { edges: [] } });
		const show = anime('Gap Unknown Format', g.first, [g.middle, ''], g.last);
		expect(await pass()).toMatchObject({ refreshed: 1, failed: 0 });
		expect(asked).toContain(g.middle);
		expect(JSON.parse(stored(show)!.graph!).unanswered).toEqual([g.middle]);
		expect(rel.seasonsAroundOf(show, false)?.next!.key).toBe(g.next);
	});

	it('keeps every answer when two middle seasons are dead', async () => {
		const g = gap();
		fresh();
		const other = g.middle + 50;
		const show = anime('Gap Two Dead', g.first, g.middle, other, g.last);
		expect(await pass()).toMatchObject({ refreshed: 1, failed: 0 });
		expect(JSON.parse(stored(show)!.graph!).unanswered).toEqual([g.middle, other]);
		expect(forms(show)).toEqual([g.manga, g.novel]);
	});

	it('still stores every answer when AniList names some and not others', async () => {
		const g = gap();
		fresh();
		const show = anime('Gap Partial', g.first, g.middle, g.last);
		// Not what AniList does today (see `ask`), but what the code must survive.
		const partial = async (query: string, vars: Record<string, unknown>) =>
			Object.fromEntries(
				aliases(query).map((m) => [`m${m[1]}`, held(Number(vars[`i${m[2]}`]), m[3])])
			);
		expect(await rel.refreshRelations(partial, { now: NOW, limit: 50 })).toMatchObject({
			refreshed: 1,
			failed: 0
		});
		expect(JSON.parse(stored(show)!.graph!).unanswered).toEqual([g.middle]);
	});

	it('walks through the real door: AniList’s own 404 reaches the pass as an answer', async () => {
		const g = gap();
		fresh();
		const show = anime('Gap Wired', g.first, g.middle, g.last);
		cat.setAnilistFetch(async (_url, init) => {
			const { query, variables } = JSON.parse(String(init?.body));
			const wanted = aliases(query);
			const dead = wanted.some((m) => !held(Number(variables[`i${m[2]}`]), m[3]));
			const data = Object.fromEntries(
				wanted.map((m) => [`m${m[1]}`, dead ? null : held(Number(variables[`i${m[2]}`]), m[3])])
			);
			return new Response(
				JSON.stringify(
					dead ? { errors: [{ message: 'Not Found.', status: 404 }], data } : { data }
				),
				{ status: dead ? 404 : 200, headers: { 'content-type': 'application/json' } }
			);
		}, 0);
		try {
			const r = await rel.refreshRelations(cat.anilistPublic, { now: NOW, limit: 50 });
			expect(r).toMatchObject({ refreshed: 1, failed: 0 });
			expect(forms(show)).toEqual([g.manga, g.novel]);
		} finally {
			cat.setAnilistFetch(null);
		}
	});

	it.each(['first', 'last'] as const)(
		'still fails when the %s season answers nothing, and keeps the old graph',
		async (which) => {
			const g = gap();
			fresh();
			const show = anime(`Gap Lost ${which}`, g.first, g.middle, g.last);
			await pass();
			const before = stored(show);
			WORLD.delete(g[which]);
			expect(await passAt(LATER)).toMatchObject({ refreshed: 0, failed: 1 });
			expect(stored(show)).toMatchObject({
				graph: before!.graph,
				fetched_at: before!.fetched_at,
				tried_at: LATER
			});
			// Still due, as at the base: a graph it can't refresh is not a fresh one.
			expect(rel.relationsStale(show, LATER)).toBe(true);
		}
	);

	it('fails, without going round, when the walk itself has to stand on a dead one', async () => {
		const g = gap();
		fresh();
		// Linked out of order: season 2 is on `first`'s own chain, so the walk
		// back stands on it. That makes it a need, and a need can't be skipped.
		WORLD.set(g.first, {
			...node(g.first, 'ANIME', 'TV', { year: 2000 }),
			relations: {
				edges: [{ relationType: 'PREQUEL', node: node(g.middle, 'ANIME', 'TV', { year: 1999 }) }]
			}
		});
		const show = anime('Gap On The Walk', g.first, g.middle, g.last);
		expect(await pass()).toMatchObject({ refreshed: 0, failed: 1 });
		expect(stored(show)?.graph).toBeNull();
		// The request, each of the three alone, and the walk's one ask for it.
		expect(asks).toHaveLength(5);
	});

	it('stores nothing for a series never cached whose first season is dead', async () => {
		const g = gap();
		fresh();
		WORLD.delete(g.first);
		const show = anime('Gap Never', g.first, g.middle, g.last);
		expect(await pass()).toMatchObject({ refreshed: 0, failed: 1 });
		expect(stored(show)?.graph).toBeNull();
		expect(forms(show)).toBeUndefined();
		// A required season failing stops the re-asking there.
		expect(asks).toHaveLength(2);
	});

	it('asks at the next pass when the middle season is relinked to a good entry', async () => {
		const g = gap();
		fresh();
		const show = anime('Gap Relink', g.first, g.middle, g.last);
		await pass();
		const good = g.middle + 60;
		WORLD.set(good, {
			...node(good, 'ANIME', 'TV', { year: 2002 }),
			relations: {
				edges: [
					{ relationType: 'ADAPTATION', node: node(g.middleForm, 'MANGA', 'MANGA', { year: 2002 }) }
				]
			}
		});
		expect(seasons.linkSeason(show, 2, 1, entry(good, 'TV'), 'review', NOW)).toBe(true);
		expect(rel.relationsStale(show, NOW)).toBe(true);
		heard();
		expect(await pass()).toMatchObject({ refreshed: 1, failed: 0 });
		expect(asked).toContain(good);
		expect(forms(show)).toContain(g.middleForm);
		expect(JSON.parse(stored(show)!.graph!).unanswered).toBeUndefined();
	});

	it('asks at the next pass when it is relinked to another dead entry, and waits on that', async () => {
		const g = gap();
		fresh();
		const show = anime('Gap Relink Dead', g.first, g.middle, g.last);
		await pass();
		const dead = g.middle + 70;
		expect(seasons.linkSeason(show, 2, 1, entry(dead, 'TV'), 'review', NOW)).toBe(true);
		expect(rel.relationsStale(show, NOW)).toBe(true);
		await pass();
		expect(JSON.parse(stored(show)!.graph!).unanswered).toEqual([dead]);
		heard();
		await pass();
		expect(asks).toEqual([]);
	});
});

describe('one comic AniList answers nothing for (c700, round 2)', () => {
	const alive = (id: number) =>
		WORLD.set(id, {
			...node(id, 'MANGA', 'MANGA'),
			relations: {
				edges: [{ relationType: 'ADAPTATION', node: node(id + 1, 'ANIME', 'TV', { year: 2001 }) }]
			}
		});

	it('does not cost the rest of its request their answers', async () => {
		fresh();
		alive(920_001);
		alive(920_003);
		const a = comic('Comic Alive A', 'manga', 920_001, 'MANGA');
		comic('Comic Dead', 'manga', 920_002, 'MANGA');
		const b = comic('Comic Alive B', 'manga', 920_003, 'MANGA');
		expect(await pass()).toMatchObject({ refreshed: 2, failed: 1 });
		expect(rel.otherFormsOf(a, false)?.map((f) => f.anilistId)).toEqual([920_002]);
		expect(rel.otherFormsOf(b, false)?.map((f) => f.anilistId)).toEqual([920_004]);
	});
});

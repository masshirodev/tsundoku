import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';

// Before anything imports db.ts: getDb() reads this once and memoises.
process.env.DATABASE_PATH = ':memory:';
process.env.RANOBE_TOKEN = 'rb_owner';
process.env.RANOBE_URL = 'https://ranobe.test/api/v1';

const { getDb } = await import('$lib/server/db');
const { runImport } = await import('$lib/server/import');
const { sampleEpub } = await import('$lib/server/pages/sample-epub');
const rb = await import('$lib/server/ranobe');
const rv = await import('$lib/server/ranobe-review');
const sg = await import('$lib/server/ranobe-suggest');

const NOW = Date.UTC(2026, 8, 27, 15);
const library = mkdtempSync(join(tmpdir(), 'tsundoku-suggest-'));
mkdirSync(join(library, 'Library'), { recursive: true });
const book = (file: string, title: string, creators: { name: string; role?: string }[]) =>
	writeFileSync(
		join(library, 'Library', file),
		sampleEpub({ title, hue: 230, chapters: ['Chapter 1', 'Chapter 2'], creators })
	);
book('TBATE - Book 5.epub', 'The Beginning After the End: Book 5: Convergence', [
	{ name: 'TurtleMe', role: 'aut' }
]);
book('TBATE - Book 6.epub', 'The Beginning After the End: Book 6: Transcendence', [
	{ name: 'TurtleMe', role: 'aut' }
]);
book('TBATE - Book 7.epub', 'The Beginning After the End: Book 7: Divergence', [
	{ name: 'TurtleMe', role: 'aut' }
]);
book('SSS.epub', 'SSS-Class Suicide Hunter Novel', [{ name: 'To be implemented' }]);
book('ORV.epub', "Omniscient Reader's Viewpoint", [{ name: 'Sing-shong (싱숑)' }]);
await runImport(library);

const db = getDb();
const idOf = (title: string) =>
	(db.prepare(`SELECT id FROM series WHERE title = ?`).get(title) as { id: number }).id;
const B5 = idOf('The Beginning After the End: Book 5: Convergence');
const B6 = idOf('The Beginning After the End: Book 6: Transcendence');
const B7 = idOf('The Beginning After the End: Book 7: Divergence');
const SSS = idOf('SSS-Class Suicide Hunter Novel');
const ORV = idOf("Omniscient Reader's Viewpoint");

// ---- Ranobe, faked --------------------------------------------------------------------------

type Call = { method: string; path: string; body: unknown; auth: string | null };
let calls: Call[] = [];
const bundles = new Map<number, { status: string; work: string }>();
let nextBundle = 7;
/** Works Ranobe has, by the title a search finds them under. */
let catalogue: Record<string, string> = {};
const json = (d: unknown, status = 200) =>
	new Response(JSON.stringify(d), { status, headers: { 'content-type': 'application/json' } });
rb.setRanobeFetch(async (input, init) => {
	const url = new URL(String(input));
	const path = url.pathname.replace('/api/v1', '');
	const method = init?.method ?? 'GET';
	const body = init?.body ? JSON.parse(String(init.body)) : undefined;
	calls.push({ method, path, body, auth: new Headers(init?.headers).get('authorization') });
	if (path === '/lookup') return json({ results: {} });
	if (path === '/search') {
		const q = url.searchParams.get('q') ?? '';
		const ref = catalogue[q];
		return json({
			items: ref
				? [
						{
							ref,
							kind: { id: 'light_novel' },
							title: q,
							matched: q,
							status: 'unknown',
							years: '',
							cover: null,
							units: {}
						}
					]
				: [],
			nextCursor: null
		});
	}
	if (path === '/bundles' && method === 'POST') {
		const id = nextBundle++;
		bundles.set(id, { status: 'pending', work: `w${900 + id}` });
		return json({ bundle: id, status: 'pending', items: [] }, 201);
	}
	const b = path.match(/^\/bundles\/(\d+)(\/withdraw)?$/);
	if (b) {
		const x = bundles.get(Number(b[1]))!;
		if (b[2]) {
			x.status = 'withdrawn';
			return json({ bundle: Number(b[1]), status: 'withdrawn', items: [] });
		}
		return json({
			bundle: Number(b[1]),
			status: x.status,
			items: [
				{ key: 'author1', ref: 'p1', status: x.status },
				{ key: 'work', ref: x.work, status: x.status }
			]
		});
	}
	if (path === '/me/library') return json({ items: [], nextCursor: null });
	const work = path.match(/^\/works\/(w\d+)$/);
	if (work)
		return json({
			ref: work[1],
			title: 'The Beginning After the End',
			kind: { id: 'light_novel' },
			cover: null,
			editions: [{ ref: 'e1', lang: 'ja', origin: 'original', format: 'bunkobon', units: {} }]
		});
	return json({ error: { code: 'not_found' } }, 404);
});

beforeEach(() => {
	calls = [];
});

const posted = () => calls.filter((c) => c.path === '/bundles' && c.method === 'POST');
const inQueue = (id: number) => rv.ranobeQueue().some((i) => i.seriesId === id);

describe('without the app account’s token', () => {
	it('suggests nothing', async () => {
		await rb.syncRanobe(NOW);
		expect(inQueue(B5)).toBe(true);
		await expect(sg.suggestWork(B5, NOW)).rejects.toThrow(sg.CannotSuggest);
		expect(posted()).toHaveLength(0);
	});
});

describe('with it', () => {
	beforeEach(() => {
		process.env.RANOBE_SUGGEST_TOKEN = 'rb_app';
	});

	it('suggests the work and its author through the app account, never the owner’s token', async () => {
		const r = await sg.suggestWork(B5, NOW);
		expect(r).toEqual({ outcome: 'suggested', bundle: 7 });
		// Searched once more first, with the volume taken off.
		expect(calls[0].path).toBe('/search');
		const [post] = posted();
		expect(post.auth).toBe('Bearer rb_app');
		const body = post.body as {
			source: string;
			items: { key: string; type: string; snapshot: Record<string, unknown> }[];
		};
		expect(body.source).toBe('epub:TBATE - Book 5.epub');
		expect(body.items[0].snapshot).toMatchObject({ name: 'TurtleMe' });
		expect(body.items[1].snapshot).toMatchObject({
			kind: 'light_novel',
			titles: [{ title: 'The Beginning After the End', lang: 'en' }]
		});
		// Out of the review while it waits, and its screen says so.
		expect(inQueue(B5)).toBe(false);
		expect(rv.ranobeSeries(B5)?.facts.suggested).toBe(true);
		expect(rv.ranobeSeries(B5)?.unlinkedMeta).toBe(
			'SUGGESTED TO RANOBE · BUNDLE 7 · WAITS FOR YOUR REVIEW THERE'
		);
		expect(rv.ranobeAccount().suggested).toBe(1);
	});

	it('sends no author that isn’t one, and reads a Korean name for the original language', async () => {
		await sg.suggestWork(SSS, NOW);
		await sg.suggestWork(ORV, NOW);
		const [sss, orv] = posted().map(
			(p) => (p.body as { items: { type: string; snapshot: Record<string, unknown> }[] }).items
		);
		expect(sss.map((i) => i.type)).toEqual(['work']);
		expect(sss[0].snapshot).toMatchObject({ originalLang: 'und', kind: 'web_novel' });
		expect(orv[0].snapshot).toMatchObject({ name: '싱숑', latin: 'Sing-shong', lang: 'ko' });
		expect(orv[1].snapshot).toMatchObject({ originalLang: 'ko' });
	});

	it('a sibling volume joins the bundle waiting, rather than suggest the novel twice', async () => {
		expect(await sg.suggestWork(B7, NOW)).toEqual({ outcome: 'suggested', bundle: 7 });
		expect(posted()).toHaveLength(0);
		expect(inQueue(B7)).toBe(false);
		// Its UNDO leaves the bundle standing for Book 5: nothing is withdrawn on Ranobe.
		calls = [];
		expect(await sg.withdrawWork(B7)).toBe(true);
		expect(calls.some((c) => c.path.endsWith('/withdraw'))).toBe(false);
		expect(rv.ranobeSeries(B5)?.facts.suggested).toBe(true);
		await sg.suggestWork(B7, NOW);
	});

	it('UNDO withdraws the bundle, and the series comes back to the review', async () => {
		expect(await sg.withdrawWork(SSS)).toBe(true);
		const w = calls.find((c) => c.path.endsWith('/withdraw'));
		expect(w?.auth).toBe('Bearer rb_app');
		expect(inQueue(SSS)).toBe(true);
	});

	it('waits while it’s pending, then links on approval and searches the siblings again', async () => {
		let r = await rb.syncRanobe(NOW + 1);
		expect(r?.suggestions).toEqual({ approved: 0, waiting: 3 });
		bundles.get(7)!.status = 'approved';
		catalogue = { 'The Beginning After the End': 'w907' };
		r = await rb.syncRanobe(NOW + 2);
		// Book 5 and Book 7, which joined its bundle.
		expect(r?.suggestions.approved).toBe(2);
		expect(db.prepare(`SELECT work FROM ranobe_links WHERE series_id = ?`).get(B7)).toEqual({
			work: 'w907'
		});
		expect(db.prepare(`SELECT work, via FROM ranobe_links WHERE series_id = ?`).get(B5)).toEqual({
			work: 'w907',
			via: 'review'
		});
		// Book 6 was searched again in the same pass, and now has the new work.
		expect(rv.ranobeItem(B6)?.candidates.map((c) => c.work)).toEqual(['w907']);
	});

	it('settles a refused one as not on Ranobe', async () => {
		bundles.get(9)!.status = 'rejected';
		await rb.syncRanobe(NOW + 3);
		expect(
			db.prepare(`SELECT decision FROM ranobe_decisions WHERE series_id = ?`).get(ORV)
		).toEqual({ decision: 'none' });
		expect(inQueue(ORV)).toBe(false);
	});

	it('suggests nothing Ranobe has found since: the candidates come back instead', async () => {
		catalogue = { 'SSS-Class Suicide Hunter': 'w55' };
		expect(await sg.suggestWork(SSS, NOW + 4)).toEqual({ outcome: 'found', found: 1 });
		expect(posted()).toHaveLength(0);
		expect(rv.ranobeItem(SSS)?.candidates.map((c) => c.work)).toEqual(['w55']);
	});

	it('sends a missing edition through the app account too', async () => {
		db.prepare(`DELETE FROM ranobe_suggestions`).run();
		db.prepare(`UPDATE ranobe_links SET edition = NULL WHERE series_id = ?`).run(B5);
		await rb.resolveEditions(NOW + 5);
		const editions = posted().filter((p) =>
			(p.body as { items: { type: string }[] }).items.some((i) => i.type === 'edition')
		);
		// w907 has only its Japanese edition: the English one is suggested, and waits.
		expect(editions).toHaveLength(1);
		expect(editions[0].auth).toBe('Bearer rb_app');
	});
});

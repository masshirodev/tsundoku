import { beforeEach, describe, expect, it } from 'vitest';

// Before anything imports db.ts: getDb() reads this once and memoises.
process.env.DATABASE_PATH = ':memory:';
process.env.RANOBE_TOKEN = 'rb_test';
process.env.RANOBE_URL = 'https://ranobe.test/api/v1';

const { getDb } = await import('$lib/server/db');
const { seedSample } = await import('$lib/server/fixtures');
const { markEntries } = await import('$lib/server/series');
const rb = await import('$lib/server/ranobe');

const db = getDb();
const NOW = Date.UTC(2026, 8, 27);
seedSample(db, NOW);

const idOf = (title: string) =>
	(db.prepare(`SELECT id FROM series WHERE title = ?`).get(title) as { id: number }).id;
const MUSHOKU = idOf('Mushoku Tensei');
const HONZUKI = idOf('Honzuki no Gekokujou');
const VILLAINESS = idOf('Villainess Level 99');
const KEN = idOf('Tensei Shitara Ken Deshita');

// The catalogue links a novel would have from AniList (doc/LINKS.md).
const link = (seriesId: number, anilist: number, format = 'NOVEL') =>
	db
		.prepare(
			`INSERT INTO series_links (series_id, anilist_id, via, linked_at, format) VALUES (?, ?, 'exact', ?, ?)`
		)
		.run(seriesId, anilist, NOW, format);
link(MUSHOKU, 85470);
link(HONZUKI, 106591);
link(VILLAINESS, 555);
// A novel linked to its comic's entry: cover only, never asked about.
link(KEN, 777, 'MANGA');
db.prepare(`UPDATE series SET hidden = 1 WHERE id = ?`).run(VILLAINESS);

// ---- Ranobe, faked --------------------------------------------------------------------------

type Call = { method: string; path: string; body: unknown; auth: string | null };
let calls: Call[] = [];
/** The first pass's, which the tests after it read. */
let firstPass: Call[] = [];
let down = false;
let bundleStatus = 'pending';
let refuseUnit: string | null = null;
const library = new Map<string, { rev: number; rating: number | null; favourite: boolean }>();

const volumes = (edition: string, n: number) =>
	Array.from({ length: n }, (_, i) => ({
		ref: `${edition}:volume:${i + 1}`,
		type: 'volume',
		number: String(i + 1)
	}));
const WORKS: Record<string, { ref: string; title: string; editions: unknown[] }> = {
	w632: {
		ref: 'w632',
		title: 'Mushoku Tensei',
		editions: [{ ref: 'e417', lang: 'ja', origin: 'original', format: 'bunkobon', units: {} }]
	},
	w2: {
		ref: 'w2',
		title: 'Ascendance of a Bookworm',
		editions: [{ ref: 'e3', lang: 'en', origin: 'licensed', format: 'ebook', units: {} }]
	}
};
const UNITS: Record<string, unknown[]> = { e3: volumes('e3', 33), e900: volumes('e900', 26) };

const json = (d: unknown, status = 200) =>
	new Response(JSON.stringify(d), { status, headers: { 'content-type': 'application/json' } });
const error = (status: number, code: string, details: unknown = {}) =>
	json({ error: { code, message: code, details } }, status);

const fake: typeof fetch = async (input, init) => {
	if (down) throw new TypeError('fetch failed');
	const url = new URL(String(input));
	const path = url.pathname.replace('/api/v1', '');
	const method = init?.method ?? 'GET';
	const body = init?.body ? JSON.parse(String(init.body)) : undefined;
	calls.push({ method, path, body, auth: new Headers(init?.headers).get('authorization') });
	if (path === '/lookup') {
		const known: Record<string, string> = { 'anilist:85470': 'w632', 'anilist:106591': 'w2' };
		return json({
			results: Object.fromEntries(
				(body.keys as string[]).map((k) => [k, known[k] ? { ref: known[k] } : null])
			)
		});
	}
	const work = path.match(/^\/works\/(w\d+)$/);
	if (work) return WORKS[work[1]] ? json(WORKS[work[1]]) : error(404, 'not_found');
	const edition = path.match(/^\/editions\/(e\d+)$/);
	if (edition) return json({ ref: edition[1], units: UNITS[edition[1]] ?? [] });
	if (path === '/bundles' && method === 'POST')
		return json(
			{ bundle: 7, status: 'pending', items: [{ key: 'edition', ref: 'e900', status: 'pending' }] },
			201
		);
	if (path === '/bundles/7')
		return json({
			bundle: 7,
			status: bundleStatus,
			items: [{ key: 'edition', ref: 'e900', status: bundleStatus }]
		});
	if (path === '/me/reads' && method === 'POST') {
		const reads = body.reads as { unit: string }[];
		const bad = reads.findIndex((r) => r.unit === refuseUnit);
		if (bad >= 0)
			return error(400, 'invalid_field', {
				issues: [{ path: `reads.${bad}.unit`, message: 'no such unit' }]
			});
		return json({ recorded: reads.length, duplicates: 0, entries: [] });
	}
	if (path.startsWith('/me/reads/') && method === 'DELETE')
		return json({ removed: 1, progress: null });
	if (path === '/search') return json({ items: [], nextCursor: null });
	if (path === '/me/library')
		return json({
			items: [...library].map(([work, e]) => ({ work, ...e, status: 'reading' })),
			nextCursor: null
		});
	const entry = path.match(/^\/me\/library\/(w\d+)$/);
	if (entry) {
		const had = library.get(entry[1]);
		if (method === 'GET') return had ? json({ work: entry[1], ...had }) : error(404, 'not_found');
		if (had && body.rev !== had.rev) return error(409, 'stale_rev', { currentRev: had.rev });
		const next = {
			rev: (had?.rev ?? 0) + 1,
			rating: 'rating' in body ? body.rating : (had?.rating ?? null),
			favourite: 'favourite' in body ? body.favourite : (had?.favourite ?? false)
		};
		library.set(entry[1], next);
		return json({ work: entry[1], ...next });
	}
	return error(404, 'not_found');
};
rb.setRanobeFetch(fake);

beforeEach(() => {
	calls = [];
	down = false;
	refuseUnit = null;
});

const linkOf = (id: number) =>
	db.prepare(`SELECT * FROM ranobe_links WHERE series_id = ?`).get(id) as
		{ work: string; edition: string | null; lang: string; via: string; title: string } | undefined;
const unitsOf = (work: string) =>
	db
		.prepare(`SELECT unit, read_at, sent_at, error FROM ranobe_units WHERE work = ? ORDER BY unit`)
		.all(work) as {
		unit: string;
		read_at: number | null;
		sent_at: number | null;
		error: string | null;
	}[];
const sentReads = (from = calls) =>
	from
		.filter((c) => c.path === '/me/reads' && c.method === 'POST')
		.flatMap((c) => (c.body as { reads: { unit: string }[] }).reads.map((r) => r.unit));

describe('the pass', () => {
	it('links by id only what Ranobe may hear of', async () => {
		const r = await rb.syncRanobe(NOW);
		expect(r?.linked).toBe(2);
		expect(linkOf(MUSHOKU)).toMatchObject({ work: 'w632', lang: 'en', via: 'lookup' });
		expect(linkOf(HONZUKI)).toMatchObject({
			work: 'w2',
			edition: 'e3',
			title: 'Ascendance of a Bookworm'
		});
		// Hidden, and cover-only: never linked, and never even asked about.
		expect(linkOf(VILLAINESS)).toBeUndefined();
		expect(linkOf(KEN)).toBeUndefined();
		const keys = calls.find((c) => c.path === '/lookup')?.body as { keys: string[] };
		expect(keys.keys.sort()).toEqual(['anilist:106591', 'anilist:85470']);
		expect(calls.every((c) => c.auth === 'Bearer rb_test')).toBe(true);
		firstPass = calls;
	});

	it('sends what is read now as a backfill, a unit per volume read', async () => {
		// Honzuki: all 33 read, and e3 is English: sent in the first pass.
		const post = firstPass.find((c) => c.path === '/me/reads');
		expect(post?.body).toMatchObject({ backfill: true });
		expect(sentReads(firstPass)).toHaveLength(33);
		expect(sentReads(firstPass)[0]).toBe('e3:volume:1');
		expect(unitsOf('w2').every((u) => u.sent_at === NOW)).toBe(true);
	});

	it('suggests the English edition a work lacks, and waits for it', async () => {
		const bundle = firstPass.find((c) => c.path === '/bundles');
		const item = (bundle?.body as { items: { type: string; snapshot: Record<string, unknown> }[] })
			.items[0];
		expect(item.type).toBe('edition');
		expect(item.snapshot).toMatchObject({
			workId: 'w632',
			lang: 'en',
			origin: 'licensed',
			format: 'ebook'
		});
		expect(linkOf(MUSHOKU)?.edition).toBeNull();
		// Nothing of Mushoku is sent while the suggestion waits.
		expect(sentReads(firstPass).some((u) => u.startsWith('e900'))).toBe(false);

		await rb.syncRanobe(NOW);
		expect(calls.filter((c) => c.path === '/bundles' && c.method === 'POST')).toHaveLength(0);
		expect(calls.some((c) => c.path === '/bundles/7')).toBe(true);
		expect(linkOf(MUSHOKU)?.edition).toBeNull();
	});

	it('maps and sends once the suggestion is approved', async () => {
		bundleStatus = 'approved';
		await rb.syncRanobe(NOW);
		expect(linkOf(MUSHOKU)?.edition).toBe('e900');
		// Twelve of 26 read; only those go.
		expect(sentReads().filter((u) => u.startsWith('e900'))).toHaveLength(12);
		// Honzuki's were sent already: not again.
		expect(sentReads().some((u) => u.startsWith('e3:'))).toBe(false);
	});
});

describe('after reading', () => {
	const entriesOf = (id: number) =>
		db
			.prepare(`SELECT id FROM entries WHERE series_id = ? AND shadowed = 0 ORDER BY position`)
			.all(id) as {
			id: number;
		}[];
	const settle = () => rb.flush();

	it('takes back an unmark that tsundoku sent, and sends it again when read', async () => {
		const last = entriesOf(HONZUKI).at(-1)!.id;
		markEntries(HONZUKI, [last], false, NOW + 1);
		rb.afterReading(HONZUKI);
		await settle();
		expect(calls.find((c) => c.method === 'DELETE')?.path).toBe(
			`/me/reads/${encodeURIComponent('e3:volume:33')}`
		);
		expect(unitsOf('w2').find((u) => u.unit === 'e3:volume:33')?.sent_at).toBeNull();

		calls = [];
		markEntries(HONZUKI, [last], true, NOW + 2);
		rb.afterReading(HONZUKI);
		await settle();
		expect(sentReads()).toEqual(['e3:volume:33']);
		expect(calls.find((c) => c.path === '/me/reads')?.body).toMatchObject({ backfill: false });
	});

	it('keeps a read Ranobe refuses, with why, and sends the rest', async () => {
		const ids = entriesOf(MUSHOKU)
			.slice(12, 14)
			.map((e) => e.id);
		markEntries(MUSHOKU, ids, true, NOW + 3);
		refuseUnit = 'e900:volume:13';
		rb.afterReading(MUSHOKU);
		await settle();
		expect(sentReads()).toContain('e900:volume:14');
		const refused = unitsOf('w632').find((u) => u.unit === 'e900:volume:13');
		expect(refused).toMatchObject({ sent_at: null, error: 'RANOBE REFUSED IT' });
	});

	it('keeps what could not go when Ranobe is down, and sends it next time', async () => {
		const id = entriesOf(MUSHOKU)[14].id;
		markEntries(MUSHOKU, [id], true, NOW + 4);
		down = true;
		rb.afterReading(MUSHOKU);
		await settle();
		expect(unitsOf('w632').find((u) => u.unit === 'e900:volume:15')?.error).toBe(
			'RANOBE DID NOT ANSWER'
		);
		down = false;
		await settle();
		expect(unitsOf('w632').find((u) => u.unit === 'e900:volume:15')?.sent_at).not.toBeNull();
	});

	it('sends nothing for a series hidden since, and takes nothing back either', async () => {
		db.prepare(`UPDATE series SET hidden = 1 WHERE id = ?`).run(MUSHOKU);
		const id = entriesOf(MUSHOKU)[0].id;
		markEntries(MUSHOKU, [id], false, NOW + 5);
		rb.afterReading(MUSHOKU);
		await settle();
		await rb.syncRanobe(NOW + 5);
		expect(calls.filter((c) => c.path.startsWith('/me/reads'))).toHaveLength(0);
		expect(calls.some((c) => c.path === '/bundles' || c.path.startsWith('/works/w632'))).toBe(
			false
		);
		db.prepare(`UPDATE series SET hidden = 0 WHERE id = ?`).run(MUSHOKU);
	});
});

describe('rating and favourite', () => {
	it("sets the work's rating with the rev it has, once more on a stale one", async () => {
		rb.afterRating([HONZUKI], 9);
		await rb.flush();
		expect(library.get('w2')).toMatchObject({ rating: 9 });
		const put = calls.find((c) => c.method === 'PUT');
		expect(put?.body).toMatchObject({ rating: 9 });

		// Moved on the site since: the stale rev is retried with the current one.
		library.set('w2', { ...library.get('w2')!, rev: 40 });
		const realGet = fake;
		rb.setRanobeFetch(async (input, init) => {
			// The read answers an older rev than the entry has.
			if ((init?.method ?? 'GET') === 'GET' && String(input).endsWith('/me/library/w2'))
				return json({ work: 'w2', rev: 39 });
			return realGet(input, init);
		});
		rb.afterFavourite([HONZUKI], true);
		await rb.flush();
		rb.setRanobeFetch(fake);
		expect(library.get('w2')).toMatchObject({ favourite: true, rating: 9, rev: 41 });
	});

	it('clears the rating for unrated, and says nothing for a series not linked', async () => {
		rb.afterRating([HONZUKI, KEN], 0);
		await rb.flush();
		expect(calls.filter((c) => c.method === 'PUT')).toHaveLength(1);
		expect(library.get('w2')?.rating).toBeNull();
	});
});

describe('without a token', () => {
	it('does nothing at all', async () => {
		process.env.RANOBE_TOKEN = '';
		expect(await rb.syncRanobe(NOW)).toBeNull();
		rb.afterRating([HONZUKI], 5);
		rb.afterReading(HONZUKI);
		await rb.flush();
		expect(calls).toHaveLength(0);
		process.env.RANOBE_TOKEN = 'rb_test';
	});
});

import { describe, expect, it } from 'vitest';

// Before anything imports db.ts: getDb() reads this once and memoises.
process.env.DATABASE_PATH = ':memory:';
process.env.KUMIKO_URL = 'https://kumiko.test';
process.env.KUMIKO_TOKEN = 'test-token';
process.env.KUMIKO_DECK = 'fdk_test';

const { getDb } = await import('$lib/server/db');
const { seedSample } = await import('$lib/server/fixtures');
const mining = await import('$lib/server/japanese/mining');

const db = getDb();
seedSample(db, Date.UTC(2026, 8, 24));
const seriesOf = (title: string) =>
	(db.prepare(`SELECT id FROM series WHERE title = ?`).get(title) as { id: number }).id;
const visible = seriesOf('Chainsaw Man');
const hidden = (
	db
		.prepare(
			`SELECT s.id FROM series s JOIN roots r ON r.id = s.root_id WHERE r.hidden = 1 LIMIT 1`
		)
		.get() as { id: number }
).id;
const day = Date.UTC(2026, 8, 24, 12);
const look = (series: number, lemma: string, surface: string, at: number, sentence = '') =>
	mining.logLookup(
		{
			seriesId: series,
			entryId: null,
			place: 'P. 14',
			lemma,
			surface,
			reading: null,
			pos: '名詞',
			sentence: sentence || `この${surface}を見た。`
		},
		true,
		at
	);

/** A Kumiko that answers with a note id, or refuses from the `failFrom`th card on. */
function fakeKumiko(failFrom = Infinity) {
	const sent: { url: string; body: Record<string, unknown>; auth: string }[] = [];
	const fetcher = (async (url: string, init: RequestInit) => {
		if (sent.length >= failFrom) return new Response('down', { status: 503 });
		sent.push({
			url,
			body: JSON.parse(String(init.body)),
			auth: String((init.headers as Record<string, string>).authorization)
		});
		return Response.json({ note: { id: `note-${sent.length}` } });
	}) as unknown as typeof fetch;
	return { sent, fetcher };
}

describe('mining', () => {
	it('logs lookups only in a series the viewer can see', () => {
		expect(
			mining.logLookup(
				{
					seriesId: hidden,
					entryId: null,
					place: '',
					lemma: '夕立',
					surface: '夕立',
					reading: null,
					pos: '名詞',
					sentence: ''
				},
				false
			)
		).toBe(false);
		expect(look(visible, '描く', '描いた', day, 'この絵、本当に君が描いたのか？')).toBe(true);
		look(visible, '描く', '描いた', day + 60_000, 'この絵、本当に君が描いたのか？');
		look(visible, '東門', '東門', day + 120_000, '明後日の十時に、東門へ。');
		look(visible, 'は', 'は', day + 180_000);
		look(hidden, '夕立', '夕立', day + 240_000);
	});

	it('offers what was looked up, newest first, without particles, hidden only with reveal', () => {
		const shown = mining.candidates(false);
		expect(shown.map((c) => c.lemma)).toEqual(['東門', '描く']);
		const drew = shown[1];
		expect(drew).toMatchObject({
			surface: '描いた',
			before: 'この絵、本当に君が',
			word: '描いた',
			after: 'のか？',
			lookups: 2,
			where: 'P. 14',
			pending: false
		});
		expect(mining.candidates(true).map((c) => c.lemma)).toContain('夕立');
		expect(mining.candidates(true).find((c) => c.lemma === '夕立')?.series.hidden).toBe(true);
	});

	it('sends only what was approved, records what was rejected, and offers neither again', async () => {
		const k = fakeKumiko();
		const r = await mining.decide({ approve: ['描く'], reject: ['東門'] }, k.fetcher);
		expect(r).toEqual({ sent: 1, failed: 0, rejected: 1, setUp: true });
		expect(k.sent).toHaveLength(1);
		expect(k.sent[0].url).toBe('https://kumiko.test/api/flashcards/notes');
		expect(k.sent[0].auth).toBe('Bearer test-token');
		expect(k.sent[0].body).toMatchObject({ front: '描く', noteType: 'basic', deckId: 'fdk_test' });
		expect(String(k.sent[0].body.tags)).toMatch(/^tsundoku,chainsaw-man$/);
		expect(String(k.sent[0].body.back)).toContain('この絵、本当に君が描いたのか？');
		expect(mining.candidates(false).map((c) => c.lemma)).toEqual([]);
		expect(mining.sentCount()).toBe(1);
		// Looked up again later: still decided, not offered again.
		look(visible, '描く', '描く', day + 999_000);
		expect(mining.candidates(false)).toEqual([]);
	});

	it('keeps approvals Kumiko didn’t take, and RETRY sends them', async () => {
		look(visible, '等身大', '等身大', day + 1_000_000);
		look(visible, '所望', '所望', day + 1_100_000);
		const down = fakeKumiko(0);
		const r = await mining.decide({ approve: ['等身大', '所望'], reject: [] }, down.fetcher);
		expect(r).toMatchObject({ sent: 0, failed: 2 });
		expect(
			mining
				.candidates(false)
				.filter((c) => c.pending)
				.map((c) => c.lemma)
				.sort()
		).toEqual(['所望', '等身大'].sort());
		const up = fakeKumiko();
		expect(await mining.flushPending(up.fetcher)).toMatchObject({ sent: 2, failed: 0 });
		expect(mining.candidates(false)).toEqual([]);
		expect(mining.sentCount()).toBe(3);
	});

	it('sends nothing, and keeps the approvals, until Kumiko is set up', async () => {
		look(visible, '執事', '執事', day + 2_000_000);
		const token = process.env.KUMIKO_TOKEN;
		delete process.env.KUMIKO_TOKEN;
		const k = fakeKumiko();
		expect(await mining.decide({ approve: ['執事'], reject: [] }, k.fetcher)).toMatchObject({
			sent: 0,
			setUp: false
		});
		expect(k.sent).toHaveLength(0);
		process.env.KUMIKO_TOKEN = token;
		expect(mining.candidates(false).find((c) => c.lemma === '執事')?.pending).toBe(true);
	});
});

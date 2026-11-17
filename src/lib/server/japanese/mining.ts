import { composeCard, furigana, rankCandidates, type LookupRecord } from 'kotoba';
import { getDb } from '../db.ts';
import { VISIBLE_SQL } from '../visibility.ts';
import { lookupJmdict } from './dict.ts';

/**
 * Mining (doc/JAPANESE.md): every lookup is logged; looked-up words become
 * candidates; a candidate becomes a card in Kumiko (a flashcard app, over its
 * HTTP API) only when approved, in a
 * batch. Nothing is ever sent without approval: auto-mining floods a deck.
 *
 * kotoba decides what's worth a card (`isMineable`, through `rankCandidates`);
 * the review lists what's left newest first.
 */

export type LookupIn = {
	seriesId: number;
	entryId: number | null;
	/** Where in the entry: "P. 14" on a page, "¶ 3" in a book. */
	place: string;
	lemma: string;
	surface: string;
	reading: string | null;
	pos: string;
	/** The block's or paragraph's text: what goes on the card. */
	sentence: string;
};

/**
 * Log a lookup. Only in a series the viewer can see now (hidden ones with
 * reveal on). Incognito never reaches here: the route refuses.
 */
export function logLookup(l: LookupIn, reveal: boolean, now = Date.now()): boolean {
	const db = getDb();
	const seen = db
		.prepare(
			`SELECT 1 FROM series s JOIN roots r ON r.id = s.root_id WHERE s.id = ? AND (? OR ${VISIBLE_SQL})`
		)
		.get(l.seriesId, reveal ? 1 : 0);
	if (!seen || !l.lemma) return false;
	db.prepare(
		`INSERT INTO lookups (at, series_id, entry_id, place, lemma, surface, reading, pos, sentence)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
	).run(
		now,
		l.seriesId,
		l.entryId,
		l.place.slice(0, 40),
		l.lemma.slice(0, 80),
		l.surface.slice(0, 80),
		l.reading?.slice(0, 80) ?? null,
		l.pos.slice(0, 40),
		l.sentence.slice(0, 400)
	);
	return true;
}

/** A local day, as a number: a reading "session" for ranking, an evening's reading. */
const dayOf = (at: number) => {
	const d = new Date(at);
	return d.getFullYear() * 10000 + (d.getMonth() + 1) * 100 + d.getDate();
};

export type Candidate = {
	lemma: string;
	surface: string;
	reading: string | null;
	/** The first sense's meanings, for the row. */
	meaning: string;
	/** The sentence it was last met in, split around the word as written there. */
	before: string;
	word: string;
	after: string;
	series: { id: number; title: string; hidden: boolean };
	/** "CH. 41 · P. 14" */
	where: string;
	lookups: number;
	lastAt: number;
	/** Approved, not in Kumiko yet: Kumiko didn't answer. */
	pending: boolean;
};

type Row = {
	id: number;
	at: number;
	series_id: number;
	lemma: string;
	surface: string;
	reading: string | null;
	pos: string;
	sentence: string;
	place: string;
	title: string;
	hidden: number;
	label: string | null;
	status: string | null;
};

/**
 * What's waiting for review: words looked up and not yet sent or rejected,
 * newest first. Hidden series' words only with reveal on.
 */
export function candidates(reveal: boolean): Candidate[] {
	const db = getDb();
	const rows = db
		.prepare(
			`SELECT l.id, l.at, l.series_id, l.lemma, l.surface, l.reading, l.pos, l.sentence, l.place,
				s.title, (s.hidden = 1 OR r.hidden = 1) AS hidden, e.label, m.status
			FROM lookups l
			JOIN series s ON s.id = l.series_id JOIN roots r ON r.id = s.root_id
			LEFT JOIN entries e ON e.id = l.entry_id
			LEFT JOIN mined m ON m.lemma = l.lemma
			WHERE (m.status IS NULL OR m.status = 'pending') AND (? OR ${VISIBLE_SQL})
			ORDER BY l.at`
		)
		.all(reveal ? 1 : 0) as Row[];
	const byId = new Map(rows.map((r) => [r.id, r]));
	const records: LookupRecord[] = rows.map((r) => ({
		lemma: r.lemma,
		surface: r.surface,
		pos: r.pos,
		sessionId: dayOf(r.at),
		at: r.at,
		lineId: r.id
	}));
	return rankCandidates(records)
		.map((c): Candidate => {
			const r = byId.get(c.lineId!)!;
			const at = r.sentence.indexOf(r.surface);
			const entry = lookupJmdict({
				lemma: r.lemma,
				surface: r.surface,
				reading: r.reading ?? undefined
			})[0];
			return {
				lemma: c.lemma,
				surface: r.surface,
				reading: r.reading ?? entry?.kana[0] ?? null,
				meaning: entry?.senses[0]?.gloss.slice(0, 3).join('; ') ?? '',
				before: at >= 0 ? r.sentence.slice(0, at) : r.sentence,
				word: at >= 0 ? r.surface : '',
				after: at >= 0 ? r.sentence.slice(at + r.surface.length) : '',
				series: { id: r.series_id, title: r.title, hidden: r.hidden === 1 },
				where: [r.label?.toUpperCase(), r.place].filter(Boolean).join(' · '),
				lookups: c.lookups,
				lastAt: c.lastAt,
				pending: r.status === 'pending'
			};
		})
		.sort((a, b) => b.lastAt - a.lastAt);
}

/** How many words have gone to Kumiko: "31 SENT SO FAR". */
export function sentCount(): number {
	return (
		getDb().prepare(`SELECT COUNT(*) AS n FROM mined WHERE status = 'sent'`).get() as { n: number }
	).n;
}

// ---- Kumiko -----------------------------------------------------------------------

type Kumiko = { url: string; token: string; deck: string };

/** Where approved words go: a deck in Kumiko (doc/JAPANESE.md). Null until set up. */
export function kumiko(): Kumiko | null {
	const token = process.env.KUMIKO_TOKEN;
	const deck = process.env.KUMIKO_DECK;
	if (!token || !deck) return null;
	return { url: (process.env.KUMIKO_URL ?? 'https://kumiko.ink').replace(/\/$/, ''), token, deck };
}

/** One card (kotoba's composeCard), tagged as tsundoku's. */
function cardFor(lemma: string) {
	const db = getDb();
	const last = db
		.prepare(
			`SELECT l.surface, l.reading, l.sentence, s.title FROM lookups l JOIN series s ON s.id = l.series_id
			WHERE l.lemma = ? ORDER BY l.at DESC LIMIT 1`
		)
		.get(lemma) as
		{ surface: string; reading: string | null; sentence: string; title: string } | undefined;
	const entry = lookupJmdict({
		lemma,
		surface: last?.surface,
		reading: last?.reading ?? undefined
	})[0];
	const reading = last?.reading ?? entry?.kana[0] ?? null;
	return composeCard({
		lemma,
		reading,
		wordSegments: furigana(lemma, reading),
		glosses: entry?.senses.flatMap((s) => s.gloss) ?? [],
		speaker: null,
		annotatedSentence: last?.sentence || null,
		sentenceTranslation: null,
		enrichment: null,
		tags: `tsundoku,${slug(last?.title ?? '')}`.replace(/,$/, '')
	});
}

const slug = (t: string) =>
	t
		.toLowerCase()
		.replace(/[^\p{L}\p{N}]+/gu, '-')
		.replace(/^-|-$/g, '')
		.slice(0, 40);

export type SendResult = { sent: number; failed: number; rejected: number; setUp: boolean };

/**
 * The review's SEND: rejected words are recorded; approved ones become
 * 'pending' and are sent to Kumiko one by one, each marked 'sent' only once
 * Kumiko confirms. What Kumiko doesn't take stays pending, for RETRY.
 */
export async function decide(
	o: { approve: string[]; reject: string[]; now?: number },
	fetcher: typeof fetch = fetch
): Promise<SendResult> {
	const db = getDb();
	const now = o.now ?? Date.now();
	const put = db.prepare(
		`INSERT INTO mined (lemma, status, decided_at) VALUES (?, ?, ?)
		ON CONFLICT (lemma) DO UPDATE SET status = excluded.status, decided_at = excluded.decided_at
		WHERE mined.status != 'sent'`
	);
	db.transaction(() => {
		for (const l of o.reject) put.run(l, 'rejected', now);
		for (const l of o.approve) put.run(l, 'pending', now);
	}).immediate();
	const r = await flushPending(fetcher, now);
	return { ...r, rejected: o.reject.length };
}

/** Send every approved word Kumiko doesn't have yet. RETRY is this. */
export async function flushPending(
	fetcher: typeof fetch = fetch,
	now = Date.now()
): Promise<{ sent: number; failed: number; setUp: boolean }> {
	const db = getDb();
	const pending = (
		db.prepare(`SELECT lemma FROM mined WHERE status = 'pending' ORDER BY decided_at`).all() as {
			lemma: string;
		}[]
	).map((r) => r.lemma);
	const k = kumiko();
	if (!k) return { sent: 0, failed: pending.length, setUp: false };
	let sent = 0;
	for (const lemma of pending) {
		const card = cardFor(lemma);
		try {
			const res = await fetcher(`${k.url}/api/flashcards/notes`, {
				method: 'POST',
				headers: { authorization: `Bearer ${k.token}`, 'content-type': 'application/json' },
				body: JSON.stringify({
					front: card.front,
					back: card.back,
					tags: card.tags,
					noteType: 'basic',
					deckId: k.deck
				}),
				signal: AbortSignal.timeout(15_000)
			});
			if (!res.ok) break;
			const body = (await res.json().catch(() => ({}))) as { id?: string; note?: { id?: string } };
			// Sent only with Kumiko's word for it: a note id.
			const id = body.note?.id ?? body.id;
			if (typeof id !== 'string') break;
			db.prepare(
				`UPDATE mined SET status = 'sent', decided_at = ?, note_id = ? WHERE lemma = ?`
			).run(now, id, lemma);
			sent += 1;
		} catch {
			// Kumiko didn't answer: the rest stay pending, for RETRY.
			break;
		}
	}
	return { sent, failed: pending.length - sent, setUp: true };
}

// ---- counts the screens show ---------------------------------------------------

/** The lookup panel's footer: "3RD LOOKUP" of this word, "7 THIS SESSION" (today). */
export function lookupCounts(lemma: string, now = Date.now()): { nth: number; session: number } {
	const db = getDb();
	const start = new Date(now);
	start.setHours(0, 0, 0, 0);
	const nth = (
		db.prepare(`SELECT COUNT(*) AS n FROM lookups WHERE lemma = ?`).get(lemma) as { n: number }
	).n;
	const session = (
		db.prepare(`SELECT COUNT(*) AS n FROM lookups WHERE at >= ?`).get(start.getTime()) as {
			n: number;
		}
	).n;
	return { nth, session };
}

/** The series screen's WORDS row: "14 TO REVIEW · 31 SENT". */
export function wordsOf(seriesId: number, reveal: boolean): { toReview: number; sent: number } {
	const toReview = candidates(reveal).filter((c) => c.series.id === seriesId).length;
	const sent = (
		getDb()
			.prepare(
				`SELECT COUNT(DISTINCT m.lemma) AS n FROM mined m JOIN lookups l ON l.lemma = m.lemma
				WHERE m.status = 'sent' AND l.series_id = ?`
			)
			.get(seriesId) as { n: number }
	).n;
	return { toReview, sent };
}

/** The end page's WORDS row: "7 LOOKED UP IN CH. 41" (distinct words). */
export function lookedUpIn(entryId: number): number {
	return (
		getDb()
			.prepare(`SELECT COUNT(DISTINCT lemma) AS n FROM lookups WHERE entry_id = ?`)
			.get(entryId) as { n: number }
	).n;
}

import { basename, join } from 'node:path';
import { getDb } from './db.ts';
import { readEpub } from './import/epub.ts';
import {
	ELIGIBLE_NOVEL_SQL,
	Refused,
	api,
	afterLinking,
	linkWork,
	searchOne,
	suggestConfigured
} from './ranobe.ts';
import { bracketed, cleanTitle, normaliseTitle } from '../library/catalogue.ts';
import { epubLang, suggestedPeople, volumeOf, workBundle } from '../library/ranobe.ts';

/**
 * Suggesting a novel Ranobe lacks, from its EPUB (card c72; API-V1.md,
 * "For Tsundoku", step 12; doc/RANOBE.md, "Suggesting a novel"). Only on the
 * owner's tap in the review, only through the app account, whose suggestions
 * wait for the owner on Ranobe: the files' metadata is rough, and the owner
 * corrects it there before approving. Never for a hidden series or Hentoid.
 */

type BundleAnswer = {
	bundle: number;
	status: string;
	items: { key: string; ref: string | null; status: string }[];
};

export class CannotSuggest extends Error {}

/** What a series' EPUB says, for the bundle: its first file with a package. */
async function fromFile(seriesId: number) {
	const db = getDb();
	const s = db
		.prepare(
			`SELECT s.title, s.path FROM series s JOIN roots r ON r.id = s.root_id WHERE s.id = ? AND ${ELIGIBLE_NOVEL_SQL}`
		)
		.get(seriesId) as { title: string; path: string } | undefined;
	if (!s) throw new CannotSuggest('not a novel Ranobe may hear of');
	const files = (
		db
			.prepare(
				`SELECT DISTINCT file FROM entries WHERE series_id = ? AND file != '' AND shadowed = 0`
			)
			.all(seriesId) as { file: string }[]
	).map((r) => r.file);
	for (const file of files) {
		const { pkg } = await readEpub(join(s.path, file));
		if (pkg) return { series: s, file, pkg };
	}
	throw new CannotSuggest('no readable EPUB');
}

/**
 * SUGGEST TO RANOBE: the series' authors and the work, as one bundle. Ranobe
 * is searched once more first, so a work that arrived since is offered, not
 * suggested again. Returns the bundle, or `found` with how many it found.
 */
export async function suggestWork(
	seriesId: number,
	now = Date.now()
): Promise<{ outcome: 'suggested'; bundle: number } | { outcome: 'found'; found: number }> {
	if (!suggestConfigured()) throw new CannotSuggest('no RANOBE_SUGGEST_TOKEN');
	const { series, file, pkg } = await fromFile(seriesId);
	const raw = pkg.title || series.title;
	const title = cleanTitle(raw) || series.title;
	const found = await searchOne(seriesId, title, now);
	if (found) return { outcome: 'found', found };
	// A sibling volume already suggested the work: this one joins that bundle,
	// and is linked with it, rather than suggest the same novel twice.
	const joined = pendingSibling(seriesId);
	if (joined !== null) {
		keep(seriesId, joined, now);
		return { outcome: 'suggested', bundle: joined };
	}
	const bundle = workBundle({
		title,
		aliases: bracketed(raw)
			.map((a) => cleanTitle(a))
			.filter(Boolean),
		volume: volumeOf(series.title, basename(file)),
		people: suggestedPeople(pkg.authors),
		lang: epubLang(pkg.language),
		file: basename(file)
	});
	const answer = await api<BundleAnswer>('/bundles', {
		method: 'POST',
		as: 'suggest',
		key: `tsundoku-work-${seriesId}-${now}`,
		body: bundle
	});
	if (!answer) throw new Refused(0, 'no_answer');
	keep(seriesId, answer.bundle, now);
	return { outcome: 'suggested', bundle: answer.bundle };
}

function keep(seriesId: number, bundle: number, now: number): void {
	getDb()
		.prepare(
			`INSERT INTO ranobe_work_suggestions (series_id, bundle, status, sent_at) VALUES (?, ?, 'pending', ?)
			ON CONFLICT (series_id) DO UPDATE SET bundle = excluded.bundle, status = 'pending', work = NULL,
				sent_at = excluded.sent_at, checked_at = NULL`
		)
		.run(seriesId, bundle, now);
}

/** A pending bundle suggested from a series with this one's title before a volume number. */
function pendingSibling(seriesId: number): number | null {
	const db = getDb();
	const key = (t: string) => normaliseTitle(cleanTitle(t) || t);
	const me = db.prepare(`SELECT title FROM series WHERE id = ?`).get(seriesId) as {
		title: string;
	};
	const rows = db
		.prepare(
			`SELECT s.title, w.bundle FROM ranobe_work_suggestions w JOIN series s ON s.id = w.series_id
			WHERE w.status = 'pending' AND w.series_id != ?`
		)
		.all(seriesId) as { title: string; bundle: number }[];
	return rows.find((r) => key(r.title) === key(me.title))?.bundle ?? null;
}

/** UNDO of SUGGEST: the bundle withdrawn on Ranobe, and the series back in the review. */
export async function withdrawWork(seriesId: number): Promise<boolean> {
	const db = getDb();
	const s = db
		.prepare(
			`SELECT bundle FROM ranobe_work_suggestions WHERE series_id = ? AND status = 'pending'`
		)
		.get(seriesId) as { bundle: number } | undefined;
	if (!s) return false;
	// A bundle other volumes joined stays for them; only the last one out withdraws it.
	const shared = db
		.prepare(
			`SELECT COUNT(*) AS n FROM ranobe_work_suggestions WHERE bundle = ? AND series_id != ? AND status = 'pending'`
		)
		.get(s.bundle, seriesId) as { n: number };
	if (!shared.n)
		try {
			await api(`/bundles/${s.bundle}/withdraw`, { method: 'POST', as: 'suggest', body: {} });
		} catch (e) {
			// Decided already: nothing left to withdraw; the pass reads how.
			if (!(e instanceof Refused && e.status === 409)) throw e;
		}
	db.prepare(`DELETE FROM ranobe_work_suggestions WHERE series_id = ?`).run(seriesId);
	return true;
}

/**
 * The pass: how each pending suggestion stands. Approved, the series is
 * linked to the work it made, and its siblings -- the same title before a
 * volume number -- are searched again, so the new work comes to them as a
 * candidate. Rejected or withdrawn on Ranobe, the series is settled as not
 * there: the owner said no.
 */
export async function checkWorkSuggestions(
	now = Date.now()
): Promise<{ approved: number; waiting: number }> {
	const db = getDb();
	const pending = db
		.prepare(`SELECT series_id, bundle FROM ranobe_work_suggestions WHERE status = 'pending'`)
		.all() as { series_id: number; bundle: number }[];
	const out = { approved: 0, waiting: 0 };
	for (const p of pending) {
		const b = await api<BundleAnswer>(`/bundles/${p.bundle}`);
		const status = b?.status ?? 'pending';
		const work = b?.items.find((i) => i.key === 'work')?.ref ?? null;
		db.prepare(
			`UPDATE ranobe_work_suggestions SET status = ?, work = ?, checked_at = ? WHERE series_id = ?`
		).run(
			['approved', 'rejected', 'withdrawn'].includes(status) ? status : 'pending',
			work,
			now,
			p.series_id
		);
		if (status === 'approved' && work) {
			linkWork(p.series_id, work, 'review', now);
			void afterLinking(p.series_id, now);
			requeueSiblings(p.series_id);
			out.approved += 1;
		} else if (status === 'rejected' || status === 'withdrawn')
			db.prepare(
				`INSERT INTO ranobe_decisions (series_id, decision, at) VALUES (?, 'none', ?)
				ON CONFLICT (series_id) DO NOTHING`
			).run(p.series_id, now);
		else out.waiting += 1;
	}
	return out;
}

/** The series with this one's title before a volume number, still waiting: searched again next. */
function requeueSiblings(seriesId: number): void {
	const db = getDb();
	const me = db.prepare(`SELECT title FROM series WHERE id = ?`).get(seriesId) as {
		title: string;
	};
	const key = normaliseTitle(cleanTitle(me.title) || me.title);
	const rows = db
		.prepare(
			`SELECT s.id, s.title FROM series s JOIN roots r ON r.id = s.root_id
			JOIN ranobe_searches rs ON rs.series_id = s.id
			WHERE s.id != ? AND ${ELIGIBLE_NOVEL_SQL}
				AND s.id NOT IN (SELECT series_id FROM ranobe_links)
				AND s.id NOT IN (SELECT series_id FROM ranobe_decisions)`
		)
		.all(seriesId) as { id: number; title: string }[];
	const again = db.prepare(`UPDATE ranobe_searches SET searched_at = NULL WHERE series_id = ?`);
	for (const r of rows) if (normaliseTitle(cleanTitle(r.title) || r.title) === key) again.run(r.id);
}

/** How a series stands with a suggestion, for its LINK and TRACKING rows. */
export function suggestionOf(
	seriesId: number
): { bundle: number; status: string; sentAt: number } | null {
	const r = getDb()
		.prepare(`SELECT bundle, status, sent_at FROM ranobe_work_suggestions WHERE series_id = ?`)
		.get(seriesId) as { bundle: number; status: string; sent_at: number } | undefined;
	return r ? { bundle: r.bundle, status: r.status, sentAt: r.sent_at } : null;
}

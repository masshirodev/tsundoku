import { getDb } from './db.ts';
import { HIDDEN_SQL } from './visibility.ts';
import {
	MEDIA,
	Unreachable,
	anilistAs,
	anilistPublic,
	toCandidate,
	type Media,
	type Via
} from './catalogue.ts';
import { clearAniSkip } from './anime/marks.ts';
import {
	candidateKind,
	coverOnly,
	isAnime,
	normaliseTitle,
	wrongKind,
	type Candidate,
	type SeasonDecision
} from '../library/catalogue.ts';
import {
	openSeason,
	partOf,
	partsOf,
	seasonSearchTitle,
	seasonsOf,
	type PartSpan,
	type SeasonSpan
} from '../library/anime.ts';
import type { Kind } from '../library/types.ts';

/**
 * An anime's catalogue links, one per season (doc/LINKS.md, doc/TRACKING.md;
 * card c240, the owner's decision A). AniList and MAL list each season as its
 * own entry, and a tsundoku series holds several, so `series_links` -- one row
 * a series, which is right for a manga or a novel -- cannot say which entry a
 * season's episodes belong to. This module owns the row that can:
 * `series_season_links`, keyed by series, season and part.
 *
 * - **Season 0 is a flat list**, and one entry covering the whole run. A link
 *   made before rung 62 lives in `series_links` and is read as season 0's by
 *   `legacyLink` (doc/handoff-notes/tracking.md), so nothing is migrated.
 * - **Two parts** are one season a catalogue split in two: part 2 begins
 *   after part 1's episode count (`episodes`, stored with the link).
 * - **The other seasons** come from the linked entry's own PREQUEL/SEQUEL
 *   relations, matched by order along the chain and checked by episode count
 *   (the design's "LINKING FOUR SEASONS WITHOUT FOUR SEARCHES").
 */

export type SeasonVia = Via | 'relations';

export type SeasonLink = {
	seriesId: number;
	season: number;
	part: number;
	anilistId: number | null;
	malId: number | null;
	via: SeasonVia;
	title: string;
	coverUrl: string;
	linkedAt: number;
	resolvedAt: number | null;
	filledRating: number | null;
	score: number | null;
	format: string | null;
	episodes: number | null;
	year: number | null;
};

type Row = {
	series_id: number;
	season: number;
	part: number;
	anilist_id: number | null;
	mal_id: number | null;
	via: SeasonVia;
	title: string;
	cover_url: string;
	linked_at: number;
	resolved_at: number | null;
	filled_rating: number | null;
	score: number | null;
	format: string | null;
	episodes: number | null;
	year: number | null;
};

const asLink = (r: Row): SeasonLink => ({
	seriesId: r.series_id,
	season: r.season,
	part: r.part,
	anilistId: r.anilist_id,
	malId: r.mal_id,
	via: r.via,
	title: r.title,
	coverUrl: r.cover_url,
	linkedAt: r.linked_at,
	resolvedAt: r.resolved_at,
	filledRating: r.filled_rating,
	score: r.score,
	format: r.format,
	episodes: r.episodes,
	year: r.year
});

export function seasonLink(seriesId: number, season: number, part = 1): SeasonLink | null {
	const r = getDb()
		.prepare(`SELECT * FROM series_season_links WHERE series_id = ? AND season = ? AND part = ?`)
		.get(seriesId, season, part) as Row | undefined;
	return r ? asLink(r) : null;
}

export function seasonLinks(seriesId: number): SeasonLink[] {
	return (
		getDb()
			.prepare(`SELECT * FROM series_season_links WHERE series_id = ? ORDER BY season, part`)
			.all(seriesId) as Row[]
	).map(asLink);
}

/**
 * The link a series had before rung 62, read as season 0's: `series_links`
 * kept meaning what it always meant -- one entry for the series -- and an
 * anime nobody split has one season (or none given), which is exactly that.
 * The caller says which season it is attributed to (the first one in its
 * list), since only the list knows.
 */
export function legacyLink(seriesId: number): SeasonLink | null {
	const r = getDb().prepare(`SELECT * FROM series_links WHERE series_id = ?`).get(seriesId) as
		| {
				anilist_id: number | null;
				mal_id: number | null;
				via: Via;
				title: string;
				cover_url: string;
				linked_at: number;
				resolved_at: number | null;
				filled_rating: number | null;
				score: number | null;
				format: string | null;
		  }
		| undefined;
	if (!r || (!r.anilist_id && !r.mal_id)) return null;
	return {
		seriesId,
		season: 0,
		part: 1,
		anilistId: r.anilist_id,
		malId: r.mal_id,
		via: r.via,
		title: r.title,
		coverUrl: r.cover_url,
		linkedAt: r.linked_at,
		resolvedAt: r.resolved_at,
		filledRating: r.filled_rating,
		score: r.score,
		format: r.format,
		episodes: null,
		year: null
	};
}

/**
 * The season (and part) of this series that already holds the entry, other
 * than the one named: no two seasons or parts of one show are ever the same
 * AniList or MAL entry (wave 17, round 2). AniList's search for "Show Season
 * 2" lists "Show" too, so season 1's entry turns up among season 2's hits;
 * linking it there would send season 2's episode numbers to season 1's entry.
 * A link of the series' from before rung 62, with no season row beside it,
 * is its first season's (as `seriesSeasons` reads it).
 */
export function seasonHolding(
	seriesId: number,
	season: number,
	part: number,
	c: { anilistId: number | null; malId: number | null }
): { season: number; part: number } | null {
	let held = seasonLinks(seriesId);
	if (!held.length) {
		const old = legacyLink(seriesId);
		const first = seasonEntries(seriesId)[0]?.season ?? 0;
		held = old ? [{ ...old, season: first }] : [];
	}
	const other = held.find(
		(l) =>
			!(l.season === season && l.part === part) &&
			((c.anilistId !== null && l.anilistId === c.anilistId) ||
				(c.malId !== null && l.malId === c.malId))
	);
	return other ? { season: other.season, part: other.part } : null;
}

/** A series' kind, its title, and whether it is hidden: what every season door asks first. */
export function seriesRow(seriesId: number) {
	return getDb()
		.prepare(
			`SELECT s.kind, s.title, ${HIDDEN_SQL} AS hidden
			FROM series s JOIN roots r ON r.id = s.root_id WHERE s.id = ?`
		)
		.get(seriesId) as { kind: Kind; title: string; hidden: number } | undefined;
}

/** The season an anime's doors write and read by default: the one CONTINUE is in, or the first. */
export function openSeasonOf(seriesId: number): number {
	const view = seriesSeasons(seriesId);
	return view?.open ?? 0;
}

/**
 * The season of an anime that still wants a look: the one a door that names
 * no season acts on (`link`, `noneOfThese`, `offered`, `searchNow`, SKIP and a
 * pass row with no season, `/links?series=N` with no `&season`). The pass and
 * the review queue name their own season, a row and an item a season (wave
 * 17, c352), so they do not ask this. That is the
 * open season when it has neither a link nor a decision, otherwise the first
 * season in list order with neither, otherwise none (c240, round 2).
 *
 * This is the TypeScript twin of `NEEDS_LOOK` in `catalogue.ts`: a season is
 * `COALESCE(entries.season, 0)` over the series' unshadowed entries, and it is
 * settled by any `series_season_links` or `season_link_decisions` row at that
 * season, whatever the part. A series with no season rows at all keeps the
 * series-level gate there, so a link or decision of the series' own (one made
 * before rung 62) leaves nothing to look at here either. The two must agree:
 * a series `NEEDS_LOOK` lets in has a season here, and one it keeps out has
 * none.
 *
 * Not the season being watched: that is `openSeasonOf`, which rating, the
 * sheet and tracking read.
 */
export function seasonToLook(seriesId: number): number | undefined {
	const s = seriesRow(seriesId);
	if (!s || !isAnime(s.kind)) return undefined;
	const db = getDb();
	const rows = (
		db
			.prepare(
				`SELECT season FROM series_season_links WHERE series_id = ?
				UNION SELECT season FROM season_link_decisions WHERE series_id = ?`
			)
			.all(seriesId, seriesId) as { season: number }[]
	).map((r) => r.season);
	// No season rows: `NEEDS_LOOK`'s series-level arm, and the open season is
	// open by definition -- season 0 for a show whose source gave no episodes yet.
	if (!rows.length)
		return db.prepare(`SELECT 1 FROM series_links WHERE series_id = ?`).get(seriesId) ||
			db.prepare(`SELECT 1 FROM link_decisions WHERE series_id = ?`).get(seriesId)
			? undefined
			: openSeasonOf(seriesId);
	const settled = new Set(rows);
	const order: number[] = [];
	for (const e of seasonEntries(seriesId)) if (!order.includes(e.season)) order.push(e.season);
	const open = openSeasonOf(seriesId);
	if (order.includes(open) && !settled.has(open)) return open;
	return order.find((n) => !settled.has(n));
}

/** The episode numbers of a season, in list order, as a catalogue counts them. */
function seasonEntries(seriesId: number): {
	id: number;
	season: number;
	number: number;
	readAt: number | null;
	note: string;
	position: number;
}[] {
	return getDb()
		.prepare(
			`SELECT id, COALESCE(season, 0) AS season, COALESCE(episode_number, position) AS number,
				read_at AS readAt, COALESCE(episode_note, '') AS note, position
			FROM entries WHERE series_id = ? AND shadowed = 0 ORDER BY position, id`
		)
		.all(seriesId) as {
		id: number;
		season: number;
		number: number;
		readAt: number | null;
		note: string;
		position: number;
	}[];
}

/** A series' seasons, in the order its episode list holds them, with what each link says. */
export type SeasonView = SeasonSpan & {
	/** Part 1 of the season, which is the line the LINK row draws. */
	link: SeasonLink | null;
	parts: { part: number; from: number; to: number; link: SeasonLink | null }[];
	/** The last search for the season: "4 CANDIDATES", "NOTHING FOUND". */
	candidates: number;
	searched: boolean;
	queued: boolean;
	/** NONE OF THESE (`none`) or UNLINK (`unlinked`) settled it: no pass asks again (c240). */
	decision: SeasonDecision | null;
	/** What FIND asks AniList for. */
	searchTitle: string;
};

export type SeriesSeasons = {
	kind: Kind;
	title: string;
	hidden: boolean;
	seasons: SeasonView[];
	/** The season CONTINUE is in, which the rows fold round. */
	open: number;
};

/**
 * Every season of an anime with its link, its parts and its last search. Null
 * for a series with no episodes, or one that isn't an anime: only an anime
 * links a season at a time.
 */
export function seriesSeasons(seriesId: number): SeriesSeasons | null {
	const s = seriesRow(seriesId);
	if (!s || !isAnime(s.kind)) return null;
	const entries = seasonEntries(seriesId);
	const spans: SeasonSpan[] = seasonsOf(
		entries.map((e) => ({
			id: e.id,
			number: e.number,
			label: '',
			readAt: e.readAt,
			lastPosition: null,
			lastOpenedAt: null,
			episode: {
				durationS: null,
				season: e.season,
				number: e.number,
				note: (e.note as '' | 'filler' | 'recap') ?? '',
				thumb: '',
				endingAt: null
			}
		}))
	);
	const links = seasonLinks(seriesId);
	// A series whose source gave no episodes yet still has one season: the row
	// its link is in, which is what a pasted or listed link can be made on.
	if (!spans.length) {
		const own = links[0] ?? legacyLink(seriesId);
		if (own)
			spans.push({
				season: own.season,
				from: 1,
				to: own.episodes ?? 0,
				count: 0,
				aired: own.episodes ?? 0,
				watched: 0
			});
	}
	const searched = getDb()
		.prepare(`SELECT season, searched_at, found FROM season_link_searches WHERE series_id = ?`)
		.all(seriesId) as { season: number; searched_at: number | null; found: number }[];
	return {
		kind: s.kind,
		title: s.title,
		hidden: !!s.hidden,
		open:
			openSeason(
				entries.map((e) => ({
					id: e.id,
					number: e.number,
					readAt: e.readAt,
					lastPosition: null,
					lastOpenedAt: null,
					episode: {
						durationS: null,
						season: e.season,
						number: e.number,
						note: '',
						thumb: '',
						endingAt: null
					}
				}))
			) ??
			spans[0]?.season ??
			0,
		seasons: spans.map((span) => {
			const own = links.filter((l) => l.season === span.season);
			// The series' own link before rung 62 is the first season's (or the
			// flat list's), never a later season's: it covers the whole run.
			const first = spans[0]?.season ?? 0;
			// A link from before rung 62 stands for the series, so it is read as a
			// season's only when no season has a row of its own: otherwise the
			// series' mirror (`syncSeriesLink`) would look like every season's link.
			const old =
				!links.length && (span.season === 0 || span.season === first) ? legacyLink(seriesId) : null;
			const legacy = old ? { ...old, season: span.season } : null;
			const head = own.find((l) => l.part === 1) ?? own[0] ?? legacy;
			const partRows = own.length ? own : head ? [head] : [];
			const parts: PartSpan[] = partsOf(
				partRows.map((l) => ({ part: l.part, episodes: l.episodes })),
				span.aired
			);
			const search = searched.find((x) => x.season === span.season);
			return {
				...span,
				link: head,
				parts: parts.map((p) => ({
					...p,
					link: partRows.find((l) => l.part === p.part) ?? null
				})),
				candidates: search?.searched_at ? search.found : 0,
				searched: !!search?.searched_at,
				queued:
					!!search?.searched_at === false &&
					!!getDb()
						.prepare(`SELECT 1 FROM season_link_searches WHERE series_id = ? AND season = ?`)
						.get(seriesId, span.season),
				decision: seasonDecision(seriesId, span.season),
				searchTitle: seasonSearchTitle(s.title, span.season)
			};
		})
	};
}

/**
 * The catalogue entry an anime's episode is in, and its number there: what
 * AniSkip is keyed by (c349). An episode is its season's, so it is read from
 * that season's own row (`series_season_links`) -- part 2 of a season split
 * in two from part 2's, numbered from 1 within it (the season's EP. 13 is
 * part 2's EP. 1) -- and never from another season's, so season 2's EP. 3 is
 * season 2's entry and season 1's EP. 3 season 1's. A season with no row of
 * its own has no entry, even when the series' first-season mirror
 * (`series_links`, `syncSeriesLink`) names one.
 *
 * Only a series with no season rows at all, linked before rung 62, reads
 * `series_links`: its one link is its first season's or its flat list's
 * (`legacyLink`), so an episode of season 0 or 1 is that entry's and a later
 * season's is nobody's. Null for no entry, or an episode its parts don't
 * number.
 */
export function episodeEntry(
	seriesId: number,
	season: number | null,
	number: number
): {
	anilistId: number | null;
	malId: number | null;
	format: string | null;
	number: number;
} | null {
	const s = season ?? 0;
	if (!seasonLinks(seriesId).length) {
		const old = s <= 1 ? legacyLink(seriesId) : null;
		return old ? { anilistId: old.anilistId, malId: old.malId, format: old.format, number } : null;
	}
	const sv = seriesSeasons(seriesId)?.seasons.find((x) => x.season === s);
	if (!sv) return null;
	// One part is the whole season, however its episodes are numbered.
	const at =
		sv.parts.length > 1 ? partOf(sv.parts, number) : { part: sv.parts[0]?.part ?? 1, number };
	const l = at ? sv.parts.find((p) => p.part === at.part)?.link : null;
	return at && l
		? { anilistId: l.anilistId, malId: l.malId, format: l.format, number: at.number }
		: null;
}

/**
 * The show's own ids, for what names the whole show to another service
 * (Jellyfin's `tvshow.nfo`; c381): season 1's link, else the earliest season
 * linked, part 1 first, among links to an anime's own kind of entry (c395,
 * `ownEntry`'s rule, which the caller passes in). Read from the season rows,
 * so a show with only season 2 linked still has ids; `series_links` answers
 * only for a series linked before rung 62, with no season rows (the mirror
 * would be a copy of a season row, or nothing).
 */
export function showEntry(
	seriesId: number,
	own: (format: string | null) => boolean
): { anilistId: number | null; malId: number | null } | null {
	const rows = seasonLinks(seriesId).filter((l) => own(l.format));
	if (!rows.length) {
		if (seasonLinks(seriesId).length) return null;
		const old = legacyLink(seriesId);
		return old && own(old.format) ? { anilistId: old.anilistId, malId: old.malId } : null;
	}
	const order = (n: number) => (n === 1 ? -1 : n);
	const l = rows.reduce((a, b) =>
		order(b.season) < order(a.season) || (b.season === a.season && b.part < a.part) ? b : a
	);
	return { anilistId: l.anilistId, malId: l.malId };
}

// ---- writing -------------------------------------------------------------------------------

/**
 * Link a season (or one of its parts) to an entry the owner chose. Replaces a
 * link it had; a link of the series' before rung 62 goes with it, since the
 * season's own row now says what that one said. AniSkip's answers go too, as
 * at every other link door.
 *
 * Refused (false, nothing written) when another season or part of the show
 * holds the entry (`seasonHolding`), whatever the door: the pass's sure
 * match, the owner's list, the relations, the queue's LINK and a pasted link
 * all come through here, so the rule holds at every one (wave 17, round 2).
 */
export function linkSeason(
	seriesId: number,
	season: number,
	part: number,
	c: Candidate,
	via: SeasonVia,
	now = Date.now()
): boolean {
	const db = getDb();
	return db.transaction(() => {
		if (seasonHolding(seriesId, season, part, c)) return false;
		db.prepare(
			`INSERT INTO series_season_links
				(series_id, season, part, anilist_id, mal_id, via, title, cover_url, linked_at, resolved_at, format, episodes, year)
			VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
			ON CONFLICT (series_id, season, part) DO UPDATE SET anilist_id = excluded.anilist_id,
				mal_id = excluded.mal_id, via = excluded.via, title = excluded.title,
				cover_url = excluded.cover_url, linked_at = excluded.linked_at,
				resolved_at = excluded.resolved_at, filled_rating = NULL, score = NULL,
				format = excluded.format, episodes = excluded.episodes, year = excluded.year`
		).run(
			seriesId,
			season,
			part,
			c.anilistId,
			c.malId,
			via,
			c.title,
			c.coverUrl,
			now,
			now,
			c.format,
			c.episodes ?? null,
			c.year ?? null
		);
		db.prepare(
			`DELETE FROM season_link_decisions WHERE series_id = ? AND season = ? AND part = ?`
		).run(seriesId, season, part);
		clearAniSkip(seriesId, db);
		syncSeriesLink(seriesId, now);
		return true;
	})();
}

/**
 * Keep the series' own `series_links` row in step with its seasons: a mirror
 * of the **first** season linked -- season 1, or a flat list -- for the
 * readers that still ask a series for one row (the importer's keep-test,
 * c382; doc/handoff-notes/links.md, "Gaps"). AniSkip (`episodeEntry`, c349),
 * Jellyfin's `tvshow.nfo` (`showEntry`, c381) and tracking read the season
 * rows instead. No first season, no row; no season left, the mirror goes.
 */
export function syncSeriesLink(seriesId: number, now = Date.now()): void {
	const db = getDb();
	const links = seasonLinks(seriesId).filter((l) => l.part === 1);
	const l = links.reduce((a, b) => (b.season < a.season ? b : a), links[0]);
	// Only the series' first season stands for the series: a later season's
	// entry is not the show's (c240). No first season, no row.
	if (!l || l.season > 1) {
		db.prepare(`DELETE FROM series_links WHERE series_id = ?`).run(seriesId);
		return;
	}
	db.prepare(
		`INSERT INTO series_links (series_id, anilist_id, mal_id, via, title, cover_url, linked_at, resolved_at, format)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
		ON CONFLICT (series_id) DO UPDATE SET anilist_id = excluded.anilist_id, mal_id = excluded.mal_id,
			via = excluded.via, title = excluded.title, cover_url = excluded.cover_url,
			linked_at = excluded.linked_at, resolved_at = excluded.resolved_at, format = excluded.format`
	).run(
		seriesId,
		l.anilistId,
		l.malId,
		// `series_links.via` has no 'relations' (rung 25's CHECK): a link given by
		// the relations was still made in the review, and that is its word there.
		l.via === 'relations' ? 'review' : l.via,
		l.title,
		l.coverUrl,
		l.linkedAt ?? now,
		l.resolvedAt,
		l.format
	);
}

/** A season the relations page ticked: the entry, and the season and part it goes on. */
export type SeasonPick = { season: number; part: number; anilistId: number };

/**
 * A pick that was not linked, and why: another season or part of the show
 * holds the entry (`heldBy`), or it is no longer among the season's offers
 * (`heldBy` null). The page names each one (c418).
 */
export type RefusedPick = {
	season: number;
	part: number;
	heldBy: { season: number; part: number } | null;
	/** What the page says: "SEASON 1 NOT LINKED · SEASON 3 HOLDS ITS ENTRY". */
	why: string;
};

/** A season's stored candidate as it was found, the holding rule not yet applied. */
function storedCandidate(
	seriesId: number,
	season: number,
	part: number,
	anilistId: number
): Candidate | null {
	const r = getDb()
		.prepare(
			`SELECT data FROM season_link_candidates WHERE series_id = ? AND season = ? AND part = ? AND anilist_id = ?`
		)
		.get(seriesId, season, part, anilistId) as { data: string } | undefined;
	return r ? (JSON.parse(r.data) as Candidate) : null;
}

/**
 * LINK N SEASONS (c418): each pick read back through `offeredSeason`, at its
 * own part (a pair's part 2 is part 2's offer), then written by `linkSeason`.
 * What was linked and what was refused, so the page says the true count and
 * names the rest, rather than counting its own ticks. Picks are taken in
 * order, so two picks of one entry link the first and refuse the second.
 */
export function linkPicks(
	seriesId: number,
	kind: Kind,
	picks: SeasonPick[],
	now = Date.now()
): { linked: { season: number; part: number }[]; refused: RefusedPick[] } {
	const linked: { season: number; part: number }[] = [];
	const refused: RefusedPick[] = [];
	for (const p of picks) {
		const c = offeredSeason(seriesId, p.season, kind, p.anilistId, p.part);
		if (c && linkSeason(seriesId, p.season, p.part, c, 'relations', now)) {
			linked.push({ season: p.season, part: p.part });
			continue;
		}
		// A held offer is never kept as a candidate (`rememberOffers`), so the
		// pick's own id is asked too: whichever holds it is named.
		const asked = c ??
			storedCandidate(seriesId, p.season, p.part, p.anilistId) ?? {
				anilistId: p.anilistId,
				malId: null
			};
		const heldBy = seasonHolding(seriesId, p.season, p.part, asked);
		refused.push({
			season: p.season,
			part: p.part,
			heldBy,
			why: `${seasonWords(p)} NOT LINKED · ${heldBy ? `${seasonWords(heldBy)} HOLDS ITS ENTRY` : 'NO LONGER OFFERED'}`
		});
	}
	return { linked, refused };
}

/** UNDO, just after a LINK: the row goes; a link of the series' before rung 62 is NOT brought back. */
export function undoSeasonLink(seriesId: number, season: number, part = 1): boolean {
	const db = getDb();
	const gone =
		db
			.prepare(`DELETE FROM series_season_links WHERE series_id = ? AND season = ? AND part = ?`)
			.run(seriesId, season, part).changes > 0;
	if (gone) {
		clearAniSkip(seriesId, db);
		syncSeriesLink(seriesId);
	}
	return gone;
}

/** UNLINK on a season: gone, and a pass won't search it again (a decision, as for a series). */
export function unlinkSeason(seriesId: number, season: number, part = 1, now = Date.now()): void {
	const db = getDb();
	db.transaction(() => {
		db.prepare(
			`DELETE FROM series_season_links WHERE series_id = ? AND season = ? AND part = ?`
		).run(seriesId, season, part);
		db.prepare(
			`INSERT OR REPLACE INTO season_link_decisions (series_id, season, part, decision, at)
			VALUES (?, ?, ?, 'unlinked', ?)`
		).run(seriesId, season, part, now);
		clearAniSkip(seriesId, db);
		syncSeriesLink(seriesId, now);
	})();
}

/** NONE OF THESE on a season: remembered, so it doesn't come back. */
export function noneOfSeason(seriesId: number, season: number, part = 1, now = Date.now()): void {
	getDb()
		.prepare(
			`INSERT OR REPLACE INTO season_link_decisions (series_id, season, part, decision, at)
			VALUES (?, ?, ?, 'none', ?)`
		)
		.run(seriesId, season, part, now);
}

export function undoNoneSeason(seriesId: number, season: number, part = 1): boolean {
	return (
		getDb()
			.prepare(
				`DELETE FROM season_link_decisions WHERE series_id = ? AND season = ? AND part = ? AND decision = 'none'`
			)
			.run(seriesId, season, part).changes > 0
	);
}

/** A season settled by a decision: never searched again by the pass. */
export function seasonSettled(seriesId: number, season: number): boolean {
	return seasonDecision(seriesId, season) !== null;
}

/**
 * Which decision settled a season, the latest of its parts': the season's
 * line says UNLINKED for an UNLINK and NONE OF THESE only for that (c240).
 */
export function seasonDecision(seriesId: number, season: number): SeasonDecision | null {
	const r = getDb()
		.prepare(
			`SELECT decision FROM season_link_decisions WHERE series_id = ? AND season = ?
			ORDER BY at DESC, part LIMIT 1`
		)
		.get(seriesId, season) as { decision: SeasonDecision } | undefined;
	return r?.decision ?? null;
}

// ---- searching a season --------------------------------------------------------------------

export type SeasonSearch = { query: string; searchedAt: number | null; found: number };

export function seasonSearch(seriesId: number, season: number, part = 1): SeasonSearch | null {
	const r = getDb()
		.prepare(
			`SELECT query, searched_at AS searchedAt, found FROM season_link_searches WHERE series_id = ? AND season = ? AND part = ?`
		)
		.get(seriesId, season, part) as SeasonSearch | undefined;
	return r ?? null;
}

/**
 * What a season's search found, less any entry another season or part of the
 * show holds (`seasonHolding`): season 2's search lists season 1's entry too,
 * and that one is never offered for season 2. Asked at read time as well as
 * at the save, since season 1 may be linked after season 2 was searched.
 */
export function seasonCandidates(seriesId: number, season: number, part = 1): Candidate[] {
	return (
		getDb()
			.prepare(
				`SELECT data FROM season_link_candidates WHERE series_id = ? AND season = ? AND part = ? ORDER BY rank`
			)
			.all(seriesId, season, part) as { data: string }[]
	)
		.map((x) => JSON.parse(x.data) as Candidate)
		.filter((c) => !seasonHolding(seriesId, season, part, c));
}

export function offeredSeason(
	seriesId: number,
	season: number,
	kind: Kind,
	anilistId: number,
	part = 1
): Candidate | null {
	const r = getDb()
		.prepare(
			`SELECT data FROM season_link_candidates WHERE series_id = ? AND season = ? AND part = ? AND anilist_id = ?`
		)
		.get(seriesId, season, part, anilistId) as { data: string } | undefined;
	if (r) {
		const c = JSON.parse(r.data) as Candidate;
		// Another season's entry is no candidate of this one (wave 17, round 2).
		return seasonHolding(seriesId, season, part, c) ? null : c;
	}
	// A season already linked to it: CHANGE asks again from the row's own entry.
	const own = seasonLink(seriesId, season, part);
	if (own && own.anilistId === anilistId && own.title)
		return {
			anilistId: own.anilistId!,
			malId: own.malId,
			title: own.title,
			alts: [],
			format: own.format ?? '',
			country: '',
			year: own.year,
			chapters: null,
			volumes: null,
			episodes: own.episodes,
			season: null,
			seasonYear: null,
			status: '',
			coverUrl: own.coverUrl
		};
	return null;
}

/**
 * Keep what a search found for a season, replacing the last one's. An entry
 * another season or part of the show holds is left out (`seasonHolding`), so
 * the four kept are all this season's to choose from; how many were kept is
 * returned, and is the row's `found`.
 */
export function saveSeasonSearch(
	seriesId: number,
	season: number,
	part: number,
	query: string,
	hits: Candidate[],
	now: number
): number {
	const db = getDb();
	const found = hits.filter((c) => !seasonHolding(seriesId, season, part, c));
	db.transaction(() => {
		db.prepare(
			`INSERT INTO season_link_searches (series_id, season, part, query, searched_at, found)
			VALUES (?, ?, ?, ?, ?, ?)
			ON CONFLICT (series_id, season, part) DO UPDATE SET query = excluded.query,
				searched_at = excluded.searched_at, found = excluded.found`
		).run(seriesId, season, part, query, now, found.length);
		db.prepare(
			`DELETE FROM season_link_candidates WHERE series_id = ? AND season = ? AND part = ?`
		).run(seriesId, season, part);
		const put = db.prepare(
			`INSERT OR REPLACE INTO season_link_candidates (series_id, season, part, anilist_id, rank, data)
			VALUES (?, ?, ?, ?, ?, ?)`
		);
		found
			.slice(0, 4)
			.forEach((c, rank) => put.run(seriesId, season, part, c.anilistId, rank, JSON.stringify(c)));
	})();
	return found.length;
}

// ---- the relations (the design's "LINKING FOUR SEASONS WITHOUT FOUR SEARCHES") --------------

type RelNode = {
	id: number;
	idMal: number | null;
	format: string | null;
	episodes: number | null;
	seasonYear: number | null;
	title: { english: string | null; romaji: string | null; native: string | null };
};

type RelAnswer = {
	Media:
		| (RelNode & {
				relations: { edges: { relationType: string; node: RelNode }[] } | null;
		  })
		| null;
};

const REL_FIELDS = `id idMal format episodes seasonYear title { english romaji native }`;

/** One request for several entries at once (aliases), so a chain is two round trips. */
async function mediaMany(
	token: string | null,
	ids: number[]
): Promise<Map<number, RelAnswer['Media']>> {
	const out = new Map<number, RelAnswer['Media']>();
	if (!ids.length) return out;
	const vars = Object.fromEntries(ids.map((id, i) => [`i${i}`, id]));
	const query = `query (${ids.map((_, i) => `$i${i}: Int`).join(', ')}) {
		${ids
			.map(
				(_, i) =>
					`m${i}: Media(id: $i${i}) { ${REL_FIELDS} relations { edges { relationType node { ${REL_FIELDS} } } } }`
			)
			.join('\n')}
	}`;
	const data = (await (token
		? anilistAs(token, query, vars)
		: anilistPublic(query, vars))) as Record<string, RelAnswer['Media']> | null;
	ids.forEach((id, i) => out.set(id, data?.[`m${i}`] ?? null));
	return out;
}

export type RelationOffer = {
	/** The season it would go on. */
	season: number;
	part: number;
	anilistId: number;
	malId: number | null;
	title: string;
	format: string;
	episodes: number | null;
	year: number | null;
	/** "PREQUEL", "PREQUEL’S PREQUEL", "SEQUEL"; "SIDE STORY", "SPIN-OFF, NOT A SEQUEL". */
	how: string;
	/** Why it is ticked, or why it isn't: "COUNT AGREES", "24 EP. HERE · ANILIST LISTS 22". */
	why: string;
	ticked: boolean;
	/** The season is already linked to another entry: "REPLACES …", and never ticked. */
	replaces: string | null;
	/**
	 * Another season or part of the show already holds this entry (c418): the
	 * offer is shown, says which, and is never ticked, since `linkSeason`
	 * would refuse it.
	 */
	heldBy: { season: number; part: number } | null;
	/**
	 * A movie, a special, a side story, a spin-off: outside the seasons'
	 * numbering, dimmed, never ticked, never a season's candidate (c351).
	 */
	outside: boolean;
	candidate: Candidate;
};

const ABOVE: Record<number, string> = {
	[-1]: 'PREQUEL',
	[-2]: 'PREQUEL’S PREQUEL',
	[-3]: 'PREQUEL’S PREQUEL’S PREQUEL',
	1: 'SEQUEL',
	2: 'SEQUEL’S SEQUEL',
	3: 'SEQUEL’S SEQUEL’S SEQUEL'
};

/** The edges the seasons are numbered along: a SEQUEL is the next one, a PREQUEL the one before. */
const CHAIN: Record<string, 1 | -1> = { SEQUEL: 1, PREQUEL: -1 };

/**
 * The edges collected beside the chain, and the word each is listed under
 * (c351; the design's `SPECIAL Sword Art Online: Extra Edition` and
 * `SPIN-OFF Gun Gale Online`). Never followed further: a spin-off's own
 * sequel is the spin-off's, not this show's.
 */
const SIDE: Record<string, string> = {
	SIDE_STORY: 'SIDE STORY',
	SPIN_OFF: 'SPIN-OFF, NOT A SEQUEL'
};

/** "SEASON 3 HOLDS THIS ENTRY": what a door offering a held entry says of it (c418). */
export const holdsLine = (h: { season: number; part: number }): string =>
	`${seasonWords(h)} HOLDS THIS ENTRY`;

/** Side stories before spin-offs, as the design lists them; the chain's own first. */
const sideOrder = (how: string) => Object.values(SIDE).indexOf(how);

/** "SEASON 3", "SEASON 3 PART 2"; season 0, a flat list's, is named by none (c423). */
const seasonWords = (h: { season: number; part: number }): string =>
	`${h.season > 0 ? `SEASON ${h.season}` : 'THE EPISODES WITH NO SEASON'}${h.part > 1 ? ` PART ${h.part}` : ''}`;

/**
 * The other seasons, from the chosen entry's own relations: the chain walked
 * both ways (PREQUEL, SEQUEL), each entry placed at the season that far from
 * the one just linked, and ticked where its episode count agrees with the
 * season's -- or where two entries add up to it, one season in two parts.
 * A movie or a special standing on that chain, and a SIDE_STORY or SPIN_OFF
 * of any entry the walk asked about (c351), is listed outside the numbering:
 * dimmed, never ticked, and never kept as a season's candidate. An entry
 * another season or part of the show already holds is listed unticked, with
 * the season that holds it (c418). Null when the linked entry is unknown or
 * AniList can't be reached.
 *
 * The walk asks two rings: the linked entry, then its chain neighbours, in
 * one request; their own chain neighbours are placed from that answer. AniList
 * answers every edge an entry has, of every kind and in both directions, and
 * a chain can loop back or branch, so each entry is placed once, at the first
 * place the walk reaches it, and a chain place always outranks a side one.
 */
export async function seasonRelations(
	seriesId: number,
	season: number,
	/** The owner's token, when there is one; the catalogue is public without it. */
	token: string | null = null
): Promise<RelationOffer[] | null> {
	const view = seriesSeasons(seriesId);
	if (!view) return null;
	const own = view.seasons.find((s) => s.season === season);
	const linked = own?.link;
	if (!own || !linked?.anilistId) return null;
	const at = view.seasons.findIndex((s) => s.season === season);
	const first = await mediaMany(token, [linked.anilistId]);
	const start = first.get(linked.anilistId);
	if (!start) return null;
	// Level 0 is the entry just linked; a PREQUEL is -1, a SEQUEL +1.
	const level = new Map<number, { node: RelNode; at: number }>([
		[start.id, { node: start, at: 0 }]
	]);
	const side = new Map<number, { node: RelNode; how: string }>();
	/** One entry's edges: the chain's placed a step from it, the side kinds kept aside. */
	const collect = (fromAt: number, edges: { relationType: string; node: RelNode }[]) => {
		const placed: number[] = [];
		for (const e of edges) {
			const dir = CHAIN[e.relationType];
			if (dir) {
				if (level.has(e.node.id)) continue;
				level.set(e.node.id, { node: e.node, at: fromAt + dir });
				placed.push(e.node.id);
			} else if (SIDE[e.relationType] && !side.has(e.node.id))
				side.set(e.node.id, { node: e.node, how: SIDE[e.relationType] });
		}
		return placed;
	};
	const inner = collect(0, start.relations?.edges ?? []);
	// One more step out, asked in one request: the second season either way.
	const second = inner.length ? await mediaMany(token, inner) : new Map();
	for (const id of inner) {
		const answer = second.get(id);
		if (answer) collect(level.get(id)!.at, answer.relations?.edges ?? []);
	}
	const bySeason = new Map<
		number,
		{ node: RelNode; at: number; outside: boolean; how: string }[]
	>();
	const put = (key: number, x: { node: RelNode; at: number; outside: boolean; how: string }) =>
		bySeason.set(key, [...(bySeason.get(key) ?? []), x]);
	for (const [id, v] of level) {
		if (id === start.id) continue;
		const kind = candidateKind({ format: v.node.format ?? '', country: '' });
		const outside =
			!isAnime(kind) || v.node.format === 'MOVIE' || v.node.format === 'SPECIAL' || !ABOVE[v.at];
		const seasonAt = at + v.at;
		if (!outside && (seasonAt < 0 || seasonAt >= view.seasons.length)) continue;
		put(outside ? -1 : seasonAt, {
			node: v.node,
			at: v.at,
			outside,
			how: ABOVE[v.at] ?? 'OUTSIDE THE SEASONS’ NUMBERING'
		});
	}
	// Beside the chain, whatever its format: a TV side story is no season either.
	for (const [id, v] of side)
		if (id !== start.id && !level.has(id))
			put(-2, { node: v.node, at: 0, outside: true, how: v.how });
	const offers: RelationOffer[] = [];
	// A season's own count is what a catalogue's entry is checked against.
	const aired = (i: number) => view.seasons[i].aired;
	for (const [key, list] of bySeason) {
		if (key < 0) {
			// Outside the numbering: listed, dimmed, never ticked. Movie and special
			// first, as the design draws them, then the side stories and spin-offs.
			list.sort(
				(a, b) =>
					Number(a.node.format !== 'MOVIE') - Number(b.node.format !== 'MOVIE') ||
					sideOrder(a.how) - sideOrder(b.how) ||
					(a.node.seasonYear ?? 0) - (b.node.seasonYear ?? 0) ||
					a.node.id - b.node.id
			);
			for (const x of list)
				offers.push(offerOf(view, -1, 0, x, 'OUTSIDE THE SEASONS’ NUMBERING', false));
			continue;
		}
		const target = view.seasons[key];
		if (!target) continue;
		// In the order they aired (AniList's ids follow it within a year): part 1
		// is the earlier entry, whichever is longer. Sorting by count made SAO's
		// War of Underworld, 12 + 11, part 1 the 11-episode Part 2.
		const parts = list
			.filter((x) => !x.outside)
			.sort((a, b) => (a.node.seasonYear ?? 0) - (b.node.seasonYear ?? 0) || a.node.id - b.node.id);
		const have = aired(key);
		const already = target.link;
		if (
			parts.length >= 2 &&
			(parts[0].node.episodes ?? 0) + (parts[1].node.episodes ?? 0) === have
		) {
			// One season here, two entries there: the pair is ticked as one.
			const [a, b] = parts;
			const why = `${a.node.episodes} + ${b.node.episodes} = ${have}: ONE SEASON HERE, TWO ENTRIES THERE`;
			offers.push(offerOf(view, key, 1, a, why, !already, why));
			offers.push(offerOf(view, key, 2, b, why, !already, why));
			continue;
		}
		for (const x of parts) {
			const counts = x.node.episodes === have;
			const why = counts
				? `COUNT AGREES · ${have} EP.`
				: `${have} EP. HERE · ANILIST LISTS ${x.node.episodes ?? '—'}`;
			offers.push(
				offerOf(
					view,
					key,
					1,
					x,
					why,
					counts && !already,
					counts ? why : `${why} · A COUNT THAT DOESN’T IS LEFT UNTICKED`
				)
			);
		}
	}
	for (const o of offers) {
		if (o.outside) continue;
		const target = view.seasons.find((s) => s.season === o.season);
		const mine = target?.parts.find((p) => p.part === o.part)?.link ?? null;
		// The season's own entry, offered back to it: nothing to replace or tick.
		if (mine && mine.anilistId === o.anilistId) {
			o.ticked = false;
			o.why = 'ALREADY ITS LINK';
			continue;
		}
		// A season linked already says what its ticks would replace.
		if (target?.link) o.replaces = target.link.title || 'LINKED';
		// Held by another season or part (c418): `linkSeason` refuses it, so the
		// offer says by which, and is never ticked.
		const held = seasonHolding(seriesId, o.season, o.part, o.candidate);
		if (held) {
			o.ticked = false;
			o.heldBy = held;
			o.why = `${holdsLine(held)} · NEVER TICKED`;
		}
	}
	// One season in two parts is ticked as one: a held part unticks its pair.
	const pairs = new Set(offers.filter((o) => !o.outside && o.part > 1).map((o) => o.season));
	const heldPair = new Set(
		offers.filter((o) => !o.outside && o.heldBy && pairs.has(o.season)).map((o) => o.season)
	);
	for (const o of offers)
		if (!o.outside && !o.heldBy && o.ticked && heldPair.has(o.season)) {
			o.ticked = false;
			o.why = `${o.why} · ITS OTHER PART IS HELD`;
		}
	// The seasons in order, then what is outside their numbering, as the design
	// lists it: NOT OFFERED, at the end.
	offers.sort(
		(a, b) => Number(a.outside) - Number(b.outside) || a.season - b.season || a.part - b.part
	);
	// Kept as each season's candidates, so LINK 3 SEASONS reads them back by id
	// through the same door a searched candidate comes through, rather than
	// trusting the page's own copy of the entry.
	rememberOffers(seriesId, offers);
	return offers;
}

/**
 * The offers as a season's candidates, without touching the search that found
 * it. Only a season's: nothing outside the numbering (c351), and nothing
 * another season holds (c418), which no door would link anyway.
 */
function rememberOffers(seriesId: number, offers: RelationOffer[]): void {
	const db = getDb();
	const put = db.prepare(
		`INSERT OR REPLACE INTO season_link_candidates (series_id, season, part, anilist_id, rank, data)
		VALUES (?, ?, ?, ?, ?, ?)`
	);
	db.transaction(() => {
		offers
			.filter((o) => !o.outside && !o.heldBy)
			.forEach((o, rank) =>
				put.run(seriesId, o.season, o.part, o.anilistId, rank, JSON.stringify(o.candidate))
			);
	})();
}

function offerOf(
	view: SeriesSeasons,
	key: number,
	part: number,
	x: { node: RelNode; at: number; outside: boolean; how: string },
	why: string,
	ticked: boolean,
	said?: string
): RelationOffer {
	const node = x.node;
	const c = toCandidate({
		...(node as unknown as Media),
		countryOfOrigin: 'JP'
	});
	const season = key >= 0 ? view.seasons[key] : view.seasons[0];
	return {
		season: season?.season ?? 0,
		part,
		anilistId: node.id,
		malId: node.idMal ?? null,
		title: c.title,
		format: c.format,
		episodes: node.episodes,
		year: node.seasonYear,
		how: x.how,
		why: said ?? why,
		ticked,
		replaces: null,
		heldBy: null,
		outside: x.outside,
		candidate: c
	};
}

/** Resolve a season link's MAL half, as `resolveLinks` does for a series' (a link can be pasted as one id). */
export async function resolveSeasonLinks(now = Date.now()): Promise<number> {
	const db = getDb();
	const waiting = db
		.prepare(
			`SELECT series_id, season, part, anilist_id, mal_id FROM series_season_links
			WHERE resolved_at IS NULL OR (format IS NULL AND anilist_id IS NOT NULL)`
		)
		.all() as {
		series_id: number;
		season: number;
		part: number;
		anilist_id: number | null;
		mal_id: number | null;
	}[];
	if (!waiting.length) return 0;
	const set = db.prepare(
		`UPDATE series_season_links SET anilist_id = ?, mal_id = COALESCE(?, mal_id), title = ?,
			cover_url = ?, resolved_at = ?, format = ?, episodes = ?, year = ?
		WHERE series_id = ? AND season = ? AND part = ?`
	);
	const none = db.prepare(
		`UPDATE series_season_links SET resolved_at = ?, format = COALESCE(format, '')
		WHERE series_id = ? AND season = ? AND part = ?`
	);
	const byAl = new Map<number, Candidate>();
	const byMal = new Map<number, Candidate>();
	const ids = waiting.flatMap((w) => (w.anilist_id ? [w.anilist_id] : w.mal_id ? [w.mal_id] : []));
	try {
		// Fifty ids a request; a season's own id is read in AniList's ANIME catalogue.
		for (let i = 0; i < ids.length; i += 50) {
			const data = (await anilistAs(
				(
					getDb()
						.prepare(`SELECT access_token FROM tracker_accounts WHERE service = 'anilist'`)
						.get() as { access_token: string } | undefined
				)?.access_token ?? '',
				`query ($ids: [Int]) { Page(perPage: 50) { media(id_in: $ids, type: ANIME) { ...M } } } ${MEDIA}`,
				{ ids: ids.slice(i, i + 50) }
			)) as { Page: { media: Media[] } } | null;
			for (const c of (data?.Page.media ?? []).map(toCandidate)) {
				byAl.set(c.anilistId, c);
				if (c.malId !== null) byMal.set(c.malId, c);
			}
		}
	} catch (e) {
		if (e instanceof Unreachable) return 0;
		throw e;
	}
	let n = 0;
	db.transaction(() => {
		for (const w of waiting) {
			const c = w.anilist_id ? byAl.get(w.anilist_id) : w.mal_id ? byMal.get(w.mal_id) : undefined;
			if (c) {
				set.run(
					c.anilistId,
					c.malId,
					c.title,
					c.coverUrl,
					now,
					c.format,
					c.episodes ?? null,
					c.year,
					w.series_id,
					w.season,
					w.part
				);
				n += 1;
			} else none.run(now, w.series_id, w.season, w.part);
		}
	})();
	return n;
}

/** The entry's own kind, from its stored format: the door OPEN and the send use (c298). */
export const seasonKind = (l: SeasonLink): Kind | null =>
	l.format ? candidateKind({ format: l.format, country: '' }) : null;

/** Whether a season's link sends nothing: across kinds, or the other kind's entry. */
export const seasonUntracked = (seriesKind: Kind, l: SeasonLink): boolean =>
	coverOnly(seriesKind, l.format ?? '') || wrongKind(seriesKind, l.format ?? '');

/**
 * Which season an entry on the owner's list is, by the titles it carries: a
 * season's own search title ("Sword Art Online Season 3") or the series' own
 * for season 1. The open season when nothing matches -- the list gave no
 * season, and the one being watched is the best guess there is.
 */
export function seasonForTitles(seriesId: number, titles: string[]): number {
	const view = seriesSeasons(seriesId);
	if (!view) return 0;
	const keys = new Set(titles.map(normaliseTitle));
	const hit = view.seasons.find(
		(s) =>
			keys.has(normaliseTitle(s.searchTitle)) ||
			(s.season <= 1 && keys.has(normaliseTitle(view.title)))
	);
	return hit?.season ?? view.open;
}

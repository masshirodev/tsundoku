import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { isRevealed } from '$lib/server/prefs';
import { refreshCovers } from '$lib/server/covers';
import {
	Unreachable,
	asReviewCandidate,
	kindOf,
	link,
	noneOfThese,
	offered,
	readPasted,
	reviewItem,
	searchNow,
	undoSearch,
	seriesAccess,
	skip,
	undoLink,
	undoNone,
	unlink,
	type QueuedFrom
} from '$lib/server/catalogue';
import {
	holdsLine,
	linkPicks,
	parseSeasonUndoFacts,
	seasonsLinked,
	SeasonUndoRefused,
	linkSeason,
	seasonHolding,
	seasonRelations,
	secondPartRefusal,
	seriesSeasons,
	undoSeasonLink,
	undoSeasonLinks
} from '$lib/server/season-links';
import { seasonReview } from '../../links/review-state.server';
import { isAnime, parsePasted } from '$lib/library/catalogue';
import { account } from '$lib/server/tracking';

type Pick = { season: number; part?: number; anilistId: number };

type Body = {
	series?: number;
	/** LINK: an AniList id the review offered, or a pasted one (`pasted`). */
	link?: number;
	pasted?: boolean;
	none?: boolean;
	skip?: boolean;
	/** SEARCH AGAIN: the title to search, now (the next pass, if AniList is out of reach). */
	search?: string;
	/** PASTE A LINK: read as one candidate; nothing is linked yet. */
	paste?: string;
	unlink?: boolean;
	undo?: 'link' | 'none' | 'search' | 'seasons';
	was?: QueuedFrom;
	/** LINK N SEASONS' UNDO: the seasons the post wrote, and each part as it stood. */
	facts?: unknown;
	/** One season of an anime: FIND on its line, and LINK A TO SEASON n. */
	season?: number;
	part?: number;
	/**
	 * `+ A SECOND PART`'s LINK: the season's episode part 2 starts at.
	 * It must be part 1's count + 1, the one start the schema keeps.
	 */
	from?: number;
	/**
	 * LINK 3 SEASONS: the entries picked on the relations page. `season` with
	 * it is the season the page is on, which the answer redraws.
	 */
	seasons?: Pick[];
};

/**
 * The link review's decisions (doc/LINKS.md), one series at a time, each
 * carried out at once; UNDO takes the last back. Hidden means hidden: a
 * hidden series is a 404 while reveal is off, and is never searched even
 * with it on -- only a pasted link, which sends nothing but its id.
 *
 * A season of an anime is its own decision: the search asks the anime
 * catalogue with that season's title, LINK writes that season's row, and
 * LINK 3 SEASONS writes the ones the relations offered.
 */
export const POST: RequestHandler = async ({ request, cookies }) => {
	const b = (await request.json().catch(() => null)) as Body | null;
	const seriesId = Number(b?.series);
	if (!b || !Number.isInteger(seriesId)) error(400, 'which series');
	const reveal = isRevealed(cookies);
	const access = seriesAccess(seriesId, reveal);
	if (!access) error(404, 'not found');
	const kind = kindOf(seriesId);
	// A kind a catalogue lists a season at a time: its search, LINK and
	// their UNDO are the named season's.
	const seasonal = isAnime(kind);
	const season = Number.isInteger(b.season) ? Number(b.season) : undefined;
	const part = Number.isInteger(b.part) && (b.part ?? 0) > 0 ? Number(b.part) : 1;
	// A season holds two parts at most (`CHECK (part IN (1, 2))`).
	if (part > 2) error(400, 'a season has two parts at most');
	// The item a season's search and paste are drawn against: the part the page
	// posted, part 1's when it posted none. A season whose only row is
	// part 2 (part 1 unlinked, e.g. a CHANGE of part 1 then its UNDO) posts
	// `part: 2` and gets part 2's own search and candidates, never part
	// 1's.
	const itemFor = () =>
		seasonal && season !== undefined
			? reviewItem(seriesId, reveal, season, part)
			: reviewItem(seriesId, reveal, seasonal ? season : undefined);
	const recover = (remote: boolean) =>
		void refreshCovers({ ids: [seriesId], remote }).catch(() => undefined);

	try {
		if (b.undo === 'link') {
			// A part 1 that would leave its season's part 2 without a part 1 is
			// refused, saying so: nothing changes.
			try {
				undoLink(seriesId, season, part);
			} catch (e) {
				if (e instanceof SeasonUndoRefused) error(409, e.message);
				throw e;
			}
			recover(false);
			return json({ ok: true });
		}
		// LINK N SEASONS' UNDO: every season its band's post wrote, and
		// only those, back as they stood. Refused whole when any was linked or
		// decided again since.
		if (b.undo === 'seasons') {
			const facts = parseSeasonUndoFacts(b.facts, seriesId);
			if (!facts) error(400, 'NOTHING TO UNDO');
			try {
				undoSeasonLinks(facts);
			} catch (e) {
				if (e instanceof SeasonUndoRefused) error(409, e.message);
				throw e;
			}
			recover(false);
			return json({ ok: true });
		}
		if (b.undo === 'none') return json({ ok: await undoNone(seriesId, season, part) });
		if (b.undo === 'search') {
			undoSearch(seriesId, b.was ?? undefined, { season, part });
			recover(false);
			return json({ ok: true });
		}
		if (b.unlink) {
			// A second part's own UNLINK takes part 2's row alone, and
			// settles nothing: part 1 is still linked, so the season is too.
			if (seasonal && season !== undefined && part === 2) {
				undoSeasonLink(seriesId, season, 2);
				recover(false);
				return json({ ok: true });
			}
			unlink(seriesId, Date.now(), season);
			recover(false);
			return json({ ok: true });
		}
		if (b.none) {
			noneOfThese(seriesId, Date.now(), season, part);
			return json({ ok: true });
		}
		if (b.skip) {
			skip(seriesId, Date.now(), season);
			return json({ ok: true });
		}
		if (typeof b.search === 'string') {
			if (access.hidden) error(409, 'hidden series are never searched');
			const r = await searchNow(
				seriesId,
				b.search,
				Date.now(),
				seasonal && season !== undefined ? { season, part } : {}
			);
			// The review draws the series it just searched, so the item carries the catalogue
			// it came from: the page files items by `service:id`. An
			// anime's is the season's own search, the one record of it.
			const item = itemFor();
			return json({ ...r, item: item ? { ...item, service: 'anilist' as const } : null });
		}
		if (typeof b.paste === 'string') {
			// The posted season's item, as the search's: the pasted entry's rows
			// are checked against that season's title and episodes.
			const item = itemFor();
			if (!item) error(404, 'not found');
			const p = parsePasted(b.paste, item.kind);
			if (!p)
				error(
					400,
					isAnime(item.kind)
						? 'not an AniList or MAL anime link'
						: 'not an AniList or MAL manga link'
				);
			const candidate = asReviewCandidate(item, await readPasted(p, item.kind));
			// A pasted entry another season of the show holds is read, and said to
			// be held, since LINK would refuse it: a paste offers a season an entry
			// too.
			const heldBy =
				seasonal && season !== undefined ? seasonHolding(seriesId, season, part, candidate) : null;
			return json({ candidate, held: heldBy ? `${holdsLine(heldBy)} · LINK REFUSES IT` : null });
		}
		// LINK 3 SEASONS: every entry the relations page ticked, at once, each at
		// its own part (a pair's part 2 is part 2's offer). The answer is what was
		// written, and each pick refused with the season that holds its entry, so
		// the page says the true count.
		if (Array.isArray(b.seasons) && b.seasons.length) {
			if (!kind || !seasonal) error(400, 'only a season is linked this way');
			const picks = b.seasons
				.filter((p) => Number.isInteger(p?.season) && Number.isInteger(p?.anilistId))
				.map((p) => ({
					season: p.season,
					part: Number.isInteger(p.part) && (p.part ?? 0) > 0 ? Number(p.part) : 1,
					anilistId: p.anilistId
				}));
			const { linked, refused, facts } = linkPicks(seriesId, kind, picks);
			// Nothing written is a refusal, as everywhere else a link is made; it still
			// says which seasons, and why.
			// Counted in seasons, not parts: a pair is one.
			const count = seasonsLinked(linked, refused);
			if (!linked.length) return json({ ok: false, ...count, refused }, { status: 409 });
			recover(true);
			// The season the page is on, as it now stands: a partial link
			// leaves the page there, which redraws it from this rather than from
			// the review it opened on.
			const view = season !== undefined ? seriesSeasons(seriesId) : null;
			const at = view?.seasons.find((s) => s.season === season) ?? null;
			const review = at ? seasonReview(seriesId, at, view!.seasons.length, access.hidden) : null;
			// `facts` is the band's UNDO: what the post wrote, and what each
			// part it wrote stood as before.
			return json({ ok: true, ...count, refused, review, facts });
		}
		if (typeof b.link === 'number') {
			if (!kind) error(404, 'not found');
			const c = b.pasted
				? await readPasted({ service: 'anilist', id: b.link }, kind)
				: offered(seriesId, b.link, season, part);
			if (!c) error(409, 'not a candidate');
			// `+ A SECOND PART`: part 2 starts where part 1's count ends,
			// the one start the schema can keep; another start is refused, saying
			// where it does start, and nothing is written.
			const second = seasonal && season !== undefined && part === 2 && b.from !== undefined;
			if (second) {
				const why = secondPartRefusal(seriesId, season!, Number(b.from));
				if (why) error(409, why);
			}
			// Refused when another season of the show holds the entry (a pasted
			// link of season 1 for season 2): nothing is written.
			const done =
				seasonal && season !== undefined
					? linkSeason(seriesId, season, part, c, b.pasted ? 'pasted' : 'review')
					: link(seriesId, c, b.pasted ? 'pasted' : 'review');
			if (!done) error(409, 'another season holds that entry');
			// The cover follows in the background: the link's, if nothing comes before it.
			recover(true);
			// And the rest of the show, from the entry just chosen.
			let relations = null;
			// A second part's LINK goes back to the series: nothing more to offer.
			if (seasonal && season !== undefined && !second)
				relations = await seasonRelations(
					seriesId,
					season,
					account('anilist')?.access_token ?? null
				).catch(() => null);
			return json({
				ok: true,
				title: c.title,
				anilistId: c.anilistId,
				malId: c.malId,
				relations
			});
		}
	} catch (e) {
		if (e instanceof Unreachable) error(503, 'AniList unreachable');
		throw e;
	}
	error(400, 'what to do');
};

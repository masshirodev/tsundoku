import { people, statusOf } from './mihon-plan.ts';
import type { PlannedEntry, PlannedSeries, PlannedTag } from './plan.ts';
import { animeKeyOf } from '../library/downloads.ts';

/**
 * An anime from an Aniyomi source as a series to write (doc/ANIME.md; card
 * c154): what the engine's getDetailsAnime and getEpisodeList answered,
 * every episode NOT DOWNLOADED, through the importers' one writer. Pure.
 *
 * The season comes from the episode's name where the engine flattens a
 * source's seasons into one list ("Season 2 - Episode 3"), and otherwise from
 * the entry itself, since KickAssAnime and AnimePahe make each season its own
 * entry ("… 3rd Season", `-season-3`). A list with neither stays flat, as
 * most do.
 */

export type AnimeEpisode = {
	url: string;
	name: string;
	/** Aniyomi's episode_number: -1 or 0 when the source didn't say. */
	episode_number?: number | null;
	date_upload?: number | null;
	scanlator?: string | null;
	/** The episode's own picture, through the engine's /image/ proxy, where the extension sets one. */
	preview_url?: string | null;
};

export type AnimeDetails = {
	sourceId: string;
	/** The source's name: the series' `source`, as the handoff names it ("ANIMEPAHE"). */
	sourceName: string;
	url: string;
	title: string;
	description?: string | null;
	author?: string | null;
	artist?: string | null;
	genres?: string[];
	/** Aniyomi's SAnime status number. */
	status?: number | null;
	thumbnailUrl?: string;
};

/**
 * "Season 2 - Episode 3", "S2 - Ep 3", "Part 2 Season 3 - …": its season, and
 * the rest of the name. Also with no separator, when the episode follows the
 * season straight away ("Season 4  Ep 8", "S2 Episode 3"): a source that packs
 * its seasons into one entry names them so, and read without the season its
 * list came out interleaved by number (c998).
 */
export function seasonOf(name: string): { season: number | null; rest: string } {
	const bare = /^(?:.*?\s)?(?:season\s*(\d{1,3})|s(\d{1,3}))\s+((?:episode|ep)\b\.?\s*\d.*)$/i.exec(
		name.trim()
	);
	if (bare) return { season: Number(bare[1] ?? bare[2]), rest: bare[3].trim() };
	const m = /^(.*?)\s+[-–:]\s+(.+)$/.exec(name.trim());
	if (m) {
		const s = /\bseason\s*(\d{1,3})\b|^s(\d{1,3})$/i.exec(m[1].trim());
		if (s) return { season: Number(s[1] ?? s[2]), rest: m[2].trim() };
	}
	return { season: null, rest: name.trim() };
}

/**
 * The season a source entry is, read from the entry itself: KickAssAnime and
 * AnimePahe make each season its own entry with a flat episode list, so
 * "… 3rd Season" (or a `-season-3` slug) is the only place the season is
 * said. A source that flattens its seasons into one entry says it per
 * episode instead ([seasonOf]), and that always wins.
 */
export function seasonOfTitle(title: string, url = ''): number | null {
	const t = title.trim();
	// "Lupin (Season 1-4)": a pack of seasons is no one season. Read as its
	// first, it stamped season 1 on all four seasons' episodes (c998); with
	// none, episodes that name their season still say it, and the rest stay flat.
	if (seasonRange(t, url)) return null;
	const after = /\bseason\s*(\d{1,3})\b/i.exec(t);
	if (after) return Number(after[1]);
	// "3rd Season": the ordinal comes before the word, as Honzuki's does.
	const before = /\b(\d{1,2})(?:st|nd|rd|th)\s+season\b/i.exec(t);
	if (before) return Number(before[1]);
	const slug = /-season-(\d{1,3})(?:-|$)/i.exec(url);
	if (slug) return Number(slug[1]);
	const ordinalSlug = /-(\d{1,2})(?:st|nd|rd|th)-season(?:-|$)/i.exec(url);
	return ordinalSlug ? Number(ordinalSlug[1]) : null;
}

/**
 * Whether the entry is a pack of seasons ("Season 1-4", "Seasons 1 to 3",
 * "S1-S4", a `-season-1-4` slug): two season numbers, the second the later.
 */
function seasonRange(title: string, url: string): boolean {
	const range = (a: string, b: string) => Number(b) > Number(a);
	const t =
		/\b(?:seasons?\s*|s)(\d{1,3})\s*(?:-|–|to|&|and)\s*(?:s(?:eason)?\s*)?(\d{1,3})\b/i.exec(title);
	if (t && range(t[1], t[2])) return true;
	const slug = /-seasons?-(\d{1,3})-(?:to-)?(\d{1,3})(?:-|$)/i.exec(url);
	return !!slug && range(slug[1], slug[2]);
}

/** "Episode 12", "Ep. 12.5", "EP12": the number a name gives, or null. */
export function numberOf(name: string): number | null {
	const m = /\b(?:episode|ep)\.?\s*(\d+(?:\.\d+)?)/i.exec(name) ?? /^(\d+(?:\.\d+)?)\b/.exec(name);
	return m ? Number(m[1]) : null;
}

/** The episode's own title: its name without "Episode 3" in front, '' when that's all it is. */
export function titleOf(rest: string): string {
	const t = rest
		.replace(/^(?:episode|ep)\.?\s*\d+(?:\.\d+)?\s*(?:[-–:.]\s*)?/i, '')
		.replace(/^\d+(?:\.\d+)?\s*[-–:.]\s*/, '')
		.trim();
	return /^(?:episode|ep)\.?\s*\d+(?:\.\d+)?$/i.test(t) ? '' : t;
}

export function planAnime(d: AnimeDetails, episodes: AnimeEpisode[], now: number): PlannedSeries {
	// The season the entry itself is, for a source that makes each season its
	// own series (seasonOfTitle): the name of an episode wins over it, since a
	// source that flattens seasons names the season on every one.
	const ownSeason = seasonOfTitle(d.title, d.url);
	// The source lists newest first, as Mihon lists chapters, season by season.
	const seen = new Set<string>();
	const rows = episodes
		.filter((e) => e.url && !seen.has(e.url) && seen.add(e.url))
		.map((e, i) => {
			const { season, rest } = seasonOf(e.name);
			const given = typeof e.episode_number === 'number' && e.episode_number > 0;
			return {
				e,
				order: i,
				season: season ?? ownSeason,
				number: given ? e.episode_number! : numberOf(rest),
				title: titleOf(rest)
			};
		});
	const seasons = [...new Set(rows.map((r) => r.season))];
	// Seasons in their own order, each oldest first; a number the source
	// didn't give is placed by where the source listed it.
	rows.sort(
		(a, b) =>
			(a.season ?? 0) - (b.season ?? 0) ||
			(a.number !== null && b.number !== null ? a.number - b.number : 0) ||
			b.order - a.order
	);
	const counters = new Map<number | null, number>();
	const entries: PlannedEntry[] = rows.map((r, i) => {
		const n = r.number ?? (counters.get(r.season) ?? 0) + 1;
		counters.set(r.season, n);
		return {
			position: i + 1,
			label: `Ep. ${n}`,
			title: r.title,
			sourceUrl: r.e.url,
			available: false,
			file: '',
			bytes: 0,
			pageCount: 0,
			addedAt: r.e.date_upload || now,
			readAt: null,
			lastPosition: null,
			lastOpenedAt: null,
			history: null,
			scanlator: r.e.scanlator ?? '',
			episode: {
				season: seasons.length > 1 || r.season !== null ? r.season : null,
				number: n,
				note: '',
				durationS: null,
				thumbUrl: r.e.preview_url ?? ''
			}
		};
	});
	const tags: PlannedTag[] = [];
	const add = (namespace: string, value: string) => {
		const v = value.trim();
		if (v && !tags.some((t) => t.namespace === namespace && t.value === v))
			tags.push({ namespace, value: v });
	};
	for (const g of d.genres ?? []) add('genre', g.toLowerCase());
	// The importers' one split (c508): `/`, `;` and ` & ` too, and "Tanaka, Jr."
	// one person, as Mihon's, LNReader's and the preview's are.
	for (const a of people(d.author ?? '')) add('author', a);
	for (const a of people(d.artist ?? '')) add('artist', a);
	add('source', d.sourceName);
	return {
		originKey: animeKeyOf(d.sourceId, d.url),
		source: d.sourceName,
		title: d.title.trim() || d.url,
		kind: 'anime',
		rating: 0,
		favourite: false,
		hidden: false,
		shelves: [],
		tags,
		description: (d.description ?? '').trim(),
		// Aniyomi numbers statuses as Mihon does.
		status: statusOf(d.status ?? 0),
		direction: null,
		addedAt: now,
		sourceUrl: d.url,
		coverUrl: d.thumbnailUrl || undefined,
		path: '',
		entries
	};
}

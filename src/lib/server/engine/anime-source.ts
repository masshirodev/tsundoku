import { join } from '../fspath.ts';
import { getDb } from '../db.ts';
import { ensureNamedRoot, writeSeries } from '../import/write.ts';
import { libraryRoot } from '../import/index.ts';
import { refreshCovers } from '../covers.ts';
import { keepOrPromote } from '../browsing.ts';
import { forgetSourceUse } from '../library-sources.ts';
import { checkPublic } from '../net-guard.ts';
import { coverRoute } from '../novels/source.ts';
import { planAnime, type AnimeEpisode } from '../../import/anime-plan.ts';
import { animeKeyOf } from '../../library/downloads.ts';
import type { SourceManga } from '../download-types.ts';
import { engineImageToken } from './client.ts';
import { splitMemo } from './protocol.ts';
import { hideIfAddedHidden } from './source-flags.ts';
import { seriesHolding } from '../season-facts.ts';
import {
	AddError,
	callSource,
	imageRoute,
	parseSourceMangaId,
	sourceName,
	type EngineManga
} from './backend.ts';

/**
 * An Aniyomi source's anime, previewed and added (doc/ANIME.md; card c154),
 * as backend.ts does a Mihon source's manga. BROWSE and search ask an anime
 * source through the same calls (callSource names them for it), so only
 * the preview, ADD and the key differ: an anime series is
 * `aniyomi:<source>:<url>`, its entries episodes, in the Anime root.
 */

/** Where anime lives (doc/ANIME.md): `$LIBRARY_ROOT/Anime`, the folder a Jellyfin library can read (c157). */
export const animeRoot = () => join(libraryRoot(), 'Anime');

/** An anime's cover: the engine's /image/ proxy when it gave one, else the site's, fetched by the server. */
function coverOf(url: string | null | undefined): string {
	if (!url) return '';
	return imageRoute(url) || coverRoute(url);
}

export async function fetchAnime(id: string): Promise<{
	sourceId: string;
	details: EngineManga & { url: string; title: string };
	episodes: AnimeEpisode[];
} | null> {
	const ref = parseSourceMangaId(id);
	if (!ref) return null;
	const details = await callSource<EngineManga>(
		ref.sourceId,
		'getDetailsManga',
		{ mangaData: { url: ref.url } },
		60_000
	);
	const url = details.url || ref.url;
	const episodes = await callSource<AnimeEpisode[]>(
		ref.sourceId,
		'getChapterList',
		{ mangaData: { ...details, url } },
		60_000
	);
	return {
		sourceId: ref.sourceId,
		details: { ...details, url, title: details.title || '' },
		episodes: Array.isArray(episodes) ? episodes : []
	};
}

/** The plan both the preview and ADD read, so the preview numbers episodes as the series will. */
export function planOf(a: NonNullable<Awaited<ReturnType<typeof fetchAnime>>>, now: number) {
	return planAnime(
		{
			sourceId: a.sourceId,
			sourceName: sourceName(a.sourceId),
			url: splitMemo(a.details.url).url,
			title: a.details.title,
			description: a.details.description,
			author: a.details.author,
			artist: a.details.artist,
			genres: (a.details.genre ?? '')
				.split(',')
				.map((g) => g.trim())
				.filter(Boolean),
			status: a.details.status
		},
		a.episodes.map((e) => ({ ...e, url: splitMemo(e.url).url })),
		now
	);
}

const STATUS_NAME = ['', 'ONGOING', 'COMPLETED', 'LICENSED', 'COMPLETED', 'CANCELLED', 'ON_HIATUS'];

/** The preview of an anime: its episodes newest first, as a source's chapters are listed there. */
export async function animeManga(id: string): Promise<SourceManga | null> {
	const a = await fetchAnime(id);
	if (!a) return null;
	const now = Date.now();
	const plan = planOf(a, now);
	// "S3" in the preview wherever the plan knows a season at all, which since
	// c219 includes the entry's own title: it's the only place the season is
	// said before ADD.
	const seasons = plan.entries.some((e) => e.episode?.season != null);
	const lang = (
		getDb().prepare(`SELECT lang FROM engine_sources WHERE id = ?`).get(a.sourceId) as
			{ lang: string } | undefined
	)?.lang;
	return {
		id,
		kind: 'anime',
		title: plan.title,
		description: plan.description,
		author: a.details.author ?? '',
		artist: a.details.artist ?? '',
		genres: plan.tags.filter((t) => t.namespace === 'genre').map((t) => t.value),
		status: STATUS_NAME[a.details.status ?? 0] ?? '',
		source: sourceName(a.sourceId),
		sourceId: a.sourceId,
		url: a.details.url,
		inLibrary: false,
		thumbnailUrl: a.details.thumbnail_url ?? '',
		cover: coverOf(a.details.thumbnail_url),
		realUrl: '',
		lang: (lang ?? '').toUpperCase(),
		chapters: [...plan.entries].reverse().map((e, i) => {
			const s = e.episode?.season;
			const name = [seasons && s != null ? `S${s}` : '', e.label, e.title].filter(Boolean);
			return {
				id: String(i),
				url: e.sourceUrl,
				name: name.join(' · '),
				number: e.episode?.number ?? -1,
				scanlator: e.scanlator ?? '',
				sourceOrder: i,
				uploadDate: e.addedAt === now ? 0 : e.addedAt,
				fetchedAt: now
			};
		})
	};
}

/** The key an anime result would have here, for opening the series instead of its preview. */
export function animeKey(id: string): string | null {
	const ref = parseSourceMangaId(id);
	return ref ? animeKeyOf(ref.sourceId, splitMemo(ref.url).url) : null;
}

/**
 * ADD TO LIBRARY for an anime: a series at once, every episode NOT DOWNLOADED,
 * through the one writer. A browsing record of it (doc/BROWSING.md) becomes
 * the library's series, its progress and history kept: it was the same series
 * all along.
 */
export async function addAnime(id: string, now = Date.now()): Promise<number> {
	const key = animeKey(id);
	if (!key) throw new AddError('That isn’t an anime');
	const db = getDb();
	const existing = seriesHolding(key, db);
	if (existing) return keepOrPromote(existing, false, now, db);
	const seriesId = await writeAnime(id, key, now, false);
	db.prepare(`UPDATE series SET arrived_at = ? WHERE id = ?`).run(now, seriesId);
	// ADD from a source that adds hidden (card c435): it starts hidden.
	if (hideIfAddedHidden(seriesId, db)) forgetSourceUse();
	return seriesId;
}

/**
 * Opening an anime from its preview without ADD (doc/BROWSING.md; card c161):
 * the series it is, the library's when it's in it, else a browsing record,
 * written on the first open, so the player, its progress and HISTORY work on
 * it as on any series. On no shelf until ADD.
 */
export async function browseAnime(id: string, now = Date.now()): Promise<number> {
	const key = animeKey(id);
	if (!key) throw new AddError('That isn’t an anime');
	const db = getDb();
	const existing = seriesHolding(key, db);
	if (existing) return keepOrPromote(existing, true, now, db);
	return writeAnime(id, key, now, true);
}

async function writeAnime(
	id: string,
	key: string,
	now: number,
	browsing: boolean
): Promise<number> {
	const db = getDb();
	const a = await fetchAnime(id);
	if (!a) throw new AddError('That anime isn’t at its source');
	const plan = planOf(a, now);
	// The key is the URL asked for, as a novel's is the path: an answer with
	// another spelling of it mustn't make a second series.
	plan.originKey = key;
	plan.coverUrl = await coverAddress(a.details.thumbnail_url);
	const rootId = ensureNamedRoot(db, 'Anime', animeRoot(), false);
	writeSeries(plan, { rootId, jobId: null, now, browsing });
	const row = db.prepare(`SELECT id FROM series WHERE origin_key = ?`).get(key) as
		{ id: number } | undefined;
	if (!row) {
		const buried = db.prepare(`SELECT 1 FROM tombstones WHERE key = ?`).get(key);
		throw new AddError(
			buried ? 'that anime was deleted here once, and stays gone' : 'it couldn’t be added'
		);
	}
	if (!browsing) forgetSourceUse();
	void refreshCovers({ ids: [row.id], remote: true });
	return row.id;
}

/**
 * The cover the library keeps: the engine's /image/ proxy for the cover
 * pass (with the engine's token, as a manga's), or the site's address when
 * it's on the internet.
 */
async function coverAddress(url: string | null | undefined): Promise<string | undefined> {
	if (!url) return undefined;
	const engine = process.env.ENGINE_URL?.replace(/\/$/, '');
	const token = engineImageToken(url);
	if (token) return engine ? `${engine}/image/${token}` : undefined;
	try {
		return (await checkPublic(url)).toString();
	} catch {
		return undefined;
	}
}

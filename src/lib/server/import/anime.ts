import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { isUnder } from '../paths.ts';
import type { PlannedEntry, PlannedSeries } from '../../import/plan.ts';
import {
	ANIME_FOLDER,
	HIDDEN_ANIME_FOLDER,
	readEpisodeNfo,
	readTvshowNfo
} from '../../library/anime-files.ts';

/**
 * The anime folders as series (doc/ANIME.md, "Downloading"; card c157):
 * every series folder under `Anime/` and `Anime (hidden)/` with a
 * tvshow.nfo tsundoku wrote, and every episode in it with its .nfo, folded
 * onto the `aniyomi:` series and the episodes they name. The importer stays
 * the one place a file becomes an entry, as for chapters and books. A folder
 * someone else put there (no tsundoku key) is left alone.
 */

const listDirs = (dir: string) => {
	try {
		return readdirSync(dir, { withFileTypes: true })
			.filter((d) => d.isDirectory())
			.map((d) => d.name)
			.sort();
	} catch {
		return [];
	}
};

/** The series folders: what `bytes` counts and `plan` reads. */
export function animeSeriesDirs(library: string): { dir: string; hidden: boolean }[] {
	return [
		...listDirs(join(library, ANIME_FOLDER)).map((n) => ({
			dir: join(library, ANIME_FOLDER, n),
			hidden: false
		})),
		...listDirs(join(library, HIDDEN_ANIME_FOLDER)).map((n) => ({
			dir: join(library, HIDDEN_ANIME_FOLDER, n),
			hidden: true
		}))
	].filter((f) => existsSync(join(f.dir, 'tvshow.nfo')));
}

function episodesIn(dir: string): { rel: string; abs: string }[] {
	const out: { rel: string; abs: string }[] = [];
	for (const season of listDirs(dir)) {
		let names: string[];
		try {
			names = readdirSync(join(dir, season)).sort();
		} catch {
			continue;
		}
		for (const n of names)
			if (/\.mkv$/i.test(n)) out.push({ rel: `${season}/${n}`, abs: join(dir, season, n) });
	}
	return out;
}

export function animeBytes(library: string): number {
	let n = 0;
	for (const f of animeSeriesDirs(library))
		for (const e of episodesIn(f.dir)) {
			try {
				n += statSync(e.abs).size;
			} catch {
				// Gone between the listing and the size.
			}
		}
	return n;
}

export function planAnimeFolders(
	library: string,
	progress: (p: { bytes: number; failed: boolean }) => void,
	now: number
): PlannedSeries[] {
	const out: PlannedSeries[] = [];
	for (const f of animeSeriesDirs(library)) {
		const s = planAnimeDir(f, progress, now);
		if (s) out.push(s);
	}
	return out;
}

/**
 * The one series an episode file belongs to, planned as planAnimeFolders
 * plans it (attachWritten, import/index.ts): the series folder holding it, whole.
 */
export function planAnimeSeries(library: string, file: string, now: number): PlannedSeries[] {
	const f = animeSeriesDirs(library).find((d) => isUnder(file, d.dir));
	const s = f ? planAnimeDir(f, () => {}, now) : null;
	return s ? [s] : [];
}

function planAnimeDir(
	f: { dir: string; hidden: boolean },
	progress: (p: { bytes: number; failed: boolean }) => void,
	now: number
): PlannedSeries | null {
	const show = readTvshowNfo(readFileSync(join(f.dir, 'tvshow.nfo'), 'utf8'));
	if (!show) return null;
	const entries: PlannedEntry[] = [];
	for (const ep of episodesIn(f.dir)) {
		const nfoPath = ep.abs.replace(/\.mkv$/i, '.nfo');
		let st;
		try {
			st = statSync(ep.abs);
		} catch {
			continue;
		}
		const nfo = existsSync(nfoPath) ? readEpisodeNfo(readFileSync(nfoPath, 'utf8')) : null;
		progress({ bytes: st.size, failed: nfo === null });
		// A file with no episode named for it isn't one of tsundoku's.
		if (!nfo) continue;
		entries.push({
			position: nfo.position ?? entries.length + 1,
			label: `Ep. ${nfo.number}`,
			title: nfo.title === `Episode ${nfo.number}` ? '' : nfo.title,
			sourceUrl: nfo.sourceUrl,
			available: true,
			file: ep.rel,
			bytes: st.size,
			pageCount: 0,
			addedAt: Math.round(st.mtimeMs) || now,
			readAt: null,
			lastPosition: null,
			lastOpenedAt: null,
			history: null,
			episode: {
				season: nfo.season,
				number: nfo.number,
				note: nfo.note,
				durationS: nfo.durationS,
				thumbUrl: ''
			}
		});
	}
	return {
		originKey: show.key,
		source: show.source || 'aniyomi',
		title: show.title || show.key,
		kind: 'anime',
		rating: 0,
		favourite: false,
		hidden: f.hidden,
		shelves: [],
		tags: [
			...show.genres.map((g) => ({ namespace: 'genre', value: g })),
			...(show.source ? [{ namespace: 'source', value: show.source }] : [])
		],
		description: show.plot,
		status: show.status,
		direction: null,
		addedAt: now,
		sourceUrl: show.key.split(':').slice(2).join(':'),
		path: f.dir,
		entries
	};
}

import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from '../fspath.ts';
import { isUnder } from '../paths.ts';
import type { PlannedEntry, PlannedSeries } from '../../import/plan.ts';
import { readEpisodeNfo, readMovieNfo, readTvshowNfo } from '../../library/anime-files.ts';
import { storageOf, type Kind } from '../../library/kinds.ts';

/**
 * The anime folders as series (doc/ANIME.md, "Downloading"):
 * every series folder under `Anime/` and `Anime (hidden)/` with a
 * tvshow.nfo tsundoku wrote, and every episode in it with its .nfo, folded
 * onto the `aniyomi:` series and the episodes they name. The importer stays
 * the one place a file becomes an entry, as for chapters and books. A folder
 * someone else put there (no tsundoku key) is left alone.
 *
 * Every video kind is planned the same way from its own folders (`storage`
 * in kinds.ts): a show's under `Shows/` exactly as an anime's, and a
 * film's under `Movies/`, where a folder holds the film's file and its
 * `<movie>` NFO, which names the series and the entry both. A series is planned
 * with the kind its NFO says (`<tsundokukind>`), an anime when it says none.
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

/** A film folder's own NFO: the `<movie>` one beside its file, if tsundoku wrote one. */
function filmNfoIn(dir: string): string | null {
	let names: string[];
	try {
		names = readdirSync(dir).sort();
	} catch {
		return null;
	}
	for (const n of names) {
		if (!/\.nfo$/i.test(n) || !existsSync(join(dir, n.replace(/\.nfo$/i, '.mkv')))) continue;
		try {
			if (readMovieNfo(readFileSync(join(dir, n), 'utf8'))) return join(dir, n);
		} catch {
			// Unreadable: not one of tsundoku's.
		}
	}
	return null;
}

/** The series folders of one video kind: what `bytes` counts and `plan` reads. */
export function animeSeriesDirs(
	library: string,
	kind: Kind = 'anime'
): { dir: string; hidden: boolean }[] {
	const st = storageOf(kind);
	const dirs = [
		...listDirs(join(library, st.folder)).map((n) => ({
			dir: join(library, st.folder, n),
			hidden: false
		})),
		...listDirs(join(library, st.hidden)).map((n) => ({
			dir: join(library, st.hidden, n),
			hidden: true
		}))
	];
	return st.layout === 'film'
		? dirs.filter((f) => filmNfoIn(f.dir) !== null)
		: dirs.filter((f) => existsSync(join(f.dir, 'tvshow.nfo')));
}

/** A film folder's files: the MKVs beside it, named as `filmFile` names them. */
function filmsIn(dir: string): { rel: string; abs: string }[] {
	try {
		return readdirSync(dir)
			.filter((n) => /\.mkv$/i.test(n))
			.sort()
			.map((n) => ({ rel: n, abs: join(dir, n) }));
	} catch {
		return [];
	}
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

export function animeBytes(library: string, kind: Kind = 'anime'): number {
	const film = storageOf(kind).layout === 'film';
	let n = 0;
	for (const f of animeSeriesDirs(library, kind))
		for (const e of film ? filmsIn(f.dir) : episodesIn(f.dir)) {
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
	now: number,
	kind: Kind = 'anime'
): PlannedSeries[] {
	const film = storageOf(kind).layout === 'film';
	const out: PlannedSeries[] = [];
	for (const f of animeSeriesDirs(library, kind)) {
		const s = film ? planFilmDir(f, progress, now) : planAnimeDir(f, progress, now);
		if (s) out.push(s);
	}
	return out;
}

/**
 * The one series an episode file belongs to, planned as planAnimeFolders
 * plans it (attachWritten, import/index.ts): the series folder holding it, whole.
 */
export function planAnimeSeries(
	library: string,
	file: string,
	now: number,
	kind: Kind = 'anime'
): PlannedSeries[] {
	const f = animeSeriesDirs(library, kind).find((d) => isUnder(file, d.dir));
	const film = storageOf(kind).layout === 'film';
	const s = f ? (film ? planFilmDir(f, () => {}, now) : planAnimeDir(f, () => {}, now)) : null;
	return s ? [s] : [];
}

/**
 * A film's folder: the series and its entries from the `<movie>` NFO
 * beside each file. A file whose NFO names another series' key is not this
 * folder's, and is left alone.
 */
function planFilmDir(
	f: { dir: string; hidden: boolean },
	progress: (p: { bytes: number; failed: boolean }) => void,
	now: number
): PlannedSeries | null {
	const first = filmNfoIn(f.dir);
	const film = first ? readMovieNfo(readFileSync(first, 'utf8')) : null;
	if (!film) return null;
	const entries: PlannedEntry[] = [];
	for (const file of filmsIn(f.dir)) {
		let st;
		try {
			st = statSync(file.abs);
		} catch {
			continue;
		}
		const nfoPath = file.abs.replace(/\.mkv$/i, '.nfo');
		const nfo = existsSync(nfoPath) ? readMovieNfo(readFileSync(nfoPath, 'utf8')) : null;
		progress({ bytes: st.size, failed: nfo === null });
		if (!nfo || nfo.key !== film.key) continue;
		entries.push({
			position: nfo.position,
			label: nfo.title || film.title,
			title: '',
			sourceUrl: nfo.sourceUrl,
			available: true,
			file: file.rel,
			bytes: st.size,
			pageCount: 0,
			addedAt: Math.round(st.mtimeMs) || now,
			readAt: null,
			lastPosition: null,
			lastOpenedAt: null,
			history: null,
			episode: {
				season: null,
				number: nfo.position,
				note: '',
				durationS: nfo.durationS,
				thumbUrl: ''
			}
		});
	}
	return {
		originKey: film.key,
		source: film.source || 'aniyomi',
		title: film.title || film.key,
		kind: 'movie',
		rating: 0,
		favourite: false,
		hidden: f.hidden,
		shelves: [],
		tags: [
			...film.genres.map((g) => ({ namespace: 'genre', value: g })),
			...(film.source ? [{ namespace: 'source', value: film.source }] : [])
		],
		description: film.plot,
		status: '',
		direction: null,
		addedAt: now,
		sourceUrl: film.key.split(':').slice(2).join(':'),
		path: f.dir,
		entries
	};
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
		// The kind the folder's NFO says: a show's, or an anime's.
		kind: show.kind,
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

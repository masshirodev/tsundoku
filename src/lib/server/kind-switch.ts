import { existsSync, mkdirSync, renameSync, rmSync, rmdirSync, readdirSync } from 'node:fs';
import type Database from 'better-sqlite3';
import { dirname, join, posix } from './fspath.ts';
import { getDb } from './db.ts';
import { ensureNamedRoot } from './import/write.ts';
import { libraryRoot } from './import/index.ts';
import { folderNameOf, freeFolder, rewriteVideoNfos } from './anime/download.ts';
import { catalogueOf, catalogueType } from '../library/catalogues.ts';
import { storageOf, type Kind } from '../library/kinds.ts';
import { episodePath, filmFile } from '../library/anime-files.ts';

/**
 * The kind switch, a film to a show and back (card c991; the handoff's
 * `Kind.dc.html` in doc/handoffs/movies-shows/, drawn by c992's sheet). It
 * **moves the files**, because the folder must match the kind afterwards:
 * `Movies/<Title (Year)>/<Title (Year)>.mkv` becomes `Shows/<Title>/Season
 * 01/<Title> S01E01 ….mkv`, each with its NFO, and back. MOVE's shape: the plan
 * says every path before anything moves, and UNDO puts every one back.
 *
 * Only between the two kinds TMDB holds. Anime to a show crosses catalogues
 * (an AniList link would have to go), which is c979's question, not this.
 *
 * What changes besides the files: the series' kind and its root, and its TMDB
 * link, search and declined offers, since TMDB is asked again as the other
 * kind (a film's entry is not a show's). What stays: progress, rating,
 * shelves, the Work, the series itself under its own id.
 */

export type KindMove = { from: string; to: string };

export type KindSwitchPlan = {
	from: Kind;
	to: Kind;
	/** Why it cannot, said on the kind it refuses (`ONE ENTRY · THIS HAS 8`); null when it can. */
	refused: string | null;
	/**
	 * The file is still on its way (Kind 4.4): the pick is allowed, the move is
	 * not, and nothing queues it for later. `DOWNLOADING · 35%`, `QUEUED`; null
	 * when nothing is under way.
	 */
	busy: string | null;
	/** Every file and its NFO, absolute, from and to. Empty when nothing is downloaded yet. */
	moves: KindMove[];
	/** The folder before and after, relative to the library. */
	folder: { from: string | null; to: string };
	/** Each file the sheet's FROM and TO rows show, relative to the library: its folder and its name. */
	files: { from: { dir: string; name: string }; to: { dir: string; name: string } }[];
	/** What else changes, in the sheet's words. */
	changes: string[];
	/** What stays. */
	stays: string[];
};

type Row = { id: number; kind: Kind; title: string; hidden: number; path: string };

const KIND_WORD: Partial<Record<Kind, string>> = { movie: 'MOVIE', show: 'SHOW' };

/** The kinds a series may be switched to: the other TMDB kinds its source serves. */
export function kindSwitchTargets(kind: Kind): Kind[] {
	if (catalogueOf(kind) !== 'tmdb') return [];
	return (['movie', 'show'] as const).filter((k) => k !== kind);
}

function row(db: Database.Database, seriesId: number): Row | null {
	return (
		(db.prepare(`SELECT id, kind, title, hidden, path FROM series WHERE id = ?`).get(seriesId) as
			Row | undefined) ?? null
	);
}

/** What a switch would do, before it does anything. */
export function planKindSwitch(
	seriesId: number,
	to: Kind,
	library = libraryRoot(),
	db: Database.Database = getDb()
): KindSwitchPlan | null {
	const s = row(db, seriesId);
	if (!s || !kindSwitchTargets(s.kind).includes(to)) return null;
	const entries = db
		.prepare(
			`SELECT id, position, title, file, available FROM entries WHERE series_id = ? AND shadowed = 0 ORDER BY position`
		)
		.all(seriesId) as {
		id: number;
		position: number;
		title: string;
		file: string;
		available: number;
	}[];
	const toFilm = catalogueType(to) === 'movie';
	const refused = toFilm && entries.length > 1 ? `ONE ENTRY · THIS HAS ${entries.length}` : null;
	const queued = db
		.prepare(
			`SELECT q.state, q.pages, q.done_pages FROM download_queue q JOIN entries e ON e.id = q.entry_id
			WHERE e.series_id = ? ORDER BY q.state = 'downloading' DESC LIMIT 1`
		)
		.get(seriesId) as { state: string; pages: number; done_pages: number } | undefined;
	const busy = queued
		? queued.state === 'downloading'
			? `DOWNLOADING · ${queued.pages ? Math.round((queued.done_pages / queued.pages) * 100) : 0}%`
			: 'QUEUED'
		: null;
	const known = db.prepare(`SELECT folder FROM anime_series WHERE series_id = ?`).get(seriesId) as
		{ folder: string } | undefined;
	const st = storageOf(to);
	// A film that becomes a show keeps its folder's name (Kind 4.2: `Shows/The
	// Long Ferry (2024)/`): the source's own title is often a release's. A show
	// that becomes a film takes the film's rule, TMDB's title and year.
	const name =
		!toFilm && known
			? posix.basename(known.folder)
			: folderNameOf(db, { id: s.id, kind: to, title: s.title });
	const target = refused
		? posix.join(s.hidden ? st.hidden : st.folder, name)
		: freeFolder(db, s.hidden ? st.hidden : st.folder, name);
	const base = posix.basename(target);
	const moves: KindMove[] = [];
	if (known)
		for (const e of entries) {
			if (!e.available || !e.file) continue;
			const rel = toFilm
				? filmFile(base, e.position)
				: episodePath({ series: base, season: null, number: e.position, title: e.title });
			const from = join(s.path, e.file);
			const dest = join(library, target, rel);
			moves.push({ from, to: dest });
			moves.push({ from: from.replace(/\.mkv$/i, '.nfo'), to: dest.replace(/\.mkv$/i, '.nfo') });
		}
	// The poster goes with the files: it is the series', whichever kind.
	if (known && moves.length)
		moves.push({
			from: join(library, known.folder, 'poster.jpg'),
			to: join(library, target, 'poster.jpg')
		});
	const tmdb = !!db.prepare(`SELECT 1 FROM series_tmdb_links WHERE series_id = ?`).get(seriesId);
	const collection = !!db
		.prepare(`SELECT 1 FROM series_tmdb_links WHERE series_id = ? AND collection_id IS NOT NULL`)
		.get(seriesId);
	// Kind 4.2's words. TMDB "asks you before it links": the switch's search is
	// the owner's kind, which never links by itself (the action that calls it).
	const changes = toFilm
		? ['THE EPISODE BECOMES THE FILM', ...(tmdb ? ['TMDB IS ASKED AGAIN, AS A MOVIE'] : [])]
		: [
				'THE FILM BECOMES EPISODE 1 OF A LIST',
				...(collection ? ['ITS COLLECTION GOES'] : []),
				...(tmdb ? ['TMDB IS ASKED AGAIN, AS A SHOW, AND ASKS YOU BEFORE IT LINKS'] : [])
			];
	const rel = (abs: string) => ({
		dir: `${posix.relative(library, dirname(abs))}/`,
		name: posix.basename(abs)
	});
	const files = moves
		.filter((m) => /\.mkv$/i.test(m.to))
		.map((m) => ({ from: rel(m.from), to: rel(m.to) }));
	return {
		from: s.kind,
		to,
		refused,
		busy,
		files,
		moves,
		folder: { from: known?.folder ?? null, to: target },
		changes,
		stays: ['PROGRESS', 'RATING AND FAV', 'SHELVES AND TAGS', 'THE WORK IT IS IN', 'THE SOURCE']
	};
}

/** What a switch replaced, for its UNDO: the rows as they were, and every file it moved. */
export type KindSwitchUndo = {
	seriesId: number;
	kind: Kind;
	rootId: number;
	path: string;
	folder: string | null;
	files: { id: number; file: string }[];
	moves: KindMove[];
	tmdb: {
		link: Record<string, unknown> | null;
		search: Record<string, unknown> | null;
		candidates: Record<string, unknown>[];
		declined: Record<string, unknown>[];
	};
};

const lastSwitch = new Map<number, KindSwitchUndo>();

function moveAll(moves: KindMove[]): KindMove[] {
	const done: KindMove[] = [];
	try {
		for (const m of moves) {
			if (!existsSync(m.from)) continue;
			if (existsSync(m.to)) throw new Error(`${m.to} is already there`);
			mkdirSync(dirname(m.to), { recursive: true });
			renameSync(m.from, m.to);
			done.push(m);
		}
	} catch (e) {
		// Half a switch is worse than none: what moved goes back.
		for (const m of done.reverse()) renameSync(m.to, m.from);
		throw e;
	}
	return done;
}

/** The folders a move emptied, and the files a kind no longer has (a film's tvshow.nfo). */
function tidy(folder: string | null, library: string, was: 'film' | 'seasons'): void {
	if (!folder) return;
	const dir = join(library, folder);
	// A show's tvshow.nfo is no film's: the new kind's files are written after.
	if (was === 'seasons') rmSync(join(dir, 'tvshow.nfo'), { force: true });
	const prune = (d: string) => {
		try {
			for (const n of readdirSync(d, { withFileTypes: true }))
				if (n.isDirectory()) prune(join(d, n.name));
			if (readdirSync(d).length === 0) rmdirSync(d);
		} catch {
			// Gone already, or not empty: left as it is.
		}
	};
	prune(dir);
}

/**
 * Switch the kind: the files move first (and move back should one refuse),
 * then the database in one transaction, then the NFOs are written for the new
 * kind. Answers the sheet's done line, `NOW A SHOW · 1 FILE MOVED TO SHOWS/`.
 */
export async function switchKind(
	seriesId: number,
	to: Kind,
	library = libraryRoot(),
	db: Database.Database = getDb()
): Promise<{ done: string; where: string; moved: number }> {
	const plan = planKindSwitch(seriesId, to, library, db);
	if (!plan) throw new Error('not a kind this series can switch to');
	if (plan.refused) throw new Error(plan.refused);
	if (plan.busy)
		throw new Error(`the file is ${plan.busy.toLowerCase()}: it moves once it is here`);
	const s = row(db, seriesId)!;
	const all = <T>(sql: string) => db.prepare(sql).all(seriesId) as T[];
	const one = <T>(sql: string) => (db.prepare(sql).get(seriesId) as T | undefined) ?? null;
	const undo: KindSwitchUndo = {
		seriesId,
		kind: s.kind,
		rootId: (
			one<{ root_id: number }>(`SELECT root_id FROM series WHERE id = ?`) as { root_id: number }
		).root_id,
		path: s.path,
		folder: plan.folder.from,
		files: all(`SELECT id, file FROM entries WHERE series_id = ?`),
		moves: [],
		tmdb: {
			link: one(`SELECT * FROM series_tmdb_links WHERE series_id = ?`),
			search: one(`SELECT * FROM tmdb_link_searches WHERE series_id = ?`),
			candidates: all(`SELECT * FROM tmdb_link_candidates WHERE series_id = ?`),
			declined: all(`SELECT * FROM tmdb_offers_declined WHERE series_id = ?`)
		}
	};
	undo.moves = moveAll(plan.moves);
	const st = storageOf(to);
	const newPath = join(library, plan.folder.to);
	db.transaction(() => {
		const root = ensureNamedRoot(db, st.folder, join(library, st.folder), false);
		db.prepare(`UPDATE series SET kind = ?, root_id = ?, path = ? WHERE id = ?`).run(
			to,
			root,
			plan.folder.from ? newPath : s.path,
			seriesId
		);
		if (plan.folder.from)
			db.prepare(`UPDATE anime_series SET folder = ? WHERE series_id = ?`).run(
				plan.folder.to,
				seriesId
			);
		for (const m of plan.moves.filter((x) => /\.mkv$/i.test(x.to))) {
			const was = undo.files.find((f) => join(s.path, f.file) === m.from);
			if (was)
				db.prepare(`UPDATE entries SET file = ? WHERE id = ?`).run(
					posix.relative(newPath, m.to),
					was.id
				);
		}
		for (const t of [
			'series_tmdb_links',
			'tmdb_link_searches',
			'tmdb_link_candidates',
			'tmdb_offers_declined'
		])
			db.prepare(`DELETE FROM ${t} WHERE series_id = ?`).run(seriesId);
	})();
	tidy(plan.folder.from, library, st.layout === 'film' ? 'seasons' : 'film');
	await rewriteVideoNfos(seriesId, library, db).catch(() => 0);
	lastSwitch.set(seriesId, undo);
	const mkvs = undo.moves.filter((m) => /\.mkv$/i.test(m.to));
	const files = mkvs.length;
	// The band (Kind 4.5): `NOW A SHOW · 1 FILE MOVED`, and under it where to.
	return {
		done: `NOW A ${KIND_WORD[to]}${files ? ` · ${files} FILE${files === 1 ? '' : 'S'} MOVED` : ''}`,
		where: `TO ${(files ? posix.relative(library, dirname(mkvs[0].to)) : plan.folder.to).toUpperCase()}/`,
		moved: files
	};
}

const insert = (db: Database.Database, table: string, r: Record<string, unknown>) => {
	const cols = Object.keys(r);
	db.prepare(
		`INSERT INTO ${table} (${cols.join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`
	).run(...cols.map((c) => r[c]));
};

/** UNDO the last switch on this series: the files back, then every row as it was. */
export async function undoKindSwitch(
	seriesId: number,
	library = libraryRoot(),
	db: Database.Database = getDb()
): Promise<boolean> {
	const u = lastSwitch.get(seriesId);
	if (!u) return false;
	const now = row(db, seriesId);
	moveAll(u.moves.map((m) => ({ from: m.to, to: m.from })));
	const folderNow = (
		db.prepare(`SELECT folder FROM anime_series WHERE series_id = ?`).get(seriesId) as
			{ folder: string } | undefined
	)?.folder;
	db.transaction(() => {
		db.prepare(`UPDATE series SET kind = ?, root_id = ?, path = ? WHERE id = ?`).run(
			u.kind,
			u.rootId,
			u.path,
			seriesId
		);
		if (u.folder !== null)
			db.prepare(`UPDATE anime_series SET folder = ? WHERE series_id = ?`).run(u.folder, seriesId);
		for (const f of u.files)
			db.prepare(`UPDATE entries SET file = ? WHERE id = ?`).run(f.file, f.id);
		for (const t of [
			'series_tmdb_links',
			'tmdb_link_searches',
			'tmdb_link_candidates',
			'tmdb_offers_declined'
		])
			db.prepare(`DELETE FROM ${t} WHERE series_id = ?`).run(seriesId);
		if (u.tmdb.link) insert(db, 'series_tmdb_links', u.tmdb.link);
		if (u.tmdb.search) insert(db, 'tmdb_link_searches', u.tmdb.search);
		for (const c of u.tmdb.candidates) insert(db, 'tmdb_link_candidates', c);
		for (const d of u.tmdb.declined) insert(db, 'tmdb_offers_declined', d);
	})();
	if (now && folderNow)
		tidy(folderNow, library, storageOf(u.kind).layout === 'film' ? 'seasons' : 'film');
	await rewriteVideoNfos(seriesId, library, db).catch(() => 0);
	lastSwitch.delete(seriesId);
	return true;
}

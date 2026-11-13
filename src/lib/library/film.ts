import type { SeriesEntry } from './series.ts';
import { runtimeWords, type TmdbTitle } from './tmdb.ts';
import { dayWords } from './surroundings.ts';

/**
 * A film's screen, the pure part (card c992; the handoff's Film-Desk and
 * Film-States boards in doc/handoffs/movies-shows/). A film is a series of one
 * entry with no list, so everything a list says elsewhere is said here, once:
 * the one primary cell, the count line, the DOWNLOAD row of one file and the
 * KIND row. Never on a film: an episode list, a NEXT row of its own, FOLLOW,
 * REFRESH, NEXT 10 or an episode count (Film-States, "NEVER ON A FILM").
 */

type Entry = Pick<SeriesEntry, 'id' | 'readAt' | 'lastPosition' | 'lastOpenedAt' | 'available'> & {
	episode?: { durationS: number | null } | null;
};

/** Minutes as the cell says them: `1 H 58`, `42 MIN`. */
const minutes = (s: number) => runtimeWords(Math.max(1, Math.round(s / 60)));

export type FilmAction = {
	/** `PLAY`, `CONTINUE · 42 MIN LEFT`, `WATCH AGAIN`: the cell's words after its glyph. */
	label: string;
	/** Under it: the length, `1 H 16 OF 1 H 58`, or `WATCHED 3 NOV`. */
	meta: string;
	short: string;
	entry: Entry | null;
	/** Watched: the cell goes quiet, as READ AGAIN does. */
	quiet: boolean;
	/** CONTINUE's 3px on-accent line at its foot: how far in, 0 to 1; null when not begun. */
	progress: number | null;
};

/**
 * The one primary cell (Film-States 1.1 to 1.3). The length is the file's when
 * it was measured, else TMDB's runtime, else nothing: a cell never says a
 * length nobody knows.
 */
export function filmAction(entries: Entry[], runtimeMin: number | null, now: number): FilmAction {
	const e = entries[0] ?? null;
	const lengthS = e?.episode?.durationS ?? (runtimeMin ? runtimeMin * 60 : null);
	const length = lengthS ? minutes(lengthS) : '';
	if (!e) return { label: 'PLAY', meta: '', short: '', entry: null, quiet: false, progress: null };
	if (e.readAt !== null) {
		const day = dayWords(new Date(e.readAt).toISOString().slice(0, 10), now);
		return {
			label: 'WATCH AGAIN',
			meta: `WATCHED ${day}`,
			short: `WATCHED ${day}`,
			entry: e,
			quiet: true,
			progress: null
		};
	}
	if (e.lastPosition !== null && e.lastPosition > 0 && lengthS) {
		const left = Math.max(0, lengthS - e.lastPosition);
		return {
			label: `CONTINUE · ${minutes(left)} LEFT`,
			meta: `${minutes(e.lastPosition)} OF ${length}`,
			short: `${minutes(left)} LEFT`,
			entry: e,
			quiet: false,
			progress: Math.min(1, e.lastPosition / lengthS)
		};
	}
	return { label: 'PLAY', meta: length, short: length, entry: e, quiet: false, progress: null };
}

/**
 * The line under the title: `2024 · 1 H 58 · DRAMA`, with `· WATCHED` once it
 * is. With no TMDB link it closes up (the owner's call, 2026-11-12, the keys
 * handoff's version): `FILM · <SOURCE> · 1 FILE`, nothing dimmed or unknown.
 * The genre is the series' own first one (its source's tags); TMDB's genres
 * are not fetched, so a linked film with none says none.
 */
export function filmCountLine(o: {
	tmdb: Pick<TmdbTitle, 'year' | 'runtime'> | null;
	source: string;
	files: number;
	genre: string | null;
	watched: boolean;
}): string {
	if (!o.tmdb)
		return ['FILM', o.source.toUpperCase(), `${o.files} FILE${o.files === 1 ? '' : 'S'}`]
			.filter(Boolean)
			.join(' · ');
	return [
		o.tmdb.year ? String(o.tmdb.year) : '',
		runtimeWords(o.tmdb.runtime),
		o.genre ? o.genre.toUpperCase() : '',
		o.watched ? 'WATCHED' : ''
	]
		.filter(Boolean)
		.join(' · ');
}

/** What the DOWNLOAD row knows of the one file. */
export type FilmFile =
	| { state: 'none'; bytes: number | null; height: number | null }
	| { state: 'queued'; ahead: number; bytes: number | null }
	| { state: 'downloading'; done: number; bytes: number | null; leftS: number | null }
	| { state: 'failed'; why: string }
	| { state: 'here'; bytes: number; height: number | null };

const size = (b: number | null) => {
	if (!b || b <= 0) return '';
	if (b >= 1e9) return `${(b / 1e9).toFixed(2)} GB`;
	return `${Math.round(b / 1e6)} MB`;
};

/**
 * The DOWNLOAD row of a film (Film-States 1.6): one file, so the row says
 * where that file is and nothing else, with one cell. PLAY still streams in
 * every state but `here`.
 */
export function filmDownloadRow(f: FilmFile): { title: string; meta: string; cell: string | null } {
	switch (f.state) {
		case 'none':
			return {
				title: 'Not on this computer',
				meta: ['1 FILE', f.height ? `${f.height}P` : '', size(f.bytes)].filter(Boolean).join(' · '),
				cell: 'DOWNLOAD'
			};
		case 'queued':
			return {
				title: 'Queued',
				meta: [`${f.ahead} AHEAD OF IT`, size(f.bytes)].filter(Boolean).join(' · '),
				cell: 'CANCEL'
			};
		case 'downloading': {
			const pct = Math.round(f.done * 100);
			const got = f.bytes ? `${size(f.bytes * f.done)} OF ${size(f.bytes)}` : '';
			const left = f.leftS ? `${Math.max(1, Math.round(f.leftS / 60))} MIN LEFT` : '';
			return {
				title: `Downloading · ${pct}%`,
				meta: [got, left].filter(Boolean).join(' · '),
				cell: 'CANCEL'
			};
		}
		case 'failed':
			return { title: 'Failed', meta: f.why.toUpperCase(), cell: 'TRY AGAIN' };
		case 'here':
			return {
				title: 'On this computer',
				meta: ['1 FILE', size(f.bytes)].filter(Boolean).join(' · '),
				cell: null
			};
	}
}

/** The KIND row (Film-Desk, Kind): `Movie`, `MOVIES/ · 1 FILE`, CHANGE. */
export function kindRow(o: { kind: 'movie' | 'show'; folder: string; files: number }): {
	title: string;
	meta: string;
} {
	return {
		// The kind's own name, as the row writes it: `Movie`, `Show`.
		title: `${o.kind[0].toUpperCase()}${o.kind.slice(1)}`,
		meta: `${o.folder.toUpperCase()}/ · ${o.files} FILE${o.files === 1 ? '' : 'S'}`
	};
}

/**
 * Anime on disk, the pure part (doc/ANIME.md, "Downloading"; card c157):
 * where an episode goes, in Jellyfin's TV layout as the owner amended
 * default 2, what its NFOs say, and the ffmpeg arguments that mux it.
 *
 *   Anime/<Series>/tvshow.nfo, poster.jpg
 *   Anime/<Series>/Season 01/<Series> S01E07 <Title>.mkv, and its .nfo
 *
 * A hidden series goes under `Anime (hidden)/` instead, never under the
 * folder a Jellyfin library would read: Jellyfin has no reveal. The NFOs
 * carry tsundoku's own keys (`<uniqueid type="tsundoku">`), which is how the
 * importer folds the files back onto their series and episodes.
 *
 * A show is laid out the same way under `Shows/`, and a film flat under
 * `Movies/` (card c991; `storage` in kinds.ts):
 *
 *   Movies/<Title (Year)>/<Title (Year)>.mkv, <Title (Year)>.nfo, poster.jpg
 *
 * The NFOs say the series' kind (`<tsundokukind>`), so a rescan brings a film
 * back as a film; a file written before they did reads as an anime.
 */

import { LANGS, langCode } from './streams.ts';
import { KIND_FACTS, type Kind } from './kinds.ts';

// The registry's (`storage`, card c991): a film's are Movies/, a show's Shows/.
export const ANIME_FOLDER = KIND_FACTS.anime.storage.folder;
export const HIDDEN_ANIME_FOLDER = KIND_FACTS.anime.storage.hidden;

/** A name every filesystem keeps, as Mihon names folders: no reserved characters, no trailing dots. */
export function fileSafe(name: string): string {
	const n = name
		// eslint-disable-next-line no-control-regex -- control characters are exactly what FAT refuses
		.replace(/["*/:<>?\\|\x00-\x1f\x7f]/g, '_')
		.replace(/\s+/g, ' ')
		.trim()
		.replace(/^[. ]+|[. ]+$/g, '');
	return n.slice(0, 180) || '(untitled)';
}

/** A series' folder name: "<Series> (<year>)" when the year is known (Aniyomi doesn't say). */
export const seriesFolderName = (title: string, year: number | null = null) =>
	fileSafe(year ? `${title} (${year})` : title);

const two = (n: number) => String(Math.max(0, Math.floor(n))).padStart(2, '0');

/**
 * An episode's file under its series folder: "Season 01/<Series> S01E07
 * <Title>.mkv". An absolute-numbered source (no seasons) is season 1 with its
 * own numbers; a fractional number keeps its half (S01E07.5).
 */
export function episodePath(o: {
	series: string;
	season: number | null;
	number: number;
	title: string;
}): string {
	const season = o.season ?? 1;
	const n = Number.isInteger(o.number)
		? two(o.number)
		: `${two(Math.floor(o.number))}.${String(o.number).split('.')[1]}`;
	const title = o.title.trim() ? ` ${o.title.trim()}` : '';
	return `Season ${two(season)}/${fileSafe(`${o.series} S${two(season)}E${n}${title}`)}.mkv`;
}

const xml = (s: string) =>
	s
		.replace(/&/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;')
		.replace(/"/g, '&quot;')
		// eslint-disable-next-line no-control-regex -- XML 1.0 can't carry these
		.replace(/[\x00-\x08\x0b\x0c\x0e-\x1f]/g, '');

/** tvshow.nfo: what Jellyfin reads of a series, and tsundoku's key for it. */
export function tvshowNfo(s: {
	key: string;
	title: string;
	plot: string;
	status: string;
	genres: string[];
	source: string;
	year?: number | null;
	anilist?: number | null;
	mal?: number | null;
	/** A show's TMDB entry (c989): Jellyfin looks a show up by it. */
	tmdb?: number | null;
	/** The series' kind; a file without it (every one before c991) is an anime's. */
	kind?: Kind;
}): string {
	const lines = [
		'<?xml version="1.0" encoding="utf-8" standalone="yes"?>',
		'<tvshow>',
		`  <title>${xml(s.title)}</title>`,
		s.plot ? `  <plot>${xml(s.plot)}</plot>` : '',
		s.year ? `  <year>${s.year}</year>` : '',
		s.status ? `  <status>${xml(s.status)}</status>` : '',
		...s.genres.map((g) => `  <genre>${xml(g)}</genre>`),
		`  <uniqueid type="tsundoku" default="true">${xml(s.key)}</uniqueid>`,
		s.anilist ? `  <uniqueid type="anilist">${s.anilist}</uniqueid>` : '',
		s.mal ? `  <uniqueid type="mal">${s.mal}</uniqueid>` : '',
		s.tmdb ? `  <uniqueid type="tmdb">${s.tmdb}</uniqueid>` : '',
		// Jellyfin passes by what it doesn't know; the importer reads it.
		`  <tsundokusource>${xml(s.source)}</tsundokusource>`,
		s.kind ? `  <tsundokukind>${s.kind}</tsundokukind>` : '',
		'</tvshow>',
		''
	];
	return lines.filter((l) => l !== '').join('\n') + '\n';
}

/** An episode's .nfo, beside its file: Jellyfin's episodedetails, and the episode's address at the source. */
export function episodeNfo(e: {
	sourceUrl: string;
	title: string;
	season: number | null;
	number: number;
	position: number;
	durationS: number | null;
	note: '' | 'filler' | 'recap';
}): string {
	const lines = [
		'<?xml version="1.0" encoding="utf-8" standalone="yes"?>',
		'<episodedetails>',
		`  <title>${xml(e.title || `Episode ${e.number}`)}</title>`,
		`  <season>${e.season ?? 1}</season>`,
		`  <episode>${Math.floor(e.number)}</episode>`,
		e.durationS ? `  <runtime>${Math.round(e.durationS / 60)}</runtime>` : '',
		`  <uniqueid type="tsundoku" default="true">${xml(e.sourceUrl)}</uniqueid>`,
		`  <tsundokuposition>${e.position}</tsundokuposition>`,
		`  <tsundokunumber>${e.number}</tsundokunumber>`,
		e.season !== null ? `  <tsundokuseason>${e.season}</tsundokuseason>` : '',
		e.durationS ? `  <tsundokuseconds>${Math.round(e.durationS)}</tsundokuseconds>` : '',
		e.note ? `  <tsundokunote>${e.note}</tsundokunote>` : '',
		'</episodedetails>',
		''
	];
	return lines.filter((l) => l !== '').join('\n') + '\n';
}

const unxml = (s: string) =>
	s
		.replace(/&lt;/g, '<')
		.replace(/&gt;/g, '>')
		.replace(/&quot;/g, '"')
		.replace(/&#39;|&apos;/g, "'")
		.replace(/&amp;/g, '&');

/** One element's text, or null. */
function tag(nfo: string, name: string, attr?: string): string | null {
	const re = new RegExp(`<${name}\\b([^>]*)>([\\s\\S]*?)</${name}>`, 'gi');
	for (const m of nfo.matchAll(re)) {
		if (attr && !new RegExp(attr, 'i').test(m[1])) continue;
		return unxml(m[2].trim());
	}
	return null;
}

const num = (s: string | null) =>
	s !== null && s !== '' && Number.isFinite(Number(s)) ? Number(s) : null;

/** A tvshow.nfo tsundoku wrote: its key and what it says; null for one it didn't. */
export function readTvshowNfo(text: string): {
	key: string;
	title: string;
	plot: string;
	status: string;
	genres: string[];
	source: string;
	kind: 'anime' | 'show';
} | null {
	const key = tag(text, 'uniqueid', 'type="tsundoku"');
	if (!key || !/^aniyomi:\d+:.+/.test(key)) return null;
	return {
		key,
		title: tag(text, 'title') ?? '',
		plot: tag(text, 'plot') ?? '',
		status: tag(text, 'status') ?? '',
		genres: [...text.matchAll(/<genre>([\s\S]*?)<\/genre>/gi)].map((m) => unxml(m[1].trim())),
		source: tag(text, 'tsundokusource') ?? '',
		// Only a show's file says so: an anime's never needed to, and a file
		// written before c991 is an anime's.
		kind: tag(text, 'tsundokukind') === 'show' ? 'show' : 'anime'
	};
}

/** An episode .nfo tsundoku wrote; null for one it didn't. */
export function readEpisodeNfo(text: string): {
	sourceUrl: string;
	title: string;
	season: number | null;
	number: number;
	position: number | null;
	durationS: number | null;
	note: '' | 'filler' | 'recap';
} | null {
	const url = tag(text, 'uniqueid', 'type="tsundoku"');
	const number = num(tag(text, 'tsundokunumber')) ?? num(tag(text, 'episode'));
	if (!url || number === null) return null;
	const note = tag(text, 'tsundokunote');
	return {
		sourceUrl: url,
		title: tag(text, 'title') ?? '',
		season: num(tag(text, 'tsundokuseason')),
		number,
		position: num(tag(text, 'tsundokuposition')),
		durationS: num(tag(text, 'tsundokuseconds')),
		note: note === 'filler' || note === 'recap' ? note : ''
	};
}

// ---- a film (card c991) ---------------------------------------------------------------------

/**
 * A film's file under its folder: `<Title (Year)>.mkv`, the folder's own name,
 * as Jellyfin's movie layout has it. A film is one entry; a release a source
 * splits in two keeps Jellyfin's multi-part suffix (`… - part2.mkv`).
 */
export function filmFile(folderName: string, position = 1): string {
	return `${fileSafe(position > 1 ? `${folderName} - part${Math.floor(position)}` : folderName)}.mkv`;
}

/**
 * A film's NFO, beside its file: Jellyfin's `<movie>`, and everything the
 * importer needs to fold the file back onto its series **and** its entry,
 * since a film has no tvshow.nfo above it: the series' key, the entry's
 * address at the source and its position.
 */
export function movieNfo(m: {
	key: string;
	sourceUrl: string;
	title: string;
	plot: string;
	genres: string[];
	source: string;
	position: number;
	year?: number | null;
	durationS?: number | null;
	tmdb?: number | null;
}): string {
	const lines = [
		'<?xml version="1.0" encoding="utf-8" standalone="yes"?>',
		'<movie>',
		`  <title>${xml(m.title)}</title>`,
		m.plot ? `  <plot>${xml(m.plot)}</plot>` : '',
		m.year ? `  <year>${m.year}</year>` : '',
		m.durationS ? `  <runtime>${Math.round(m.durationS / 60)}</runtime>` : '',
		...m.genres.map((g) => `  <genre>${xml(g)}</genre>`),
		`  <uniqueid type="tsundoku" default="true">${xml(m.key)}</uniqueid>`,
		m.tmdb ? `  <uniqueid type="tmdb">${m.tmdb}</uniqueid>` : '',
		`  <tsundokusource>${xml(m.source)}</tsundokusource>`,
		`  <tsundokuepisode>${xml(m.sourceUrl)}</tsundokuepisode>`,
		`  <tsundokuposition>${m.position}</tsundokuposition>`,
		m.durationS ? `  <tsundokuseconds>${Math.round(m.durationS)}</tsundokuseconds>` : '',
		'</movie>',
		''
	];
	return lines.filter((l) => l !== '').join('\n') + '\n';
}

/** A film NFO tsundoku wrote: its series key and its one entry; null for one it didn't. */
export function readMovieNfo(text: string): {
	key: string;
	sourceUrl: string;
	title: string;
	plot: string;
	genres: string[];
	source: string;
	position: number;
	durationS: number | null;
} | null {
	if (!/<movie\b/i.test(text)) return null;
	const key = tag(text, 'uniqueid', 'type="tsundoku"');
	const url = tag(text, 'tsundokuepisode');
	if (!key || !/^aniyomi:\d+:.+/.test(key) || !url) return null;
	return {
		key,
		sourceUrl: url,
		title: tag(text, 'title') ?? '',
		plot: tag(text, 'plot') ?? '',
		genres: [...text.matchAll(/<genre>([\s\S]*?)<\/genre>/gi)].map((m) => unxml(m[1].trim())),
		source: tag(text, 'tsundokusource') ?? '',
		position: num(tag(text, 'tsundokuposition')) ?? 1,
		durationS: num(tag(text, 'tsundokuseconds'))
	};
}

const ISO3 = new Map(
	LANGS.map(([code, , ...aliases]): [string, string] => {
		// Cantonese has no ISO 639-2 code of its own: it is filed under Chinese.
		if (code === 'yue') return [code, 'chi'];
		// fil and und are ISO 639-2 codes themselves.
		if (code.length === 3) return [code, code];
		return [code, aliases.find((a) => /^[a-z]{3}$/.test(a)) ?? 'und'];
	})
);

/**
 * ISO 639-2, as Matroska and Jellyfin name a track's language, from the
 * player's one table (streams.ts' LANGS; c419), so a Hungarian or Bokmål
 * track is tagged hun or nob, not und. A variant is its language (PT-BR is
 * por: ISO 639-2 has no regions), and the B form comes first where a
 * language has two (fre, ger, chi), as Matroska asks.
 */
export function iso3(lang: string): string {
	const code = langCode(lang).split('-')[0].toLowerCase();
	return ISO3.get(code) ?? 'und';
}

/**
 * The ffmpeg arguments that mux an episode into one MKV (Anime Calls 01,
 * default 2): the video, each separate audio and subtitle track as its own
 * input, every stream copied (subtitles to SubRip, which every player reads),
 * each tagged with its language. Inputs are tsundoku's own loopback proxy,
 * so ffmpeg never fetches anything itself; `header` is the proxy's secret.
 */
export function muxArgs(o: {
	video: string;
	/** HLS or a plain file (streams.ts' videoKind): only HLS takes the HLS reader's options. */
	videoKind?: 'hls' | 'file';
	audio: { url: string; lang: string }[];
	subtitles: { url: string; lang: string }[];
	header: string;
	out: string;
	title: string;
}): string[] {
	const input = (url: string, hls: boolean) => [
		'-headers',
		`${o.header}\r\n`,
		// The proxy's segments have no extension, and a site's are often dressed as .jpg.
		...(hls ? ['-extension_picky', '0'] : []),
		'-i',
		url
	];
	const args = [
		'-nostdin',
		'-y',
		'-loglevel',
		'error',
		'-progress',
		'pipe:1',
		...input(o.video, o.videoKind !== 'file')
	];
	// A source's separate audio tracks are HLS playlists (KickAssAnime's).
	for (const a of o.audio) args.push(...input(a.url, true));
	for (const s of o.subtitles)
		args.push('-headers', `${o.header}\r\n`, '-f', 'webvtt', '-i', s.url);
	args.push('-map', '0:v:0');
	if (o.audio.length) o.audio.forEach((_, i) => args.push('-map', `${i + 1}:a:0`));
	else args.push('-map', '0:a?');
	o.subtitles.forEach((_, i) => args.push('-map', `${1 + o.audio.length + i}:s:0`));
	args.push('-c', 'copy', '-c:s', 'srt');
	o.audio.forEach((a, i) => args.push(`-metadata:s:a:${i}`, `language=${iso3(a.lang)}`));
	o.subtitles.forEach((s, i) => args.push(`-metadata:s:s:${i}`, `language=${iso3(s.lang)}`));
	args.push('-metadata', `title=${o.title}`, '-f', 'matroska', o.out);
	return args;
}

/** ffmpeg's -progress lines: how far, in seconds, from `out_time_us`. */
export function progressSeconds(block: string): number | null {
	const m = /out_time_us=(\d+)/.exec(block) ?? /out_time_ms=(\d+)/.exec(block);
	return m ? Number(m[1]) / 1e6 : null;
}

/**
 * The tracks a download keeps (doc/ANIME.md, "Downloading"; card c160, on
 * SETTINGS since c171): the original, which is the source's first audio
 * track, and the languages chosen beside it; every track when none are
 * chosen. Subtitles are all kept unless SUBTITLES KEPT is AS AUDIO: then
 * those in a kept audio's language. A KickAssAnime episode carries eight
 * dubs, so a 360P one went from 310 MB to about 130 MB keeping two.
 */
export function keptTracks<A extends { lang: string }, S extends { lang: string }>(
	audio: A[],
	subtitles: S[],
	/** kept: null keeps every track; [] the original alone. */
	o: { kept: string[] | null; subs: 'all' | 'audio' }
): { audio: A[]; subtitles: S[] } {
	const lang = (l: string) => l.toUpperCase();
	const want = new Set((o.kept ?? []).map(lang));
	const keptAudio =
		o.kept === null ? audio : audio.filter((a, i) => i === 0 || want.has(lang(a.lang)));
	const spoken = new Set(keptAudio.map((a) => lang(a.lang)));
	return {
		audio: keptAudio,
		subtitles: o.subs === 'audio' ? subtitles.filter((s) => spoken.has(lang(s.lang))) : subtitles
	};
}

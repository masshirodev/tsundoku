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
 */

export const ANIME_FOLDER = 'Anime';
export const HIDDEN_ANIME_FOLDER = 'Anime (hidden)';

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
		// Jellyfin passes by what it doesn't know; the importer reads it.
		`  <tsundokusource>${xml(s.source)}</tsundokusource>`,
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
} | null {
	const key = tag(text, 'uniqueid', 'type="tsundoku"');
	if (!key || !/^aniyomi:\d+:.+/.test(key)) return null;
	return {
		key,
		title: tag(text, 'title') ?? '',
		plot: tag(text, 'plot') ?? '',
		status: tag(text, 'status') ?? '',
		genres: [...text.matchAll(/<genre>([\s\S]*?)<\/genre>/gi)].map((m) => unxml(m[1].trim())),
		source: tag(text, 'tsundokusource') ?? ''
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

/** ISO 639-2, as Matroska and Jellyfin name a track's language. */
export function iso3(code: string): string {
	const MAP: Record<string, string> = {
		EN: 'eng',
		JA: 'jpn',
		ES: 'spa',
		PT: 'por',
		FR: 'fre',
		DE: 'ger',
		IT: 'ita',
		AR: 'ara',
		RU: 'rus',
		ID: 'ind',
		ZH: 'chi',
		KO: 'kor',
		HI: 'hin',
		TA: 'tam',
		TE: 'tel',
		TH: 'tha',
		VI: 'vie',
		TR: 'tur',
		PL: 'pol'
	};
	return MAP[code.toUpperCase()] ?? 'und';
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

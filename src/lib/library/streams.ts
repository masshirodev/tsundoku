/**
 * An episode's streams, the pure part (doc/ANIME.md, "Streams"; card c155):
 * what the engine's getVideoList answers, as the player's servers and
 * qualities; an HLS playlist rewritten so every address in it is one of
 * tsundoku's own; and subtitles as WebVTT. No network, no database.
 */

/** A video as the engine answers getVideoList (doc/EXTENSION-ENGINE.md). */
export type EngineVideo = {
	url?: string;
	quality?: string;
	videoUrl?: string | null;
	/** OkHttp's internals: {"namesAndValues$okhttp": [name, value, ...]}. */
	headers?: unknown;
	subtitleTracks?: { url: string; lang: string }[] | null;
	audioTracks?: { url: string; lang: string }[] | null;
	timestamps?: { start: number; end: number; name?: string; type?: string }[] | null;
};

/** OkHttp's headers as a plain map; anything else as none. */
export function headersOf(raw: unknown): Record<string, string> {
	const out: Record<string, string> = {};
	if (!raw || typeof raw !== 'object') return out;
	const list = (raw as Record<string, unknown>)['namesAndValues$okhttp'];
	if (Array.isArray(list)) {
		for (let i = 0; i + 1 < list.length; i += 2)
			if (typeof list[i] === 'string' && typeof list[i + 1] === 'string')
				out[list[i] as string] = list[i + 1] as string;
		return out;
	}
	for (const [k, v] of Object.entries(raw)) if (typeof v === 'string') out[k] = v;
	return out;
}

/** "1080p", "720P", "(1920x1080)": a height, or null. */
export function heightOf(quality: string): number | null {
	const p = /\b(\d{3,4})\s*p\b/i.exec(quality);
	if (p) return Number(p[1]);
	const r = /\b\d{3,4}\s*[x×]\s*(\d{3,4})\b/.exec(quality);
	return r ? Number(r[1]) : null;
}

export type Range = { start: number; end: number };

export type Quality = {
	/** The engine's own words for it, which the sheet shows: "1080p", "720p · dub". */
	label: string;
	height: number | null;
	/** The index in the engine's list: what the server resolves a stream by. */
	index: number;
	video: EngineVideo;
};

export type Server = {
	/** 1-based, in the source's own order of preference: SERVER 1 OF 3. */
	n: number;
	/** The hoster's name, shown only in the settings sheet. */
	name: string;
	qualities: Quality[];
};

/**
 * The engine's videos as servers (Player Waiting, "Servers fail all the
 * time"): a video's quality reads "Hoster - 1080p" when the source has
 * hosters, so each hoster is a server and its videos its qualities, best
 * first; a source without hosters is one server.
 */
export function serversOf(videos: EngineVideo[]): Server[] {
	const out: Server[] = [];
	videos.forEach((v, index) => {
		if (!(v.videoUrl || v.url)) return;
		const q = (v.quality ?? '').trim() || 'Default';
		const cut = q.indexOf(' - ');
		const name = cut > 0 ? q.slice(0, cut).trim() : '';
		const label = cut > 0 ? q.slice(cut + 3).trim() : q;
		let s = out.find((x) => x.name === name);
		if (!s) {
			s = { n: out.length + 1, name, qualities: [] };
			out.push(s);
		}
		s.qualities.push({ label, height: heightOf(label), index, video: v });
	});
	for (const s of out)
		s.qualities.sort((a, b) => (b.height ?? 0) - (a.height ?? 0) || a.index - b.index);
	return out;
}

/**
 * The quality a device starts on (Anime Calls 01, default 3): the best
 * offered, or the best at most [cap] lines (720 on the phone). A server with
 * nothing that low offers its lowest.
 */
export function startQuality(s: Server, cap: number | null): Quality | null {
	if (!s.qualities.length) return null;
	if (cap === null) return s.qualities[0];
	return (
		s.qualities.find((q) => q.height !== null && q.height <= cap) ??
		s.qualities[s.qualities.length - 1]
	);
}

/** The opening and the ending, from the source's timestamps; null where it gave none (never a guess). */
export function chaptersOf(v: EngineVideo): { intro: Range | null; ending: Range | null } {
	const ts = (v.timestamps ?? []).filter(
		(t) => Number.isFinite(t.start) && Number.isFinite(t.end) && t.end > t.start
	);
	const find = (types: string[], words: RegExp) =>
		ts.find((t) => types.includes(t.type ?? '') || words.test(t.name ?? '')) ?? null;
	const pick = (t: { start: number; end: number } | null) =>
		t ? { start: t.start, end: t.end } : null;
	return {
		intro: pick(find(['Opening', 'MixedOp'], /^(op|opening|intro)\b/i)),
		ending: pick(find(['Ending'], /^(ed|ending|outro|credits)\b/i))
	};
}

// ---- HLS -------------------------------------------------------------------------------------

export const isPlaylist = (text: string) => text.trimStart().startsWith('#EXTM3U');

/**
 * Whether a video is a file the browser plays itself (an MP4 or WebM a hoster
 * links to) rather than an HLS stream: by its address, since the player only
 * ever sees tsundoku's token for it. Anything not plainly a file is HLS.
 */
export function videoKind(url: string): 'hls' | 'file' {
	let path = url;
	try {
		path = new URL(url).pathname;
	} catch {
		// Not an absolute address: read it as it is.
	}
	return /\.(mp4|m4v|webm|mkv|mov)$/i.test(path) ? 'file' : 'hls';
}

/**
 * A playlist with every address in it (segments, variants, keys, alternate
 * audio and subtitles, init maps) replaced by [local]'s, resolved against
 * the playlist's own address first. [local] decides what each becomes; it
 * may return null for an address it won't serve, which is then left out.
 */
export function rewritePlaylist(
	text: string,
	base: string,
	local: (absolute: string, hint: 'playlist' | 'segment' | 'other') => string | null
): string {
	const abs = (u: string) => {
		try {
			return new URL(u.trim(), base).toString();
		} catch {
			return null;
		}
	};
	const lines = text.split(/\r?\n/);
	const out: string[] = [];
	let nextIsPlaylist = false;
	let dropNext = false;
	for (const line of lines) {
		const t = line.trim();
		if (t === '') {
			out.push(line);
			continue;
		}
		if (t.startsWith('#')) {
			// A variant's URI is the line after its tag.
			if (/^#EXT-X-STREAM-INF/i.test(t)) nextIsPlaylist = true;
			let dropped = false;
			const rewritten = t.replace(/URI=(["'])(.*?)\1/g, (_, q: string, uri: string) => {
				const a = abs(uri);
				const hint = /^#EXT-X-(MEDIA|I-FRAME-STREAM-INF)/i.test(t) ? 'playlist' : 'other';
				const l = a ? local(a, hint) : null;
				if (!l) dropped = true;
				return `URI=${q}${l ?? ''}${q}`;
			});
			if (dropped && /^#EXT-X-(MEDIA|I-FRAME-STREAM-INF)/i.test(t)) continue;
			if (dropped && /^#EXT-X-STREAM-INF/i.test(t)) {
				dropNext = true;
				continue;
			}
			out.push(rewritten);
			continue;
		}
		const a = abs(t);
		const l = a ? local(a, nextIsPlaylist ? 'playlist' : 'segment') : null;
		nextIsPlaylist = false;
		if (dropNext || !l) {
			dropNext = false;
			// An address that can't be served would stall the player: it goes with the tag
			// that introduced it (a segment's EXTINF, a variant's STREAM-INF).
			if (out.length && /^#(EXTINF|EXT-X-STREAM-INF)/i.test(out[out.length - 1].trim())) out.pop();
			continue;
		}
		out.push(l);
	}
	return out.join('\n');
}

/** A media playlist's length in seconds, the sum of its segments; null for a master playlist. */
export function playlistSeconds(text: string): number | null {
	if (/#EXT-X-STREAM-INF/i.test(text)) return null;
	let total = 0;
	let any = false;
	for (const m of text.matchAll(/^#EXTINF:\s*([\d.]+)/gim)) {
		total += Number(m[1]);
		any = true;
	}
	return any ? total : null;
}

/** A master playlist's variants: bits a second and height, best first. */
export function variantsOf(text: string): { bandwidth: number; height: number | null }[] {
	const out: { bandwidth: number; height: number | null }[] = [];
	for (const m of text.matchAll(/^#EXT-X-STREAM-INF:(.*)$/gim)) {
		const bw = /(?:^|,)\s*(?:AVERAGE-)?BANDWIDTH=(\d+)/i.exec(m[1]);
		const res = /RESOLUTION=\d+x(\d+)/i.exec(m[1]);
		if (bw) out.push({ bandwidth: Number(bw[1]), height: res ? Number(res[1]) : null });
	}
	return out.sort((a, b) => b.bandwidth - a.bandwidth);
}

// ---- subtitles -------------------------------------------------------------------------------

const vttTime = (t: string) => t.replace(',', '.');

/**
 * Subtitles as WebVTT, which the player reads (Anime Calls, "Subtitles"):
 * WebVTT as it is, SubRip's commas turned to dots, and SubStation's Dialogue
 * lines as plain cues (its styling dropped: the player draws its own).
 */
export function toVtt(text: string): string {
	const t = text.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n');
	if (t.trimStart().startsWith('WEBVTT')) return t;
	if (/^\[Script Info\]/im.test(t) || /^Dialogue:/m.test(t)) {
		const cues: string[] = [];
		const ass = (s: string) => {
			const [h, m, rest] = s.trim().split(':');
			const [sec, cs = '0'] = rest.split('.');
			return `${h.padStart(2, '0')}:${m.padStart(2, '0')}:${sec.padStart(2, '0')}.${cs.padEnd(3, '0').slice(0, 3)}`;
		};
		for (const line of t.split('\n')) {
			const m = /^Dialogue:\s*[^,]*,([^,]+),([^,]+),(?:[^,]*,){6}(.*)$/.exec(line);
			if (!m) continue;
			const words = m[3]
				.replace(/\{[^}]*\}/g, '')
				.replace(/\\[Nn]/g, '\n')
				.replace(/\\h/g, ' ')
				.trim();
			if (words) cues.push(`${ass(m[1])} --> ${ass(m[2])}\n${words}`);
		}
		return `WEBVTT\n\n${cues.join('\n\n')}\n`;
	}
	const body = t.replace(
		/(\d{1,2}:\d{2}:\d{2}[,.]\d{1,3})\s*-->\s*(\d{1,2}:\d{2}:\d{2}[,.]\d{1,3})/g,
		(_, a: string, b: string) => `${vttTime(a)} --> ${vttTime(b)}`
	);
	return `WEBVTT\n\n${body.trim()}\n`;
}

/**
 * The languages a track can be named in (doc/ANIME.md, "The settings sheet";
 * c386): the code the sheet shows, the English name its `title` says, then
 * every other way a source writes it -- ISO 639-2's three letters (both the
 * B and T forms), the language's own name. A source's label is matched
 * against all of them, so "Hungarian", "hun", "hu" and "Magyar" are all HU.
 */
export const LANGS: [code: string, name: string, ...aliases: string[]][] = [
	['af', 'Afrikaans', 'afr'],
	['am', 'Amharic', 'amh'],
	['ar', 'Arabic', 'ara', 'العربية'],
	['az', 'Azerbaijani', 'aze'],
	['be', 'Belarusian', 'bel'],
	['bg', 'Bulgarian', 'bul', 'български'],
	['bn', 'Bengali', 'ben', 'bangla', 'বাংলা'],
	['bs', 'Bosnian', 'bos'],
	['ca', 'Catalan', 'cat', 'català'],
	['cs', 'Czech', 'cze', 'ces', 'čeština'],
	['cy', 'Welsh', 'wel', 'cym'],
	['da', 'Danish', 'dan', 'dansk'],
	['de', 'German', 'ger', 'deu', 'deutsch'],
	['el', 'Greek', 'gre', 'ell', 'ελληνικά'],
	['en', 'English', 'eng'],
	['es', 'Spanish', 'spa', 'español', 'espanol', 'castellano', 'castilian'],
	['et', 'Estonian', 'est', 'eesti'],
	['eu', 'Basque', 'baq', 'eus', 'euskara'],
	['fa', 'Persian', 'per', 'fas', 'farsi', 'فارسی'],
	['fi', 'Finnish', 'fin', 'suomi'],
	['fil', 'Filipino', 'tagalog', 'tl', 'tgl'],
	['fr', 'French', 'fre', 'fra', 'français', 'francais'],
	['ga', 'Irish', 'gle', 'gaeilge'],
	['gl', 'Galician', 'glg', 'galego'],
	['gu', 'Gujarati', 'guj'],
	['he', 'Hebrew', 'heb', 'iw', 'עברית'],
	['hi', 'Hindi', 'hin', 'हिन्दी'],
	['hr', 'Croatian', 'hrv', 'hrvatski'],
	['hu', 'Hungarian', 'hun', 'magyar'],
	['hy', 'Armenian', 'arm', 'hye'],
	['id', 'Indonesian', 'ind', 'bahasa indonesia'],
	['is', 'Icelandic', 'ice', 'isl', 'íslenska'],
	['it', 'Italian', 'ita', 'italiano'],
	['ja', 'Japanese', 'jpn', 'jp', '日本語'],
	['ka', 'Georgian', 'geo', 'kat'],
	['kk', 'Kazakh', 'kaz'],
	['km', 'Khmer', 'khm'],
	['kn', 'Kannada', 'kan'],
	['ko', 'Korean', 'kor', '한국어'],
	['lo', 'Lao', 'lao'],
	['lt', 'Lithuanian', 'lit', 'lietuvių'],
	['lv', 'Latvian', 'lav', 'latviešu'],
	['mk', 'Macedonian', 'mac', 'mkd'],
	['ml', 'Malayalam', 'mal'],
	['mn', 'Mongolian', 'mon'],
	['mr', 'Marathi', 'mar'],
	['ms', 'Malay', 'may', 'msa', 'melayu', 'bahasa melayu'],
	['my', 'Burmese', 'bur', 'mya'],
	['nb', 'Norwegian Bokmål', 'nob', 'bokmål', 'bokmal'],
	['ne', 'Nepali', 'nep'],
	['nl', 'Dutch', 'dut', 'nld', 'nederlands', 'flemish'],
	['nn', 'Norwegian Nynorsk', 'nno', 'nynorsk'],
	['no', 'Norwegian', 'nor', 'norsk'],
	['pa', 'Punjabi', 'pan'],
	['pl', 'Polish', 'pol', 'polski'],
	['pt', 'Portuguese', 'por', 'português', 'portugues'],
	['ro', 'Romanian', 'rum', 'ron', 'română'],
	['ru', 'Russian', 'rus', 'русский'],
	['si', 'Sinhala', 'sin'],
	['sk', 'Slovak', 'slo', 'slk', 'slovenčina'],
	['sl', 'Slovenian', 'slv', 'slovene', 'slovenščina'],
	['sq', 'Albanian', 'alb', 'sqi'],
	['sr', 'Serbian', 'srp', 'srpski'],
	['sv', 'Swedish', 'swe', 'svenska'],
	['sw', 'Swahili', 'swa'],
	['ta', 'Tamil', 'tam'],
	['te', 'Telugu', 'tel'],
	['th', 'Thai', 'tha', 'ไทย'],
	['tr', 'Turkish', 'tur', 'türkçe'],
	['uk', 'Ukrainian', 'ukr', 'українська'],
	// ISO 639-2's "undetermined", which Matroska writes for an untagged track,
	// and the code a label with no letters gets (langCode).
	['und', 'Unknown', 'undetermined'],
	['ur', 'Urdu', 'urd'],
	['uz', 'Uzbek', 'uzb'],
	['vi', 'Vietnamese', 'vie', 'tiếng việt'],
	['yue', 'Cantonese', '粵語'],
	['zh', 'Chinese', 'chi', 'zho', 'mandarin', 'cmn', '中文'],
	['zu', 'Zulu', 'zul']
];

const BY_ALIAS = new Map<string, string>();
const NAME_OF = new Map<string, string>();
for (const [code, name, ...aliases] of LANGS) {
	NAME_OF.set(code, name);
	for (const a of [code, name.toLowerCase(), ...aliases]) BY_ALIAS.set(a, code);
}

/**
 * The variants a sheet tells apart, each a word a source may use for it.
 * Every other region a tag carries (`en-US`, `ja-JP`) is the language
 * itself: two cells reading EN-US and EN-GB would be a choice nobody makes.
 */
const VARIANTS: { base: string; code: string; name: string; words: string[] }[] = [
	{
		base: 'pt',
		code: 'BR',
		name: 'Brazil',
		words: ['br', 'brazil', 'brazilian', 'brasil', 'brasileiro']
	},
	{
		base: 'es',
		code: '419',
		name: 'Latin America',
		words: [
			'419',
			'latin',
			'latino',
			'latam',
			'latinoamérica',
			'latinoamerica',
			'mx',
			'mexico',
			'méxico',
			'la'
		]
	},
	{
		base: 'zh',
		code: 'HANT',
		name: 'Traditional',
		words: ['hant', 'traditional', 'tw', 'taiwan', 'hk', 'hong', '繁體']
	},
	{
		base: 'zh',
		code: 'HANS',
		name: 'Simplified',
		words: ['hans', 'simplified', 'cn', 'mainland', '简体']
	},
	{
		base: 'fr',
		code: 'CA',
		name: 'Canada',
		words: ['ca', 'canada', 'canadian', 'québec', 'quebec']
	}
];
/** A language a word can narrow a broader one to: "Norwegian (nob)" is Bokmål. */
const NARROWS: Record<string, string[]> = { no: ['nb', 'nn'], zh: ['yue'] };

const words = (label: string) =>
	label
		.trim()
		.toLowerCase()
		.split(/[\s()[\]{},;:/|_.-]+/)
		.filter(Boolean);

/** The language a label names and the variant it narrows to, if either is known. */
function parseLang(label: string): { base: string; variant: string | null } | null {
	const l = label.trim().toLowerCase();
	const w = words(label);
	let base = BY_ALIAS.get(l) ?? null;
	let at = -1;
	if (!base) {
		// Two words first ("bahasa indonesia", "norwegian bokmål"), then one.
		for (let i = 0; i < w.length && !base; i++) {
			const two = i + 1 < w.length ? BY_ALIAS.get(`${w[i]} ${w[i + 1]}`) : undefined;
			const one = BY_ALIAS.get(w[i]);
			if (two || one) {
				base = (two ?? one)!;
				at = i;
			}
		}
	}
	if (!base) return null;
	// The other words narrow it, wherever they stand: "Chinese (Traditional)",
	// and "Latin American Spanish" or "Brazilian Portuguese" as much.
	const rest = w.filter((_, i) => i !== at);
	const narrower = NARROWS[base]?.find((n) => rest.some((x) => BY_ALIAS.get(x) === n));
	if (narrower) return { base: narrower, variant: null };
	const v = VARIANTS.find((v) => v.base === base && rest.some((x) => v.words.includes(x)));
	return { base, variant: v?.code ?? null };
}

/**
 * A track's language as the sheet shows it (c386): its short code, `JA`,
 * `PT-BR`, `ES-419`, `ZH-HANT`, `NB`, whatever the source wrote ("English",
 * "eng", "en-US", "Chinese (Traditional)", "Norwegian (nob)", "Magyar"). A
 * name nobody knows is cut to a code of its own, so no cell ever holds a
 * whole word; the name itself goes in the cell's `title` (langName). The
 * cut code is its first word when that is two or three letters, else its
 * first three letters ("Klingon" is KLI), in ASCII with the accents
 * dropped. A cut that is itself an alias is that alias's language
 * ("Indonesia" cuts to IND, which is ID), and a label with no letters left
 * (blank, or in a script without them, "Тагальский") is UND. So every code
 * is one langCode gives back unchanged, and one the workstation keeps as a
 * choice (choices.ts, isLang).
 */
export function langCode(lang: string): string {
	const p = parseLang(lang);
	if (p) return (p.variant ? `${p.base}-${p.variant}` : p.base).toUpperCase();
	const ascii = words(lang)
		.map((w) => w.normalize('NFD').replace(/[^a-z]/g, ''))
		.filter(Boolean);
	const cut = /^[a-z]{2,3}$/.test(ascii[0] ?? '') ? ascii[0] : ascii.join('').slice(0, 3);
	if (cut.length < 2) return 'UND';
	return (BY_ALIAS.get(cut) ?? cut).toUpperCase();
}

/**
 * A track's language in full, for the cell's `title` and `aria-label` and
 * MORE's list (c386): "Portuguese (Brazil)", "Norwegian Bokmål". A label
 * nobody knows is given back as the source wrote it, trimmed, and a blank
 * one is "Unknown".
 */
export function langName(lang: string): string {
	const p = parseLang(lang);
	if (!p) return lang.trim() || 'Unknown';
	const name = NAME_OF.get(p.base) ?? p.base.toUpperCase();
	const v = p.variant ? VARIANTS.find((x) => x.base === p.base && x.code === p.variant) : null;
	return v ? `${name} (${v.name})` : name;
}

/**
 * The codes of one list of tracks, each its own: two names that come to the
 * same code ("Spanish" and "Español" on one server) are told apart as ES and
 * ES-2, since a choice is kept by its code and must pick one track.
 */
export function trackCodes(names: string[]): string[] {
	const seen = new Map<string, number>();
	return names.map((n) => {
		const code = langCode(n);
		const k = (seen.get(code) ?? 0) + 1;
		seen.set(code, k);
		return k === 1 ? code : `${code}-${k}`;
	});
}

/**
 * Which offered track a remembered choice means (c386). A choice is a code,
 * kept by the workstation, and a code offered as it is is that track: ES-2
 * is the second Spanish, never the first, and IND is a track whose source
 * named it so. Only a choice no track carries is read again: the codes grew
 * regions in c386 (PT-BR, ES-419) and lost ISO 639-2's three letters (`HUN`
 * is HU), so one kept before then is read through langCode and, failing the
 * exact code, takes the same language: PT finds PT-BR, PT-BR finds PT.
 * Undefined when nothing offered is that language.
 */
export function matchLang(choice: string, offered: string[]): string | undefined {
	if (offered.includes(choice)) return choice;
	const c = langCode(choice);
	if (offered.includes(c)) return c;
	const base = c.split('-')[0];
	return offered.find((o) => o === base) ?? offered.find((o) => o.split('-')[0] === base);
}

/**
 * How many languages a sheet row shows as cells before it collapses
 * (c386). Twelve is two lines of the 520px sheet's six cells: past that the
 * row would be taller than the rest of the sheet together, and on a TV's
 * 420px panel (four to a line) three lines already.
 */
export const LANG_ROW_MAX = 12;

/**
 * A language row's cells (c386): every language when there are LANG_ROW_MAX
 * or fewer; else only those that matter -- the ones in [keep] (what is on,
 * what the series or SETTINGS chose, the device's language, English) -- in
 * the source's order, and how many MORE · N holds besides.
 */
export function langRow(
	offered: string[],
	keep: (string | null | undefined)[]
): { shown: string[]; more: number } {
	if (offered.length <= LANG_ROW_MAX) return { shown: offered, more: 0 };
	const want = new Set<string>();
	for (const k of keep) {
		if (!k) continue;
		const m = matchLang(k, offered);
		if (m) want.add(m);
	}
	const shown = offered.filter((o) => want.has(o));
	return { shown, more: offered.length - shown.length };
}

/**
 * One audio track per language the source names (doc/ANIME.md, "Streams"):
 * KickAssAnime lists every language twice, two playlists apiece (live,
 * 2026-10-29: 16 tracks for 8 languages), which doubled the menu and the
 * download. The first the source lists is kept; names that differ
 * ("Spanish", "Spanish (Latin America)") are different tracks.
 */
export function onePerLanguage<T extends { lang?: string | null }>(tracks: T[]): T[] {
	const seen = new Set<string>();
	return tracks.filter((t) => {
		const name = (t.lang ?? '').trim().toLowerCase();
		if (seen.has(name)) return false;
		seen.add(name);
		return true;
	});
}

/**
 * A quality as the player names it: `1080P` when its height is known, else
 * the source's words up to its details. A source's own label can run to
 * "2160p (3840x2160) - 7.42 Mbps" (KickAssAnime), which overran the sheet
 * (reported 2026-10-29).
 */
export function qualityName(q: { label: string; height: number | null }): string {
	if (q.height) return `${q.height}P`;
	return (
		q.label
			.split(/\s+[-(]/)[0]
			.trim()
			.toUpperCase() || 'DEFAULT'
	);
}

/** A server's qualities in a few words: "UP TO 2160P", or how many when no height is known. */
export function qualitiesLine(qs: { label: string; height: number | null }[]): string {
	const top = Math.max(0, ...qs.map((q) => q.height ?? 0));
	if (top) return `UP TO ${top}P`;
	return qs.length === 1 ? qualityName(qs[0]) : `${qs.length} QUALITIES`;
}

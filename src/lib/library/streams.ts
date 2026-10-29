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

/** "en", "English", "eng" as the sheet names it: EN, JA, … */
export function langCode(lang: string): string {
	const l = lang.trim().toLowerCase();
	const NAMES: Record<string, string> = {
		english: 'en',
		eng: 'en',
		japanese: 'ja',
		jpn: 'ja',
		spanish: 'es',
		portuguese: 'pt',
		french: 'fr',
		german: 'de',
		italian: 'it',
		arabic: 'ar',
		russian: 'ru',
		indonesian: 'id',
		chinese: 'zh',
		korean: 'ko',
		hindi: 'hi',
		tamil: 'ta',
		telugu: 'te',
		thai: 'th',
		vietnamese: 'vi',
		turkish: 'tr',
		polish: 'pl'
	};
	const word = l.split(/[\s(_-]/)[0];
	return (NAMES[word] ?? (/^[a-z]{2}$/.test(word) ? word : l)).toUpperCase();
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

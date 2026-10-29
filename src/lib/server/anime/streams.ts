import { createHash } from 'node:crypto';
import { getDb } from '../db.ts';
import { VISIBLE_SQL } from '../visibility.ts';
import { publicFetchAt } from '../net-guard.ts';
import { engineMedia, engineMediaPath, EngineError } from '../engine/client.ts';
import { callSource } from '../engine/backend.ts';
import { USER_AGENT } from '../engine/protocol.ts';
import { parseAnimeKey } from '../../library/downloads.ts';
import {
	chaptersOf,
	headersOf,
	isPlaylist,
	langCode,
	playlistSeconds,
	rewritePlaylist,
	serversOf,
	toVtt,
	variantsOf,
	videoKind,
	type EngineVideo,
	type Range
} from '../../library/streams.ts';

/**
 * An episode's streams, through tsundoku (doc/ANIME.md, "Streams"; card
 * c155). The engine resolves an episode's videos (getVideoList); every
 * address in them, and in every playlist behind them, becomes a token of
 * tsundoku's own (`/api/anime/media/<token>`), so the browser never reaches
 * the engine (it has no route to it, and mustn't hold its token) or the site
 * (doc/PRIVACY.md). A token stands for an address and the headers the source
 * asked for, kept in memory: a restart forgets them, and the player resolves
 * again, as a stream gone stale is resolved again anyway.
 */

/**
 * An address and the headers its source asked for. [engine]: it's the
 * engine's own /video/ proxy, which only the engine's answers can name -- a
 * site's playlist naming a loopback address is fetched as any site address,
 * and refused (net-guard.ts).
 */
type Target = {
	url: string;
	headers: Record<string, string>;
	engine: boolean;
	/**
	 * A master playlist tsundoku writes itself: a video whose audio the source
	 * gives as separate tracks (KickAssAnime's), named as alternate audio so
	 * the player switches them as any HLS stream's.
	 */
	master?: { video: string; audio: { lang: string; token: string }[] };
};

const KEPT = 50_000;
const targets = new Map<string, Target>();

/** One address as a token, the same token for the same address and headers. */
export function register(t: Target): string {
	const token = createHash('sha256')
		.update(`${t.engine ? 'e' : 's'}\n${t.url}\n${JSON.stringify(t.headers)}`)
		.digest('base64url')
		.slice(0, 32);
	targets.delete(token);
	targets.set(token, t);
	if (targets.size > KEPT) targets.delete(targets.keys().next().value!);
	return token;
}

export const targetOf = (token: string) => targets.get(token) ?? null;
export const mediaRoute = (token: string) => `/api/anime/media/${token}`;
export const subtitleRoute = (token: string) => `/api/anime/subtitle/${token}`;

export class StreamError extends Error {
	readonly status: number;
	constructor(message: string, status: number) {
		super(message);
		this.status = status;
	}
}

/**
 * The bytes behind a token: the engine's /video/ proxy through ENGINE_URL,
 * anything else from the site with the source's headers, internet only,
 * every redirect too. Returns the response and the address it ended at.
 */
async function fetchTarget(
	t: Target,
	range: string | null
): Promise<{ res: Response; url: string }> {
	const path = t.engine ? engineMediaPath(t.url) : null;
	if (path) return { res: await engineMedia(path, { range }), url: t.url };
	return publicFetchAt(t.url, {
		headers: {
			'user-agent': USER_AGENT,
			...t.headers,
			...(range ? { range } : {})
		},
		signal: AbortSignal.timeout(60_000)
	});
}

const MAX_PLAYLIST = 5 * 1024 * 1024;

/**
 * GET /api/anime/media/<token>: a playlist rewritten into tokens, or a
 * segment (or a whole file) streamed through as it comes, Range and all.
 */
export async function serveMedia(token: string, range: string | null): Promise<Response> {
	const t = targetOf(token);
	if (!t) throw new StreamError('not found', 404);
	if (t.master) return serveMaster(t.master);
	let got: { res: Response; url: string };
	try {
		got = await fetchTarget(t, range);
	} catch (e) {
		throw new StreamError((e as Error).message, e instanceof EngineError ? 503 : 502);
	}
	const { res, url } = got;
	if (!res.ok) throw new StreamError(`the stream answered ${res.status}`, 502);
	const type = res.headers.get('content-type') ?? '';
	const length = Number(res.headers.get('content-length') ?? 0);
	const looksLikePlaylist =
		/mpegurl/i.test(type) || /\.m3u8(\?|$)/i.test(new URL(url).pathname + new URL(url).search);
	if (looksLikePlaylist && (!length || length <= MAX_PLAYLIST)) {
		const text = await res.text();
		if (isPlaylist(text))
			return new Response(
				rewritePlaylist(text, url, (abs) =>
					mediaRoute(
						register({
							url: abs,
							headers: t.headers,
							engine: t.engine && engineMediaPath(abs) !== null
						})
					)
				),
				{
					headers: {
						'content-type': 'application/vnd.apple.mpegurl',
						'cache-control': 'private, no-store'
					}
				}
			);
		return new Response(text, { headers: { 'content-type': type || 'text/plain' } });
	}
	const headers: Record<string, string> = {
		'content-type': type || 'application/octet-stream',
		'cache-control': 'private, max-age=3600'
	};
	for (const h of ['content-length', 'content-range', 'accept-ranges'])
		if (res.headers.get(h)) headers[h] = res.headers.get(h)!;
	return new Response(res.body, { status: res.status, headers });
}

/**
 * The master playlist for a video with separate audio. A video that is a
 * master playlist already can't be nested in another: it's served as it is,
 * its own audio with it.
 */
async function serveMaster(m: NonNullable<Target['master']>): Promise<Response> {
	const video = targetOf(m.video);
	if (!video) throw new StreamError('not found', 404);
	let head = '';
	try {
		const { res } = await fetchTarget(video, null);
		head = res.ok ? await res.text() : '';
	} catch {
		// The video's own request says what's wrong, when the player makes it.
	}
	if (/#EXT-X-STREAM-INF/i.test(head)) return serveMedia(m.video, null);
	const quote = (s: string) => s.replace(/"/g, '');
	const lines = ['#EXTM3U', '#EXT-X-VERSION:3'];
	m.audio.forEach((a, i) =>
		lines.push(
			`#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID="aud",NAME="${quote(a.lang) || `AUDIO ${i + 1}`}",LANGUAGE="${quote(a.lang.toLowerCase())}",DEFAULT=${i === 0 ? 'YES' : 'NO'},AUTOSELECT=YES,URI="${mediaRoute(a.token)}"`
		)
	);
	lines.push('#EXT-X-STREAM-INF:BANDWIDTH=2000000,AUDIO="aud"', mediaRoute(m.video));
	return new Response(lines.join('\n'), {
		headers: {
			'content-type': 'application/vnd.apple.mpegurl',
			'cache-control': 'private, no-store'
		}
	});
}

/** GET /api/anime/subtitle/<token>: a subtitle track as WebVTT, whatever it was. */
export async function serveSubtitle(token: string): Promise<Response> {
	const t = targetOf(token);
	if (!t) throw new StreamError('not found', 404);
	let got: { res: Response; url: string };
	try {
		got = await fetchTarget(t, null);
	} catch (e) {
		throw new StreamError((e as Error).message, 502);
	}
	if (!got.res.ok) throw new StreamError(`the subtitles answered ${got.res.status}`, 502);
	const text = await got.res.text();
	return new Response(toVtt(text), {
		headers: { 'content-type': 'text/vtt; charset=utf-8', 'cache-control': 'private, max-age=3600' }
	});
}

// ---- an episode -----------------------------------------------------------------------------

export type Track = { lang: string; src: string };
export type StreamQuality = {
	label: string;
	height: number | null;
	/** HLS, or a file the browser plays itself (videoKind). */
	kind: 'hls' | 'file';
	src: string;
	audio: Track[];
	subtitles: Track[];
};
export type StreamServer = { n: number; name: string; qualities: StreamQuality[] };
export type EpisodeStreams = {
	entryId: number;
	servers: StreamServer[];
	intro: Range | null;
	ending: Range | null;
	resolvedAt: number;
};

type EpisodeRow = {
	id: number;
	source_url: string;
	label: string;
	title: string;
	origin_key: string | null;
};

/** An anime episode the viewer may see: hidden means hidden, a 404 like any other. */
export function episodeRow(entryId: number, reveal: boolean): EpisodeRow | null {
	return (
		(getDb()
			.prepare(
				`SELECT e.id, e.source_url, e.label, e.title, s.origin_key FROM entries e
				JOIN series s ON s.id = e.series_id JOIN roots r ON r.id = s.root_id
				WHERE e.id = ? AND s.kind = 'anime' AND (? OR ${VISIBLE_SQL})`
			)
			.get(entryId, reveal ? 1 : 0) as EpisodeRow | undefined) ?? null
	);
}

// Resolving takes seconds (minutes through a challenge), and a player asks
// again on every reload: an answer is kept briefly, and TRY AGAIN asks fresh.
const KEEP_MS = 10 * 60 * 1000;
const resolved = new Map<number, EpisodeStreams>();

/** A first call through a site's browser check took 42 s in the spike; hosters have 30 s each. */
const RESOLVE_MS = 120_000;

/**
 * The episode's servers and their qualities, every address a token
 * (Player Waiting 3a/3b). [fresh] asks the source again: after a failure,
 * since a stream that stopped may simply have gone stale.
 */
export async function episodeStreams(
	entryId: number,
	reveal: boolean,
	fresh = false,
	now = Date.now()
): Promise<EpisodeStreams | null> {
	const e = episodeRow(entryId, reveal);
	const key = parseAnimeKey(e?.origin_key ?? null);
	if (!e || !key || !e.source_url) return null;
	const kept = resolved.get(entryId);
	if (!fresh && kept && now - kept.resolvedAt < KEEP_MS) return kept;
	const videos = await callSource<EngineVideo[]>(
		key.sourceId,
		'getVideoList',
		{ episodeData: { url: e.source_url, name: e.title || e.label } },
		RESOLVE_MS
	);
	const list = Array.isArray(videos) ? videos : [];
	const tracks = (
		ts: { url: string; lang: string }[] | null | undefined,
		h: Record<string, string>,
		sub: boolean
	) =>
		(ts ?? [])
			.filter((t) => t?.url)
			.map((t) => {
				const token = register({ url: t.url, headers: h, engine: engineMediaPath(t.url) !== null });
				return {
					lang: langCode(t.lang || ''),
					src: sub ? subtitleRoute(token) : mediaRoute(token)
				};
			});
	const servers = serversOf(list).map((s) => ({
		n: s.n,
		name: s.name,
		qualities: s.qualities.map((q) => {
			const headers = headersOf(q.video.headers);
			const address = (q.video.videoUrl || q.video.url)!;
			const video = register({
				url: address,
				headers,
				engine: engineMediaPath(address) !== null
			});
			const audio = (q.video.audioTracks ?? [])
				.filter((t) => t?.url)
				.map((t) => ({
					lang: langCode(t.lang || ''),
					token: register({ url: t.url, headers, engine: engineMediaPath(t.url) !== null })
				}));
			// Separate audio: a master playlist of tsundoku's own names it.
			const src = audio.length
				? mediaRoute(
						register({
							url: `master:${video}`,
							headers: {},
							engine: false,
							master: { video, audio }
						})
					)
				: mediaRoute(video);
			return {
				label: q.label,
				height: q.height,
				kind: audio.length ? ('hls' as const) : videoKind(address),
				src,
				audio: audio.map((a) => ({ lang: a.lang, src: mediaRoute(a.token) })),
				subtitles: tracks(q.video.subtitleTracks, headers, true)
			};
		})
	}));
	const marks = list.map(chaptersOf).find((c) => c.intro || c.ending) ?? {
		intro: null,
		ending: null
	};
	const out: EpisodeStreams = { entryId, servers, ...marks, resolvedAt: now };
	resolved.set(entryId, out);
	if (resolved.size > 500) resolved.delete(resolved.keys().next().value!);
	if (marks.ending)
		getDb()
			.prepare(`UPDATE entries SET ending_at = ? WHERE id = ?`)
			.run(marks.ending.start, entryId);
	return out;
}

/**
 * What a stream is: its length and bits a second, from its playlists (a
 * master's best variant's BANDWIDTH; a media playlist's segments). For
 * ALL N's ABOUT sizes (c157); getVideoList gives no bitrate.
 */
export async function probe(
	src: string
): Promise<{ seconds: number | null; bandwidth: number | null }> {
	const token = /\/api\/anime\/media\/([A-Za-z0-9_-]{32})$/.exec(src)?.[1];
	const t = token ? targetOf(token) : null;
	if (!t) return { seconds: null, bandwidth: null };
	const text = async (target: Target) => {
		const { res, url } = await fetchTarget(target, null);
		return { text: res.ok ? await res.text() : '', url };
	};
	const top = await text(t);
	if (!isPlaylist(top.text)) return { seconds: null, bandwidth: null };
	const variants = variantsOf(top.text);
	if (variants.length === 0) return { seconds: playlistSeconds(top.text), bandwidth: null };
	// The best variant's own playlist says how long the episode is.
	let first: string | null = null;
	rewritePlaylist(top.text, top.url, (abs, hint) => {
		if (hint === 'playlist' && !first) first = abs;
		return abs;
	});
	const media = first
		? await text({
				url: first,
				headers: t.headers,
				engine: t.engine && engineMediaPath(first) !== null
			})
		: null;
	return { seconds: media ? playlistSeconds(media.text) : null, bandwidth: variants[0].bandwidth };
}

/** For tests: forget what's kept. */
export function forgetStreams(): void {
	targets.clear();
	resolved.clear();
}

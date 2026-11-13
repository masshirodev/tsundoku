import { error, json } from '@sveltejs/kit';
import { videoKindsSql } from '$lib/library/kinds';
import { statfsSync } from 'node:fs';
import type { RequestHandler } from './$types';
import { getDb } from '$lib/server/db';
import { isRevealed } from '$lib/server/prefs';
import { libraryRoot } from '$lib/server/import';
import { VISIBLE_SQL } from '$lib/server/visibility';
import { episodeStreams, probe } from '$lib/server/anime/streams';
import { EngineError } from '$lib/server/engine/client';
import { aboutBytes } from '$lib/library/anime';

/**
 * ALL N's sizes for an anime (Index Anime Series, confirm; doc/ANIME.md,
 * "Downloading"): an episode's ABOUT size at each height its source offers,
 * from one episode's streams (bits a second, from the playlists, times its
 * length), and the room left on the library's disk. Asked when the
 * confirmation opens, kept half an hour: it takes seconds, and a source's
 * bitrates don't change by the minute.
 */
const kept = new Map<number, { at: number; body: unknown }>();
const KEEP_MS = 30 * 60 * 1000;

export const GET: RequestHandler = async ({ params, cookies }) => {
	const id = Number(params.id);
	const reveal = isRevealed(cookies);
	const s = getDb()
		.prepare(
			`SELECT s.id FROM series s JOIN roots r ON r.id = s.root_id
			WHERE s.id = ? AND ${videoKindsSql('s')} AND (? OR ${VISIBLE_SQL})`
		)
		.get(id, reveal ? 1 : 0);
	if (!s) error(404, 'not found');
	const k = kept.get(id);
	if (k && Date.now() - k.at < KEEP_MS) return json(k.body);
	const e = getDb()
		.prepare(
			`SELECT id, duration_s FROM entries WHERE series_id = ? AND available = 0 AND source_url != ''
			ORDER BY read_at IS NOT NULL, position LIMIT 1`
		)
		.get(id) as { id: number; duration_s: number | null } | undefined;
	let free: number | null = null;
	try {
		const f = statfsSync(libraryRoot());
		free = f.bavail * f.bsize;
	} catch {
		// The disk doesn't say: the line leaves it out.
	}
	if (!e) return json({ sizes: [], free });
	let streams;
	try {
		streams = await episodeStreams(e.id, reveal, false);
	} catch (err) {
		if (err instanceof EngineError) return json({ sizes: [], free });
		throw err;
	}
	const seen = new Map<number, number | null>();
	for (const server of streams?.servers ?? [])
		for (const q of server.qualities) {
			if (q.height === null || seen.has(q.height)) continue;
			const p = await probe(q.src).catch(() => ({ seconds: null, bandwidth: null }));
			seen.set(
				q.height,
				p.bandwidth ? aboutBytes(p.seconds ?? e.duration_s ?? 1440, p.bandwidth) : null
			);
		}
	const body = {
		sizes: [...seen].sort((a, b) => b[0] - a[0]).map(([height, bytes]) => ({ height, bytes })),
		free
	};
	kept.set(id, { at: Date.now(), body });
	return json(body);
};

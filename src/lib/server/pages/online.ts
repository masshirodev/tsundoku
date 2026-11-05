import { getDb } from '../db.ts';
import { parseAnimeKey, parseKey } from '../../library/downloads.ts';
import { engineConfigured, fetchProxied } from '../engine/client.ts';
import { extensionFor } from '../engine/extensions.ts';
import { imageType } from '../engine/protocol.ts';
import { chapterAtSource } from '../engine/worker.ts';

/**
 * A chapter read online (doc/BROWSING.md, "Manga online"; card c166): a
 * chapter with no file, from a series a source serves, read straight from
 * the source through the engine. Nothing is written: the page list is kept
 * in memory a few minutes, and each page passes through on its way to the
 * reader, which holds it only while it's near (the owner's answer to
 * question 4: the tablet keeps downloaded chapters, never online pages).
 */

/** How long a chapter's page list is trusted: a source's addresses go stale, and the engine forgets its tokens on restart. */
const KEEP_MS = 10 * 60 * 1000;
const MAX_KEPT = 200;
const lists = new Map<number, { at: number; targets: string[] }>();

/** Whether an entry reads online: no file, from a source an installed extension serves. */
export function readsOnline(entryId: number, db = getDb()): boolean {
	if (!engineConfigured()) return false;
	const r = db
		.prepare(
			`SELECT e.available, s.origin_key FROM entries e JOIN series s ON s.id = e.series_id WHERE e.id = ?`
		)
		.get(entryId) as { available: number; origin_key: string | null } | undefined;
	if (!r || r.available) return false;
	const key = parseKey(r.origin_key);
	return !!key && extensionFor(key.sourceId, db) !== null;
}

/**
 * Whether an episode streams (doc/ANIME.md, "Streams"; c536): no file, an
 * Aniyomi series' episode with its own address at the source, from a source
 * an installed extension serves -- the episode's own source when it was kept
 * from one the series left (doc/MOVE.md). The player's `episodeStreams` asks
 * exactly these before it calls the source, so the end page's WATCH ONLINE and
 * the player agree without a network call. A separate question from
 * `readsOnline` on purpose: the image reader's online manifests ask that one
 * (pages/index.ts), and an episode is never a page list it can read.
 */
export function streamsOnline(entryId: number, db = getDb()): boolean {
	if (!engineConfigured()) return false;
	const r = db
		.prepare(
			`SELECT e.available, e.source_url, e.origin_source, s.origin_key FROM entries e
			JOIN series s ON s.id = e.series_id WHERE e.id = ?`
		)
		.get(entryId) as
		| { available: number; source_url: string; origin_source: string; origin_key: string | null }
		| undefined;
	if (!r || r.available || !r.source_url) return false;
	const key = parseAnimeKey(r.origin_key);
	return !!key && extensionFor(r.origin_source || key.sourceId, db) !== null;
}

async function listOf(entryId: number, fresh = false): Promise<{ at: number; targets: string[] }> {
	const kept = lists.get(entryId);
	if (!fresh && kept && Date.now() - kept.at < KEEP_MS) return kept;
	const { pages } = await chapterAtSource(entryId, { db: getDb(), now: Date.now });
	const list = {
		at: Date.now(),
		targets: [...pages].sort((a, b) => a.index - b.index).map((p) => p.imageUrl || p.url)
	};
	lists.delete(entryId);
	lists.set(entryId, list);
	if (lists.size > MAX_KEPT) lists.delete(lists.keys().next().value!);
	return list;
}

/**
 * The chapter's pages, sizes unknown until each arrives (the source gives
 * none). The reader sizes each page's box from its image once it arrives,
 * and from the last one that arrived meanwhile (shapeOf in $lib/reader/reader).
 * The version names it as online, so the page route never lets it be kept.
 */
export async function onlineManifest(entryId: number) {
	const l = await listOf(entryId);
	return {
		entryId,
		version: `online-${l.at}`,
		pages: l.targets.map(() => ({ w: 0, h: 0 })),
		online: true as const
	};
}

export const isOnlineVersion = (v: string | null) => !!v && v.startsWith('online-');

/**
 * One page, through the engine's proxy. A failure asks the source for the
 * list again once: the address may have gone stale, or the engine restarted.
 */
export async function readOnlinePage(
	entryId: number,
	index: number
): Promise<{ body: Buffer; type: string; size: number } | null> {
	for (const fresh of [false, true]) {
		const l = await listOf(entryId, fresh);
		const target = l.targets[index];
		if (!target) return null;
		try {
			const { bytes } = await fetchProxied(target);
			const type = imageType(bytes);
			if (!type) throw new Error('not an image');
			return {
				body: Buffer.from(bytes),
				type: `image/${type === 'jpg' ? 'jpeg' : type}`,
				size: bytes.length
			};
		} catch (e) {
			if (fresh) throw e;
		}
	}
	return null;
}

/** For tests: forget every kept list. */
export const forgetOnline = () => lists.clear();

import type { PageServerLoad } from './$types';
import { getDb } from '$lib/server/db';
import { isRevealed } from '$lib/server/prefs';
import { reviewQueue } from '$lib/server/dupes';

/**
 * The duplicate books review (Pair Review; doc/DUPLICATE-BOOKS.md): the pairs
 * to settle, closest first, as many as reveal lets be seen. `?pair=` opens on
 * one, from a series screen's band.
 */
export const load: PageServerLoad = ({ cookies, url }) => {
	const pairs = reviewQueue(isRevealed(cookies));
	// What the covers and page thumbnails are asked for with.
	const info = getDb().prepare(`SELECT bytes, page_count, cover_page FROM entries WHERE id = ?`);
	const art = (entryId: number) => {
		const r = info.get(entryId) as { bytes: number; page_count: number; cover_page: number | null };
		return { id: entryId, bytes: r.bytes, pageCount: r.page_count, coverPage: r.cover_page };
	};
	return {
		pairs: pairs.map((p) => ({ ...p, art: { a: art(p.a.entryId), b: art(p.b.entryId) } })),
		start: url.searchParams.get('pair')
	};
};

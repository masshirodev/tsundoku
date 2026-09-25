import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { isIncognito, isRevealed } from '$lib/server/prefs';
import { readableEntry, recordReading } from '$lib/server/series';
import { afterReading } from '$lib/server/tracking';

const KINDS = new Set(['open', 'page', 'finish', 'close']);

/**
 * The reader's one progress call (doc/READING-LOG.md): open, page, finish,
 * close. Built ahead of the reader so the incognito guarantee lives here, on
 * the server, rather than in whichever reader code remembers to check.
 *
 * While incognito the event is dropped before it reaches the log -- never
 * written, not written and hidden -- and the answer says so, so the reader
 * can show NOT SAVED from the server's word rather than its own guess.
 */
export const POST: RequestHandler = async ({ request, cookies }) => {
	const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
	const seriesId = Number(body?.seriesId);
	const entryId = Number(body?.entryId);
	const kind = String(body?.kind ?? '');
	const page = body?.page == null ? undefined : Number(body.page);
	const durationMs = body?.durationMs == null ? undefined : Number(body.durationMs);
	// Text (doc/TEXT-READER.md): `page` is the paragraph, `offset` the
	// character in it, `total` how many paragraphs the entry has.
	const offset = body?.offset == null ? undefined : Number(body.offset);
	const total = body?.total == null ? undefined : Number(body.total);
	// Read offline and sent later: the event keeps the time it happened, so
	// history puts it on the right day. Never in the future, never older than
	// a month (doc/OFFLINE.md).
	const now = Date.now();
	const at =
		body?.at == null || !Number.isFinite(Number(body.at))
			? now
			: Math.min(now, Math.max(now - 30 * 24 * 3600_000, Number(body.at)));
	if (
		!Number.isInteger(seriesId) ||
		!Number.isInteger(entryId) ||
		!KINDS.has(kind) ||
		(page !== undefined && (!Number.isInteger(page) || page < 0)) ||
		(durationMs !== undefined && !Number.isFinite(durationMs)) ||
		(offset !== undefined && (!Number.isInteger(offset) || offset < 0)) ||
		(total !== undefined && (!Number.isInteger(total) || total < 1))
	) {
		error(400, 'bad reading event');
	}
	// A hidden series can only be read while reveal is on: the same 404 as
	// one that doesn't exist.
	if (!readableEntry(seriesId, entryId, isRevealed(cookies))) error(404, 'not found');

	if (isIncognito(cookies)) return json({ saved: false });
	recordReading({
		seriesId,
		entryId,
		kind: kind as 'open' | 'page' | 'finish' | 'close',
		page,
		offset,
		total,
		durationMs,
		now: at
	});
	// A chapter finished moves the catalogues forward (doc/TRACKING.md). Incognito
	// never gets here: nothing recorded, nothing sent.
	if (kind === 'finish') afterReading(seriesId);
	return json({ saved: true });
};

import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { isRevealed } from '$lib/server/prefs';
import {
	deleteHighlight,
	HighlightError,
	setNote,
	undoDeleteHighlight
} from '$lib/server/highlights';

/**
 * A highlight from the reader's page sheet (card c703, Manga M6): PATCH
 * `{ note }` sets the note, DELETE sets it aside at once for the band's UNDO
 * (the same `UNDO_MS` as /highlights), and POST `{ undo: true }` takes it
 * back. Hidden means hidden: a hidden series' highlight is the same 404
 * without reveal.
 */
const idOf = (raw: string) => {
	const id = Number(raw);
	if (!Number.isInteger(id) || id <= 0) error(404, 'not found');
	return id;
};

export const PATCH: RequestHandler = async ({ params, request, cookies }) => {
	const id = idOf(params.id);
	const body = (await request.json().catch(() => null)) as { note?: unknown } | null;
	if (typeof body?.note !== 'string') error(400, 'a note');
	try {
		setNote(id, body.note, isRevealed(cookies));
	} catch (e) {
		if (e instanceof HighlightError) error(404, 'not found');
		throw e;
	}
	return json({ ok: true });
};

export const DELETE: RequestHandler = async ({ params, cookies }) => {
	const id = idOf(params.id);
	try {
		deleteHighlight(id, isRevealed(cookies));
	} catch (e) {
		if (e instanceof HighlightError) error(404, 'not found');
		throw e;
	}
	return json({ ok: true });
};

export const POST: RequestHandler = async ({ params, request, cookies }) => {
	const id = idOf(params.id);
	const body = (await request.json().catch(() => null)) as { undo?: unknown } | null;
	if (body?.undo !== true) error(400, 'undo');
	if (!undoDeleteHighlight(id, isRevealed(cookies))) error(404, 'not found');
	return json({ ok: true });
};

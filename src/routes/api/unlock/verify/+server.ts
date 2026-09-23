import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { GateRefused, verify, type Purpose } from '$lib/server/unlock';

const PURPOSES = new Set<Purpose>(['reveal', 'enrol', 'remove']);

/** The second half: the device's answer, checked, and the gate's effect. */
export const POST: RequestHandler = async ({ request, url, cookies }) => {
	const body = ((await request.json().catch(() => ({}))) ?? {}) as {
		purpose?: Purpose;
		response?: unknown;
	};
	if (!body.purpose || !PURPOSES.has(body.purpose)) error(400, 'unknown purpose');
	try {
		await verify(body.purpose, body.response, url, cookies);
		return json({ ok: true });
	} catch (e) {
		// Any failure is the same answer: not unlocked, nothing shown.
		if (e instanceof GateRefused || e instanceof Error) error(403, 'not unlocked');
		throw e;
	}
};

import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { GateRefused, options, type Purpose } from '$lib/server/unlock';

const PURPOSES = new Set<Purpose>(['reveal', 'enrol', 'remove']);

/** The first half of a WebAuthn ceremony for the /reveal gate (doc/PRIVACY.md). */
export const POST: RequestHandler = async ({ request, url, cookies }) => {
	const { purpose } = ((await request.json().catch(() => ({}))) ?? {}) as { purpose?: Purpose };
	if (!purpose || !PURPOSES.has(purpose)) error(400, 'unknown purpose');
	try {
		return json(await options(purpose, url, cookies));
	} catch (e) {
		if (e instanceof GateRefused) error(403, e.message);
		throw e;
	}
};

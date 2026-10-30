import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { check, startInstall, updateView } from '$lib/server/updates';

/**
 * Updates (doc/UPDATES.md): what's out and how an install is going (GET, which
 * SETTINGS polls while one runs), CHECK now, or INSTALL (POST). 404 where
 * updates are off: the workstation, or TSUNDOKU_UPDATES=off.
 */
export const GET: RequestHandler = () => {
	const view = updateView();
	if (!view) error(404, 'updates are off');
	return json(view);
};

export const POST: RequestHandler = async ({ request }) => {
	if (!updateView()) error(404, 'updates are off');
	const { action } = (await request.json().catch(() => ({}))) as { action?: string };
	if (action === 'check') {
		await check();
		return json(updateView());
	}
	if (action === 'install') {
		const r = startInstall();
		if (!r.ok) error(409, r.error);
		return json(updateView(), { status: 202 });
	}
	error(400, 'action is check or install');
};

import { json } from '@sveltejs/kit';
import { runCommand } from '$lib/server/prefs';
import { isGated } from '$lib/server/unlock';
import { startScan } from '$lib/server/import';
import type { RequestHandler } from './$types';

/**
 * A command typed into a top search bar that is not `/search` (card c697).
 * The same `runCommand` the library's own `?/command` and `/search`'s action
 * call, with the same fingerprint gate: a POST here never turns `/reveal` on
 * behind a gate (doc/PRIVACY.md).
 *
 * `/scan` starts the scan the library shows; `/words` opens its page; `/lock`,
 * `/unlock` and a gated `/reveal` need the device prompt only `/search` draws,
 * so they are sent there with the command filled in and `{ go: true }` in
 * history state, which runs it on arrival (c711). Everything else runs in
 * place: the caller re-reads its loads.
 */
export const POST: RequestHandler = async ({ request, cookies, url }) => {
	const body = (await request.json().catch(() => null)) as { command?: unknown } | null;
	const command = typeof body?.command === 'string' ? body.command : '';
	if (command === 'scan') {
		startScan();
		return json({ ok: true });
	}
	if (command === 'words') return json({ ok: true, href: '/words' });
	if (command === 'lock' || command === 'unlock' || (command === 'reveal' && isGated())) {
		// The intent travels in history state, not in the URL: a typed or shared
		// `?go=1` link cannot then run a command on arrival (c697, round 2). This
		// answer shows nothing; only the device's signature at `/search` does.
		return json({
			ok: true,
			href: `/search?q=${encodeURIComponent(`/${command}`)}`,
			state: { go: true }
		});
	}
	if (!runCommand(cookies, command, url, { gated: isGated() })) {
		return json({ ok: false, message: 'unknown command · nothing changed' });
	}
	return json({ ok: true });
};

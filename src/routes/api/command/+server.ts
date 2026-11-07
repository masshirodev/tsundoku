import { json } from '@sveltejs/kit';
import { runCommand } from '$lib/server/prefs';
import { isGated } from '$lib/server/unlock';
import { startScan } from '$lib/server/import';
import type { RequestHandler } from './$types';

/**
 * A command typed into a top search bar that is not `/search` (card c697).
 * The same `runCommand` the library's own `?/command` and `/search`'s action
 * call, with the same fingerprint gate: `/reveal` behind a gate is refused
 * here exactly as a plain POST of it is from `/search` (doc/PRIVACY.md).
 *
 * `/scan` starts the scan the library shows; `/words` opens its page; `/lock`
 * and `/unlock` need the device prompt only `/search` draws, so they are sent
 * there with the command filled in (`&go=1` runs it on arrival). Everything
 * else runs in place: the caller re-reads its loads.
 */
export const POST: RequestHandler = async ({ request, cookies, url }) => {
	const body = (await request.json().catch(() => null)) as { command?: unknown } | null;
	const command = typeof body?.command === 'string' ? body.command : '';
	if (command === 'scan') {
		startScan();
		return json({ ok: true });
	}
	if (command === 'words') return json({ ok: true, href: '/words' });
	if (command === 'lock' || command === 'unlock') {
		return json({ ok: true, href: `/search?q=${encodeURIComponent(`/${command}`)}&go=1` });
	}
	// The gate is asked before runCommand runs, so its refusal can say why:
	// runCommand's `false` alone is also an unknown command's answer.
	if (command === 'reveal' && isGated()) {
		return json({ ok: false, message: '/reveal asks for this device · open search' });
	}
	if (!runCommand(cookies, command, url, { gated: isGated() })) {
		return json({ ok: false, message: 'unknown command · nothing changed' });
	}
	return json({ ok: true });
};

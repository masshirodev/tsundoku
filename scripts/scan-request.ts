/**
 * Ask the running app to import, the way START SCAN does (doc/SYNC.md, "Why
 * the app imports, not the timer"). Shared by the sync and Suwayomi timers.
 * Signed in as the tablet is, from the token in .env. Neither is printed.
 */
import { sessionValueFor } from '../src/lib/server/session.ts';

export async function requestScan(): Promise<{ started: boolean; looked?: string }> {
	const token = process.env.TSUNDOKU_TOKEN;
	if (!token) throw new Error('TSUNDOKU_TOKEN is not set in .env');
	const session = sessionValueFor(token);
	const port = Number(process.env.PORT ?? 42143);
	const res = await fetch(`http://127.0.0.1:${port}/api/scan`, {
		method: 'POST',
		headers: { cookie: `tsundoku_session=${session}` }
	});
	if (!res.ok) throw new Error(`the app answered ${res.status}; is it running (yarn run serve)?`);
	return (await res.json()) as { started: boolean; looked?: string };
}

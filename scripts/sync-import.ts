/**
 * The sync timer's step (doc/SYNC.md): once Syncthing has finished receiving
 * from the tablet and something arrived, ask the running app to import.
 *
 *   yarn run sync-import            # what the timer runs
 *   yarn run sync-import -- --force # import even if nothing moved
 *
 * The app imports, not this script: one import at a time, with the band,
 * the NEW shelf and covers, exactly as START SCAN.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { syncDecision, type FolderStatus } from '../src/lib/import/sync.ts';
import { sessionValueFor } from '../src/lib/server/session.ts';
import { st, type FolderConfig } from './syncthing.ts';

try {
	process.loadEnvFile(fileURLToPath(new URL('../.env', import.meta.url)));
} catch {
	// No .env: the defaults.
}

const library = resolve(process.env.LIBRARY_ROOT ?? '/mnt/hdd2/tsundoku/library');
const statePath = join(
	process.env.XDG_STATE_HOME ?? join(homedir(), '.local', 'state'),
	'tsundoku',
	'sync.json'
);

function lastSequences(): Record<string, number> {
	try {
		return JSON.parse(readFileSync(statePath, 'utf8')) as Record<string, number>;
	} catch {
		return {};
	}
}

const folders = (await st<FolderConfig[]>('/rest/config/folders')).filter((f) =>
	resolve(f.path).startsWith(`${library}/`)
);
const statuses: FolderStatus[] = [];
for (const f of folders) {
	const s = await st<{ state: string; needFiles: number; sequence: number }>(
		`/rest/db/status?folder=${encodeURIComponent(f.id)}`
	);
	statuses.push({ id: f.id, state: s.state, needFiles: s.needFiles, sequence: s.sequence });
}

const force = process.argv.includes('--force');
const d = syncDecision(statuses, force ? {} : lastSequences());
if (d.kind === 'none') console.log(`sync: ${d.why}; nothing to do.`);
else if (d.kind === 'wait') console.log(`sync: still receiving (${d.why}); next time.`);
else if (d.kind === 'unchanged') console.log('sync: nothing new since the last import.');
else {
	// Signed in as the tablet is, from the token in .env. Neither is printed.
	const token = process.env.TSUNDOKU_TOKEN;
	if (!token) throw new Error('TSUNDOKU_TOKEN is not set in .env');
	const session = sessionValueFor(token);
	const port = Number(process.env.PORT ?? 42143);
	const res = await fetch(`http://127.0.0.1:${port}/api/scan`, {
		method: 'POST',
		headers: { cookie: `tsundoku_session=${session}` }
	});
	if (!res.ok) throw new Error(`the app answered ${res.status}; is it running (yarn run serve)?`);
	const body = (await res.json()) as { started: boolean; looked?: string };
	console.log(
		body.started
			? `sync: new files in ${folders.map((f) => f.label || f.id).join(', ')}; import started.`
			: `sync: nothing importable in ${body.looked}.`
	);
	// Only once the app took it: a refused or failed request tries again next time.
	mkdirSync(dirname(statePath), { recursive: true });
	writeFileSync(statePath, JSON.stringify(d.sequences));
}

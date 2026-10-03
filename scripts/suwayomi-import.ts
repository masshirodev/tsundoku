/**
 * The Suwayomi timer's step (doc/DOWNLOADING.md): once Suwayomi's download
 * queue is empty and something new is on disk, take a fresh backup from it
 * and ask the running app to import.
 *
 *   yarn run suwayomi-import            # what the timer runs
 *   yarn run suwayomi-import -- --force # import even if nothing moved
 *
 * The backup comes first because it is what keys a series as
 * `mihon:<source>:<url>`, the key it shares with the tablet's and the phone's
 * copies. Suwayomi's own backup is daily; a chapter imported before it would
 * be keyed by its folder and stay a series of its own.
 */
import { mkdirSync, readFileSync, readdirSync, statSync, unlinkSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
	SUWAYOMI_DEVICE,
	backupsToPrune,
	suwayomiDecision,
	type Fingerprint,
	type QueueItem
} from '../src/lib/import/suwayomi.ts';
import { requestScan } from './scan-request.ts';

try {
	process.loadEnvFile(fileURLToPath(new URL('../.env', import.meta.url)));
} catch {
	// No .env: the defaults.
}

const library = resolve(process.env.LIBRARY_ROOT ?? '/mnt/hdd2/tsundoku/library');
const device = join(library, 'devices', SUWAYOMI_DEVICE, 'Mihon');
const server = process.env.SUWAYOMI_URL ?? 'http://127.0.0.1:4567';
const statePath = join(
	process.env.XDG_STATE_HOME ?? join(homedir(), '.local', 'state'),
	'tsundoku',
	'suwayomi.json'
);

async function graphql<T>(query: string): Promise<T> {
	const res = await fetch(`${server}/api/graphql`, {
		method: 'POST',
		headers: { 'content-type': 'application/json' },
		body: JSON.stringify({ query })
	});
	const body = (await res.json()) as { data?: T; errors?: { message: string }[] };
	if (!res.ok || !body.data) throw new Error(body.errors?.[0]?.message ?? `HTTP ${res.status}`);
	return body.data;
}

async function queue(): Promise<QueueItem[] | null> {
	try {
		const d = await graphql<{ downloadStatus: { queue: QueueItem[] } }>(
			'{ downloadStatus { queue { state } } }'
		);
		return d.downloadStatus.queue;
	} catch {
		return null;
	}
}

/** Every chapter on disk: a CBZ, or a folder of images when CBZ is off. */
function fingerprint(downloads: string): Fingerprint {
	const fp: Fingerprint = { files: 0, bytes: 0, newest: 0 };
	let names: string[];
	try {
		names = readdirSync(downloads, { recursive: true, encoding: 'utf8' });
	} catch {
		return fp;
	}
	for (const n of names) {
		if (n.includes('_tmp')) continue;
		const s = statSync(join(downloads, n));
		if (!s.isFile()) continue;
		fp.files += 1;
		fp.bytes += s.size;
		fp.newest = Math.max(fp.newest, Math.floor(s.mtimeMs));
	}
	return fp;
}

function last(): Fingerprint | null {
	try {
		return JSON.parse(readFileSync(statePath, 'utf8')) as Fingerprint;
	} catch {
		return null;
	}
}

/** A backup now, into the folder the importer reads; its older ones pruned. */
async function backup(): Promise<string> {
	const d = await graphql<{ createBackup: { url: string } }>(
		'mutation { createBackup(input: {}) { url } }'
	);
	const res = await fetch(new URL(d.createBackup.url, server));
	if (!res.ok) throw new Error(`the backup download answered ${res.status}`);
	const folder = join(device, 'autobackup');
	mkdirSync(folder, { recursive: true });
	const path = join(folder, basename(new URL(d.createBackup.url, server).pathname));
	writeFileSync(path, Buffer.from(await res.arrayBuffer()));
	for (const old of backupsToPrune(readdirSync(folder))) unlinkSync(join(folder, old));
	return path;
}

const force = process.argv.includes('--force');
const now = fingerprint(join(device, 'downloads'));
const d = suwayomiDecision(await queue(), now, force ? null : last());
if (d.kind === 'none') console.log(`suwayomi: ${d.why}; nothing to do.`);
else if (d.kind === 'wait') console.log(`suwayomi: still downloading (${d.why}); next time.`);
else if (d.kind === 'unchanged') console.log('suwayomi: nothing new since the last import.');
else {
	const path = await backup();
	const body = await requestScan();
	console.log(
		body.started
			? `suwayomi: ${now.files} chapters on disk, backup ${basename(path)}; import started.`
			: `suwayomi: nothing importable in ${body.looked}.`
	);
	// Only once the app took it: a refused or failed request tries again next time.
	mkdirSync(dirname(statePath), { recursive: true });
	writeFileSync(statePath, JSON.stringify(d.fingerprint));
}

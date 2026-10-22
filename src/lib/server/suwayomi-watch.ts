import { mkdirSync, readdirSync, unlinkSync, writeFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { configured, forget, gql, queue, seriesForKey } from './suwayomi.ts';
import { suwayomiAuth } from './suwayomi-auth.ts';
import { libraryRoot, startScan } from './import/index.ts';
import { SUWAYOMI_DEVICE, backupsToPrune } from '../import/suwayomi.ts';
import { queueView, type QueueItem } from '../library/downloads.ts';

/**
 * Watching the queue (doc/DOWNLOADING.md, "Live, and importing at once"): one
 * poll of Suwayomi for the whole app, every three seconds while a screen is
 * listening, every thirty when none is. It does two things.
 *
 * - Tells listening screens what moved, over server-sent events: the
 *   chapter downloading and how far it is, and a version that changes when
 *   anything else does, so a screen reads its data again only then.
 * - Imports a chapter soon after Suwayomi finishes it: a backup (so a series
 *   added since is keyed by its URL), then a scan, as the timer does. The
 *   timer stays, every ten minutes, for when the app wasn't running.
 *
 * A poll, not Suwayomi's own subscription: one more request every three
 * seconds on localhost, against a websocket client and its reconnects. The
 * departure is written in DOWNLOADING.md.
 */

export type LiveMessage = {
	/** Changes whenever what the viewer can see of the queue does. */
	version: string;
	downloading: { chapterId: number; fraction: number; page: number; pages: number } | null;
};

type Listener = { reveal: boolean; send: (m: LiveMessage) => void; close: () => void };

const listeners = new Set<Listener>();
let timer: ReturnType<typeof setTimeout> | null = null;
let active = new Set<number>();
let lastSent = new Map<boolean, string>();
let ticking = false;

/** What one viewer can see of the queue, reduced to a version and the chapter downloading. */
function messageFor(items: QueueItem[], running: boolean, reveal: boolean): LiveMessage {
	const v = queueView(items, seriesForKey, reveal);
	const d = running ? v.downloading : null;
	return {
		version: [
			running ? 'run' : 'stop',
			v.queued,
			v.failures.map((f) => f.chapterId).join(','),
			v.groups.map((g) => `${g.mangaId}:${g.count}`).join(',')
		].join('|'),
		downloading: d && {
			chapterId: d.chapterId,
			fraction: d.progress,
			page: Math.round(d.progress * Math.max(0, d.pageCount)),
			pages: Math.max(0, d.pageCount)
		}
	};
}

async function tick() {
	timer = null;
	if (ticking) return schedule();
	ticking = true;
	try {
		forget();
		const q = await queue(2000);
		// Finished: under way last time, and gone from the queue or FINISHED now.
		const now = new Map(q.items.map((i) => [i.chapterId, i.state]));
		if ([...active].some((id) => !now.has(id) || now.get(id) === 'FINISHED')) importSoon();
		active = new Set(
			q.items
				.filter((i) => i.state === 'QUEUED' || i.state === 'DOWNLOADING')
				.map((i) => i.chapterId)
		);
		for (const reveal of [false, true]) {
			const mine = [...listeners].filter((l) => l.reveal === reveal);
			if (!mine.length) continue;
			const m = messageFor(q.items, q.running, reveal);
			for (const l of mine) l.send(m);
			lastSent.set(reveal, m.version);
		}
	} catch {
		// Not answering: the screens already say so on their next load.
	} finally {
		ticking = false;
	}
	schedule();
}

function schedule() {
	if (timer) return;
	timer = setTimeout(() => void tick(), listeners.size ? 3000 : 30_000);
	// Background work: it never keeps a stopping server alive (see below).
	timer.unref();
}

/** Started by the first page load that shows the queue; harmless to call again. */
export function ensureWatcher() {
	if (configured() && !timer) schedule();
}

/** A screen listening for the queue's changes. Returns the way to stop. */
export function listen(
	reveal: boolean,
	send: (m: LiveMessage) => void,
	close: () => void = () => {}
): () => void {
	const l = { reveal, send, close };
	listeners.add(l);
	// The first message at once, so the screen has its baseline.
	if (timer) clearTimeout(timer);
	timer = null;
	void tick();
	return () => {
		listeners.delete(l);
		if (!listeners.size) lastSent = new Map();
	};
}

// ---- importing at once ----------------------------------------------------------------

let importTimer: ReturnType<typeof setTimeout> | null = null;
let lastImport = 0;

/**
 * Twenty seconds after the last chapter finished, and never more than once a
 * minute: a series downloading chapter after chapter imports in batches,
 * not one scan per chapter.
 */
function importSoon() {
	if (importTimer) clearTimeout(importTimer);
	const wait = Math.max(20_000, lastImport + 60_000 - Date.now());
	importTimer = setTimeout(() => void importNow(), wait);
	// A stop drops a pending import; the ten-minute timer picks the chapter up.
	importTimer.unref();
}

/**
 * On SIGTERM adapter-node closes the server and waits for its connections,
 * but a live screen's stream never ends by itself, so `systemctl restart`
 * sat out the 90 s stop timeout and was killed (2026-10-15). Ending the
 * streams, with the timers above unref'd, lets the process exit at once.
 */
function stopAll() {
	if (timer) clearTimeout(timer);
	if (importTimer) clearTimeout(importTimer);
	timer = importTimer = null;
	for (const l of [...listeners]) l.close();
	listeners.clear();
}
process.once('SIGTERM', stopAll);
process.once('SIGINT', stopAll);

async function importNow() {
	importTimer = null;
	lastImport = Date.now();
	try {
		await backupNow();
		startScan();
	} catch (e) {
		console.warn(`tsundoku: importing Suwayomi's downloads: ${(e as Error).message}`);
	}
}

/**
 * A backup now, into the folder the importer reads, its older ones pruned:
 * the same step as the timer's (scripts/suwayomi-import.ts), which runs
 * outside the app and keeps its own copy.
 */
export async function backupNow(): Promise<string> {
	const d = await gql<{ createBackup: { url: string } }>(
		'mutation { createBackup(input: {}) { url } }',
		{},
		60_000
	);
	const url = new URL(d.createBackup.url, process.env.SUWAYOMI_URL);
	const res = await fetch(url, { headers: suwayomiAuth(url) });
	if (!res.ok) throw new Error(`the backup download answered ${res.status}`);
	const folder = join(libraryRoot(), 'devices', SUWAYOMI_DEVICE, 'Mihon', 'autobackup');
	mkdirSync(folder, { recursive: true });
	const path = join(folder, basename(url.pathname));
	writeFileSync(path, Buffer.from(await res.arrayBuffer()));
	for (const old of backupsToPrune(readdirSync(folder))) unlinkSync(join(folder, old));
	return path;
}

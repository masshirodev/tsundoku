import { configured, queue } from './downloads.ts';
import { seriesForKey } from './library-sources.ts';
import { queueView, type QueueItem } from '../library/downloads.ts';

/**
 * Watching the queue (doc/DOWNLOADS.md, "Live"): one look at the engine's
 * queue (in the database) for the whole app, every three seconds while a
 * screen is listening, every thirty when none is, telling listening screens
 * what moved over server-sent events: the chapter downloading and how far it
 * is, and a version that changes when anything else does, so a screen reads
 * its data again only then. Importing what arrives is the worker's
 * (engine/run.ts). Until c129 this was suwayomi-watch.ts, which also took
 * Suwayomi's backup and asked for the import.
 */

export type LiveMessage = {
	/** Changes whenever what the viewer can see of the queue does. */
	version: string;
	downloading: { chapterId: number; fraction: number; page: number; pages: number } | null;
};

type Listener = { reveal: boolean; send: (m: LiveMessage) => void; close: () => void };

const listeners = new Set<Listener>();
let timer: ReturnType<typeof setTimeout> | null = null;
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
		const q = await queue();
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

/**
 * On SIGTERM adapter-node closes the server and waits for its connections,
 * but a live screen's stream never ends by itself, so `systemctl restart`
 * sat out the 90 s stop timeout and was killed (2026-10-15). Ending the
 * streams, with the timer above unref'd, lets the process exit at once.
 */
function stopAll() {
	if (timer) clearTimeout(timer);
	timer = null;
	for (const l of [...listeners]) l.close();
	listeners.clear();
}
process.once('SIGTERM', stopAll);
process.once('SIGINT', stopAll);

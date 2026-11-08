import { fillRelations, releaseAnilistWaits, type FillResult } from './catalogue.ts';

/**
 * The relation cache's own timer (card c839; doc/LINKS.md, "How the cache
 * fills"), started from `init` in hooks.server.ts, so a friend's install fills
 * too: `ops/systemd/` exists only on the workstation.
 *
 * Imports are relative and extension-ful, as catalogue.ts' are.
 *
 * **Why ten minutes.** AniList's limit is 30 requests a minute (the live
 * answer's `x-ratelimit-limit: 30`, 2026-11-08), and the queue spaces them
 * 2.1 s apart, so a pass can't pass 28.6 a minute however long it runs. What
 * the interval decides is how much of that a pass may take:
 *
 *   an anime's walk      at most HOPS + 2 = 14 rounds, a request each
 *   plus, once           one request per linked season if the first round voids
 *   10 anime             10 x (14 + S), for S linked seasons a show
 *   10 comics            1 request of ten, then 10 singly if it comes back void
 *   worst, S = 5         10 x 19 + 11 = 201 requests = 422 s at 2.1 s
 *
 * So 600 s is the shortest round figure the worst case at S = 5 fits inside (201
 * requests in ten minutes is 20 a minute, two thirds of the limit, leaving the
 * rest of the queue to whatever else asks), and the usual pass is far under it:
 * ten comics are one request. A library of 474 takes about 48 passes, so about
 * eight hours, once. A shorter interval would only push that case against the
 * limit. 201 is the figure at S = 5 (`worstPassRequests`): shows with more linked
 * seasons can take longer than the interval (351 requests, 737 s, at S = 20).
 * That only skips ticks, since a tick that lands on a pass still running is
 * never queued, and never passes the limit, since the queue's spacing holds
 * whatever a pass takes.
 */
export const FILL_EVERY_MS = 10 * 60 * 1000;
/** After startup settles: migrations are done by now, and nothing here races them. */
export const FIRST_FILL_MS = 60 * 1000;

export type Cadence = { first: number; every: number };

/**
 * When the timer runs, or null for not at all. `TSUNDOKU_ANILIST=off` is how
 * every e2e server runs: no timer, no request, no line. A server pointed at a
 * stand-in (`TSUNDOKU_ANILIST_URL`) runs its own passes on purpose, so the
 * timer starts there only when `TSUNDOKU_RELATIONS_FILL_MS` asks; the interval
 * is honoured nowhere else, and an installer drops the stand-in's address.
 */
export function fillCadence(env: NodeJS.ProcessEnv = process.env): Cadence | null {
	if (env.TSUNDOKU_ANILIST === 'off') return null;
	if (env.TSUNDOKU_ANILIST_URL) {
		const ms = Number(env.TSUNDOKU_RELATIONS_FILL_MS);
		return ms > 0 ? { first: ms, every: ms } : null;
	}
	return { first: FIRST_FILL_MS, every: FILL_EVERY_MS };
}

type Fill = (opts: { log: (line: string) => void; stop: () => boolean }) => Promise<FillResult>;

/**
 * The ticks. A tick that finds a pass running does nothing, so a slow pass
 * (a 429's wait included) is never joined and never queued behind. A pass that
 * can't reach AniList, or a database another process has locked for longer than
 * `busy_timeout`, says so once and is quiet until it next gets through.
 */
export function fillLoop(cadence: Cadence, fill: Fill = fillRelations) {
	let busy = false;
	let stopped = false;
	let said: string | null = null;
	const note = (why: string) => {
		if (said !== why) console.log(`[relations] ${why}: the next pass carries on`);
		said = why;
	};
	const tick = async () => {
		if (busy || stopped) return;
		busy = true;
		try {
			const r = await fill({
				log: (line) => console.log(`[relations] ${line}`),
				stop: () => stopped
			});
			if (r.unreachable) note('AniList is unreachable');
			else if (!r.skipped) said = null;
		} catch (e) {
			if ((e as { code?: string }).code === 'SQLITE_BUSY') note('the database is busy');
			else console.error('tsundoku: the relations pass failed:', e);
		} finally {
			busy = false;
		}
	};
	let every: ReturnType<typeof setInterval> | null = null;
	const first = setTimeout(() => {
		void tick();
		every = setInterval(() => void tick(), cadence.every);
		every.unref();
	}, cadence.first);
	first.unref();
	const stop = () => {
		stopped = true;
		clearTimeout(first);
		if (every) clearInterval(every);
	};
	return { tick, stop };
}

const SIGNALS = ['SIGTERM', 'SIGINT', 'sveltekit:shutdown'] as const;
/** Across a dev server's reload of this module, so a second timer never joins the first. */
const running = globalThis as { __tsundokuRelationsFill?: () => void };

/**
 * Start the timer, once a process. A pass stopped by a shutdown ends at the
 * next series, and every write it made is whole: each is one statement.
 */
export function startRelationsFill(env: NodeJS.ProcessEnv = process.env): (() => void) | null {
	running.__tsundokuRelationsFill?.();
	const cadence = fillCadence(env);
	if (!cadence) return null;
	const loop = fillLoop(cadence);
	const stop = () => {
		loop.stop();
		for (const s of SIGNALS) process.off(s as NodeJS.Signals, stopping);
		if (running.__tsundokuRelationsFill === stop) delete running.__tsundokuRelationsFill;
	};
	const stopping = () => {
		stop();
		releaseAnilistWaits();
	};
	for (const s of SIGNALS) process.once(s as NodeJS.Signals, stopping);
	running.__tsundokuRelationsFill = stop;
	return stop;
}

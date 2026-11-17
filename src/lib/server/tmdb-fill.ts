import { tmdbPass, type TmdbPassResult } from './tmdb-links.ts';
import { refreshSurroundings } from './tmdb-surround.ts';

/**
 * TMDB's own timer (doc/LINKS.md, "TMDB links"), started from
 * `init` in hooks.server.ts beside the relation cache's. **This is what makes
 * "a key added later backfills" true**: the link pass otherwise runs only after
 * an import and from `yarn run links`, and a film comes from BROWSE's ADD, so a
 * friend who never imports would wait for a pass that never comes.
 *
 * **No key, no request.** `tmdbPass` returns at once without one, so the timer
 * ticks on every install and costs nothing until a key is set; the first tick
 * after one is the backfill, `PER_PASS` at a time, and a key added in SETTINGS
 * counts without a restart since the key is read at call time.
 *
 * **Why these numbers.** TMDB allows about fifty requests a second; a pass
 * spends at most three a film (the search, the same search without a year
 * should the year find nothing, and the sure match's details), so twenty films
 * is sixty requests, a second or two of TMDB's time, once every ten minutes. A
 * library of three hundred films backfills in under three hours and never
 * comes near the limit. The first tick waits a minute, as the relations' does,
 * so it never races startup's migrations.
 */
export const TMDB_FILL_EVERY_MS = 10 * 60 * 1000;
export const TMDB_FIRST_FILL_MS = 60 * 1000;
export const PER_PASS = 20;

export type Cadence = { first: number; every: number };

/**
 * When the timer runs, or null for not at all. A server pointed at a stand-in
 * TMDB (`TMDB_API_URL`, the e2e flows') runs passes only when
 * `TSUNDOKU_TMDB_FILL_MS` asks, so a flow's own seeded state is never searched
 * under it by surprise.
 */
export function tmdbCadence(env: NodeJS.ProcessEnv = process.env): Cadence | null {
	if (env.TMDB_API_URL) {
		const ms = Number(env.TSUNDOKU_TMDB_FILL_MS);
		return ms > 0 ? { first: ms, every: ms } : null;
	}
	return { first: TMDB_FIRST_FILL_MS, every: TMDB_FILL_EVERY_MS };
}

type Pass = (opts: { limit: number; log: (line: string) => void }) => Promise<TmdbPassResult>;

/**
 * The ticks. A tick that finds a pass running does nothing, so a slow one is
 * never joined. A failure (TMDB down, a refused key, a locked database) is said
 * once and is quiet until a pass gets through again.
 */
/**
 * A tick's work: the link pass, then what surrounds the entries the library
 * links, stale ones only, by id. One tick, so the two never run beside
 * each other and the request budget above holds for both: twenty refreshes is
 * twenty requests more.
 */
const tick: Pass = async (o) => {
	const r = await tmdbPass(o);
	await refreshSurroundings({ limit: o.limit, log: o.log });
	return r;
};

export function tmdbFillLoop(cadence: Cadence, pass: Pass = tick) {
	let busy = false;
	let stopped = false;
	let said: string | null = null;
	const tick = async () => {
		if (busy || stopped) return;
		busy = true;
		try {
			await pass({ limit: PER_PASS, log: (line) => console.log(`[tmdb] ${line}`) });
			said = null;
		} catch (e) {
			const why =
				(e as { code?: string }).code === 'SQLITE_BUSY' ? 'the database is busy' : String(e);
			if (said !== why) console.log(`[tmdb] ${why}: the next pass carries on`);
			said = why;
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
const running = globalThis as { __tsundokuTmdbFill?: () => void };

/** Start the timer, once a process. */
export function startTmdbFill(env: NodeJS.ProcessEnv = process.env): (() => void) | null {
	running.__tsundokuTmdbFill?.();
	const cadence = tmdbCadence(env);
	if (!cadence) return null;
	const loop = tmdbFillLoop(cadence);
	const stop = () => {
		loop.stop();
		for (const s of SIGNALS) process.off(s as NodeJS.Signals, stop);
		if (running.__tsundokuTmdbFill === stop) delete running.__tsundokuTmdbFill;
	};
	for (const s of SIGNALS) process.once(s as NodeJS.Signals, stop);
	running.__tsundokuTmdbFill = stop;
	return stop;
}

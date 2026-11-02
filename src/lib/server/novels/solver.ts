import { getDb } from '../db.ts';
import { checkPublic } from '../net-guard.ts';

/**
 * A site's browser check, solved for an LNReader plugin (doc/NOVELS.md, "Past
 * a site's bot check"; card c152).
 *
 * The plugin host refuses local addresses on purpose, and a solver is one, so
 * a host can't reach one. It asks the app over IPC, naming only the URL; this
 * is the app's half: the address is checked to be on the internet, FlareSolverr
 * is asked for it, and what goes back is that host's clearance cookies and its
 * user agent, never the solver's address and never a cookie for another host.
 *
 * The engine's own solver address is not this one: `ENGINE_SOLVER_URL` is what
 * the app hands the engine as `cf-proxy-url`, and in development it names the
 * engine's compose network. In a release the launcher puts the solver on
 * 127.0.0.1, which is the one case where a single value serves both; a
 * development checkout publishes its own solver on 8193 instead
 * (ops/engine/compose.yml, doc/EXTENSION-ENGINE.md).
 */

export type Clearance = { cookies: string; userAgent: string };

/** A first solve takes 20-45 s (doc/EXTENSION-ENGINE.md). */
const SOLVE_MS = 60_000;
const MAX_TIMEOUT_MS = 50_000;

const LOOPBACK = /^https?:\/\/(?:127\.0\.0\.1|localhost|\[::1\])(?::\d+)?\//;

/**
 * Where the app reaches the solver. Its own value comes first; the engine's
 * only when it is a loopback address the app can actually reach (a release),
 * since the engine's default is a name only its own network resolves.
 */
export function novelSolverUrl(): string {
	const own = process.env.NOVEL_SOLVER_URL;
	if (own) return own;
	const engine = process.env.ENGINE_SOLVER_URL;
	if (engine && LOOPBACK.test(engine)) return engine;
	return 'http://127.0.0.1:8193/v1';
}

type Solution = {
	status?: string;
	message?: string;
	solution?: {
		url?: string;
		status?: number;
		userAgent?: string;
		cookies?: { name: string; value: string; domain?: string }[];
	};
};

/** The same rule as `sameSite` in engine/browse.ts: one host is the other or under it. */
const sameSite = (host: string, site: string) =>
	!!site && (host === site || host.endsWith(`.${site}`) || site.endsWith(`.${host}`));

/** Hosts the app is passing a check for now, since when: BROWSE's live line. */
const solving = new Map<string, number>();

/** Whether the app is passing [site]'s check right now, and since when; null while it isn't. */
export function solvingSince(site: string): number | null {
	let since: number | null = null;
	for (const [host, at] of solving)
		if (sameSite(host, site)) since = since === null ? at : Math.min(since, at);
	return since;
}

/** Solves already underway, one per host: a plugin asking in a loop waits on one, not a queue. */
const underway = new Map<string, Promise<Clearance | null>>();

/**
 * Asks FlareSolverr for [url]'s clearance, or null: a private or loopback
 * address is refused here, before the solver ever hears of it, and a solver
 * that says nothing useful is a check that wasn't passed.
 */
export function solveChallenge(url: string): Promise<Clearance | null> {
	let host: string;
	try {
		host = new URL(url).hostname.toLowerCase();
	} catch {
		return Promise.resolve(null);
	}
	const started = underway.get(host);
	if (started) return started;
	const one = solveOne(url, host).finally(() => {
		if (underway.get(host) === one) underway.delete(host);
	});
	underway.set(host, one);
	return one;
}

async function solveOne(url: string, host: string): Promise<Clearance | null> {
	try {
		await checkPublic(url);
	} catch {
		return null;
	}
	const since = Date.now();
	solving.set(host, since);
	try {
		const clearance = await ask(url, host);
		// BROWSE's past-tense line (engine/browse.ts reads site_checks).
		if (clearance) noteChecked(host, Date.now());
		return clearance;
	} catch {
		return null;
	} finally {
		if (solving.get(host) === since) solving.delete(host);
	}
}

async function ask(url: string, host: string): Promise<Clearance | null> {
	const res = await fetch(novelSolverUrl(), {
		method: 'POST',
		headers: { 'content-type': 'application/json' },
		body: JSON.stringify({ cmd: 'request.get', url, maxTimeout: MAX_TIMEOUT_MS }),
		signal: AbortSignal.timeout(SOLVE_MS)
	});
	const body = (await res.json().catch(() => null)) as Solution | null;
	if (!res.ok || body?.status !== 'ok' || !body.solution) return null;
	// Only this host's cookies. A solve may cross a redirect, and the cookies
	// it picked up there are the host it crossed to, not the one asked about.
	const cookies = (body.solution.cookies ?? [])
		.filter((c) => applies(c.domain ?? '', host))
		.map((c) => `${c.name}=${c.value}`);
	const userAgent = body.solution.userAgent ?? '';
	if (!cookies.length && !userAgent) return null;
	return { cookies: cookies.join('; '), userAgent };
}

/** Whether a cookie's domain applies to [host]: the cookie's own host or one above it. */
function applies(domain: string, host: string): boolean {
	const d = domain.replace(/^\./, '').toLowerCase();
	return !!d && (host === d || host.endsWith(`.${d}`));
}

function noteChecked(host: string, at: number): void {
	getDb()
		.prepare(
			`INSERT INTO site_checks (host, seen_at) VALUES (?, ?)
			ON CONFLICT (host) DO UPDATE SET seen_at = MAX(seen_at, excluded.seen_at)`
		)
		.run(host, at);
}

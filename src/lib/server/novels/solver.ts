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

export type Clearance = { cookies: string; userAgent: string; httpsOnly: boolean };

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
		cookies?: { name: string; value: string; domain?: string; secure?: boolean }[];
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
 * Hosts a solve answered for without a usable clearance, and when: the page its
 * browser fetched was refused (a `solution.status` of 400 or more) or carried
 * no cookie and no user agent. A plugin asking again in the same browsing or
 * download session must not pay another 20-45 s solve. Short on purpose: a
 * site's check can change in an afternoon.
 *
 * A solve that failed is not remembered here. FlareSolverr 3.4.6 reports its
 * own `status: 'error'` as an HTTP 500 (measured 2026-11-02), which `ask`
 * throws on, as it does on a 200 that is not a solver's `ok` answer at all (a
 * `status: 'error'`, HTML from a proxy), and this app's 60 s budget can abort
 * before that answer arrives at all: either way the next call asks again, since
 * a solver's trouble says nothing about the host. A clearance the site then refused is a third failure,
 * remembered by the host (plugin-host.cjs), so this memo must not be read as
 * covering NovelFull or Scribble Hub.
 */
const FAILED_MS = 10 * 60_000;
const failed = new Map<string, number>();

/** Forgets the negative memo; a spec needs a clean one, as it needs `browse.forgetAll()`. */
export function forgetFailedSolves(): void {
	failed.clear();
}

/**
 * Forgets the memo for [site]'s hosts only: TRY AGAIN on a check that could
 * not be passed (c294), where the solver may just have been fixed or the
 * site's check changed. The host's own refused memo is forgotten beside it.
 */
export function forgetFailedSolve(site: string): void {
	for (const host of [...failed.keys()]) if (sameSite(host, site)) failed.delete(host);
}

const recentlyFailed = (host: string): boolean => {
	const at = failed.get(host);
	return at !== undefined && Date.now() - at < FAILED_MS;
};

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
	// A check this host just failed is not asked again straight away.
	if (recentlyFailed(host)) return Promise.resolve(null);
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
		// A solve that answered but left nothing usable (the site refused the
		// page, or there was no cookie and no user agent) is a check this host
		// won't pass soon. A solver that failed or was out of reach says nothing
		// about the host, and must not be remembered against it.
		if (!clearance) failed.set(host, Date.now());
		else failed.delete(host);
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
	// Not `null`: an answer of the solver's own that failed is the solver's
	// trouble, not this host's, and must not be remembered against it.
	if (!res.ok) throw new Error(`the solver answered ${res.status}`);
	// Nor is a 200 that isn't a solver's `ok` answer (c334): Byparr speaks the
	// same protocol and may send its error as a 200, and a proxy or a mistyped
	// NOVEL_SOLVER_URL answers with a page of HTML. Neither says anything about
	// the host, so it throws and is not remembered.
	if (body?.status !== 'ok' || !body.solution) throw new Error('not a solver answer');
	// A solution is the page its browser fetched. One the site refused (a WAF,
	// a regional block, a challenge FlareSolverr didn't classify as one) is not
	// a clearance, though it may still carry cookies and a user agent: the host
	// would retry with them, fail again, and BROWSE would claim a check the app
	// never passed.
	if ((body.solution.status ?? 200) >= 400) return null;
	// Only this host's cookies. A solve may cross a redirect, and the cookies
	// it picked up there are the host it crossed to, not the one asked about.
	const own = (body.solution.cookies ?? []).filter((c) => applies(c.domain ?? '', host));
	const cookies = own.map((c) => `${c.name}=${c.value}`);
	const userAgent = body.solution.userAgent ?? '';
	if (!cookies.length && !userAgent) return null;
	// A Cookie header can't keep one cookie off http, so a jar with any secure
	// cookie in it is https-only: the host's `withJar` sends nothing over http.
	return { cookies: cookies.join('; '), userAgent, httpsOnly: own.some((c) => c.secure) };
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

// ---- a page through the solver's browser (doc/NOVELS.md, "A check bound to the browser"; c335) ----
//
// NovelFull and Scribble Hub hand a solve a clearance and then refuse it to
// any client but the browser that solved it (measured 2026-11-02, twice). For
// such a host the plugin host asks for the page itself, and this fetches it
// through FlareSolverr's browser. What comes back is that browser's DOM after
// its scripts ran, its status the browser's, after any redirects it followed.

/** What the plugin host asks for: GET, or POST with a url-encoded form, the only body the solver sends. */
export type PageRequest = { url: string; method?: string; postData?: string };

/** A page as the solver's browser ended on it: [url] after redirects, the base its links resolve against. */
export type Page = { url: string; status: number; contentType: string; body: string };

/** A page, or a sentence saying why there is none: the host notes it as the call's trouble. */
export type PageAnswer = { page: Page } | { error: string };

/** The solve budget again: the browser's first visit to a host still passes its check. */
const PAGE_MS = 60_000;

/**
 * Chromium dying under FlareSolverr (c492, filed 2026-11-04): about every 25 s
 * under load a request answers "invalid session id … browser has closed the
 * connection". That is the solver's browser, not the site, so it is asked once
 * more; any other failure is not.
 */
const BROWSER_DIED = /invalid session id|browser has closed the connection|session deleted/i;

/** One page per host at a time: a plugin firing ten requests must not start ten browsers. */
const pageTurn = new Map<string, Promise<PageAnswer>>();
/** The same request already underway: answered once, for both askers. */
const pageAsked = new Map<string, Promise<PageAnswer>>();

/**
 * [req]'s page through the solver's browser, or why not. The address is
 * checked to be on the internet first, every time, before the solver hears of
 * it, and so is the address the browser ended on: a redirect to a local
 * address is not read back. No solver exception for a local address exists,
 * so the host's test ports never reach here.
 */
export function fetchPage(
	req: PageRequest,
	opts: { timeoutMs?: number } = {}
): Promise<PageAnswer> {
	let host: string;
	try {
		host = new URL(req.url).hostname.toLowerCase();
	} catch {
		return Promise.resolve({ error: 'not an address' });
	}
	const method = (req.method ?? 'GET').toUpperCase();
	if (method !== 'GET' && method !== 'POST')
		return Promise.resolve({
			error: `the solver's browser sends GET and POST only, not ${method}`
		});
	const key = `${method} ${req.url}\n${req.postData ?? ''}`;
	const same = pageAsked.get(key);
	if (same) return same;
	const before = pageTurn.get(host) ?? Promise.resolve();
	// Forgotten before anyone awaiting it resumes: a request made the moment an
	// answer lands is a new request, not the old answer again.
	const one: Promise<PageAnswer> = before
		.then(() => pageOne({ ...req, method }, host, opts.timeoutMs ?? PAGE_MS))
		.catch((e: unknown) => ({ error: String((e as Error)?.message ?? e) }))
		.finally(() => {
			if (pageTurn.get(host) === one) pageTurn.delete(host);
			if (pageAsked.get(key) === one) pageAsked.delete(key);
		});
	pageTurn.set(host, one);
	pageAsked.set(key, one);
	return one;
}

async function pageOne(req: PageRequest, host: string, budget: number): Promise<PageAnswer> {
	try {
		await checkPublic(req.url);
	} catch (e) {
		return { error: `refused: ${(e as Error).message || `${host} is not on the internet`}` };
	}
	const deadline = AbortSignal.timeout(budget);
	let answer = await askPage(req, deadline, budget);
	if ('died' in answer) answer = await askPage(req, deadline, budget);
	if ('died' in answer) return { error: `the solver's browser closed twice (${answer.died})` };
	if ('error' in answer) return answer;
	try {
		await checkPublic(answer.page.url);
	} catch {
		return {
			error: `the solver's browser ended at ${hostLabel(answer.page.url)}, which is not on the internet`
		};
	}
	if (answer.page.status < 400) noteChecked(host, Date.now());
	return answer;
}

const hostLabel = (url: string) => {
	try {
		return new URL(url).hostname;
	} catch {
		return 'an address it could not name';
	}
};

type PageSolution = {
	status?: string;
	message?: string;
	solution?: {
		url?: string;
		status?: number;
		response?: unknown;
		headers?: Record<string, string>;
	};
};

async function askPage(
	req: PageRequest,
	deadline: AbortSignal,
	budget: number
): Promise<PageAnswer | { died: string }> {
	const post = req.method === 'POST';
	let res: Response;
	try {
		res = await fetch(novelSolverUrl(), {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({
				cmd: post ? 'request.post' : 'request.get',
				url: req.url,
				maxTimeout: Math.min(MAX_TIMEOUT_MS, budget),
				...(post ? { postData: req.postData ?? '' } : {})
			}),
			signal: deadline
		});
	} catch (e) {
		if (deadline.aborted) return { error: `the solver did not answer in ${budget / 1000} s` };
		return { error: `the solver could not be reached (${(e as Error).message})` };
	}
	let body: PageSolution | null;
	try {
		body = (await res.json()) as PageSolution;
	} catch {
		if (deadline.aborted) return { error: `the solver did not answer in ${budget / 1000} s` };
		body = null;
	}
	const message = String(body?.message ?? '');
	if (BROWSER_DIED.test(message)) return { died: message };
	if (!res.ok)
		return { error: `the solver answered ${res.status}${message ? ` (${message})` : ''}` };
	if (body?.status !== 'ok' || !body.solution) return { error: 'the solver gave no page' };
	const s = body.solution;
	if (typeof s.response !== 'string') return { error: 'the solver gave no page' };
	const status = s.status ?? 200;
	if (!Number.isInteger(status) || status < 200 || status > 599)
		return { error: `the solver's browser reported status ${status}` };
	const url = typeof s.url === 'string' && s.url ? s.url : req.url;
	if (isImageViewer(s.response))
		return {
			error: `${hostLabel(url)} sent a picture, not a page: the solver's browser hands back pages only`
		};
	const text = unwrapText(s.response);
	if (text !== null)
		return {
			page: {
				url,
				status,
				contentType: jsonish(text) ? 'application/json' : 'text/plain',
				body: text
			}
		};
	return { page: { url, status, contentType: 'text/html; charset=utf-8', body: s.response } };
}

/**
 * Chromium shows a document that isn't HTML (JSON, plain text) as a page
 * holding one `<pre>`, and FlareSolverr hands back that page: the text inside
 * it, unescaped, is what the site sent.
 */
const WRAPPED =
	/^\s*<html[^>]*>\s*<head>[\s\S]*?<\/head>\s*<body[^>]*>\s*<pre[^>]*>([\s\S]*?)<\/pre>\s*(?:<div class="json-formatter-container"><\/div>\s*)?<\/body>\s*<\/html>\s*$/i;

export function unwrapText(html: string): string | null {
	const m = WRAPPED.exec(html);
	if (!m) return null;
	return m[1].replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos|nbsp);/gi, (all, e: string) => {
		const k = e.toLowerCase();
		if (k === 'amp') return '&';
		if (k === 'lt') return '<';
		if (k === 'gt') return '>';
		if (k === 'quot') return '"';
		if (k === 'apos') return "'";
		if (k === 'nbsp') return ' ';
		const n = k.startsWith('#x') ? parseInt(k.slice(2), 16) : parseInt(k.slice(1), 10);
		return Number.isFinite(n) && n > 0 && n <= 0x10ffff ? String.fromCodePoint(n) : all;
	});
}

const jsonish = (text: string) => {
	try {
		JSON.parse(text);
		return true;
	} catch {
		return false;
	}
};

/** Chromium's page for a picture: a body holding one `<img>` and nothing else. */
const isImageViewer = (html: string) => /<body[^>]*>\s*<img\b[^>]*>\s*<\/body>/i.test(html);

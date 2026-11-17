import { fork, type ChildProcess } from 'node:child_process';
import { join, resolve } from '../fspath.ts';
import type { PageAnswer, PageRequest } from './solver.ts';

/**
 * The app's side of the LNReader plugin host (doc/NOVELS.md, "The plugin
 * host"). One child process, started on the first call and again
 * after it dies, running plugin-host.cjs under Node's permission model:
 *
 * - an empty environment, so no secret in .env is there to read;
 * - read access to the host file, the address guard, the project's
 *   node_modules and the plugin store only, and no writes, child processes,
 *   workers or addons;
 * - plugin code in a vm context whose require gives only LNReader's shims
 *   and the libraries plugins are written against, and whose fetch reaches
 *   only global addresses, every redirect included, checked again on the
 *   address each connection uses (net-guard.ts). The process's own fetch
 *   goes through the same check.
 *
 * The vm context is not a security boundary: plugin-host.cjs shuts the
 * well-known ways out of it and says what is left. Code that does get out
 * has the process, and Node 24 can't withhold the network, which the plugins
 * need: it could open a raw socket past the guard, to the workstation or the
 * tailnet. Most of what listens there asks for a token or a session, which
 * the host has neither of, but not all of it: FlareSolverr, when it runs,
 * answers anyone on loopback (doc/NOVELS.md, "What the plugin host can't
 * stop"). Closing that needs OS-level isolation of the network, which the
 * app does not have on every platform it runs on.
 *
 * A site's browser check is the one thing the host can't do
 * itself, since a solver is a local address it refuses. It asks the parent
 * over IPC, naming only the URL; the app checks the address and answers with
 * that host's clearance cookies and user agent, or nothing. The host keeps a
 * jar per host, sends a secure one over https only, retries once, and
 * remembers for ten minutes a host whose retry was still a check, unless
 * `forgetRefused` is asked to forget it sooner (TRY AGAIN).
 *
 * A host whose retry was still a check (NovelFull, Scribble Hub: their check
 * is bound to the browser that solved it) is in **page mode** for those ten
 * minutes: the host asks the parent for the page at a URL instead,
 * the parent checks the address and fetches it through the solver's browser
 * (`fetchPage`), and the plugin's parse gets that HTML with the URL the
 * browser ended on.
 */

export class NovelHostError extends Error {}

/** What the app hands back for a host's check: its clearance cookies and user agent, nothing else. */
export type Clearance = { cookies: string; userAgent: string; httpsOnly?: boolean };

export type HostOptions = {
	/** Where installed plugins are kept: the host may read here. */
	store: string;
	/** Loopback ports the host may fetch from, for tests; never set by the app. */
	allow?: string[];
	timeoutMs?: number;
	/** The app's solve for a site's check: the host's only way to one, and never set by tests that aren't testing it. */
	solve?: (url: string) => Promise<Clearance | null>;
	/** The app's page through the solver, for a host in page mode: never the host's own. */
	page?: (req: PageRequest) => Promise<PageAnswer>;
	/** How long a refused host stays in page mode, for tests; the host's own is ten minutes. */
	refusedMs?: number;
};

type Pending = {
	resolve: (v: unknown) => void;
	reject: (e: Error) => void;
	timer: ReturnType<typeof setTimeout>;
};

const root = () => process.env.TSUNDOKU_ROOT ?? process.cwd();
export const hostFile = () => join(root(), 'src/lib/server/novels/plugin-host.cjs');
/** The address guard the host requires: the server's own (net-guard.ts), one rule for both. */
export const guardFile = () => join(root(), 'src/lib/server/net-guard.ts');

/**
 * Node's flags for the host: the permission model, reading only the host, the
 * guard, node_modules and the plugin store. Exported so a spec can hold a
 * process with exactly these flags to what it promises.
 */
export function hostExecArgv(store: string): string[] {
	return [
		'--permission',
		`--allow-fs-read=${hostFile()}`,
		`--allow-fs-read=${guardFile()}`,
		`--allow-fs-read=${join(root(), 'node_modules')}`,
		`--allow-fs-read=${resolve(store)}`
	];
}

export class NovelHost {
	#child: ChildProcess | null = null;
	#pending = new Map<number, Pending>();
	#next = 1;
	readonly #opts: HostOptions;

	constructor(opts: HostOptions) {
		this.#opts = opts;
	}

	#start(): ChildProcess {
		if (this.#child) return this.#child;
		const child = fork(hostFile(), [], {
			execArgv: hostExecArgv(this.#opts.store),
			// Nothing of the app's environment, .env's secrets included.
			env: {},
			stdio: ['ignore', 'ignore', 'pipe', 'ipc'],
			serialization: 'json'
		});
		child.stderr?.on('data', () => {});
		child.on(
			'message',
			(m: {
				id: number;
				op?: string;
				url?: string;
				method?: string;
				postData?: string;
				ok?: boolean;
				value?: unknown;
				error?: string;
			}) => {
				if (m.op === 'challenge') {
					void this.#answerChallenge(child, m.id, String(m.url ?? ''));
					return;
				}
				if (m.op === 'page') {
					void this.#answerPage(child, m.id, {
						url: String(m.url ?? ''),
						method: typeof m.method === 'string' ? m.method : 'GET',
						...(typeof m.postData === 'string' ? { postData: m.postData } : {})
					});
					return;
				}
				const p = this.#pending.get(m.id);
				if (!p) return;
				this.#pending.delete(m.id);
				clearTimeout(p.timer);
				if (m.ok) p.resolve(m.value);
				else p.reject(new NovelHostError(m.error ?? 'failed'));
			}
		);
		child.on('exit', () => {
			// A host that was replaced while this one was dying has no calls of
			// its own left: a late exit must not fail its successor's.
			if (this.#child !== child) return;
			this.#child = null;
			for (const [id, p] of this.#pending) {
				clearTimeout(p.timer);
				p.reject(new NovelHostError('The plugin host stopped'));
				this.#pending.delete(id);
			}
		});
		this.#child = child;
		if (this.#opts.allow?.length || this.#opts.refusedMs !== undefined)
			child.send({
				id: 0,
				op: 'config',
				allow: this.#opts.allow ?? [],
				...(this.#opts.refusedMs !== undefined ? { refusedMs: this.#opts.refusedMs } : {})
			});
		return child;
	}

	#send<T>(msg: Record<string, unknown>, timeoutMs = this.#opts.timeoutMs ?? 60_000): Promise<T> {
		const child = this.#start();
		const id = this.#next++;
		return new Promise<T>((resolve, reject) => {
			const timer = setTimeout(() => {
				this.#pending.delete(id);
				reject(new NovelHostError('The plugin did not answer in time'));
				// A plugin stuck in a loop holds the whole host: start a fresh one.
				this.stop();
			}, timeoutMs);
			this.#pending.set(id, { resolve: resolve as (v: unknown) => void, reject, timer });
			child.send({ id, ...msg });
		});
	}

	/**
	 * A plugin met a site's check: the app solves it, since only the parent may
	 * reach a solver. A failure is answered as nothing, not as a crash; the
	 * host reports its own timeout, so this can't hold the plugin forever.
	 */
	async #answerChallenge(child: ChildProcess, id: number, url: string): Promise<void> {
		let clearance: Clearance | null = null;
		const asked = this.#opts.solve?.(url);
		if (asked) {
			// The guard is a minute long, and a solve that answers must not leave
			// it running: a timer per challenge would hold the app's event loop.
			let timer: ReturnType<typeof setTimeout> | undefined;
			try {
				clearance = await Promise.race([
					asked.catch(() => null),
					new Promise<null>((ok) => {
						timer = setTimeout(() => ok(null), 65_000);
					})
				]);
			} finally {
				clearTimeout(timer);
			}
		}
		// The host that asked may have been restarted while the solve ran: its
		// successor starts its own ids at 1, and a stale answer must not land.
		if (child !== this.#child || !child.connected) return;
		child.send({ op: 'challenge-result', id, ok: true, value: clearance });
	}

	/**
	 * A host in page mode asked for a URL's page: the app fetches it
	 * through the solver, which runs `checkPublic` first. Whatever goes wrong is
	 * a sentence back, never a crash and never a silence: the host notes it as
	 * the call's trouble. A refusal marked `fixed` is one a new solve cannot
	 * change (`PageAnswer`), and the host says so in its own words.
	 */
	async #answerPage(child: ChildProcess, id: number, req: PageRequest): Promise<void> {
		let answer: PageAnswer = { error: 'this app has no solver to fetch a page through' };
		const asked = this.#opts.page?.(req);
		if (asked) {
			let timer: ReturnType<typeof setTimeout> | undefined;
			try {
				answer = await Promise.race([
					asked.catch((e: unknown) => ({ error: String((e as Error)?.message ?? e) })),
					new Promise<PageAnswer>((ok) => {
						timer = setTimeout(() => ok({ error: 'the solver did not answer in time' }), 65_000);
					})
				]);
			} finally {
				clearTimeout(timer);
			}
		}
		// As for a challenge: a restarted host's ids start again at 1. A refusal
		// no new solve can change travels marked, so the host words it without
		// claiming a failed check; one made before the browser was asked
		// travels as unsent, and a page whose last address could not be looked up
		// as unchecked.
		if (child !== this.#child || !child.connected) return;
		if ('page' in answer) child.send({ op: 'page-result', id, ok: true, value: answer.page });
		else
			child.send({
				op: 'page-result',
				id,
				ok: false,
				error: answer.error,
				...(answer.fixed ? { fixed: true } : {}),
				...(answer.unsent ? { unsent: true } : {}),
				...(answer.unchecked ? { unchecked: true } : {})
			});
	}

	/** The plugin's own description: name, site, version, filters, whether it pages. */
	info(file: string) {
		return this.#send<{
			id: string;
			name: string;
			site: string;
			version: string;
			filters: Record<string, unknown> | null;
			paged: boolean;
		}>({ op: 'info', file });
	}

	call<T>(file: string, method: string, args: unknown[], timeoutMs?: number): Promise<T> {
		return this.#send<T>({ op: 'call', file, method, args }, timeoutMs);
	}

	/**
	 * A chapter's HTML (`parseChapter`) and the address its own request ended
	 * at: a Node fetch's last hop, or — in page mode — the page the solver's
	 * browser ended on. A chapter's relative pictures are that page's, which a
	 * redirect moves, not the plugin's site's. `url` is null when the plugin
	 * asked the site for something else, and the caller falls back as it did.
	 */
	chapter(
		file: string,
		path: string,
		timeoutMs?: number
	): Promise<{ html: unknown; url: string | null }> {
		return this.#send<{ html: unknown; url: string | null }>(
			{ op: 'chapter', file, path },
			timeoutMs
		);
	}

	/**
	 * Forgets the hosts of [site] whose clearance the site refused:
	 * TRY AGAIN on the source page, so the next call solves afresh instead of
	 * waiting out the ten minutes. A host that isn't running remembers nothing,
	 * and is not started for this. Answers how many it forgot.
	 */
	forgetRefused(site: string): Promise<number> {
		if (!this.#child) return Promise.resolve(0);
		return this.#send<number>({ op: 'forget', site });
	}

	/**
	 * The hosts in page mode now, and until when: what a spec reads to
	 * pin the ten minutes, and what a probe prints. A host not running has none.
	 */
	pageHosts(): Promise<Record<string, number>> {
		if (!this.#child) return Promise.resolve({});
		return this.#send<Record<string, number>>({ op: 'modes' });
	}

	stop(): void {
		const child = this.#child;
		this.#child = null;
		child?.kill();
		// What it was serving can't be answered now: say so rather than let a
		// call wait out its timeout.
		for (const [id, p] of this.#pending) {
			clearTimeout(p.timer);
			p.reject(new NovelHostError('The plugin host stopped'));
			this.#pending.delete(id);
		}
	}
}

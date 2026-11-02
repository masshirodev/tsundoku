import { fork, type ChildProcess } from 'node:child_process';
import { join, resolve } from '../fspath.ts';

/**
 * The app's side of the LNReader plugin host (doc/NOVELS.md, "The plugin
 * host"; card c147). One child process, started on the first call and again
 * after it dies, running plugin-host.cjs under Node's permission model:
 *
 * - an empty environment, so no secret in .env is there to read;
 * - read access to the host file, the project's node_modules and the plugin
 *   store only, and no writes, child processes, workers or addons;
 * - plugin code in a vm context whose require gives only LNReader's shims
 *   and the libraries plugins are written against, and whose fetch refuses
 *   loopback and private addresses, every redirect included.
 *
 * Node 24 can't withhold the network, which the plugins need: code that
 * escaped the vm context could still open a raw socket to the workstation.
 * Everything there that matters asks for a token or a session, and the host
 * has neither.
 *
 * A site's browser check (card c152) is the one thing the host can't do
 * itself, since a solver is a local address it refuses. It asks the parent
 * over IPC, naming only the URL; the app checks the address and answers with
 * that host's clearance cookies and user agent, or nothing. The host keeps a
 * jar per host, sends a secure one over https only, retries once, and
 * remembers for ten minutes a host whose retry was still a check.
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
};

type Pending = {
	resolve: (v: unknown) => void;
	reject: (e: Error) => void;
	timer: ReturnType<typeof setTimeout>;
};

const root = () => process.env.TSUNDOKU_ROOT ?? process.cwd();
export const hostFile = () => join(root(), 'src/lib/server/novels/plugin-host.cjs');

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
			execArgv: [
				'--permission',
				`--allow-fs-read=${hostFile()}`,
				`--allow-fs-read=${join(root(), 'node_modules')}`,
				`--allow-fs-read=${resolve(this.#opts.store)}`
			],
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
				ok?: boolean;
				value?: unknown;
				error?: string;
			}) => {
				if (m.op === 'challenge') {
					void this.#answerChallenge(child, m.id, String(m.url ?? ''));
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
		if (this.#opts.allow?.length) child.send({ id: 0, op: 'config', allow: this.#opts.allow });
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

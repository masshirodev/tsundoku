/**
 * What BROWSE's browser suite shares between its global setup
 * (browse-setup.ts) and its specs: the three ports, the sources the fake
 * engine serves, and the shape of a call to it.
 */

import { execFileSync } from 'node:child_process';

/**
 * A port nothing listens on now, from the OS (`listen(0)`). Asked of a child
 * process because this module is loaded synchronously, by the config.
 */
function freePort(): string {
	return execFileSync(
		process.execPath,
		[
			'-e',
			"const s = require('node:net').createServer().listen(0, '127.0.0.1', () => " +
				'{ process.stdout.write(String(s.address().port)); s.close(); })'
		],
		{ encoding: 'utf8' }
	).trim();
}

/**
 * The world's three servers' ports: BROWSE's preview, its fake engine, and the
 * fake repositories over https with a throwaway certificate.
 *
 * Each is picked **once**, by the OS, when nothing assigns it: a fixed default
 * had two runs in one worktree fight over the engine's 4195 (c625: the second
 * `playwright test` died at browse-setup.ts's `listen` with `EADDRINUSE`) and,
 * before that, over the repositories' 4196 (c340). The runner loads this module
 * first (playwright.config.ts imports it, for BROWSE_PORT's baseURL), pins the
 * ports into its environment, and the global setup that listens on them
 * (browse-setup.ts) shares that process while every worker inherits the
 * variables — `ENGINE_PORT` is imported by a spec of nobody's
 * (tests/browse-player-watching.e2e.ts), and a port chosen per process would
 * differ between the server and the specs that call it.
 *
 * A `PLAYWRIGHT_*_PORT` the gate or a slot assigns still wins, so a gate's
 * slot runs where it is given; two runs sharing one assigned value collide,
 * which is why one worktree runs one Playwright invocation at a time
 * (doc/TESTING.md, "Ports").
 */
export const BROWSE_PORT = Number((process.env.PLAYWRIGHT_BROWSE_PORT ||= freePort()));
export const ENGINE_PORT = Number((process.env.PLAYWRIGHT_ENGINE_PORT ||= freePort()));
export const REPO_PORT = Number((process.env.PLAYWRIGHT_REPO_PORT ||= freePort()));

/** The novel plugin the setup installs (tests/fixtures/lnreader/shelf.js): BROWSE knows it as `ln:shelf`. */
export const SHELF_PLUGIN = 'shelf';

/** An Aniyomi source (tests/browse-anime.e2e.ts; doc/ANIME.md), seeded installed. */
export const ANIME_SOURCE = { id: '400', pkg: 'e2e.anime', name: 'Moonlight Streams' };

export const SOURCES = {
	open: { id: '100', pkg: 'e2e.open', name: 'Open Source' } as {
		id: string;
		pkg: string;
		name: string;
		failed?: string;
	},
	hidden: { id: '200', pkg: 'e2e.hidden', name: 'Toonily' } as {
		id: string;
		pkg: string;
		name: string;
		failed?: string;
	},
	broken: { id: '300', pkg: 'e2e.broken', name: 'Broken Source', failed: 'protobuf' }
};

export type EngineCall = {
	method: string;
	sourceId: string;
	page?: number;
	search?: string;
	filterList?: { name: string; type: string; stateInt?: number; stateList?: unknown[] }[];
	preferences?: ({ key: string } & Record<string, Record<string, unknown>>)[];
};

const ENGINE = `http://127.0.0.1:${ENGINE_PORT}`;
export const resetEngine = () => fetch(`${ENGINE}/__reset`, { method: 'POST' });
export const engineDown = () => fetch(`${ENGINE}/__down`, { method: 'POST' });
/** The next search waits [ms] while the engine "passes" example.org's browser check. */
export const behindACheck = (ms = 3000) => fetch(`${ENGINE}/__check?ms=${ms}`, { method: 'POST' });
export const bumpWebtoons = () => fetch(`${ENGINE}/__bump`, { method: 'POST' });
export const REPO = (name: 'good' | 'bad' | 'notrepo') =>
	`https://127.0.0.1:${REPO_PORT}/${name}/index.min.json`;
export const NOVEL_REPO = `https://127.0.0.1:${REPO_PORT}/novels/plugins.min.json`;
export const engineCalls = async () =>
	(await (await fetch(`${ENGINE}/__calls`)).json()) as EngineCall[];

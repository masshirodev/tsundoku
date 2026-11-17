import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/**
 * A friend's install for the browser suite (doc/SIGN-IN.md): the
 * same build, served as a release's launcher serves it (TSUNDOKU_LOGIN=password,
 * local mode), on its own port, database and data folder. tests/friend-setup.ts
 * starts it; tests/friend-*.e2e.ts drive it.
 */

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
 * The friend world's own port, taken **once**, by the OS, when nothing assigns
 * it. A fixed 4197 had two runs in one checkout fight over it: a second
 * `playwright test` got through the browse world's setup and died here
 * (`port 4197 is taken, probably by an earlier run's friend server`).
 *
 * The runner loads this module first (`playwright.config.ts` imports
 * `FRIEND_PORT`, for the friend project's baseURL), pins the value into its
 * environment, and the global setup that listens on it (tests/friend-setup.ts)
 * shares that process while every worker inherits the variable. A
 * `PLAYWRIGHT_FRIEND_PORT` set in the environment still wins, so a run given
 * its port keeps it; two runs sharing one assigned value collide, which
 * is why one checkout runs one Playwright invocation at a time
 * (doc/TESTING.md, "Ports").
 */
export const FRIEND_PORT = Number((process.env.PLAYWRIGHT_FRIEND_PORT ||= freePort()));

/**
 * Its data folder, where login.json lives: the specs reset it as the launcher
 * would. Derived from the port, so it moves with it -- and every reader (the
 * setup, the specs, the teardown) reads this one pinned value.
 */
export const FRIEND_HOME = join(tmpdir(), `tsundoku-e2e-friend-home-${FRIEND_PORT}`);

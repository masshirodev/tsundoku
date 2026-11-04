import { mkdirSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/**
 * One temporary directory per e2e run (c439, c105), so a run cleans up after
 * itself and two runs never share a file.
 *
 * Imported first by playwright.config.ts, for its side effect: the runner
 * makes `<TMPDIR>/tsundoku-e2e-run-<its pid>` and points `TMPDIR` at it.
 * Node's `tmpdir()` reads `TMPDIR` on every call, so everything the suite
 * puts in "the system temp directory" lands there: the shared preview's
 * database and data folders, each own-server spec's database, the browse and
 * friend worlds, Chromium's profiles. Every worker and server inherits the
 * variable, and a worker that loads the config again finds it already set.
 *
 * Before, each run left `tsundoku-e2e-<pid>.sqlite` and its siblings behind
 * (about 3 MB each, and `/tmp` is RAM on the workstation), and the fixed
 * names (`tsundoku-e2e-home`, `-empty-library`, `-backups`) were one folder
 * for every run on the box at once.
 *
 * The directory goes when the run ends: the default export is a global setup
 * whose returned function, the teardown, removes it, and the runner removes
 * it again as it exits, after the web servers it stopped wrote their last.
 * A run that was killed leaves its directory, so the next run removes any
 * whose runner is no longer alive.
 */
const PREFIX = 'tsundoku-e2e-run-';

function alive(pid: number): boolean {
	try {
		process.kill(pid, 0);
		return true;
	} catch (e) {
		return (e as NodeJS.ErrnoException).code === 'EPERM';
	}
}

if (!process.env.PLAYWRIGHT_RUN_DIR) {
	const base = tmpdir();
	for (const name of readdirSync(base)) {
		const pid = Number(name.slice(PREFIX.length));
		if (name.startsWith(PREFIX) && Number.isInteger(pid) && pid > 0 && !alive(pid))
			// A run that was killed, or a `--list`, which has no teardown.
			rmSync(join(base, name), { recursive: true, force: true });
	}
	const dir = join(base, `${PREFIX}${process.pid}`);
	mkdirSync(dir, { recursive: true });
	process.env.PLAYWRIGHT_RUN_DIR = dir;
	process.env.TMPDIR = dir;
	// The runner stops the web servers after the global teardown, and they
	// write on their way out, so the directory goes once more as it exits.
	process.on('exit', () => rmSync(dir, { recursive: true, force: true }));
}

/** This run's directory, under the temp directory the run was started with. */
export const RUN_DIR = process.env.PLAYWRIGHT_RUN_DIR!;

/** A global setup that does nothing but remove the run's directory at the end. */
export default async function setup() {
	return async () => rmSync(RUN_DIR, { recursive: true, force: true });
}

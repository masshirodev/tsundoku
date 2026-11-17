/**
 * `yarn run test:e2e:dependants`: the two projects a whole run leaves out
 * behind any red, run on their own (doc/TESTING.md, "Load").
 *
 *   node --experimental-strip-types scripts/e2e-dependants.ts [playwright args…]
 *
 * `duplicates` and `gate` depend on every device project, so a red anywhere
 * leaves them "did not run". This runs `--project=duplicates --no-deps`, then
 * `--project=gate --no-deps`, as **two** runs: `--no-deps` also drops the
 * `duplicates` → `gate` order, and in one run the gate enrols its
 * authenticator while `duplicates-flow` is still typing `/reveal`.
 *
 * It is a script rather than a line in `package.json` because Yarn 1 appends
 * a script's arguments to the end of its command string. The line it replaced
 * ended `… && exit $s`, so `yarn run test:e2e:dependants --reporter=line`
 * became `exit $s --reporter=line`, which exits 1 with both projects green.
 * Here every argument reaches both runs, and the exit code is the
 * first red's: non-zero when either project is red, whichever it was.
 *
 * Except `--project`: the caller's would put a second project into each run,
 * the one-run race above, so the step refuses it (exit 2) before running
 * anything.
 */
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

/** The two runs, in order; each gets the caller's arguments after its own. */
export const RUNS = [
	['--project=duplicates', '--no-deps'],
	['--project=gate', '--no-deps']
] as const;

/**
 * One Playwright run with these arguments, answering its exit code. A run
 * that could not start, or was killed by a signal, answers 1: it has not
 * passed.
 */
export type Run = (args: string[]) => number;

/**
 * Why the step will not run these arguments, or null when it will: a caller's
 * `--project` (either spelling) joins each run's own.
 */
export function refused(extra: readonly string[]): string | null {
	const project = extra.find((a) => a === '--project' || a.startsWith('--project='));
	if (!project) return null;
	return `test:e2e:dependants chooses its own projects; drop ${project} (each run would take two projects, and they race in one run)`;
}

/**
 * Runs both projects, the second even when the first is red (each is worth
 * its own report), and answers the first non-zero code, or 0 when both are
 * green.
 */
export function dependants(run: Run, extra: readonly string[]): number {
	let code = 0;
	for (const own of RUNS) {
		const status = run([...own, ...extra]);
		if (code === 0 && status !== 0) code = status;
	}
	return code;
}

/** Playwright's own bin, beside this repository's other tools. */
const PLAYWRIGHT = fileURLToPath(new URL('../node_modules/.bin/playwright', import.meta.url));

const playwright: Run = (args) => {
	const result = spawnSync(PLAYWRIGHT, ['test', ...args], { stdio: 'inherit' });
	if (result.error) console.error(result.error.message);
	return typeof result.status === 'number' ? result.status : 1;
};

if (import.meta.main) {
	const extra = process.argv.slice(2);
	const why = refused(extra);
	if (why) console.error(why);
	process.exitCode = why ? 2 : dependants(playwright, extra);
}

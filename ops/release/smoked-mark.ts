/**
 * The shell's way into ops/release/smoked.ts, so smoke.sh and
 * install-release.sh share its rule instead of each holding a copy:
 *
 *   node smoked-mark.ts record <out> <version> <linux> <win>   # smoke.sh, at its end
 *   node smoked-mark.ts install <out> <version>                # install-release.sh
 *
 * `<linux>` and `<win>` are `passed`, `failed`, or `-` for a half the run left
 * out. `install` prints why the version may not be installed and exits 1, or
 * prints nothing and exits 0.
 */
import { installProblem, recordSmoke, type HalfResult } from './smoked.ts';

const [command, out, version, ...rest] = process.argv.slice(2);

function half(word: string | undefined): HalfResult {
	if (word === 'passed' || word === 'failed') return word;
	if (word === '-') return null;
	console.error(`smoked-mark: a half is passed, failed or -, not ${word ?? 'nothing'}`);
	process.exit(2);
}

if (!out || !version) {
	console.error(
		'usage: smoked-mark.ts record <out> <version> <linux> <win> | install <out> <version>'
	);
	process.exit(2);
}
if (command === 'record') {
	recordSmoke(out, version, { linux: half(rest[0]), win: half(rest[1]) });
} else if (command === 'install') {
	const problem = installProblem(out, version);
	if (problem) {
		console.error(problem);
		process.exit(1);
	}
} else {
	console.error(`smoked-mark: no command ${command}`);
	process.exit(2);
}

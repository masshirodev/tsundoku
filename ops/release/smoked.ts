/**
 * The mark that says a version's bundles passed ops/release/smoke.sh whole
 * (doc/RELEASE.md, "Smoke test"): `out/<version>/.smoked`, one line,
 * `<version> <when>`, which publishing and installing require.
 *
 * It speaks for the bundles as they were when the test ran, so a rebuild has to
 * end it. release.ts deletes it before building (forgetSmoked), and whoever
 * reads it also refuses a bundle newer than it (smokedProblem): the second
 * catches a bundle replaced by anything but that script. Only the bundles
 * count: the APKs are built beside them and no smoke test runs them.
 *
 * The line keeps its shape, without the bundles' checksums, because smoke.sh
 * runs the tag's own copy (a later commit's tests never judge an older release)
 * and the copies in the tags already made write exactly this.
 * ops/workstation/install-release.sh holds the same freshness rule in `find`.
 */
import { existsSync, readdirSync, readFileSync, rmSync, statSync } from 'node:fs';
import { join } from 'node:path';

/** A rebuild's first step: nothing built from here on has been tested. */
export function forgetSmoked(out: string): void {
	rmSync(join(out, '.smoked'), { force: true });
}

/** Why `version`'s bundles in `out` may not count as smoke-tested, or null if they may. */
export function smokedProblem(out: string, version: string): string | null {
	const mark = join(out, '.smoked');
	if (!existsSync(mark) || !readFileSync(mark, 'utf8').startsWith(`${version} `))
		return `${version} hasn't passed ops/release/smoke.sh on every platform: run it first.`;
	const tested = statSync(mark).mtimeMs;
	const rebuilt = readdirSync(out).filter(
		(n) => n.startsWith(`tsundoku-${version}-`) && statSync(join(out, n)).mtimeMs > tested
	);
	return rebuilt.length
		? `${rebuilt.join(', ')} changed after ${version}'s smoke test: run ops/release/smoke.sh again.`
		: null;
}

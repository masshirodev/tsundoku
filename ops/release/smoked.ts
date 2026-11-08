/**
 * The marks that say a version's bundles passed ops/release/smoke.sh
 * (doc/RELEASE.md, "Smoke test"). Each is one line, `<version> <when>`:
 *
 * - `out/<version>/.smoked`: a whole run passed, every platform. Publishing
 *   requires it (friends get Windows too), and installing takes it.
 * - `out/<version>/.smoked-linux-x64`: the Linux half passed, alone or as part
 *   of a whole run (c750). Installing on the workstation takes it, since the
 *   workstation runs only the Linux bundle; publishing never does.
 *
 * A mark speaks for the bundles as they were when the test ran, so a rebuild has
 * to end it. release.ts deletes both before building (forgetSmoked), and whoever
 * reads one also refuses a bundle newer than it (markProblem): the second
 * catches a bundle replaced by anything but that script. Only the bundles
 * count: the APKs are built beside them and no smoke test runs them. The rule
 * is the same for both marks, every bundle of the version, so a Windows bundle
 * replaced after a Linux run ends that run's mark too: nothing replaces one
 * bundle alone but a hand, and a hand is what the rule is for.
 *
 * What a run does to the marks is recordSmoke's, which smoke.sh calls through
 * smoked-mark.ts; install-release.sh asks installProblem the same way, so the
 * rule lives here once.
 *
 * The line keeps its shape, without the bundles' checksums, because smoke.sh
 * runs the tag's own copy (a later commit's tests never judge an older release)
 * and the copies in the tags already made write exactly this.
 */
import { existsSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

export const WHOLE_MARK = '.smoked';
export const LINUX_MARK = '.smoked-linux-x64';

/** How one platform's half of a run ended, or null when the run left it out. */
export type HalfResult = 'passed' | 'failed' | null;

/** A rebuild's first step: nothing built from here on has been tested. */
export function forgetSmoked(out: string): void {
	for (const name of [WHOLE_MARK, LINUX_MARK]) rmSync(join(out, name), { force: true });
}

/**
 * Why the mark `name` in `out` may not speak for `version`'s bundles, or null
 * if it may. `missing` when there's no such mark for this version, `rebuilt`
 * when a bundle is newer than it (with the bundles' names).
 */
export function markProblem(
	out: string,
	version: string,
	name: string
): { kind: 'missing' } | { kind: 'rebuilt'; bundles: string[] } | null {
	const mark = join(out, name);
	if (!existsSync(mark) || !readFileSync(mark, 'utf8').startsWith(`${version} `))
		return { kind: 'missing' };
	const tested = statSync(mark).mtimeMs;
	const rebuilt = readdirSync(out).filter(
		(n) => n.startsWith(`tsundoku-${version}-`) && statSync(join(out, n)).mtimeMs > tested
	);
	return rebuilt.length ? { kind: 'rebuilt', bundles: rebuilt } : null;
}

const rebuiltWords = (version: string, bundles: string[]) =>
	`${bundles.join(', ')} changed after ${version}'s smoke test: run ops/release/smoke.sh again.`;

/** Why `version` may not be published, or null if it may: a whole run must stand. */
export function smokedProblem(out: string, version: string): string | null {
	const whole = markProblem(out, version, WHOLE_MARK);
	if (!whole) return null;
	if (whole.kind === 'rebuilt') return rebuiltWords(version, whole.bundles);
	if (!markProblem(out, version, LINUX_MARK))
		return `${version} was smoke-tested on Linux only: run the whole smoke test before publishing (ops/release/smoke.sh ${version}).`;
	return `${version} hasn't passed ops/release/smoke.sh on every platform: run it first.`;
}

/**
 * Why `version` may not be installed on the workstation, or null if it may:
 * a whole run or a Linux one must stand.
 */
export function installProblem(out: string, version: string): string | null {
	const whole = markProblem(out, version, WHOLE_MARK);
	const linux = markProblem(out, version, LINUX_MARK);
	if (!whole || !linux) return null;
	const rebuilt = [whole, linux].find((p) => p.kind === 'rebuilt');
	if (rebuilt && rebuilt.kind === 'rebuilt') return rebuiltWords(version, rebuilt.bundles);
	return `${version} wasn't smoke-tested (no ${join(out, WHOLE_MARK)} or ${LINUX_MARK}): run ops/release/smoke.sh ${version} linux-x64 first, or the whole of it.`;
}

/**
 * What a smoke.sh run leaves, from how each half it ran ended:
 *
 * - The Linux half passed: `.smoked-linux-x64`, new. It failed: neither mark,
 *   since both speak for the Linux bundle and it just failed.
 * - The Windows half failed: no `.smoked`. The Linux mark stays: a Windows
 *   failure says nothing of the Linux bundle.
 * - Both halves, in one run, passed: `.smoked`, new.
 * - A half that passed alone takes nothing away: a Linux run after a whole one
 *   leaves `.smoked` standing, since it rebuilt nothing and found nothing wrong.
 *
 * A run that stops before it ends (smoke.sh is `set -e`, so a bundle tar can't
 * read stops it) never gets here, and leaves the marks as they were.
 */
export function recordSmoke(
	out: string,
	version: string,
	run: { linux: HalfResult; win: HalfResult },
	now: Date = new Date()
): void {
	const line = `${version} ${now.toISOString().replace(/\.\d{3}Z$/, 'Z')}\n`;
	const drop = (name: string) => rmSync(join(out, name), { force: true });
	if (run.linux === 'failed') {
		drop(LINUX_MARK);
		drop(WHOLE_MARK);
	}
	if (run.win === 'failed') drop(WHOLE_MARK);
	if (run.linux === 'passed') writeFileSync(join(out, LINUX_MARK), line);
	if (run.linux === 'passed' && run.win === 'passed') writeFileSync(join(out, WHOLE_MARK), line);
}

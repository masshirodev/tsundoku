import { spawnSync } from 'node:child_process';
import {
	chmodSync,
	copyFileSync,
	cpSync,
	existsSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	statSync,
	symlinkSync,
	utimesSync,
	writeFileSync
} from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import {
	LINUX_MARK,
	WHOLE_MARK,
	forgetSmoked,
	installProblem,
	recordSmoke,
	smokedProblem
} from '../ops/release/smoked.ts';

const root = fileURLToPath(new URL('../', import.meta.url));
// A version no notes file will ever name: a publish that gets past the mark
// stops at the notes, before the signing key or the host.
const VERSION = '9999.12.31';
// Under the worktree's temp/, not /tmp: /tmp is RAM on the workstation, and
// smoke.sh's run below writes a library and a bundle there.
mkdirSync(join(root, 'temp'), { recursive: true });
const world = mkdtempSync(join(root, 'temp', 'release-smoked-'));
const base = join(world, 'release');
const out = join(base, 'out', VERSION);
const bundle = join(out, `tsundoku-${VERSION}-linux-x64.tar.xz`);
const winZip = join(out, `tsundoku-${VERSION}-win-x64.zip`);
const mark = join(out, WHOLE_MARK);
const linuxMark = join(out, LINUX_MARK);
const T = 1_800_000_000;

const age = (file: string, seconds: number) => utimesSync(file, seconds, seconds);
const mtime = (file: string) => statSync(file).mtimeMs;
const LINUX_ONLY = 'smoke-tested on Linux only: run the whole smoke test before publishing';

beforeEach(() => {
	rmSync(out, { recursive: true, force: true });
	mkdirSync(out, { recursive: true });
	writeFileSync(bundle, 'bundle');
	age(bundle, T);
	writeFileSync(winZip, 'bundle');
	age(winZip, T);
	writeFileSync(mark, `${VERSION} 2027-01-15T08:00:00Z\n`);
	age(mark, T + 60);
});

afterAll(() => rmSync(world, { recursive: true, force: true }));

/** Only the Linux mark, after the bundles, as a Linux-only run leaves it. */
const linuxOnly = (at = T + 60) => {
	rmSync(mark, { force: true });
	writeFileSync(linuxMark, `${VERSION} 2027-01-15T08:00:00Z\n`);
	age(linuxMark, at);
};
// The bundles and the whole mark in the past, for a case whose marks are written
// now: T is in 2027, and a mark written today would be older than a bundle there.
const now = Math.floor(Date.now() / 1000);
const builtEarlier = () => {
	age(bundle, now - 3600);
	age(winZip, now - 3600);
	age(mark, now - 1800);
};

describe('the smoke test’s mark speaks for the bundles it tested (doc/RELEASE.md)', () => {
	it('stands for bundles the test ran after', () => {
		expect(smokedProblem(out, VERSION)).toBeNull();
	});

	it('is refused when missing, or another version’s', () => {
		rmSync(mark);
		expect(smokedProblem(out, VERSION)).toContain("hasn't passed");
		writeFileSync(mark, '2026.01.01 2026-01-01T00:00:00Z\n');
		expect(smokedProblem(out, VERSION)).toContain("hasn't passed");
	});

	it('is refused once a bundle is newer than it, and names the bundle', () => {
		age(bundle, T + 120);
		const problem = smokedProblem(out, VERSION);
		expect(problem).toContain(`tsundoku-${VERSION}-linux-x64.tar.xz`);
		expect(problem).toContain('smoke.sh again');
	});

	it('is untouched by an APK built after it: no smoke test runs those', () => {
		for (const n of [`tsundoku-app-${VERSION}.apk`, `tsundoku-tv-${VERSION}-debug.apk`]) {
			writeFileSync(join(out, n), 'apk');
			age(join(out, n), T + 120);
		}
		expect(smokedProblem(out, VERSION)).toBeNull();
		expect(installProblem(out, VERSION)).toBeNull();
	});

	it('is deleted by a rebuild’s first step, both marks, there or not', () => {
		writeFileSync(linuxMark, `${VERSION} 2027-01-15T08:00:00Z\n`);
		forgetSmoked(out);
		expect(existsSync(mark)).toBe(false);
		expect(existsSync(linuxMark)).toBe(false);
		forgetSmoked(out);
		expect(existsSync(bundle)).toBe(true);
	});

	it('is deleted by release.ts before the checkout and the build', () => {
		const source = readFileSync(join(root, 'ops/release/release.ts'), 'utf8');
		const forgets = source.indexOf('forgetSmoked(out)');
		expect(forgets).toBeGreaterThan(-1);
		expect(forgets).toBeLessThan(source.indexOf("'worktree', 'add'"));
	});
});

describe('a Linux-only run is enough to install, never to publish (c750)', () => {
	it('a Linux mark lets the install pass and the publish refuse, naming the gap', () => {
		linuxOnly();
		expect(installProblem(out, VERSION)).toBeNull();
		expect(smokedProblem(out, VERSION)).toContain(LINUX_ONLY);
	});

	it('a whole mark passes both, with or without a Linux mark beside it', () => {
		expect(installProblem(out, VERSION)).toBeNull();
		expect(smokedProblem(out, VERSION)).toBeNull();
		writeFileSync(linuxMark, `${VERSION} 2027-01-15T08:00:00Z\n`);
		age(linuxMark, T + 60);
		expect(installProblem(out, VERSION)).toBeNull();
		expect(smokedProblem(out, VERSION)).toBeNull();
	});

	it('a bundle rebuilt after a Linux mark fails both, whichever bundle it is', () => {
		for (const rebuilt of [bundle, winZip]) {
			linuxOnly();
			age(bundle, T);
			age(winZip, T);
			age(rebuilt, T + 120);
			expect(installProblem(out, VERSION)).toContain('smoke.sh again');
			expect(installProblem(out, VERSION)).toContain(rebuilt.split('/').pop());
			expect(smokedProblem(out, VERSION)).not.toBeNull();
			expect(smokedProblem(out, VERSION)).not.toContain(LINUX_ONLY);
		}
	});

	it('a bundle rebuilt after a whole mark fails both, a Linux mark as old included', () => {
		writeFileSync(linuxMark, `${VERSION} 2027-01-15T08:00:00Z\n`);
		age(linuxMark, T + 60);
		age(bundle, T + 120);
		expect(installProblem(out, VERSION)).toContain('smoke.sh again');
		expect(smokedProblem(out, VERSION)).toContain('smoke.sh again');
	});

	it('another version’s Linux mark counts for nothing', () => {
		linuxOnly();
		writeFileSync(linuxMark, '2026.01.01 2026-01-01T00:00:00Z\n');
		expect(installProblem(out, VERSION)).toContain("wasn't smoke-tested");
		expect(smokedProblem(out, VERSION)).toContain("hasn't passed");
	});
});

describe('what a run leaves (recordSmoke, which smoke.sh calls)', () => {
	const NOW = new Date((T + 600) * 1000);
	beforeEach(builtEarlier);
	const LINE = new RegExp(
		`^${VERSION.replace(/\./g, '\\.')} \\d{4}-\\d\\d-\\d\\dT\\d\\d:\\d\\d:\\d\\dZ\\n$`
	);

	it('a whole run that passed writes both marks, in the shell’s own line', () => {
		rmSync(mark);
		recordSmoke(out, VERSION, { linux: 'passed', win: 'passed' }, NOW);
		expect(readFileSync(mark, 'utf8')).toMatch(LINE);
		expect(readFileSync(linuxMark, 'utf8')).toBe(`${VERSION} 2027-01-15T08:10:00Z\n`);
		expect(smokedProblem(out, VERSION)).toBeNull();
	});

	it('a whole run after a Linux run needs nothing special: publishing then passes', () => {
		linuxOnly(now - 1800);
		expect(smokedProblem(out, VERSION)).toContain(LINUX_ONLY);
		recordSmoke(out, VERSION, { linux: 'passed', win: 'passed' }, NOW);
		expect(smokedProblem(out, VERSION)).toBeNull();
	});

	it('a Linux run that passed after a whole run leaves the whole mark as it was', () => {
		const before = mtime(mark);
		recordSmoke(out, VERSION, { linux: 'passed', win: null }, NOW);
		expect(mtime(mark)).toBe(before);
		expect(existsSync(linuxMark)).toBe(true);
		expect(smokedProblem(out, VERSION)).toBeNull();
	});

	it('a Linux run that failed takes both marks away: both speak for that bundle', () => {
		writeFileSync(linuxMark, `${VERSION} 2027-01-15T08:00:00Z\n`);
		recordSmoke(out, VERSION, { linux: 'failed', win: null }, NOW);
		expect(existsSync(mark)).toBe(false);
		expect(existsSync(linuxMark)).toBe(false);
		expect(installProblem(out, VERSION)).toContain("wasn't smoke-tested");
	});

	it('a whole run whose Windows half failed leaves only the Linux mark', () => {
		recordSmoke(out, VERSION, { linux: 'passed', win: 'failed' }, NOW);
		expect(existsSync(mark)).toBe(false);
		expect(installProblem(out, VERSION)).toBeNull();
		expect(smokedProblem(out, VERSION)).toContain(LINUX_ONLY);
	});

	it('a Windows run alone: a failure takes the whole mark, a pass takes nothing', () => {
		writeFileSync(linuxMark, `${VERSION} 2027-01-15T08:00:00Z\n`);
		const before = mtime(mark);
		recordSmoke(out, VERSION, { linux: null, win: 'passed' }, NOW);
		expect(mtime(mark)).toBe(before);
		recordSmoke(out, VERSION, { linux: null, win: 'failed' }, NOW);
		expect(existsSync(mark)).toBe(false);
		expect(existsSync(linuxMark)).toBe(true);
	});

	it('a Windows run alone that passed writes no whole mark where there was none', () => {
		rmSync(mark);
		recordSmoke(out, VERSION, { linux: null, win: 'passed' }, NOW);
		expect(existsSync(mark)).toBe(false);
	});
});

describe('smoke.sh writes the marks per half (ops/release/smoke.sh, its Linux half)', () => {
	// The Linux half's one outside call is `docker run`: a stand-in on PATH answers
	// for it, passing or failing, and logs that it ran. Everything else is the
	// script's own (the fixtures, the zip, the tar of a real .tar.xz).
	const bin = join(world, 'bin');
	const calls = join(world, 'docker-calls');
	mkdirSync(bin, { recursive: true });
	writeFileSync(
		join(bin, 'docker'),
		`#!/bin/sh\necho "$1" >> "${calls}"\nexit "\${FAKE_DOCKER_STATUS:-0}"\n`
	);
	chmodSync(join(bin, 'docker'), 0o755);

	const realBundle = () => {
		const dir = join(world, 'bundle-src');
		mkdirSync(join(dir, 'tsundoku'), { recursive: true });
		writeFileSync(join(dir, 'tsundoku', 'tsundoku'), '#!/bin/sh\n');
		rmSync(bundle, { force: true });
		const tar = spawnSync('tar', ['-cJf', bundle, '-C', dir, 'tsundoku']);
		expect(tar.status).toBe(0);
		// Built before the whole mark, which was before this run.
		builtEarlier();
	};
	const smoke = (only: string, status = 0) => {
		rmSync(calls, { force: true });
		return spawnSync('sh', [join(root, 'ops/release/smoke.sh'), VERSION, only], {
			cwd: root,
			encoding: 'utf8',
			env: {
				...process.env,
				PATH: `${bin}:${process.env.PATH}`,
				RELEASE_DIR: base,
				FAKE_DOCKER_STATUS: String(status),
				TSUNDOKU_SMOKE_TAGGED: ''
			}
		});
	};

	it('a Linux run that passed writes .smoked-linux-x64 and leaves .smoked as it was', () => {
		realBundle();
		const before = mtime(mark);
		const r = smoke('linux-x64');
		expect(r.stdout).toContain('smoke: linux-x64 passed');
		expect(r.status).toBe(0);
		expect(readFileSync(calls, 'utf8').trim()).toBe('run');
		expect(readFileSync(linuxMark, 'utf8')).toMatch(
			new RegExp(`^${VERSION.replace(/\./g, '\\.')} `)
		);
		expect(mtime(mark)).toBe(before);
		expect(installProblem(out, VERSION)).toBeNull();
		expect(existsSync(join(base, 'smoke', VERSION))).toBe(false);
	});

	it('a Linux run that passed, with no whole mark, leaves publishing refused', () => {
		realBundle();
		rmSync(mark);
		expect(smoke('linux-x64').status).toBe(0);
		expect(installProblem(out, VERSION)).toBeNull();
		expect(smokedProblem(out, VERSION)).toContain(LINUX_ONLY);
	});

	it('a Linux run that failed exits 1 and takes both marks away', () => {
		realBundle();
		writeFileSync(linuxMark, `${VERSION} 2027-01-15T08:00:00Z\n`);
		const r = smoke('linux-x64', 1);
		expect(r.status).toBe(1);
		expect(r.stdout).toContain('smoke: FAILED (linux-x64: failed, win-x64: -)');
		expect(readFileSync(calls, 'utf8').trim()).toBe('run');
		expect(existsSync(mark)).toBe(false);
		expect(existsSync(linuxMark)).toBe(false);
	});

	it('a whole run whose Linux half failed takes both marks away though Zen never comes up', () => {
		// A copy of the release scripts with a zen.sh that fails at `up`, so the
		// Windows half stops the script under `set -e` before its end-of-run
		// record, and the real Zen can never be reached from a test.
		const tree = join(world, 'whole-run');
		rmSync(tree, { recursive: true, force: true });
		for (const f of ['smoke.sh', 'smoked.ts', 'smoked-mark.ts']) {
			mkdirSync(join(tree, 'ops/release'), { recursive: true });
			copyFileSync(join(root, 'ops/release', f), join(tree, 'ops/release', f));
		}
		cpSync(join(root, 'ops/release/smoke'), join(tree, 'ops/release/smoke'), { recursive: true });
		for (const d of ['tests', 'src', 'node_modules']) symlinkSync(join(root, d), join(tree, d));
		const zenCalls = join(world, 'zen-calls');
		rmSync(zenCalls, { force: true });
		mkdirSync(join(tree, 'ops/winvm'), { recursive: true });
		writeFileSync(
			join(tree, 'ops/winvm/zen.sh'),
			`#!/bin/sh\necho "$1" >> "${zenCalls}"\nexit 1\n`
		);
		chmodSync(join(tree, 'ops/winvm/zen.sh'), 0o755);

		realBundle();
		writeFileSync(linuxMark, `${VERSION} 2027-01-15T08:00:00Z\n`);
		age(linuxMark, now - 1800);
		expect(installProblem(out, VERSION)).toBeNull();
		rmSync(calls, { force: true });
		const r = spawnSync('sh', [join(tree, 'ops/release/smoke.sh'), VERSION], {
			cwd: tree,
			encoding: 'utf8',
			env: {
				...process.env,
				PATH: `${bin}:${process.env.PATH}`,
				RELEASE_DIR: base,
				FAKE_DOCKER_STATUS: '1',
				TSUNDOKU_SMOKE_TAGGED: '1'
			}
		});
		expect(r.status).not.toBe(0);
		expect(readFileSync(calls, 'utf8').trim()).toBe('run');
		expect(readFileSync(zenCalls, 'utf8').trim()).toBe('up');
		expect(existsSync(mark)).toBe(false);
		expect(existsSync(linuxMark)).toBe(false);
		expect(installProblem(out, VERSION)).not.toBeNull();
	});

	it('a platform it doesn’t know is refused before anything runs, the marks untouched', () => {
		realBundle();
		const before = mtime(mark);
		const r = smoke('mac-arm64');
		expect(r.status).toBe(2);
		expect(r.stderr).toContain('usage: smoke.sh');
		expect(existsSync(calls)).toBe(false);
		expect(mtime(mark)).toBe(before);
	});
});

describe('publishing reads the mark (ops/release/publish.ts)', () => {
	const publish = () =>
		spawnSync(
			process.execPath,
			['--disable-warning=ExperimentalWarning', 'ops/release/publish.ts', VERSION],
			{
				cwd: root,
				encoding: 'utf8',
				env: {
					...process.env,
					RELEASE_DIR: base,
					TSUNDOKU_RELEASE_HOST: 'host.invalid',
					TSUNDOKU_SIGNING_KEY: join(world, 'no-key.pem')
				}
			}
		);

	it('refuses a bundle rebuilt after its smoke test', () => {
		age(bundle, T + 120);
		const r = publish();
		expect(r.status).toBe(1);
		expect(r.stderr).toContain('smoke.sh again');
	});

	it('refuses a version smoke-tested on Linux only, in the card’s words', () => {
		linuxOnly();
		const r = publish();
		expect(r.status).toBe(1);
		expect(r.stderr).toContain(LINUX_ONLY);
	});

	it('goes on past a mark that still stands', () => {
		const r = publish();
		expect(r.status).toBe(1);
		expect(r.stderr).toContain('no notes');
	});
});

describe('installing reads the mark (ops/workstation/install-release.sh)', () => {
	// A copy, so `repo` and the timers' checkout it derives are the fixture's, with
	// the copy's own smoked.ts beside it. A run that gets past the mark stops at the
	// archive's checksum, which isn't there.
	const install = () => {
		const tree = join(world, 'tsundoku');
		for (const f of [
			'ops/workstation/install-release.sh',
			'ops/release/smoked.ts',
			'ops/release/smoked-mark.ts'
		]) {
			mkdirSync(join(tree, f, '..'), { recursive: true });
			copyFileSync(join(root, f), join(tree, f));
		}
		return spawnSync('sh', [join(tree, 'ops/workstation/install-release.sh'), VERSION], {
			encoding: 'utf8',
			env: { ...process.env, RELEASE_OUT: join(base, 'out'), HOME: join(world, 'home') }
		});
	};

	it('refuses a bundle rebuilt after its smoke test', () => {
		age(bundle, T + 120);
		const r = install();
		expect(r.status).toBe(1);
		expect(r.stderr).toContain('changed after');
		expect(r.stderr).toContain(`tsundoku-${VERSION}-linux-x64.tar.xz`);
	});

	it('refuses a bundle rebuilt after a Linux-only smoke test', () => {
		linuxOnly();
		age(bundle, T + 120);
		const r = install();
		expect(r.status).toBe(1);
		expect(r.stderr).toContain('changed after');
	});

	it('refuses a version with no mark', () => {
		rmSync(mark);
		const r = install();
		expect(r.status).toBe(1);
		expect(r.stderr).toContain("wasn't smoke-tested");
		expect(r.stderr).not.toContain('SHA256SUMS');
	});

	it('goes on past a whole mark that still stands', () => {
		const r = install();
		expect(r.status).toBe(1);
		expect(r.stderr).toContain("doesn't match its SHA256SUMS");
	});

	it('goes on past a Linux mark that still stands (c750)', () => {
		linuxOnly();
		const r = install();
		expect(r.status).toBe(1);
		expect(r.stderr).toContain("doesn't match its SHA256SUMS");
	});
});

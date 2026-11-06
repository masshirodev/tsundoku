import { spawnSync } from 'node:child_process';
import {
	copyFileSync,
	existsSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	utimesSync,
	writeFileSync
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { forgetSmoked, smokedProblem } from '../ops/release/smoked.ts';

const root = fileURLToPath(new URL('../', import.meta.url));
// A version no notes file will ever name: a publish that gets past the mark
// stops at the notes, before the signing key or the host.
const VERSION = '9999.12.31';
const world = mkdtempSync(join(tmpdir(), 'tsundoku-release-smoked-'));
const base = join(world, 'release');
const out = join(base, 'out', VERSION);
const bundle = join(out, `tsundoku-${VERSION}-linux-x64.tar.xz`);
const mark = join(out, '.smoked');
const T = 1_800_000_000;

const age = (file: string, seconds: number) => utimesSync(file, seconds, seconds);

beforeEach(() => {
	rmSync(out, { recursive: true, force: true });
	mkdirSync(out, { recursive: true });
	writeFileSync(bundle, 'bundle');
	age(bundle, T);
	writeFileSync(mark, `${VERSION} 2027-01-15T08:00:00Z\n`);
	age(mark, T + 60);
});

afterAll(() => rmSync(world, { recursive: true, force: true }));

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
	});

	it('is deleted by a rebuild’s first step, there or not', () => {
		forgetSmoked(out);
		expect(existsSync(mark)).toBe(false);
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

	it('goes on past a mark that still stands', () => {
		const r = publish();
		expect(r.status).toBe(1);
		expect(r.stderr).toContain('no notes');
	});
});

describe('installing reads the mark (ops/workstation/install-release.sh)', () => {
	// A copy, so `repo` and the timers' checkout it derives are the fixture's. A
	// run that gets past the mark stops at the archive's checksum, which isn't there.
	const install = () => {
		const dir = join(world, 'tsundoku/ops/workstation');
		mkdirSync(dir, { recursive: true });
		const script = join(dir, 'install-release.sh');
		copyFileSync(join(root, 'ops/workstation/install-release.sh'), script);
		return spawnSync('sh', [script, VERSION], {
			encoding: 'utf8',
			env: { ...process.env, RELEASE_OUT: join(base, 'out'), HOME: join(world, 'home') }
		});
	};

	it('refuses a bundle rebuilt after its smoke test', () => {
		age(bundle, T + 120);
		const r = install();
		expect(r.status).toBe(1);
		expect(r.stderr).toContain('changed after its smoke test');
		expect(r.stderr).toContain(`tsundoku-${VERSION}-linux-x64.tar.xz`);
	});

	it('refuses a version with no mark', () => {
		rmSync(mark);
		const r = install();
		expect(r.status).toBe(1);
		expect(r.stderr).toContain("wasn't smoke-tested");
	});

	it('goes on past a mark that still stands', () => {
		const r = install();
		expect(r.status).toBe(1);
		expect(r.stderr).toContain("doesn't match its SHA256SUMS");
	});
});

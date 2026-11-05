import { execFileSync, spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { dependants, refused, RUNS } from '../../scripts/e2e-dependants.ts';

/**
 * `yarn run test:e2e:dependants` (c564): both runs get the caller's arguments,
 * and the step is red when either project is. The runner is faked here; the
 * real step's green and both reds were run against Playwright in wave 25
 * (doc/handoff-notes/e2e.md).
 */
function fake(codes: number[]) {
	const calls: string[][] = [];
	const run = (args: string[]) => {
		calls.push(args);
		return codes[calls.length - 1];
	};
	return { calls, run };
}

describe('the dependants step', () => {
	it('runs duplicates, then gate, as two runs, each with the arguments appended', () => {
		const { calls, run } = fake([0, 0]);
		expect(dependants(run, ['--reporter=line', '--workers=1'])).toBe(0);
		expect(calls).toEqual([
			['--project=duplicates', '--no-deps', '--reporter=line', '--workers=1'],
			['--project=gate', '--no-deps', '--reporter=line', '--workers=1']
		]);
	});

	it('is green with no arguments when both are', () => {
		const { calls, run } = fake([0, 0]);
		expect(dependants(run, [])).toBe(0);
		expect(calls).toEqual(RUNS.map((r) => [...r]));
	});

	it('is red when duplicates is, and still runs gate', () => {
		const { calls, run } = fake([1, 0]);
		expect(dependants(run, ['--reporter=line'])).toBe(1);
		expect(calls).toHaveLength(2);
	});

	it('is red when gate is and duplicates was green', () => {
		const { run } = fake([0, 1]);
		expect(dependants(run, ['--reporter=line'])).toBe(1);
	});

	it("answers the first red's code when both are red", () => {
		const { run } = fake([2, 1]);
		expect(dependants(run, [])).toBe(2);
	});

	it('refuses a caller’s --project, in either spelling, and nothing else', () => {
		expect(refused(['--project=webkit'])).toMatch(/drop --project=webkit/);
		expect(refused(['--reporter=line', '--project', 'webkit'])).toMatch(/drop --project\b/);
		expect(refused(['--reporter=line', '--workers=1'])).toBeNull();
		expect(refused([])).toBeNull();
	});

	it('is what package.json runs', () => {
		const pkg = JSON.parse(readFileSync('package.json', 'utf8')) as {
			scripts: Record<string, string>;
		};
		expect(pkg.scripts['test:e2e:dependants']).toBe(
			'node --experimental-strip-types scripts/e2e-dependants.ts'
		);
	});

	it('exits 2 on a caller’s --project before starting Playwright', () => {
		const result = spawnSync(
			process.execPath,
			['--experimental-strip-types', 'scripts/e2e-dependants.ts', '--project=webkit'],
			{ env: { ...process.env, NODE_NO_WARNINGS: '1' }, encoding: 'utf8' }
		);
		expect(result.status).toBe(2);
		expect(result.stderr).toMatch(/drop --project=webkit/);
		expect(result.stdout).toBe('');
	});

	it('loads under Node type stripping, as package.json runs it', () => {
		const code = `const m = await import('./scripts/e2e-dependants.ts'); if (typeof m.dependants !== 'function') process.exit(3);`;
		const run = () =>
			execFileSync(
				process.execPath,
				['--experimental-strip-types', '--input-type=module', '-e', code],
				{ env: { ...process.env, NODE_NO_WARNINGS: '1' }, stdio: 'pipe' }
			);
		expect(run).not.toThrow();
	});
});

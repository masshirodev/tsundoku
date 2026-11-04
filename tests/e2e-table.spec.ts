import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
	problems,
	projectsByFile,
	readRows,
	rebuild,
	render,
	runsOn
} from '../scripts/e2e-table.ts';

/**
 * doc/TESTING.md's e2e table against Playwright's own list of files and
 * projects (c348): a spec file without a row, a row for a file that is gone,
 * or a "Runs on" the config no longer says fails here, and
 * `yarn run e2e:table` writes the fix.
 */

const doc = (rows: string[]) =>
	[
		'before',
		'<!-- e2e-table:start -->',
		'',
		'| Spec | Runs on | Why |',
		'| --- | --- | --- |',
		...rows,
		'',
		'<!-- e2e-table:end -->',
		'after'
	].join('\n');

const files = new Map([
	['a.e2e.ts', new Set(['tablet-portrait', 'tablet-landscape', 'phone', 'desktop'])],
	['b-flow.e2e.ts', new Set(['tablet-portrait'])],
	['tv-c.e2e.ts', new Set(['tv'])]
]);

describe('the e2e table', () => {
	it('names the four devices as one, and every other project by name', () => {
		expect(runsOn(files.get('a.e2e.ts')!)).toBe('devices');
		expect(runsOn(new Set([...files.get('a.e2e.ts')!, 'tv']))).toBe('devices, tv');
		expect(runsOn(new Set(['tv', 'tablet-portrait']))).toBe('tablet-portrait, tv');
		expect(runsOn(new Set(['browse']))).toBe('browse');
	});

	it('is current when every file has one row and the projects agree', () => {
		const ok = doc([
			'| `a.e2e.ts` | devices | Read-only. |',
			'| `b-flow.e2e.ts`, `tv-c.e2e.ts` | tablet-portrait, tv | Two in one row. |'
		]);
		expect(problems(ok, files)).toEqual([]);
	});

	it('names a missing file, a gone one, a doubled one and a wrong project', () => {
		const stale = doc([
			'| `a.e2e.ts` | all | Read-only. |',
			'| `gone.e2e.ts`, `b-flow.e2e.ts` | tablet-portrait | Writes. |',
			'| `b-flow.e2e.ts` | tablet-portrait | Again. |'
		]);
		expect(problems(stale, files).sort()).toEqual(
			[
				'a.e2e.ts: runs on "devices", the table says "all"',
				'b-flow.e2e.ts: in 2 rows',
				'gone.e2e.ts: has a row, but no such spec',
				'tv-c.e2e.ts: no row'
			].sort()
		);
	});

	it('rebuilds by keeping each row’s Why, dropping gone files and adding new ones', () => {
		const rows = readRows(
			doc(['| `a.e2e.ts` | all | Kept \\| with a bar. |', '| `gone.e2e.ts` | phone | Gone. |'])
		);
		const table = render(
			rebuild(rows, new Map([...files].filter(([f]) => f !== 'tv-c.e2e.ts'))),
			files
		);
		expect(table.split('\n').slice(2)).toEqual([
			'| `a.e2e.ts` | devices | Kept \\| with a bar. |',
			expect.stringMatching(/^\| `b-flow\.e2e\.ts` \| tablet-portrait \| .+ \|$/)
		]);
	});

	it('lists every file the config collects, whatever one run skips', { timeout: 120_000 }, () => {
		// doc/TESTING.md's "Load" tells a gate to export this expression; every
		// library-frame test matches it, and the table must keep that file anyway.
		const before = process.env.PLAYWRIGHT_SKIP;
		process.env.PLAYWRIGHT_SKIP =
			'screen: (continueList|continueRow|grid|tile) matches the handoff|START SCAN with nothing to import|the end of the series asks for a rating while unrated|a spread is the default on a TV, not one page';
		try {
			expect([...(projectsByFile().get('library-frame.e2e.ts') ?? [])]).toContain(
				'tablet-portrait'
			);
		} finally {
			if (before === undefined) delete process.env.PLAYWRIGHT_SKIP;
			else process.env.PLAYWRIGHT_SKIP = before;
		}
	});

	it('lists every spec file, on the projects the config gives it', { timeout: 120_000 }, () => {
		const wrong = problems(readFileSync('doc/TESTING.md', 'utf8'), projectsByFile());
		expect(wrong, 'run `yarn run e2e:table`').toEqual([]);
	});
});

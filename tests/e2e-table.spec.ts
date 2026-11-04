import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
	alternatives,
	documentedSkip,
	fixtureClaim,
	fixtureUse,
	problems,
	projectsByFile,
	readRows,
	rebuild,
	render,
	runsOn,
	testTitles
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

	it('finds the skip expression in a doc, and splits it at its top level only', () => {
		const load = (line: string) => ['### Load', '', '```sh', line, '  npx playwright test', '```'];
		expect(documentedSkip(load("  PLAYWRIGHT_SKIP='a (b|c) d|e \\| f' \\").join('\n'))).toBe(
			'a (b|c) d|e \\| f'
		);
		expect(documentedSkip(load('  npx playwright test').join('\n'))).toBeNull();
		// The doc's own example of the form is a `text` block, not a live one.
		expect(
			documentedSkip("```text\nPLAYWRIGHT_SKIP='<a title>' npx playwright test\n```")
		).toBeNull();
		// A form it cannot read is an error, not "no expression": the check on
		// the expression would otherwise pass having checked nothing.
		for (const line of [
			'  PLAYWRIGHT_SKIP="a|b" \\',
			"  export PLAYWRIGHT_SKIP='a|b'",
			'  PLAYWRIGHT_SKIP=a npx playwright test'
		]) {
			expect(() => documentedSkip(load(line).join('\n'))).toThrow(/PLAYWRIGHT_SKIP='…'/);
		}
		expect(alternatives('a (b|c) d|e \\| f|[|]x')).toEqual(['a (b|c) d', 'e \\| f', '[|]x']);
		expect(alternatives('one title')).toEqual(['one title']);
	});

	it('lists every file the config collects, whatever one run skips', { timeout: 120_000 }, () => {
		// A gate exports doc/TESTING.md's expression for the whole unit run too.
		// Here every test is left out, so a table that obeyed it would be empty.
		const all = projectsByFile();
		const before = process.env.PLAYWRIGHT_SKIP;
		process.env.PLAYWRIGHT_SKIP = '.';
		try {
			expect(projectsByFile()).toEqual(all);
		} finally {
			if (before === undefined) delete process.env.PLAYWRIGHT_SKIP;
			else process.env.PLAYWRIGHT_SKIP = before;
		}
	});

	it('the doc’s skip expression names only tests that exist', { timeout: 120_000 }, () => {
		// The doc is the one copy (c478): this spec kept an older one of its own,
		// which went on skipping tests wave 19 had already fixed.
		// Vacuous while no red is filed (wave 21: none), since there is no
		// expression to check; a form documentedSkip() cannot read throws above
		// rather than reading as none. Each alternative is matched against a
		// test's own title, not its file or describe (doc/TESTING.md, "Load").
		const expression = documentedSkip(readFileSync('doc/TESTING.md', 'utf8'));
		if (expression === null) return;
		const titles = [...testTitles()];
		const stale = alternatives(expression).filter((alt) => {
			const re = new RegExp(alt);
			return !titles.some((t) => re.test(t));
		});
		expect(stale, 'an alternative that matches no title: take it out of "Load"').toEqual([]);
	});

	it('splits spec files by whose `test` they import, as the doc’s loop does', () => {
		const dir = mkdtempSync(join(tmpdir(), 'e2e-fixture-use-'));
		try {
			const files: Record<string, string> = {
				'a.e2e.ts': "import { expect, test } from './fixtures';",
				'b.e2e.ts': "import { test, expect, type Page } from './helpers/hydrated';",
				'c.e2e.ts': "import { expect, test } from '@playwright/test';",
				'd.e2e.ts':
					"import { test as plain } from '@playwright/test';\nimport { expect, test } from './fixtures';",
				'e.e2e.ts':
					"import { expect } from './fixtures';\nimport { test } from '@playwright/test';",
				'f.spec.ts': "import { test } from './fixtures';"
			};
			for (const [name, text] of Object.entries(files)) writeFileSync(join(dir, name), text);
			expect(fixtureUse(dir)).toEqual({ using: ['a', 'b', 'd'], not: ['c', 'e'] });
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});

	it('the fixtures’ count in the doc is the files’ own, and its lists name the rest', () => {
		// doc/TESTING.md said "every e2e spec" uses the fixture while seventeen
		// did not (e2e round 1 review): the count and both lists are claims.
		const claim = fixtureClaim(readFileSync('doc/TESTING.md', 'utf8'));
		expect(claim, 'doc/TESTING.md: "**N of the M e2e files take `test` from …**"').not.toBeNull();
		const { using, not } = fixtureUse();
		expect([claim!.count, claim!.of]).toEqual([using.length, using.length + not.length]);
		expect([...claim!.deliberate, ...claim!.unmoved].sort()).toEqual(not);
	});

	it('lists every spec file, on the projects the config gives it', { timeout: 120_000 }, () => {
		const wrong = problems(readFileSync('doc/TESTING.md', 'utf8'), projectsByFile());
		expect(wrong, 'run `yarn run e2e:table`').toEqual([]);
	});
});

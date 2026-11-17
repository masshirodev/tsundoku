/**
 * doc/TESTING.md's e2e table, kept by the config rather than by memory.
 *
 * The table between `<!-- e2e-table:start -->` and `<!-- e2e-table:end -->`
 * has one row per spec file, or per group of files that share a reason. Its
 * "Runs on" column is Playwright's own answer: `playwright test --list`
 * resolves every project's testMatch and testIgnore, so a file that moves
 * projects moves here too. The "Why" column is written by hand and kept.
 *
 *   node --experimental-strip-types scripts/e2e-table.ts          # write
 *   node --experimental-strip-types scripts/e2e-table.ts --check  # fail if stale
 *
 * Writing adds a row for a file the table lacks (its "Why" taken from the
 * file's header comment, to be rewritten by whoever reads it), drops a file
 * that is gone, and recomputes every "Runs on". `--check` is what
 * `tests/e2e-table.spec.ts` runs, so the unit suite fails while a spec file is
 * missing from the table or a row names the wrong projects.
 *
 * The same write renders a second block, between `<!-- e2e-fixtures:start -->`
 * and `<!-- e2e-fixtures:end -->`: how many e2e files take the fixtures' `test`
 * and which of the rest never moved over (`fixtureUse()`, `renderFixtures()`).
 * Its one hand-written input is the doc's "On purpose, to act before
 * hydration" bullet, outside the block; `--check` fails on a stale block, and
 * on a name in that bullet which takes the fixtures' `test` or is gone, which
 * only a person can settle.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from '../src/lib/server/fspath.ts';

const ROOT = join(import.meta.dirname, '..');
const DOC = join(ROOT, 'doc/TESTING.md');
const START = '<!-- e2e-table:start -->';
const END = '<!-- e2e-table:end -->';
const HEAD = '| Spec | Runs on | Why |';

/** The four device projects, which a plain `*.e2e.ts` runs in (playwright.config.ts). */
const DEVICES = ['tablet-portrait', 'tablet-landscape', 'phone', 'desktop'];

type Suite = {
	specs?: { file: string; title: string; tests: { projectName: string }[] }[];
	suites?: Suite[];
};

/** Playwright's own list of every test, as JSON, with no run's skips applied. */
function listing(): { suites: Suite[] } {
	const out = execFileSync('npx', ['playwright', 'test', '--list', '--reporter=json'], {
		cwd: ROOT,
		encoding: 'utf8',
		maxBuffer: 64 * 1024 * 1024,
		stdio: ['ignore', 'pipe', 'pipe'],
		// Listing starts no server; a gate's ports are irrelevant here. The table
		// describes the files the config collects, not one run's skips, so a
		// PLAYWRIGHT_SKIP exported for the gate (doc/TESTING.md, "Load") must not
		// become every project's grepInvert here: empty is falsy, so none is set.
		env: { ...process.env, PLAYWRIGHT_NO_SERVER: '1', PLAYWRIGHT_SKIP: '' }
	});
	return JSON.parse(out.slice(out.indexOf('{'))) as { suites: Suite[] };
}

function eachSpec(suites: Suite[], visit: (spec: NonNullable<Suite['specs']>[number]) => void) {
	const walk = (s: Suite) => {
		for (const spec of s.specs ?? []) visit(spec);
		for (const c of s.suites ?? []) walk(c);
	};
	for (const s of suites) walk(s);
}

/** Every spec file and the projects that collect it, as Playwright itself resolves them. */
export function projectsByFile(): Map<string, Set<string>> {
	const files = new Map<string, Set<string>>();
	eachSpec(listing().suites, (spec) => {
		const name = spec.file.replace(/^.*\//, '');
		if (!files.has(name)) files.set(name, new Set());
		for (const t of spec.tests) files.get(name)!.add(t.projectName);
	});
	return files;
}

/** Every test's own title, once, whichever files and projects hold it. */
export function testTitles(): Set<string> {
	const titles = new Set<string>();
	eachSpec(listing().suites, (spec) => titles.add(spec.title));
	return titles;
}

/**
 * The `PLAYWRIGHT_SKIP` expression doc/TESTING.md's "Load" tells a whole run
 * to export, from a `sh` block, or null when it gives none. The doc is its one copy:
 * `tests/e2e-table.spec.ts` reads it from there rather than keeping its own.
 */
export function documentedSkip(doc: string): string | null {
	// Only a `sh` block counts: the doc's own example of the form is `text`.
	for (const [, block] of doc.matchAll(/^\s*```sh\n([\s\S]*?)^\s*```/gm)) {
		const found = /^\s*PLAYWRIGHT_SKIP='([^']+)'/m.exec(block);
		if (found) return found[1];
		// A form this does not read (double quotes, `export`) would otherwise be
		// "no expression", and the check on it would pass with nothing checked.
		const other = /^.*PLAYWRIGHT_SKIP=.*$/m.exec(block);
		if (other) {
			throw new Error(
				`doc/TESTING.md gives PLAYWRIGHT_SKIP as \`${other[0].trim()}\`; write it as PLAYWRIGHT_SKIP='…' at the start of a line`
			);
		}
	}
	return null;
}

/**
 * The import that gives a spec the fixtures' `test` (doc/TESTING.md, "E2E
 * specs"), as one pattern that both this file and the doc's `rg -UP` loop use
 * verbatim (`tests/e2e-table.spec.ts` holds them equal). It spans lines,
 * because Prettier wraps an import past the print width over several, one
 * name a line, and a one-line pattern would count such a file as off the
 * fixtures. A `type`-only import of `test` (`import type { test }`, or
 * `{ type test }`) gives no `test` at run time, so it does not count. The
 * quote is `\x27` so the doc can single-quote the whole pattern for the
 * shell, where `!` would otherwise be history expansion.
 */
export const FIXTURE_PATTERN = String.raw`^import\s*\{[^}]*(?<!\btype\s)\btest\b[^}]*\}\s*from\s*\x27(\./fixtures|\./helpers/hydrated)\x27`;
const FIXTURE_TEST = new RegExp(FIXTURE_PATTERN, 'm');

/**
 * Every `tests/*.e2e.ts` by whether its `test` is the fixtures' (which waits
 * for hydration) or `@playwright/test`'s, by base name without `.e2e.ts`: the
 * same split as the loop doc/TESTING.md gives.
 */
export function fixtureUse(dir = join(ROOT, 'tests')): { using: string[]; not: string[] } {
	const using: string[] = [];
	const not: string[] = [];
	for (const file of readdirSync(dir).filter((f) => f.endsWith('.e2e.ts'))) {
		const name = file.replace(/\.e2e\.ts$/, '');
		(FIXTURE_TEST.test(readFileSync(join(dir, file), 'utf8')) ? using : not).push(name);
	}
	return { using: using.sort(), not: not.sort() };
}

const FIXTURES_START = '<!-- e2e-fixtures:start -->';
const FIXTURES_END = '<!-- e2e-fixtures:end -->';
/** The hand-written bullet's own words; it may name no file at all. */
export const DELIBERATE = '- **On purpose, to act before hydration:**';

/**
 * The files doc/TESTING.md names, by hand, as taking `@playwright/test`'s
 * `test` on purpose: its "On purpose, to act before hydration" bullet, which
 * sits outside the generated block because a person decides it. Empty when the
 * doc has no such bullet.
 */
export function deliberateList(doc: string): string[] {
	const at = doc.indexOf(DELIBERATE);
	if (at < 0) return [];
	// A list item runs to the next item or the next blank line.
	const end = doc.slice(at + DELIBERATE.length).search(/\n(- |\n|<!--)/);
	const text = end < 0 ? doc.slice(at) : doc.slice(at, at + DELIBERATE.length + end);
	return [...text.matchAll(/`([a-z0-9-]+)`/g)].map((x) => x[1]);
}

/** `a`, `a and b`, `a, b and c`, each in backticks. */
function names(list: string[]): string {
	const ticked = list.map((n) => `\`${n}\``);
	return ticked.length < 2
		? (ticked[0] ?? 'none')
		: `${ticked.slice(0, -1).join(', ')} and ${ticked.at(-1)}`;
}

/**
 * The block between `<!-- e2e-fixtures:start -->` and `<!-- e2e-fixtures:end -->`
 * as the files make it: the count, and every file off the fixtures that the
 * deliberate list does not name. It is written, never typed, so a new e2e file
 * from any branch is counted by one step, `yarn run e2e:table` (a hand-typed
 * count goes stale as soon as two branches each add a file).
 */
export function renderFixtures(
	use: { using: string[]; not: string[] },
	deliberate: string[]
): string {
	const total = use.using.length + use.not.length;
	const unmoved = use.not.filter((n) => !deliberate.includes(n));
	return [
		`**${use.using.length} of the ${total} e2e files take \`test\` from \`tests/fixtures.ts\`** (or from \`tests/helpers/hydrated.ts\`, the same \`test\` under its old name); the other ${use.not.length} take \`@playwright/test\`'s.`,
		'',
		`- **Never moved over, with no reason to stay (${unmoved.length}):** ${names(unmoved)}.`
	].join('\n');
}

/** The generated block as the doc has it now, or null without its markers. */
function fixturesBlock(doc: string): string | null {
	const a = doc.indexOf(FIXTURES_START);
	const b = doc.indexOf(FIXTURES_END);
	if (a < 0 || b < a) return null;
	return doc.slice(a + FIXTURES_START.length, b).trim();
}

/** The doc with the generated block rewritten from the files. */
export function writeFixtures(doc: string, use: { using: string[]; not: string[] }): string {
	if (fixturesBlock(doc) === null)
		throw new Error(`doc/TESTING.md has no ${FIXTURES_START} … ${FIXTURES_END} block`);
	const a = doc.indexOf(FIXTURES_START) + FIXTURES_START.length;
	const block = renderFixtures(use, deliberateList(doc));
	return `${doc.slice(0, a)}\n\n${block}\n\n${doc.slice(doc.indexOf(FIXTURES_END))}`;
}

/**
 * What is wrong with the fixtures' block, one line each: `stale` is what
 * `yarn run e2e:table` clears, `deliberate` is what only a person can (a file on
 * the hand-written list that takes the fixtures' `test` now, or is gone).
 */
export function fixtureProblems(
	doc: string,
	use: { using: string[]; not: string[] }
): { stale: string[]; deliberate: string[] } {
	const have = fixturesBlock(doc);
	const stale =
		have === null
			? [`no ${FIXTURES_START} … ${FIXTURES_END} block`]
			: have === renderFixtures(use, deliberateList(doc))
				? []
				: [
						`the fixtures' count says "${have.split('\n')[0].slice(0, 60)}…", the files make it ${use.using.length} of ${use.using.length + use.not.length}, or its unmoved list differs`
					];
	const deliberate = deliberateList(doc)
		.filter((n) => !use.not.includes(n))
		.map(
			(n) =>
				`${n}: on the "On purpose" list, but ${use.using.includes(n) ? "it takes the fixtures' test" : 'there is no such e2e file'}`
		);
	return { stale, deliberate };
}

/** A regular expression's top-level alternatives: `a|(b|c)|d` is `a`, `(b|c)`, `d`. */
export function alternatives(expression: string): string[] {
	const out: string[] = [];
	let depth = 0;
	let inClass = false;
	let from = 0;
	for (let i = 0; i < expression.length; i++) {
		const c = expression[i];
		if (c === '\\') i++;
		else if (inClass) inClass = c !== ']';
		else if (c === '[') inClass = true;
		else if (c === '(') depth++;
		else if (c === ')') depth--;
		else if (c === '|' && depth === 0) {
			out.push(expression.slice(from, i));
			from = i + 1;
		}
	}
	out.push(expression.slice(from));
	return out;
}

/** "devices", "devices, tv", or the projects by name, in the config's own words. */
export function runsOn(projects: Set<string>): string {
	const rest = [...projects].filter((p) => !DEVICES.includes(p));
	const all = DEVICES.every((d) => projects.has(d));
	const named = all ? ['devices', ...rest.sort()] : [...projects].sort();
	return named.join(', ');
}

type Row = { files: string[]; why: string };

/** Split a Markdown table row on its unescaped bars. */
function cells(line: string): string[] {
	const parts = line
		.trim()
		.replace(/^\|/, '')
		.replace(/\|$/, '')
		.split(/(?<!\\)\|/);
	return parts.map((c) => c.trim());
}

export function readRows(doc: string): Row[] {
	const a = doc.indexOf(START);
	const b = doc.indexOf(END);
	if (a < 0 || b < a) throw new Error(`doc/TESTING.md has no ${START} … ${END} block`);
	return doc
		.slice(a + START.length, b)
		.split('\n')
		.filter((l) => l.trim().startsWith('|'))
		.slice(2) // the head and its rule
		.map((l) => {
			const [spec, , why] = cells(l);
			return { files: [...spec.matchAll(/`([^`]+)`/g)].map((m) => m[1]), why: why ?? '' };
		});
}

/** The first sentence or two of a spec's header comment: a starting point for its "Why". */
export function headerOf(file: string): string {
	const path = join(ROOT, 'tests', file);
	const src = existsSync(path) ? readFileSync(path, 'utf8') : '';
	const head = src.slice(0, src.search(/^(test|test\.describe)\(/m) >>> 0);
	const block = /\/\*\*([\s\S]*?)\*\//.exec(head)?.[1] ?? '';
	const text = block
		.split('\n')
		.map((l) => l.replace(/^\s*\*\s?/, '').trim())
		.join(' ')
		.replace(/\s+/g, ' ')
		.trim();
	// Its first sentence: a header that opens with a colon goes on to say what.
	let sentence = /^.*?\.(\s|$)/.exec(text)?.[0].trim() ?? text;
	if (sentence.length > 400) sentence = `${sentence.slice(0, 400).replace(/\s\S*$/, '')} …`;
	return (sentence || 'No header comment: say what this file covers.').replace(/\|/g, '\\|');
}

/** The table as it should be: the rows kept, files gone dropped, files new added, "Runs on" recomputed. */
export function rebuild(rows: Row[], files: Map<string, Set<string>>): Row[] {
	const kept = rows
		.map((r) => ({ ...r, files: r.files.filter((f) => files.has(f)) }))
		.filter((r) => r.files.length > 0);
	const listed = new Set(kept.flatMap((r) => r.files));
	const added = [...files.keys()]
		.filter((f) => !listed.has(f))
		.sort()
		.map((f) => ({ files: [f], why: headerOf(f) }));
	return [...kept, ...added];
}

export function render(rows: Row[], files: Map<string, Set<string>>): string {
	const line = (r: Row) => {
		const projects = new Set(r.files.flatMap((f) => [...files.get(f)!]));
		return `| ${r.files.map((f) => `\`${f}\``).join(', ')} | ${runsOn(projects)} | ${r.why} |`;
	};
	return [HEAD, '| --- | --- | --- |', ...rows.map(line)].join('\n');
}

/** What is wrong with the table now, one line each; empty when it is current. */
export function problems(doc: string, files: Map<string, Set<string>>): string[] {
	const rows = readRows(doc);
	const out: string[] = [];
	const listed = new Map<string, number>();
	for (const r of rows) for (const f of r.files) listed.set(f, (listed.get(f) ?? 0) + 1);
	for (const f of files.keys()) if (!listed.has(f)) out.push(`${f}: no row`);
	for (const [f, n] of listed) {
		if (!files.has(f)) out.push(`${f}: has a row, but no such spec`);
		if (n > 1) out.push(`${f}: in ${n} rows`);
	}
	const a = doc.indexOf(START);
	const lines = doc
		.slice(a, doc.indexOf(END))
		.split('\n')
		.filter((l) => l.trim().startsWith('|'))
		.slice(2);
	rows.forEach((r, i) => {
		const present = r.files.filter((f) => files.has(f));
		if (present.length === 0) return;
		const want = runsOn(new Set(present.flatMap((f) => [...files.get(f)!])));
		const have = cells(lines[i])[1];
		if (have !== want)
			out.push(`${r.files.join(', ')}: runs on "${want}", the table says "${have}"`);
	});
	return out;
}

if (import.meta.main) {
	const doc = readFileSync(DOC, 'utf8');
	const files = projectsByFile();
	const use = fixtureUse();
	if (process.argv.includes('--check')) {
		const fixtures = fixtureProblems(doc, use);
		const wrong = [...problems(doc, files), ...fixtures.stale];
		if (wrong.length) {
			console.error(
				`doc/TESTING.md's e2e table or fixtures' count is stale; run \`yarn run e2e:table\`:\n  ${wrong.join('\n  ')}`
			);
		}
		if (fixtures.deliberate.length) {
			console.error(
				`doc/TESTING.md's "On purpose" list needs a person, not the generator:\n  ${fixtures.deliberate.join('\n  ')}`
			);
		}
		if (wrong.length || fixtures.deliberate.length) process.exit(1);
		console.log(
			`doc/TESTING.md's e2e table lists all ${files.size} spec files; ${use.using.length} of ${use.using.length + use.not.length} e2e files take the fixtures' test.`
		);
	} else {
		const table = render(rebuild(readRows(doc), files), files);
		const a = doc.indexOf(START) + START.length;
		const tabled = `${doc.slice(0, a)}\n\n${table}\n\n${doc.slice(doc.indexOf(END))}`;
		writeFileSync(DOC, writeFixtures(tabled, use));
		execFileSync('npx', ['prettier', '--write', DOC], { cwd: ROOT, stdio: 'ignore' });
		console.log(
			`doc/TESTING.md's e2e table: ${files.size} spec files; fixtures' count: ${use.using.length} of ${use.using.length + use.not.length}.`
		);
		// Written anyway: the count is right, and only the hand-written list is wrong.
		const { deliberate } = fixtureProblems(writeFixtures(tabled, use), use);
		if (deliberate.length) {
			console.error(
				`doc/TESTING.md's "On purpose" list needs a person:\n  ${deliberate.join('\n  ')}`
			);
			process.exit(1);
		}
	}
}

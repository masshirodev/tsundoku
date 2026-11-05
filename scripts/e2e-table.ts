/**
 * doc/TESTING.md's e2e table, kept by the config rather than by memory (c348).
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
 * to export, from a `sh` block, or null when it gives none. The doc is its one copy (c478):
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

/** The import that gives a spec the fixtures' `test` (doc/TESTING.md, "E2E specs"). */
const FIXTURE_TEST = /^import .*\btest\b.* from '(\.\/fixtures|\.\/helpers\/hydrated)'/m;

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

/**
 * What doc/TESTING.md says of the fixtures: "**N of the M e2e files take
 * `test` from `tests/fixtures.ts`**", and the files its two lists name as
 * not taking it, or null where it says no such count.
 */
export function fixtureClaim(
	doc: string
): { count: number; of: number; deliberate: string[]; unmoved: string[] } | null {
	const head = /\*\*(\d+) of the (\d+) e2e files take `test` from `tests\/fixtures\.ts`\*\*/.exec(
		doc
	);
	if (!head) return null;
	// A list is its bullet: from `- **<label>` to the next bullet or blank line.
	const bullet = (label: string) => {
		const at = doc.indexOf(`- **${label}`, head.index);
		if (at < 0) return [];
		const end = doc.slice(at).search(/\n(- |\n)/);
		const text = end < 0 ? doc.slice(at) : doc.slice(at, at + end);
		return [...text.matchAll(/`([a-z0-9-]+)`/g)].map((x) => x[1]);
	};
	return {
		count: Number(head[1]),
		of: Number(head[2]),
		deliberate: bullet('On purpose, to act before hydration'),
		unmoved: bullet('Never moved over')
	};
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
	if (process.argv.includes('--check')) {
		const wrong = problems(doc, files);
		if (wrong.length) {
			console.error(
				`doc/TESTING.md's e2e table is stale; run \`yarn run e2e:table\`:\n  ${wrong.join('\n  ')}`
			);
			process.exit(1);
		}
		console.log(`doc/TESTING.md's e2e table lists all ${files.size} spec files.`);
	} else {
		const table = render(rebuild(readRows(doc), files), files);
		const a = doc.indexOf(START) + START.length;
		writeFileSync(DOC, `${doc.slice(0, a)}\n\n${table}\n\n${doc.slice(doc.indexOf(END))}`);
		execFileSync('npx', ['prettier', '--write', DOC], { cwd: ROOT, stdio: 'ignore' });
		console.log(`doc/TESTING.md's e2e table: ${files.size} spec files.`);
	}
}

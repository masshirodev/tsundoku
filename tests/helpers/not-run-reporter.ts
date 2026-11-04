import { relative } from 'node:path';
import type { FullConfig, Reporter, Suite, TestCase } from '@playwright/test/reporter';

/**
 * Says which tests did not run, and why, at the end of a run (c439).
 *
 * Playwright's own summary gives a bare count ("12 did not run"), and wave
 * 19's gate read a run with `duplicates` and `gate` in that count as green
 * twice: those two projects depend on every device project
 * (playwright.config.ts), so one red in a device project, even a known one,
 * keeps all of their tests from running. This names each project with tests
 * that did not run, its count, and the reds in the projects it depends on
 * that kept it out, so a run's report says what it did not check.
 *
 * "Did not run" is Playwright's own rule (its base reporter): a test whose
 * outcome is skipped although it was not skipped on purpose, or that has no
 * result at all, and was not interrupted. A serial file's tests after its
 * first red, and a file's tests after its failed beforeAll, are counted the
 * same way; they are named as that, not as a dependency's.
 */

/** One test, as much of it as the summary reads. */
export type Row = {
	project: string;
	where: string;
	title: string;
	/** Playwright's `outcome()`. */
	outcome: 'expected' | 'unexpected' | 'flaky' | 'skipped';
	/** Whether it has a result, and whether it was meant to be skipped. */
	ran: boolean;
	skippedOnPurpose: boolean;
	/** Stopped part-way (Ctrl-C, a timeout of the whole run): Playwright counts these apart. */
	interrupted: boolean;
};

export type Project = { name: string; dependencies: string[] };

const didNotRun = (r: Row) =>
	r.outcome === 'skipped' && !r.interrupted && (!r.ran || !r.skippedOnPurpose);

/** Every dependency of a project, its dependencies' too, in the config's order. */
function dependenciesOf(name: string, projects: Project[], seen = new Set<string>()): string[] {
	for (const d of projects.find((p) => p.name === name)?.dependencies ?? [])
		if (!seen.has(d)) {
			seen.add(d);
			dependenciesOf(d, projects, seen);
		}
	return projects.map((p) => p.name).filter((n) => seen.has(n));
}

/** The lines the reporter prints, or none when every test ran. */
export function summarize(projects: Project[], rows: Row[]): string[] {
	const missing = rows.filter(didNotRun);
	if (missing.length === 0) return [];
	const lines = [`${missing.length} did not run, and have not passed:`];
	for (const project of projects) {
		const here = missing.filter((r) => r.project === project.name);
		if (here.length === 0) continue;
		const deps = dependenciesOf(project.name, projects);
		const reds = rows.filter((r) => deps.includes(r.project) && r.outcome === 'unexpected');
		if (reds.length > 0) {
			lines.push(
				`  ${project.name}: ${here.length}, because ${reds.length === 1 ? 'a test' : `${reds.length} tests`} it depends on failed:`
			);
			for (const r of reds) lines.push(`    [${r.project}] ${r.where} › ${r.title}`);
		} else {
			lines.push(
				`  ${project.name}: ${here.length}, after a red earlier in the same file (serial, or a failed beforeAll), or the run stopped`
			);
		}
	}
	return lines;
}

export default class NotRunReporter implements Reporter {
	private suite: Suite | undefined;
	private projects: Project[] = [];

	onBegin(config: FullConfig, suite: Suite): void {
		this.suite = suite;
		this.projects = config.projects.map((p) => ({ name: p.name, dependencies: p.dependencies }));
	}

	onEnd(): void {
		// `--list` ends a run in which nothing was meant to run.
		if (process.argv.includes('--list')) return;
		const rows = (this.suite?.allTests() ?? []).map((t: TestCase) => ({
			project: t.parent.project()?.name ?? '',
			where: `${relative(process.cwd(), t.location.file)}:${t.location.line}`,
			title: t.title,
			outcome: t.outcome(),
			ran: t.results.length > 0,
			skippedOnPurpose: t.expectedStatus === 'skipped',
			interrupted: t.results.some((r) => r.status === 'interrupted')
		}));
		const lines = summarize(this.projects, rows);
		if (lines.length > 0) console.log(`\n${lines.join('\n')}\n`);
	}

	printsToStdio(): boolean {
		return true;
	}
}

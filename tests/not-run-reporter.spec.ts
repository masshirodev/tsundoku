import { describe, expect, it } from 'vitest';
import { summarize, type Project, type Row } from './helpers/not-run-reporter';

/**
 * The end-of-run note on tests that did not run: the reds that kept
 * a dependant project out are named, and a test skipped on purpose is not
 * "did not run".
 */

const projects: Project[] = [
	{ name: 'desktop', dependencies: [] },
	{ name: 'tv', dependencies: [] },
	{ name: 'duplicates', dependencies: ['desktop', 'tv'] },
	{ name: 'gate', dependencies: ['duplicates'] }
];

const row = (project: string, title: string, over: Partial<Row> = {}): Row => ({
	project,
	where: `tests/${project}.e2e.ts:1`,
	title,
	outcome: 'expected',
	ran: true,
	skippedOnPurpose: false,
	interrupted: false,
	...over
});
const notRun = { outcome: 'skipped', ran: false } as const;

describe('the did-not-run summary', () => {
	it('says nothing when every test ran or was skipped on purpose', () => {
		expect(
			summarize(projects, [
				row('desktop', 'a'),
				row('tv', 'b', { outcome: 'skipped', ran: true, skippedOnPurpose: true }),
				row('tv', 'c', { outcome: 'unexpected' }),
				row('gate', 'd', { outcome: 'skipped', ran: true, interrupted: true })
			])
		).toEqual([]);
	});

	it('names the reds in every project a dependant waits on, its dependencies’ too', () => {
		expect(
			summarize(projects, [
				row('desktop', 'the bar stays on top', { outcome: 'unexpected' }),
				row('tv', 'fine'),
				row('tv', 'flaky once', { outcome: 'flaky' }),
				row('duplicates', 'one', notRun),
				row('duplicates', 'two', notRun),
				row('gate', 'unlock', notRun)
			])
		).toEqual([
			'3 did not run, and have not passed:',
			'  duplicates: 2, because a test it depends on failed:',
			'    [desktop] tests/desktop.e2e.ts:1 › the bar stays on top',
			'  gate: 1, because a test it depends on failed:',
			'    [desktop] tests/desktop.e2e.ts:1 › the bar stays on top'
		]);
	});

	it('counts a test with a result that was not meant to skip, and names a serial file’s rest', () => {
		expect(
			summarize(projects, [
				row('desktop', 'first', { outcome: 'unexpected' }),
				row('desktop', 'second', { outcome: 'skipped', ran: true }),
				row('tv', 'x', { outcome: 'unexpected' }),
				row('tv', 'y', { outcome: 'unexpected' }),
				row('duplicates', 'one', notRun)
			])
		).toEqual([
			'2 did not run, and have not passed:',
			'  desktop: 1, after a red earlier in the same file (serial, or a failed beforeAll), or the run stopped',
			'  duplicates: 1, because 3 tests it depends on failed:',
			'    [desktop] tests/desktop.e2e.ts:1 › first',
			'    [tv] tests/tv.e2e.ts:1 › x',
			'    [tv] tests/tv.e2e.ts:1 › y'
		]);
	});
});

import { describe, expect, it } from 'vitest';
import {
	countLine,
	firstOpen,
	parseSkipped,
	startView,
	trailDone,
	withSkip,
	type StartFacts
} from '../src/lib/library/start';

/** GET STARTED's steps (doc/ONBOARDING.md; card c208): what ticks them, skips, and the words. */

const none: StartFacts = { repositories: 0, installed: 0, series: 0, phones: 0 };
const states = (f: StartFacts, skipped = parseSkipped('[]')) =>
	startView(f, skipped).steps.map((s) => s.state);

describe('the steps tick by what is there', () => {
	it('a new library: 01, 03 and 04 to do, 02 waits on 01', () => {
		const v = startView(none, []);
		expect(states(none)).toEqual(['todo', 'blocked', 'todo', 'todo']);
		expect(v.steps[1].meta).toBe('After 01 · no repository, so nothing to install');
		expect(v.finished).toBe(false);
		expect(firstOpen(v)).toBe('repo');
	});
	it('each fact ticks its step, and says what it found', () => {
		const f = { repositories: 2, installed: 3, series: 1, phones: 1 };
		const v = startView(f, []);
		expect(v.steps.map((s) => s.meta)).toEqual([
			'Done · 2 repositories',
			'Done · 3 installed',
			'Done · 1 series',
			'Done · a phone or tablet reads here'
		]);
		expect(v.done).toBe(4);
		expect(v.finished).toBe(true);
		expect(firstOpen(v)).toBeNull();
	});
	it('a repository opens 02', () => {
		expect(states({ ...none, repositories: 1 })).toEqual(['done', 'todo', 'todo', 'todo']);
	});
});

describe('SKIP and UNDO', () => {
	it('skipping 01 takes 02 with it, and UNDO on 01 brings both back', () => {
		const skipped = withSkip([], 'repo', true);
		const v = startView(none, skipped);
		expect(v.steps.map((s) => s.state)).toEqual(['skipped', 'skipped', 'todo', 'todo']);
		expect(v.steps[1]).toMatchObject({ meta: 'Skipped with 01', withRepo: true });
		expect(v.skipped).toBe(2);
		expect(states(none, withSkip(skipped, 'repo', false))).toEqual([
			'todo',
			'blocked',
			'todo',
			'todo'
		]);
	});
	it('every step done or skipped finishes the list', () => {
		const v = startView({ ...none, repositories: 1, installed: 1 }, ['library', 'phone']);
		expect(v.finished).toBe(true);
		expect(countLine(v)).toBe('2 OF 4 DONE · 2 SKIPPED');
		expect(countLine(v, true)).toBe('2 OF 4 · 2 SKIPPED');
	});
	it('done wins over a skip kept from before', () => {
		expect(states({ ...none, series: 4 }, ['library'])[2]).toBe('done');
	});
	it('reads what it kept, and nothing broken', () => {
		expect(parseSkipped('["phone","nope","repo"]')).toEqual(['repo', 'phone']);
		for (const bad of ['', '{', '{"a":1}', '"repo"']) expect(parseSkipped(bad)).toEqual([]);
	});
});

describe('the words', () => {
	it('the head counts', () => {
		expect(countLine(startView(none, []))).toBe('0 OF 4 DONE · ANY ORDER');
	});
	it('the way back, once its step ticks', () => {
		const v = startView({ ...none, repositories: 1 }, []);
		expect(trailDone(v, 'repo')).toEqual({
			a: '✓ 01 DONE · A REPOSITORY ADDED',
			b: 'STILL OPEN · 02 INSTALL AN EXTENSION'
		});
		const all = startView({ repositories: 1, installed: 1, series: 1, phones: 1 }, []);
		expect(trailDone(all, 'phone').b).toBe('EVERY STEP DONE OR SKIPPED');
	});
});

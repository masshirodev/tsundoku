import { describe, expect, it } from 'vitest';
import { IGNORE_PATTERNS, syncDecision, targetOf } from '$lib/import/sync';

const idle = (id: string, sequence: number) => ({ id, state: 'idle', needFiles: 0, sequence });

describe('what a synced folder is', () => {
	it('goes by the label the tablet gave it', () => {
		expect(targetOf('Mihon')).toBe('Mihon');
		expect(targetOf('mihon downloads')).toBe('Mihon');
		expect(targetOf('Hentoid')).toBe('Hentoid');
		expect(targetOf('Library')).toBe('Library');
		expect(targetOf('EPUB books')).toBe('Library');
		expect(targetOf('Camera')).toBeNull();
	});
});

describe('when the timer imports', () => {
	it('never while a folder is still receiving', () => {
		const d = syncDecision(
			[idle('a', 5), { id: 'b', state: 'syncing', needFiles: 12, sequence: 9 }],
			{}
		);
		expect(d).toMatchObject({ kind: 'wait' });
		expect(syncDecision([{ ...idle('a', 5), needFiles: 1 }], {})).toMatchObject({ kind: 'wait' });
	});

	it('once something arrived, and not again until more does', () => {
		const first = syncDecision([idle('a', 5), idle('b', 9)], {});
		expect(first).toEqual({ kind: 'import', sequences: { a: 5, b: 9 } });
		expect(syncDecision([idle('a', 5), idle('b', 9)], { a: 5, b: 9 })).toEqual({
			kind: 'unchanged'
		});
		expect(syncDecision([idle('a', 5), idle('b', 10)], { a: 5, b: 9 })).toMatchObject({
			kind: 'import'
		});
	});

	it('says so when nothing is synced into the library', () => {
		expect(syncDecision([], {})).toMatchObject({ kind: 'none' });
	});
});

describe('what never syncs', () => {
	it("keeps Mihon's download folders and CBZs in progress out, since deletes are ignored", () => {
		const globs = IGNORE_PATTERNS.map((p) => p.replace('(?d)', ''));
		const matches = (name: string) =>
			globs.some((g) => new RegExp(`^${g.replace(/\./g, '\\.').replace(/\*/g, '.*')}$`).test(name));
		expect(matches('Ch. 12_tmp')).toBe(true);
		expect(matches('Ch. 12.cbz_tmp')).toBe(true);
		expect(matches('page.part')).toBe(true);
		expect(matches('Ch. 12.cbz')).toBe(false);
		expect(matches('Ch. 12')).toBe(false);
	});
});

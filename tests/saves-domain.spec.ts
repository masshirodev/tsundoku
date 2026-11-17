import { afterEach, describe, expect, it, vi } from 'vitest';
import { saves, type FailedSave } from '../src/lib/saves.svelte';

// The store behind the bands (doc/WAITING.md, "Writes that failed"): a list
// keyed by save, whose callers on the series screen and in the
// reader only ever pass one failure at a time.

const failure = (key: string, over: Partial<FailedSave> = {}): FailedSave => ({
	what: `${key} NOT SAVED`,
	putBackLabel: 'PUT BACK',
	key,
	retry: vi.fn(async () => false),
	putBack: vi.fn(),
	...over
});

/** A retry the test answers by hand, so it can act while it is out. */
function heldRetry() {
	let answer!: (ok: boolean) => void;
	const retry = vi.fn(() => new Promise<boolean>((resolve) => (answer = resolve)));
	return { retry, answer: (ok: boolean) => answer(ok) };
}

const keys = () => saves.failed.map((f) => f.key);

afterEach(() => {
	for (const k of keys()) saves.clear(k);
});

describe('the list of failures', () => {
	it('starts empty, and holds one per key', () => {
		expect(saves.failed).toEqual([]);
		saves.fail(failure('fav:1'));
		saves.fail(failure('rating:1'));
		expect(keys()).toEqual(['fav:1', 'rating:1']);
		expect(saves.unsaved('fav:1')).toBe(true);
		expect(saves.unsaved('rating:1')).toBe(true);
		expect(saves.unsaved('rating:2')).toBe(false);
	});

	it('keeps only the newest of the same key, as the newest in line', () => {
		const old = failure('fav:1', { what: 'OLD' });
		const next = failure('fav:1', { what: 'NEW' });
		saves.fail(old);
		saves.fail(failure('rating:2'));
		saves.fail(next);
		expect(keys()).toEqual(['rating:2', 'fav:1']);
		expect(saves.failed[1]).toBe(next);
	});

	it('never reads one kind of key as another: a cover is not a rating', () => {
		saves.fail(failure('cover:12'));
		expect(saves.unsaved('cover:12')).toBe(true);
		expect(saves.unsaved('rating:12')).toBe(false);
		expect(saves.unsaved('fav:12')).toBe(false);
	});

	it('holds what it was given, so a failure can be known by identity', () => {
		const f = failure('fav:1');
		saves.fail(f);
		expect(saves.failed[0]).toBe(f);
	});
});

describe('retry(key)', () => {
	it('clears only its own failure when it lands', async () => {
		saves.fail(failure('fav:1', { retry: async () => true }));
		saves.fail(failure('fav:2'));
		await saves.retry('fav:1');
		expect(keys()).toEqual(['fav:2']);
	});

	it('leaves the failure when it does not land, and retries nothing else', async () => {
		const other = failure('fav:2');
		saves.fail(failure('fav:1'));
		saves.fail(other);
		await saves.retry('fav:1');
		expect(keys()).toEqual(['fav:1', 'fav:2']);
		expect(other.retry).not.toHaveBeenCalled();
	});

	it('does nothing for a key no failure holds', async () => {
		saves.fail(failure('fav:1'));
		await saves.retry('fav:9');
		expect(keys()).toEqual(['fav:1']);
	});

	it('a retry landing after another key failed keeps that failure', async () => {
		const held = heldRetry();
		saves.fail(failure('fav:1', { retry: held.retry }));
		const out = saves.retry('fav:1');
		saves.fail(failure('fav:2'));
		held.answer(true);
		await out;
		expect(keys()).toEqual(['fav:2']);
	});

	it('clear while its retry is out: the failure stays cleared when it lands', async () => {
		const held = heldRetry();
		saves.fail(failure('fav:1', { retry: held.retry }));
		const out = saves.retry('fav:1');
		saves.clear('fav:1');
		expect(keys()).toEqual([]);
		held.answer(false);
		await out;
		expect(keys()).toEqual([]);
	});

	it('clear, then the same key fails anew while the old retry is out: landing leaves the new one', async () => {
		const held = heldRetry();
		saves.fail(failure('fav:1', { retry: held.retry }));
		const out = saves.retry('fav:1');
		saves.clear('fav:1');
		const fresh = failure('fav:1', { what: 'NEWER' });
		saves.fail(fresh);
		held.answer(true);
		await out;
		expect(saves.failed).toEqual([fresh]);
	});

	it('a newer failure of the same key replaces it while the retry is out, and survives the landing', async () => {
		const held = heldRetry();
		saves.fail(failure('rating:1', { retry: held.retry }));
		const out = saves.retry('rating:1');
		const fresh = failure('rating:1', { what: 'RATING 9' });
		saves.fail(fresh);
		held.answer(true);
		await out;
		expect(saves.failed).toEqual([fresh]);
	});

	it('a second tap while the retry is out does not send it twice', async () => {
		const held = heldRetry();
		saves.fail(failure('fav:1', { retry: held.retry }));
		const first = saves.retry('fav:1');
		await saves.retry('fav:1');
		expect(held.retry).toHaveBeenCalledTimes(1);
		held.answer(true);
		await first;
		expect(keys()).toEqual([]);
	});

	it('a retry that throws lets the next one try, and keeps the failure', async () => {
		let calls = 0;
		const retry = async () => {
			calls++;
			if (calls === 1) throw new Error('lost');
			return true;
		};
		saves.fail(failure('fav:1', { retry }));
		await expect(saves.retry('fav:1')).rejects.toThrow('lost');
		expect(keys()).toEqual(['fav:1']);
		await saves.retry('fav:1');
		expect(calls).toBe(2);
		expect(keys()).toEqual([]);
	});
});

describe('putBack(key)', () => {
	it('puts back only its own failure, and ends only that one', () => {
		const a = failure('fav:1');
		const b = failure('fav:2');
		saves.fail(a);
		saves.fail(b);
		saves.putBack('fav:2');
		expect(b.putBack).toHaveBeenCalledTimes(1);
		expect(a.putBack).not.toHaveBeenCalled();
		expect(keys()).toEqual(['fav:1']);
	});

	it('does nothing for a key no failure holds', () => {
		const a = failure('fav:1');
		saves.fail(a);
		saves.putBack('fav:9');
		expect(a.putBack).not.toHaveBeenCalled();
		expect(keys()).toEqual(['fav:1']);
	});
});

describe('nudge', () => {
	it('tries each failure once, and loses none that does not land', async () => {
		const a = failure('fav:1');
		const b = failure('fav:2', { retry: vi.fn(async () => true) });
		const c = failure('rating:3');
		saves.fail(a);
		saves.fail(b);
		saves.fail(c);
		saves.nudge();
		await vi.waitFor(() => expect(keys()).toEqual(['fav:1', 'rating:3']));
		for (const f of [a, b, c]) expect(f.retry).toHaveBeenCalledTimes(1);
	});

	it('a nudge while one is still out does not double it, and still tries the rest', async () => {
		const held = heldRetry();
		const b = failure('fav:2');
		saves.fail(failure('fav:1', { retry: held.retry }));
		saves.fail(b);
		saves.nudge();
		saves.nudge();
		await vi.waitFor(() => expect(b.retry).toHaveBeenCalledTimes(1));
		expect(held.retry).toHaveBeenCalledTimes(1);
		// One still out, one settled: the next nudge tries the settled one only.
		await new Promise((r) => setTimeout(r, 0));
		saves.nudge();
		await vi.waitFor(() => expect(b.retry).toHaveBeenCalledTimes(2));
		expect(held.retry).toHaveBeenCalledTimes(1);
		held.answer(true);
		await vi.waitFor(() => expect(keys()).toEqual(['fav:2']));
	});

	it('does nothing with nothing held', () => {
		expect(() => saves.nudge()).not.toThrow();
		expect(saves.failed).toEqual([]);
	});
});

describe('clear(key)', () => {
	it('ends only that key', () => {
		saves.fail(failure('fav:1'));
		saves.fail(failure('fav:2'));
		saves.clear('fav:1');
		expect(keys()).toEqual(['fav:2']);
		expect(saves.unsaved('fav:1')).toBe(false);
	});
});

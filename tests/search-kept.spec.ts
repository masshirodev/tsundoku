import { beforeEach, describe, expect, it, vi } from 'vitest';
import { forgetSearches, KEEP_SEARCH_MS, keptSearch } from '../src/lib/server/search-kept';

/** A source that counts its calls and answers `n`, the call's number. */
function source() {
	let calls = 0;
	return {
		ask: vi.fn(async () => ++calls),
		get calls() {
			return calls;
		}
	};
}

describe('a search’s answers, asked once (c1141)', () => {
	beforeEach(forgetSearches);

	it('gives the kept answer to the next load of the same query, without asking again', async () => {
		const s = source();
		expect(await keptSearch('a', 'moon', false, s.ask, 0)).toBe(1);
		expect(await keptSearch('a', 'moon', false, s.ask, 1_000)).toBe(1);
		expect(s.calls).toBe(1);
	});

	it('shares a call still under way: a kind picked while ALL asks waits on ALL’s', async () => {
		const s = source();
		const first = keptSearch('a', 'moon', false, s.ask, 0);
		const second = keptSearch('a', 'moon', false, s.ask, 10);
		expect(await Promise.all([first, second])).toEqual([1, 1]);
		expect(s.calls).toBe(1);
	});

	it('asks each source, and each query, on its own', async () => {
		const s = source();
		await keptSearch('a', 'moon', false, s.ask, 0);
		await keptSearch('b', 'moon', false, s.ask, 0);
		await keptSearch('a', 'sun', false, s.ask, 0);
		expect(s.calls).toBe(3);
	});

	it('asks again once the answer is old', async () => {
		const s = source();
		await keptSearch('a', 'moon', false, s.ask, 0);
		expect(await keptSearch('a', 'moon', false, s.ask, KEEP_SEARCH_MS)).toBe(2);
	});

	it('asks afresh for TRY AGAIN, and keeps that answer', async () => {
		const s = source();
		await keptSearch('a', 'moon', false, s.ask, 0);
		expect(await keptSearch('a', 'moon', true, s.ask, 10)).toBe(2);
		expect(await keptSearch('a', 'moon', false, s.ask, 20)).toBe(2);
		expect(s.calls).toBe(2);
	});

	it('keeps no failure: the next load asks again', async () => {
		const failing = vi.fn(async () => {
			throw new Error('the site did not answer');
		});
		await expect(keptSearch('a', 'moon', false, failing, 0)).rejects.toThrow('did not answer');
		const s = source();
		expect(await keptSearch('a', 'moon', false, s.ask, 10)).toBe(1);
	});

	it('a failure does not take away a fresher answer asked meanwhile', async () => {
		let fail!: (e: Error) => void;
		const slow = () => new Promise<number>((_, reject) => (fail = reject));
		const failed = keptSearch('a', 'moon', false, slow, 0);
		const s = source();
		await keptSearch('a', 'moon', true, s.ask, 10);
		fail(new Error('late'));
		await expect(failed).rejects.toThrow('late');
		expect(await keptSearch('a', 'moon', false, s.ask, 20)).toBe(1);
		expect(s.calls).toBe(1);
	});
});

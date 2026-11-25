/**
 * Concurrent requests' rules never meet (src/lib/fetcher/schedule.ts): ids are
 * unique while held and reused once given back, and requests to the same
 * URL run in turn while others run at once.
 */
import { describe, expect, it } from 'vitest';
import { KeyedQueue, RuleIds } from '../src/lib/fetcher/schedule.ts';

describe('RuleIds', () => {
	it('hands out the smallest free id, unique while held', () => {
		const ids = new RuleIds();
		expect([ids.take(), ids.take(), ids.take()]).toEqual([1, 2, 3]);
		ids.release(2);
		expect(ids.inUse).toBe(2);
		expect(ids.take()).toBe(2);
		expect(ids.take()).toBe(4);
		expect(ids.inUse).toBe(4);
	});
});

/** A task the test finishes by hand. */
function gate<T = void>() {
	let open!: (value: T) => void;
	let fail!: (error: Error) => void;
	const promise = new Promise<T>((resolve, reject) => {
		open = resolve;
		fail = reject;
	});
	return { promise, open, fail };
}

const tick = () => new Promise((r) => setTimeout(r, 0));

describe('KeyedQueue', () => {
	it('runs tasks with one key in turn, and others at once', async () => {
		const queue = new KeyedQueue();
		const log: string[] = [];
		const first = gate();
		const second = gate();
		const other = gate();
		const a1 = queue.run('GET a', async () => {
			log.push('a1 start');
			await first.promise;
			log.push('a1 end');
			return 'a1';
		});
		const a2 = queue.run('GET a', async () => {
			log.push('a2 start');
			await second.promise;
			return 'a2';
		});
		const b = queue.run('GET b', async () => {
			log.push('b start');
			await other.promise;
			return 'b';
		});
		await tick();
		expect(log).toEqual(['a1 start', 'b start']);
		expect(queue.pending).toBe(2);

		first.open();
		await tick();
		expect(log).toEqual(['a1 start', 'b start', 'a1 end', 'a2 start']);
		second.open();
		other.open();
		expect(await Promise.all([a1, a2, b])).toEqual(['a1', 'a2', 'b']);
		await tick();
		expect(queue.pending).toBe(0);
	});

	it('runs the next task after one that failed, and passes the failure on', async () => {
		const queue = new KeyedQueue();
		const failed = queue.run('k', async () => {
			throw new Error('network');
		});
		const next = queue.run('k', async () => 'ran');
		await expect(failed).rejects.toThrow('network');
		expect(await next).toBe('ran');
	});

	it('keeps a key while a later task is still queued on it', async () => {
		const queue = new KeyedQueue();
		const hold = gate();
		void queue.run('k', async () => undefined);
		const later = queue.run('k', () => hold.promise);
		await tick();
		expect(queue.pending).toBe(1);
		hold.open();
		await later;
		await tick();
		expect(queue.pending).toBe(0);
	});
});

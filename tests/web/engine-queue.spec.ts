import { describe, expect, it } from 'vitest';
import { engineQueue, isMedia } from '../../web/engine-queue.js';

/** A request frame as web/engine-frame.js writes one. */
const frame = (path: string) => `GET\nhttp://engine.tsundoku.invalid${path}\nAccept: */*`;

/** A fake Java: records when each call starts and ends, and fails on /boom. */
function fakeJava() {
	const log: string[] = [];
	let inside = 0;
	let most = 0;
	const release: (() => void)[] = [];
	const handle = async (head: string) => {
		const path = new URL(head.split('\n')[1]).pathname;
		inside++;
		most = Math.max(most, inside);
		log.push(`start ${path}`);
		await new Promise<void>((r) => release.push(r));
		inside--;
		log.push(`end ${path}`);
		if (path === '/boom') throw new Error('kaboom');
		return `200 ${path}`;
	};
	/** Lets the running call finish, then lets the queue start the next. */
	const step = async () => {
		release.shift()?.();
		for (let i = 0; i < 5; i++) await Promise.resolve();
	};
	return { handle, log, step, most: () => most };
}

describe('the engine queue', () => {
	it('tells media from pages by the frame’s path', () => {
		expect(isMedia(frame('/image/abc'))).toBe(true);
		expect(isMedia(frame('/video/v?range=1'))).toBe(true);
		expect(isMedia(frame('/dalvik'))).toBe(false);
		expect(isMedia('GET\n/image/relative')).toBe(true);
		expect(isMedia('')).toBe(false);
	});

	// CheerpJ refuses a second call into Java while one runs: "Java code still
	// running, check for a missing 'await'".
	it('runs one call at a time, pages before the covers already waiting', async () => {
		const java = fakeJava();
		const call = engineQueue(java.handle);
		const answers = [
			call(frame('/image/1'), ''),
			call(frame('/image/2'), ''),
			call(frame('/image/3'), ''),
			call(frame('/dalvik'), '')
		];
		for (let i = 0; i < 4; i++) await java.step();
		expect(await Promise.all(answers)).toEqual([
			'200 /image/1',
			'200 /image/2',
			'200 /image/3',
			'200 /dalvik'
		]);
		expect(java.most()).toBe(1);
		// The first cover was already running; the page jumps the two waiting.
		expect(java.log).toEqual([
			'start /image/1',
			'end /image/1',
			'start /dalvik',
			'end /dalvik',
			'start /image/2',
			'end /image/2',
			'start /image/3',
			'end /image/3'
		]);
	});

	it('answers a call that throws with ERR, and carries on', async () => {
		const java = fakeJava();
		const call = engineQueue(java.handle);
		const boom = call(frame('/boom'), '');
		const after = call(frame('/dalvik'), '');
		await java.step();
		await java.step();
		expect(await boom).toBe('ERR kaboom');
		expect(await after).toBe('200 /dalvik');
	});

	it('survives a thrown value whose String() itself throws, as a Java exception can', async () => {
		const call = engineQueue(async () => {
			throw {
				toString() {
					throw new Error('no');
				}
			};
		});
		expect(await call(frame('/dalvik'), '')).toBe('ERR the engine failed');
	});
});

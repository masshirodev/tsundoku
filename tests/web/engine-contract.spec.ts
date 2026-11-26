/**
 * The app's side of tsundoku-engine's browser contract (doc/WEB-EDITION.md,
 * "The engine"; tsundoku-engine's doc/FORK.md, "The browser target"): no
 * FlareSolverr header, bounded video ranges, a fetch's final URL, and the
 * sandbox an extension's JavaScript runs in.
 */
import { describe, expect, it, vi } from 'vitest';
import { decodeAnswer, encodeHead } from '../../web/engine-frame.js';
import { VIDEO_SLICE, engineHeaders } from '../../web/engine-port.js';
import { FINAL_URL, relay } from '../../web/engine-start.js';
import { SANDBOX_SOURCE, scriptSandbox } from '../../web/script-sandbox.js';

describe('headers on the way to the engine', () => {
	it('drops cf-proxy-url, which names a FlareSolverr a tab has not got', () => {
		expect(
			engineHeaders('/dalvik', [
				['cf-proxy-url', 'http://flaresolverr:8191/v1'],
				['authorization', 'Bearer x']
			])
		).toEqual([['authorization', 'Bearer x']]);
	});

	it('leaves a range alone on anything but a video', () => {
		expect(engineHeaders('/image/abc', [['range', 'bytes=0-']])).toEqual([['range', 'bytes=0-']]);
	});

	it('bounds a video: no range, an open one, and one too long', () => {
		const end = VIDEO_SLICE - 1;
		expect(engineHeaders('/video/a', [])).toEqual([['range', `bytes=0-${end}`]]);
		expect(engineHeaders('/video/a', [['Range', 'bytes=100-']])).toEqual([
			['range', `bytes=100-${100 + end}`]
		]);
		expect(engineHeaders('/video/a', [['range', `bytes=0-${VIDEO_SLICE * 4}`]])).toEqual([
			['range', `bytes=0-${end}`]
		]);
	});

	it('keeps a short range and a suffix range as they were asked', () => {
		expect(engineHeaders('/video/a', [['range', 'bytes=10-20']])).toEqual([
			['range', 'bytes=10-20']
		]);
		expect(engineHeaders('/video/a', [['range', 'bytes=-500']])).toEqual([['range', 'bytes=-500']]);
	});
});

describe('a fetch’s final URL', () => {
	const fetched = (url: string) => ({
		fetch: vi.fn(async () => ({
			status: 200,
			headers: [] as [string, string][],
			body: new Uint8Array(),
			url
		}))
	});

	it('is told to the engine when a redirect moved it', async () => {
		const answer = await relay(
			fetched('https://b.example/end'),
			encodeHead('GET', 'https://a.example/', []),
			''
		);
		expect(decodeAnswer(answer)).toMatchObject({ headers: [[FINAL_URL, 'https://b.example/end']] });
	});

	it('is not, when the fetch ended where it started', async () => {
		const answer = await relay(
			fetched('https://a.example/'),
			encodeHead('GET', 'https://a.example/', []),
			''
		);
		expect(decodeAnswer(answer)).toMatchObject({ headers: [] });
	});
});

/** A sandbox worker stood in for: runs the real sandbox source with eval in this scope. */
function fakeSandbox(delay = 0) {
	const made: { terminated: boolean }[] = [];
	const makeWorker = () => {
		const w = {
			terminated: false,
			onmessage: null as ((e: { data: string }) => void) | null,
			onerror: null as ((e: { message?: string }) => void) | null,
			postMessage(script: string) {
				const scope: {
					onmessage?: (e: { data: string }) => void;
					postMessage: (a: string) => void;
				} = {
					postMessage: (a) => setTimeout(() => !w.terminated && w.onmessage?.({ data: a }), delay)
				};
				new Function('self', `with (self) { ${SANDBOX_SOURCE} }; return onmessage;`)(scope)({
					data: script
				});
				void scope;
			},
			terminate() {
				w.terminated = true;
			}
		};
		made.push(w);
		return w;
	};
	return { makeWorker, made };
}

describe('an extension’s JavaScript', () => {
	it('answers a value, undefined as {}, and a throw as an error', async () => {
		const s = scriptSandbox(fakeSandbox());
		expect(JSON.parse(await s.evaluate('[1, 2].map((x) => x * 2)'))).toEqual({ value: [2, 4] });
		expect(JSON.parse(await s.evaluate('void 0'))).toEqual({});
		expect(JSON.parse(await s.evaluate('throw new Error("nope")'))).toEqual({ error: 'nope' });
	});

	it('runs one script at a time, in order, in one worker', async () => {
		const f = fakeSandbox(5);
		const s = scriptSandbox(f);
		const answers = await Promise.all([s.evaluate('1'), s.evaluate('2'), s.evaluate('3')]);
		expect(answers.map((a) => JSON.parse(a).value)).toEqual([1, 2, 3]);
		expect(f.made).toHaveLength(1);
	});

	it('a script past the limit loses its worker, and the next gets a new one', async () => {
		const f = fakeSandbox(50);
		const s = scriptSandbox({ ...f, limitMs: 10 });
		expect(JSON.parse(await s.evaluate('1'))).toEqual({
			error: 'the script ran longer than 0.01 s'
		});
		expect(f.made[0].terminated).toBe(true);
		const t = scriptSandbox({ makeWorker: fakeSandbox().makeWorker });
		expect(JSON.parse(await t.evaluate('2'))).toEqual({ value: 2 });
	});

	it('a worker that errors answers the error', async () => {
		const s = scriptSandbox({
			makeWorker: () => {
				const w = {
					onmessage: null as ((e: { data: string }) => void) | null,
					onerror: null as ((e: { message?: string; preventDefault?: () => void }) => void) | null,
					postMessage: () => setTimeout(() => w.onerror?.({ message: 'blocked' })),
					terminate: () => {}
				};
				return w;
			}
		});
		expect(JSON.parse(await s.evaluate('1'))).toEqual({ error: 'blocked' });
	});
});

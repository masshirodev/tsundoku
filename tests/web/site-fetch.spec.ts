/**
 * Other sites from the web edition's server (web/site-fetch.js): this origin
 * stays the browser's, another site goes through the leading tab's fetcher,
 * and without a fetcher the browser's own fetch is the fallback. The tab and
 * the fetcher are stood in for.
 */
import { describe, expect, it, vi } from 'vitest';
import { decodeHead, encodeAnswer, fromBase64 } from '../../web/engine-frame.js';
import { NO_FETCHER, fetcherConnection, siteFetch } from '../../web/site-fetch.js';

const bytes = (s: string) => new TextEncoder().encode(s);

/** A server worker's site fetch whose tab answers with `answer(head, body)`. */
function worker(answer: (head: string, body: string) => string) {
	const native = vi.fn(async () => new Response('from the browser'));
	const posted: { head: string; body: string }[] = [];
	const s = siteFetch({
		native,
		origin: 'https://tsundoku.test',
		post: (m) => {
			posted.push(m);
			queueMicrotask(() => s.answered({ id: m.id, answer: answer(m.head, m.body) }));
		}
	});
	return { s, native, posted };
}

describe('the server fetching a site', () => {
	it('this origin is the browser’s own fetch, never the tab', async () => {
		const w = worker(() => 'ERR should not be asked');
		expect(await (await w.s.fetch('https://tsundoku.test/server/x.js')).text()).toBe(
			'from the browser'
		);
		expect(w.posted).toHaveLength(0);
	});

	it('another site goes through the tab, the full URL, headers and body in the frame', async () => {
		const w = worker(() => encodeAnswer(200, [['content-type', 'application/json']], bytes('[1]')));
		const res = await w.s.fetch('https://repo.example/index.min.json?v=2', {
			method: 'POST',
			headers: { accept: 'application/json' },
			body: 'q'
		});
		expect(await res.json()).toEqual([1]);
		const { method, url, headers } = decodeHead(w.posted[0].head);
		expect({ method, url }).toEqual({
			method: 'POST',
			url: 'https://repo.example/index.min.json?v=2'
		});
		expect(headers).toContainEqual(['accept', 'application/json']);
		expect(new TextDecoder().decode(fromBase64(w.posted[0].body))).toBe('q');
		expect(w.native).not.toHaveBeenCalled();
	});

	it('no fetcher: the browser’s own fetch after all', async () => {
		const w = worker(() => NO_FETCHER);
		expect(await (await w.s.fetch('https://repo.example/index.min.json')).text()).toBe(
			'from the browser'
		);
		expect(w.native).toHaveBeenCalledOnce();
	});

	it('a failed fetcher request is a failed network, with the fetcher’s words', async () => {
		const w = worker(() => 'ERR network error');
		await expect(w.s.fetch('https://down.example/')).rejects.toThrow(/fetch failed: network error/);
	});

	it('a 304 has no body', async () => {
		const w = worker(() => encodeAnswer(304, [], new Uint8Array(0)));
		const res = await w.s.fetch('https://repo.example/x');
		expect(res.status).toBe(304);
		expect(res.body).toBeNull();
	});

	it('an answer for a request it never sent is ignored', () => {
		const w = worker(() => '');
		expect(() => w.s.answered({ id: 99, answer: 'x' })).not.toThrow();
	});
});

describe('the tab’s one fetcher connection', () => {
	it('connects once, however many ask', async () => {
		const connect = vi.fn(async () => ({ state: 'ready', fetcher: 'f' }));
		const link = fetcherConnection(connect);
		await Promise.all([link.get(), link.get(), link.get()]);
		expect(connect).toHaveBeenCalledOnce();
	});

	it('remembers a missing fetcher until it is asked to retry', async () => {
		let state = 'missing';
		const connect = vi.fn(async () => ({ state }));
		const link = fetcherConnection(connect);
		expect((await link.get()).state).toBe('missing');
		expect((await link.get()).state).toBe('missing');
		expect(connect).toHaveBeenCalledOnce();
		state = 'ready';
		await link.retry();
		expect((await link.get()).state).toBe('ready');
		expect(connect).toHaveBeenCalledTimes(2);
	});

	it('a ready fetcher is kept through a retry', async () => {
		const connect = vi.fn(async () => ({ state: 'ready', fetcher: 'f' }));
		const link = fetcherConnection(connect);
		await link.get();
		await link.retry();
		await link.get();
		expect(connect).toHaveBeenCalledOnce();
	});
});

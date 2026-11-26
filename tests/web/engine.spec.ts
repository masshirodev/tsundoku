/**
 * The web edition's engine plumbing (doc/WEB-EDITION.md, "The engine"): the
 * text frame both crossings speak, the server worker's fetch that sends
 * ENGINE_URL to the engine's worker, and the leading tab starting the engine
 * only once a fetcher answers. The engine itself (Java in CheerpJ) is stood in
 * for; tsundoku-engine tests its side, and `yarn run test:web` the whole chain.
 */
import { describe, expect, it, vi } from 'vitest';
import {
	decodeAnswer,
	decodeHead,
	encodeAnswer,
	encodeHead,
	fromBase64,
	toBase64
} from '../../web/engine-frame.js';
import { ENGINE_ORIGIN, enginePort } from '../../web/engine-port.js';
import { ENGINE_JAR, engineStarter, relay } from '../../web/engine-start.js';
import { timings } from '../../web/timing.js';

const bytes = (s: string) => new TextEncoder().encode(s);
const text = (b: Uint8Array) => new TextDecoder().decode(b);

describe('the frame', () => {
	it('carries a request head and an answer both ways, bodies exact', () => {
		const head = encodeHead('POST', '/dalvik', [
			['content-type', 'application/json'],
			['authorization', 'Bearer x: y']
		]);
		expect(decodeHead(head)).toEqual({
			method: 'POST',
			url: '/dalvik',
			headers: [
				['content-type', 'application/json'],
				['authorization', 'Bearer x: y']
			]
		});
		const all = new Uint8Array(256).map((_, i) => i);
		const back = decodeAnswer(encodeAnswer(201, [['x-a', '1']], all));
		expect(back).toEqual({ status: 201, headers: [['x-a', '1']], body: all });
	});

	it('an answer with no headers and no body', () => {
		expect(decodeAnswer(encodeAnswer(204, [], new Uint8Array(0)))).toEqual({
			status: 204,
			headers: [],
			body: new Uint8Array(0)
		});
	});

	it('ERR, and anything that is not a frame, is an error with its words', () => {
		expect(decodeAnswer('ERR the site did not answer')).toEqual({
			error: 'the site did not answer'
		});
		expect(decodeAnswer('garbage')).toMatchObject({ error: /not an engine answer/ });
		expect(decodeAnswer('abc\n\n')).toMatchObject({ error: /not an engine status/ });
	});

	it('base64 of a body larger than one argument list', () => {
		const big = new Uint8Array(200_000).map((_, i) => i % 251);
		expect(fromBase64(toBase64(big))).toEqual(big);
	});
});

/** An engine worker stood in for: answers each request with `answer(head)`. */
function fakeEngine(answer: (head: string, body: string) => string) {
	const { port1, port2 } = new MessageChannel();
	const seen: { head: string; body: string }[] = [];
	port2.onmessage = ({ data }) => {
		seen.push({ head: data.head, body: data.body });
		port2.postMessage({ id: data.id, answer: answer(data.head, data.body) });
	};
	return { port: port1, seen, close: () => port2.close() };
}

describe('ENGINE_URL in the server worker', () => {
	it('leaves every other origin to the browser’s fetch', async () => {
		const browser = vi.fn(async () => new Response('site'));
		const e = enginePort(browser);
		expect(await (await e.fetch('https://example.org/x')).text()).toBe('site');
		expect(browser).toHaveBeenCalledOnce();
	});

	it('off: a call fails at once, as an engine that is down does', async () => {
		const e = enginePort(fetch);
		await expect(e.fetch(`${ENGINE_ORIGIN}/capabilities`)).rejects.toThrow(/engine is off/);
	});

	it('ready: the request crosses as a frame and the answer comes back a Response', async () => {
		const engine = fakeEngine(() =>
			encodeAnswer(200, [['content-type', 'application/json']], bytes('{"ok":1}'))
		);
		const e = enginePort(fetch);
		e.set({ state: 'ready' }, engine.port);
		const res = await e.fetch(`${ENGINE_ORIGIN}/dalvik?x=1`, {
			method: 'POST',
			headers: { authorization: 'Bearer t' },
			body: '{"method":"popular"}'
		});
		expect(res.status).toBe(200);
		expect(await res.json()).toEqual({ ok: 1 });
		const { head, body } = engine.seen[0];
		expect(decodeHead(head)).toMatchObject({ method: 'POST', url: '/dalvik?x=1' });
		expect(decodeHead(head).headers).toContainEqual(['authorization', 'Bearer t']);
		expect(text(fromBase64(body))).toBe('{"method":"popular"}');
		engine.close();
	});

	it('starting: a call waits, and goes once the engine is ready', async () => {
		const engine = fakeEngine(() => encodeAnswer(200, [], bytes('hi')));
		const e = enginePort(fetch);
		e.set({ state: 'starting' }, engine.port);
		const call = e.fetch(`${ENGINE_ORIGIN}/capabilities`);
		await new Promise((r) => setTimeout(r, 20));
		expect(engine.seen).toHaveLength(0);
		e.set({ state: 'ready' });
		expect(await (await call).text()).toBe('hi');
		engine.close();
	});

	it('starting too long, or failing, fails the waiting call', async () => {
		const e = enginePort(fetch, { waitMs: 30 });
		e.set({ state: 'starting' }, new MessageChannel().port1);
		await expect(e.fetch(`${ENGINE_ORIGIN}/x`)).rejects.toThrow(/engine is starting/);
		const f = enginePort(fetch);
		f.set({ state: 'starting' }, new MessageChannel().port1);
		const call = f.fetch(`${ENGINE_ORIGIN}/x`);
		f.set({ state: 'failed', why: 'no memory' });
		await expect(call).rejects.toThrow(/engine is failed \(no memory\)/);
	});

	it('an engine that stops answers its calls in flight with an error', async () => {
		const { port1 } = new MessageChannel(); // nobody answers
		const e = enginePort(fetch);
		e.set({ state: 'ready' }, port1);
		const call = e.fetch(`${ENGINE_ORIGIN}/x`);
		await new Promise((r) => setTimeout(r, 10));
		e.set({ state: 'off', why: 'the tab closed' });
		await expect(call).rejects.toThrow(/the engine stopped: the tab closed/);
	});

	it('an ERR from the engine is a failed fetch; a 204 has no body', async () => {
		const engine = fakeEngine((head) =>
			decodeHead(head).url === '/a' ? 'ERR boom' : encodeAnswer(204, [], new Uint8Array(0))
		);
		const e = enginePort(fetch);
		e.set({ state: 'ready' }, engine.port);
		await expect(e.fetch(`${ENGINE_ORIGIN}/a`)).rejects.toThrow(/boom/);
		expect((await e.fetch(`${ENGINE_ORIGIN}/b`)).status).toBe(204);
		expect(e.state).toBe('ready');
		engine.close();
	});
});

/** A server worker and an engine worker, stood in for. */
function tab(
	connection: () => Promise<unknown>,
	{ jar = true, timing }: { jar?: boolean; timing?: ReturnType<typeof timings> } = {}
) {
	const toServer: { message: Record<string, unknown>; ports: number }[] = [];
	const toWorker: Record<string, unknown>[] = [];
	const worker = {
		onmessage: null as ((e: { data: unknown }) => void) | null,
		postMessage: (m: Record<string, unknown>) => void toWorker.push(m),
		terminate: vi.fn()
	};
	const makeWorker = vi.fn(() => worker);
	const starter = engineStarter({
		server: {
			postMessage: (message, transfer) =>
				void toServer.push({
					message: message as Record<string, unknown>,
					ports: transfer?.length ?? 0
				})
		},
		connect: connection as never,
		makeWorker,
		hasJar: async () => jar,
		origin: ENGINE_ORIGIN,
		timing,
		now: () => 1000
	});
	const fromWorker = (data: unknown) => worker.onmessage?.({ data });
	return { starter, toServer, toWorker, worker, makeWorker, fromWorker };
}

const fetcherAnswering = (r: {
	status: number;
	headers: [string, string][];
	body: Uint8Array;
}) => ({
	fetch: vi.fn(async () => r)
});

describe('starting the engine from the tab', () => {
	it('no jar in this build: off, and no worker', async () => {
		const t = tab(
			async () => ({
				state: 'ready',
				fetcher: fetcherAnswering({ status: 200, headers: [], body: new Uint8Array() })
			}),
			{ jar: false }
		);
		await t.starter.attempt();
		expect(t.toServer[0].message).toMatchObject({ state: 'off', why: 'no engine in this build' });
		expect(t.makeWorker).not.toHaveBeenCalled();
	});

	it('no fetcher: off, saying which, and tried again later', async () => {
		let state = 'missing';
		const fetcher = fetcherAnswering({ status: 200, headers: [], body: new Uint8Array() });
		const t = tab(async () => (state === 'ready' ? { state, fetcher } : { state }));
		await t.starter.attempt();
		expect(t.toServer[0].message).toMatchObject({ state: 'off', why: 'the fetcher is missing' });
		expect(t.starter.started).toBe(false);
		state = 'ready';
		await t.starter.attempt();
		expect(t.starter.started).toBe(true);
	});

	it('a fetcher: the server gets a port and `starting`, the worker the jar and the other port', async () => {
		const t = tab(async () => ({
			state: 'ready',
			fetcher: fetcherAnswering({ status: 200, headers: [], body: new Uint8Array() })
		}));
		await t.starter.attempt();
		expect(t.toServer[0]).toMatchObject({
			message: { type: 'tsundoku-engine', state: 'starting' },
			ports: 1
		});
		expect(t.toWorker[0]).toMatchObject({
			type: 'engine-start',
			jar: ENGINE_JAR,
			origin: ENGINE_ORIGIN
		});
		// Started once: another attempt (a focus) does nothing.
		await t.starter.attempt();
		expect(t.makeWorker).toHaveBeenCalledOnce();

		t.fromWorker({ type: 'engine-state', state: 'ready', steps: { started: 7000 } });
		expect(t.toServer.at(-1)?.message).toEqual({
			type: 'tsundoku-engine',
			state: 'ready',
			steps: { started: 7000 }
		});
	});

	it('a failed start ends the worker, and the next attempt starts a new one', async () => {
		const t = tab(async () => ({
			state: 'ready',
			fetcher: fetcherAnswering({ status: 200, headers: [], body: new Uint8Array() })
		}));
		await t.starter.attempt();
		t.fromWorker({ type: 'engine-state', state: 'failed', why: 'out of memory' });
		expect(t.worker.terminate).toHaveBeenCalled();
		expect(t.toServer.at(-1)?.message).toMatchObject({ state: 'failed', why: 'out of memory' });
		await t.starter.attempt();
		expect(t.makeWorker).toHaveBeenCalledTimes(2);
	});

	it('the engine’s web requests go through the fetcher and come back as frames', async () => {
		const fetcher = fetcherAnswering({
			status: 200,
			headers: [['content-type', 'text/html']],
			body: bytes('<p>hi</p>')
		});
		const t = tab(async () => ({ state: 'ready', fetcher }));
		await t.starter.attempt();
		t.fromWorker({
			type: 'engine-fetch',
			id: 7,
			head: encodeHead('POST', 'https://example.org/api', [['referer', 'https://example.org/']]),
			body: toBase64(bytes('q=1'))
		});
		await vi.waitFor(() => expect(t.toWorker).toHaveLength(2));
		expect(fetcher.fetch).toHaveBeenCalledWith({
			url: 'https://example.org/api',
			method: 'POST',
			headers: [['referer', 'https://example.org/']],
			body: bytes('q=1')
		});
		const reply = t.toWorker[1] as { type: string; id: number; answer: string };
		expect(reply).toMatchObject({ type: 'engine-fetched', id: 7 });
		const back = decodeAnswer(reply.answer);
		expect(back).toMatchObject({ status: 200, headers: [['content-type', 'text/html']] });
		expect(text((back as { body: Uint8Array }).body)).toBe('<p>hi</p>');
	});
});

describe('the timing log (web/timing.js)', () => {
	const fetchOnce = async (timing?: ReturnType<typeof timings>) => {
		const fetcher = fetcherAnswering({ status: 200, headers: [], body: bytes('abcdef') });
		const t = tab(async () => ({ state: 'ready', fetcher }), { timing });
		await t.starter.attempt();
		t.fromWorker({
			type: 'engine-fetch',
			id: 1,
			head: encodeHead('GET', 'https://example.org/list?token=secret', []),
			body: ''
		});
		await vi.waitFor(() => expect(t.toWorker).toHaveLength(2));
		t.fromWorker({
			type: 'engine-timing',
			timing: { kind: 'call', path: '/dalvik', waited: 3, ran: 40 }
		});
		return t;
	};

	it('records each site fetch and each engine call when on, never a query', async () => {
		const timing = timings({ on: true, now: () => 5 });
		const t = await fetchOnce(timing);
		expect(t.toWorker[0]).toMatchObject({ type: 'engine-start', timing: true });
		expect(timing.log).toEqual([
			{ kind: 'site', host: 'example.org', path: '/list', ms: 0, status: 200, bytes: 6, at: 5 },
			{ kind: 'call', path: '/dalvik', waited: 3, ran: 40, at: 5 }
		]);
	});

	it('records nothing, and tells the engine nothing, when off', async () => {
		const timing = timings({ on: false });
		const t = await fetchOnce(timing);
		expect(t.toWorker[0]).toMatchObject({ type: 'engine-start', timing: false });
		expect(timing.log).toEqual([]);
	});
});

describe('one web request of the engine’s', () => {
	it('a fetcher that fails answers ERR, which Java turns into a failed network', async () => {
		const fetcher = { fetch: async () => Promise.reject(new Error('network error')) };
		expect(await relay(fetcher, encodeHead('GET', 'https://example.org/', []), '')).toBe(
			'ERR network error'
		);
	});

	it('a GET sends no body', async () => {
		const fetcher = fetcherAnswering({ status: 200, headers: [], body: new Uint8Array() });
		await relay(fetcher, encodeHead('GET', 'https://example.org/', []), '');
		expect(fetcher.fetch).toHaveBeenCalledWith(expect.objectContaining({ body: null }));
	});
});

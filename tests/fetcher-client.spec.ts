/**
 * The page and the fetcher shake hands and talk (src/lib/web/fetcher-client.ts
 * and src/lib/fetcher/relay.ts): the real client, the real relay and the real
 * background service, on a fake window and a fake browser, with the runtime
 * message crossing done as each browser does it (a structured clone in
 * Firefox, JSON in Chromium).
 */
import { describe, expect, it } from 'vitest';
import { FETCHER_CHANNEL } from '../src/lib/fetcher/protocol.ts';
import { startRelay, type MessageWindow } from '../src/lib/fetcher/relay.ts';
import { parseSuffixList } from '../src/lib/fetcher/psl.ts';
import { createFetcherService, type RuntimeReply } from '../src/lib/fetcher/service.ts';
import { connectFetcher } from '../src/lib/web/fetcher-client.ts';

type Listener = (event: MessageEvent) => void;

/** A window whose postMessage reaches its own listeners later, cloned, as a browser's does. */
function fakeWindow(origin = 'https://tsundoku.lt') {
	const listeners = new Set<Listener>();
	const posted: unknown[] = [];
	const win: MessageWindow & { posted: unknown[]; listeners: Set<Listener> } = {
		location: { origin },
		posted,
		listeners,
		postMessage(message, targetOrigin, transfer = []) {
			expect(targetOrigin).toBe(origin);
			posted.push(message);
			const data = structuredClone(message, { transfer });
			setTimeout(() => {
				for (const listener of [...listeners]) {
					listener({ data, source: win, origin } as unknown as MessageEvent);
				}
			}, 0);
		},
		addEventListener: (_, listener) => listeners.add(listener),
		removeEventListener: (_, listener) => listeners.delete(listener)
	};
	return win;
}

/** Delivers a message to the window's listeners as if from someone else. */
function deliver(win: ReturnType<typeof fakeWindow>, data: unknown, from = {}) {
	for (const listener of [...win.listeners]) {
		listener({
			data,
			source: win,
			origin: win.location.origin,
			...from
		} as unknown as MessageEvent);
	}
}

const crossings = {
	firefox: <T>(value: T): T => structuredClone(value),
	chromium: <T>(value: T): T => (value === undefined ? value : JSON.parse(JSON.stringify(value)))
};

/** The extension on a fake browser whose network answers with what it was sent. */
function extension(browser: keyof typeof crossings, win = fakeWindow()) {
	const cross = crossings[browser];
	const service = createFetcherService({
		extensionId: 'ext',
		suffixes: () => parseSuffixList('example'),
		getCookies: async () => [],
		addRule: async () => undefined,
		removeRule: async () => undefined,
		clearRules: async () => undefined,
		async fetch(url, init) {
			if (url.includes('down'))
				throw new TypeError('NetworkError when attempting to fetch resource.');
			const body = init.body ? new Uint8Array(init.body as Uint8Array) : new Uint8Array([7, 8, 9]);
			return new Response(body, { status: 200, headers: { 'x-url': url } });
		}
	});
	const sender = { id: 'ext', tab: {}, frameId: 0, url: `${win.location.origin}/library` };
	const relay = startRelay({
		win,
		version: '0.1.0',
		send: async (message) => cross(await service.answer(cross(message), sender)!)
	});
	return { win, relay };
}

describe('the handshake', () => {
	it.each(['firefox', 'chromium'] as const)(
		'connects in %s and learns how bytes cross there',
		async (browser) => {
			const { win } = extension(browser);
			const connection = await connectFetcher(win);
			expect(connection.state).toBe('ready');
			if (connection.state !== 'ready') return;
			expect(connection.fetcher).toMatchObject({
				protocol: 1,
				version: '0.1.0',
				transport: browser === 'firefox' ? 'binary' : 'base64'
			});
			connection.fetcher.close();
		}
	);

	it('says missing when nothing answers', async () => {
		const connection = await connectFetcher(fakeWindow(), { timeoutMs: 20 });
		expect(connection).toEqual({ state: 'missing' });
	});

	it('says missing on an origin the fetcher does not serve', async () => {
		const win = fakeWindow('https://example.com');
		const { relay } = extension('firefox', win);
		expect(relay).toBeNull();
		expect(await connectFetcher(win, { timeoutMs: 20 })).toEqual({ state: 'missing' });
		expect(win.posted.every((m) => (m as { from: string }).from === 'page')).toBe(true);
	});

	it.each([
		[0, 'too-old'],
		[2, 'too-new']
	])('refuses a fetcher on protocol %i as %s', async (protocol, state) => {
		const win = fakeWindow();
		const pending = connectFetcher(win);
		deliver(win, {
			channel: FETCHER_CHANNEL,
			from: 'fetcher',
			kind: 'hello',
			protocol,
			version: '9.9.9',
			transport: 'base64'
		});
		expect(await pending).toEqual({ state, protocol, version: '9.9.9' });
		expect(win.listeners.size).toBe(0);
	});

	it('hears only hellos from its own window and origin, and only the first', async () => {
		const win = fakeWindow();
		const pending = connectFetcher(win);
		const hello = (version: string) => ({
			channel: FETCHER_CHANNEL,
			from: 'fetcher',
			kind: 'hello',
			protocol: 1,
			version,
			transport: 'binary'
		});
		deliver(win, hello('from a frame'), { source: {} });
		deliver(win, hello('from elsewhere'), { origin: 'https://example.com' });
		deliver(win, { channel: 'another', from: 'fetcher', kind: 'hello' });
		deliver(win, hello('the one'));
		deliver(win, hello('a second'));
		const connection = await pending;
		expect(connection.state === 'ready' && connection.fetcher.version).toBe('the one');
	});

	it('answers a page that connects after the fetcher started', async () => {
		const { win } = extension('firefox');
		await new Promise((r) => setTimeout(r, 10));
		expect((await connectFetcher(win)).state).toBe('ready');
	});
});

describe('requests', () => {
	it.each(['firefox', 'chromium'] as const)(
		'carry bytes both ways intact in %s',
		async (browser) => {
			const { win } = extension(browser);
			const connection = await connectFetcher(win);
			if (connection.state !== 'ready') throw new Error(connection.state);
			const every = Uint8Array.from({ length: 256 }, (_, i) => i);
			const [posted, plain] = await Promise.all([
				connection.fetcher.fetch({ url: 'https://source.example/up', method: 'PUT', body: every }),
				connection.fetcher.fetch({ url: 'https://source.example/plain', headers: [] })
			]);
			expect(posted.status).toBe(200);
			expect(posted.headers).toEqual([['x-url', 'https://source.example/up']]);
			expect(posted.body).toEqual(every);
			// The page's own array is not taken from it.
			expect(every.length).toBe(256);
			expect(plain.body).toEqual(new Uint8Array([7, 8, 9]));
		}
	);

	it('reject with the fetcher’s words', async () => {
		const { win } = extension('chromium');
		const connection = await connectFetcher(win);
		if (connection.state !== 'ready') throw new Error(connection.state);
		await expect(connection.fetcher.fetch({ url: 'https://source.example/down' })).rejects.toThrow(
			'network error: NetworkError when attempting to fetch resource.'
		);
		await expect(connection.fetcher.fetch({ url: 'ftp://source.example/' })).rejects.toThrow(
			'only http and https are fetched, not ftp:'
		);
	});

	it('are rejected when the client closes', async () => {
		const win = fakeWindow();
		const pending = connectFetcher(win);
		deliver(win, {
			channel: FETCHER_CHANNEL,
			from: 'fetcher',
			kind: 'hello',
			protocol: 1,
			version: '0.1.0',
			transport: 'binary'
		});
		const connection = await pending;
		if (connection.state !== 'ready') throw new Error(connection.state);
		const request = connection.fetcher.fetch({ url: 'https://source.example/' });
		connection.fetcher.close();
		await expect(request).rejects.toThrow('the fetcher was closed');
		expect(win.listeners.size).toBe(0);
	});

	it('ignore answers to other clients’ requests', async () => {
		const { win } = extension('firefox');
		const connection = await connectFetcher(win);
		if (connection.state !== 'ready') throw new Error(connection.state);
		deliver(win, {
			channel: FETCHER_CHANNEL,
			from: 'fetcher',
			kind: 'error',
			id: 'someone-else:0',
			message: 'not yours'
		});
		const response = await connection.fetcher.fetch({ url: 'https://source.example/' });
		expect(response.status).toBe(200);
	});
});

describe('the relay', () => {
	function relayWith(send: (message: unknown) => Promise<RuntimeReply | undefined>) {
		const win = fakeWindow();
		const relay = startRelay({ win, version: '0.1.0', send });
		return { win, relay: relay! };
	}

	it('falls back to base64 when the background does not answer the probe', async () => {
		const { relay } = relayWith(() => Promise.reject(new Error('Receiving end does not exist.')));
		expect(await relay.transport).toBe('base64');
	});

	it('tells the page when the background gives no answer', async () => {
		const { win } = relayWith(async () => undefined);
		const connection = await connectFetcher(win);
		if (connection.state !== 'ready') throw new Error(connection.state);
		await expect(connection.fetcher.fetch({ url: 'https://source.example/' })).rejects.toThrow(
			'the fetcher gave no answer'
		);
	});

	it('passes on a failure that is not an Error', async () => {
		const { win } = relayWith(async (message) => {
			if ((message as { kind: string }).kind === 'probe') return undefined;
			throw 'gone';
		});
		const connection = await connectFetcher(win);
		if (connection.state !== 'ready') throw new Error(connection.state);
		await expect(connection.fetcher.fetch({ url: 'https://source.example/' })).rejects.toThrow(
			'gone'
		);
	});

	it('ignores a request it cannot read, and stops when told', async () => {
		const sent: unknown[] = [];
		const { win, relay } = relayWith(async (message) => {
			sent.push(message);
			return undefined;
		});
		deliver(win, { channel: FETCHER_CHANNEL, from: 'page', kind: 'request', request: {} });
		deliver(win, { channel: FETCHER_CHANNEL, from: 'page', kind: 'request', id: 'x' });
		deliver(win, { channel: FETCHER_CHANNEL, from: 'page', kind: 'ping' }, { source: {} });
		await new Promise((r) => setTimeout(r, 10));
		expect(sent).toEqual([{ kind: 'probe', bytes: expect.any(Uint8Array) }]);
		relay.stop();
		expect(win.listeners.size).toBe(0);
	});
});

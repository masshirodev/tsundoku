import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createServer, type IncomingMessage, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import {
	call,
	engineDownSince,
	EngineError,
	fetchProxied,
	handleOf,
	load,
	type Extension
} from '$lib/server/engine/client';
import {
	BRIDGE_CONTEXT,
	failureOf,
	imageType,
	joinMemo,
	preferenceSnapshot,
	proxyUrl,
	splitMemo,
	USER_AGENT
} from '$lib/server/engine/protocol';

// A fake engine: answers /dalvik and /image/ as the real one does
// (doc/EXTENSION-ENGINE.md, "API reference"), and records what it was sent.

type Seen = {
	path: string;
	headers: IncomingMessage['headers'];
	body: Record<string, unknown> | null;
};
let seen: Seen[] = [];
let loaded = new Set<string>();
let reply: (body: Record<string, unknown>) => {
	status: number;
	json: unknown;
	delay?: number;
} = () => ({
	status: 200,
	json: {}
});
const inFlight = new Map<string, number>();
/** When each call into an extension was in flight, by handle. */
const spans = new Map<string, [number, number][]>();
const maxInFlight = new Map<string, number>();

let server: Server;
let url = '';

beforeAll(async () => {
	server = createServer((req, res) => {
		let raw = '';
		req.on('data', (c) => (raw += c));
		req.on('end', async () => {
			const body = raw ? (JSON.parse(raw) as Record<string, unknown>) : null;
			seen.push({ path: req.url ?? '', headers: req.headers, body });
			if (req.url?.startsWith('/image/')) {
				if (req.url === '/image/gone') {
					res.writeHead(404).end('Image not found');
					return;
				}
				res
					.writeHead(200, { 'content-type': 'image/png' })
					.end(Buffer.from([0xff, 0xd8, 0xff, 0xe0]));
				return;
			}
			const data = body?.data as string | undefined;
			const handle = data ? handleOf(Buffer.from(data, 'base64')) : (body?.extensionId as string);
			if (data) loaded.add(handle);
			if (!loaded.has(handle)) {
				res.writeHead(409, { 'content-type': 'application/json' });
				res.end(
					JSON.stringify({
						error: `Extension handle ${handle} is no longer loaded; resend the APK`,
						code: 409
					})
				);
				return;
			}
			const n = (inFlight.get(handle) ?? 0) + 1;
			inFlight.set(handle, n);
			maxInFlight.set(handle, Math.max(maxInFlight.get(handle) ?? 0, n));
			const r = reply(body ?? {});
			const start = performance.now();
			await new Promise((ok) => setTimeout(ok, r.delay ?? 0));
			spans.set(handle, [...(spans.get(handle) ?? []), [start, performance.now()]]);
			inFlight.set(handle, (inFlight.get(handle) ?? 1) - 1);
			res.writeHead(r.status, {
				'content-type': 'application/json',
				'x-mangayomi-extension-id': handle
			});
			res.end(JSON.stringify(r.json));
		});
	});
	await new Promise<void>((ok) => server.listen(0, '127.0.0.1', ok));
	url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
	process.env.ENGINE_URL = url;
	process.env.ENGINE_TOKEN = 's3cret';
});

afterAll(async () => {
	await new Promise((ok) => server.close(ok));
	delete process.env.ENGINE_URL;
	delete process.env.ENGINE_TOKEN;
});

beforeEach(() => {
	seen = [];
	loaded = new Set();
	inFlight.clear();
	maxInFlight.clear();
	spans.clear();
	reply = () => ({ status: 200, json: { mangas: [], hasNextPage: false } });
});

const apkA = Buffer.from('extension A');
const apkB = Buffer.from('extension B');
const ext = (apk: Buffer): Extension => ({ handle: handleOf(apk), apk: async () => apk });

describe('a call', () => {
	it('carries the token, a browser User-Agent, the solver and tsundoku’s preferences', async () => {
		loaded.add(handleOf(apkA));
		const prefs = [{ key: 'lang', listPreference: { valueIndex: 1, entryValues: ['en', 'ja'] } }];
		await call(ext(apkA), 'getPopularManga', { page: 1 }, { sourceId: '42', preferences: prefs });

		const [s] = seen;
		expect(s.headers.authorization).toBe('Bearer s3cret');
		expect(s.headers['user-agent']).toBe(USER_AGENT);
		expect(s.headers['cf-proxy-url']).toBe('http://flaresolverr:8191/v1');
		expect(s.body).toMatchObject({
			method: 'getPopularManga',
			page: 1,
			sourceId: '42',
			extensionId: handleOf(apkA)
		});
		expect(s.body!.data).toBeUndefined();
		expect(s.body!.preferences).toEqual([
			...prefs,
			{ key: BRIDGE_CONTEXT, preferenceApplyMode: 'replace-present' }
		]);
	});

	it('sends the APK once when the engine doesn’t have it, then not again', async () => {
		await call(ext(apkA), 'getPopularManga', { page: 1 }, { sourceId: '42' });
		await call(ext(apkA), 'getPopularManga', { page: 2 }, { sourceId: '42' });

		expect(seen.map((s) => !!s.body!.data)).toEqual([false, true, false]);
	});

	it('refuses an APK that isn’t the handle’s', async () => {
		const wrong: Extension = { handle: handleOf(apkA), apk: async () => apkB };
		await expect(call(wrong, 'getPopularManga', {}, { sourceId: '42' })).rejects.toMatchObject({
			failure: 'not-loaded'
		});
	});

	// The engine serialises calls into one extension; queueing them here keeps
	// the order tsundoku's, and another extension never waits behind them.
	it('runs one call at a time per extension, and extensions side by side', async () => {
		loaded.add(handleOf(apkA));
		loaded.add(handleOf(apkB));
		reply = () => ({ status: 200, json: {}, delay: 40 });
		await Promise.all([
			...[1, 2, 3].map((page) => call(ext(apkA), 'getPopularManga', { page }, { sourceId: '1' })),
			...[1, 2, 3].map((page) => call(ext(apkB), 'getPopularManga', { page }, { sourceId: '2' }))
		]);

		expect(maxInFlight.get(handleOf(apkA))).toBe(1);
		expect(maxInFlight.get(handleOf(apkB))).toBe(1);
		expect(
			seen.filter((s) => s.body?.extensionId === handleOf(apkA)).map((s) => s.body!.page)
		).toEqual([1, 2, 3]);
		// Side by side: some call into B was in flight while one into A was. By
		// overlap, not by the clock, which a busy machine stretches.
		const a = spans.get(handleOf(apkA))!;
		const b = spans.get(handleOf(apkB))!;
		expect(a.some(([s1, e1]) => b.some(([s2, e2]) => s1 < e2 && s2 < e1))).toBe(true);
	});

	it('keeps the lane moving after a call fails', async () => {
		loaded.add(handleOf(apkA));
		reply = (b) =>
			b.page === 1
				? { status: 500, json: { error: 'boom', code: 500 } }
				: { status: 200, json: { ok: 1 } };
		await expect(
			call(ext(apkA), 'getPopularManga', { page: 1 }, { sourceId: '1' })
		).rejects.toBeInstanceOf(EngineError);
		await expect(
			call(ext(apkA), 'getPopularManga', { page: 2 }, { sourceId: '1' })
		).resolves.toEqual({ ok: 1 });
	});
});

describe('what a failure means', () => {
	it('reads the site’s status from the body, since a 429 arrives as a 500', async () => {
		loaded.add(handleOf(apkA));
		reply = () => ({ status: 500, json: { error: 'HTTP 429', code: 429 } });
		await expect(call(ext(apkA), 'getPopularManga', {}, { sourceId: '1' })).rejects.toMatchObject({
			failure: 'rate-limited',
			message: 'HTTP 429'
		});
		expect(failureOf(403, { code: 403 })).toBe('refused');
		expect(failureOf(404, { code: 404 })).toBe('not-found');
		expect(failureOf(401, null)).toBe('unauthorized');
		expect(failureOf(500, { code: 500 })).toBe('source');
		expect(failureOf(500, 'not json')).toBe('source');
	});

	it('says since when the engine stopped answering, and forgets once it answers', async () => {
		const real = process.env.ENGINE_URL;
		process.env.ENGINE_URL = 'http://127.0.0.1:9';
		await expect(call(ext(apkA), 'getPopularManga', {}, { sourceId: '1' })).rejects.toMatchObject({
			failure: 'down'
		});
		expect(engineDownSince()).toBeTypeOf('number');
		process.env.ENGINE_URL = real;
		loaded.add(handleOf(apkA));
		await call(ext(apkA), 'getPopularManga', {}, { sourceId: '1' });
		expect(engineDownSince()).toBeNull();
	});
});

describe('loading an extension', () => {
	it('sends the APK and gets its handle and what it is', async () => {
		reply = () => ({ status: 200, json: { name: 'Example', sources: [] } });
		const { handle, info } = await load<{ name: string }>(apkA);
		expect(handle).toBe(handleOf(apkA));
		expect(info.name).toBe('Example');
		expect(seen[0].body).toMatchObject({ method: 'extensionInfo' });
		expect(seen[0].body!.data).toBe(apkA.toString('base64'));
	});
});

describe('pages through the engine', () => {
	it('fetches from the engine’s own address, with the token', async () => {
		const got = await fetchProxied('http://127.0.0.1:8080/image/abc123');
		expect(seen[0].path).toBe('/image/abc123');
		expect(seen[0].headers.authorization).toBe('Bearer s3cret');
		// Labelled PNG, really a JPEG: the bytes are what count.
		expect(got.type).toBe('image/png');
		expect(imageType(got.bytes)).toBe('jpg');
	});

	it('says a token the engine forgot is not found, so the page list is asked again', async () => {
		await expect(fetchProxied('http://127.0.0.1:8080/image/gone')).rejects.toMatchObject({
			failure: 'not-found'
		});
	});
});

describe('the wire format', () => {
	it('splits a memo off a URL, and puts it back', () => {
		expect(splitMemo('5871|mangayomi-memo|eyJwYXRoIjoiL3NlcmllLyJ9')).toEqual({
			url: '5871',
			memo: 'eyJwYXRoIjoiL3NlcmllLyJ9'
		});
		expect(splitMemo('/series/a')).toEqual({ url: '/series/a', memo: null });
		expect(joinMemo('5871', 'eyJ9')).toBe('5871|mangayomi-memo|eyJ9');
		expect(joinMemo('/series/a', null)).toBe('/series/a');
	});

	it('rewrites only the engine’s own proxy URLs', () => {
		expect(proxyUrl('http://127.0.0.1:8080/image/t?x=1', 'http://127.0.0.1:4590/')).toBe(
			'http://127.0.0.1:4590/image/t?x=1'
		);
		expect(proxyUrl('http://127.0.0.1:8080/video/t.m3u8', 'http://e:1')).toBe(
			'http://e:1/video/t.m3u8'
		);
		expect(proxyUrl('https://cdn.example.org/p/1.jpg', 'http://e:1')).toBe(
			'https://cdn.example.org/p/1.jpg'
		);
	});

	it('tells images from what only claims to be one', () => {
		expect(imageType(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0]))).toBe('png');
		expect(imageType(Buffer.from('GIF89a'))).toBe('gif');
		expect(imageType(Buffer.from('RIFF\0\0\0\0WEBPVP8 '))).toBe('webp');
		expect(imageType(Buffer.from('\0\0\0\x1cftypavif'))).toBe('avif');
		expect(imageType(Buffer.from([0xff, 0x0a]))).toBe('jxl');
		expect(imageType(Buffer.from('<!DOCTYPE html><title>Just a moment...</title>'))).toBeNull();
		expect(imageType(Buffer.alloc(0))).toBeNull();
	});

	it('names the key a setPreference changes', () => {
		expect(preferenceSnapshot([], 'mirror').at(-1)).toEqual({
			key: BRIDGE_CONTEXT,
			preferenceApplyMode: 'replace-present',
			changedPreferenceKey: 'mirror'
		});
	});
});

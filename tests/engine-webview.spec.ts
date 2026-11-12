import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { call, EngineError, failureFrom } from '$lib/server/engine/client';
import {
	chromiumBytes,
	forgetCapabilities,
	mark,
	removeChromium,
	setWebView,
	support,
	webviewView
} from '$lib/server/engine/webview';
import { readSwitch, writeSwitch } from '$lib/server/engine/webview-switch';

// The engine's WebView from the app's side (src/lib/server/engine/webview.ts;
// doc/EXTENSION-ENGINE.md, "WebView support"), against a fake engine that
// answers /capabilities, /webview and a WebView extension's failed call as
// tsundoku-engine b22055e does.

let caps: Record<string, unknown> | null = { imageProxy: true, webview: true };
let status: Record<string, unknown> | null = { enabled: true, state: 'idle' };
let dalvik: { status: number; json: unknown } = { status: 200, json: {} };
let capsAsked = 0;

let server: Server;
const home = mkdtempSync(join(tmpdir(), 'tsundoku-webview-'));
const chromium = join(home, 'engine', 'app', 'webview', 'chromium');
const switchFile = join(home, 'engine', 'webview.json');

beforeAll(async () => {
	server = createServer((req, res) => {
		const send = (code: number, body: unknown) =>
			res.writeHead(code, { 'content-type': 'application/json' }).end(JSON.stringify(body));
		if (req.headers.authorization !== 'Bearer tok') return send(401, 'Unauthorized');
		if (req.url === '/capabilities') {
			capsAsked++;
			return caps ? send(200, caps) : res.destroy();
		}
		if (req.url === '/webview') return status ? send(200, status) : send(404, 'Not Found');
		if (req.url === '/dalvik') {
			req.resume();
			return req.on('end', () => send(dalvik.status, dalvik.json));
		}
		send(404, 'Not Found');
	});
	await new Promise<void>((ok) => server.listen(0, '127.0.0.1', ok));
	process.env.ENGINE_URL = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
	process.env.ENGINE_TOKEN = 'tok';
});

afterAll(async () => {
	await new Promise<void>((ok) => server.close(() => ok()));
	rmSync(home, { recursive: true, force: true });
});

beforeEach(() => {
	caps = { imageProxy: true, webview: true };
	status = { enabled: true, state: 'idle' };
	capsAsked = 0;
	forgetCapabilities();
	process.env.ENGINE_WEBVIEW_SWITCH = switchFile;
	process.env.ENGINE_WEBVIEW_DIR = chromium;
	rmSync(join(home, 'engine'), { recursive: true, force: true });
});

const mkissa = { handle: 'a'.repeat(64), apk: async () => new Uint8Array() };

describe('a WebView extension’s failed call', () => {
	it('says the browser is coming instead of the extension’s timeout', async () => {
		dalvik = {
			status: 500,
			json: {
				error: 'Timed out waiting for the WebView',
				code: 500,
				webview: { enabled: true, state: 'starting', phase: 'downloading', percent: 40 }
			}
		};
		const e = (await call(mkissa, 'getVideoList', {}, { sourceId: '1' }).catch(
			(x: unknown) => x
		)) as EngineError;
		expect(e).toBeInstanceOf(EngineError);
		expect(e.failure).toBe('webview');
		expect(e.message).toBe('GETTING THE BROWSER THIS SOURCE NEEDS · 40 % OF ABOUT 180 MB');
		expect(e.webview?.state).toBe('starting');
	});

	it('says why it failed, in the engine’s words', () => {
		const e = failureFrom(500, {
			error: 'Timed out',
			code: 500,
			webview: { state: 'failed', error: 'needs an X display: install Xvfb' }
		});
		expect([e.failure, e.message]).toEqual(['webview', 'needs an X display: install Xvfb']);
	});

	it('says this install has it off', () => {
		const e = failureFrom(500, { error: 'Timed out', code: 500, webview: { state: 'off' } });
		expect([e.failure, e.message]).toEqual([
			'webview',
			'NEEDS A WEBVIEW, WHICH THIS INSTALL HAS TURNED OFF'
		]);
	});

	it('keeps the extension’s own words when its browser was there: the site failed', () => {
		const e = failureFrom(500, {
			error: 'HTTP error 403',
			code: 403,
			webview: { state: 'ready', openPages: 1 }
		});
		expect([e.failure, e.message, e.webview?.state]).toEqual([
			'refused',
			'HTTP error 403',
			'ready'
		]);
	});

	it('reads a plain error as before', () => {
		const e = failureFrom(500, { error: 'You have been rate limited', code: 500 });
		expect([e.failure, e.webview]).toEqual(['rate-limited', null]);
	});
});

describe('whether this install runs WebView extensions', () => {
	it('is the engine’s capability, asked once every few seconds', async () => {
		expect(await support()).toBe('on');
		expect(await support()).toBe('on');
		expect(capsAsked).toBe(1);
		expect(await mark()).toBe('NEEDS A WEBVIEW');
	});

	it('is unsupported on an older engine, whose capabilities have no webview', async () => {
		caps = { imageProxy: true };
		expect(await support()).toBe('unsupported');
		expect(await mark()).toBe("NEEDS A WEBVIEW, WHICH THIS ENGINE CAN'T RUN");
	});

	it('is the switch while the engine isn’t answering', async () => {
		caps = null;
		writeSwitch(switchFile, false);
		expect(await support()).toBe('off');
		forgetCapabilities();
		writeSwitch(switchFile, true);
		expect(await support()).toBe('on');
	});
});

describe('SETTINGS’ WEBVIEW row', () => {
	it('is off on a fresh install, with nothing downloaded', async () => {
		caps = { webview: false };
		status = { enabled: false, state: 'off' };
		const v = await webviewView();
		expect(v).toMatchObject({
			managed: true,
			on: false,
			support: 'off',
			restarting: false,
			line: 'OFF',
			firstUse: null,
			chromium: { dir: chromium, bytes: null }
		});
	});

	it('turns on through the switch, and says the engine is restarting until it has', async () => {
		caps = { webview: false };
		status = { enabled: false, state: 'off' };
		expect(setWebView(true)).toBe(true);
		expect(readSwitch(switchFile)).toBe(true);
		expect((await webviewView()).restarting).toBe(true);
		// The launcher restarted it with ENGINE_WEBVIEW=on.
		caps = { webview: true };
		status = { enabled: true, state: 'idle' };
		forgetCapabilities();
		expect(await webviewView()).toMatchObject({
			on: true,
			support: 'on',
			restarting: false,
			line: 'NOT NEEDED YET'
		});
	});

	it('counts the download, and Chromium’s folder once it’s there', async () => {
		writeSwitch(switchFile, true);
		status = { enabled: true, state: 'starting', phase: 'downloading', percent: 60 };
		expect(await webviewView()).toMatchObject({
			line: 'DOWNLOADING 60 %',
			firstUse: 'GETTING THE BROWSER THIS SOURCE NEEDS · 60 % OF ABOUT 180 MB'
		});
		mkdirSync(join(chromium, 'lib'), { recursive: true });
		writeFileSync(join(chromium, 'lib', 'libcef.so'), Buffer.alloc(3 * 1024 ** 2));
		writeFileSync(join(chromium, 'icudtl.dat'), Buffer.alloc(1024 ** 2));
		expect(await chromiumBytes(Date.now() + 120_000)).toBe(4 * 1024 ** 2);
	});

	it('shows the switch without a control where tsundoku’s launcher doesn’t start the engine', async () => {
		delete process.env.ENGINE_WEBVIEW_SWITCH;
		delete process.env.ENGINE_WEBVIEW_DIR;
		status = { enabled: true, state: 'ready', openPages: 1, dir: '/data/webview/chromium' };
		expect(await webviewView()).toMatchObject({
			managed: false,
			on: null,
			restarting: false,
			line: 'READY · 1 PAGE OPEN',
			chromium: { dir: '/data/webview/chromium', bytes: null }
		});
		expect(setWebView(true)).toBe(false);
	});
});

describe('REMOVE', () => {
	const download = () => {
		mkdirSync(chromium, { recursive: true });
		writeFileSync(join(chromium, 'libcef.so'), 'x');
	};

	it('refuses while the switch is on', async () => {
		download();
		writeSwitch(switchFile, true);
		expect(await removeChromium()).toBe('turn the WebView off first');
		expect(existsSync(chromium)).toBe(true);
	});

	it('refuses while the engine still runs it: the restart isn’t done', async () => {
		download();
		writeSwitch(switchFile, false);
		status = { enabled: true, state: 'ready' };
		expect(await removeChromium()).toBe('the engine is still restarting: try in a moment');
		expect(existsSync(chromium)).toBe(true);
	});

	it('deletes the folder once the switch is off and the engine has let go', async () => {
		download();
		writeSwitch(switchFile, false);
		status = { enabled: false, state: 'off' };
		expect(await removeChromium()).toBeNull();
		expect(existsSync(chromium)).toBe(false);
		// Its parent, the engine's own, stays.
		expect(existsSync(join(home, 'engine', 'app', 'webview'))).toBe(true);
	});

	it('never deletes a folder that isn’t a WebView’s Chromium', async () => {
		process.env.ENGINE_WEBVIEW_DIR = join(home, 'engine', 'app');
		mkdirSync(join(home, 'engine', 'app'), { recursive: true });
		expect(await removeChromium()).toBe('not a WebView folder');
		expect(existsSync(join(home, 'engine', 'app'))).toBe(true);
	});

	it('has nothing to do where the launcher doesn’t keep a switch', async () => {
		delete process.env.ENGINE_WEBVIEW_SWITCH;
		expect(await removeChromium()).toBe('nothing to remove here');
	});
});

describe('a chapter whose WebView extension’s browser is still coming', () => {
	it('waits as long as a rate limit before its next try, not 15 s', async () => {
		const { backoffMs } = await import('$lib/server/engine/queue');
		expect(backoffMs(1, 'webview')).toBe(60_000);
		expect(backoffMs(1, 'source')).toBe(15_000);
	});
});

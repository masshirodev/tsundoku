import { describe, expect, it } from 'vitest';
import {
	CHROMIUM_MB,
	NEEDS,
	firstUseLine,
	parseWebViewError,
	parseWebViewStatus,
	sizeWords,
	stateLine,
	webviewError,
	webviewFailure,
	webviewMark,
	webviewSupport,
	type WebViewStatus
} from '$lib/webview';

// The engine's WebView in tsundoku's words (src/lib/webview.ts;
// doc/EXTENSION-ENGINE.md, "Cloudflare and WebView extensions").

const status = (over: Partial<WebViewStatus> = {}): WebViewStatus => ({
	state: 'idle',
	phase: null,
	percent: null,
	error: null,
	openPages: 0,
	waitingPages: 0,
	dir: null,
	...over
});

describe('reading the engine’s /webview', () => {
	it('takes the object the engine answers', () => {
		expect(
			parseWebViewStatus({
				enabled: true,
				state: 'starting',
				phase: 'downloading',
				percent: 40.4,
				error: null,
				openPages: 0,
				waitingPages: 1,
				maxPages: 2,
				chromium: 'jbr-release-17.0.10b1087.23',
				dir: '/h/engine/app/webview/chromium'
			})
		).toEqual({
			state: 'starting',
			phase: 'downloading',
			percent: 40,
			error: null,
			openPages: 0,
			waitingPages: 1,
			dir: '/h/engine/app/webview/chromium'
		});
	});

	it('reads off as the engine writes it, with nothing else', () => {
		expect(parseWebViewStatus({ enabled: false, state: 'off' })).toEqual(status({ state: 'off' }));
	});

	it('is nothing for what isn’t one: an older engine’s 404 body, junk, a state it doesn’t know', () => {
		expect(parseWebViewStatus(null)).toBeNull();
		expect(parseWebViewStatus('Not Found')).toBeNull();
		expect(parseWebViewStatus({ state: 'sleeping' })).toBeNull();
	});

	it('keeps a percent between 0 and 100, and drops one that isn’t a number', () => {
		expect(parseWebViewStatus({ state: 'starting', percent: 140 })!.percent).toBe(100);
		expect(parseWebViewStatus({ state: 'starting', percent: -3 })!.percent).toBe(0);
		expect(parseWebViewStatus({ state: 'starting', percent: '40' })!.percent).toBeNull();
	});
});

describe('whether this install’s engine runs WebView extensions', () => {
	it('is the capability where the engine answers', () => {
		expect(webviewSupport({ imageProxy: true, webview: true }, false)).toBe('on');
		expect(webviewSupport({ imageProxy: true, webview: false }, true)).toBe('off');
	});

	it('is unsupported on an engine older than it: no webview key at all', () => {
		expect(webviewSupport({ imageProxy: true, webviewBridge: true }, true)).toBe('unsupported');
	});

	it('is the switch while the engine isn’t answering, and unknown without one', () => {
		expect(webviewSupport(null, true)).toBe('on');
		expect(webviewSupport(null, false)).toBe('off');
		expect(webviewSupport(null, null)).toBe('unknown');
	});
});

describe('the mark', () => {
	it('is quiet where the install can run one, and says why where it can’t', () => {
		expect(webviewMark('on')).toBe(NEEDS);
		expect(webviewMark('unknown')).toBe(NEEDS);
		expect(webviewMark('off')).toBe('NEEDS A WEBVIEW, WHICH THIS INSTALL HAS TURNED OFF');
		expect(webviewMark('unsupported')).toBe("NEEDS A WEBVIEW, WHICH THIS ENGINE CAN'T RUN");
	});
});

describe('SETTINGS’ state line', () => {
	it('says each state in words', () => {
		expect(stateLine(status({ state: 'idle' }), 'on')).toBe('NOT NEEDED YET');
		expect(stateLine(status({ state: 'off' }), 'off')).toBe('OFF');
		expect(stateLine(status({ state: 'starting', phase: 'downloading', percent: 40 }), 'on')).toBe(
			'DOWNLOADING 40 %'
		);
		expect(stateLine(status({ state: 'starting', phase: 'extracting' }), 'on')).toBe('UNPACKING');
		expect(stateLine(status({ state: 'starting', phase: 'initializing' }), 'on')).toBe('STARTING');
		expect(stateLine(status({ state: 'ready', openPages: 1 }), 'on')).toBe('READY · 1 PAGE OPEN');
		expect(stateLine(status({ state: 'ready', openPages: 2, waitingPages: 3 }), 'on')).toBe(
			'READY · 2 PAGES OPEN · 3 WAITING'
		);
	});

	it('gives a failure the engine’s own words, as it wrote them', () => {
		const error = 'needs an X display: install Xvfb (the xvfb package)';
		expect(stateLine(status({ state: 'failed', error }), 'on')).toBe(`FAILED: ${error}`);
	});

	it('says an old engine can’t, and a silent one isn’t answering', () => {
		expect(stateLine(null, 'unsupported')).toBe(
			"THIS ENGINE CAN'T RUN ONE · A NEWER TSUNDOKU BRINGS ONE"
		);
		expect(stateLine(null, 'on')).toBe("THE ENGINE ISN'T ANSWERING");
		expect(stateLine(null, 'off')).toBe('OFF');
	});
});

describe('the first-use line', () => {
	it('counts the download, of about what it weighs', () => {
		expect(firstUseLine(status({ state: 'starting', phase: 'downloading', percent: 40 }))).toBe(
			`GETTING THE BROWSER THIS SOURCE NEEDS · 40 % OF ABOUT ${CHROMIUM_MB} MB`
		);
		expect(firstUseLine(status({ state: 'starting', phase: 'locating' }))).toBe(
			`GETTING THE BROWSER THIS SOURCE NEEDS · ABOUT ${CHROMIUM_MB} MB`
		);
		expect(firstUseLine(status({ state: 'starting', phase: 'extracting' }))).toBe(
			'GETTING THE BROWSER THIS SOURCE NEEDS · UNPACKING'
		);
	});

	it('is the engine’s words when it failed', () => {
		expect(
			firstUseLine(status({ state: 'failed', error: 'a library Chromium needs is missing' }))
		).toBe('a library Chromium needs is missing');
	});

	it('says nothing when ready, idle or off', () => {
		for (const state of ['ready', 'idle', 'off'] as const)
			expect(firstUseLine(status({ state }))).toBeNull();
		expect(firstUseLine(null)).toBeNull();
	});
});

describe('a call that failed for want of the browser', () => {
	it('says the browser instead of the extension’s timeout while it comes, fails, or is off', () => {
		expect(webviewFailure(status({ state: 'starting', phase: 'downloading', percent: 5 }))).toEqual(
			{
				line: `GETTING THE BROWSER THIS SOURCE NEEDS · 5 % OF ABOUT ${CHROMIUM_MB} MB`,
				state: 'starting'
			}
		);
		expect(webviewFailure(status({ state: 'failed', error: 'no display' }))).toEqual({
			line: 'no display',
			state: 'failed'
		});
		expect(webviewFailure(status({ state: 'off' }))).toEqual({
			line: 'NEEDS A WEBVIEW, WHICH THIS INSTALL HAS TURNED OFF',
			state: 'off'
		});
	});

	it('leaves the extension’s own words when its browser was there', () => {
		expect(webviewFailure(status({ state: 'ready' }))).toBeNull();
		expect(webviewFailure(status({ state: 'idle' }))).toBeNull();
		expect(webviewFailure(null)).toBeNull();
	});

	it('travels through a page’s settled answer and back', () => {
		const e = webviewError('failed', 'needs Xvfb: install xvfb\nthen restart');
		expect(parseWebViewError(e)).toEqual({
			state: 'failed',
			line: 'needs Xvfb: install xvfb\nthen restart'
		});
		expect(parseWebViewError('down')).toBeNull();
		expect(parseWebViewError('The source took longer than 60 s to answer')).toBeNull();
	});
});

describe('sizes', () => {
	it('says Chromium’s folder in MB, and in GB past one', () => {
		expect(sizeWords(359 * 1024 ** 2)).toBe('359 MB');
		expect(sizeWords(10)).toBe('1 MB');
		expect(sizeWords(1.5 * 1024 ** 3)).toBe('1.5 GB');
	});
});

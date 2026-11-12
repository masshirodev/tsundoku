import { afterAll, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { apkUsesWebView, dexNamesWebView } from '$lib/server/engine/apk-webview';
import { zip } from '$lib/server/zip-write';

// Whether an extension uses a WebView, from its APK's dex, as the engine
// reads it (tsundoku-engine's WebViewSupport.usesWebView).

const dir = mkdtempSync(join(tmpdir(), 'tsundoku-apk-webview-'));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

const dex = (...types: string[]) => Buffer.from(`dex\n035\0${types.join('\0')}\0`, 'latin1');

describe('a dex naming android.webkit.WebView', () => {
	it('is found by its descriptor', () => {
		expect(dexNamesWebView(dex('Lkotlin/Unit;', 'Landroid/webkit/WebView;'))).toBe(true);
	});

	it('is not a WebViewClient alone, nor the class named as text', () => {
		expect(dexNamesWebView(dex('Landroid/webkit/WebViewClient;'))).toBe(false);
		expect(dexNamesWebView(dex('android.webkit.WebView'))).toBe(false);
	});
});

describe('an APK', () => {
	const apk = (name: string, members: { name: string; data: Buffer; deflate?: boolean }[]) => {
		const path = join(dir, name);
		writeFileSync(path, zip(members));
		return path;
	};

	it('uses one when any of its dex files names it, stored or deflated', async () => {
		const path = apk('mkissa.apk', [
			{ name: 'AndroidManifest.xml', data: Buffer.from('<manifest/>') },
			{ name: 'classes.dex', data: dex('Lkotlin/Unit;') },
			{ name: 'classes2.dex', data: dex('Landroid/webkit/WebView;'), deflate: true }
		]);
		expect(await apkUsesWebView(path)).toBe(true);
	});

	it('doesn’t when only a resource names it: only dex files are code', async () => {
		const path = apk('plain.apk', [
			{ name: 'classes.dex', data: dex('Lkotlin/Unit;') },
			{ name: 'res/raw/notes.txt', data: Buffer.from('Landroid/webkit/WebView;') }
		]);
		expect(await apkUsesWebView(path)).toBe(false);
	});

	it('doesn’t, for the two real extensions the suite carries', async () => {
		expect(await apkUsesWebView('tests/fixtures/apk/tachiyomi-all.webtoons-v1.6.2.apk')).toBe(
			false
		);
		expect(await apkUsesWebView('tests/fixtures/apk/tachiyomi-all.mangadex-v1.6.0.apk')).toBe(
			false
		);
	});
});

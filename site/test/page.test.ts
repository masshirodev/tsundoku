import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readRelease } from '../lib/data.ts';
import { DEFAULT_HELP, renderPage, type Captures } from '../lib/page.ts';
import { ANDROID_MANIFEST, MANIFEST, testKey } from './helpers.ts';

const cap = (file: string) => ({ file, width: 100, height: 200 });
const CAPTURES: Captures = {
	'library-desktop': { dark: cap('a-dark.webp'), light: cap('a-light.webp') },
	'series-tablet': { dark: cap('b-dark.webp'), light: cap('b-light.webp') },
	'library-phone': { dark: cap('c-dark.webp'), light: cap('c-light.webp') },
	'reader-phone': { dark: cap('d-dark.webp') },
	'strip-phone': { dark: cap('e-dark.webp') },
	'history-phone': { dark: cap('f-dark.webp'), light: cap('f-light.webp') }
};

function render(help = DEFAULT_HELP, solverSize = 326069158, manifest = MANIFEST) {
	const k = testKey();
	return renderPage({
		release: readRelease(k.signed(manifest), k.raw),
		solver: {
			windows: { name: 'flaresolverr-3.4.6-win-x64.zip', size: solverSize },
			linux: { name: 'flaresolverr-3.4.6-linux-x64.tar.gz', size: solverSize }
		},
		captures: CAPTURES,
		help,
		assets: { css: 'site.abc.css', js: 'site.def.js', favicon: 'f.png', touchIcon: 't.png' },
		fonts: ''
	});
}

test('the release notes are escaped, one paragraph a line', () => {
	const html = render();
	assert.match(
		html,
		/<p>First line &lt;b&gt;with markup&lt;\/b&gt;\.<\/p><p>Second &amp; last line\.<\/p>/
	);
	assert.doesNotMatch(html, /<b>with markup<\/b>/);
});

test('as built: Windows, Linux, macOS, nothing tagged, only the installer on the accent', () => {
	const html = render();
	const order = [...html.matchAll(/class="dl-row[^"]*" data-os="([\w-]+)"/g)].map((m) => m[1]);
	assert.deepEqual(order, ['windows', 'linux', 'mac']);
	assert.equal(html.match(/<span class="tag" hidden>/g)?.length, 3);
	const accented = [...html.matchAll(/class="btn btn-main btn-accent" data-main="(\w+)"/g)].map(
		(m) => m[1]
	);
	assert.deepEqual(accented, ['windows']);
	assert.match(html, /<div class="dl-band" hidden>/);
	assert.match(html, /<button type="button" class="bar-theme" hidden/);
});

test('every download links latest/ with its size', () => {
	const html = render();
	for (const name of ['tsundoku-win-x64.exe', 'tsundoku-win-x64.zip', 'tsundoku-linux-x64.tar.xz'])
		assert.match(
			html,
			new RegExp(
				`href="https://dl\\.tsundoku\\.masshiro\\.pro/latest/${name.replaceAll('.', '\\.')}"`
			)
		);
	assert.match(html, /↓ INSTALLER · \.EXE<span class="btn-size">231 MB<\/span>/);
	assert.match(html, /FlareSolverr, about 311 MB since/);
});

test('a release without the apps draws no app row, and the phone copy offers none', () => {
	const html = render();
	assert.doesNotMatch(html, /data-os="android/);
	assert.match(
		html,
		/<span class="dl-band-text">tsundoku runs on a computer, Windows or Linux\. Install it there, then read on this phone over Wi-Fi\.<\/span>/
	);
	assert.match(
		html,
		/<p class="phone-lead">tsundoku stays on the computer; the phone opens it in its browser\. Two ways in\.<\/p>/
	);
	assert.doesNotMatch(html, /tsundoku app/);
});

test('a release with both apps draws both rows, name, size and hash from the manifest', () => {
	const html = render(DEFAULT_HELP, 326069158, ANDROID_MANIFEST);
	const order = [...html.matchAll(/class="dl-row[^"]*" data-os="([\w-]+)"/g)].map((m) => m[1]);
	assert.deepEqual(order, ['windows', 'linux', 'mac', 'android', 'android-tv']);
	assert.match(
		html,
		/href="https:\/\/dl\.tsundoku\.masshiro\.pro\/latest\/tsundoku-app\.apk" download>↓ ANDROID APP · \.APK<span class="btn-size">42 MB<\/span>/
	);
	assert.match(
		html,
		/href="https:\/\/dl\.tsundoku\.masshiro\.pro\/latest\/tsundoku-tv\.apk" download>↓ TV APP · \.APK<span class="btn-size">32 MB<\/span>/
	);
	assert.match(html, new RegExp(`SHA-256 ${'b'.repeat(64)}`));
	assert.match(html, new RegExp(`SHA-256 ${'c'.repeat(64)}`));
	assert.match(html, /Android asks once to allow installs from your browser/);
	assert.match(
		html,
		/copy the APK to a USB stick and open it with the TV’s file manager, or use a downloader app/
	);
});

test('the phone band and 06 offer the app only when the release has the phone app', () => {
	const html = render(DEFAULT_HELP, 326069158, ANDROID_MANIFEST);
	assert.match(
		html,
		/and the Android app is on this page\. Install tsundoku on the computer first/
	);
	assert.match(
		html,
		/phone opens it in its browser, or, on Android, in <a href="#download">the tsundoku app<\/a>, which pairs with the computer and needs it running/
	);
});

test('a release with only one app draws only that row', () => {
	const onlyTv = {
		...ANDROID_MANIFEST,
		files: { ...ANDROID_MANIFEST.files, android: { tv: ANDROID_MANIFEST.files.android?.tv } }
	};
	const html = render(DEFAULT_HELP, 326069158, onlyTv);
	const order = [...html.matchAll(/class="dl-row[^"]*" data-os="([\w-]+)"/g)].map((m) => m[1]);
	assert.deepEqual(order, ['windows', 'linux', 'mac', 'android-tv']);
	// 06 is the phone and tablet's, so only the phone app puts its words there.
	assert.doesNotMatch(html, /tsundoku app/);
	assert.match(html, /tsundoku runs on a computer, Windows or Linux\. Install it there/);
});

test('offline, FlareSolverr says no number rather than a wrong one', () => {
	const html = render(DEFAULT_HELP, 0);
	assert.match(html, /FlareSolverr, a large download since/);
	assert.match(html, /<span class="btn-size"><\/span>/);
});

test('the version comes from the release, never typed', () => {
	const html = render();
	assert.equal(html.match(/2026\.11\.01\.2/g)?.length, 5);
	assert.match(html, /2026\.11\.01\.2 · 01 NOV 2026/);
});

test('figures: both palettes where captured, one for the reader, sized', () => {
	const html = render();
	assert.match(
		html,
		/<img class="cap cap-dark" src="captures\/a-dark\.webp" width="100" height="200"[^>]*fetchpriority="high"/
	);
	assert.match(html, /<img class="cap cap-light" src="captures\/a-light\.webp"/);
	assert.match(html, /<img class="cap" src="captures\/d-dark\.webp"[^>]*loading="lazy"/);
});

test('the help line is the owner’s, escaped, in both places', () => {
	const html = render('Ask <me> on Discord');
	assert.equal(html.match(/Ask &lt;me&gt; on Discord/g)?.length, 2);
});

test('nothing hidden is named, and nothing loads from elsewhere', () => {
	const html = render();
	assert.doesNotMatch(html, /hentoid|doujin|reveal|hidden series/i);
	const srcs = [...html.matchAll(/(?:src|href)="(https?:[^"]+)"/g)].map((m) => m[1]);
	for (const s of srcs)
		assert.match(s, /^https:\/\/(dl\.tsundoku\.masshiro\.pro\/|tailscale\.com$)/, s);
	assert.doesNotMatch(html, /<script(?! src="site\.def\.js")/);
});

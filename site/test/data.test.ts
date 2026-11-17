import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import {
	appsOf,
	chromeDate,
	esc,
	facesFor,
	fontFaces,
	megabytes,
	readRelease,
	solverNames,
	themeCss
} from '../lib/data.ts';
import { ANDROID_MANIFEST, MANIFEST, testKey } from './helpers.ts';

test('a latest.json signed by the key opens, with lasting latest/ links', () => {
	const k = testKey();
	const r = readRelease(k.signed(MANIFEST), k.raw);
	assert.equal(r.version, '2026.11.01.2');
	assert.equal(r.date, '2026-11-01');
	assert.deepEqual(r.notes, ['First line <b>with markup</b>.', 'Second & last line.']);
	assert.equal(r.installer.href, 'https://dl.tsundoku.masshiro.pro/latest/tsundoku-win-x64.exe');
	assert.equal(r.installer.sha256, 'a'.repeat(64));
	assert.equal(r.zip.size, 300000000);
	assert.equal(r.archive.name, 'tsundoku-linux-x64.tar.xz');
	// Before the Android apps there is no files.android at all, and that is not a refusal.
	assert.equal(r.android, null);
	assert.deepEqual(appsOf(r), { app: false, tv: false });
});

test('a manifest with the Android apps carries both apps, with the signed names, sizes and hashes', () => {
	const k = testKey();
	const r = readRelease(k.signed(ANDROID_MANIFEST), k.raw);
	assert.deepEqual(r.android?.app, {
		name: 'tsundoku-app.apk',
		size: 44040192,
		sha256: 'b'.repeat(64),
		href: 'https://dl.tsundoku.masshiro.pro/latest/tsundoku-app.apk'
	});
	assert.deepEqual(r.android?.tv, {
		name: 'tsundoku-tv.apk',
		size: 33554432,
		sha256: 'c'.repeat(64),
		href: 'https://dl.tsundoku.masshiro.pro/latest/tsundoku-tv.apk'
	});
	assert.deepEqual(appsOf(r), { app: true, tv: true });
});

test('a release with only one app carries only that one', () => {
	const k = testKey();
	const onlyTv: typeof ANDROID_MANIFEST = {
		...ANDROID_MANIFEST,
		files: { ...ANDROID_MANIFEST.files, android: { tv: ANDROID_MANIFEST.files.android?.tv } }
	};
	const r = readRelease(k.signed(onlyTv), k.raw);
	assert.equal(r.android?.app, undefined);
	assert.equal(r.android?.tv?.name, 'tsundoku-tv.apk');
	assert.deepEqual(appsOf(r), { app: false, tv: true });
});

test('a malformed Android entry is refused like any other file', () => {
	const k = testKey();
	const broken = {
		...ANDROID_MANIFEST,
		files: {
			...ANDROID_MANIFEST.files,
			android: { app: { name: 'tsundoku-app.apk', size: 0, sha256: 'b'.repeat(64) } }
		}
	};
	assert.throws(() => readRelease(k.signed(broken), k.raw), /refused/);
});

test('a manifest signed by another key is refused', () => {
	const ours = testKey();
	const theirs = testKey();
	assert.throws(() => readRelease(theirs.signed(MANIFEST), ours.raw), /refused/);
});

test('a manifest changed after signing is refused', () => {
	const k = testKey();
	const doc = JSON.parse(k.signed(MANIFEST));
	doc.manifest = doc.manifest.replace('2026.11.01.2', '2026.11.09');
	assert.throws(() => readRelease(JSON.stringify(doc), k.raw), /refused/);
});

test('the real release key is the default, and refuses a test signature', () => {
	const k = testKey();
	assert.throws(() => readRelease(k.signed(MANIFEST)), /refused/);
});

test('not JSON is refused', () => {
	assert.throws(() => readRelease('<html>', testKey().raw), /refused/);
});

test('a release without all three downloads is refused', () => {
	const k = testKey();
	const partial = { ...MANIFEST, files: { 'win-x64': MANIFEST.files['win-x64'] } };
	assert.throws(() => readRelease(k.signed(partial), k.raw), /required/);
});

test('FlareSolverr names are publish.ts’s', () => {
	assert.deepEqual(solverNames('3.4.6'), {
		windows: 'flaresolverr-3.4.6-win-x64.zip',
		linux: 'flaresolverr-3.4.6-linux-x64.tar.gz'
	});
	assert.throws(() => solverNames('3.4.6/../x'));
});

test('sizes are whole 1024² megabytes, as Explorer shows them', () => {
	assert.equal(megabytes(242362191), '231 MB');
	assert.equal(megabytes(326069158), '311 MB');
	assert.equal(megabytes(1000), '1 MB');
	assert.equal(megabytes(0), '');
	assert.equal(megabytes(Number.NaN), '');
});

test('dates read as the chrome writes them', () => {
	assert.equal(chromeDate('2026-11-01'), '01 NOV 2026');
	assert.equal(chromeDate('2026-01-31'), '31 JAN 2026');
	assert.throws(() => chromeDate('2026-13-01'));
	assert.throws(() => chromeDate('yesterday'));
});

test('escaping covers text and attributes', () => {
	assert.equal(esc(`<a href="x">'&'</a>`), '&lt;a href=&quot;x&quot;&gt;&#39;&amp;&#39;&lt;/a&gt;');
});

test('the theme is the app’s tokens, the system preference added', () => {
	const colors = readFileSync(new URL('../../src/lib/styles/colors.css', import.meta.url), 'utf8');
	const css = themeCss(colors);
	assert.match(css, /^:root \{\n\t--graphite-950: #0e0f10;/);
	assert.match(css, /--text-prose: #b4b6b8;/);
	assert.match(
		css,
		/@media \(prefers-color-scheme: light\) \{\n:root:not\(\[data-theme='dark'\]\) \{\n\t--surface-page: var\(--paper-50\);/
	);
	assert.match(css, /:root\[data-theme='light'\] \{\n\t--surface-page: var\(--paper-50\);/);
	assert.doesNotMatch(css, /\/\*/, 'comments are left behind');
	assert.throws(() => themeCss(':root { --a: 1; }'), /no block/);
	assert.throws(
		() => themeCss(":root { color: red; } [data-theme='light'] { --a: 1; }"),
		/empty block/
	);
});

test('only the font chunks that hold the text are taken', () => {
	const css = `
@font-face { src: url(./files/a.woff2) format('woff2'); unicode-range: U+3000-30ff; }
@font-face { src: url(./files/b.woff2) format('woff2'); unicode-range: U+7a4d,U+8aad; }
@font-face { src: url(./files/c.woff2) format('woff2'); unicode-range: U+4e00-4fff; }`;
	const picked = facesFor(fontFaces(css), '積ん読').map((f) => f.file);
	assert.deepEqual(picked.sort(), ['a.woff2', 'b.woff2']);
	assert.throws(() => facesFor(fontFaces(css), '漢'), /no font chunk holds U\+6F22/);
});

test('the real Plex Sans JP holds 積ん読 in a few chunks', () => {
	const css = readFileSync(
		new URL('../../node_modules/@fontsource/ibm-plex-sans-jp/400.css', import.meta.url),
		'utf8'
	);
	const faces = fontFaces(css);
	assert.ok(faces.length > 100);
	const picked = facesFor(faces, '積ん読');
	assert.ok(picked.length >= 1 && picked.length <= 3);
});

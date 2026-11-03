import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readRelease } from '../lib/data.ts';
import { DEFAULT_HELP, renderPage, type Captures } from '../lib/page.ts';
import { MANIFEST, testKey } from './helpers.ts';

const cap = (file: string) => ({ file, width: 100, height: 200 });
const CAPTURES: Captures = {
	'library-desktop': { dark: cap('a-dark.webp'), light: cap('a-light.webp') },
	'series-tablet': { dark: cap('b-dark.webp'), light: cap('b-light.webp') },
	'library-phone': { dark: cap('c-dark.webp'), light: cap('c-light.webp') },
	'reader-phone': { dark: cap('d-dark.webp') },
	'strip-phone': { dark: cap('e-dark.webp') },
	'history-phone': { dark: cap('f-dark.webp'), light: cap('f-light.webp') }
};

function render(help = DEFAULT_HELP, solverSize = 326069158) {
	const k = testKey();
	return renderPage({
		release: readRelease(k.signed(MANIFEST), k.raw),
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
	const order = [...html.matchAll(/class="dl-row[^"]*" data-os="(\w+)"/g)].map((m) => m[1]);
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

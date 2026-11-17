/**
 * Render the app icons (doc/INSTALL.md): 積, the first character of 積ん読,
 * typeset in IBM Plex Sans JP 500, ink on graphite. The design has no logo and
 * says not to draw one, and every icon in the
 * system is a set glyph -- so the app icon is one too.
 *
 *   node scripts/icons.mjs     # writes static/icons/*.png
 *
 * Rendered by Chromium from the same font files the app ships, so it is
 * reproducible, and committed, so a build never depends on it.
 */
import { chromium } from '@playwright/test';
import { fileURLToPath } from 'node:url';

const css = fileURLToPath(
	new URL('../node_modules/@fontsource/ibm-plex-sans-jp/500.css', import.meta.url)
);
const out = (name) => fileURLToPath(new URL(`../static/icons/${name}`, import.meta.url));

// `maskable` keeps the glyph inside the central 80% safe zone that launchers
// may crop to a circle or a squircle; `any` can use more of the square.
const ICONS = [
	{ name: 'icon-192.png', size: 192, glyph: 0.62 },
	{ name: 'icon-512.png', size: 512, glyph: 0.62 },
	{ name: 'maskable-512.png', size: 512, glyph: 0.46 },
	{ name: 'apple-touch-icon.png', size: 180, glyph: 0.6 },
	{ name: 'favicon-32.png', size: 32, glyph: 0.82 }
];

const browser = await chromium.launch();
const page = await browser.newPage();
for (const icon of ICONS) {
	await page.setViewportSize({ width: icon.size, height: icon.size });
	await page.setContent(`<!doctype html><html><head>
		<link rel="stylesheet" href="file://${css}">
		<style>
			html, body { margin: 0; width: 100%; height: 100%; background: #0e0f10; }
			body { display: flex; align-items: center; justify-content: center; }
			span { font: 500 ${Math.round(icon.size * icon.glyph)}px/1 'IBM Plex Sans JP'; color: #e8e8e6; }
		</style></head><body><span lang="ja">積</span></body></html>`);
	await page.evaluate(() => document.fonts.ready);
	const family = await page.evaluate(() =>
		document.fonts.check("500 40px 'IBM Plex Sans JP'", '積')
	);
	if (!family)
		throw new Error('IBM Plex Sans JP did not load; refusing to render a fallback glyph');
	await page.screenshot({ path: out(icon.name) });
	console.log('wrote', icon.name);
}
await browser.close();

/**
 * Builds tsundoku's website into site/build/ (doc/WEBSITE.md).
 *
 *   yarn run site                         # the live latest.json, verified
 *   yarn run site --manifest file.json    # a saved latest.json instead
 *   yarn run site --offline               # with --manifest: no network at all
 *
 * The page's numbers are never typed: the release comes from latest.json,
 * opened with the release key exactly as an installed copy opens it, and the
 * build stops if it won't open. FlareSolverr's sizes come from the download
 * host (it isn't in the signed manifest), the colours from the app's own
 * colors.css, the figures from site/captures/ (yarn run site:captures).
 */

import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DL, facesFor, fontFaces, readRelease, solverNames, themeCss } from './lib/data.ts';
import { DEFAULT_HELP, renderPage, type Captures } from './lib/page.ts';

const site = dirname(fileURLToPath(import.meta.url));
const repo = dirname(site);
const out = join(site, 'build');
const modules = join(repo, 'node_modules');

function fail(msg: string): never {
	console.error(`site: ${msg}`);
	process.exit(1);
}

const args = process.argv.slice(2);
const flag = (name: string) => {
	const i = args.indexOf(name);
	return i < 0 ? undefined : (args[i + 1] ?? fail(`${name} needs a value`));
};
const manifestFile = flag('--manifest');
const offline = args.includes('--offline');
if (offline && !manifestFile) fail('--offline needs --manifest <file>');

// ---- the release ----
let latest: string;
if (manifestFile) latest = readFileSync(manifestFile, 'utf8');
else {
	const res = await fetch(`${DL}/latest.json`, { cache: 'no-store' });
	if (!res.ok) fail(`${DL}/latest.json answered ${res.status}`);
	latest = await res.text();
}
let release;
try {
	release = readRelease(latest);
} catch (e) {
	fail((e as Error).message);
}

const versions = JSON.parse(readFileSync(join(repo, 'ops/release/versions.json'), 'utf8')) as {
	flaresolverr: { version: string };
};
const names = solverNames(versions.flaresolverr.version);
async function sizeOf(name: string): Promise<number> {
	if (offline) return 0;
	const res = await fetch(`${DL}/latest/${name}`, { method: 'HEAD' });
	const size = Number(res.headers.get('content-length'));
	if (!res.ok || !(size > 0))
		fail(`${DL}/latest/${name} answered ${res.status}: is FlareSolverr published?`);
	return size;
}
const solver = {
	windows: { name: names.windows, size: await sizeOf(names.windows) },
	linux: { name: names.linux, size: await sizeOf(names.linux) }
};

// ---- the captures ----
const capDir = join(site, 'captures');
const capIndex = join(capDir, 'captures.json');
if (!existsSync(capIndex)) fail(`no ${capIndex}: run yarn run site:captures first`);
const captures = JSON.parse(readFileSync(capIndex, 'utf8')) as Captures;

// ---- out ----
rmSync(out, { recursive: true, force: true });
mkdirSync(join(out, 'captures'), { recursive: true });
mkdirSync(join(out, 'fonts'), { recursive: true });

// Every asset is published under a name carrying its content's hash
// (name.<10 hex>.ext), so Caddy serves them as immutable and only index.html
// is revalidated: a re-shot capture or a new font never meets a stale copy.
// The same scheme as ranma's site, so the two Caddy blocks match.
const fingerprint = (data: string | Buffer) =>
	createHash('sha256').update(data).digest('hex').slice(0, 10);
const hashed = (file: string, data: Buffer) => {
	const dot = file.lastIndexOf('.');
	return `${file.slice(0, dot)}.${fingerprint(data)}${file.slice(dot)}`;
};

for (const fig of Object.values(captures))
	for (const c of [fig.dark, fig.light])
		if (c) {
			const from = join(capDir, c.file);
			if (!existsSync(from)) fail(`${from} is in captures.json but not on disk`);
			const data = readFileSync(from);
			c.file = hashed(c.file, data);
			writeFileSync(join(out, 'captures', c.file), data);
		}

// ---- fonts: self-hosted, only what the page sets ----
// Plex Mono from IBM's complete build (it has ← and →, which Fontsource's
// subset lacks; src/lib/styles/fonts-mono.css), Plex Sans Latin, and Plex Sans
// JP only in the chunks that hold 積ん読, the page's only Japanese.
const faces: string[] = [];
const published = new Map<string, string>();
const face = (family: string, weight: number, from: string, name: string, range?: string) => {
	const data = readFileSync(from);
	const file = hashed(name, data);
	published.set(name, file);
	writeFileSync(join(out, 'fonts', file), data);
	faces.push(
		`@font-face{font-family:'${family}';font-style:normal;font-weight:${weight};font-display:swap;src:url(fonts/${file}) format('woff2')${range ? `;unicode-range:${range}` : ''}}`
	);
};
const monoDir = join(modules, '@ibm/plex-mono/fonts/complete/woff2');
face('IBM Plex Mono', 400, join(monoDir, 'IBMPlexMono-Regular.woff2'), 'plex-mono-400.woff2');
face('IBM Plex Mono', 500, join(monoDir, 'IBMPlexMono-Medium.woff2'), 'plex-mono-500.woff2');
for (const w of [400, 500]) {
	const file = `ibm-plex-sans-latin-${w}-normal.woff2`;
	face('IBM Plex Sans', w, join(modules, '@fontsource/ibm-plex-sans/files', file), file);
	const jpCss = readFileSync(join(modules, `@fontsource/ibm-plex-sans-jp/${w}.css`), 'utf8');
	for (const f of facesFor(fontFaces(jpCss), '積ん読')) {
		const range = f.ranges
			.map(([a, b]) => (a === b ? `U+${a.toString(16)}` : `U+${a.toString(16)}-${b.toString(16)}`))
			.join(',');
		face(
			'IBM Plex Sans JP',
			w,
			join(modules, '@fontsource/ibm-plex-sans-jp/files', f.file),
			f.file,
			range
		);
	}
}
// The two the page draws first, fetched before the CSS asks for them.
const preload = ['plex-mono-500.woff2', 'ibm-plex-sans-latin-500-normal.woff2']
	.map(
		(f) =>
			`<link rel="preload" href="fonts/${published.get(f)}" as="font" type="font/woff2" crossorigin>`
	)
	.join('\n');

// ---- CSS and script, fingerprinted the same way ----
const css =
	`/* Colour tokens: copied from src/lib/styles/colors.css by site/build.ts. */\n` +
	themeCss(readFileSync(join(repo, 'src/lib/styles/colors.css'), 'utf8')) +
	'\n' +
	faces.join('\n') +
	'\n' +
	readFileSync(join(site, 'src/site.css'), 'utf8');
const order = readFileSync(join(site, 'src/order.js'), 'utf8').replace(/^export /gm, '');
const js = `${order}\n${readFileSync(join(site, 'src/site.js'), 'utf8')}`;
const cssName = `site.${fingerprint(css)}.css`;
const jsName = `site.${fingerprint(js)}.js`;
writeFileSync(join(out, cssName), css);
writeFileSync(join(out, jsName), js);

const icons: Record<string, string> = {};
for (const icon of ['favicon-32.png', 'apple-touch-icon.png']) {
	const data = readFileSync(join(repo, 'static/icons', icon));
	icons[icon] = hashed(icon, data);
	writeFileSync(join(out, icons[icon]), data);
}

const html = renderPage({
	release,
	solver,
	captures,
	help: DEFAULT_HELP,
	assets: {
		css: cssName,
		js: jsName,
		favicon: icons['favicon-32.png'],
		touchIcon: icons['apple-touch-icon.png']
	},
	fonts: preload
});
writeFileSync(join(out, 'index.html'), html);
writeFileSync(
	join(out, 'version.json'),
	JSON.stringify({ release: release.version, built: new Date().toISOString() }) + '\n'
);
console.log(
	`site: ${release.version} → ${out}${offline ? ' (offline: no FlareSolverr sizes)' : ''}`
);

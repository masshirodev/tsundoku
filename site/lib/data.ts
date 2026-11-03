// What the page says that the build reads rather than types: the release, the
// colours, and the fonts. Pure functions over strings and bytes, so the tests
// can hand them anything; site/build.ts does the reading.

import {
	openManifest,
	VERSION_RE,
	type ReleaseFile
} from '../../src/lib/server/update-manifest.ts';

/** The download host. Every link on the page points under it. */
export const DL = 'https://dl.tsundoku.masshiro.pro';

export type Download = { name: string; size: number; href: string };

export type Release = {
	version: string;
	/** YYYY-MM-DD */
	date: string;
	/** The release's notes for friends, one paragraph per line. */
	notes: string[];
	installer: Download;
	zip: Download;
	archive: Download;
};

const link = (f: ReleaseFile): Download => ({
	name: f.name,
	size: f.size,
	// latest/ is the lasting link (ops/release/publish.ts publishes unversioned
	// names), so a page built a day late still downloads the newest.
	href: `${DL}/latest/${f.name}`
});

/**
 * The release a latest.json announces, opened exactly as an installed copy
 * opens it (`openManifest`, the release key in every build). Throws if the
 * signature or the shape is wrong: a page must never offer files the release
 * key didn't sign for.
 */
export function readRelease(text: string, key?: string): Release {
	const opened = key === undefined ? openManifest(text) : openManifest(text, key);
	if (!opened.ok) throw new Error(`latest.json refused: ${opened.reason}`);
	const m = opened.manifest;
	if (!VERSION_RE.test(m.version)) throw new Error(`latest.json: bad version ${m.version}`);
	if (!/^\d{4}-\d{2}-\d{2}$/.test(m.date)) throw new Error(`latest.json: bad date ${m.date}`);
	const installer = m.files['win-x64']?.installer;
	const zip = m.files['win-x64']?.zip;
	const archive = m.files['linux-x64']?.archive;
	if (!installer || !zip || !archive)
		throw new Error(
			'latest.json: a Windows installer, a Windows zip and a Linux archive are all required'
		);
	return {
		version: m.version,
		date: m.date,
		notes: m.notes
			.split('\n')
			.map((l) => l.trim())
			.filter(Boolean),
		installer: link(installer),
		zip: link(zip),
		archive: link(archive)
	};
}

/** FlareSolverr's two downloads, under the names publish.ts gives them. */
export function solverNames(version: string): { windows: string; linux: string } {
	if (!/^[\w.-]+$/.test(version)) throw new Error(`bad FlareSolverr version ${version}`);
	return {
		windows: `flaresolverr-${version}-win-x64.zip`,
		linux: `flaresolverr-${version}-linux-x64.tar.gz`
	};
}

/**
 * A size as a friend reads it: whole megabytes, in the 1024² units Windows'
 * Explorer shows, so the number on the page is the one in the Downloads folder.
 */
export function megabytes(bytes: number): string {
	if (!Number.isFinite(bytes) || bytes <= 0) return '';
	return `${Math.max(1, Math.round(bytes / 1048576))} MB`;
}

const MONTHS = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];

/** 2026-11-01 → 01 NOV 2026, the chrome's date. */
export function chromeDate(date: string): string {
	const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
	if (!m || Number(m[2]) < 1 || Number(m[2]) > 12) throw new Error(`bad date ${date}`);
	return `${m[3]} ${MONTHS[Number(m[2]) - 1]} ${m[1]}`;
}

const ENTITIES: Record<string, string> = {
	'&': '&amp;',
	'<': '&lt;',
	'>': '&gt;',
	'"': '&quot;',
	"'": '&#39;'
};

/** Text into HTML, for content and attribute values alike. */
export function esc(s: string): string {
	return s.replace(/[&<>"']/g, (c) => ENTITIES[c]);
}

/**
 * The app's colour tokens, as site CSS. colors.css declares the dark palette
 * on `:root` and the light one under `[data-theme='light']`; the site keeps
 * both and adds the system's preference, which the app leaves to its cookie:
 * a visitor who never touched the toggle gets their system's palette. Only
 * custom properties are copied, so nothing else of the app's CSS leaks in.
 */
export function themeCss(colors: string): string {
	const block = (selector: RegExp): string => {
		const m = selector.exec(colors);
		if (!m) throw new Error(`colors.css: no block for ${selector}`);
		const body = colors.slice(m.index + m[0].length);
		const end = body.indexOf('}');
		if (end < 0) throw new Error(`colors.css: unclosed block for ${selector}`);
		const decls = body
			.slice(0, end)
			.replace(/\/\*[\s\S]*?\*\//g, '')
			.split(';')
			.map((d) => d.trim())
			.filter((d) => d.startsWith('--') || d.startsWith('color-scheme'));
		if (!decls.some((d) => d.startsWith('--')))
			throw new Error(`colors.css: empty block ${selector}`);
		return decls.map((d) => `\t${d};`).join('\n');
	};
	const dark = block(/:root\s*\{/);
	const light = block(/\[data-theme='light'\]\s*\{/);
	return [
		`:root {\n${dark}\n}`,
		`@media (prefers-color-scheme: light) {\n:root:not([data-theme='dark']) {\n${light}\n}\n}`,
		`:root[data-theme='light'] {\n${light}\n}`
	].join('\n');
}

/** One @font-face from a Fontsource stylesheet: its file and unicode-range. */
export type FontFace = { file: string; ranges: [number, number][] };

/** The faces of a Fontsource CSS file, with the unicode ranges each covers. */
export function fontFaces(css: string): FontFace[] {
	const out: FontFace[] = [];
	for (const m of css.matchAll(/@font-face\s*\{([^}]*)\}/g)) {
		const body = m[1];
		const file = /url\(\.\/files\/([^)]+\.woff2)\)/.exec(body)?.[1];
		const range = /unicode-range:\s*([^;]+);/.exec(body)?.[1];
		if (!file || !range) continue;
		const ranges = range.split(',').map((r): [number, number] => {
			const [a, b] = r.trim().replace(/^U\+/i, '').split('-');
			return [parseInt(a, 16), parseInt(b ?? a, 16)];
		});
		out.push({ file, ranges });
	}
	return out;
}

/**
 * The Fontsource chunks that hold every character of `text`, and nothing
 * more. Plex Sans JP comes in about 120 unicode-range chunks; the page uses
 * three characters of it (積ん読), so it ships the few chunks those live in.
 */
export function facesFor(faces: FontFace[], text: string): FontFace[] {
	const need = [...new Set([...text].map((c) => c.codePointAt(0)!))];
	const picked = new Set<FontFace>();
	for (const cp of need) {
		const face = faces.find((f) => f.ranges.some(([a, b]) => cp >= a && cp <= b));
		if (!face) throw new Error(`no font chunk holds U+${cp.toString(16).toUpperCase()}`);
		picked.add(face);
	}
	return [...picked];
}

import { existsSync } from 'node:fs';
import { readdir, readFile, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { parseContent, planHentoidBook, type HentoidFolder } from '../../import/hentoid-plan.ts';
import type { PlannedSeries } from '../../import/plan.ts';

/**
 * The Hentoid importer's disk side (doc/IMPORT-HENTOID.md): the owner's copy
 * of `H/.Hentoid/`, read in place. Each `<site folder>/<book folder>/` with
 * images is a book; contentV2.json, when present, says everything else.
 */

const IMAGE = /\.(jpe?g|png|webp|gif|avif|jxl)$/i;

/**
 * The Hentoid folder under the library folder: `H/.Hentoid` as the phone
 * keeps it, `.Hentoid`, or `Hentoid` as the tablet copy was named.
 */
export function hentoidRoot(libraryRoot: string): string | null {
	for (const p of [['H', '.Hentoid'], ['.Hentoid'], ['Hentoid']]) {
		const path = join(libraryRoot, ...p);
		if (existsSync(path)) return path;
	}
	return null;
}

async function dirs(path: string): Promise<string[]> {
	try {
		return (await readdir(path, { withFileTypes: true }))
			.filter((d) => d.isDirectory())
			.map((d) => d.name);
	} catch {
		return [];
	}
}

/** Book folders, relative to the root: "nhentai2/ - Title - [1002]". */
export async function bookFolders(root: string): Promise<string[]> {
	const out: string[] = [];
	for (const site of await dirs(root))
		for (const book of await dirs(join(root, site))) out.push(`${site}/${book}`);
	return out;
}

export async function hentoidBytes(root: string): Promise<number> {
	let total = 0;
	for (const folder of await bookFolders(root))
		for (const e of await readdir(join(root, folder), { withFileTypes: true }))
			if (e.isFile() && IMAGE.test(e.name)) total += (await stat(join(root, folder, e.name))).size;
	return total;
}

async function readFolder(root: string, folder: string): Promise<HentoidFolder | null> {
	const path = join(root, folder);
	const names = (await readdir(path, { withFileTypes: true }))
		.filter((e) => e.isFile())
		.map((e) => e.name);
	const files = names
		.filter((n) => IMAGE.test(n))
		.sort((a, b) => a.localeCompare(b, 'en', { numeric: true, sensitivity: 'base' }));
	let bytes = 0;
	for (const f of files) bytes += (await stat(join(path, f))).size;
	let content = null;
	if (names.includes('contentV2.json')) {
		try {
			content = parseContent(JSON.parse(await readFile(join(path, 'contentV2.json'), 'utf8')));
		} catch {
			// A broken JSON still leaves a readable folder of images.
			content = null;
		}
	}
	return { folder, files, bytes, content };
}

export async function planHentoidFolder(
	root: string,
	progress: (p: { bytes: number; failed: boolean }) => void,
	now: number
): Promise<{ series: PlannedSeries[]; folders: Set<string>; pageless: Set<string> }> {
	const series: PlannedSeries[] = [];
	const folders = new Set<string>();
	// Folders there, but with no pages: downloads that failed (Hentoid's
	// status ERROR), or its "(1)" copies holding only the thumbnail. Not books.
	const pageless = new Set<string>();
	for (const folder of await bookFolders(root)) {
		try {
			const f = await readFolder(root, folder);
			if (!f) continue;
			const planned = planHentoidBook(f, root, now);
			if (planned.entries.length === 0) {
				pageless.add(folder);
				progress({ bytes: 0, failed: false });
				continue;
			}
			folders.add(folder);
			series.push(planned);
			progress({ bytes: f.bytes, failed: false });
		} catch {
			progress({ bytes: 0, failed: true });
		}
	}
	return { series, folders, pageless };
}

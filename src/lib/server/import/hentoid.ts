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

/** `H/.Hentoid` under the library folder, where the device keeps it. */
export function hentoidRoot(libraryRoot: string): string | null {
	const path = join(libraryRoot, 'H', '.Hentoid');
	return existsSync(path) ? path : null;
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
	if (files.length === 0) return null;
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
): Promise<{ series: PlannedSeries[]; folders: Set<string> }> {
	const series: PlannedSeries[] = [];
	const folders = new Set<string>();
	for (const folder of await bookFolders(root)) {
		try {
			const f = await readFolder(root, folder);
			if (!f) continue;
			folders.add(folder);
			series.push(planHentoidBook(f, root, now));
			progress({ bytes: f.bytes, failed: false });
		} catch {
			progress({ bytes: 0, failed: true });
		}
	}
	return { series, folders };
}

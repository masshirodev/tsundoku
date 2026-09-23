import { existsSync } from 'node:fs';
import { readdir, readFile, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { gunzipSync } from 'node:zlib';
import { pageMembers, readMember, withZip } from '../zip.ts';
import { parseComicInfo, type ComicInfo } from '../../import/comicinfo.ts';
import { decodeBackup, type MihonBackup } from '../../import/mihon-backup.ts';
import {
	planMihon,
	type DownloadedChapter,
	type DownloadedSeries,
	type MihonPlan
} from '../../import/mihon-plan.ts';
import type { LocalFolder } from '../../import/mihon-local-plan.ts';

/**
 * The Mihon importer (doc/IMPORT-MIHON.md). It reads a copy of the device's
 * `Mihon/` folder -- `downloads/` and `autobackup/` -- in place, without
 * moving a file, and writes the library from it.
 *
 * Idempotent: a rescan finds each series by its origin key and each chapter
 * by its source URL, adds what is new, attaches files that have arrived,
 * moves read state forward, and leaves alone everything the owner may have
 * edited since (rating, shelves, tags, hidden, title).
 */

const IMAGE = /\.(jpe?g|png|webp|gif|avif|jxl)$/i;

async function dirs(path: string): Promise<string[]> {
	try {
		return (await readdir(path, { withFileTypes: true }))
			.filter((d) => d.isDirectory() && !d.name.startsWith('.') && !d.name.endsWith('_tmp'))
			.map((d) => d.name);
	} catch {
		return [];
	}
}

/** The newest backup, by name: Mihon names them `app.mihon_<date>_<time>.tachibk`. */
export async function newestBackup(root: string): Promise<string | null> {
	const folder = join(root, 'autobackup');
	try {
		// By the date in the name: `app.mihon_…` and a debug build's
		// `app.mihon.debug_…` would not sort together by name.
		const stamp = (n: string) => /(\d{4}-\d{2}-\d{2}_\d{2}-\d{2})/.exec(n)?.[1] ?? n;
		const names = (await readdir(folder))
			.filter((n) => /\.(tachibk|proto\.gz)$/.test(n))
			.sort((a, b) => stamp(a).localeCompare(stamp(b)));
		return names.length ? join(folder, names[names.length - 1]) : null;
	} catch {
		return null;
	}
}

export async function readBackup(path: string): Promise<MihonBackup> {
	return decodeBackup(gunzipSync(await readFile(path)));
}

async function readChapter(path: string, file: string): Promise<DownloadedChapter> {
	const full = join(path, file);
	const info = await stat(full);
	if (info.isDirectory()) {
		// Mihon without "save as CBZ": a folder of images per chapter.
		const names = await readdir(full);
		const xml = names.includes('ComicInfo.xml')
			? await readFile(join(full, 'ComicInfo.xml'), 'utf8')
			: null;
		let bytes = 0;
		for (const n of names) bytes += (await stat(join(full, n))).size;
		return {
			file,
			bytes,
			pages: names.filter((n) => IMAGE.test(n)).length,
			info: xml ? parseComicInfo(xml) : null
		};
	}
	return withZip(full, async (fh, members) => {
		const comic = members.find((m) => m.name.toLowerCase() === 'comicinfo.xml');
		const parsed: ComicInfo | null = comic
			? parseComicInfo((await readMember(fh, comic)).toString('utf8'))
			: null;
		return { file, bytes: info.size, pages: pageMembers(members).length, info: parsed };
	});
}

/** Every downloaded series under `<root>/downloads/<source>/<series>/`. */
export async function scanDownloads(
	root: string,
	progress: (p: { bytes: number; failed: boolean }) => void = () => {}
): Promise<DownloadedSeries[]> {
	const out: DownloadedSeries[] = [];
	for (const downloads of await downloadFolders(root))
		for (const sourceDir of await dirs(downloads)) {
			for (const dir of await dirs(join(downloads, sourceDir))) {
				const path = join(downloads, sourceDir, dir);
				const chapters: DownloadedChapter[] = [];
				for (const entry of await readdir(path, { withFileTypes: true })) {
					const isChapter =
						(entry.isFile() && /\.cbz$/i.test(entry.name)) ||
						(entry.isDirectory() && !entry.name.startsWith('.') && !entry.name.endsWith('_tmp'));
					if (!isChapter) continue;
					try {
						const c = await readChapter(path, entry.name);
						chapters.push(c);
						progress({ bytes: c.bytes, failed: false });
					} catch {
						progress({ bytes: 0, failed: true });
					}
				}
				// The local source's own folder is planned apart (scanLocal).
				if (chapters.length && sourceDir !== 'local') out.push({ sourceDir, dir, path, chapters });
			}
		}
	return out;
}

/**
 * Every downloads folder: Android sometimes leaves `downloads (1)`,
 * `downloads (2)`... beside the real one when a folder is recreated, and
 * any of them may hold chapters.
 */
export async function downloadFolders(root: string): Promise<string[]> {
	return (await dirs(root))
		.filter((d) => /^downloads( \(\d+\))?$/.test(d))
		.map((d) => join(root, d));
}

/** Mihon's local source: `<root>/local/<series>/<chapter folder or archive>` and a cover beside them. */
export async function scanLocal(
	root: string,
	progress: (p: { bytes: number; failed: boolean }) => void = () => {}
): Promise<LocalFolder[]> {
	const local = join(root, 'local');
	const out: LocalFolder[] = [];
	for (const dir of await dirs(local)) {
		const path = join(local, dir);
		const chapters: DownloadedChapter[] = [];
		let cover: string | null = null;
		for (const entry of await readdir(path, { withFileTypes: true })) {
			if (entry.isFile() && /^cover\.(jpe?g|png|webp)$/i.test(entry.name)) {
				cover = entry.name;
				continue;
			}
			const isChapter =
				(entry.isFile() && /\.(cbz|zip)$/i.test(entry.name)) ||
				(entry.isDirectory() && !entry.name.startsWith('.'));
			if (!isChapter) continue;
			try {
				const c = await readChapter(path, entry.name);
				if (c.pages === 0) continue;
				chapters.push(c);
				progress({ bytes: c.bytes, failed: false });
			} catch {
				progress({ bytes: 0, failed: true });
			}
		}
		if (chapters.length) out.push({ sourceDir: 'local', dir, path, chapters, cover });
	}
	return out;
}

/** Bytes of the local folder's chapters, for the progress band's total. */
export async function localBytes(root: string): Promise<number> {
	let total = 0;
	const local = join(root, 'local');
	for (const d of await dirs(local))
		for (const e of await readdir(join(local, d), { withFileTypes: true })) {
			const p = join(local, d, e.name);
			if (e.isFile() && /\.(cbz|zip)$/i.test(e.name)) total += (await stat(p)).size;
			else if (e.isDirectory())
				for (const f of await readdir(p, { withFileTypes: true }))
					if (f.isFile()) total += (await stat(join(p, f.name))).size;
		}
	return total;
}

/** Bytes of every chapter archive, for the progress band's total. */
export async function downloadBytes(root: string): Promise<number> {
	let total = 0;
	for (const downloads of await downloadFolders(root))
		for (const s of await dirs(downloads))
			for (const d of await dirs(join(downloads, s))) {
				for (const e of await readdir(join(downloads, s, d), { withFileTypes: true })) {
					if (e.isFile() && /\.cbz$/i.test(e.name))
						total += (await stat(join(downloads, s, d, e.name))).size;
				}
			}
	return total;
}

// ---- planning a run -------------------------------------------------------------

/** Where the owner's copy of the device's `Mihon/` folder lives. */
export function mihonRoot(libraryRoot: string): string | null {
	const path = join(libraryRoot, 'Mihon');
	return existsSync(path) ? path : null;
}

/** Read the folder and work out the plan. Writing is the runner's (index.ts). */
export async function planMihonFolder(
	root: string,
	progress: (p: { bytes: number; failed: boolean }) => void,
	now: number
): Promise<MihonPlan & { backup: string | null }> {
	const downloads = await scanDownloads(root, progress);
	const backupPath = await newestBackup(root);
	const backup = backupPath ? await readBackup(backupPath) : null;
	return { ...planMihon(backup, downloads, now), backup: backupPath };
}

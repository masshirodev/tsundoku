import { existsSync, readdirSync } from 'node:fs';
import { readdir, readFile, stat } from 'node:fs/promises';
import { basename, dirname, join } from '../fspath.ts';
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
import type { PlannedSeries } from '../../import/plan.ts';

/**
 * The Mihon importer (doc/IMPORT-MIHON.md). It reads a Mihon backup at
 * `<library>/Mihon/autobackup` and, for tsundoku's own device only, that
 * device's `downloads/` -- in place, without moving a file -- and writes the
 * library from them. No other device's `Mihon/` folder is read (c191).
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

/** What a backup is called: Mihon's `.tachibk`, and the older `.proto.gz`. */
const BACKUP = /\.(tachibk|proto\.gz)$/;

/** Where a `Mihon/` folder's backups are looked for: what an empty one says it searched. */
export const backupFolder = (root: string): string => join(root, 'autobackup');

/** The backups in a folder, oldest first by the date in the name. */
function byDate(names: string[]): string[] {
	// By the date in the name: `app.mihon_…` and a debug build's
	// `app.mihon.debug_…` would not sort together by name.
	const stamp = (n: string) => /(\d{4}-\d{2}-\d{2}_\d{2}-\d{2})/.exec(n)?.[1] ?? n;
	return names.filter((n) => BACKUP.test(n)).sort((a, b) => stamp(a).localeCompare(stamp(b)));
}

/** The newest backup, by name: Mihon names them `app.mihon_<date>_<time>.tachibk`. */
export async function newestBackup(root: string): Promise<string | null> {
	const folder = backupFolder(root);
	try {
		const names = byDate(await readdir(folder));
		return names.length ? join(folder, names[names.length - 1]) : null;
	} catch {
		return null;
	}
}

/**
 * Whether a `Mihon/` folder holds a backup to read (c268, c292): the same
 * names newestBackup reads, asked synchronously, because the list of sources
 * is built before a job starts and an empty folder must refuse with where it
 * looked rather than start a scan that finds nothing.
 */
export function hasBackup(root: string): boolean {
	try {
		return byDate(readdirSync(backupFolder(root))).length > 0;
	} catch {
		return false;
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
				const s = await scanSeriesDir(join(downloads, sourceDir, dir), progress);
				if (s) out.push(s);
			}
		}
	return out;
}

/**
 * One series' folder, `<root>/downloads/<source>/<series>/`, as scanDownloads
 * reads it: what a download attaches at once (attachWritten, import/index.ts). Null for a folder
 * with no chapter, or the local source's.
 */
export async function scanSeriesDir(
	path: string,
	progress: (p: { bytes: number; failed: boolean }) => void = () => {}
): Promise<DownloadedSeries | null> {
	const sourceDir = basename(dirname(path));
	const dir = basename(path);
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
	// Every chapter is a folder of images or an archive: no local source to skip.
	return chapters.length ? { sourceDir, dir, path, chapters } : null;
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

/** Bytes of the newest backup, for the progress band's total. */
export async function backupBytes(root: string): Promise<number> {
	const path = await newestBackup(root);
	return path ? (await stat(path)).size : 0;
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

/** Where a `Mihon/` folder lives: the library's own, or a device's copy of one. */
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

/**
 * The backup on its own: the one import that survives c191, for a friend
 * moving here from Mihon. Nothing downloaded is read, and nothing on disk is
 * marked gone -- the folder is a place to drop a backup, not a device copy
 * (doc/IMPORT-MIHON.md, "Where it reads from").
 */
export async function planMihonBackup(
	root: string,
	now: number
): Promise<MihonPlan & { backup: string | null }> {
	const backupPath = await newestBackup(root);
	const backup = backupPath ? await readBackup(backupPath) : null;
	return { ...planMihon(backup, [], now), backup: backupPath };
}

/**
 * The one series a chapter file belongs to, planned as planMihonFolder plans
 * it: the same backup, so the series and entries are the ones a scan makes.
 * Only that series: the backup's others aren't this download's to mark.
 */
export async function planMihonSeries(
	root: string,
	file: string,
	now: number
): Promise<PlannedSeries[]> {
	const d = await scanSeriesDir(dirname(file));
	if (!d) return [];
	const backupPath = await newestBackup(root);
	const backup = backupPath ? await readBackup(backupPath) : null;
	return planMihon(backup, [d], now).series.filter((s) => s.path === d.path);
}

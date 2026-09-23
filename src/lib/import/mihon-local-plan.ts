import type { DownloadedSeries } from './mihon-plan';
import type { MihonBackup, MihonManga } from './mihon-backup';
import type { PlannedEntry, PlannedSeries } from './plan';
import { chapterTitle } from './mihon-plan.ts';
import { titleFromFolder } from './hentoid-plan.ts';

/**
 * Mihon's local folder (doc/IMPORT-MIHON.md, "Local source"): books the owner
 * put on the tablet by hand -- on this tablet, 2136 Hentoid exports, each a
 * `chapter_1` folder and a `cover.jpg`, named `artist - Title - [id]`. The
 * `[id]` is the gallery's real id (the same one Hentoid's contentV2.json
 * has), not something Mihon made up: Mihon uses the folder name as the local
 * manga's URL. They import as single books into a hidden root, and the ones
 * that are also in Hentoid are left for the duplicate-detection card.
 *
 * The backup knows some of them (source 0), with read state: that is
 * carried over when the folder name matches.
 */

/** "mori - Title - [1004]" -> "mori"; nothing for " - Title - [1]". */
export function artistFromFolder(dir: string): string {
	const dash = dir.indexOf(' - ');
	return dash > 0 ? dir.slice(0, dash).trim() : '';
}

export type LocalFolder = DownloadedSeries & { cover: string | null };

export function planMihonLocal(
	backup: MihonBackup | null,
	folders: LocalFolder[],
	rootPath: string,
	now = Date.now()
): PlannedSeries[] {
	const known = new Map<string, MihonManga>();
	for (const m of backup?.manga ?? []) if (m.source === '0') known.set(m.url, m);

	return folders.map((d): PlannedSeries => {
		const m = known.get(d.dir) ?? null;
		const history = new Map((m?.history ?? []).map((h) => [h.url, h]));
		const title = titleFromFolder(d.dir);
		const chapters = [...d.chapters].sort((a, b) =>
			a.file.localeCompare(b.file, 'en', { numeric: true, sensitivity: 'base' })
		);
		const single = chapters.length === 1;
		const entries: PlannedEntry[] = chapters.map((f, i) => {
			const url = `${d.dir}/${f.file}`;
			const c = m?.chapters.find((x) => x.url === url) ?? null;
			const h = history.get(url) ?? null;
			const readAt = c?.read ? h?.lastRead || c.dateFetch || now : null;
			return {
				position: i + 1,
				label: single ? 'Book' : `Ch. ${i + 1}`,
				title: single ? title : chapterTitle(f.file) || f.file,
				sourceUrl: url,
				available: true,
				file: url,
				bytes: f.bytes,
				pageCount: f.pages,
				addedAt: c?.dateFetch || m?.dateAdded || now,
				readAt,
				lastPosition: c && !c.read && (c.lastPageRead > 0 || h) ? c.lastPageRead : null,
				lastOpenedAt: h?.lastRead || readAt,
				history:
					h && c
						? { at: h.lastRead, finished: c.read, page: c.lastPageRead, durationMs: h.readDuration }
						: null,
				// cover.jpg sits beside the chapter folder, not in it.
				coverFile: i === 0 && d.cover ? `../${d.cover}` : null
			};
		});
		const artist = artistFromFolder(d.dir);
		return {
			originKey: `mihon-local:${d.dir}`,
			source: 'mihon',
			title,
			kind: 'doujin',
			rating: 0,
			favourite: false,
			// The root is hidden; the series itself needn't be.
			hidden: false,
			shelves: [],
			tags: [
				...(artist ? [{ namespace: 'artist', value: artist }] : []),
				{ namespace: 'source', value: 'mihon local' }
			],
			description: '',
			status: '',
			direction: null,
			addedAt: m?.dateAdded ?? now,
			sourceUrl: d.dir,
			path: rootPath,
			entries
		};
	});
}

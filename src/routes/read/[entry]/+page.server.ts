import { error, redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import { getDb } from '$lib/server/db';
import { isIncognito, isRevealed } from '$lib/server/prefs';
import { seriesPage } from '$lib/server/series';
import { manifest } from '$lib/server/pages';
import { ocrStatus } from '$lib/server/japanese/ocr';
import { automaticCover } from '$lib/server/covers';
import { epubVersions } from '$lib/server/epub';
import { effectiveDirection, isBookSeries } from '$lib/library/series';
import { entryName, modeOf, spelledOut } from '$lib/reader/reader';
import { bookEditions } from '$lib/server/editions';
import { baseToEdition } from '$lib/library/editions';

/**
 * The reader (doc/READER.md). `/read/<entry>?p=<page>`, `p` 1-based. With no
 * `p` it resumes where the entry was left, or starts it.
 */
export const load: PageServerLoad = async ({ params, url, cookies }) => {
	const reveal = isRevealed(cookies);
	const entryId = Number(params.entry);
	const row = getDb()
		.prepare(`SELECT series_id, edition_of, title, page_count FROM entries WHERE id = ?`)
		.get(entryId) as
		{ series_id: number; edition_of: number | null; title: string; page_count: number } | undefined;
	// Hidden means hidden: a hidden series is the same 404 as a missing one.
	const series = row ? seriesPage(row.series_id, reveal) : null;
	if (!series) error(404, 'not found');

	// A folded book (doc/EDITIONS.md): one book, read in any of its languages.
	const folded = series.kind === 'doujin' ? bookEditions(series.id) : null;
	const p0 = url.searchParams.get('p');
	if (folded && !row!.edition_of && !url.searchParams.has('ed') && folded.opens !== entryId) {
		// The book itself opens in its opening edition, at the same page.
		const to = folded.editions.find((e) => e.entryId === folded.opens)!;
		const asked = Number(p0);
		const q =
			Number.isInteger(asked) && asked >= 1
				? `?p=${baseToEdition(to.rows, asked - 1).page + 1}`
				: '';
		redirect(307, `/read/${to.entryId}${q}`);
	}
	const edition = folded?.editions.find((e) => e.entryId === entryId) ?? null;
	const index = series.entries.findIndex((e) => e.id === (row!.edition_of ?? entryId));
	const baseEntry = series.entries[index];
	// An edition reads as the book: its own pages and title, the book's place in them.
	const entry =
		baseEntry && row!.edition_of && edition
			? {
					...baseEntry,
					id: entryId,
					title: row!.title,
					pageCount: row!.page_count,
					lastPosition:
						baseEntry.lastPosition === null
							? null
							: baseToEdition(edition.rows, baseEntry.lastPosition).page
				}
			: baseEntry;
	if (!entry) {
		// A copy of a chapter another copy represents (doc/DUPLICATES.md): an
		// old link, or a cached screen, opens the chapter it stands for.
		const rep = getDb()
			.prepare(
				`SELECT r.id FROM entries c JOIN entries r
					ON r.series_id = c.series_id AND r.position = c.position AND r.shadowed = 0
				WHERE c.id = ? AND c.shadowed = 1 LIMIT 1`
			)
			.get(entryId) as { id: number } | undefined;
		if (rep) redirect(307, `/read/${rep.id}${url.search}`);
		error(404, 'not found');
	}

	// An episode is watched in the player, card c156 (doc/ANIME.md); until it's
	// built there is nothing here to open one with.
	if (series.kind === 'anime') error(404, 'not found');

	// A novel is read as text, from its EPUB (doc/TEXT-READER.md).
	if (series.kind === 'novel') {
		// One EPUB per volume: a novel grouped from several books reads each
		// from its own file (doc/BOOKS.md).
		const versions = await epubVersions(series.id, reveal);
		const version = versions[entry.file] ?? null;
		return {
			text: true as const,
			series,
			entry: {
				id: entry.id,
				index,
				label: entry.label,
				locator: entry.locator,
				matter: entry.matter,
				readAt: entry.readAt,
				lastPosition: entry.lastPosition,
				lastOffset: entry.lastOffset
			},
			layout: effectiveDirection(series) === 'scroll' ? ('scroll' as const) : ('paged' as const),
			version,
			/** "1 EPUB · 3.1 MB" while it opens: the file's size, from its version. */
			bytes: version && /^\d+-/.test(version) ? Number(version.split('-')[0]) : 0,
			versions,
			incognito: isIncognito(cookies)
		};
	}

	const books = isBookSeries(series);
	const name = (i: number) =>
		series.entries[i] ? entryName(series.entries[i], series.kind, books ? i : undefined) : null;
	const neighbour = (i: number) => {
		const e = series.entries[i];
		return e
			? {
					id: e.id,
					name: name(i)!,
					// What the boundary pages call it: its own title, or "Chapter 42".
					title: e.title || spelledOut(books ? `Book ${i + 1}` : e.label),
					pageCount: e.pageCount,
					available: e.available,
					/** Its text read by OCR already: the end page says so (doc/JAPANESE.md). */
					ocr: !!(
						getDb().prepare(`SELECT ocr_at FROM entries WHERE id = ?`).get(e.id) as
							{ ocr_at: number | null } | undefined
					)?.ocr_at
				}
			: null;
	};

	const m = await manifest(entryId, reveal);
	const coverRow = getDb()
		.prepare(`SELECT cover_entry, cover_page FROM series WHERE id = ?`)
		.get(series.id) as { cover_entry: number | null; cover_page: number | null };
	const withCoverFile = new Set(
		(
			getDb()
				.prepare(
					`SELECT id FROM entries WHERE series_id = ? AND cover_file IS NOT NULL AND cover_file != ''`
				)
				.all(series.id) as { id: number }[]
		).map((r) => r.id)
	);
	const pages = m?.pages ?? [];
	const p = p0;
	const asked = Number(p);
	// `p=last`: stepping back from the next chapter's first page lands here.
	const start =
		p === 'last'
			? Math.max(0, pages.length - 1)
			: Number.isInteger(asked) && asked >= 1
				? Math.min(asked - 1, Math.max(0, pages.length - 1))
				: entry.readAt === null && entry.lastPosition !== null
					? Math.min(entry.lastPosition, Math.max(0, pages.length - 1))
					: 0;

	return {
		text: false as const,
		series: {
			id: series.id,
			title: edition?.title || series.title,
			kind: series.kind,
			rating: series.rating,
			favourite: series.favourite,
			direction: series.direction,
			defaultMode: modeOf(effectiveDirection({ kind: series.kind, direction: null })),
			mode: modeOf(effectiveDirection(series)),
			books,
			count: series.entries.length,
			single: series.entries.length === 1,
			hidden: series.hidden,
			// For the device cache policy: what comes next, and what is on disk.
			entries: series.entries.map((e) => ({
				id: e.id,
				position: e.number,
				label: e.label,
				readAt: e.readAt,
				available: e.available,
				// The page menu (c26): each entry's own cover, and whether its files carry one.
				coverPage: e.coverPage,
				hasCoverFile: withCoverFile.has(e.id)
			})),
			// Where the series' tile comes from: the page menu says it, and offers the way back.
			cover: {
				chosen:
					coverRow.cover_entry !== null && coverRow.cover_page !== null
						? { entry: coverRow.cover_entry, page: coverRow.cover_page }
						: null,
				automatic: automaticCover(series.id)
			}
		},
		entry: {
			id: entry.id,
			index,
			name: name(index)!,
			title: entry.title,
			readAt: entry.readAt,
			rating: entry.rating,
			favourite: entry.favourite
		},
		manifest: m,
		pages,
		start,
		prev: neighbour(index - 1),
		next: neighbour(index + 1),
		/** Japanese: its pages get text blocks to look words up in (doc/JAPANESE.md). */
		ocr: ocrStatus(series.id),
		incognito: isIncognito(cookies),
		/** Its languages, for the switch in the top bar; null for a book in one. */
		editions: folded
			? {
					current: entryId,
					list: folded.editions.map((e) => ({
						entryId: e.entryId,
						code: e.code,
						base: e.base,
						pages: e.pages,
						rows: e.rows,
						title: e.title
					}))
				}
			: null
	};
};

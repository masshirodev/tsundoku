import { error, fail, redirect } from '@sveltejs/kit';
import { playerStart } from '$lib/server/anime/choices';
import type { Actions, PageServerLoad } from './$types';
import { getDb } from '$lib/server/db';
import { isIncognito, isRevealed } from '$lib/server/prefs';
import { seriesPage } from '$lib/server/series';
import type { SeriesPage } from '$lib/library/series';
import { seriesHighlights } from '$lib/server/highlights';
import { entriesLine } from '$lib/reader/library-row';
import { manifest } from '$lib/server/pages';
import { ocrStatus } from '$lib/server/japanese/ocr';
import { automaticCover } from '$lib/server/covers';
import { epubVersions } from '$lib/server/epub';
import { effectiveDirection, isBookSeries } from '$lib/library/series';
import { entryName, modeOf, spelledOut } from '$lib/reader/reader';
import { bookEditions } from '$lib/server/editions';
import { baseToEdition } from '$lib/library/editions';
import { parseAnimeKey, parseKey } from '$lib/library/downloads';
import { readsOnline } from '$lib/server/pages/online';
import { novelReadsOnline, onlineChapters, ONLINE_VERSION } from '$lib/server/novels/online';
import { EngineError } from '$lib/server/engine/client';
import { previewIdOf } from '$lib/server/downloads';
import { noVideoLine, staleSource } from '$lib/server/move';
import { workEndOf } from '$lib/server/works';
import { pageHighlights } from '$lib/server/highlights/pages';
import { quoteHighlights } from '$lib/server/highlights/quotes';
import { parseTextDirection } from '$lib/reader/text';
import { setTextDirection, takesTextDirection, textDirectionOf } from './text-direction.server';

/**
 * The reader (doc/READER.md). `/read/<entry>?p=<page>`, `p` 1-based. With no
 * `p` it resumes where the entry was left, or starts it.
 */
/**
 * The end page's DELETE confirmation (c655): the series screen's own first line,
 * and how many highlights the delete would leave orphaned (c701).
 */
function deleteAsk(series: SeriesPage, reveal: boolean) {
	return {
		entries: entriesLine(series.entries),
		highlights: seriesHighlights(series.id, reveal).length
	};
}

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

	// An episode is watched in the player (doc/ANIME.md, "The player").
	if (series.kind === 'anime') {
		const row = getDb()
			.prepare(`SELECT origin_key, in_library FROM series WHERE id = ?`)
			.get(series.id) as { origin_key: string | null; in_library: number };
		const key = parseAnimeKey(row.origin_key);
		const episodes = series.entries.map((e) => ({
			id: e.id,
			number: e.episode?.number ?? e.number,
			season: e.episode?.season ?? null,
			title: e.title,
			note: e.episode?.note ?? '',
			durationS: e.episode?.durationS ?? null,
			endingAt: e.episode?.endingAt ?? null,
			thumb: e.episode?.thumb ?? '',
			available: e.available,
			readAt: e.readAt,
			lastPosition: e.lastPosition
		}));
		return {
			text: false as const,
			video: true as const,
			series: { id: series.id, title: series.title, hidden: series.hidden },
			// A browsing record (doc/BROWSING.md): its preview, where + ADD posts.
			record: row.in_library === 0 ? { preview: previewIdOf(row.origin_key) } : null,
			source: key ? { id: key.sourceId, name: series.source } : null,
			episodes,
			index,
			incognito: isIncognito(cookies),
			// What it starts in (card c171): the series', SETTINGS', the last choice.
			player: playerStart(series.id),
			// Not just this episode (doc/MOVE.md): the same NO SERVER on others.
			failures: isIncognito(cookies) ? null : await noVideoLine(series.id),
			// The Work's next part, where the last episode ends (doc/WORKS.md, W6).
			work: workEndOf(series.id, reveal)
		};
	}

	// A novel is read as text, from its EPUB (doc/TEXT-READER.md).
	if (series.kind === 'novel') {
		// One EPUB per volume: a novel grouped from several books reads each
		// from its own file (doc/BOOKS.md).
		const filed = await epubVersions(series.id, reveal);
		// A chapter with no file reads online when its plugin is installed
		// (doc/BROWSING.md, "Novels online"): a book of one chapter, `online:<id>`,
		// its document where a download would put it.
		const online = novelReadsOnline(series.id) ? onlineChapters(series.id) : new Map();
		const versions: Record<string, string | null> = { ...filed };
		for (const o of online.values()) versions[o.file] = ONLINE_VERSION;
		const reading = online.size
			? {
					...series,
					entries: series.entries.map((e) => {
						const o = online.get(e.id);
						return o
							? { ...e, available: true, online: true, file: o.file, locator: o.locator }
							: e;
					})
				}
			: series;
		const here = reading.entries[index] ?? entry;
		const version = versions[here.file] ?? null;
		// A browsing record (doc/BROWSING.md): its preview, where the end page's
		// + ADD posts (c655). The image branch below computes the same row.
		const libraryRow = getDb()
			.prepare(`SELECT in_library, origin_key FROM series WHERE id = ?`)
			.get(series.id) as { in_library: number; origin_key: string | null };
		const recordPreview = libraryRow.in_library === 0 ? previewIdOf(libraryRow.origin_key) : null;
		return {
			text: true as const,
			series: reading,
			entry: {
				id: entry.id,
				index,
				label: entry.label,
				locator: here.locator,
				matter: entry.matter,
				readAt: entry.readAt,
				lastPosition: entry.lastPosition,
				lastOffset: entry.lastOffset
			},
			layout:
				effectiveDirection(series, series.kindDirection) === 'scroll'
					? ('scroll' as const)
					: ('paged' as const),
			// Which way PAGED turns, the series' own or L→R (c440; doc/TEXT-READER.md).
			textDirection: textDirectionOf(series.id),
			version,
			/** "1 EPUB · 3.1 MB" while it opens: the file's size, from its version. */
			bytes: version && /^\d+-/.test(version) ? Number(version.split('-')[0]) : 0,
			versions,
			incognito: isIncognito(cookies),
			// A browsing record (doc/BROWSING.md): its preview, where the end page's
			// + ADD posts (c655).
			record: recordPreview,
			// What the end page's DELETE asks with (c655).
			deleteAsk: deleteAsk(series, reveal),
			// Its passages kept as highlights (c702), for the markers.
			quotes: quoteHighlights(entry.id, reveal),
			// The Work's next part, at the end of a novel's last volume (doc/WORKS.md, W6).
			work: workEndOf(series.id, reveal)
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
					// A chapter read online opens too (doc/BROWSING.md); the boundary says ONLINE.
					online: !e.available && readsOnline(e.id),
					available: e.available || readsOnline(e.id),
					/** Its text read by OCR already: the end page says so (doc/JAPANESE.md). */
					ocr: !!(
						getDb().prepare(`SELECT ocr_at FROM entries WHERE id = ?`).get(e.id) as
							{ ocr_at: number | null } | undefined
					)?.ocr_at
				}
			: null;
	};

	const libraryRow = getDb()
		.prepare(`SELECT in_library, origin_key FROM series WHERE id = ?`)
		.get(series.id) as { in_library: number; origin_key: string | null };
	const recordPreview = libraryRow.in_library === 0 ? previewIdOf(libraryRow.origin_key) : null;
	const build = (m: Awaited<ReturnType<typeof manifest>>) => {
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
				defaultMode: modeOf(
					effectiveDirection({ kind: series.kind, direction: null }, series.kindDirection)
				),
				mode: modeOf(effectiveDirection(series, series.kindDirection)),
				books,
				count: series.entries.length,
				single: series.entries.length === 1,
				hidden: series.hidden,
				// An ongoing series whose source has added nothing for eight weeks
				// (doc/MOVE.md): the END page's line and ANOTHER SOURCE cell.
				stale: staleSource(series.id),
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
			// A browsing record (doc/BROWSING.md): its preview, where the top bar's + ADD posts.
			record: recordPreview,
			// What the end page's DELETE asks with (c655).
			deleteAsk: deleteAsk(series, reveal),
			pages,
			start,
			prev: neighbour(index - 1),
			next: neighbour(index + 1),
			/** Japanese: its pages get text blocks to look words up in (doc/JAPANESE.md). */
			ocr: ocrStatus(series.id),
			incognito: isIncognito(cookies),
			// The Work's next part, at the end of this series (doc/WORKS.md, W6).
			work: workEndOf(series.id, reveal),
			/** Its pages kept as highlights (c703): the cell, the scrubber's ticks, the gutter rule. */
			highlights: pageHighlights(entry.id, reveal),
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

	// Read online (doc/BROWSING.md, "Manga online"; card c166): the source may take
	// a while (a browser check is 20-45 s), so the page comes at once and the
	// chapter streams in; a failure is the reader's waiting page, not an error.
	if (readsOnline(entryId)) {
		const key = parseKey(
			(
				getDb().prepare(`SELECT origin_key FROM series WHERE id = ?`).get(series.id) as {
					origin_key: string | null;
				}
			).origin_key
		);
		return {
			text: false as const,
			online: true as const,
			wait: {
				title: series.title,
				entryName: name(index)!,
				seriesId: series.id,
				source: key ? { id: key.sourceId, name: series.source } : null
			},
			waiting: manifest(entryId, reveal).then(
				(m) => ({ ok: true as const, data: build(m) }),
				(e) => ({
					ok: false as const,
					failure: e instanceof EngineError ? e.failure : ('source' as const),
					message: (e as Error).message
				})
			)
		};
	}
	return build(await manifest(entryId, reveal));
};

export const actions: Actions = {
	/**
	 * REMEMBER on the text reader's DIRECTION row (c440): the series reads that
	 * way from now on. The series is found as the page finds it, so a hidden
	 * one is the same 404 with reveal off.
	 */
	textDirection: async ({ request, params, cookies }) => {
		const row = getDb()
			.prepare(`SELECT series_id FROM entries WHERE id = ?`)
			.get(Number(params.entry)) as { series_id: number } | undefined;
		const series = row ? seriesPage(row.series_id, isRevealed(cookies)) : null;
		if (!series) error(404, 'not found');
		if (!takesTextDirection(series.kind)) return fail(400, { message: 'not a book of text' });
		const direction = parseTextDirection((await request.formData()).get('direction'));
		if (!direction) return fail(400, { message: 'no such direction' });
		setTextDirection(series.id, direction);
		return { ok: true };
	}
};

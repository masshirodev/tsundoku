import { error, redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import { getDb } from '$lib/server/db';
import { isIncognito, isRevealed } from '$lib/server/prefs';
import { seriesPage } from '$lib/server/series';
import { manifest } from '$lib/server/pages';
import { epubVersion } from '$lib/server/epub';
import { effectiveDirection, isBookSeries } from '$lib/library/series';
import { entryName, modeOf, spelledOut } from '$lib/reader/reader';

/**
 * The reader (doc/READER.md). `/read/<entry>?p=<page>`, `p` 1-based. With no
 * `p` it resumes where the entry was left, or starts it.
 */
export const load: PageServerLoad = async ({ params, url, cookies }) => {
	const reveal = isRevealed(cookies);
	const entryId = Number(params.entry);
	const row = getDb().prepare(`SELECT series_id FROM entries WHERE id = ?`).get(entryId) as
		{ series_id: number } | undefined;
	// Hidden means hidden: a hidden series is the same 404 as a missing one.
	const series = row ? seriesPage(row.series_id, reveal) : null;
	if (!series) error(404, 'not found');
	const index = series.entries.findIndex((e) => e.id === entryId);
	const entry = series.entries[index];
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

	// A novel is read as text, from its EPUB (doc/TEXT-READER.md).
	if (series.kind === 'novel') {
		const version = await epubVersion(series.id, reveal);
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
					available: e.available
				}
			: null;
	};

	const m = await manifest(entryId, reveal);
	const pages = m?.pages ?? [];
	const p = url.searchParams.get('p');
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
			title: series.title,
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
				readAt: e.readAt,
				available: e.available
			}))
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
		incognito: isIncognito(cookies)
	};
};

import { getDb } from '$lib/server/db';
import { tmdbFacts } from '$lib/server/tmdb-links';
import { surroundingsOf, type Surroundings } from '$lib/server/tmdb-surround';
import { catalogueOf, catalogueType } from '$lib/library/catalogues';
import { storageOf, type Kind } from '$lib/library/kinds';
import type { TmdbTitle } from '$lib/library/tmdb';
import type { GroupBook } from './other-forms.server';

/**
 * What a film's or a show's screen reads beyond any series' (card c992): the
 * TMDB facts its link keeps, what surrounds it (c990's cache, never a request),
 * the series' first genre for the count line, the folder its KIND row names,
 * and, for a collection's GROUP →, the parts in the library as the GROUP sheet
 * takes them, in TMDB's order. Null for any other kind.
 */
export type FilmPage = {
	film: boolean;
	facts: TmdbTitle | null;
	surround: Surroundings;
	genre: string | null;
	/** The kind's top folder (`Movies`, `Shows`): the KIND row's `MOVIES/`. */
	folder: string;
	/** GROUP →'s books: this film first, then the other parts here, in TMDB's order. */
	groupBooks: GroupBook[];
};

const bookOf = (id: number): GroupBook | null =>
	(getDb()
		.prepare(
			`SELECT id AS seriesId, title, hue, added_at AS addedAt, cover_at AS cover FROM series WHERE id = ?`
		)
		.get(id) as GroupBook | undefined) ?? null;

export function filmPage(seriesId: number, kind: Kind, reveal: boolean): FilmPage | null {
	if (catalogueOf(kind) !== 'tmdb') return null;
	const surround = surroundingsOf(seriesId, reveal);
	const genre =
		(
			getDb()
				.prepare(
					`SELECT t.value FROM series_tags st JOIN tags t ON t.id = st.tag_id
					WHERE st.series_id = ? AND t.namespace = 'genre' ORDER BY t.value LIMIT 1`
				)
				.get(seriesId) as { value: string } | undefined
		)?.value ?? null;
	const groupBooks: GroupBook[] = [];
	if (
		surround?.kind === 'collection' &&
		surround.view.mode === 'parts' &&
		surround.view.foot.group
	) {
		const self = bookOf(seriesId);
		if (self) groupBooks.push(self);
		for (const item of surround.view.items)
			if (item.type === 'row' && item.row.cell?.label === 'IN LIBRARY →') {
				const b = bookOf(item.row.cell.seriesId);
				if (b) groupBooks.push(b);
			}
	}
	return {
		film: catalogueType(kind) === 'movie',
		facts: tmdbFacts(seriesId),
		surround,
		genre,
		folder: storageOf(kind).folder,
		groupBooks
	};
}

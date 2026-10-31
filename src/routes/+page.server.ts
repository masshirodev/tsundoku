import { error, fail, redirect } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import { applyPending, offerFold, reviewQueue } from '$lib/server/dupes';
import { linkQueueCount } from '$lib/server/catalogue';
import { ranobeQueueCount } from '$lib/server/ranobe-review';
import { getDb } from '$lib/server/db';
import {
	collectionExists,
	continueReading,
	anyFollowed,
	countListed,
	countSeries,
	createCollection,
	dismissScan,
	kindsOn,
	languagesOn,
	listSeries,
	setFavourite,
	setHidden,
	setInCollection,
	setRating
} from '$lib/server/library';
import { isRevealed, runCommand } from '$lib/server/prefs';
import { parseRating } from '$lib/library/rating';
import { activeCount, legacyShelf, parseFilters } from '$lib/library/filters';
import { parseDir, parseSeed, parseSort } from '$lib/library/labels';
import {
	GroupingError,
	dismissSuggestion,
	groupIntoSeries,
	seriesOfBooks,
	seriesOfVolumes
} from '$lib/server/books';
import { setPersonFavourite, tagPage } from '$lib/server/people';
import { libraryRoot, startScan } from '$lib/server/import';
import { browseList } from '$lib/server/engine/browse';
import { downloadsBackend } from '$lib/server/engine/run';
import { refreshCovers } from '$lib/server/covers';
import { deleteSeries } from '$lib/server/delete';
import { isGated } from '$lib/server/unlock';
import { pageSizeOf } from '$lib/library/paging';

export const load: PageServerLoad = async ({ url, cookies, parent }) => {
	const { scan } = await parent();
	const reveal = isRevealed(cookies);
	// While a scan is running or just finished, the grid defaults to what it
	// brought in: "02 — ARRIVING" / "02 — JUST IMPORTED".
	const shelf = url.searchParams.get('shelf') ?? (scan ? 'new' : 'all');
	// FAVOURITES, RATED and DOWNLOADED are filters now (doc/FILTERS.md): an
	// old link lands on the same books.
	const legacy = legacyShelf(shelf, url.searchParams);
	if (legacy) redirect(308, `/?${legacy}`);
	const tag = url.searchParams.get('tag');
	const filters = parseFilters(url.searchParams, reveal);
	// LANGUAGE offers what the shelf holds; the shelf's own size is what
	// "44 OF 188" is out of, counted only while a filter narrows it.
	const languages =
		shelf === 'people' || shelf === 'cached' ? [] : languagesOn({ reveal, shelf, tag });
	// KIND offers the kinds the shelf holds (TO READ's manga); a kind it doesn't
	// hold drops, as a language does.
	const kinds = shelf === 'people' || shelf === 'cached' ? [] : kindsOn({ reveal, shelf, tag });
	if (filters.kind && shelf !== 'cached' && shelf !== 'people' && !kinds.includes(filters.kind)) {
		const next = new URLSearchParams(url.searchParams);
		next.delete('kind');
		redirect(307, `/?${next}`);
	}
	// A language this shelf doesn't hold drops, rather than emptying the grid
	// (Library Filters 1c: MANHWA offers none, so switching to it drops JA).
	if (filters.lang && shelf !== 'cached' && !languages.includes(filters.lang)) {
		const next = new URLSearchParams(url.searchParams);
		next.delete('lang');
		redirect(307, `/?${next}`);
	}
	// NEWEST while a scan brings things in, and on NEW, where it means newest
	// arrival (doc/LIBRARY.md): RECENT would sort by an open that, on NEW, never
	// happened since.
	const sort =
		!url.searchParams.has('sort') && (shelf === 'new' || (scan && !scan.finishedAt))
			? 'added'
			: parseSort(url.searchParams.get('sort'));
	const dir = parseDir(url.searchParams.get('dir'), sort);

	// A tag is a person or tag page: the library with a richer header. One
	// whose books are all hidden has no page while reveal is off -- the same
	// 404 as a tag that doesn't exist.
	const person = tag ? tagPage(tag, reveal) : null;
	if (tag && !person) error(404, 'not found');

	const total = countSeries(reveal);
	// Duplicate books (doc/DUPLICATE-BOOKS.md): a decision the review left
	// waiting is carried out, then the pairs still to review are counted.
	await applyPending();
	const dupes = reviewQueue(reveal).length;
	// Catalogue links AniList found, not for certain (doc/LINKS.md).
	// One review for both catalogues (doc/RANOBE.md, "The review").
	const toLink = linkQueueCount(reveal) + ranobeQueueCount();
	// RANDOM's shuffle: one per choice of RANDOM, kept in the URL.
	const seed = parseSeed(url.searchParams.get('seed'));
	const pageSize = pageSizeOf(cookies.get('tsundoku_grid_page'));
	return {
		shelf,
		tag,
		filters,
		languages,
		kinds,
		shelfTotal:
			activeCount(filters) > 0 && shelf !== 'people' && shelf !== 'cached'
				? countListed({ reveal, shelf, tag })
				: null,
		person,
		existing: seriesOfBooks(reveal),
		existingVolumes: seriesOfVolumes(reveal),
		sort,
		dir,
		seed,
		empty: total === 0 && !scan,
		// The first day (doc/ONBOARDING.md; handoff board 3): an empty library whose
		// checklist is through lists the sources it can read from instead.
		firstDay:
			total === 0 && !scan && downloadsBackend() === 'engine'
				? (() => {
						const b = browseList(reveal);
						return [...b.manga, ...b.anime, ...b.novels].map((r) => ({
							id: r.id,
							label: r.label,
							kind: r.kind,
							lang: r.lang
						}));
					})()
				: [],
		dupes,
		toLink,
		// FOLLOWED is a filter while something the viewer can see is followed (doc/DOWNLOADING.md).
		following: anyFollowed(reveal),
		libraryRoot: libraryRoot(),
		cont: continueReading(reveal),
		// PEOPLE lists favourite people (from the layout), not series.
		// The first page; the grid asks /api/library for the rest as it scrolls.
		// CACHED is the exception: only the tablet knows which series it holds,
		// so it gets them all, to narrow down itself.
		series:
			shelf === 'people'
				? []
				: listSeries({
						reveal,
						shelf,
						tag,
						// CACHED narrows on the device, filters and all.
						filters: shelf === 'cached' ? undefined : filters,
						sort,
						dir,
						seed,
						limit: shelf === 'cached' ? undefined : pageSize
					}),
		total: shelf === 'people' ? 0 : countListed({ reveal, shelf, tag, filters }),
		pageSize
	};
};

/** The ids a form acted on, as submitted by `name="id"` inputs. */
function ids(form: FormData): number[] {
	return form
		.getAll('id')
		.map((v) => Number(v))
		.filter((n) => Number.isInteger(n) && n > 0);
}

export const actions: Actions = {
	rate: async ({ request }) => {
		const form = await request.formData();
		const rating = parseRating(form.get('rating'));
		if (rating === undefined) return fail(400, { message: 'rating must be 0-10' });
		setRating(ids(form), rating);
		return { ok: true };
	},

	favourite: async ({ request }) => {
		const form = await request.formData();
		setFavourite(ids(form), form.get('on') === '1');
		return { ok: true };
	},

	hide: async ({ request }) => {
		const form = await request.formData();
		setHidden(ids(form), form.get('on') !== '0');
		return { ok: true };
	},

	shelf: async ({ request }) => {
		const form = await request.formData();
		const target = ids(form);
		const name = String(form.get('name') ?? '').trim();
		let collection = Number(form.get('collection'));
		if (name !== '') collection = createCollection(name);
		if (!Number.isInteger(collection) || !collectionExists(collection)) {
			return fail(400, { message: 'no such shelf' });
		}
		setInCollection(target, collection, form.get('on') !== '0');
		return { ok: true };
	},

	/**
	 * + NEW (Library Filters 3g, 3j): a shelf by name alone, landing on it.
	 * A name already taken lands on that shelf rather than making a twin.
	 */
	newShelf: async ({ request }) => {
		const name = String((await request.formData()).get('name') ?? '').trim();
		if (name === '') return fail(400, { message: 'a shelf needs a name' });
		redirect(303, `/?shelf=c:${createCollection(name)}`);
	},

	/** The bulk bar: a rating cell or one of the action cells. */
	bulk: async ({ request }) => {
		const form = await request.formData();
		const target = ids(form);
		if (target.length === 0) return fail(400, { message: 'nothing selected' });
		if (form.has('rating')) {
			const rating = parseRating(form.get('rating'));
			if (rating === undefined) return fail(400, { message: 'rating must be 0-10' });
			setRating(target, rating);
		} else if (form.get('do') === 'fav') {
			setFavourite(target, true);
		} else if (form.get('do') === 'hide') {
			setHidden(target, true);
		} else if (form.get('do') === 'unhide') {
			// Out of a hidden root too: each becomes public (src/lib/server/visibility.ts).
			setHidden(target, false);
		}
		return { ok: true };
	},

	/**
	 * FOLD AS LANGUAGES (doc/EDITIONS.md): two or three single books, one per
	 * language, go to the duplicates review as a pair to fold -- the review is
	 * where editions are folded, whoever found them.
	 */
	fold: async ({ request }) => {
		const target = ids(await request.formData());
		if (target.length < 2 || target.length > 3)
			return fail(400, { foldMessage: 'FOLD TWO OR THREE BOOKS' });
		const rows = getDb()
			.prepare(
				`SELECT s.id, s.kind, (SELECT COUNT(*) FROM entries e WHERE e.series_id = s.id AND e.shadowed = 0) AS n,
					(SELECT MIN(e.id) FROM entries e WHERE e.series_id = s.id AND e.shadowed = 0) AS entry
				FROM series s WHERE s.id IN (${target.map(() => '?').join(',')})`
			)
			.all(...target) as { id: number; kind: string; n: number; entry: number }[];
		if (rows.length !== target.length || rows.some((r) => r.kind !== 'doujin' || r.n !== 1))
			return fail(400, { foldMessage: 'ONLY SINGLE BOOKS FOLD' });
		const key = await offerFold(target.map((id) => rows.find((r) => r.id === id)!.entry));
		if (!key) return fail(400, { foldMessage: 'THEIR PAGES DON’T MATCH · NOT ONE BOOK' });
		redirect(303, `/duplicates?pair=${encodeURIComponent(key)}`);
	},

	/**
	 * GROUP: singles into a new series, or onto the end of an existing one, in
	 * the order the sheet sent them. From a suggestion, the whole suggested set
	 * is also stored as dismissed, so books left unticked don't bring it back.
	 */
	group: async ({ request }) => {
		const form = await request.formData();
		const seriesIds = form.getAll('series').map(Number).filter(Number.isInteger);
		const suggested = form.getAll('suggested').map(Number).filter(Number.isInteger);
		const into = form.get('mode') === 'existing' ? Number(form.get('into')) : undefined;
		let result;
		try {
			result = groupIntoSeries({ seriesIds, name: String(form.get('name') ?? ''), into });
		} catch (e) {
			if (e instanceof GroupingError) return fail(400, { groupMessage: e.message.toUpperCase() });
			throw e;
		}
		if (suggested.length > 0) dismissSuggestion(suggested);
		const order = String(form.get('order') ?? '');
		// Volumes of a novel are counted, and undone, by the volume, not the chapter.
		const moved = result.volumes ?? result.entryIds;
		const params = new URLSearchParams({ created: String(moved.length), order });
		if (result.volumes) params.set('unit', 'volumes');
		if (into !== undefined) params.set('added', moved.join(','));
		// The new series' cover, from its first book or volume (c57): off the
		// request, never waited on.
		void refreshCovers({ ids: [result.seriesId], remote: false });
		redirect(303, `/series/${result.seriesId}?${params}`);
	},

	personFavourite: async ({ request }) => {
		const form = await request.formData();
		try {
			setPersonFavourite(
				String(form.get('namespace')),
				String(form.get('value')),
				form.get('on') === '1'
			);
		} catch {
			return fail(400, { message: 'only artists, circles and authors can be favourited' });
		}
		return { ok: true };
	},

	/** Search commands land here: /reveal, /hide, /light, /dark, /incognito, and END. */
	command: async ({ request, cookies, url }) => {
		const form = await request.formData();
		if (!runCommand(cookies, String(form.get('command')), url, { gated: isGated() })) {
			return fail(400, { message: 'unknown command' });
		}
		redirect(303, '/');
	},

	dismissScan: async ({ request }) => {
		const form = await request.formData();
		dismissScan(Number(form.get('scan')));
		redirect(303, '/?shelf=new');
	},

	/**
	 * START SCAN: the importers run in the background and the library follows
	 * the job (doc/IMPORT-MIHON.md). With nothing to import it says where it
	 * looked, rather than pretending to start.
	 */
	/** DELETE in the bulk bar, after its confirmation (doc/DELETING.md). */
	delete: async ({ request, cookies }) => {
		const r = await deleteSeries(ids(await request.formData()), isRevealed(cookies));
		return { deleted: r.series };
	},

	scan: async () => {
		const r = startScan();
		if (!r.started) {
			return fail(400, {
				scanMessage: `NOTHING TO IMPORT · NO Mihon/ OR H/.Hentoid/ FOLDER IN ${r.looked}`
			});
		}
		redirect(303, '/');
	}
};

import { error, fail, redirect } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import { env } from '$env/dynamic/private';
import {
	collectionExists,
	continueReading,
	countSeries,
	createCollection,
	dismissScan,
	listSeries,
	setFavourite,
	setHidden,
	setInCollection,
	setRating
} from '$lib/server/library';
import { isRevealed, runCommand } from '$lib/server/prefs';
import { parseRating } from '$lib/library/rating';
import { parseSort } from '$lib/library/labels';
import {
	GroupingError,
	dismissSuggestion,
	groupIntoSeries,
	seriesOfBooks
} from '$lib/server/books';
import { setPersonFavourite, tagPage } from '$lib/server/people';

export const load: PageServerLoad = async ({ url, cookies, parent }) => {
	const { scan } = await parent();
	const reveal = isRevealed(cookies);
	// While a scan is running or just finished, the grid defaults to what it
	// brought in: "02 — ARRIVING" / "02 — JUST IMPORTED".
	const shelf = url.searchParams.get('shelf') ?? (scan ? 'new' : 'all');
	const tag = url.searchParams.get('tag');
	const sort =
		scan && !scan.finishedAt && !url.searchParams.has('sort')
			? 'added'
			: parseSort(url.searchParams.get('sort'));

	// A tag is a person or tag page: the library with a richer header. One
	// whose books are all hidden has no page while reveal is off -- the same
	// 404 as a tag that doesn't exist.
	const person = tag ? tagPage(tag, reveal) : null;
	if (tag && !person) error(404, 'not found');

	const total = countSeries(reveal);
	return {
		shelf,
		tag,
		person,
		existing: seriesOfBooks(reveal),
		sort,
		empty: total === 0 && !scan,
		libraryRoot: env.LIBRARY_ROOT ?? '/mnt/hdd2/tsundoku/library',
		cont: continueReading(reveal),
		// PEOPLE lists favourite people (from the layout), not series.
		series: shelf === 'people' ? [] : listSeries({ reveal, shelf, tag, sort })
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
		if (rating === undefined) return fail(400, { message: 'rating must be 0-5' });
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

	/** The bulk bar: a rating cell or one of the action cells. */
	bulk: async ({ request }) => {
		const form = await request.formData();
		const target = ids(form);
		if (target.length === 0) return fail(400, { message: 'nothing selected' });
		if (form.has('rating')) {
			const rating = parseRating(form.get('rating'));
			if (rating === undefined) return fail(400, { message: 'rating must be 0-5' });
			setRating(target, rating);
		} else if (form.get('do') === 'fav') {
			setFavourite(target, true);
		} else if (form.get('do') === 'hide') {
			setHidden(target, true);
		}
		return { ok: true };
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
		const params = new URLSearchParams({ created: String(result.entryIds.length), order });
		if (into !== undefined) params.set('added', result.entryIds.join(','));
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

	/** Search commands land here: /reveal, /hide, /light, /dark. */
	command: async ({ request, cookies, url }) => {
		const form = await request.formData();
		if (!runCommand(cookies, String(form.get('command')), url)) {
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
	 * START SCAN. The scanner and importers are the next cards on the board
	 * (doc/ARCHITECTURE.md, phase 1); until they exist this says so rather
	 * than pretending to start something.
	 */
	scan: async () => {
		return fail(501, { scanMessage: 'THE SCANNER IS NOT BUILT YET · SEE THE TSUNDOKU BOARD' });
	}
};

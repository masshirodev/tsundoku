import { fail, redirect } from '@sveltejs/kit';
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

	const total = countSeries(reveal);
	return {
		shelf,
		tag,
		sort,
		empty: total === 0 && !scan,
		libraryRoot: env.LIBRARY_ROOT ?? '/mnt/hdd2/tsundoku/library',
		cont: continueReading(reveal),
		series: listSeries({ reveal, shelf, tag, sort })
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

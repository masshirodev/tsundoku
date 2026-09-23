import { error, fail, redirect } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import {
	collectionExists,
	createCollection,
	setFavourite,
	setHidden,
	setInCollection,
	setRating
} from '$lib/server/library';
import { addTag, markEntries, removeTag, seriesPage, setDirection } from '$lib/server/series';
import { isRevealed } from '$lib/server/prefs';
import { parseRating } from '$lib/library/rating';
import { parseDirection, parseTag } from '$lib/library/series';

function seriesId(raw: string): number {
	const id = Number(raw);
	if (!Number.isInteger(id) || id <= 0) error(404, 'not found');
	return id;
}

/**
 * Where the back cell leads, and what it says. `from` is set by the link that
 * opened the series: a shelf key, `continue`, or nothing.
 */
function backTo(from: string | null, shelves: { key: string; name: string }[]) {
	if (from === 'continue') return { label: 'Continue · Library', href: '/' };
	const shelf = from ? shelves.find((s) => s.key === from) : undefined;
	if (shelf && shelf.key !== 'all') {
		return { label: shelf.name, href: `/?shelf=${encodeURIComponent(shelf.key)}` };
	}
	return { label: 'Library', href: '/' };
}

export const load: PageServerLoad = async ({ params, cookies, url, parent }) => {
	const reveal = isRevealed(cookies);
	// A hidden series is unreachable while reveal is off: the same 404 as a
	// series that does not exist, so the URL cannot be used to probe.
	const series = seriesPage(seriesId(params.id), reveal);
	if (!series) error(404, 'not found');
	const { shelves } = await parent();
	return {
		series,
		back: backTo(url.searchParams.get('from'), shelves),
		editing: url.searchParams.get('edit') === 'tags'
	};
};

/** Resolve the series a form acted on, refusing one reveal would hide. */
function target(params: { id: string }, cookies: Parameters<Actions[string]>[0]['cookies']) {
	const id = seriesId(params.id);
	const series = seriesPage(id, isRevealed(cookies));
	if (!series) error(404, 'not found');
	return series;
}

const entryIds = (form: FormData) =>
	form
		.getAll('entry')
		.map(Number)
		.filter((n) => Number.isInteger(n) && n > 0);

export const actions: Actions = {
	rate: async ({ request, params, cookies }) => {
		const s = target(params, cookies);
		const rating = parseRating((await request.formData()).get('rating'));
		if (rating === undefined) return fail(400, { message: 'rating must be 0-5' });
		setRating([s.id], rating);
		return { ok: true };
	},

	favourite: async ({ request, params, cookies }) => {
		const s = target(params, cookies);
		setFavourite([s.id], (await request.formData()).get('on') === '1');
		return { ok: true };
	},

	direction: async ({ request, params, cookies }) => {
		const s = target(params, cookies);
		const direction = parseDirection((await request.formData()).get('direction'), s.kind);
		if (!direction) return fail(400, { message: 'no such direction for this kind' });
		setDirection(s.id, direction);
		return { ok: true };
	},

	hide: async ({ request, params, cookies }) => {
		const s = target(params, cookies);
		const hide = (await request.formData()).get('on') !== '0';
		setHidden([s.id], hide);
		// Hidden with reveal off, this screen no longer exists for the viewer.
		if (hide && !isRevealed(cookies)) redirect(303, '/');
		return { ok: true };
	},

	shelf: async ({ request, params, cookies }) => {
		const s = target(params, cookies);
		const form = await request.formData();
		const name = String(form.get('name') ?? '').trim();
		const collection = name !== '' ? createCollection(name) : Number(form.get('collection'));
		if (!Number.isInteger(collection) || !collectionExists(collection)) {
			return fail(400, { message: 'no such shelf' });
		}
		setInCollection([s.id], collection, form.get('on') !== '0');
		return { ok: true };
	},

	tag: async ({ request, params, cookies }) => {
		const s = target(params, cookies);
		const form = await request.formData();
		// A tapped suggestion arrives as `pick` beside whatever was half-typed in
		// `tag`; it must win, or tapping "isekai" while "ise" is typed would store
		// "ise" -- a second spelling, the thing suggestions exist to prevent.
		const tag = parseTag(String(form.get('pick') ?? form.get('tag') ?? ''));
		if (!tag) return fail(400, { tagMessage: 'TYPE A TAG AS NAMESPACE:VALUE' });
		addTag(s.id, tag);
		return { ok: true };
	},

	untag: async ({ request, params, cookies }) => {
		const s = target(params, cookies);
		const form = await request.formData();
		removeTag(s.id, {
			namespace: String(form.get('namespace') ?? ''),
			value: String(form.get('value') ?? '')
		});
		return { ok: true };
	},

	/** Multi-select's MARK READ / MARK UNREAD, over exactly the selected entries. */
	mark: async ({ request, params, cookies }) => {
		const s = target(params, cookies);
		const form = await request.formData();
		const read = form.get('read') === '1';
		const changed = markEntries(s.id, entryIds(form), read);
		return { ok: true, changed };
	}
};

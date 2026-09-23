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
import { setScanlator } from '$lib/server/duplicates';
import { parseRating } from '$lib/library/rating';
import { isBookSeries, parseDirection, parseTag } from '$lib/library/series';
import {
	GroupingError,
	dismissSuggestion,
	groupIntoSeries,
	moveBook,
	reorderBooks,
	rootOf,
	seriesOfBooks,
	setBookFavourite,
	setBookRating,
	suggestionFor,
	takeOut,
	undoDismissal
} from '$lib/server/books';

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
	if (from === 'history') return { label: 'History', href: '/history' };
	// From a person or tag page: back to it, named by the person.
	if (from?.startsWith('tag:')) {
		const tag = from.slice(4);
		return { label: tag.slice(tag.indexOf(':') + 1), href: `/?tag=${encodeURIComponent(tag)}` };
	}
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
	const books = isBookSeries(series);
	const single = series.kind === 'doujin' && series.entries.length === 1;
	const bookParam = Number(url.searchParams.get('book'));
	const root = rootOf(series.id);
	return {
		series,
		back: backTo(url.searchParams.get('from'), shelves),
		editing: url.searchParams.get('edit') === 'tags',
		// A book of a series of books opened on its own: its pages.
		book: books ? (series.entries.find((e) => e.id === bookParam) ?? null) : null,
		// Only a single book can be suggested into a series.
		suggestion: single ? suggestionFor(series.id, reveal) : null,
		// Where a book can move to, or singles can be added: same root only.
		otherSeries: seriesOfBooks(reveal).filter((o) => o.rootId === root && o.id !== series.id),
		created: url.searchParams.get('created') === '1'
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

	/** SCANLATOR: whose copy of a duplicated chapter the list shows. '' is automatic. */
	scanlator: async ({ request, params, cookies }) => {
		const s = target(params, cookies);
		const name = String((await request.formData()).get('scanlator') ?? '');
		if (name !== '' && !s.scanlators.some((x) => x.name === name))
			return fail(400, { message: 'no chapters from that scanlator' });
		setScanlator(s.id, name === '' ? null : name);
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

	// ---- books ------------------------------------------------------------------

	bookRate: async ({ request, params, cookies }) => {
		const s = target(params, cookies);
		const form = await request.formData();
		const rating = parseRating(form.get('rating'));
		if (rating === undefined) return fail(400, { message: 'rating must be 0-5' });
		setBookRating(s.id, Number(form.get('entry')), rating);
		return { ok: true };
	},

	bookFavourite: async ({ request, params, cookies }) => {
		const s = target(params, cookies);
		const form = await request.formData();
		setBookFavourite(s.id, Number(form.get('entry')), form.get('on') === '1');
		return { ok: true };
	},

	reorder: async ({ request, params, cookies }) => {
		const s = target(params, cookies);
		reorderBooks(s.id, entryIds(await request.formData()));
		return { ok: true };
	},

	/** TAKE OUT one book: it becomes a single with its rating, FAV, tags and page. */
	takeOut: async ({ request, params, cookies }) => {
		const s = target(params, cookies);
		const form = await request.formData();
		const entry = Number(form.get('entry'));
		const position = s.entries.findIndex((e) => e.id === entry);
		const title = s.entries[position]?.title;
		const [single] = takeOut(s.id, [entry]);
		if (!single) return fail(400, { message: 'that book is not in this series' });
		if (s.entries.length === 1) redirect(303, `/series/${single}`);
		return { takenOut: { single, title, position } };
	},

	/** Put a taken-out book back where it was. */
	undoTakeOut: async ({ request, params, cookies }) => {
		const s = target(params, cookies);
		const form = await request.formData();
		const single = Number(form.get('single'));
		const position = Number(form.get('position'));
		try {
			const {
				entryIds: [entry]
			} = groupIntoSeries({ seriesIds: [single], into: s.id });
			const order = s.entries.map((e) => e.id);
			order.splice(position, 0, entry);
			reorderBooks(s.id, order);
		} catch (e) {
			if (e instanceof GroupingError) return fail(400, { message: e.message });
			throw e;
		}
		return { ok: true };
	},

	/** UNDO after ADD TO EXISTING: take the books just added back out. */
	undoAdd: async ({ request, params, cookies }) => {
		const s = target(params, cookies);
		takeOut(s.id, entryIds(await request.formData()));
		redirect(303, `/series/${s.id}`);
	},

	/** UNGROUP: every book back out as a single; the series goes. */
	ungroup: async ({ params, cookies }) => {
		const s = target(params, cookies);
		takeOut(
			s.id,
			s.entries.map((e) => e.id)
		);
		redirect(303, '/?sort=added');
	},

	move: async ({ request, params, cookies }) => {
		const s = target(params, cookies);
		const form = await request.formData();
		try {
			moveBook(s.id, Number(form.get('entry')), Number(form.get('to')));
		} catch (e) {
			if (e instanceof GroupingError) return fail(400, { message: e.message });
			throw e;
		}
		if (s.entries.length === 1) redirect(303, `/series/${Number(form.get('to'))}`);
		return { ok: true };
	},

	/** NOT A SERIES: store the suggestion's set as dismissed. */
	dismiss: async ({ request, params, cookies }) => {
		target(params, cookies);
		const form = await request.formData();
		// From the grouping sheet the whole suggested set is sent as `suggested`;
		// from the band it's `series`. Either way the full set is what's dismissed.
		const raw =
			form.getAll('suggested').length > 0 ? form.getAll('suggested') : form.getAll('series');
		const ids = raw.map(Number).filter(Number.isInteger);
		return { dismissed: dismissSuggestion(ids) };
	},

	undoDismiss: async ({ request, params, cookies }) => {
		target(params, cookies);
		undoDismissal(String((await request.formData()).get('key') ?? ''));
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

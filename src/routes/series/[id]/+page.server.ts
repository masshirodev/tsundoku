import { error, fail, redirect } from '@sveltejs/kit';
import { automaticCover, refreshCovers } from '$lib/server/covers';
import { DeleteError, deleteBook, deleteSeries } from '$lib/server/delete';
import type { Actions, PageServerLoad } from './$types';
import { getDb } from '$lib/server/db';
import { ocrPlace, restoreNotText, setSeriesOcr } from '$lib/server/japanese/ocr';
import { wordsOf } from '$lib/server/japanese/mining';
import { decide, twinOf } from '$lib/server/dupes';
import { linkState, unlink } from '$lib/server/catalogue';
import { unlinkSeries } from '$lib/server/ranobe';
import { ranobeSeries, retryRanobe } from '$lib/server/ranobe-review';
import { afterReading, editTracking, sendPending, trackingOf } from '$lib/server/tracking';
import { afterReading as ranobeAfterReading } from '$lib/server/ranobe';
import { STATUSES, type Status } from '$lib/library/tracking';
import {
	collectionExists,
	createCollection,
	setFavourite,
	setHidden,
	setInCollection,
	setRating
} from '$lib/server/library';
import {
	addTag,
	markEntries,
	markReadThrough,
	removeTag,
	seriesPage,
	setDirection
} from '$lib/server/series';
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
	takeOutVolumes,
	undoDismissal,
	addBookTag,
	removeBookTag,
	EditionError,
	unfoldEditions
} from '$lib/server/books';
import { bookEditions, setBookLanguage } from '$lib/server/editions';
import {
	enqueue,
	isDownloadsError,
	retry,
	seriesDownloads,
	setFollowed,
	undoAdd as undoSourceAdd
} from '$lib/server/downloads';
import {
	allToDownload,
	nextToDownload,
	rowAction,
	type DownloadState
} from '$lib/library/downloads';
import { baseToEdition } from '$lib/library/editions';

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
		created: url.searchParams.get('created') === '1',
		// Japanese (doc/JAPANESE.md): OCR's progress, and the words looked up. Never for novels.
		ocr: series.kind === 'novel' ? null : ocrPlace(series.id),
		// The PAGES grid's page menu (c26): where the covers come from now.
		cover: coverState(series.id),
		// A book here with a likely twin (doc/DUPLICATE-BOOKS.md): the band.
		twin: twinBand(series.id, reveal),
		// One book in several languages (doc/EDITIONS.md): its LANGUAGE and EDITIONS rows.
		editions: series.kind === 'doujin' ? bookEditions(series.id) : null,
		words: series.kind === 'novel' ? null : wordsOf(series.id, reveal),
		// Its MyAnimeList / AniList entry (doc/LINKS.md): the LINK and COVER rows.
		link: linkState(series.id),
		// What each catalogue's list says, and what tsundoku sent (doc/TRACKING.md).
		tracking: trackingOf(series.id),
		// A novel's Ranobe link and line (doc/RANOBE.md). Null for a comic.
		ranobe: ranobeSeries(series.id),
		// Downloading through Suwayomi (doc/DOWNLOADING.md): the DOWNLOAD row and each chapter's state.
		downloads: await seriesDownloads(series.id, series.entries),
		// ALL N's confirmation is a URL, so it opens without script too.
		confirmAll: url.searchParams.get('download') === 'all',
		// Just added from a source search (Download States 1e, after adding): the band, and UNDO.
		addedFrom: Number(url.searchParams.get('added')) || null
	};
};

/** The series' chosen cover, what automatic would give, and which entries' files carry one. */
function coverState(seriesId: number) {
	const db = getDb();
	const s = db.prepare(`SELECT cover_entry, cover_page FROM series WHERE id = ?`).get(seriesId) as {
		cover_entry: number | null;
		cover_page: number | null;
	};
	return {
		chosen:
			s.cover_entry !== null && s.cover_page !== null
				? { entry: s.cover_entry, page: s.cover_page }
				: null,
		automatic: automaticCover(seriesId),
		files: (
			db
				.prepare(
					`SELECT id FROM entries WHERE series_id = ? AND cover_file IS NOT NULL AND cover_file != ''`
				)
				.all(seriesId) as { id: number }[]
		).map((r) => r.id)
	};
}

/** The series screen's SAME BOOK AS band: the other copy, and how alike. */
function twinBand(seriesId: number, reveal: boolean) {
	const p = twinOf(seriesId, reveal);
	if (!p) return null;
	const other = p.a.seriesId === seriesId ? p.b : p.a;
	const matched = p.rows.filter((r) => r.a !== null && r.b !== null).length;
	return {
		key: p.key,
		title: other.title,
		conf: p.conf,
		pages: `${matched} OF ${Math.max(p.a.pages, p.b.pages)} PAGES MATCH`
	};
}

/**
 * Covers after the books move (c57): a series of books wears its first
 * book's cover, and a book taken out is a new series with none yet. Off the
 * request, never waited on, from the workstation's files only.
 */
const recover = (ids: number[]) => void refreshCovers({ ids, remote: false });

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
	/** LANGUAGE on a folded book: which edition it opens in; empty is the SETTINGS default. */
	language: async ({ request, params, cookies }) => {
		const s = target(params, cookies);
		const eds = bookEditions(s.id);
		if (!eds) return fail(400, { message: 'not a folded book' });
		const l = String((await request.formData()).get('language') ?? '');
		if (l && !eds.editions.some((e) => e.language === l))
			return fail(400, { message: 'no edition in that language' });
		setBookLanguage(s.id, l || null);
		// Its tile wears the opening edition's cover.
		recover([s.id]);
		return { ok: true };
	},

	/** UNFOLD: each edition a book of its own again, at the page this one is at. */
	unfold: async ({ params, cookies }) => {
		const s = target(params, cookies);
		let created: number[];
		try {
			created = unfoldEditions(s.id, (rows, page) => baseToEdition(rows, page).page);
		} catch (e) {
			if (e instanceof EditionError) return fail(400, { message: e.message });
			throw e;
		}
		recover([s.id, ...created]);
		return { ok: true, unfolded: true };
	},

	rate: async ({ request, params, cookies }) => {
		const s = target(params, cookies);
		const rating = parseRating((await request.formData()).get('rating'));
		if (rating === undefined) return fail(400, { message: 'rating must be 0-10' });
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

	/** OCR on the NOT DETECTED row: the series is Japanese, and its chapters queue. */
	ocr: async ({ params, cookies }) => {
		const s = target(params, cookies);
		if (s.kind === 'novel') return fail(400, { message: 'novels are text already' });
		setSeriesOcr(s.id, true);
		return { ok: true };
	},

	/** KEEP BOTH on the SAME BOOK AS band: the pair never comes back. */
	keepBoth: async ({ request, params, cookies }) => {
		target(params, cookies);
		const pair = String((await request.formData()).get('pair') ?? '');
		try {
			await decide(pair, 'both', null, isRevealed(cookies));
		} catch {
			return fail(409, { message: 'that pair is settled already' });
		}
		return { ok: true };
	},

	/** RESTORE on the OCR row: every block marked NOT TEXT, back where it was. */
	restoreText: async ({ params, cookies }) => {
		const s = target(params, cookies);
		return { restored: restoreNotText(s.id) };
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

	// The TRACKING sheet (Series Link 1m): status, to both catalogues, now. The
	// score is the rating (c67), sent by the RATING row's own save.
	tracking: async ({ request, params, cookies }) => {
		const s = target(params, cookies);
		const status = String((await request.formData()).get('status') ?? '');
		if (!(STATUSES as string[]).includes(status)) return fail(400, { message: 'no such status' });
		if (editTracking(s.id, { status: status as Status }) > 0) await sendPending({ seriesId: s.id });
		return { ok: true };
	},

	// TRY AGAIN on the TRACKING row (Series Link 1n): what failed, sent now.
	retryTracking: async ({ params, cookies }) => {
		const s = target(params, cookies);
		await sendPending({ seriesId: s.id });
		return { ok: true };
	},

	// Ranobe's UNLINK (Ranobe Series 2a): the link goes, and no pass brings it
	// back. What was sent stays on Ranobe (doc/RANOBE.md).
	unlinkRanobe: async ({ params, cookies }) => {
		const s = target(params, cookies);
		unlinkSeries(s.id);
		return { ok: true };
	},

	// TRY AGAIN on the Ranobe line (2d–2f): what failed, sent now.
	retryRanobe: async ({ params, cookies }) => {
		const s = target(params, cookies);
		await retryRanobe(s.id);
		return { ok: true };
	},

	// UNLINK (Series Link 1k): gone, and an import won't bring it back (doc/LINKS.md).
	unlink: async ({ params, cookies }) => {
		const s = target(params, cookies);
		unlink(s.id);
		recover([s.id]);
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

	/** TAGS on a book's sheet: its own tags (doc/BOOKS.md, "Every book keeps its own"). */
	bookTag: async ({ request, params, cookies }) => {
		const s = target(params, cookies);
		const form = await request.formData();
		const tag = parseTag(String(form.get('pick') ?? form.get('tag') ?? ''));
		if (!tag) return fail(400, { tagMessage: 'TYPE A TAG AS NAMESPACE:VALUE' });
		if (!addBookTag(s.id, Number(form.get('entry')), tag))
			return fail(400, { tagMessage: 'THAT BOOK IS NOT IN THIS SERIES' });
		return { ok: true };
	},

	bookUntag: async ({ request, params, cookies }) => {
		const s = target(params, cookies);
		const form = await request.formData();
		removeBookTag(s.id, Number(form.get('entry')), {
			namespace: String(form.get('namespace') ?? ''),
			value: String(form.get('value') ?? '')
		});
		return { ok: true };
	},

	bookRate: async ({ request, params, cookies }) => {
		const s = target(params, cookies);
		const form = await request.formData();
		const rating = parseRating(form.get('rating'));
		if (rating === undefined) return fail(400, { message: 'rating must be 0-10' });
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
		recover([s.id]);
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
		recover([s.id, single]);
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
			recover([s.id]);
		} catch (e) {
			if (e instanceof GroupingError) return fail(400, { message: e.message });
			throw e;
		}
		return { ok: true };
	},

	/**
	 * UNDO after ADD TO EXISTING: take the books just added back out. For a
	 * novel the entries named are each volume's first, and the whole volume goes.
	 */
	undoAdd: async ({ request, params, cookies }) => {
		const s = target(params, cookies);
		const ids = entryIds(await request.formData());
		if (s.kind === 'novel')
			takeOutVolumes(
				s.id,
				s.entries.filter((e) => ids.includes(e.id)).map((e) => e.file)
			);
		else recover([s.id, ...takeOut(s.id, ids)]);
		redirect(303, `/series/${s.id}`);
	},

	/**
	 * UNGROUP: every book back out as a single, or every volume of a novel
	 * back into a series of its own (doc/BOOKS.md); the series goes.
	 */
	ungroup: async ({ params, cookies }) => {
		const s = target(params, cookies);
		if (s.kind === 'novel') {
			const made = takeOutVolumes(s.id);
			void refreshCovers({ ids: made, remote: false });
		} else
			recover(
				takeOut(
					s.id,
					s.entries.map((e) => e.id)
				)
			);
		redirect(303, '/?sort=added');
	},

	move: async ({ request, params, cookies }) => {
		const s = target(params, cookies);
		const form = await request.formData();
		try {
			moveBook(s.id, Number(form.get('entry')), Number(form.get('to')));
			recover([s.id, Number(form.get('to'))]);
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
		// Marked read here is read here: the catalogues move forward (doc/TRACKING.md).
		if (read) afterReading(s.id);
		// Ranobe is told of an unmark too: a read tsundoku sent is taken back (doc/RANOBE.md).
		else ranobeAfterReading(s.id);
		return { ok: true, changed };
	},

	/**
	 * DELETE, after its confirmation (doc/DELETING.md): the series, its files
	 * to the trash, a tombstone so it stays gone.
	 */
	delete: async ({ params, cookies }) => {
		const s = target(params, cookies);
		await deleteSeries([s.id], isRevealed(cookies));
		// The page leaves by itself, the way its ← does (src/lib/back.ts).
		return { deletedSeries: s.id };
	},

	/** DELETE on a book's sheet: that book only; the series keeps the rest. */
	deleteBook: async ({ request, params, cookies }) => {
		const s = target(params, cookies);
		const entry = Number((await request.formData()).get('entry'));
		let gone: boolean;
		try {
			gone = (await deleteBook(s.id, entry, isRevealed(cookies))).seriesGone;
		} catch (e) {
			if (e instanceof DeleteError) return fail(400, { message: e.message });
			throw e;
		}
		// Its last book: the series went too.
		if (gone) redirect(303, '/');
		return { deletedBook: entry };
	},

	/**
	 * DOWNLOAD (doc/DOWNLOADING.md): NEXT 10, ALL N, the bulk bar's selection,
	 * or a tap on one row. Each chapter is decided again here, from what
	 * Suwayomi says now: one with no file is queued, a failed one retried, and
	 * anything else is left alone.
	 */
	download: async ({ request, params, cookies }) => {
		const s = target(params, cookies);
		const form = await request.formData();
		const d = await seriesDownloads(s.id, s.entries);
		if (d.kind === 'down') return fail(503, { message: 'Downloading is not answering' });
		if (d.kind !== 'ok') return fail(400, { message: 'this series has nothing to download from' });
		const states = new Map(
			Object.entries(d.states).map(([k, v]) => [Number(k), v as DownloadState])
		);
		const which = form.get('which');
		const ids =
			which === 'next'
				? nextToDownload(s.entries, states)
				: which === 'all'
					? allToDownload(s.entries, states)
					: entryIds(form);
		const fresh = ids.filter((id) => rowAction(states.get(id)) === 'queue');
		const failed = ids
			.map((id) => states.get(id))
			.flatMap((st) => (st?.kind === 'failed' ? [st.chapterId] : []));
		let result = { queued: 0, missing: 0 };
		try {
			if (fresh.length) result = await enqueue(s.id, fresh);
			await retry(failed);
		} catch (e) {
			if (isDownloadsError(e)) return fail(503, { message: (e as Error).message });
			throw e;
		}
		return { downloaded: { queued: result.queued + failed.length, missing: result.missing } };
	},

	/** FOLLOW and FOLLOWING ✓: new chapters download as Suwayomi finds them (doc/DOWNLOADING.md). */
	follow: async ({ request, params, cookies }) => {
		const s = target(params, cookies);
		const on = (await request.formData()).get('on') === '1';
		try {
			await setFollowed(s.id, on);
		} catch (e) {
			if (isDownloadsError(e)) return fail(503, { message: (e as Error).message });
			throw e;
		}
		return { ok: true };
	},

	/**
	 * UNDO on ADDED TO THE LIBRARY: out of both libraries again, while nothing
	 * of it is downloaded or read, and back to the result it was added from.
	 */
	undoSourceAdd: async ({ request, params, cookies }) => {
		const s = target(params, cookies);
		// The preview it was added from, by the backend's own id for it.
		const from = String((await request.formData()).get('from') ?? '');
		let undone: boolean;
		try {
			undone = await undoSourceAdd(s.id);
		} catch (e) {
			if (isDownloadsError(e)) return fail(503, { message: (e as Error).message });
			throw e;
		}
		if (!undone) return fail(409, { message: 'something of it is downloaded or read now' });
		redirect(303, /^[\w~-]+$/.test(from) ? `/downloads/source/${from}` : '/');
	},

	/** A long press on a chapter row: it and everything before it, read. */
	markThrough: async ({ request, params, cookies }) => {
		const s = target(params, cookies);
		const through = Number((await request.formData()).get('through'));
		const entry = s.entries.find((e) => e.id === through);
		if (!entry) return fail(400, { message: 'no such chapter in this series' });
		const ids = markReadThrough(s.id, entry.id);
		afterReading(s.id);
		return { markedThrough: { ids, label: entry.label, number: entry.number } };
	}
};

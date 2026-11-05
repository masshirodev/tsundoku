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
	countTiles,
	createCollection,
	dismissScan,
	kindCounts,
	languagesOn,
	listTiles,
	setFavourite,
	setInCollection,
	setRating
} from '$lib/server/library';
import { isRevealed, runCommand } from '$lib/server/prefs';
import { parseRating } from '$lib/library/rating';
import { defaultWorkName } from '$lib/library/works';
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
import { libraryRoot, SCAN_WAITS, startScan } from '$lib/server/import';
import { lastImport } from '$lib/server/import/log';
import { firstReadExtras, readSources } from '$lib/server/start';
import { refreshCovers } from '$lib/server/covers';
import { refreshMany } from '$lib/server/refresh';
import { deleteSeries } from '$lib/server/delete';
import { isGated } from '$lib/server/unlock';
import {
	WorkError,
	addSeries,
	createWork,
	setHiddenWhole,
	takeOutAndHide,
	undoAdds,
	undoCreate,
	undoHideWhole,
	undoTakeOuts,
	undoUngroup,
	workChoices,
	workFeetFor,
	workRecords,
	worksOnTagPage,
	type AddFacts,
	type CreateFacts,
	type TakeOutFacts,
	type UngroupFacts,
	type WholeFacts
} from '$lib/server/works';
import { pageSizeOf } from '$lib/library/paging';

export const load: PageServerLoad = async ({ url, cookies, parent }) => {
	const { scan } = await parent();
	const reveal = isRevealed(cookies);
	// While a scan is running or just finished, the grid defaults to what it
	// brought in: "02 — ARRIVING" / "02 — JUST IMPORTED".
	const shelf = url.searchParams.get('shelf') ?? (scan ? 'new' : 'all');
	// FAVOURITES, RATED and DOWNLOADED are filters now (doc/FILTERS.md), and
	// SERIES, ONE-OFF and the kind shelves since c436 (FORM and the KIND
	// band's ?kind=): an old link lands on the same books, permanently.
	const legacy = legacyShelf(shelf, url.searchParams);
	if (legacy) redirect(308, `/?${legacy}`);
	const tag = url.searchParams.get('tag');
	const filters = parseFilters(url.searchParams, reveal);
	// LANGUAGE offers what the shelf holds; the shelf's own size is what
	// "44 OF 188" is out of, counted only while a filter narrows it.
	const languages =
		shelf === 'people' || shelf === 'cached'
			? []
			: languagesOn({ reveal, shelf, tag, kind: tag ? null : filters.kind });
	// The KIND band (c436; doc/LIBRARY.md, "The KIND band"): this shelf's
	// tiles by kind, every other filter applied. A kind the shelf doesn't hold
	// is kept, unlike a language: the band draws it at 0 and the grid says so,
	// so the kind chosen on TO READ is still chosen on DROPPED. A person's page
	// filters on the device and draws no band.
	const kindBand =
		shelf === 'people' || shelf === 'cached' || tag
			? null
			: kindCounts({ reveal, shelf, tag, filters });
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

	const total = countTiles(reveal);
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
	// PEOPLE lists favourite people (from the layout), not series.
	// The first page; the grid asks /api/library for the rest as it scrolls.
	// CACHED is the exception: only the tablet knows which series it holds,
	// so it gets them all, to narrow down itself.
	const tiles =
		shelf === 'people'
			? []
			: listTiles({
					reveal,
					shelf,
					tag,
					// CACHED narrows on the device, filters and all.
					filters: shelf === 'cached' ? undefined : filters,
					sort,
					dir,
					seed,
					limit: shelf === 'cached' ? undefined : pageSize
				});
	// A person's page is finding, so its series keep their own tiles -- each
	// wearing the Work it is a part of (doc/WORKS.md, "The one rule"). A
	// browsing Work tile carries its parts, so a selection made through it can
	// name the Work it would move them out of (W4's MOVES HERE). One query for
	// the page, never one per tile.
	const workFeet = Object.fromEntries(
		[
			...workFeetFor([
				...(person ? person.items.map((i) => i.seriesId) : []),
				...tiles.flatMap((c) => (c.tile ? c.tile.parts.map((p) => p.seriesId) : [c.id]))
			])
		].map(([id, w]) => [String(id), w])
	);
	return {
		shelf,
		tag,
		filters,
		languages,
		kindBand,
		shelfTotal:
			activeCount(filters) > 0 && shelf !== 'people' && shelf !== 'cached'
				? countListed({ reveal, shelf, tag })
				: null,
		person,
		workFeet,
		existing: seriesOfBooks(reveal),
		existingVolumes: seriesOfVolumes(reveal),
		sort,
		dir,
		seed,
		empty: total === 0 && !scan,
		// The first day (doc/ONBOARDING.md; handoff board 3): an empty library whose
		// checklist is through lists the sources it can read from instead.
		firstDay: total === 0 && !scan ? readSources(reveal) : [],
		// FIRST READ's open steps (doc/ONBOARDING.md; card c209): while the list is the library.
		firstRead: total === 0 && !scan ? firstReadExtras(reveal) : null,
		dupes,
		toLink,
		// FOLLOWED is a filter while something the viewer can see is followed (doc/DOWNLOADING.md).
		following: anyFollowed(reveal),
		libraryRoot: libraryRoot(),
		// IMPORT LOG under MORE says when the last backup came in (c438).
		lastImportAt: lastImport(reveal)?.at ?? null,
		cont: continueReading(reveal),
		// A Work that ended (TAKE OUT of the second-to-last, UNGROUP) has no
		// screen of its own any more: the library carries its band and its UNDO.
		gone: goneBand(url),
		// What GROUP can make of a selection (doc/BOOKS.md, "The AS row"): the
		// Works a selection may move into, and the series' own Work names.
		existingWorks: workChoices(),
		// A person's page says the run exists without pulling it in (W4).
		works: person
			? worksOnTagPage(
					person.items.map((i) => i.seriesId),
					reveal
				)
			: [],
		series: tiles,
		total: shelf === 'people' ? 0 : countListed({ reveal, shelf, tag, filters }),
		pageSize
	};
};

/** The band a Work's own screen or a series screen leaves behind (doc/NAVIGATION.md). */
function goneBand(url: URL): {
	kind: 'ended' | 'ungrouped' | 'hidden' | 'taken-out';
	name: string;
	facts: string;
	/** SERIES hidden by HIDE ALL n, for the band's own line. */
	n: number;
	/** TAKE OUT of a Work of two leaves one series: the Work ended with it. */
	ended: boolean;
} | null {
	const kind = url.searchParams.get('band');
	const facts = url.searchParams.get('facts') ?? '';
	if (
		(kind !== 'ended' && kind !== 'ungrouped' && kind !== 'hidden' && kind !== 'taken-out') ||
		facts === ''
	)
		return null;
	return {
		kind,
		name: url.searchParams.get('name') ?? '',
		facts,
		n: Number(url.searchParams.get('n')) || 0,
		// Only TAKE OUT can carry a Work's ending this way: it says so in its facts.
		ended: kind === 'taken-out' && workEnded(facts)
	};
}

/** Whether a TAKE OUT's facts left the Work with one series (its `ended` is set). */
function workEnded(facts: string): boolean {
	try {
		const out = JSON.parse(facts) as { out?: { ended?: unknown }[] };
		return out.out?.[0]?.ended != null;
	} catch {
		return false;
	}
}

/** The ids a form acted on, as submitted by `name="id"` inputs. */
function ids(form: FormData): number[] {
	return form
		.getAll('id')
		.map((v) => Number(v))
		.filter((n) => Number.isInteger(n) && n > 0);
}

/**
 * The band facts for a HIDE or UNHIDE that changed a Work: what UNDO puts back,
 * and the counts the band is worded from (`wholeBand`), with the series in no
 * Work kept apart from the Works' own. Every count is of what the write
 * changed (c390): a press that changed no Work -- a selection whose Work was
 * already hidden, say -- is the plain HIDE of series on their own, which has
 * no band, as `?/bulk`'s never had.
 */
function wholeAnswer(facts: WholeFacts, hidden: boolean) {
	if (facts.works === 0) return { ok: true };
	return hidden
		? { hideFacts: { hidden: facts.ids, out: [], whole: facts.whole, works: facts.works } }
		: { showFacts: { shown: facts.ids, whole: facts.whole, works: facts.works } };
}

/**
 * An UNDO the library has moved past (c308): the refusal, worded by
 * `WorkError`, in the field the library page already draws a Work's
 * refusals from. Anything else is a real failure and is thrown.
 */
function refused(e: unknown) {
	if (e instanceof WorkError) return fail(400, { workMessage: e.message.toUpperCase() });
	throw e;
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

	/**
	 * The plain HIDE / UNHIDE, which the library's series sheet posts -- on the
	 * search page too, for any hit, a Work's part included. A Work is hidden or
	 * shown whole (doc/WORKS.md, "The one rule"), so a part takes its Work with
	 * it, both ways, and the library's band says so. A series in no Work is
	 * hidden or shown on its own, as it always was, with no band.
	 */
	hide: async ({ request }) => {
		const form = await request.formData();
		const on = form.get('on') !== '0';
		return wholeAnswer(setHiddenWhole(ids(form), on), on);
	},

	/**
	 * HIDE ALL n: a Work is hidden or shown whole (doc/WORKS.md, "The one
	 * rule"), so a selection that holds part of one asks before it leaves a
	 * Work half-hidden. This answer hides every part of every Work the
	 * selection touches, and the selected series that are in none.
	 */
	hideAll: async ({ request }) => {
		const target = ids(await request.formData());
		if (target.length === 0) return fail(400, { message: 'nothing selected' });
		return wholeAnswer(setHiddenWhole(target, true), true);
	},

	/**
	 * TAKE OUT, THEN HIDE: the selected parts leave their Works and are hidden
	 * on their own; the rest stay a Work. Every part taken out keeps its rating,
	 * FAV, link and folder, and UNDO puts both back.
	 */
	hideParts: async ({ request }) => {
		const target = ids(await request.formData());
		if (target.length === 0) return fail(400, { message: 'nothing selected' });
		const { out, facts } = takeOutAndHide(target);
		return { hideFacts: { hidden: facts.ids, out, whole: facts.whole, works: facts.works } };
	},

	/**
	 * UNHIDE over the selection: the same rule as HIDE ALL n, the other way
	 * round. With reveal on a person's page draws a Work's series as their own
	 * tiles, so selecting one hidden part of a hidden Work and pressing UNHIDE
	 * must show the Work whole -- one part visible among hidden ones is the
	 * diverged state this branch exists to remove, and a rule about a state is
	 * not a rule until it is at every door to it. The selected series in no Work
	 * are shown with the rest.
	 */
	showAll: async ({ request }) => {
		const target = ids(await request.formData());
		if (target.length === 0) return fail(400, { message: 'nothing selected' });
		return wholeAnswer(setHiddenWhole(target, false), false);
	},

	/**
	 * UNDO after either HIDE answer: every take-out put back, then what the
	 * press hid shown again -- only what it changed (c390), so a series that
	 * was hidden before the press stays hidden. The library may have moved on
	 * since (the series added to another Work, the Work ended): that refuses,
	 * whole, and says why (c308).
	 */
	undoHide: async ({ request }) => {
		const form = await request.formData();
		const facts = JSON.parse(String(form.get('facts') ?? 'null')) as {
			hidden: number[];
			out: TakeOutFacts[];
		};
		try {
			undoHideWhole(facts);
		} catch (e) {
			return refused(e);
		}
		// A band that came from the URL (`from=band`) outlives an answer in the
		// same shape: leaving the page is what takes it down.
		if (form.get('from') === 'band') redirect(303, '/');
		return { ok: true };
	},

	/** UNDO of UNHIDE: what it showed is hidden again, whole. */
	undoShow: async ({ request }) => {
		const facts = JSON.parse(String((await request.formData()).get('facts') ?? 'null')) as {
			shown: number[];
		};
		setHiddenWhole(facts.shown, true);
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
		} else if (form.get('do') === 'hide' || form.get('do') === 'unhide') {
			// The bar sends a selection holding a Work's part to ?/hideAll's sheet
			// or ?/showAll instead; this door keeps the rule anyway, so a posted
			// part still takes its Work whole. UNHIDE comes out of a hidden root
			// too: each becomes public (src/lib/server/visibility.ts).
			const on = form.get('do') === 'hide';
			return wholeAnswer(setHiddenWhole(target, on), on);
		}
		return { ok: true };
	},

	/**
	 * REFRESH over the selection (card c221; doc/DOWNLOADING.md, "REFRESH"):
	 * each series whose source can be asked is asked once, through the same
	 * `refreshSeries` the series screen uses, and nothing is downloaded. The
	 * batch bounds itself and leaves out what reveal hides, so the band can
	 * say what was asked, what found something, and what failed.
	 */
	refresh: async ({ request, cookies }) => {
		const result = await refreshMany(ids(await request.formData()), {
			reveal: isRevealed(cookies)
		});
		return { refreshed: result };
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
	 * A WORK: gather the selection into a Work, in the order the sheet sent its
	 * rows (doc/WORKS.md; Works Calls, "Making and breaking a Work"). This is
	 * W4's AS sheet's create, replacing W2's stopgap cell.
	 *
	 * The sheet is the only door that may move a series out of another Work
	 * (`sheet=1`): its rows say `IN <WORK> · MOVES HERE`, so the move is the
	 * owner's. Every other caller keeps W2's refusal, because a whole-shelf
	 * SELECT ALL must not collapse every Work on it into one. The sheet too
	 * refuses a selection that touches two or more Works, which is exactly that
	 * collapse by another route.
	 *
	 * The name defaults to the words every title starts with; titles that share
	 * none have no default, and the sheet's own cell is disabled until one is
	 * typed (`THE TITLES SHARE NO WORDS`).
	 */
	work: async ({ request }) => {
		const form = await request.formData();
		const seriesIds = form
			.getAll('series')
			.map(Number)
			.filter((n) => Number.isInteger(n) && n > 0);
		if (seriesIds.length < 2) return fail(400, { workMessage: 'A WORK NEEDS TWO SERIES' });
		const sheet = form.get('sheet') === '1';
		const involved = getDb()
			.prepare(
				`SELECT DISTINCT work_id AS id FROM work_series
					WHERE series_id IN (${seriesIds.map(() => '?').join(',')})`
			)
			.all(...seriesIds) as { id: number }[];
		if (!sheet && involved.length > 0)
			return fail(400, {
				workMessage: 'A WORK KEEPS ITS PARTS · MOVE ONE FROM ITS OWN SCREEN'
			});
		if (involved.length > 1)
			return fail(400, {
				workMessage: 'A WORK KEEPS ITS PARTS · MOVE ONE FROM ITS OWN SCREEN'
			});
		const titles = seriesIds.map(
			(id) =>
				(getDb().prepare(`SELECT title FROM series WHERE id = ?`).get(id) as { title: string })
					.title
		);
		const name = String(form.get('name') ?? '').trim() || defaultWorkName(titles);
		if (name === '') return fail(400, { workMessage: 'A WORK NEEDS A NAME' });
		let made: CreateFacts;
		try {
			// The sheet's rows are already in the owner's order: BY HAND is what
			// it posts, whatever ORDER sorted them.
			made = createWork({ seriesIds, name, order: 'hand' });
		} catch (e) {
			if (e instanceof WorkError) return fail(400, { workMessage: e.message.toUpperCase() });
			throw e;
		}
		return { made };
	},

	/**
	 * ADD TO A WORK · N: the sheet's existing Work, each chosen series moving in
	 * at the end of the run (a Work left with one ends, and UNDO puts it back).
	 */
	addToWork: async ({ request }) => {
		const form = await request.formData();
		const workId = Number(form.get('work'));
		if (!Number.isInteger(workId) || workId <= 0) return fail(400, { workMessage: 'PICK A WORK' });
		const seriesIds = form
			.getAll('series')
			.map(Number)
			.filter((n) => Number.isInteger(n) && n > 0);
		const facts: AddFacts[] = [];
		for (const id of seriesIds) {
			try {
				facts.push(addSeries(workId, id));
			} catch (e) {
				if (!(e instanceof WorkError)) throw e;
				if (facts.length === 0) return fail(400, { workMessage: e.message.toUpperCase() });
				break;
			}
		}
		if (facts.length === 0) return fail(400, { workMessage: 'NOTHING WAS ADDED' });
		return { addedWork: { workId, name: workRecords([workId])[0]?.name ?? '', facts } };
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

	/**
	 * UNDO after a Work ended. TAKE OUT's facts are a list (last first), an
	 * UNGROUP's are the whole Work; the facts ride in the band's form because
	 * the screen that made them is gone. A create and an add name their own
	 * kinds, and the library's own band carries them (`?/work`, `?/addToWork`).
	 */
	undoWork: async ({ request }) => {
		const form = await request.formData();
		const kind = String(form.get('kind') ?? '');
		const facts = JSON.parse(String(form.get('facts') ?? 'null'));
		try {
			if (kind === 'create') undoCreate(facts as CreateFacts);
			else if (kind === 'add') undoAdds(facts as AddFacts[]);
			else if (kind === 'ended') undoTakeOuts(facts as TakeOutFacts[]);
			else undoUngroup(facts as UngroupFacts);
		} catch (e) {
			return refused(e);
		}
		if (kind === 'create' || kind === 'add') return { ok: true };
		redirect(303, '/');
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
			return fail(400, { scanMessage: r.message });
		}
		// One import or scan at a time: behind a backup's import it says it waits.
		if (r.waiting) return { scanMessage: SCAN_WAITS };
		redirect(303, '/');
	}
};

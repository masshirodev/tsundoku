import { error, fail, redirect } from '@sveltejs/kit';
import { wantPictures } from '$lib/server/anime/pictures';
import { automaticCover, refreshCovers } from '$lib/server/covers';
import { DeleteError, deleteBook, deleteSeries } from '$lib/server/delete';
import type { Actions, PageServerLoad } from './$types';
import { getDb } from '$lib/server/db';
import { ocrPlace, restoreNotText, setSeriesOcr } from '$lib/server/japanese/ocr';
import { wordsOf } from '$lib/server/japanese/mining';
import { decide, twinOf } from '$lib/server/dupes';
import {
	linkState,
	parseUnlinkFacts,
	undoUnlink,
	UndoUnlinkRefused,
	unlink
} from '$lib/server/catalogue';
import { seriesSeasons } from '$lib/server/season-links';
import { unlinkSeries } from '$lib/server/ranobe';
import { ranobeSeries, retryRanobe } from '$lib/server/ranobe-review';
import { afterReading, editTracking, sendPending, trackingOf } from '$lib/server/tracking';
import { afterReading as ranobeAfterReading } from '$lib/server/ranobe';
import { STATUSES, type Status } from '$lib/library/tracking';
import { isAnime, seasonNamed } from '$lib/library/catalogue';
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
	RenameError,
	renameSeries,
	seriesPage,
	setDirection,
	undoRenameSeries
} from '$lib/server/series';
import { isRevealed } from '$lib/server/prefs';
import { seriesReadingTime } from '$lib/server/reading-time';
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
	isDownloadsError,
	previewIdOf,
	queueSeries,
	seriesDownloads,
	setFollowed,
	undoAdd as undoSourceAdd
} from '$lib/server/downloads';
import { baseToEdition } from '$lib/library/editions';
import { refreshSeries } from '$lib/server/refresh';
import {
	applyMoveBack,
	dismissMoveBand,
	formerCandidate,
	moveState,
	MoveError
} from '$lib/server/move';
import { m } from '$lib/paraglide/messages';
import { getSetting } from '$lib/server/settings';
import { libraryRoot } from '$lib/server/import';
import { ANIME_FOLDER, HIDDEN_ANIME_FOLDER, seriesFolderName } from '$lib/library/anime-files';
import { join } from '$lib/server/fspath';
import { originLabel, sourceOrigin } from '$lib/library/origin';
import { tagSourceOf } from './tag-source.server';
import {
	StaleWorkError,
	WorkError,
	addSeries,
	dismissWorkOffer,
	hideWork,
	parseWorkDismissalKey,
	reorder,
	seriesWorkRow,
	takeOut as takeOutPart,
	takeOutAndHide,
	undoAdds,
	undoHideWhole,
	undoTakeOut,
	undoWorkOffer,
	workOfSeries,
	workOfferFor,
	workParts
} from '$lib/server/works';
import { addFacts, hideFacts, parsePosted, renameFacts, takeOutFacts } from './posted-facts';

/** A Work's refusal (a part gone, a Work ended since), as a band on this screen, never a 500. */
function refused(e: unknown) {
	if (e instanceof WorkError) return fail(400, { message: e.message.toUpperCase() });
	throw e;
}

/** Where an anime's episodes go: its folder once it has one, else where its first will. */
function animeFolderOf(seriesId: number, title: string, hidden: boolean): string {
	const known = getDb()
		.prepare(`SELECT folder FROM anime_series WHERE series_id = ?`)
		.get(seriesId) as { folder: string } | undefined;
	return join(
		libraryRoot(),
		known?.folder ?? join(hidden ? HIDDEN_ANIME_FOLDER : ANIME_FOLDER, seriesFolderName(title))
	);
}

function seriesId(raw: string): number {
	const id = Number(raw);
	if (!Number.isInteger(id) || id <= 0) error(404, 'not found');
	return id;
}

/**
 * Where the back cell leads, and what it says. `from` is set by the link that
 * opened the series: a shelf key, `continue`, a source's BROWSE page or the
 * search it was added from (an in-app path, card c262), a Work (`work:<id>`,
 * set by its run rows, W5), or nothing.
 */
function backTo(from: string | null, seriesId: number, shelves: { key: string; name: string }[]) {
	if (from?.startsWith('/')) {
		const origin = sourceOrigin(from);
		if (origin) return { label: originLabel(origin), href: origin };
		return { label: 'Library', href: '/' };
	}
	if (from === 'continue') return { label: 'Continue · Library', href: '/' };
	if (from === 'history') return { label: 'History', href: '/history' };
	// From a person or tag page: back to it, named by the person.
	if (from?.startsWith('tag:')) {
		const tag = from.slice(4);
		return { label: tag.slice(tag.indexOf(':') + 1), href: `/?tag=${encodeURIComponent(tag)}` };
	}
	// From a Work's run: ← names the Work, and only when this series really is
	// one of its parts. A stale or hand-typed id is not a claim the back cell
	// can repeat, so it falls back to the library (W5; doc/NAVIGATION.md).
	if (from?.startsWith('work:')) {
		const id = Number(from.slice(5));
		const work = Number.isInteger(id) && id > 0 ? workOfSeries(seriesId) : null;
		if (work && work.id === id) return { label: work.name, href: `/work/${work.id}` };
		return { label: 'Library', href: '/' };
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
	// A browsing record (doc/BROWSING.md) has no series screen of its own: it is
	// its source's preview, with + ADD, until it is added.
	const browsing = getDb()
		.prepare(`SELECT origin_key FROM series WHERE id = ? AND in_library = 0`)
		.get(series.id) as { origin_key: string } | undefined;
	if (browsing) {
		const preview = previewIdOf(browsing.origin_key);
		if (preview) redirect(303, `/downloads/source/${preview}`);
		error(404, 'not found');
	}
	// Episodes without a picture get one in the background (doc/ANIME.md,
	// "Episode pictures"): they show on the next visit.
	if (series.kind === 'anime')
		wantPictures(series.entries.filter((e) => !e.episode?.thumb).map((e) => e.id));
	const { shelves } = await parent();
	const books = isBookSeries(series);
	const single = series.kind === 'doujin' && series.entries.length === 1;
	const bookParam = Number(url.searchParams.get('book'));
	const root = rootOf(series.id);
	return {
		series,
		// TAGS search the series' own source too (c313); its filters only when IN <SOURCE> is followed (tag-search/).
		tagSource: tagSourceOf(series.id, reveal),
		back: backTo(url.searchParams.get('from'), series.id, shelves),
		// Where this series sits in its Work (W5; doc/WORKS.md): one row under
		// CONTINUE, its neighbours, and what the run offers at the end of this part.
		work: seriesWorkRow(series.id, reveal),
		// MIGHT CONTINUE <WORK> · AS PART N (W7; doc/WORKS.md, "The offer"): the
		// one Work this title continues, for a series in none. It only offers.
		workOffer: workOfferFor(series.id, reveal),
		editing: url.searchParams.get('edit') === 'tags',
		// A book of a series of books opened on its own: its pages.
		book: books ? (series.entries.find((e) => e.id === bookParam) ?? null) : null,
		// Only a single book can be suggested into a series.
		suggestion: single ? suggestionFor(series.id, reveal) : null,
		// Where a book can move to, or singles can be added: same root only.
		otherSeries: seriesOfBooks(reveal).filter((o) => o.rootId === root && o.id !== series.id),
		created: url.searchParams.get('created') === '1',
		// Japanese (doc/JAPANESE.md): OCR's progress, and the words looked up. Never for
		// novels, which are text, nor anime, which has no pages (doc/ANIME.md).
		ocr: series.kind === 'novel' || series.kind === 'anime' ? null : ocrPlace(series.id),
		// The PAGES grid's page menu (c26): where the covers come from now.
		cover: coverState(series.id),
		// A book here with a likely twin (doc/DUPLICATE-BOOKS.md): the band.
		twin: twinBand(series.id, reveal),
		// One book in several languages (doc/EDITIONS.md): its LANGUAGE and EDITIONS rows.
		editions: series.kind === 'doujin' ? bookEditions(series.id) : null,
		words: series.kind === 'novel' || series.kind === 'anime' ? null : wordsOf(series.id, reveal),
		// Its MyAnimeList / AniList entry (doc/LINKS.md): the LINK and COVER rows.
		link: linkState(series.id),
		// An anime's seasons (c240): a link each, and the row folds round the one
		// being watched. Null for anything else, which draws today's rows.
		seasons: isAnime(series.kind) ? (seriesSeasons(series.id)?.seasons ?? null) : null,
		// What each catalogue's list says, and what tsundoku sent (doc/TRACKING.md).
		tracking: trackingOf(series.id),
		// A novel's Ranobe link and line (doc/RANOBE.md). Null for a comic.
		ranobe: ranobeSeries(series.id),
		// Downloading (doc/DOWNLOADING.md): the DOWNLOAD row and each chapter's state.
		downloads: await seriesDownloads(series.id, series.entries),
		// An anime's ALL asks its QUALITY (doc/ANIME.md, "Downloading"): SETTINGS' height, and where it goes.
		anime:
			series.kind === 'anime'
				? {
						quality: Number(getSetting('anime_download_quality')) || 1080,
						folder: animeFolderOf(series.id, series.title, series.hidden)
					}
				: null,
		// ALL N's confirmation is a URL, so it opens without script too.
		confirmAll: url.searchParams.get('download') === 'all',
		// Just added from a source search (Download States 1e, after adding): the band, and UNDO.
		// The engine's id for it is `<source>~<url>` (engine/backend.ts), never a number:
		// a Number() here dropped the band after every ADD on the engine. A novel's is
		// `ln:<plugin>~<path>` (novels/source.ts).
		addedFrom: /^[\w~.:-]{1,512}$/.test(url.searchParams.get('added') ?? '')
			? url.searchParams.get('added')
			: null,
		// ADD AND DOWNLOAD (card c205): how many it queued, or `down` when the queue didn't answer.
		addedQueued: /^(\d+|down)$/.test(url.searchParams.get('queued') ?? '')
			? url.searchParams.get('queued')
			: null,
		// MOVE (doc/MOVE.md; card c139): the SOURCE row, the NO VIDEO band, and
		// what the series screen says just after a move.
		move: moveState(series.id),
		// Time read (card c443; doc/READING-LOG.md): the one summary, under the reveal filter.
		readMs: seriesReadingTime(series.id, reveal),
		moved:
			url.searchParams.get('moved') === '1'
				? {
						added: Number(url.searchParams.get('added')) || 0,
						kept: Number(url.searchParams.get('kept')) || 0
					}
				: null
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

/**
 * The season a form is about, when it names one: an anime's rows pass it. An
 * absent field is no season at all, not season 0 -- a comic's form has none,
 * and 0 is a real season (a flat list) (c240).
 */
function seasonOf(form: FormData): { season?: number; part?: number } {
	const season = seasonNamed(form.get('season'));
	if (season === undefined) return {};
	const part = seasonNamed(form.get('part'));
	return { season, part: part !== undefined && part > 0 ? part : 1 };
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
		if (s.kind === 'anime') return fail(400, { message: 'an episode has no pages' });
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
	// score is the rating (c67), sent by the RATING row's own save. An anime
	// sets the season the sheet is on (c240): the other seasons keep theirs.
	tracking: async ({ request, params, cookies }) => {
		const s = target(params, cookies);
		const form = await request.formData();
		const status = String(form.get('status') ?? '');
		if (!(STATUSES as string[]).includes(status)) return fail(400, { message: 'no such status' });
		const where = seasonOf(form);
		if (editTracking(s.id, { status: status as Status }, Date.now(), where) > 0)
			await sendPending({ seriesId: s.id });
		return { ok: true };
	},

	// TRY AGAIN on a LISTS line (Series Link 1n; c424): what failed, sent now.
	// A season's line names its season, and only that season's sends go; a
	// comic's names none, and both its lists go (MAL rides on AniList's line).
	retryTracking: async ({ request, params, cookies }) => {
		const s = target(params, cookies);
		const { season } = seasonOf(await request.formData());
		await sendPending({ seriesId: s.id, season });
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

	// UNLINK (Series Link 1k): gone, and an import won't bring it back
	// (doc/LINKS.md). On an anime it is the named season's link that goes, and
	// with no season named (the one-season LINK row posts none) every season's
	// (c240). Read through `seasonOf`, never `Number(form.get(...))`: an absent
	// field is no season, and 0 is a real one.
	unlink: async ({ request, params, cookies }) => {
		const s = target(params, cookies);
		const unlinked = unlink(s.id, Date.now(), seasonOf(await request.formData()).season);
		recover([s.id]);
		// The band's UNDO carries what went (c520): every column, keyed by the
		// series and its season and part, posted back to ?/undoUnlink.
		return { unlinked };
	},

	// UNDO on UNLINK's band (c520): the link back exactly as it was, or a
	// refusal in the band's words when something linked or decided since.
	undoUnlink: async ({ request, params, cookies }) => {
		const s = target(params, cookies);
		const facts = parseUnlinkFacts(String((await request.formData()).get('facts') ?? ''), s.id);
		if (!facts) return fail(400, { message: 'NOTHING TO UNDO' });
		try {
			undoUnlink(facts);
		} catch (e) {
			if (e instanceof UndoUnlinkRefused) return fail(409, { message: e.message });
			throw e;
		}
		recover([s.id]);
		return { ok: true };
	},

	/**
	 * RENAME on the FILE row (c526; doc/SERIES.md, "RENAME"): the owner's name
	 * for the series, kept through scans, refreshes and imports. The band
	 * carries the facts for UNDO, as the Work screen's does.
	 */
	rename: async ({ request, params, cookies }) => {
		const s = target(params, cookies);
		try {
			const renamed = renameSeries(s.id, String((await request.formData()).get('name') ?? ''));
			return { ok: true, renamed };
		} catch (e) {
			if (e instanceof RenameError) return fail(400, { message: e.message });
			throw e;
		}
	},

	undoRename: async ({ request, params, cookies }) => {
		const s = target(params, cookies);
		// A band's facts are this series' own; a posted id for another is refused.
		const facts = renameFacts(parsePosted((await request.formData()).get('facts')), s.id);
		if (!facts) return fail(400, { message: 'NOTHING TO UNDO' });
		try {
			undoRenameSeries(facts);
		} catch (e) {
			if (e instanceof RenameError) return fail(400, { message: e.message });
			throw e;
		}
		return { ok: true };
	},

	hide: async ({ request, params, cookies }) => {
		const s = target(params, cookies);
		const hide = (await request.formData()).get('on') !== '0';
		// A Work is hidden or shown whole (W4): a part goes through ?/hideWork,
		// ?/hidePart (take out, then hide) or ?/showWork. No screen offers this
		// action for a part, and a hand-posted one would leave it hidden among
		// visible parts, so it refuses here too.
		if (workOfSeries(s.id))
			return fail(400, { message: 'A WORK IS HIDDEN WHOLE · HIDE ALL OR TAKE OUT' });
		setHidden([s.id], hide);
		// Hidden with reveal off, this screen no longer exists for the viewer.
		if (hide && !isRevealed(cookies)) redirect(303, '/');
		return { ok: true };
	},

	/**
	 * HIDE ALL n on a series in a Work (W4; Work-States 4): a Work is hidden or
	 * shown whole, so one part never leaves it half-hidden. With reveal off this
	 * screen no longer exists afterwards: the library carries the band and UNDO.
	 *
	 * The facts are what the press changed (c390), and a press that changed
	 * nothing an UNDO may put back has no band (c469): a Work hidden in part
	 * before it is settled hidden with no UNDO (decision 6 of wave 19, since an
	 * UNDO could only half-hide it again), and a Work already hidden whole
	 * changes nothing. A band there would say HIDDEN over an UNDO that answers
	 * NOTHING TO UNDO; with reveal off it was `/?band=hidden&n=0`.
	 */
	hideWork: async ({ params, cookies }) => {
		const s = target(params, cookies);
		const work = workOfSeries(s.id);
		if (!work) return fail(400, { message: 'THIS SERIES IS IN NO WORK' });
		const { ids } = hideWork(work.id, true);
		if (ids.length === 0) {
			if (!isRevealed(cookies)) redirect(303, '/');
			return { ok: true };
		}
		const facts = { hidden: ids, out: [], whole: ids, works: 1 };
		if (!isRevealed(cookies)) {
			const gone = new URLSearchParams({
				band: 'hidden',
				name: work.name,
				n: String(ids.length),
				facts: JSON.stringify(facts)
			});
			redirect(303, `/?${gone}`);
		}
		return { hideFacts: facts };
	},

	/**
	 * TAKE OUT on the HIDE sheet: the series leaves its Work and is hidden on
	 * its own, so the other parts stay a Work. UNDO puts both back.
	 *
	 * One write (c390): `takeOutAndHide` takes it out and hides it in one
	 * transaction, so a take-out that fails leaves nothing half done -- no part
	 * hidden alone in its Work -- and the facts hold only what changed. A
	 * refusal is answered as the library answers one, never as a 500.
	 */
	hidePart: async ({ params, cookies }) => {
		const s = target(params, cookies);
		const work = workOfSeries(s.id);
		let done: ReturnType<typeof takeOutAndHide>;
		try {
			done = takeOutAndHide([s.id]);
		} catch (e) {
			return refused(e);
		}
		const facts = {
			hidden: done.facts.ids,
			out: done.out,
			whole: done.facts.whole,
			works: done.facts.works
		};
		if (!isRevealed(cookies)) {
			// TAKE OUT is not HIDE ALL n: only this series is hidden, and the rest
			// of the Work is still on the shelf it stands on (`taken-out` says so,
			// and the band tells the owner when the Work ended too).
			const gone = new URLSearchParams({
				band: 'taken-out',
				name: work?.name ?? s.title,
				n: '1',
				facts: JSON.stringify(facts)
			});
			redirect(303, `/?${gone}`);
		}
		return { hideFacts: facts };
	},

	/**
	 * UNDO after either HIDE answer, on the screen that is still there (reveal
	 * on): the library's own UNDO, `undoHideWhole` -- the take-outs put back
	 * first, then only what the HIDE hid shown, in one write. A refusal from
	 * either half rolls back both and is answered, not thrown (c390).
	 */
	undoHide: async ({ request, params, cookies }) => {
		const s = target(params, cookies);
		// Malformed facts, or a HIDE that was not this series', undo nothing (c585).
		const facts = hideFacts(parsePosted((await request.formData()).get('facts')), s.id);
		if (!facts) return fail(400, { message: 'NOTHING TO UNDO' });
		try {
			undoHideWhole(facts);
		} catch (e) {
			return refused(e);
		}
		return { ok: true };
	},

	/**
	 * UNHIDE on a part of a Work shows the Work whole, not this series alone: one
	 * part visible among hidden ones is the diverged state W4's HIDE settles, and
	 * the rule is a Work is hidden or shown whole at every door.
	 */
	showWork: async ({ params, cookies }) => {
		const s = target(params, cookies);
		const work = workOfSeries(s.id);
		if (!work) return fail(400, { message: 'THIS SERIES IS IN NO WORK' });
		const { ids } = hideWork(work.id, false);
		return { shown: { ids } };
	},

	/**
	 * MOVE ↑ ↓ on the WORK row's sheet (W5): one step earlier or later in the
	 * owner's order. The whole list is rewritten, as `reorder` requires, from
	 * every part the Work holds -- hidden ones too, or a partial list would
	 * leave the rest wherever they fell.
	 */
	moveWork: async ({ request, params, cookies }) => {
		const s = target(params, cookies);
		const work = workOfSeries(s.id);
		if (!work) return fail(400, { message: 'THIS SERIES IS IN NO WORK' });
		const dir = String((await request.formData()).get('dir') ?? '');
		if (dir !== 'up' && dir !== 'down') return fail(400, { message: 'NO SUCH DIRECTION' });
		const order = workParts(work.id, true)
			.slice()
			.sort((a, b) => a.position - b.position || a.seriesId - b.seriesId)
			.map((p) => p.seriesId);
		const i = order.indexOf(s.id);
		const j = dir === 'up' ? i - 1 : i + 1;
		if (i < 0 || j < 0 || j >= order.length) return fail(400, { message: 'NO PART THAT WAY' });
		[order[i], order[j]] = [order[j], order[i]];
		reorder(work.id, order);
		return { ok: true };
	},

	/**
	 * TAKE OUT on the WORK row's sheet (W5): the series is its own again, and
	 * the Work ends if it is left with one. The band stays on this screen, since
	 * the series itself is still here; the Work's name rides in the facts'
	 * owner (`takenFrom`).
	 */
	takeOutWork: async ({ params, cookies }) => {
		const s = target(params, cookies);
		const work = workOfSeries(s.id);
		if (!work) return fail(400, { message: 'THIS SERIES IS IN NO WORK' });
		const facts = takeOutPart(work.id, s.id);
		return { workTakenOut: facts, workFrom: work.name };
	},

	/**
	 * UNDO after the WORK row's TAKE OUT. The put-back refuses, never
	 * overwrites, when the library has moved on (the series is in another
	 * Work now, the Work has ended or another has its id: `putBack`, c308),
	 * and the refusal is this screen's band, not a 500 (c468).
	 */
	undoTakeOutWork: async ({ request, params, cookies }) => {
		const s = target(params, cookies);
		// Malformed facts, or another series' take-out, undo nothing (c585).
		const facts = takeOutFacts(parsePosted((await request.formData()).get('facts')), s.id);
		if (!facts) return fail(400, { message: 'NOTHING TO UNDO' });
		try {
			undoTakeOut(facts);
		} catch (e) {
			return refused(e);
		}
		return { ok: true };
	},

	/**
	 * REVIEW → on MIGHT CONTINUE <WORK>, then the sheet's ADD 1 TO THE WORK
	 * (W7): this series, and only this series, joins the Work the owner
	 * picked, last. The sheet posts here because its ADD TO A WORK cell posts
	 * `?/addToWork` relative to the page it is open on. Nothing else moves --
	 * no rating, FAV, FOLLOW or link crosses between series (Works Calls,
	 * question 6's NEVER list) -- and the band's UNDO takes it out again.
	 */
	addToWork: async ({ request, params, cookies }) => {
		const s = target(params, cookies);
		const form = await request.formData();
		const workId = Number(form.get('work'));
		if (!Number.isInteger(workId) || workId <= 0) return fail(400, { workMessage: 'PICK A WORK' });
		const ids = form.getAll('series').map(Number);
		// From this screen the sheet's one tickable row is this series: anything
		// else is not this screen's to add.
		if (ids.length !== 1 || ids[0] !== s.id)
			return fail(400, { workMessage: 'ONLY THIS SERIES CAN BE ADDED FROM ITS SCREEN' });
		// `works.id` is reused once the newest Work ends, so the posted id alone
		// may name an unrelated Work by now. The offer's key names the Work by
		// its moment of making and this series; the add goes through only while
		// the offer this screen reads now is that same offer -- which also
		// refuses one dismissed, or one whose Work stopped matching, since load.
		const key = parseWorkDismissalKey(String(form.get('key') ?? ''));
		const now = workOfferFor(s.id, isRevealed(cookies));
		if (!key || !key.endsWith(`:${s.id}`) || now?.workId !== workId || now.key !== key)
			return fail(400, { workMessage: 'THAT WORK HAS CHANGED · LOOK AGAIN', stale: true });
		try {
			const facts = addSeries(workId, s.id, now.createdAt);
			return { workJoined: facts };
		} catch (e) {
			if (e instanceof StaleWorkError)
				return fail(400, { workMessage: e.message.toUpperCase(), stale: true });
			if (e instanceof WorkError) return fail(400, { workMessage: e.message.toUpperCase() });
			throw e;
		}
	},

	/** UNDO on the ADDED TO <WORK> band: the series leaves the Work again (`undoAdds`). */
	undoAddToWork: async ({ request, params, cookies }) => {
		const s = target(params, cookies);
		// This screen undoes its own series' add, never one the facts name elsewhere.
		const facts = addFacts(parsePosted((await request.formData()).get('facts')), s.id);
		if (!facts) return fail(400, { message: 'NOTHING TO UNDO' });
		try {
			undoAdds([facts]);
		} catch (e) {
			return refused(e);
		}
		return { ok: true };
	},

	/** NOT THIS on MIGHT CONTINUE <WORK>: never offered again (W1's `work_dismissals`). */
	dismissWorkOffer: async ({ request, params, cookies }) => {
		const s = target(params, cookies);
		const key = parseWorkDismissalKey(String((await request.formData()).get('key') ?? ''));
		// The key names the series it was offered to: this screen dismisses its own.
		if (!key || !key.endsWith(`:${s.id}`)) return fail(400, { message: 'NO SUCH OFFER' });
		return { workOfferDismissed: dismissWorkOffer(key) };
	},

	/** UNDO on NOT THIS · WON'T ASK AGAIN: the offer comes back. */
	undoWorkOffer: async ({ request, params, cookies }) => {
		const s = target(params, cookies);
		const key = parseWorkDismissalKey(String((await request.formData()).get('key') ?? ''));
		if (!key || !key.endsWith(`:${s.id}`)) return fail(400, { message: 'NO SUCH OFFER' });
		undoWorkOffer(key);
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
	 * a tap on one row, or the end page's DOWNLOAD FIRST 10 (`which=first`:
	 * the first ten unread, whatever is under way, c534). Each chapter is decided again here, from what
	 * the queue says now: one with no file is queued, a failed one retried, and
	 * anything else is left alone.
	 */
	download: async ({ request, params, cookies }) => {
		const s = target(params, cookies);
		const form = await request.formData();
		const which = form.get('which');
		// ALL's QUALITY for an anime (doc/ANIME.md, "Downloading"): these episodes at that height.
		const height = Number(form.get('quality'));
		const quality = [360, 480, 720, 1080].includes(height) ? height : null;
		let result: Awaited<ReturnType<typeof queueSeries>>;
		try {
			result = await queueSeries(
				s.id,
				s.entries,
				which === 'next' || which === 'all' || which === 'first' ? which : entryIds(form),
				quality
			);
		} catch (e) {
			if (isDownloadsError(e)) return fail(503, { message: (e as Error).message });
			throw e;
		}
		if (!result) return fail(400, { message: 'this series has nothing to download from' });
		return { downloaded: result };
	},

	/** FOLLOW and FOLLOWING ✓: new chapters download as the source lists them (doc/DOWNLOADING.md). */
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
	 * REFRESH (card c220): ask the source once what it lists now, and make
	 * entries of anything new. It queues nothing — FOLLOW decides downloads, and
	 * this is a look — so the band it answers with says what arrived and leaves
	 * NEXT or ALL to keep them.
	 */
	refresh: async ({ params, cookies }) => {
		const s = target(params, cookies);
		try {
			const r = await refreshSeries(s.id);
			if (!r) return fail(400, { message: m.series_refresh_no_source() });
			return { refreshed: r };
		} catch (e) {
			if (isDownloadsError(e)) return fail(503, { message: (e as Error).message });
			throw e;
		}
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
		redirect(303, /^[\w~.:-]{1,512}$/.test(from) ? `/downloads/source/${from}` : '/');
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
	},

	/**
	 * MOVE BACK on the SOURCE row (doc/MOVE.md): straight back to the source
	 * the series left, no search and no comparison, for 30 days. It is a move —
	 * reading carries back by number and nothing downloads — so the answer is
	 * the same band a move gives.
	 */
	moveBack: async ({ params, cookies }) => {
		const s = target(params, cookies);
		if (!moveState(s.id).former)
			return fail(400, { message: 'the way back has closed · move again' });
		const candidate = await formerCandidate(s.id);
		if (!candidate) return fail(400, { message: 'there is no source to move back to' });
		let result: Awaited<ReturnType<typeof applyMoveBack>>;
		try {
			result = applyMoveBack(s.id, candidate.chapters);
		} catch (e) {
			if (e instanceof MoveError || isDownloadsError(e)) return fail(503, { message: e.message });
			throw e;
		}
		redirect(303, `/series/${s.id}?moved=1&added=${result.added}&kept=${result.kept}`);
	},

	/** UNDO on the MOVED band: the same move back, before the band goes. */
	undoMove: async ({ params, cookies }) => {
		const s = target(params, cookies);
		if (!moveState(s.id).former)
			return fail(400, { message: 'the way back has closed · move again' });
		const candidate = await formerCandidate(s.id);
		if (!candidate) return fail(400, { message: 'there is no source to move back to' });
		let result: Awaited<ReturnType<typeof applyMoveBack>>;
		try {
			result = applyMoveBack(s.id, candidate.chapters);
		} catch (e) {
			if (e instanceof MoveError || isDownloadsError(e)) return fail(503, { message: e.message });
			throw e;
		}
		redirect(303, `/series/${s.id}?moved=1&added=${result.added}&kept=${result.kept}`);
	},

	/** NOT NOW on the NO VIDEO band: nothing shows until a new failure. */
	dismissMove: async ({ params, cookies }) => {
		const s = target(params, cookies);
		dismissMoveBand(s.id);
		return { ok: true };
	}
};

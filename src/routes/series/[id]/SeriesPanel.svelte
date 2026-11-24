<script lang="ts">
	import HelpMark from '$lib/components/help/HelpMark.svelte';
	import HelpSheet from '$lib/components/help/HelpSheet.svelte';
	import { animeContinue, seriesCountLine } from '$lib/library/anime';
	import { ocrLines, type OcrPlace } from '$lib/japanese/ocr';
	import { enhance } from '$app/forms';
	import type { ActionResult, SubmitFunction } from '@sveltejs/kit';
	import { replacing, settleReplacing } from '$lib/back';
	import Badge from '$lib/components/content/Badge.svelte';
	import { coverPlaceholder } from '$lib/library/cover';
	import RatingSlider from '$lib/components/controls/RatingSlider.svelte';
	import {
		continueAction,
		directionOptions,
		directionRowLabel,
		effectiveDirection,
		fileMeta,
		formatNumber,
		seriesMeta,
		tagGroups,
		type SeriesPage
	} from '$lib/library/series';
	import type { Shelf } from '$lib/library/types';
	import { booksOf, isBookSeries, isVolumeSeries } from '$lib/library/series';
	import { m } from '$lib/paraglide/messages';
	import { num } from '$lib/i18n/format';
	import { suggestionLabel, type Suggestion } from '$lib/library/books';
	import { readTime } from '$lib/library/history';
	import { kindFacts, kindUnit } from '$lib/library/kinds';
	import { coverSrc, tagHref, readHref, seriesHref, withParam } from '$lib/library/links';
	import Band from '$lib/components/chrome/Band.svelte';
	import { tagSearchHref } from '$lib/library/tag-search';
	import { invalidateAll } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { postAction, saves, type FailedSave } from '$lib/saves.svelte';
	import { seriesSaves } from '$lib/serial-saves';
	import type { Rating } from '$lib/library/types';
	import type { BookEditions } from '$lib/server/editions';
	import { baseToEdition, langName } from '$lib/library/editions';
	import UnfoldSheet from './UnfoldSheet.svelte';
	import TagSheet from './TagSheet.svelte';
	import { libraryTagKey, tagRouteHref } from '$lib/library/tag-search';
	import type { LinkState } from '$lib/server/catalogue';
	import type { TmdbLinkState } from '$lib/server/tmdb-links';
	import type { FilmPage } from './film.server';
	import type { DownloadRow } from '$lib/library/downloads';
	import {
		filmAction,
		filmCountLine,
		filmDownloadRow,
		kindRow,
		type FilmFile
	} from '$lib/library/film';
	import type { SeasonRow } from '$lib/library/catalogue';
	import { offline } from '$lib/offline.svelte';
	import TrackingSheet from './TrackingSheet.svelte';
	import type { Tracking } from '$lib/server/tracking';
	import { ago, clock } from '$lib/library/tracking';
	import ListsRow from './ListsRow.svelte';
	import {
		DETAILS_KEY,
		TV_NAMES,
		detailsLine,
		detailsOpen,
		listsMarks,
		namesLine,
		sentWord,
		sourceMark,
		type DetailsRunning
	} from './details';
	import { listsRow, type SheetAt } from './lists';
	import type { RanobeSeries } from '$lib/server/ranobe-review';
	import type { PendingFailed, Refusal } from '$lib/server/dupes';
	import type { SeriesDownloads } from '$lib/server/downloads';
	import type { MoveState } from '$lib/server/move';
	import { partDone, wholeBand } from '$lib/library/works';
	import type { SeriesWorkRow, TakeOutFacts, WorkOffer } from '$lib/server/works';
	import Sheet from '$lib/components/chrome/Sheet.svelte';
	import { longpress } from '$lib/actions/longpress';
	import HideSheet from '../../HideSheet.svelte';
	import { unitLabel } from '$lib/library/labels';
	import {
		downloadCounts,
		downloadRow,
		EPISODES,
		fileQueueMeta,
		type DownloadState
	} from '$lib/library/downloads';
	import { page } from '$app/state';
	import { untrack } from 'svelte';

	/**
	 * The series' metadata: a header that scrolls away in portrait, a 440px
	 * panel with its own scroll in landscape (the CSS decides which). Order is
	 * the design's: identity, then rating and FAV, then CONTINUE -- all within
	 * thumb reach -- then direction, shelves, tags, about, and the file row with
	 * HIDE at the very end, away from CONTINUE.
	 */
	let {
		series,
		ringDownload = false,
		shelves,
		cached,
		onedit,
		ondelete,
		suggestion = null,
		dismissedKey = null,
		onreview,
		workOffer = null,
		workOfferDismissed = null,
		onworkreview,
		cta = $bindable<HTMLElement | null>(null),
		outline = false,
		ocr = null,
		words = null,
		twin = null,
		keptBoth = null,
		editions = null,
		link = null,
		tmdb = null,
		film = null,
		onkind,
		tracking = null,
		ranobe = null,
		seasons = null,
		downloads = null,
		move = null,
		tagSource = null,
		noVideo = null,
		readOnline = false,
		work = null,
		merged = false,
		readMs = 0,
		takenOut = null,
		dropAnswer = () => undefined,
		hideFacts = null,
		highlights = null
	}: {
		/** FIRST READ's next step is this row: a 2px accent ring while its trip lasts (doc/ONBOARDING.md). */
		ringDownload?: boolean;
		/**
		 * HIGHLIGHTS: `14 · 3 NOTES`, `6 PAGES · 1 NOTE`.
		 * Null while the series has none, and then the row is not drawn.
		 */
		highlights?: { line: string } | null;
		series: SeriesPage;
		shelves: Shelf[];
		/** Entries of this series cached on the device. */
		cached: number;
		onedit: () => void;
		/** DELETE: the page asks first (doc/DELETING.md). */
		ondelete?: () => void;
		/** "Might be one series": only on a single book, only visible books. */
		suggestion?: Suggestion | null;
		/** Set just after NOT A SERIES, so the band can offer UNDO. */
		dismissedKey?: string | null;
		onreview?: () => void;
		/** MIGHT CONTINUE <WORK> · AS PART N (W7): only for a series in no Work. */
		workOffer?: WorkOffer | null;
		/** A merged show: UNGROUP is its undo. Never an ordinary anime with seasons. */
		merged?: boolean;
		/** Set just after NOT THIS, so its band can offer UNDO. */
		workOfferDismissed?: string | null;
		/** REVIEW → on the offer: the page opens the sheet in ADD TO A WORK. */
		onworkreview?: () => void;
		/** The CONTINUE bar, observed by the page to know when it scrolled away. */
		cta?: HTMLElement | null;
		/**
		 * Waiting: only what the tapped tile knew is real -- cover, title,
		 * kind, rating, FAV, counts. The rest is drawn in outline, and CONTINUE
		 * doesn't open until its chapter is known.
		 */
		outline?: boolean;
		/** OCR's progress on the workstation; null for novels. */
		ocr?: OcrPlace | null;
		/** Words looked up in it: waiting for review, and sent to Kumiko. */
		words?: { toReview: number; sent: number } | null;
		/** A likely twin of a book here (doc/DUPLICATE-BOOKS.md): the SAME BOOK AS band. */
		twin?: { key: string; title: string; conf: string; pages: string } | null;
		/**
		 * KEEP BOTH's answer: the decisions waiting from before that it
		 * could not carry out first. Read from the page's `form`, so the note
		 * outlives the reload that takes the twin band away, and goes with the
		 * next action, a navigation or a reload.
		 */
		keptBoth?: { refused: Refusal[]; failed: PendingFailed[] } | null;
		/** One book in several languages (doc/EDITIONS.md): LANGUAGE, EDITIONS and FOLDED. */
		editions?: BookEditions | null;
		/** Its catalogue link (doc/LINKS.md): the LINK and COVER rows. Null for a doujin. */
		link?: LinkState | null;
		/** A film's or a show's TMDB link: LISTS' TMDB line. Null for any other kind. */
		tmdb?: TmdbLinkState | null;
		/** A film's or a show's screen: its TMDB facts, the KIND row's folder. Null for any other kind. */
		film?: FilmPage | null;
		/** KIND's CHANGE: the kind switch's sheet. */
		onkind?: () => void;
		/** What the catalogues' lists say of it, and what was sent (doc/TRACKING.md). */
		tracking?: Tracking | null;
		/**
		 * A novel's Ranobe link and line (doc/RANOBE.md). With a token, they
		 * stand in for AniList's LINK and TRACKING rows: Ranobe is where a
		 * novel's reads go. Null for a comic.
		 */
		ranobe?: RanobeSeries | null;
		/**
		 * An anime's seasons: a link and a line each, folded round the one
		 * being watched. Null for a series that isn't an anime, which draws the
		 * rows exactly as it did.
		 */
		seasons?: SeasonRow[] | null;
		/** Downloading (doc/DOWNLOADS.md): the DOWNLOAD row and the FILE line's queue. */
		downloads?: SeriesDownloads | null;
		/** MOVE's SOURCE row (doc/MOVE.md): where the series comes from and the way out. */
		move?: MoveState | null;
		/** The source TAGS search besides the library; null for none, and a tag opens the library. */
		tagSource?: { id: string; name: string } | null;
		/** A source that lists episodes but sends no video: the NO VIDEO band under CONTINUE. */
		noVideo?: { title: string; detail: string } | null;
		/** A chapter with no file reads online (doc/READING-ONLINE.md): START opens it, as an episode streams. */
		readOnline?: boolean;
		/** Where this series sits in its Work (W5; doc/WORKS.md): the WORK row and its sheet. */
		work?: SeriesWorkRow | null;
		/** Time read, ms, from the reading log: READ 12 H 40, or WATCHED. */
		readMs?: number;
		/** TAKE OUT from the WORK row: the facts UNDO reads, and the Work it left. */
		takenOut?: { facts: TakeOutFacts; from: string } | null;
		/** Clears the answer the four bands below draw. */
		dropAnswer?: () => void;
		/** HIDE ALL n or TAKE OUT, THEN HIDE, where the screen is still here (W4). */
		hideFacts?: {
			hidden: number[];
			out: TakeOutFacts[];
			whole: number[];
			works: number;
		} | null;
	} = $props();

	/**
	 * KEEP BOTH's note, in the words the duplicates review uses: what
	 * could not be carried out, and where each one is now. Nothing when every
	 * earlier decision was carried out, as KEEP BOTH answered before.
	 */
	const keptBothNote = $derived.by(() => {
		if (!keptBoth) return null;
		const r = keptBoth.refused.length;
		const f = keptBoth.failed.length;
		const n = r + f;
		if (n === 0) return null;
		const where = [
			r ? `${r === n ? '' : `${r} `}BACK IN THE REVIEW` : '',
			f ? `${f === n ? '' : `${f} `}STILL WAITING` : ''
		].filter(Boolean);
		return {
			title: `KEPT BOTH · ${n} EARLIER DECISION${n === 1 ? '' : 'S'} COULDN’T BE CARRIED OUT`,
			detail: where.join(' · ')
		};
	});

	/** An anime series: episodes for chapters, here and in DOWNLOAD (doc/ANIME.md). */
	const anime = $derived(kindFacts(series.kind).medium === 'video');
	/** A film's one cell, else an anime's or a show's, else a book's. */
	const filmed = $derived(
		film?.film ? filmAction(series.entries, film.facts?.runtime ?? null, Date.now()) : null
	);

	/** SHOW on a fold opens every season's line, and closes when the screen is left. */
	let seasonsOpen = $state(false);

	// ---- DOWNLOAD ------------------------------------------------
	/** DOWNLOAD's "?" sheet (doc/HELP.md). */
	let helpOpen = $state(false);
	// ---- the WORK row (W5) ---------------------------------------------------------------
	/** The WORK row's own sheet: OPEN, MOVE ↑ ↓, TAKE OUT. */
	let workSheet = $state(false);
	/** HIDE on a part asks first (W4). */
	let hiding = $state(false);
	/** The moment this Work was made, as the Work controls post it back. */
	const workMade = $derived(work?.createdAt ?? null);
	/**
	 * Whether an answer refused because this screen's Work has moved on since
	 * it was drawn -- ended, or its id given to another (`StaleWorkError`).
	 * SvelteKit's `update()` applies the action's `form` on a failure; it
	 * re-reads the page only on a success, so a route that keeps drawing the
	 * Work it read must invalidate here.
	 */
	function staleWork(result: ActionResult): boolean {
		return (
			result.type === 'failure' &&
			(result.data as Record<string, unknown> | undefined)?.stale === true
		);
	}
	/**
	 * `use:enhance` for the WORK row sheet's MOVE and TAKE OUT: other answers
	 * behave as before; a stale refusal closes the sheet and reads the page
	 * again, so the band says LOOK AGAIN over the Work the series is in now and
	 * the next press posts that Work's moment.
	 */
	const workAfter =
		(close: boolean): SubmitFunction =>
		() =>
		async ({ result, update }) => {
			// On a success `update()` re-reads the page already (SvelteKit's
			// fallback); on a failure it only applies the action's `form`.
			await update();
			// Re-read before closing: a sheet re-opened while the read is still
			// out would be drawn on the old Work's moment, and refused again.
			if (staleWork(result)) await invalidateAll();
			if (close || staleWork(result)) workSheet = false;
		};
	/**
	 * `replacing` for the two UNHIDE forms, plus a read of the page on a stale
	 * refusal: the Work the screen drew is gone or its id names another,
	 * so the band must be drawn over the Work there is now.
	 */
	const replacingStale: SubmitFunction =
		() =>
		async ({ result, update }) => {
			await settleReplacing({ result, update });
			if (staleWork(result)) await invalidateAll();
		};
	/** HIDE ALL n's band, worded from the count (`wholeBand`); TAKE OUT has its own words. */
	const hiddenBand = $derived(
		hideFacts && hideFacts.whole.length > 0
			? wholeBand('HIDDEN', {
					ids: hideFacts.hidden,
					whole: hideFacts.whole,
					works: hideFacts.works
				})
			: null
	);
	/** This part is done, so CONTINUE goes quiet and the run's next is the accent (Work-Row B3). */
	const quiet = $derived(
		!outline && ((!!work && partDone(work.state)) || (filmed?.quiet ?? false))
	);
	/**
	 * The WORK row's second line, in two pieces so its title stays in ink:
	 * `PART 2 OF 3 · NEXT · ` + the neighbouring part, or `... · YOU'RE IN ` +
	 * the part the run has moved into (`workRowLine` decides which).
	 */
	const workLine = $derived.by(() => {
		if (!work) return { lead: '', ink: '' };
		const place = `PART ${work.part} OF ${work.of}`;
		if (work.youAreIn) return { lead: `${place} · YOU'RE IN `, ink: work.youAreIn.toUpperCase() };
		if (work.nextTitle) return { lead: `${place} · NEXT · `, ink: work.nextTitle.toUpperCase() };
		return { lead: place, ink: '' };
	});
	const dlStates = $derived(
		downloads?.kind === 'ok'
			? new Map(Object.entries(downloads.states).map(([k, v]) => [Number(k), v as DownloadState]))
			: null
	);
	const seriesDl = $derived(
		dlStates
			? downloadRow(
					series.entries,
					{ kind: 'ok', states: dlStates },
					offline.online,
					clock,
					downloads?.kind === 'ok' ? downloads.follow : null,
					(at) => ago(at, Date.now()),
					anime ? EPISODES : undefined,
					downloads?.kind === 'ok' && downloads.refreshable
				)
			: downloads?.kind === 'down'
				? downloadRow(
						series.entries,
						downloads,
						offline.online,
						clock,
						null,
						clock,
						anime ? EPISODES : undefined
					)
				: null
	);
	const dlFile = $derived(dlStates ? fileQueueMeta(downloadCounts(series.entries, dlStates)) : []);
	/**
	 * A film's DOWNLOAD row: one file, so where that file is
	 * and one cell; no NEXT 10, ALL, REFRESH or FOLLOW. The quality is said once
	 * the file is here, as its size is.
	 */
	const filmDl = $derived.by((): DownloadRow | null => {
		if (!film?.film || !dlStates) return null;
		const e = series.entries[0];
		if (!e) return null;
		const st = dlStates.get(e.id);
		const f: FilmFile =
			!st || st.kind === 'none'
				? { state: 'none', bytes: null, height: null }
				: st.kind === 'have' || st.kind === 'importing'
					? { state: 'here', bytes: e.bytes, height: null }
					: st.kind === 'queued'
						? { state: 'queued', ahead: null, bytes: null }
						: st.kind === 'downloading'
							? { state: 'downloading', done: st.fraction, bytes: null, leftS: null }
							: { state: 'failed', why: 'The last try failed' };
		const r = filmDownloadRow(f);
		const which = f.state === 'none' ? 'next' : f.state === 'failed' ? 'retry' : 'cancel';
		return {
			a: r.title,
			b: r.meta,
			cells: r.cell ? [{ label: r.cell, which, acc: false, dim: !offline.online }] : []
		};
	});
	/**
	 * A film's or a show's watch in the local log's words, for LISTS' LIST line:
	 * `WATCHED 3 NOV`, `EP. 6 OF 16`, `NOT WATCHED`.
	 */
	const watchWords = $derived.by(() => {
		if (filmed) return filmed.quiet ? filmed.meta : 'NOT WATCHED';
		const seen = series.entries.filter((e) => e.readAt !== null).length;
		return seen ? `EP. ${seen} OF ${series.entries.length}` : 'NOT WATCHED';
	});
	/** The offer NOT THIS just declined, for its band's UNDO. */
	let declined = $state<string | null>(null);
	/** A show's seasons from TMDB: the SEASONS row and SEASON N IS OUT. */
	const showView = $derived(film?.surround?.kind === 'seasons' ? film.surround.view : null);
	/** FIND for a show's missing season: the screen's own source searched for the show's name. */
	const showFind = $derived(
		showView && tagSource && film?.facts?.title
			? tagSearchHref(
					resolve('/browse/[source]', { source: tagSource.id }),
					[],
					{ namespace: 'title', value: film.facts.title },
					resolve('/series/[id]', { id: String(series.id) })
				)
			: null
	);
	/** The DOWNLOAD row as drawn: a film's one file, or the series'. */
	const dlRow = $derived(filmDl ?? seriesDl);
	/** The KIND row: the kind, its folder and how many files it holds. */
	const kindLine = $derived(
		film
			? kindRow({
					kind: film.film ? 'movie' : 'show',
					folder: film.folder,
					files: series.entries.filter((e) => e.available).length
				})
			: null
	);
	/**
	 * REFRESH asks the source while the request runs, so after its answer the
	 * screen reads again: the chapters it just added are in the list it drew.
	 * The band comes from the action's own data (the page's `form`).
	 */
	const refreshAfter: SubmitFunction =
		() =>
		async ({ result, update }) => {
			await update();
			if (result.type === 'success') await invalidateAll();
		};
	// No extension for its source (Bato.to, Hitomi): said once, on the FILE line.
	// It cannot say the tablet downloads it: a device's
	// Mihon downloads are not imported (doc/DOWNLOADS.md, "Limits").
	const elsewhere = $derived(
		downloads?.kind === 'elsewhere'
			? ` · ${downloads.source.toUpperCase()} · NO EXTENSION HERE`
			: ''
	);

	// ---- LISTS: LINK and TRACKING as one row, a line per list ------------------------
	const linkOff = $derived(!offline.online);
	/** EDIT's sheet, and the line it was opened from. */
	let trackingOpen = $state(false);
	let sheetAt = $state<SheetAt>({ list: 'anilist', season: null });
	const lists = $derived(
		outline
			? null
			: listsRow({
					seriesId: series.id,
					kind: series.kind,
					link,
					tmdb,
					watch: tmdb ? watchWords : undefined,
					tracking,
					ranobe,
					seasons,
					// NEVER TRACKED is the source's switch: the row says why, and
					// offers no send, instead of a line per list that would never move.
					neverTracked: !!tracking?.neverTracked,
					expanded: seasonsOpen,
					offline: linkOff,
					now: Date.now(),
					linksHref: resolve('/links'),
					settingsHref: resolve('/settings')
				})
	);

	// ---- a folded book ---------------------------------------------------
	/** The edition it opens in: its title leads, READ opens it, its pages are the grid. */
	const opening = $derived(
		editions ? (editions.editions.find((e) => e.entryId === editions.opens) ?? null) : null
	);
	/** Where the book is, in the opening edition's pages (0-based). */
	const openingAt = $derived(
		editions && opening && editions.at !== null
			? opening.base
				? editions.at
				: baseToEdition(opening.rows, editions.at).page
			: null
	);
	const sameSize = $derived(
		!!editions &&
			editions.editions[0].size !== '' &&
			editions.editions.every((e) => e.size === editions.editions[0].size)
	);
	/** The language READ would open in without this book's own choice. */
	const defaultLanguage = $derived(
		editions
			? editions.editions.some((e) => e.language === editions.preferred)
				? editions.preferred
				: (editions.lastRead ?? editions.editions[0].language)
			: ''
	);
	const foldedOn = $derived(
		editions?.folded ? new Date(editions.folded).toLocaleDateString('sv-SE') : null
	);
	let unfolding = $state(false);
	const ocrRow = $derived(ocr ? ocrLines(ocr) : null);

	// Rating and FAV show their new value at once and save behind it. A save
	// that fails keeps the value, drawn dashed, with RETRY and PUT BACK in the
	// layout's band.
	// ---- DETAILS: the fold on a phone and a TV ----------------------------------------
	// Closed by default and remembered for the device, not the series
	// (`DETAILS_KEY`): wanting the settings showing is the user's habit. The
	// server draws it closed, so the first paint is never a flash of it open; a
	// device that remembers it open opens it once the page runs. Without
	// script the <noscript> rule below shows every row, as it always did.
	let detailsShown = $state(false);
	$effect(() => {
		try {
			detailsShown = detailsOpen(localStorage.getItem(DETAILS_KEY));
		} catch {
			detailsShown = false;
		}
	});
	function toggleDetails() {
		detailsShown = !detailsShown;
		try {
			if (detailsShown) localStorage.setItem(DETAILS_KEY, '1');
			else localStorage.removeItem(DETAILS_KEY);
		} catch {
			// Storage unavailable: the fold still holds for this visit.
		}
	}
	/** The names of the rows inside, in their order (the folded line's second line). */
	const detailsNames = $derived(
		[
			dlRow && 'DOWNLOAD',
			editions && opening && 'LANGUAGE',
			!anime && directionRowLabel(series.kind),
			ocrRow && 'OCR',
			series.duplicates > 0 && series.scanlators.length > 1 && 'SCANLATOR',
			lists && 'LISTS',
			link && 'COVER',
			move?.eligible && 'SOURCE',
			'TAGS',
			editions && opening ? 'FOLDED' : 'FILE'
		].filter((n): n is string => !!n)
	);
	/** Work under way inside: a chapter downloading, else OCR running. */
	const detailsRunning = $derived.by((): DetailsRunning | null => {
		const unit = kindUnit(series.kind).short;
		for (const e of series.entries) {
			const st = dlStates?.get(e.id);
			if (st?.kind === 'downloading')
				return { word: `${unit}. ${formatNumber(e.number)} DOWNLOADING`, fraction: st.fraction };
		}
		if (ocr?.running && ocrRow?.bar != null)
			return { word: `OCR ${ocrRow.a}`, fraction: ocrRow.bar };
		return null;
	});
	const detailsState = $derived(
		detailsLine({
			names: detailsNames,
			marks: [...listsMarks(lists), ...sourceMark(move)],
			quiet: [
				downloads?.kind === 'ok' && downloads.follow.on
					? 'FOLLOWING'
					: anime
						? ''
						: (directionOptions(series.kind).find((d) => d.value === direction)?.label ?? ''),
				sentWord(lists)
			],
			running: detailsRunning
		})
	);

	// RENAME's field, opened in place by its cell, as the Work screen's
	// is. A rename that lands closes it; a refusal leaves it open with its word.
	let renaming = $state(false);
	const renamed: SubmitFunction = () => {
		return async ({ result, update }) => {
			await update();
			if (result.type === 'success') renaming = false;
		};
	};
	const focusField = (n: HTMLInputElement) => {
		n.focus();
		n.select();
	};
	const actionBase = $derived(resolve('/series/[id]', { id: String(series.id) }));
	const moveHref = $derived(resolve('/series/[id]/move', { id: String(series.id) }));
	/** "1 DEC": the last day MOVE BACK is offered. */
	const formerUntil = $derived(
		move?.former
			? new Date(move.former.until)
					.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })
					.toUpperCase()
			: ''
	);
	let ratingNow = $state<Rating | null>(null);
	let favNow = $state<boolean | null>(null);
	const rating = $derived(ratingNow ?? series.rating);
	const favourite = $derived(favNow ?? series.favourite);
	/**
	 * FAV and the rating save one at a time per series, the last tap winning
	 * (`serial-saves.ts`, doc/SERIES.md, "FAV and the rating"). The local
	 * value stands while any save of its field is pending or unsaved, so an
	 * earlier answer's reload, or one from elsewhere, never puts the stored
	 * value back over a newer tap. The queue is the app's, not this panel's, so
	 * a panel mounted again (out to the library and back) still waits.
	 */
	const turns = seriesSaves;
	$effect(() => {
		// The stored values moved (the save landed, or the page changed): drop the local ones.
		void series.rating;
		void series.favourite;
		const id = series.id;
		untrack(() => {
			if (!holds(`rating:${id}`)) ratingNow = null;
			if (!holds(`fav:${id}`)) favNow = null;
		});
	});
	/** The field's local value is still the user's word, not the stored one. */
	const holds = (key: string) => turns.pending(key) || saves.unsaved(key);
	/**
	 * Save one tap in its turn. A superseded save does nothing more; the newest
	 * reloads the page, or (when it fails) shows the band, naming the value
	 * stored now, reloaded first if an earlier tap of the burst was stored.
	 */
	async function saveInTurn(
		key: string,
		id: number,
		save: () => Promise<boolean>,
		failed: () => Omit<FailedSave, 'key' | 'retry'>,
		clear: () => void,
		stored: () => boolean
	) {
		saves.clear(key);
		const turn = await turns.run(key, save);
		if (!turn.latest) return;
		// The reload is this turn's: the next tap's save waits for it to land.
		// `finally`, because the queue is the app's: a turn never settled
		// would hold the key for the whole session.
		try {
			if (turn.ok || turn.earlierStored) await invalidateAll();
		} finally {
			turns.settle(key);
		}
		// A newer tap came during the reload, or the screen is another series': theirs now.
		// Not `pending()`: that is true of an older turn still reloading too.
		if (turn.newer() || series.id !== id) return;
		// A failed save of the value already stored (FAV, then FAV again,
		// both lost) leaves nothing unsaved and no band to show.
		if (turn.ok || stored()) return clear();
		saves.fail({
			...failed(),
			key,
			// RETRY (and the nudge) wait their turn too; a tap meanwhile clears the band.
			retry: async () => {
				const again = await turns.run(key, save);
				if (!again.latest) return again.ok;
				try {
					if (again.ok) await invalidateAll();
				} finally {
					turns.settle(key);
				}
				if (again.ok && !again.newer() && series.id === id) clear();
				return again.ok;
			}
		});
	}
	function rate(n: Rating) {
		const id = series.id;
		const key = `rating:${id}`;
		// Taken now: a save that waits its turn must still post to this series.
		const url = `${actionBase}?/rate`;
		ratingNow = n;
		void saveInTurn(
			key,
			id,
			() => postAction(url, { rating: String(n) }),
			() => ({
				what: `RATING ${n} NOT SAVED`,
				putBackLabel: `PUT BACK ${series.rating}`,
				putBack: () => (ratingNow = null)
			}),
			() => (ratingNow = null),
			() => series.rating === n
		);
	}
	function toggleFav() {
		const on = !favourite;
		const id = series.id;
		const key = `fav:${id}`;
		const url = `${actionBase}?/favourite`;
		favNow = on;
		void saveInTurn(
			key,
			id,
			() => postAction(url, { on: on ? '1' : '0' }),
			() => ({
				what: on ? 'FAV NOT SAVED' : 'UNFAV NOT SAVED',
				putBackLabel: series.favourite ? 'PUT BACK · FAV' : 'PUT BACK · NOT FAV',
				putBack: () => (favNow = null)
			}),
			() => (favNow = null),
			() => series.favourite === on
		);
	}
	const ratingUnsaved = $derived(saves.unsaved(`rating:${series.id}`));
	const favUnsaved = $derived(saves.unsaved(`fav:${series.id}`));

	// An anime series' CONTINUE is its episode and the time left (doc/ANIME.md).
	const action = $derived(
		filmed ?? (anime ? animeContinue(series.entries) : continueAction(series))
	);
	const direction = $derived(effectiveDirection(series, series.kindDirection));
	const tags = $derived(tagGroups(series.tags));
	/**
	 * Which series has `+ N MORE` open. The id, not a flag: this component
	 * outlives a move from one series to another, and the next one's tags start
	 * folded. Both copies of TAGS read it, so a resize across the fold keeps it.
	 */
	let tagsOpenOn = $state<number | null>(null);
	const tagsOpen = $derived(tagsOpenOn === series.id);

	// ---- a tag searched for (doc/SERIES.md, the TAGS row) ------------------------------
	// Every value is a link to the library; with a source BROWSE can open, a tap
	// asks where to look instead (TagSheet), and without script the link stands.
	// IN <SOURCE> names the tag, not the answer: `tag-search` waits for the
	// source's filters and only then says where to go, so this screen asks the
	// source nothing, and the row is never a guess made before they came.
	/**
	 * Each group's tags as stored, in `tagGroups`' own order: a bare tag is
	 * grouped under `tag` but has no namespace, so a bare `Mecha` and a
	 * `tag:Mecha` are two values of one group, and each link is built from its
	 * own tag, never looked up by value, which would find the first for both
	 * and link to `?tag=Mecha`.
	 */
	const groupTags = $derived(
		(tagsOpen ? [...tags.groups, ...tags.rest] : tags.groups).map((g) => ({
			...g,
			tags: series.tags.filter((t) => (t.namespace || 'tag') === g.namespace)
		}))
	);
	/** The tag last tapped, kept while its sheet leaves so the head doesn't empty mid-motion. */
	let tagAsked = $state<{ namespace: string; value: string } | null>(null);
	let tagOpen = $state(false);
	const tagLibraryHref = (t: { namespace: string; value: string }) => tagHref(libraryTagKey(t));
	const tagSourceHref = $derived(
		tagSource && tagAsked
			? tagRouteHref(
					resolve('/series/[id]/tag-search', { id: String(series.id) }),
					tagAsked,
					page.url.pathname + page.url.search
				)
			: ''
	);
	function askTag(e: MouseEvent, t: { namespace: string; value: string }) {
		if (!tagSource) return;
		e.preventDefault();
		tagAsked = t;
		tagOpen = true;
	}
	const onShelves = $derived(
		shelves.filter(
			(s) => s.kind === 'collection' && series.collections.includes(Number(s.key.slice(2)))
		)
	);
	// A novel without a cover image of its own is set in type, not striped.
	const noCover = $derived(kindFacts(series.kind).medium === 'text' && !series.cover);
	let aboutOpen = $state(false);
	/** Where the cover goes: the same place as ▶ CONTINUE, once it's known. */
	const resumeHref = $derived(
		opening && !outline
			? readHref(opening.entryId)
			: action.entry && !outline && (anime || readOnline || action.entry.available)
				? readHref(action.entry.id)
				: undefined
	);
	// The chapter it would open has no file yet (after adding):
	// START is dimmed until it has one, as a row with no file doesn't open. An
	// episode streams, so it plays either way ("Two kinds of have").
	const noFile = $derived(
		!anime && !readOnline && !outline && !opening && !!action.entry && !action.entry.available
	);
	const ctaLabel = $derived(
		opening && editions && !editions.read && openingAt !== null
			? `READ FROM P. ${openingAt + 1}`
			: action.label
	);
</script>

<section class="panel" aria-label="About this series">
	<div class="identity">
		<!-- The cover resumes, as ▶ CONTINUE does: the biggest thing on the screen is the way in.
		     A second way for the finger only: CONTINUE is the one a screen reader and Tab find. -->
		<!-- eslint-disable-next-line svelte/no-navigation-without-resolve -- readHref() resolves -->
		<svelte:element
			this={resumeHref ? 'a' : 'div'}
			href={resumeHref}
			aria-hidden={resumeHref ? 'true' : undefined}
			tabindex={resumeHref ? -1 : undefined}
			class="cover"
			class:typeset={noCover}
			style:background={noCover
				? undefined
				: series.cover
					? `center / cover no-repeat url(${coverSrc(series.id, series.cover)}), ${coverPlaceholder(series.hue)}`
					: coverPlaceholder(series.hue)}
		>
			{#if noCover}
				<span class="nocover">NO COVER · EPUB</span>
				<span class="nocover-title">{series.title}</span>
			{/if}
			{#if series.hidden}<Badge tone="reveal" corner="top-left">HIDDEN</Badge>{/if}
			{#if favourite}<Badge tone="accent" corner="top-right">FAV</Badge>{/if}
		</svelte:element>
		<div class="names">
			<div class="meta">
				{outline
					? series.kind.toUpperCase()
					: editions
						? `DOUJIN · ${editions.editions.length} LANGUAGES`
						: seriesMeta(series)}
			</div>
			<h1>{opening?.title || series.title}</h1>
			{#if outline}
				<div class="out-lines" aria-hidden="true">
					<i style:width="46%"></i><i style:width="62%"></i>
				</div>
			{:else if editions && opening}
				<!-- The other editions' titles, each with its language. -->
				{#each editions.editions.filter((e) => e !== opening) as e (e.entryId)}
					<div class="alt ed-alt"><span class="ed-code">{e.code}</span><span>{e.title}</span></div>
				{/each}
			{:else}
				{#each series.altTitles as alt (alt)}<div class="alt">{alt}</div>{/each}
			{/if}
			{#if film?.film && !outline}
				<!-- A film's line: TMDB's year and runtime, or the source's words with no link. -->
				<div class="count">
					{filmCountLine({
						tmdb: film.facts,
						source: series.tags.find((t) => t.namespace === 'source')?.value ?? series.source,
						files: series.entries.filter((e) => e.available).length || series.entries.length,
						genre: film.genre,
						watched: !!filmed?.quiet
					})}
				</div>
			{:else if anime && !outline}<div class="count">{seriesCountLine(series.entries)}</div>{/if}
			<!-- The time read, as a fact beside the read progress: the reading
			     log's, so it is only what was recorded, and nothing when none was. -->
			{#if !outline && readMs > 0}
				<div class="count readtime">{kindUnit(series.kind).done} {readTime(readMs)}</div>
			{/if}
		</div>
	</div>

	<!-- RATING: the blocky slider, FAV at its end. -->
	<RatingSlider
		value={rating}
		unsaved={ratingUnsaved}
		height={64}
		phoneHeight={52}
		onchange={(n) => rate(n as Rating)}
		fav={{ on: favourite, onclick: toggleFav, unsaved: favUnsaved }}
	/>

	<!-- eslint-disable svelte/no-navigation-without-resolve -- readHref() resolves -->
	<a
		class="cta"
		class:nofile={noFile}
		class:quiet
		bind:this={cta}
		href={resumeHref}
		aria-disabled={!resumeHref}
		data-focus-id="series-continue"
		data-focus-start="true"
	>
		<span
			>{quiet
				? `↺ ${filmed ? 'WATCH AGAIN' : 'READ AGAIN'}`
				: `▶ ${outline ? 'CONTINUE' : ctaLabel}`}</span
		>
		{#if filmed?.progress != null && !quiet}
			<!-- The film's only progress line: 3px of on-accent at the cell's foot. -->
			<i
				class="cta-line"
				aria-hidden="true"
				style:width="{Math.round(filmed.progress * 1000) / 10}%"
			></i>
		{/if}
		{#if outline}
			<i class="cta-out" aria-hidden="true"></i>
		{:else}
			<span class="cta-meta">
				{#if quiet}
					<span class="long">{action.meta}</span>
					<span class="short">{action.short || action.meta}</span>
				{:else if opening}
					<span class="long">{opening.code} · {opening.pages} PAGES</span>
					<span class="short">{opening.code}</span>
				{:else}
					<span class="long"
						>{action.meta}{noFile ? ' · NOT DOWNLOADED' : ''}{kindFacts(series.kind).grouping ===
							'books' && cached > 0
							? ' · ↓ CACHED'
							: ''}</span
					>
					<span class="short">{noFile ? 'NO FILE' : action.short || action.meta}</span>
				{/if}
			</span>
		{/if}
	</a>
	<!-- eslint-enable svelte/no-navigation-without-resolve -->

	{#if !outline && declined}
		<Band
			title="NOT THIS · WON’T ASK AGAIN"
			detail={declined.replace('season:', 'SEASON ')}
			ondismiss={() => (declined = null)}
		>
			{#snippet action()}
				<form
					method="POST"
					action="?/undoDecline"
					use:enhance={() =>
						async ({ update }) => {
							declined = null;
							await update();
						}}
				>
					<input type="hidden" name="offer" value={declined} />
					<button type="submit">UNDO</button>
				</form>
			{/snippet}
		</Band>
	{:else if !outline && showView?.band}
		<!-- SEASON 4 IS OUT: MIGHT CONTINUE's band, under CONTINUE, on a
		     show's screen only. NOT THIS is kept, and no refresh asks it again. -->
		{@const offer = `season:${showView.band.season}`}
		<Band title={showView.band.title} detail={showView.band.meta}>
			{#snippet action()}
				{#if showFind}
					<!-- eslint-disable-next-line svelte/no-navigation-without-resolve -- tagSearchHref resolves -->
					<a href={showFind}>FIND</a>
				{/if}
				<form
					method="POST"
					action="?/declineOffer"
					use:enhance={() =>
						async ({ update }) => {
							declined = offer;
							await update();
						}}
				>
					<input type="hidden" name="offer" value={offer} />
					<button type="submit">NOT THIS</button>
				</form>
			{/snippet}
		</Band>
	{/if}
	{#if !outline && takenOut}
		<Band
			title={takenOut.facts.ended
				? `${takenOut.from.toUpperCase()} IS NO LONGER A WORK`
				: `TAKEN OUT OF ${takenOut.from.toUpperCase()}`}
			detail={takenOut.facts.ended
				? 'ONE SERIES WAS LEFT'
				: 'A SERIES ON ITS OWN AGAIN · KEEPS ITS RATING, FAV AND FOLDER'}
			ondismiss={dropAnswer}
		>
			{#snippet action()}
				<form method="POST" action="?/undoTakeOutWork" use:enhance>
					<input type="hidden" name="facts" value={JSON.stringify(takenOut.facts)} />
					<button type="submit">UNDO</button>
				</form>
			{/snippet}
		</Band>
	{:else if !outline && hideFacts}
		<!-- TAKE OUT's words say what happened: a part that was hidden
		     already is only taken out, and its UNDO only puts it back. -->
		<Band
			title={hiddenBand?.title ??
				(hideFacts.hidden.length > 0 ? 'HIDDEN · TAKEN OUT' : 'TAKEN OUT · ALREADY HIDDEN')}
			detail={hiddenBand?.detail ??
				`A SERIES ON ITS OWN AGAIN · ${hideFacts.hidden.length > 0 ? 'SHOWN AGAIN' : 'PUT BACK'} BY UNDO`}
			ondismiss={dropAnswer}
		>
			{#snippet action()}
				<form method="POST" action="?/undoHide" use:enhance>
					<input type="hidden" name="facts" value={JSON.stringify(hideFacts)} />
					<button type="submit">UNDO</button>
				</form>
			{/snippet}
		</Band>
	{/if}

	{#if !outline && work}
		{#if work.accent && work.nextPart}
			<!-- Read through (or caught up while the next part has something): one accent
			     on the screen, and it is the run's. A tap opens the next part's CH. 1. -->
			{@const next = work.nextPart}
			{@const opens = !!next.entry && (next.entry.available || next.entry.online)}
			<svelte:element
				this={opens ? 'a' : 'div'}
				class="prow next"
				class:off={!opens}
				href={opens && next.entry ? readHref(next.entry.id) : undefined}
				aria-disabled={opens ? undefined : 'true'}
			>
				<div class="label">NEXT</div>
				<div class="lk">
					<div class="lk-a">{next.title}</div>
					<div class="lk-b">
						IN {work.name.toUpperCase()} · PART {work.part + 1} · {next.entries}
						{unitLabel(next.kind)}.
					</div>
				</div>
				<div class="lc next-cell">
					{opens && next.entry
						? `▶ ${unitLabel(next.kind)}. ${next.entry.number}`
						: 'NOT DOWNLOADED'}
				</div>
			</svelte:element>
		{:else}
			<div class="prow work-row">
				<div class="label">WORK</div>
				<!-- A long press (or MENU, or a held OK) opens its sheet; a tap opens the Work. -->
				<!-- eslint-disable-next-line svelte/no-navigation-without-resolve -- resolve() builds the Work's URL -->
				<a
					class="lk"
					href={resolve('/work/[id]', { id: String(work.id) })}
					use:longpress={() => (workSheet = true)}
				>
					<span class="lk-a">{work.name}</span>
					<span class="lk-b"
						>{workLine.lead}{#if workLine.ink}<span class="ink">{workLine.ink}</span>{/if}</span
					>
				</a>
				<!-- eslint-disable svelte/no-navigation-without-resolve -- seriesHref() resolves -->
				{#if work.prev}
					<a
						class="pn"
						href={seriesHref(work.prev.seriesId, `work:${work.id}`)}
						aria-label="Part {work.part - 1}, {work.prev.title}">←</a
					>
				{:else}
					<span class="pn off" aria-hidden="true">←</span>
				{/if}
				{#if work.next}
					<a
						class="pn"
						href={seriesHref(work.next.seriesId, `work:${work.id}`)}
						aria-label="Part {work.part + 1}, {work.next.title}">→</a
					>
				{:else}
					<span class="pn off" aria-hidden="true">→</span>
				{/if}
				<!-- eslint-enable svelte/no-navigation-without-resolve -->
			</div>
		{/if}
	{/if}

	<!-- DETAILS (doc/SERIES.md, "DETAILS"):
	     on a phone and a TV the rows a visit rarely touches fold behind one line.
	     The screen's order is the markup's where nothing folds, and the fold's
	     where it applies, so Tab and a screen reader read what is drawn. The four
	     groups the two orders place differently (the bands, SHELVES, ABOUT and
	     TAGS) are drawn twice, one copy for each order
	     (`fold-only`, `screen-only`), and CSS shows one: no script, so the
	     first paint is right, and `display: none` takes the other out of Tab, the
	     focus layer and the screen reader. Neither copy holds an id, a `bind:this`
	     or a focus scope, and their state is this component's. -->
	<div class="o o2 fold-only">{@render bandsGroup(true)}</div>

	{#if !outline}
		<div class="o o4 fold-only">{@render shelvesGroup()}</div>
		{#if series.description}
			<div class="o o6 fold-only">{@render aboutGroup()}</div>
		{/if}
		{#if highlights}
			<!-- HIGHLIGHTS on the phone and the TV: after ABOUT, above the
			     DETAILS fold. The tablet's and the desktop's is after LISTS (below). -->
			{@render highlightsRow('hl-fold')}
		{/if}
		{@render detailsLineCell()}
	{/if}

	<div class="details" class:open={detailsShown} id="series-details" data-details>
		<div class="o o1">
			{#if !outline && dlRow}
				<!-- DOWNLOAD: under CONTINUE, as LINK's shape. NEXT never asks; ALL opens its confirmation by URL. -->
				{#snippet dlCells()}
					{#each dlRow?.cells ?? [] as c (c.which)}
						{#if c.dim}
							<span class="lc dim" class:acc={c.acc} aria-disabled="true">{c.label}</span>
						{:else if c.which === 'follow' || c.which === 'unfollow'}
							<form method="POST" action="?/follow" use:enhance class="lc-form">
								<input type="hidden" name="on" value={c.which === 'follow' ? '1' : '0'} />
								<button type="submit" class="lc" class:acc={c.acc}>{c.label}</button>
							</form>
						{:else if c.which === 'refresh'}
							<!-- REFRESH asks the source once and downloads nothing: the band says what arrived. -->
							<form method="POST" action="?/refresh" use:enhance={refreshAfter} class="lc-form">
								<button type="submit" class="lc" class:acc={c.acc} disabled={c.dim}
									>{c.label}</button
								>
							</form>
						{:else if c.which === 'cancel' || c.which === 'retry'}
							<!-- A film's one file: out of the queue, or tried again. -->
							<form
								method="POST"
								action={c.which === 'cancel' ? '?/cancelDownload' : '?/retryDownload'}
								use:enhance
								class="lc-form"
							>
								<input type="hidden" name="entry" value={series.entries[0]?.id} />
								<button type="submit" class="lc" class:acc={c.acc}>{c.label}</button>
							</form>
						{:else if c.which === 'all'}
							<!-- eslint-disable-next-line svelte/no-navigation-without-resolve -- withParam() keeps the current, resolved path -->
							<a class="lc" href={withParam(page.url, 'download', 'all')} data-sveltekit-noscroll
								>{c.label}</a
							>
						{:else}
							<form method="POST" action="?/download" use:enhance class="lc-form">
								<input type="hidden" name="which" value="next" />
								<button type="submit" class="lc" class:acc={c.acc}>{c.label}</button>
							</form>
						{/if}
					{/each}
				{/snippet}
				<div
					class="row link-row dl-row"
					class:solo={dlRow.cells.length === 0}
					class:ring={ringDownload}
				>
					<!-- The "?" in the label (doc/HELP.md): 03 — FINDING AND DOWNLOADING, at ADD, DOWNLOAD, FOLLOW. -->
					<button
						type="button"
						class="label ask"
						aria-label="Help: downloading"
						aria-expanded={helpOpen}
						onclick={() => (helpOpen = true)}>DOWNLOAD<HelpMark /></button
					>
					<div class="lk">
						<div class="lk-a">{dlRow.a}</div>
						<div class="lk-b">{dlRow.b}</div>
					</div>
					{#if dlRow.cells.length}<div class="lcs inline">{@render dlCells()}</div>{/if}
				</div>
				{#if dlRow.cells.length}<div class="lcs stack">{@render dlCells()}</div>{/if}
			{/if}
		</div>
		{#if !outline}
			<!-- ABOUT and TAGS under REFRESH and FOLLOW where nothing folds. -->
			{#if series.description}
				<div class="o o6 screen-only">{@render aboutGroup()}</div>
			{/if}
			<div class="o o8 screen-only">{@render tagsGroup()}</div>
		{/if}
		<div class="o o2 screen-only">{@render bandsGroup(false)}</div>
		<div class="o o3">
			{#if !outline && editions && opening}
				<!-- LANGUAGE: which edition it opens in. The default language clears the book's own choice. -->
				<form method="POST" action="?/language" use:enhance class="row">
					<div class="label">LANGUAGE</div>
					<div class="seg">
						{#each editions.editions as e (e.entryId)}
							<button
								type="submit"
								name="language"
								value={e.language === defaultLanguage ? '' : e.language}
								class:on={e === opening}
								aria-pressed={e === opening}
								><span class="lg-long">{e.code} · {langName(e.language)}</span><span
									class="lg-short">{e.code}</span
								></button
							>
						{/each}
					</div>
				</form>
				{#if editions.own && editions.own !== defaultLanguage}
					<form method="POST" action="?/language" use:enhance class="row panel-row override">
						<div class="ov">
							THIS BOOK OPENS IN {langName(editions.own)} · OTHERS IN {langName(editions.preferred)}
						</div>
						<button type="submit" name="language" value="" class="edit">RESET</button>
					</form>
				{/if}
			{/if}

			<!-- KIND: in DIRECTION's slot, which a video has no use for.
			     CHANGE opens the switch's sheet, which moves the file. -->
			{#if !outline && kindLine && onkind}
				<div class="row link-row kind-row">
					<div class="label">KIND</div>
					<div class="lk">
						<div class="lk-a">{kindLine.title}</div>
						<div class="lk-b">{kindLine.meta}</div>
					</div>
					<!-- One cell at the row's end on every device, as SHELVES' EDIT. -->
					<button type="button" class="edit" disabled={!offline.online} onclick={onkind}
						>CHANGE</button
					>
				</div>
			{/if}
			<!-- A video has no reading direction: an anime series has no such row. -->
			{#if !outline && !anime}
				<form method="POST" action="?/direction" use:enhance class="row">
					<div class="label">{directionRowLabel(series.kind)}</div>
					<div class="seg">
						{#each directionOptions(series.kind) as d (d.value)}
							<button
								type="submit"
								name="direction"
								value={d.value}
								class:on={d.value === direction}
								aria-pressed={d.value === direction}>{d.label}</button
							>
						{/each}
					</div>
				</form>
			{/if}
			{#if !outline}
				{#if ocrRow}
					<!-- Japanese (doc/JAPANESE.md): how far OCR has read it, on the panel ground. -->
					<form method="POST" action="?/ocr" use:enhance class="row panel-row ocr-row">
						<div class="label">OCR</div>
						<div class="ocr">
							<div class="oa">{ocrRow.a}</div>
							{#if ocrRow.bar !== null}
								<div class="obar"><div style:width="{ocrRow.bar * 100}%"></div></div>
							{/if}
							{#if ocrRow.b}<div class="ob">{ocrRow.b}</div>{/if}
							{#if ocr && ocr.notText > 0}
								<div class="ob">{ocr.notText} MARKED NOT TEXT</div>
							{/if}
						</div>
						{#if ocrRow.offer}<button type="submit" class="edit">OCR</button>{/if}
						{#if ocr && ocr.notText > 0}
							<!-- NOT TEXT is kept, not deleted: this puts every such block back. -->
							<button type="submit" class="edit" formaction="?/restoreText">RESTORE</button>
						{/if}
					</form>
					{#if ocr?.japanese && words && (words.toReview > 0 || words.sent > 0)}
						<div class="row panel-row">
							<div class="label">WORDS</div>
							<div class="wcount">
								<span>{words.toReview} TO REVIEW</span><span class="ws">{words.sent} SENT</span>
							</div>
							<!-- eslint-disable-next-line svelte/no-navigation-without-resolve -- built from resolve() -->
							<a class="edit" href="{resolve('/words')}?series={series.id}">REVIEW →</a>
						</div>
					{/if}
				{/if}

				{#if series.duplicates > 0 && series.scanlators.length > 1}
					<!-- One chapter, several scanlators (doc/DUPLICATE-CHAPTERS.md): whose copy the list shows. -->
					<form method="POST" action="?/scanlator" use:enhance class="row top">
						<div class="label">SCANLATOR</div>
						<div class="picks">
							<button
								type="submit"
								name="scanlator"
								value=""
								class:on={series.scanlator === null}
								aria-pressed={series.scanlator === null}>AUTO</button
							>
							{#each series.scanlators as s (s.name)}
								<button
									type="submit"
									name="scanlator"
									value={s.name}
									class:on={series.scanlator === s.name}
									aria-pressed={series.scanlator === s.name}>{s.name} · {s.count}</button
								>
							{/each}
							<span class="none"
								>{series.duplicates} DUPLICATE{series.duplicates === 1 ? '' : 'S'} HIDDEN</span
							>
						</div>
					</form>
				{/if}
			{/if}
		</div>
		{#if !outline}
			<div class="o o4 screen-only">{@render shelvesGroup()}</div>
			<div class="o o5">
				<!-- LISTS (doc/SERIES.md): LINK and TRACKING as one row, a line per
			     list, each with its entry, its list's word and its cells. EDIT opens the
			     sheet on that line's entry and season. COVER stays its own row. -->
				{#if lists}
					<ListsRow
						{lists}
						onedit={(at) => {
							sheetAt = at;
							trackingOpen = true;
						}}
						onexpand={() => (seasonsOpen = !seasonsOpen)}
					/>
					<TrackingSheet
						open={trackingOpen}
						at={sheetAt}
						{tracking}
						{link}
						{ranobe}
						kind={link?.linked?.kind ?? series.kind}
						{seasons}
						seriesId={series.id}
						linksHref={resolve('/links')}
						offline={linkOff}
						onclose={() => (trackingOpen = false)}
					/>
				{/if}
				{#if showView}
					<!-- SEASONS: under LISTS on a show TMDB knows. No key, no row. -->
					<div class="row link-row seasons-row">
						<div class="label">SEASONS</div>
						<div class="lk">
							<div class="lk-a">{showView.row.title}</div>
							<div class="lk-b">{showView.row.meta}</div>
						</div>
						{#if showView.row.findRest && showFind}
							<!-- eslint-disable-next-line svelte/no-navigation-without-resolve -- tagSearchHref resolves -->
							<a class="edit" href={showFind}>FIND THE REST →</a>
						{/if}
					</div>
				{/if}
				{#if highlights}
					<!-- HIGHLIGHTS where nothing folds (Series S2): after LISTS, in the
					     o5 group, so `order` keeps it there. The phone's is after ABOUT. -->
					{@render highlightsRow('hl-wide')}
				{/if}
				{#if link}
					<div class="row cover-row">
						<div class="label">COVER</div>
						<div class="cv">
							<div class="cv-a">{link.cover.a}</div>
							{#if link.cover.b}<div>{link.cover.b}</div>{/if}
						</div>
					</div>
				{/if}

				{#if !outline && move?.eligible}
					<!-- SOURCE (doc/MOVE.md; Migrate-Start): where the series comes from, its
				     trouble in ink, and the way to another source. Rare enough to sit
				     away from CONTINUE, next to FILE. -->
					{#snippet sourceCells()}
						{#if move.former}
							<form method="POST" action="?/moveBack" use:enhance class="lc-form">
								<button type="submit" class="lc" data-focus-mark="in">MOVE BACK</button>
							</form>
						{/if}
						<!-- eslint-disable-next-line svelte/no-navigation-without-resolve -- built from resolve() -->
						<a class="lc" href={moveHref} data-focus-mark="in">MOVE →</a>
					{/snippet}
					<div class="row link-row source-row">
						<div class="label">SOURCE</div>
						<div class="lk">
							<div class="lk-a">{move.source}</div>
							<div class="lk-b" class:ink={!!move.trouble}>{move.trouble ?? move.meta}</div>
							{#if move.former}
								<div class="lk-b">WAS {move.former.name.toUpperCase()} · UNTIL {formerUntil}</div>
							{/if}
						</div>
						<div class="lcs inline">{@render sourceCells()}</div>
					</div>
					<div class="lcs stack">{@render sourceCells()}</div>
				{/if}
			</div>
			<!-- TAGS inside DETAILS, where it stays on a phone and a TV. -->
			<div class="o o8 fold-only">{@render tagsGroup()}</div>
			<div class="o o7">
				{#if editions && opening}
					<!-- EDITIONS: each language's copy, what only it has, and where it is. -->
					<div class="row top">
						<div class="label">EDITIONS</div>
						<div class="eds">
							{#each editions.editions as e (e.entryId)}
								<div class="ed">
									<div class="ed-cell" class:on={e === opening}>{e.code}</div>
									<div class="ed-text">
										<div class="ed-line">
											{[e.site.toUpperCase(), `${e.pages} PAGES`, sameSize ? '' : e.size]
												.filter(Boolean)
												.join(' · ')}
										</div>
										<div class="ed-note" class:only={e.only.length > 0}>
											{e.only.length
												? `P. ${e.only.join(', ')} · ONLY IN ${e.code}`
												: 'EVERY PAGE MATCHED'}
										</div>
										<div class="path">{e.file}</div>
									</div>
								</div>
							{/each}
							{#if sameSize}<div class="ed-shared">
									EVERY EDITION · {editions.editions[0].size}
								</div>{/if}
						</div>
					</div>
					<!-- Its cells follow LISTS' rule: two or more drop under the line in
				     equal columns where the panel is narrow, so the text keeps its width. -->
					<div class="row file-row many">
						<div class="label">FOLDED</div>
						<div class="file">{foldedOn ? `${foldedOn} · ` : ''}FROM THE DUPLICATES REVIEW</div>
						<div class="cells">
							<button
								type="button"
								class="edit"
								aria-expanded={renaming}
								onclick={() => (renaming = !renaming)}>RENAME</button
							>
							<button type="button" class="edit" onclick={() => (unfolding = true)}>UNFOLD</button>
							{#if work && !series.hidden}
								<!-- A Work is hidden or shown whole (W4): on a part, HIDE asks. -->
								<button type="button" class="edit" onclick={() => (hiding = true)}>HIDE</button>
							{:else if work && series.hidden}
								<!-- Showing one part would leave the Work half-hidden, so this shows it whole. -->
								<form
									method="POST"
									action="?/showWork"
									use:enhance={replacingStale}
									class="hide-form"
								>
									<input type="hidden" name="made" value={work.createdAt} />
									<button type="submit" class="edit">UNHIDE</button>
								</form>
							{:else}
								<form method="POST" action="?/hide" use:enhance={replacing} class="hide-form">
									<input type="hidden" name="on" value={series.hidden ? '0' : '1'} />
									<button type="submit" class="edit">{series.hidden ? 'UNHIDE' : 'HIDE'}</button>
								</form>
							{/if}
						</div>
					</div>
					{#if renaming}{@render renameField()}{/if}
				{:else}
					<!-- FILE: the text keeps the row's width; its cells drop under it in
				     equal columns where the panel is narrow (LISTS' rule, doc/SERIES.md). -->
					<div class="row file-row many">
						<div class="label">FILE</div>
						<div class="file">
							{#if series.path}<div class="path">{series.path}</div>{/if}
							<div class="file-meta">
								{fileMeta(series.entries, dlFile)}{kindFacts(series.kind).grouping !== 'books' &&
								cached > 0
									? ` · ↓ ${cached} CACHED`
									: ''}{elsewhere}
							</div>
						</div>
						<div class="cells">
							<button
								type="button"
								class="edit"
								aria-expanded={renaming}
								onclick={() => (renaming = !renaming)}>RENAME</button
							>
							{#if merged || isBookSeries(series) || isVolumeSeries(series)}
								<!-- Every book (or volume) back out on its own; the series goes.
								     A merged show's seasons go back under their own ids. -->
								<form method="POST" action="?/ungroup" use:enhance={replacing} class="hide-form">
									<button type="submit" class="edit">UNGROUP</button>
								</form>
							{/if}
							{#if work && !series.hidden}
								<!-- A Work is hidden or shown whole (W4): on a part, HIDE asks. -->
								<button type="button" class="edit" onclick={() => (hiding = true)}>HIDE</button>
							{:else if work && series.hidden}
								<!-- Showing one part would leave the Work half-hidden, so this shows it whole. -->
								<form
									method="POST"
									action="?/showWork"
									use:enhance={replacingStale}
									class="hide-form"
								>
									<input type="hidden" name="made" value={work.createdAt} />
									<button type="submit" class="edit">UNHIDE</button>
								</form>
							{:else}
								<form method="POST" action="?/hide" use:enhance={replacing} class="hide-form">
									<input type="hidden" name="on" value={series.hidden ? '0' : '1'} />
									<button type="submit" class="edit">{series.hidden ? 'UNHIDE' : 'HIDE'}</button>
								</form>
							{/if}
							<button type="button" class="edit" onclick={ondelete}>DELETE</button>
						</div>
					</div>
					{#if renaming}{@render renameField()}{/if}
				{/if}
			</div>
		{/if}
	</div>
</section>

{#snippet bandsGroup(folded: boolean)}
	{#if !outline && noVideo}
		<!-- NO VIDEO (doc/MOVE.md; Migrate-Start): the MIGHT BE ONE SERIES idiom,
		     under CONTINUE. NOT NOW hides it until a new failure. -->
		<section class="sugg" aria-label="No video from this source">
			<div class="sugg-head">
				<span>{noVideo.title}</span>
				<span class="dim">{noVideo.detail}</span>
			</div>
			<div class="sugg-actions">
				<!-- eslint-disable-next-line svelte/no-navigation-without-resolve -- built from resolve() -->
				<a href={moveHref} data-focus-mark="in">ANOTHER SOURCE →</a>
				<form method="POST" action="?/dismissMove" use:enhance>
					<button type="submit" class="dim" data-focus-mark="in">NOT NOW</button>
				</form>
			</div>
		</section>
	{/if}

	{#if outline}
		<!-- The rows in the order the screen lands them: where nothing folds TAGS
		     comes first, above the direction row and SHELVES (its own copy is
		     under ABOUT); in the fold it comes after them. -->
		{#each folded ? [directionRowLabel(series.kind), 'SHELVES', 'TAGS', 'FILE'] : ['TAGS', directionRowLabel(series.kind), 'SHELVES', 'FILE'] as label, i (label)}
			<div class="row out-row" aria-hidden="true">
				<div class="label">{label}</div>
				<div class="out-lines"><i style:width={['34%', '52%', '74%', '60%'][i]}></i></div>
			</div>
		{/each}
	{:else if suggestion}
		<!-- MIGHT BE ONE SERIES: under CONTINUE, on this book's screen only. -->
		<section class="sugg" aria-label="Might be one series">
			<div class="sugg-head">
				<span>{m.offer_might_be_one_series()}</span>
				<span class="dim"
					>{m.offer_suggestion_books({
						count: suggestion.books.length,
						n: num(suggestion.books.length)
					})} · {suggestionLabel(suggestion.books)}</span
				>
			</div>
			<div class="sugg-covers">
				{#each suggestion.books as b (b.seriesId)}
					<span
						class="sugg-cover"
						class:this={b.seriesId === series.id}
						style:background={b.cover
							? `center / cover no-repeat url(${coverSrc(b.seriesId, b.cover)}), ${coverPlaceholder(b.hue)}`
							: coverPlaceholder(b.hue)}
						title={b.title}
					></span>
				{/each}
			</div>
			<div class="sugg-actions">
				<button type="button" onclick={() => onreview?.()}>REVIEW →</button>
				<form method="POST" action="?/dismiss" use:enhance>
					{#each suggestion.books as b (b.seriesId)}<input
							type="hidden"
							name="series"
							value={b.seriesId}
						/>{/each}
					<button type="submit" class="dim">{m.offer_not_a_series()}</button>
				</form>
			</div>
		</section>
	{:else if dismissedKey}
		<Band title={m.offer_not_a_series_again()} ondismiss={dropAnswer}>
			{#snippet action()}
				<form method="POST" action="?/undoDismiss" use:enhance>
					<input type="hidden" name="key" value={dismissedKey} />
					<button type="submit">UNDO</button>
				</form>
			{/snippet}
		</Band>
	{/if}

	{#if !outline && workOffer}
		<!-- MIGHT CONTINUE (W7): under CONTINUE, on the
		     newcomer's own screen only. It offers; nothing joins without
		     REVIEW's sheet and its tap, and NOT THIS never asks again. -->
		<section class="sugg offer" aria-label="Might continue {workOffer.name}">
			<div class="sugg-head offer-head">
				<span
					>{m.offer_might_continue({
						name: workOffer.name.toUpperCase(),
						part: workOffer.part
					})}</span
				>
				<span class="dim offer-why">{workOffer.reason}</span>
			</div>
			<div class="sugg-actions">
				<button type="button" onclick={() => onworkreview?.()}>REVIEW →</button>
				<form method="POST" action="?/dismissWorkOffer" use:enhance>
					<input type="hidden" name="key" value={workOffer.key} />
					<button type="submit" class="dim">{m.offer_not_this()}</button>
				</form>
			</div>
		</section>
	{:else if !outline && workOfferDismissed}
		<Band title={m.offer_not_this_again()} ondismiss={dropAnswer}>
			{#snippet action()}
				<form method="POST" action="?/undoWorkOffer" use:enhance>
					<input type="hidden" name="key" value={workOfferDismissed} />
					<button type="submit">UNDO</button>
				</form>
			{/snippet}
		</Band>
	{/if}

	{#if !outline && keptBothNote}
		<!-- This KEEP BOTH is recorded; an earlier decision it carried out
		     first was not. Refused ones are back at the review, undecided;
		     failed ones (a bug or the disk) still wait. -->
		<div class="kept-both">
			<Band title={keptBothNote.title} detail={keptBothNote.detail}>
				{#snippet action()}
					<a href={resolve('/duplicates')}>SEE DUPLICATES →</a>
				{/snippet}
			</Band>
		</div>
	{/if}
	{#if !outline && twin}
		<!-- Duplicate Books 1d: the group suggestion's treatment, for a twin. -->
		<div class="twin" role="status">
			<div class="tw-text">
				<div class="tw-title">SAME BOOK AS {twin.title.toUpperCase()}</div>
				<div class="tw-meta">
					{twin.conf === 'likely' ? 'LIKELY' : twin.conf === 'maybe' ? 'MAYBE' : 'OTHER LANGUAGE'} ·
					{twin.pages}
				</div>
			</div>
			<div class="tw-acts">
				<form method="POST" action="?/keepBoth" use:enhance>
					<input type="hidden" name="pair" value={twin.key} />
					<button type="submit">KEEP BOTH</button>
				</form>
				<!-- eslint-disable-next-line svelte/no-navigation-without-resolve -- built from resolve() -->
				<a href="{resolve('/duplicates')}?pair={encodeURIComponent(twin.key)}">REVIEW →</a>
			</div>
		</div>
	{/if}
{/snippet}

{#snippet shelvesGroup()}
	<div class="row">
		<div class="label">SHELVES</div>
		<div class="chips">
			{#each onShelves as s (s.key)}<span class="chip">{s.name}</span>{/each}
			{#if onShelves.length === 0}<span class="none">ON NO SHELF</span>{/if}
		</div>
		<button type="button" class="edit" onclick={onedit}>EDIT</button>
	</div>
{/snippet}

{#snippet tagsGroup()}
	<div class="row top">
		<div class="label">TAGS</div>
		<div class="tags">
			{#each groupTags as g (g.namespace)}
				<div class="tag-line">
					<span class="ns">{g.namespace}</span>
					<span class="vals">
						<!-- Every value opens the library's person or tag page, or,
						     with a source, asks where to look. -->
						<!-- eslint-disable svelte/no-navigation-without-resolve -- tagHref() resolves -->
						{#each g.tags as t, i (i)}<span class="val"
								><a
									class="person"
									href={tagLibraryHref(t)}
									aria-haspopup={tagSource ? 'dialog' : undefined}
									onclick={(e) => askTag(e, t)}>{t.value}</a
								>{#if i < g.tags.length - 1}<span class="sep">·</span>{/if}</span
							>{/each}
						<!-- eslint-enable svelte/no-navigation-without-resolve -->
					</span>
				</div>
			{/each}
			{#if tags.groups.length === 0}<span class="none">NO TAGS</span>{/if}
			{#if tags.more > 0}
				<button
					type="button"
					class="more tags-more"
					aria-expanded={tagsOpen}
					onclick={() => (tagsOpenOn = tagsOpen ? null : series.id)}
				>
					{tagsOpen ? 'LESS ↑' : `+ ${tags.more} MORE ↓`}
				</button>
			{/if}
			{#if isBookSeries(series)}
				<div class="more">
					FROM ITS {booksOf(series.entries).length} BOOKS · EACH KEEPS ITS OWN
				</div>
			{/if}
		</div>
		<button type="button" class="edit" onclick={onedit}>EDIT</button>
	</div>
{/snippet}

{#snippet aboutGroup()}
	<div class="row top">
		<div class="label">ABOUT</div>
		<div class="about">
			<p class:open={aboutOpen}>{series.description}</p>
			<button type="button" class="more" onclick={() => (aboutOpen = !aboutOpen)}>
				{aboutOpen ? 'LESS ↑' : 'MORE ↓'}
			</button>
		</div>
	</div>
{/snippet}

{#snippet highlightsRow(where: string)}
	<!-- eslint-disable-next-line svelte/no-navigation-without-resolve -- built from resolve() -->
	<a
		class="row hl-row {where}"
		href="{resolve('/highlights')}?series={series.id}"
		data-focus-mark="in"
		data-highlights-row
	>
		<span class="label">{m.name_highlights()}</span>
		<span class="hl-line">{highlights?.line}</span>
		<span class="hl-go" aria-hidden="true">→</span>
	</a>
{/snippet}

{#snippet detailsLineCell()}
	<!-- The folded line: DETAILS | what needs the user, or the quiet state,
	     over the names inside | SHOW ↓. A mark is told, never acted on: it does
	     not open the fold. Its name says DETAILS and the state, never SHOW or
	     HIDE, so no other control's locator finds it. While FIRST READ points at
	     DOWNLOAD and the fold is closed, the ring sits here, on the way in. -->
	<button
		type="button"
		class="details-line"
		class:open={detailsShown}
		class:ink={detailsState.ink}
		class:ring={ringDownload && !detailsShown}
		aria-expanded={detailsShown}
		aria-controls="series-details"
		aria-label={!detailsShown && detailsState.state ? `DETAILS · ${detailsState.state}` : 'DETAILS'}
		data-row="details"
		onclick={toggleDetails}
	>
		<span class="label">DETAILS</span>
		<span class="dt">
			{#if !detailsShown && detailsState.state}<span class="dt-state">{detailsState.state}</span
				>{/if}
			<span class="dt-names dt-all">{namesLine(detailsState.names)}</span>
			<span class="dt-names dt-tv">{namesLine(detailsState.names, TV_NAMES)}</span>
		</span>
		<span class="dt-go"><span class="dt-ok">OK · </span>{detailsShown ? 'HIDE ↑' : 'SHOW ↓'}</span>
		{#if !detailsShown && detailsState.bar !== null}
			<span class="dt-bar" aria-hidden="true"
				><span style:width="{Math.round(detailsState.bar * 100)}%"></span></span
			>
		{/if}
	</button>
{/snippet}

<svelte:head>
	<!-- Without script nothing can open the fold, so nothing is folded. -->
	<noscript>
		<style>
			.details {
				display: contents !important;
			}
			.details-line {
				display: none !important;
			}
		</style>
	</noscript>
</svelte:head>

{#snippet renameField()}
	<!-- The name in place: DONE writes it, CANCEL leaves it. -->
	<form method="POST" action="?/rename" use:enhance={renamed} class="rename" data-row="rename">
		<input
			type="text"
			name="name"
			value={series.title}
			aria-label="The series' name"
			class="field"
			autocomplete="off"
			use:focusField
		/>
		<button type="submit" class="edit acc">DONE</button>
		<button type="button" class="edit" onclick={() => (renaming = false)}>CANCEL</button>
	</form>
{/snippet}

{#if tagSource}
	<TagSheet
		open={tagOpen}
		tag={tagAsked}
		source={tagSource.name}
		libraryHref={tagAsked ? tagLibraryHref(tagAsked) : ''}
		sourceHref={tagSourceHref}
		onclose={() => (tagOpen = false)}
	/>
{/if}

{#if editions}
	<UnfoldSheet
		open={unfolding}
		lines={editions.editions.map((e) => ({
			code: e.code,
			title: e.title,
			detail: [
				editions.read
					? 'READ'
					: editions.at === null
						? `${e.pages} PAGES`
						: `P. ${(e.base ? editions.at : baseToEdition(e.rows, editions.at).page) + 1} OF ${e.pages}`,
				`RATING ${series.rating}`,
				`${series.collections.length} SHEL${series.collections.length === 1 ? 'F' : 'VES'}`
			].join(' · ')
		}))}
		onclose={() => (unfolding = false)}
	/>
{/if}

{#if work && workSheet}
	<!-- The WORK row's sheet (W5; Work-Row B3): OPEN, MOVE ↑ ↓, TAKE OUT. A long
	     press, MENU or a held OK opens it, the same event as every long press. -->
	<Sheet open onclose={() => (workSheet = false)} label="{work.name} · WORK">
		<div class="sh-head">
			<div class="sh-title">
				<div class="t">{work.name.toUpperCase()} · WORK</div>
				<div class="s">PART {work.part} OF {work.of}</div>
			</div>
		</div>
		<div class="prow">
			<div class="label">OPEN</div>
			<div class="lk">
				<div class="lk-a">The Work's screen</div>
			</div>
			<!-- eslint-disable-next-line svelte/no-navigation-without-resolve -- resolve() builds the Work's URL -->
			<a class="lc" href={resolve('/work/[id]', { id: String(work.id) })}>→</a>
		</div>
		<form method="POST" action="?/moveWork" use:enhance={workAfter(false)} class="prow">
			<div class="label">MOVE</div>
			<div class="lk">
				<div class="lk-a">Earlier or later in the run</div>
			</div>
			<!-- The Work this sheet was drawn on, not whatever holds its id now. -->
			<input type="hidden" name="made" value={work.createdAt} />
			<button type="submit" name="dir" value="up" class="lc" disabled={!work.prev}>↑</button>
			<button type="submit" name="dir" value="down" class="lc" disabled={!work.next}>↓</button>
		</form>
		<form method="POST" action="?/takeOutWork" use:enhance={workAfter(true)} class="prow">
			<div class="label">TAKE OUT</div>
			<div class="lk">
				<div class="lk-a">Out of the Work</div>
				<div class="lk-b">A SERIES ON ITS OWN AGAIN · UNDO</div>
			</div>
			<input type="hidden" name="made" value={work.createdAt} />
			<button type="submit" class="lc">TAKE OUT</button>
		</form>
	</Sheet>
{/if}

{#if work && hiding}
	<HideSheet
		open
		title="HIDE {series.title.toUpperCase()}?"
		detail="IT'S PART {work.part} OF {work.name.toUpperCase()}"
		ids={[String(series.id)]}
		wholeCount={work.of}
		remainCount={work.of - 1}
		{workMade}
		actionAll="?/hideWork"
		actionPart="?/hidePart"
		ondone={async () => {
			// The sheet's `update` does not re-read on success: the
			// screen must, since HIDE ALL n changes the Work it draws.
			hiding = false;
			await invalidateAll();
		}}
		onclose={() => (hiding = false)}
	/>
{/if}

{#if helpOpen}
	<HelpSheet open onclose={() => (helpOpen = false)} topic="downloading" part="download" />
{/if}

<style>
	/* Waiting: what isn't known yet, as flat grey bars. */
	.out-lines {
		display: flex;
		flex-direction: column;
		justify-content: center;
		gap: 10px;
		padding-top: 6px;
	}
	.out-row .out-lines {
		flex: 1;
		padding: 10px 14px;
	}
	.out-lines i,
	.cta-out {
		display: block;
		height: 10px;
		background: var(--line-1);
	}
	.cta-out {
		width: 150px;
		background: rgba(14, 15, 16, 0.28);
	}
	.out-row {
		min-height: 58px;
	}
	.panel {
		display: flex;
		flex-direction: column;
		--label-w: 120px;
		--cov-w: 184px;
		--title-size: 28px;
		--cta-h: 64px;
		--ns-w: 72px;
	}
	/* Landscape: a narrower cover and title in the 440px panel. */
	@media (min-width: 1024px) {
		.panel {
			--cov-w: 132px;
			--title-size: 22px;
		}
	}
	@media (max-width: 599px) {
		.panel {
			--label-w: 84px;
			--cov-w: 104px;
			--title-size: 20px;
			--cta-h: 56px;
			--ns-w: 56px;
		}
		/* Only the ← → cells narrow on a phone: 52px to 44px. The row itself keeps
		   the board's 64px (`wk.css`'s `.prow`; the note's "52px" is the cell's
		   width, and the row measured 64px at 390x844 too). `.panel` here because
		   the base `.prow .pn` width comes later in this file. */
		.panel .prow .pn {
			width: 44px;
		}
	}

	.identity {
		display: flex;
		gap: var(--pad);
		padding: var(--pad);
	}
	.cover {
		position: relative;
		flex-shrink: 0;
		width: var(--cov-w);
		aspect-ratio: var(--cover-ratio);
		align-self: flex-start;
	}
	a.cover {
		display: block;
		color: inherit;
		text-decoration: none;
	}
	.cover.typeset {
		background: var(--surface-panel);
		border: 1px solid var(--line-2);
		padding: 14px;
		display: flex;
		flex-direction: column;
		justify-content: space-between;
	}
	.nocover {
		font: 500 12px var(--font-mono);
		color: var(--text-2);
		letter-spacing: var(--tracking-label);
	}
	.nocover-title {
		font: 500 15px/1.3 var(--font-sans);
		text-wrap: pretty;
	}
	.names {
		flex: 1;
		min-width: 0;
		display: flex;
		flex-direction: column;
		gap: 10px;
	}
	.meta {
		font: 500 13px var(--font-mono);
		color: var(--text-2);
		letter-spacing: var(--tracking-label);
	}
	h1 {
		margin: 0;
		font: 500 var(--title-size) / 1.2 var(--font-sans);
		text-wrap: pretty;
	}
	.alt {
		font: 400 15px/1.35 var(--font-sans);
		color: var(--text-2);
	}
	.names .alt + .alt {
		margin-top: -6px;
	}
	/* "24 EPISODES · 2 SEASONS · 18 WATCHED". */
	.count {
		font: 400 13px var(--font-mono);
		color: var(--text-2);
	}

	.label {
		display: flex;
		align-items: center;
		width: var(--label-w);
		/* Never narrower than its word: at a larger text size (130% on
		   the phone app) SHELVES ran past the rule into its chips. A one-word
		   label cannot wrap, so the column widens on that row instead. */
		min-width: min-content;
		padding-left: var(--pad);
		flex-shrink: 0;
		font: 500 12px var(--font-mono);
		letter-spacing: var(--tracking-label);
		color: var(--text-2);
		border-right: var(--hairline);
	}
	/* A label with a "?" (doc/HELP.md): the cell is the button; on a narrow cell the mark wraps under the word. */
	button.label.ask {
		flex-wrap: wrap;
		align-content: center;
		gap: 6px 8px;
		border-top: 0;
		border-bottom: 0;
		border-left: 0;
		border-radius: 0;
		background: none;
		text-align: left;
		cursor: pointer;
	}
	button.label.ask:active,
	button.label.ask[aria-expanded='true'] {
		background: var(--surface-inverse);
		color: var(--text-inverse);
	}
	.top .label {
		align-items: flex-start;
		padding-top: 18px;
	}

	.cta {
		flex-shrink: 0;
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 12px;
		height: var(--cta-h);
		padding: 0 var(--pad);
		border: 0;
		border-radius: 0;
		background: var(--accent);
		color: var(--on-accent);
		font: 500 15px var(--font-mono);
		letter-spacing: 0.04em;
		text-align: left;
	}
	.cta {
		text-decoration: none;
	}
	.cta[aria-disabled='true'] {
		pointer-events: none;
	}
	.cta.nofile {
		opacity: 0.4;
	}
	.cta {
		position: relative;
	}
	.cta-line {
		position: absolute;
		left: 0;
		bottom: 0;
		height: 3px;
		background: var(--on-accent);
	}
	.cta-meta .short {
		display: none;
	}
	@media (max-width: 599px) {
		.cta-meta .long,
		.lg-long {
			display: none;
		}
		.cta-meta .short,
		.lg-short {
			display: inline;
		}
	}

	.row {
		display: flex;
		align-items: stretch;
		border-bottom: var(--hairline);
		min-height: 60px;
	}
	/* The WORK row (W5; Work-Row B3): a label, the run's name, two 52px cells.
	   Under CONTINUE, because it answers what after this. */
	.prow {
		display: flex;
		align-items: stretch;
		min-height: 64px;
		border-bottom: var(--hairline);
		color: var(--text-1);
		text-decoration: none;
	}
	.prow .lk {
		text-decoration: none;
		color: inherit;
	}
	.prow .pn {
		width: 52px;
		flex-shrink: 0;
		display: flex;
		align-items: center;
		justify-content: center;
		border-left: var(--hairline);
		font: 500 13px var(--font-mono);
		color: var(--text-1);
		text-decoration: none;
	}
	.prow .pn.off {
		opacity: 0.35;
	}
	.prow .lc {
		justify-content: center;
		border: 0;
		border-left: var(--hairline);
		border-radius: 0;
		background: transparent;
		color: var(--text-1);
		padding: 0 18px;
		font: 500 13px var(--font-mono);
		letter-spacing: 0.04em;
		cursor: pointer;
	}
	.prow .lc:disabled {
		opacity: 0.35;
		cursor: default;
	}
	/* Read through (or caught up): the run's next is the one accent on the screen. */
	.prow.next {
		background: var(--accent);
		color: var(--on-accent);
	}
	.prow.next .label,
	.prow.next .lk-b {
		color: var(--on-accent);
	}
	.prow.next .label {
		border-right-color: rgba(14, 15, 16, 0.25);
	}
	.prow.next .next-cell {
		border-left-color: rgba(14, 15, 16, 0.25);
		color: var(--on-accent);
	}
	.prow.next.off {
		opacity: 0.5;
	}
	.sh-head {
		flex-shrink: 0;
		display: flex;
		align-items: stretch;
		height: 64px;
		border-top: var(--hairline);
		border-bottom: var(--hairline);
	}
	.sh-title {
		flex: 1;
		min-width: 0;
		display: flex;
		flex-direction: column;
		justify-content: center;
		gap: 3px;
		padding: 0 var(--pad);
	}
	.sh-title .t {
		font: 500 15px var(--font-mono);
		letter-spacing: 0.04em;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}
	.sh-title .s {
		font: 400 12px var(--font-mono);
		color: var(--text-2);
	}
	.cta.quiet {
		background: none;
		color: var(--text-1);
		border-bottom: var(--hairline);
	}
	.cta.quiet .cta-meta {
		color: var(--text-2);
	}
	.twin {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 12px;
		height: 60px;
		padding-left: var(--pad);
		border-bottom: 1px solid var(--line-1);
		background: var(--surface-panel);
		font: 500 14px/1.2 var(--font-mono);
	}
	.tw-text {
		display: flex;
		flex-direction: column;
		gap: 3px;
		min-width: 0;
	}
	.tw-title {
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}
	.tw-meta {
		font: 400 13px/1.3 var(--font-mono);
		color: var(--text-2);
	}
	.tw-acts {
		align-self: stretch;
		display: flex;
	}
	.tw-acts form {
		display: flex;
	}
	.tw-acts button,
	.tw-acts a {
		display: flex;
		align-items: center;
		padding: 0 24px;
		border: 0;
		border-left: 1px solid var(--line-1);
		border-radius: 0;
		background: transparent;
		color: var(--text-1);
		font: 500 14px var(--font-mono);
		text-decoration: none;
		cursor: pointer;
	}
	.tw-acts a {
		border-left: 0;
		background: var(--accent);
		color: var(--on-accent);
	}
	/* Index Japanese 4a: OCR and WORDS sit on the panel ground, under DIRECTION. */
	.panel-row {
		background: var(--surface-panel);
		min-height: 56px;
	}
	.ocr-row {
		min-height: 64px;
	}
	.ocr {
		flex: 1;
		min-width: 0;
		display: flex;
		flex-direction: column;
		justify-content: center;
		gap: 8px;
		padding: 10px 14px;
	}
	.oa {
		font: 500 14px var(--font-mono);
	}
	.ob {
		font: 400 13px var(--font-mono);
		color: var(--text-2);
	}
	.obar {
		height: 2px;
		background: var(--line-1);
	}
	.obar div {
		height: 2px;
		background: var(--accent);
	}
	.wcount {
		flex: 1;
		min-width: 0;
		display: flex;
		align-items: center;
		gap: 14px;
		padding: 10px 14px;
		font: 500 14px var(--font-mono);
	}
	.ws {
		font-weight: 400;
		font-size: 13px;
		color: var(--text-2);
	}
	.seg {
		flex: 1;
		display: flex;
		min-height: 56px;
	}
	.seg button {
		flex: 1;
		border: 0;
		border-right: var(--hairline);
		border-radius: 0;
		background: transparent;
		color: var(--text-1);
		font: 500 14px var(--font-mono);
		cursor: pointer;
	}
	.seg button.on {
		background: var(--surface-inverse);
		color: var(--text-inverse);
	}
	.picks {
		flex: 1;
		min-width: 0;
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 8px;
		padding: 10px 14px;
	}
	.picks button {
		min-height: 36px;
		padding: 0 12px;
		border: 1px solid var(--line-2);
		border-radius: 0;
		background: transparent;
		color: var(--text-1);
		font: 500 13px var(--font-mono);
		cursor: pointer;
	}
	.picks button.on {
		border-color: var(--surface-inverse);
		background: var(--surface-inverse);
		color: var(--text-inverse);
	}
	.picks .none {
		flex-basis: 100%;
	}
	.chips {
		flex: 1;
		min-width: 0;
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 8px;
		padding: 10px 14px;
	}
	.chip {
		height: 36px;
		display: flex;
		align-items: center;
		padding: 0 12px;
		border: 1px solid var(--line-2);
		font: 500 14px var(--font-sans);
	}
	.none {
		font: 500 12px var(--font-mono);
		color: var(--text-2);
		letter-spacing: 0.04em;
	}
	.edit {
		display: flex;
		align-items: center;
		padding: 0 var(--pad);
		border: 0;
		border-left: var(--hairline);
		border-radius: 0;
		background: transparent;
		color: var(--text-1);
		font: 500 13px var(--font-mono);
		letter-spacing: 0.04em;
		cursor: pointer;
	}
	a.edit {
		text-decoration: none;
	}
	.hide-form {
		display: flex;
	}
	.seg button:active:not(.on),
	.edit:active {
		background: var(--surface-inverse);
		color: var(--text-inverse);
	}
	.tags {
		flex: 1;
		min-width: 0;
		display: flex;
		flex-direction: column;
		gap: 8px;
		padding: 14px;
	}
	.tag-line {
		display: flex;
		gap: 12px;
		align-items: baseline;
	}
	.ns {
		flex-shrink: 0;
		/* A namespace can be any length (parseTag), so a long one wraps rather than
		   painting over its values. The box borrows 8px of the 12px gutter and
		   gives them back in the margin, so `.vals` stays where `.tags-more` aligns to
		   it: inside the phone's bare 56px, `language`, one the design draws, broke. */
		width: calc(var(--ns-w) + 8px);
		margin-right: -8px;
		font: 400 12px var(--font-mono);
		color: var(--text-2);
		letter-spacing: 0.04em;
		overflow-wrap: anywhere;
	}
	.vals {
		flex: 1;
		min-width: 0;
		font: 400 15px/1.35 var(--font-sans);
		/* Every value is read whole: lines wrap, and one longer than the
		   row breaks inside itself rather than pushing the row wider. */
		overflow-wrap: anywhere;
	}
	.more {
		align-self: flex-start;
		padding: 0;
		border: 0;
		background: none;
		font: 500 12px var(--font-mono);
		color: var(--text-2);
		letter-spacing: 0.04em;
		cursor: pointer;
	}
	/* Under the values, not the namespaces: on a TV ↑ and ↓ go by column overlap,
	   and in the namespaces' column the pad would pass every line of tags. */
	.tags-more {
		margin-left: calc(var(--ns-w) + 12px);
	}
	.about {
		flex: 1;
		min-width: 0;
		display: flex;
		flex-direction: column;
		gap: 6px;
		padding: 14px;
	}
	.about p {
		margin: 0;
		font: 400 15px/1.45 var(--font-sans);
		color: var(--text-prose);
		display: -webkit-box;
		-webkit-line-clamp: 2;
		line-clamp: 2;
		-webkit-box-orient: vertical;
		overflow: hidden;
		text-wrap: pretty;
	}
	.about p.open {
		display: block;
	}
	/* One box per value, so a value that wraps is still a stop the pad can reach
	   (the layer compares boxes; an inline link's is the whole wrapped area), and
	   its dot goes with it, so no line starts on one. */
	.val {
		display: inline-flex;
		align-items: baseline;
		max-width: 100%;
	}
	.val .sep {
		flex-shrink: 0;
		margin: 0 6px;
		color: var(--text-2);
	}
	.person {
		min-width: 0;
		color: inherit;
		text-decoration: underline;
		text-underline-offset: 4px;
		text-decoration-color: var(--line-2);
	}
	.person:active {
		background: var(--surface-inverse);
		color: var(--text-inverse);
	}
	.sugg {
		display: flex;
		flex-direction: column;
		background: var(--surface-panel);
		border-bottom: var(--hairline);
	}
	.sugg-head {
		display: flex;
		justify-content: space-between;
		gap: 12px;
		padding: 16px var(--pad) 12px;
		font: 500 13px var(--font-mono);
		letter-spacing: var(--tracking-label);
	}
	.dim {
		color: var(--text-2);
	}
	/* The offer's head stacks its reason under the line. */
	.offer-head {
		flex-direction: column;
		justify-content: flex-start;
		gap: 6px;
	}
	.offer-why {
		font: 400 11px/1.35 var(--font-mono);
	}
	.sugg-covers {
		display: flex;
		gap: 8px;
		padding: 0 var(--pad) 16px;
		overflow-x: auto;
	}
	.sugg-cover {
		width: 64px;
		aspect-ratio: var(--cover-ratio);
		flex-shrink: 0;
	}
	.sugg-cover.this {
		box-shadow: inset 0 0 0 2px var(--accent);
	}
	.sugg-actions {
		display: flex;
		height: 56px;
		border-top: var(--hairline);
	}
	.sugg-actions > button,
	.sugg-actions > form,
	.sugg-actions > a {
		flex: 1;
		display: flex;
	}
	.sugg-actions > a {
		align-items: center;
		justify-content: center;
		border-right: var(--hairline);
		color: var(--text-1);
		font: 500 14px var(--font-mono);
		letter-spacing: 0.04em;
		text-decoration: none;
	}
	.sugg-actions > a:active {
		background: var(--surface-inverse);
		color: var(--text-inverse);
	}
	.sugg-actions button {
		flex: 1;
		display: flex;
		align-items: center;
		justify-content: center;
		border: 0;
		border-radius: 0;
		background: transparent;
		color: var(--text-1);
		font: 500 14px var(--font-mono);
		letter-spacing: 0.04em;
		cursor: pointer;
	}
	.sugg-actions > button {
		border-right: var(--hairline);
	}
	.sugg-actions button.dim {
		color: var(--text-2);
	}
	.sugg-actions button:active {
		background: var(--surface-inverse);
		color: var(--text-inverse);
	}
	/* FILE and FOLDED: the label, the text, then the cells. The line
	   wraps, so where the cells drop (below) they take a line of their own. */
	.file-row {
		min-height: 64px;
		flex-wrap: wrap;
	}
	.file-row > .label {
		min-height: 64px;
	}
	.cells {
		display: flex;
	}
	/* Narrow (the phone, the 440px landscape panel and the TV's 352px column),
	   as LISTS' rule has it: two or more cells drop
	   under the line in equal columns, so `13 EPUB · 6.8 MB` keeps the row's
	   width instead of a word a line. One cell stays at the line's end. The
	   tablet in portrait has the width, and keeps them inline. */
	@media (max-width: 599px), (min-width: 1024px), (pointer: none) and (min-width: 900px) {
		.file-row.many .cells {
			flex-basis: 100%;
			display: grid;
			grid-auto-flow: column;
			grid-auto-columns: minmax(0, 1fr);
			min-height: 52px;
			border-top: var(--hairline);
		}
		.file-row.many .cells .edit {
			justify-content: center;
			width: 100%;
			padding: 0 8px;
		}
		.file-row.many .cells > :first-child,
		.file-row.many .cells > :first-child .edit {
			border-left: 0;
		}
	}
	/* RENAME's field, a row of its own under FILE (the Work screen's). */
	.rename {
		display: flex;
		align-items: stretch;
		min-height: 52px;
		border-bottom: var(--hairline);
	}
	.rename .field {
		flex: 1;
		min-width: 0;
		margin: 0;
		padding: 0 var(--pad);
		border: 0;
		border-radius: 0;
		background: transparent;
		color: var(--text-1);
		font: 400 16px var(--font-sans);
	}
	.edit.acc {
		background: var(--accent);
		color: var(--on-accent);
	}
	/* SOURCE and DOWNLOAD keep LINK's old row shape: the design's literals. */
	.link-row {
		min-height: 68px;
	}
	.lk {
		flex: 1;
		min-width: 0;
		display: flex;
		flex-direction: column;
		justify-content: center;
		gap: 5px;
		padding: 10px 14px;
	}
	.lk-a {
		font: 500 15px/1.3 var(--font-sans);
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}
	.lk-b {
		font: 400 13px/1.35 var(--font-mono);
		color: var(--text-2);
		text-wrap: pretty;
	}
	.lk-b.ink {
		color: var(--text-1);
	}
	.lcs {
		display: flex;
		--cell-pad: 20px;
	}
	.lcs.stack {
		display: none;
	}
	.lc-form {
		display: flex;
	}
	.lc {
		display: flex;
		align-items: center;
		padding: 0 var(--cell-pad);
		border: 0;
		border-left: var(--hairline);
		border-radius: 0;
		background: transparent;
		color: var(--text-1);
		font: 500 13px var(--font-mono);
		letter-spacing: 0.04em;
		white-space: nowrap;
		text-decoration: none;
		cursor: pointer;
	}
	.lc.acc {
		background: var(--accent);
		color: var(--on-accent);
	}
	.lc.dim {
		opacity: 0.35;
		cursor: default;
	}
	/* Narrow (the phone, the 440px landscape panel and the TV's 352px column):
	   the cells drop below, in equal columns. The TV is 960 wide, so it met
	   neither width, and its column got the tablet's full-width inline row:
	   cells past the edge and over ▶ CONTINUE on a real TV. */
	@media (max-width: 599px), (min-width: 1024px), (pointer: none) and (min-width: 900px) {
		.link-row {
			border-bottom: 0;
		}
		/* A row with no cells to drop keeps its own rule. */
		.link-row.solo {
			border-bottom: var(--hairline);
		}
		.lcs.inline {
			display: none;
		}
		.lcs.stack {
			display: grid;
			grid-auto-flow: column;
			grid-auto-columns: minmax(0, 1fr);
			min-height: 52px;
			border-top: var(--hairline);
			border-bottom: var(--hairline);
			--cell-pad: 14px;
		}
		.lcs.stack .lc {
			justify-content: center;
			border-left: 0;
			border-right: var(--hairline);
		}
		.lcs.stack .lc-form .lc {
			flex: 1;
		}
	}
	.cover-row {
		min-height: 64px;
	}
	.cv {
		flex: 1;
		min-width: 0;
		display: flex;
		flex-direction: column;
		justify-content: center;
		gap: 5px;
		padding: 10px 14px;
		font: 400 13px var(--font-mono);
		color: var(--text-2);
	}
	.cv-a {
		color: var(--text-1);
	}
	.ed-alt {
		display: flex;
		align-items: baseline;
		gap: 10px;
	}
	.ed-code {
		flex-shrink: 0;
		font: 500 12px var(--font-mono);
		letter-spacing: var(--tracking-label);
	}
	.lg-short {
		display: none;
	}
	.override {
		min-height: 48px;
	}
	.ov {
		flex: 1;
		min-width: 0;
		display: flex;
		align-items: center;
		padding: 0 var(--pad);
		font: 400 13px/1.3 var(--font-mono);
		color: var(--text-2);
	}
	.eds {
		flex: 1;
		min-width: 0;
		display: flex;
		flex-direction: column;
	}
	.ed {
		display: flex;
		align-items: stretch;
		border-bottom: 1px solid var(--line-subtle);
	}
	.ed-cell {
		width: 56px;
		flex-shrink: 0;
		display: flex;
		align-items: center;
		justify-content: center;
		border-right: 1px solid var(--line-subtle);
		font: 500 14px var(--font-mono);
	}
	.ed-cell.on {
		background: var(--surface-inverse);
		color: var(--text-inverse);
	}
	.ed-text {
		flex: 1;
		min-width: 0;
		display: flex;
		flex-direction: column;
		gap: 4px;
		padding: 10px 14px;
		font: 400 12px/1.3 var(--font-mono);
		color: var(--text-2);
	}
	.ed-line {
		font-size: 13px;
		font-weight: 500;
		color: var(--text-1);
	}
	.ed-note.only {
		color: var(--accent);
	}
	.ed-shared {
		padding: 12px 14px;
		font: 400 12px var(--font-mono);
		color: var(--text-2);
	}
	.file {
		flex: 1;
		min-width: 0;
		display: flex;
		flex-direction: column;
		justify-content: center;
		gap: 5px;
		padding: 10px 14px;
		font: 400 13px var(--font-mono);
		color: var(--text-2);
	}
	.path {
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}
	.file-meta {
		color: var(--text-1);
	}
	.ring {
		box-shadow: inset 0 0 0 2px var(--accent);
	}
	/* ---- HIGHLIGHTS --------
	   One row, the series screen's label-then-value form, and a → cell. It is
	   in the markup twice: after ABOUT for the phone and the TV (S1, above the
	   DETAILS fold) and after LISTS where nothing folds (S2); each media query
	   shows one. The row itself is o5's direct child, so `order` places it. */
	.hl-row {
		color: var(--text-1);
		text-decoration: none;
	}
	.hl-line {
		flex: 1;
		display: flex;
		align-items: center;
		min-width: 0;
		padding: 0 var(--pad);
		font: 500 13px var(--font-mono);
		letter-spacing: var(--tracking-label);
	}
	.hl-go {
		display: flex;
		align-items: center;
		justify-content: center;
		width: 64px;
		flex-shrink: 0;
		border-left: var(--hairline);
		font: 500 16px var(--font-mono);
	}
	@media (min-width: 600px) and (not ((pointer: none) and (min-width: 900px))) {
		.hl-row.hl-fold {
			display: none;
		}
	}
	@media (max-width: 599px), (pointer: none) and (min-width: 900px) {
		.hl-row.hl-wide {
			display: none;
		}
	}
	/* ---- DETAILS -------------------
	   Where nothing folds the wrappers are no boxes, and the screen's order is
	   the markup's: DOWNLOAD, ABOUT, TAGS, the bands, LANGUAGE to SCANLATOR,
	   SHELVES, LISTS to SOURCE, EDITIONS and FILE. Folded, the bands, SHELVES and
	   ABOUT stand above the line and TAGS stays inside it, after SOURCE.
	   Those four are drawn once in each order, and each copy is hidden by the
	   other's query. */
	.o,
	.details {
		display: contents;
	}
	.details-line {
		display: none;
	}
	@media (min-width: 600px) and (not ((pointer: none) and (min-width: 900px))) {
		.o.fold-only {
			display: none;
		}
	}
	/* The other query's exact complement: `max-width: 599px` would leave a
	   fractional viewport (browser zoom) between 599 and 600 px drawing both. */
	@media (not (min-width: 600px)), (pointer: none) and (min-width: 900px) {
		.o.screen-only {
			display: none;
		}
	}
	/* The phone and the TV: SHELVES, ABOUT, then one 64px line. */
	@media (max-width: 599px), (pointer: none) and (min-width: 900px) {
		.details {
			display: none;
		}
		.details.open {
			display: flex;
			flex-direction: column;
		}
		.details-line {
			position: relative;
			display: flex;
			align-items: stretch;
			width: 100%;
			min-height: 64px;
			margin: 0;
			padding: 0;
			border: 0;
			border-bottom: var(--hairline);
			border-radius: 0;
			background: transparent;
			color: var(--text-1);
			text-align: left;
			cursor: pointer;
		}
		/* Open, a mode surface: the rule goes full ink, the cell inverts. */
		.details-line.open {
			border-bottom-color: var(--text-1);
		}
		.dt {
			flex: 1;
			min-width: 0;
			display: flex;
			flex-direction: column;
			justify-content: center;
			gap: 5px;
			padding: 12px 14px;
		}
		.dt-state {
			font: 400 13px/1.35 var(--font-mono);
			letter-spacing: 0.02em;
			color: var(--text-2);
		}
		/* Something needs the user: SOURCE's idiom for trouble, ink and 500. */
		.details-line.ink .dt-state {
			font-weight: 500;
			color: var(--text-1);
		}
		.dt-names {
			font: 400 11px/1.45 var(--font-mono);
			letter-spacing: 0.02em;
			color: var(--text-2);
		}
		.dt-tv,
		.dt-ok {
			display: none;
		}
		.dt-go {
			display: flex;
			align-items: center;
			justify-content: center;
			padding: 0 var(--pad);
			border-left: var(--hairline);
			font: 500 13px var(--font-mono);
			letter-spacing: 0.04em;
			white-space: nowrap;
		}
		.details-line.open .dt-go {
			background: var(--text-1);
			color: var(--surface-page);
		}
		/* Running work (OCR, a download): 3px of accent on the bottom rule. */
		.dt-bar {
			position: absolute;
			left: 0;
			right: 0;
			bottom: -1px;
			height: 3px;
			background: var(--line-1);
		}
		.dt-bar > span {
			display: block;
			height: 3px;
			background: var(--accent);
		}
		/* ABOUT clamps to three lines where it sits above the fold, and
		   MORE ↓ is as wide as its word. */
		.about {
			align-items: flex-start;
		}
		.about p {
			-webkit-line-clamp: 3;
			line-clamp: 3;
		}
	}
	/* ---- the TV ----------------------------------------- */
	@media (pointer: none) and (min-width: 900px) {
		.panel {
			/* The column already sits inside the 48px safe margin: its rows pad
			   as a column does, not as the screen's edge. At 48 a 116px label
			   had 68 left for RATING and its value, and cut them off. */
			--pad: 16px;
			--cov-w: 96px;
			--title-size: 22px;
			--label-w: 116px;
			--cta-h: 64px;
			--ns-w: 72px;
		}
		/* Identity at the top of the 352px column: a 96px cover, the title,
		   the meta and the rating (100..258). */
		.identity {
			gap: 16px;
			padding: 16px 0;
		}
		.names {
			gap: 8px;
		}
		h1 {
			font-size: 22px;
		}
		.meta {
			font: var(--type-meta);
		}
		/* CONTINUE, the one accent block: 64px, focused on arrival. */
		.cta {
			margin-top: 16px;
			padding: 0 20px;
			gap: 14px;
			font: var(--type-control);
			letter-spacing: 0.02em;
		}
		/* The rows under it are one ruled block, 56px a row. */
		.row {
			min-height: 56px;
		}
		.label {
			font: var(--type-label);
		}
		.edit,
		.lc,
		.seg button,
		.picks button {
			font-size: 15px;
		}
		/* DETAILS on the TV: one stop, its text a size up, the
		   names cut to four and a count, and OK named on the cell. ABOUT is
		   the design's two lines. */
		.dt {
			gap: 4px;
			padding: 10px 14px;
		}
		.dt-state {
			font-size: 14px;
		}
		.dt-names {
			font-size: 12px;
			line-height: 1.4;
		}
		.dt-all {
			display: none;
		}
		.dt-tv {
			display: block;
		}
		.dt-ok {
			display: inline;
		}
		.dt-go {
			padding: 0 18px;
			font-size: 14px;
			letter-spacing: 0;
		}
		.about p {
			-webkit-line-clamp: 2;
			line-clamp: 2;
		}
	}
</style>

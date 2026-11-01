/**
 * GET STARTED (doc/ONBOARDING.md; cards c208, c209; the handoffs
 * `doc/design/handoff/Start-*.dc.html` and `FirstRead-*.dc.html`): seven
 * steps in two parts, each ticked by what is really there rather than by a
 * press. SET UP is four, in any order; FIRST READ is three, in order, and
 * waits on an extension. Pure: the server gathers the facts
 * (server/start.ts), and this says what each step shows. The words are the
 * reader's language (doc/I18N.md), asked for when a view is made, never at
 * import.
 */

import { m } from '../paraglide/messages.js';
import { num, upper } from '../i18n/format.ts';

export type StepId = 'repo' | 'ext' | 'library' | 'phone' | 'find' | 'add' | 'download';
export const STEPS: StepId[] = ['repo', 'ext', 'library', 'phone', 'find', 'add', 'download'];

export type PartId = 'setup' | 'read';
const PART_STEPS: Record<PartId, StepId[]> = {
	setup: ['repo', 'ext', 'library', 'phone'],
	read: ['find', 'add', 'download']
};
export const partOf = (id: StepId): PartId => (PART_STEPS.read.includes(id) ? 'read' : 'setup');

/**
 * - `todo`: open to be done (and SKIP).
 * - `done`: ticked by itself, with a quiet link to where it was done.
 * - `skipped`: the friend said no; UNDO brings it back.
 * - `blocked`: waits on another step (02 on 01, FIRST READ on 02). No SKIP:
 *   skipping the step it waits on is the way to say no.
 */
export type StepState = 'todo' | 'done' | 'skipped' | 'blocked';

export type StartFacts = {
	repositories: number;
	/** Extensions and novel plugins installed. */
	installed: number;
	/**
	 * Series a scan or a backup brought into the library, that the viewer may
	 * see. Not one ADD made: that's 06's, and would tick 03 for nothing.
	 */
	series: number;
	/** Phones paired over Wi-Fi, and phones or tablets that have checked in at all. */
	phones: number;
	/** Browsing records: series opened from a source and read or watched there, not added. */
	records: number;
	/** Series ADD (or ADD AND DOWNLOAD) put in the library from a source. */
	added: number;
	/** Chapters and episodes waiting in the queue, and ones tsundoku has downloaded. */
	queued: number;
	downloaded: number;
};

export type Step = {
	id: StepId;
	n: string;
	part: PartId;
	title: string;
	optional: boolean;
	state: StepState;
	/** The meta line under the title, as the handoff words it (shown uppercase). */
	meta: string;
	/** The phone's shorter meta line, where the handoff draws one. */
	short: string;
	/** Skipped because this step was (02 with 01; 05 to 07 with 01 or 02): no UNDO of its own. */
	with: StepId | null;
};

export type Part = {
	id: PartId;
	name: string;
	/** The folded row's title, when the part is finished. */
	title: string;
	steps: Step[];
	done: number;
	skipped: number;
	finished: boolean;
	/**
	 * Finished, and folded to one row. A part gone wholly with another step's
	 * skip stays open, its rows saying why (FirstRead board 1, B).
	 */
	folds: boolean;
	/** The part's head, right side: "2 OF 4 DONE · ANY ORDER", "AFTER 02", "3 SKIPPED WITH 02". */
	line: string;
	/** The folded row's meta: "3 done · 1 skipped · repository, extension, phone". */
	fold: string;
	foldShort: string;
};

export type StartView = {
	/** What it was made from: the band says how many chapters were queued. */
	facts: StartFacts;
	steps: Step[];
	parts: Part[];
	/** Done, not counting skipped. */
	done: number;
	skipped: number;
	/** Every step done or skipped: the list stops appearing by itself. */
	finished: boolean;
};

const TITLES: Record<StepId, () => string> = {
	repo: m.start_title_repo,
	ext: m.start_title_ext,
	library: m.start_title_library,
	phone: m.start_title_phone,
	find: m.start_title_find,
	add: m.start_title_add,
	download: m.start_title_download
};

const nOf = (id: StepId) => String(STEPS.indexOf(id) + 1).padStart(2, '0');

/** The skips as kept (a JSON list of step ids), whatever was there. */
export function parseSkipped(raw: string): StepId[] {
	try {
		const v = JSON.parse(raw || '[]') as unknown;
		return Array.isArray(v) ? STEPS.filter((s) => v.includes(s)) : [];
	} catch {
		return [];
	}
}

/** What ticks each step. Done wins: a later FIRST READ step ticks the ones before it. */
function doneOf(f: StartFacts): Record<StepId, boolean> {
	const download = f.queued + f.downloaded > 0;
	const add = f.added > 0 || download;
	return {
		repo: f.repositories > 0,
		ext: f.installed > 0,
		library: f.series > 0,
		phone: f.phones > 0,
		find: f.records > 0 || add,
		add,
		download
	};
}

export function startView(f: StartFacts, skipped: StepId[]): StartView {
	const skip = new Set(skipped);
	const done = doneOf(f);
	// A step a skipped one takes with it: 02 goes with 01, FIRST READ with 01 or 02.
	const goneWith = (id: StepId): StepId | null => {
		if (done[id]) return null;
		if (id === 'ext') return skip.has('repo') && !done.repo ? 'repo' : null;
		if (partOf(id) === 'read') {
			if (skip.has('repo') && !done.repo && !done.ext) return 'repo';
			if (skip.has('ext') && !done.ext) return 'ext';
		}
		return null;
	};
	const steps = STEPS.map((id): Step => {
		const w = goneWith(id);
		const state: StepState = done[id]
			? 'done'
			: skip.has(id) || w
				? 'skipped'
				: (id === 'ext' && !done.repo) || (partOf(id) === 'read' && !done.ext)
					? 'blocked'
					: 'todo';
		const meta = metaOf(id, state, f, w, done);
		return {
			id,
			n: nOf(id),
			part: partOf(id),
			title: TITLES[id](),
			optional: id === 'library',
			state,
			meta,
			short: state === 'todo' ? (shortOf(id) ?? meta) : meta,
			with: w
		};
	});
	const parts = (['setup', 'read'] as PartId[]).map((p) => partView(p, steps));
	const doneN = steps.filter((s) => s.state === 'done').length;
	const skippedN = steps.filter((s) => s.state === 'skipped').length;
	return {
		facts: f,
		steps,
		parts,
		done: doneN,
		skipped: skippedN,
		finished: doneN + skippedN === steps.length
	};
}

function metaOf(
	id: StepId,
	state: StepState,
	f: StartFacts,
	w: StepId | null,
	done: Record<StepId, boolean>
): string {
	if (state === 'skipped')
		return w ? m.start_meta_skipped_with({ n: nOf(w) }) : m.start_meta_skipped();
	if (state === 'blocked')
		return id === 'ext' ? m.start_meta_blocked() : m.start_meta_blocked_read();
	if (state === 'done')
		return {
			repo: () => m.start_meta_done_repo({ count: f.repositories, n: num(f.repositories) }),
			ext: () => m.start_meta_done_ext({ count: f.installed, n: num(f.installed) }),
			library: () => m.start_meta_done_library({ count: f.series, n: num(f.series) }),
			phone: m.start_meta_done_phone,
			find: () =>
				f.records > 0
					? m.start_meta_done_find({ count: f.records, n: num(f.records) })
					: m.start_meta_done_with({ n: nOf(done.download && !f.added ? 'download' : 'add') }),
			add: () =>
				f.added > 0
					? m.start_meta_done_add({ count: f.added, n: num(f.added) })
					: m.start_meta_done_with({ n: nOf('download') }),
			download: () =>
				f.queued > 0
					? m.start_meta_done_queued({ count: f.queued, n: num(f.queued) })
					: m.start_meta_done_downloaded({ count: f.downloaded, n: num(f.downloaded) })
		}[id]();
	return {
		repo: m.start_meta_todo_repo,
		ext: m.start_meta_todo_ext,
		library: m.start_meta_todo_library,
		phone: m.start_meta_todo_phone,
		find: m.start_meta_todo_find,
		add: m.start_meta_todo_add,
		download: m.start_meta_todo_download
	}[id]();
}

const shortOf = (id: StepId): string | null =>
	({
		find: m.start_meta_short_find,
		add: m.start_meta_short_add,
		download: m.start_meta_short_download
	})[id as 'find' | 'add' | 'download']?.() ?? null;

const FOLD_NAMES: Record<StepId, () => string> = {
	repo: m.start_fold_repo,
	ext: m.start_fold_ext,
	library: m.start_fold_library,
	phone: m.start_fold_phone,
	find: m.start_fold_find,
	add: m.start_fold_add,
	download: m.start_fold_download
};

function partView(id: PartId, all: Step[]): Part {
	const steps = all.filter((s) => s.part === id);
	const done = steps.filter((s) => s.state === 'done').length;
	const skipped = steps.filter((s) => s.state === 'skipped').length;
	const total = steps.length;
	const c = { done, total, skipped };
	let line: string;
	const gone = steps.find((s) => s.with)?.with ?? null;
	if (id === 'read' && steps.every((s) => s.state === 'blocked'))
		line = m.start_part_after({ n: nOf('ext') });
	else if (gone && steps.every((s) => s.with === gone))
		line = m.start_part_skipped_with({ count: total, n: nOf(gone) });
	else if (skipped) line = m.start_count_skipped(c);
	else line = id === 'setup' ? m.start_part_any(c) : m.start_part_in_order(c);
	const counts = [
		done ? m.start_fold_done({ count: done, n: num(done) }) : '',
		skipped ? m.start_fold_skipped({ count: skipped, n: num(skipped) }) : ''
	].filter(Boolean);
	const names = steps.filter((s) => s.state === 'done').map((s) => FOLD_NAMES[s.id]());
	return {
		id,
		name: id === 'setup' ? m.start_part_setup() : m.start_part_read(),
		title: id === 'setup' ? m.start_part_setup_title() : m.start_part_read_title(),
		steps,
		done,
		skipped,
		finished: done + skipped === total,
		folds: done + skipped === total && steps.some((s) => !s.with),
		line,
		fold: [...counts, names.join(', ')].filter(Boolean).join(' · '),
		foldShort: counts.join(' · ')
	};
}

/**
 * The step that opens by itself. FIRST READ's first step to do comes ahead
 * of SET UP's: once a source is installed, reading is what tsundoku was
 * installed for. Otherwise the first step still to do.
 */
export function firstOpen(v: StartView): StepId | null {
	const read = v.steps.find((s) => s.part === 'read' && s.state === 'todo');
	return (read ?? v.steps.find((s) => s.state === 'todo'))?.id ?? null;
}

/** SKIP and UNDO, as the kept list. What a skip takes with it is `with`, worked out, never kept. */
export function withSkip(skipped: StepId[], id: StepId, on: boolean): StepId[] {
	const s = new Set(skipped);
	if (on) s.add(id);
	else s.delete(id);
	return STEPS.filter((x) => s.has(x));
}

/** The head's count: "2 OF 7 DONE", with skips said when there are some. */
export function countLine(v: StartView, phone = false): string {
	const c = { done: v.done, total: v.steps.length, skipped: v.skipped };
	if (phone) return v.skipped ? m.start_count_phone_skipped(c) : m.start_count_phone(c);
	return v.skipped ? m.start_count_skipped(c) : m.start_count(c);
}

/** SET UP finished first, FIRST READ still open: the list's head turns to it (FirstRead board 3). */
export function readLeads(v: StartView): boolean {
	const [setup, read] = v.parts;
	return setup.finished && !read.finished;
}

// ---- what FIRST READ's open steps show ----

export type FirstReadSource = {
	id: string;
	label: string;
	kind: 'manga' | 'anime' | 'novel';
	lang: string;
};

/** What FIRST READ's open steps show beside their words (FirstRead board 1, C and D). */
export type FirstReadExtras = {
	/** 05: the sources to search, or browse one. */
	sources: FirstReadSource[];
	/** 06: the last browsing record, whose preview OPEN → starts the trip on. */
	record: {
		previewId: string;
		title: string;
		source: string;
		anime: boolean;
		/** Where it stands: the entry ▶ CONTINUE opens, and of how many. */
		at: number;
		total: number;
		/** ▶ CONTINUE's line: the entry's label, and the page for a chapter left partway. */
		label: string;
		page: number | null;
	} | null;
	/** 07: the series 06 added, or the library's most recent. */
	pick: {
		id: number;
		title: string;
		anime: boolean;
		total: number;
		downloaded: number;
		/** Unread, with no file: what FIRST 10 and ALL take. */
		missing: number;
	} | null;
};

// ---- the way back -----------------------------------------------------------------

/** FIRST READ's screens: the search, a source's BROWSE, the preview, the series, DOWNLOADS. */
const READ_PATHS = ['/downloads/search', '/browse', '/downloads/source/', '/series/', '/downloads'];

export type TrailDef = {
	/** The screens a trip lasts across, by path prefix. */
	paths: string[];
	/** Screens the trip goes on through without a band (the reader shows nothing else). */
	through?: string[];
	/** Paths under `paths` that aren't the trip's. */
	not?: string[];
	href: string;
	doing: () => string;
};

/**
 * The way back (Start board 2, FirstRead boards 2): where each step sends
 * the friend, and what the band on that screen says. Only the steps whose
 * work is on another screen.
 */
export const TRAIL: Partial<Record<StepId, TrailDef>> = {
	repo: {
		paths: ['/browse/extensions'],
		href: '/browse/extensions?tab=repos',
		doing: m.start_ticks_repo
	},
	ext: {
		paths: ['/browse/extensions'],
		href: '/browse/extensions?tab=available',
		doing: m.start_ticks_ext
	},
	phone: {
		paths: ['/settings'],
		href: '/settings#s-devices',
		doing: m.start_ticks_phone
	},
	find: {
		paths: READ_PATHS,
		through: ['/read/'],
		not: ['/browse/extensions'],
		href: '/downloads/search',
		doing: m.start_doing_find
	},
	add: {
		paths: READ_PATHS,
		through: ['/read/'],
		not: ['/browse/extensions'],
		href: '/downloads/search',
		doing: m.start_doing_add
	},
	download: {
		paths: READ_PATHS,
		through: ['/read/'],
		not: ['/browse/extensions'],
		href: '/downloads',
		doing: m.start_doing_download
	}
};

const under = (path: string, prefixes: string[] | undefined) =>
	!!prefixes?.some((p) => path === p || path.startsWith(p.endsWith('/') ? p : `${p}/`));

/** Whether a trip for this step shows its band on this path. */
export function trailHere(id: StepId, path: string): boolean {
	const t = TRAIL[id];
	return !!t && under(path, t.paths) && !under(path, t.not);
}

/** Whether a trip for this step lasts onto this path (its screens, and the reader). */
export function trailLasts(id: StepId, path: string): boolean {
	return trailHere(id, path) || under(path, TRAIL[id]?.through);
}

/** What the band says once the step it was opened for ticks (Start board 2, done). */
export function trailDone(v: StartView, id: StepId): { a: string; b: string } {
	const s = v.steps.find((x) => x.id === id)!;
	const word = {
		repo: m.start_done_word_repo,
		ext: m.start_done_word_ext,
		library: m.start_done_word_library,
		phone: m.start_done_word_phone,
		find: m.start_done_word_find,
		add: m.start_done_word_add,
		download: m.start_done_word_download
	}[id]();
	return { a: m.start_trail_done({ n: s.n, word }), b: stillOpen(v) };
}

function stillOpen(v: StartView): string {
	const next = v.steps.find((x) => x.state === 'todo');
	return next
		? m.start_trail_still_open({ n: next.n, title: upper(next.title) })
		: m.start_trail_all_done();
}

export type ReadTrail = {
	/** `arrive`: nothing ticked yet on this trip; `ticked`: one did, another is next; `done`: FIRST READ is finished. */
	mode: 'arrive' | 'ticked' | 'done';
	a: string;
	b: string;
	/** The phone's band: "06 OF 07". */
	short: string;
	/** The control the next step means, ringed in accent on its screen. */
	ring: 'add' | 'download' | null;
	/** The step that ticked on this trip, if one did. */
	ticked: StepId | null;
};

/**
 * FIRST READ's band (FirstRead boards 2): one band for the whole part,
 * moving on as each step ticks. `before` is which of its steps were done
 * when the trip began, so a tick on this trip is told apart from one done
 * long ago. `prefix` is what the screen adds ahead of the next step (the
 * series just added: "140 CHAPTERS · NONE DOWNLOADED").
 */
export function readTrail(v: StartView, before: StepId[], prefix = ''): ReadTrail {
	const f = v.facts;
	const read = v.parts[1];
	const total = String(v.steps.length).padStart(2, '0');
	const ticked =
		[...read.steps].reverse().find((s) => s.state === 'done' && !before.includes(s.id))?.id ?? null;
	const next = read.steps.find((s) => s.state === 'todo') ?? null;
	const ring = next?.id === 'add' ? 'add' : next?.id === 'download' ? 'download' : null;
	const tickedWord = (id: StepId) =>
		id === 'download'
			? f.queued > 0
				? m.start_done_word_queued({ count: f.queued, n: num(f.queued) })
				: m.start_done_word_downloaded({ count: f.downloaded, n: num(f.downloaded) })
			: id === 'add'
				? m.start_done_word_add()
				: m.start_done_word_find();
	const lead = (s: string) => (prefix ? `${prefix} · ${s}` : s);
	if (read.finished) {
		const last = ticked ?? [...read.steps].reverse().find((s) => s.state === 'done')?.id ?? null;
		const a = last
			? m.start_trail_done({ n: nOf(last), word: tickedWord(last) })
			: m.start_trail_all_done();
		return {
			mode: 'done',
			a: m.start_trail_part_done({ a }),
			b: stillOpen(v),
			short: m.start_trail_short({ n: last ? nOf(last) : nOf('download'), total }),
			ring: null,
			ticked: last
		};
	}
	const n = next ? next.n : nOf('find');
	if (ticked && next)
		return {
			mode: 'ticked',
			a: m.start_trail_done({ n: nOf(ticked), word: tickedWord(ticked) }),
			b: lead(m.start_trail_now({ n, total, doing: nowDoing(next.id) })),
			short: m.start_trail_short({ n, total }),
			ring,
			ticked
		};
	return {
		mode: 'arrive',
		a: m.start_trail_read_step({ n, total, title: upper(next ? next.title : '') }),
		b: lead(next ? TRAIL[next.id]!.doing() : ''),
		short: m.start_trail_short({ n, total }),
		ring,
		ticked: null
	};
}

const nowDoing = (id: StepId) =>
	id === 'download' ? m.start_now_download() : (TRAIL[id]?.doing() ?? '');

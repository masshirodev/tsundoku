/**
 * GET STARTED (doc/ONBOARDING.md; card c208; the Getting Started handoff,
 * `doc/design/handoff/Start-*.dc.html`): four steps a new library is set up
 * by, in any order, each ticked by what is really there rather than by a
 * press. Pure: the server gathers the facts (server/start.ts), and this says
 * what each step shows. The words are the reader's language (doc/I18N.md),
 * asked for when a view is made, never at import.
 */

import { m } from '../paraglide/messages.js';
import { num, upper } from '../i18n/format.ts';

export type StepId = 'repo' | 'ext' | 'library' | 'phone';
export const STEPS: StepId[] = ['repo', 'ext', 'library', 'phone'];

/**
 * - `todo`: open to be done (and SKIP).
 * - `done`: ticked by itself, with a quiet link to where it was done.
 * - `skipped`: the friend said no; UNDO brings it back.
 * - `blocked`: waits on another step (02 on 01).
 */
export type StepState = 'todo' | 'done' | 'skipped' | 'blocked';

export type StartFacts = {
	repositories: number;
	/** Extensions and novel plugins installed. */
	installed: number;
	/** Series in the library the viewer may see: a hidden one never ticks 03 for someone who can't see it. */
	series: number;
	/** Phones paired over Wi-Fi, and phones or tablets that have checked in at all. */
	phones: number;
};

export type Step = {
	id: StepId;
	n: string;
	title: string;
	optional: boolean;
	state: StepState;
	/** The meta line under the title, as the handoff words it (shown uppercase). */
	meta: string;
	/** Skipped because 01 was: no UNDO of its own, 01's brings both back. */
	withRepo: boolean;
};

export type StartView = {
	steps: Step[];
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
	phone: m.start_title_phone
};

/** The skips as kept (a JSON list of step ids), whatever was there. */
export function parseSkipped(raw: string): StepId[] {
	try {
		const v = JSON.parse(raw || '[]') as unknown;
		return Array.isArray(v) ? STEPS.filter((s) => v.includes(s)) : [];
	} catch {
		return [];
	}
}

export function startView(f: StartFacts, skipped: StepId[]): StartView {
	const skip = new Set(skipped);
	const doneOf: Record<StepId, boolean> = {
		repo: f.repositories > 0,
		ext: f.installed > 0,
		library: f.series > 0,
		phone: f.phones > 0
	};
	const steps = STEPS.map((id, i): Step => {
		const done = doneOf[id];
		// Done wins over skipped: a step done after all is done.
		const withRepo = id === 'ext' && !done && skip.has('repo') && !doneOf.repo;
		const state: StepState = done
			? 'done'
			: skip.has(id) || withRepo
				? 'skipped'
				: id === 'ext' && !doneOf.repo
					? 'blocked'
					: 'todo';
		return {
			id,
			n: String(i + 1).padStart(2, '0'),
			title: TITLES[id](),
			optional: id === 'library',
			state,
			meta: metaOf(id, state, f, withRepo),
			withRepo
		};
	});
	const done = steps.filter((s) => s.state === 'done').length;
	const skippedN = steps.filter((s) => s.state === 'skipped').length;
	return { steps, done, skipped: skippedN, finished: done + skippedN === steps.length };
}

function metaOf(id: StepId, state: StepState, f: StartFacts, withRepo: boolean): string {
	if (state === 'skipped')
		return withRepo ? m.start_meta_skipped_with_repo() : m.start_meta_skipped();
	if (state === 'blocked') return m.start_meta_blocked();
	if (state === 'done')
		return {
			repo: () => m.start_meta_done_repo({ count: f.repositories, n: num(f.repositories) }),
			ext: () => m.start_meta_done_ext({ count: f.installed, n: num(f.installed) }),
			library: () => m.start_meta_done_library({ count: f.series, n: num(f.series) }),
			phone: m.start_meta_done_phone
		}[id]();
	return {
		repo: m.start_meta_todo_repo,
		ext: m.start_meta_todo_ext,
		library: m.start_meta_todo_library,
		phone: m.start_meta_todo_phone
	}[id]();
}

/** The step that opens by itself: the first one still to do. */
export const firstOpen = (v: StartView): StepId | null =>
	v.steps.find((s) => s.state === 'todo')?.id ?? null;

/** SKIP and UNDO, as the kept list: skipping 01 takes 02 with it, by `withRepo`, not by being kept. */
export function withSkip(skipped: StepId[], id: StepId, on: boolean): StepId[] {
	const s = new Set(skipped);
	if (on) s.add(id);
	else s.delete(id);
	return STEPS.filter((x) => s.has(x));
}

/** The head's count: "2 OF 4 DONE · ANY ORDER", with skips said when there are some. */
export function countLine(v: StartView, phone = false): string {
	const c = { done: v.done, total: v.steps.length, skipped: v.skipped };
	if (phone) return v.skipped ? m.start_count_phone_skipped(c) : m.start_count_phone(c);
	return v.skipped ? m.start_count_skipped(c) : m.start_count(c);
}

/**
 * The way back (board 2): where each step sends the friend, and what the
 * band on that screen says. Only the steps whose work is on another screen.
 */
export const TRAIL: Partial<Record<StepId, { path: string; href: string; doing: () => string }>> = {
	repo: {
		path: '/browse/extensions',
		href: '/browse/extensions?tab=repos',
		doing: m.start_ticks_repo
	},
	ext: {
		path: '/browse/extensions',
		href: '/browse/extensions?tab=available',
		doing: m.start_ticks_ext
	},
	phone: {
		path: '/settings',
		href: '/settings#s-devices',
		doing: m.start_ticks_phone
	}
};

/** What the band says once the step it was opened for ticks (board 2, done). */
export function trailDone(v: StartView, id: StepId): { a: string; b: string } {
	const s = v.steps.find((x) => x.id === id)!;
	const word = {
		repo: m.start_done_word_repo,
		ext: m.start_done_word_ext,
		library: m.start_done_word_library,
		phone: m.start_done_word_phone
	}[id]();
	const next = v.steps.find((x) => x.state === 'todo');
	return {
		a: m.start_trail_done({ n: s.n, word }),
		b: next
			? m.start_trail_still_open({ n: next.n, title: upper(next.title) })
			: m.start_trail_all_done()
	};
}

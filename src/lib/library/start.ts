/**
 * GET STARTED (doc/ONBOARDING.md; card c208; the Getting Started handoff,
 * `doc/design/handoff/Start-*.dc.html`): four steps a new library is set up
 * by, in any order, each ticked by what is really there rather than by a
 * press. Pure: the server gathers the facts (server/start.ts), and this says
 * what each step shows.
 */

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

const TITLES: Record<StepId, string> = {
	repo: 'Add a repository',
	ext: 'Install an extension',
	library: 'Bring a library you already have',
	phone: 'Read on your phone'
};

const plural = (n: number, one: string, many: string) =>
	`${n.toLocaleString('en-US')} ${n === 1 ? one : many}`;

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
			title: TITLES[id],
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
	if (state === 'skipped') return withRepo ? 'Skipped with 01' : 'Skipped';
	if (state === 'blocked') return 'After 01 · no repository, so nothing to install';
	if (state === 'done')
		return {
			repo: `Done · ${plural(f.repositories, 'repository', 'repositories')}`,
			ext: `Done · ${f.installed.toLocaleString('en-US')} installed`,
			library: `Done · ${plural(f.series, 'series', 'series')}`,
			phone: 'Done · a phone or tablet reads here'
		}[id];
	return {
		repo: 'Where extensions come from · tsundoku ships none',
		ext: 'A source to browse and read from',
		library: 'A Mihon backup, or files in the library folder',
		phone: 'Wi-Fi at home, or Tailscale anywhere'
	}[id];
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
	const of = `${v.done} OF ${v.steps.length}`;
	if (phone) return v.skipped ? `${of} · ${v.skipped} SKIPPED` : of;
	return v.skipped ? `${of} DONE · ${v.skipped} SKIPPED` : `${of} DONE · ANY ORDER`;
}

/**
 * The way back (board 2): where each step sends the friend, and what the
 * band on that screen says. Only the steps whose work is on another screen.
 */
export const TRAIL: Partial<Record<StepId, { path: string; href: string; doing: string }>> = {
	repo: {
		path: '/browse/extensions',
		href: '/browse/extensions?tab=repos',
		doing: 'TICKS ITSELF WHEN ONE IS ADDED'
	},
	ext: {
		path: '/browse/extensions',
		href: '/browse/extensions?tab=available',
		doing: 'TICKS ITSELF WHEN ONE IS INSTALLED'
	},
	phone: {
		path: '/settings',
		href: '/settings#s-devices',
		doing: 'TICKS ITSELF WHEN A PHONE PAIRS'
	}
};

/** What the band says once the step it was opened for ticks (board 2, done). */
export function trailDone(v: StartView, id: StepId): { a: string; b: string } {
	const s = v.steps.find((x) => x.id === id)!;
	const word = {
		repo: 'A REPOSITORY ADDED',
		ext: 'AN EXTENSION INSTALLED',
		library: 'A SERIES FOUND',
		phone: 'A PHONE PAIRED'
	}[id];
	const next = v.steps.find((x) => x.state === 'todo');
	return {
		a: `✓ ${s.n} DONE · ${word}`,
		b: next ? `STILL OPEN · ${next.n} ${next.title.toUpperCase()}` : 'EVERY STEP DONE OR SKIPPED'
	};
}

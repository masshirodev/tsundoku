import { invalidate } from '$app/navigation';
import {
	partOf,
	readTrail,
	STEPS,
	TRAIL,
	trailHere,
	trailLasts,
	type StartView,
	type StepId
} from './library/start.ts';

/**
 * The way back to GET STARTED (doc/ONBOARDING.md, "The way back"; the
 * handoffs' boards 2): a step's link starts a trip, and the screens it opens
 * wear a band back to the list for as long as the trip lasts. Kept in the
 * tab's sessionStorage, not the URL: EXTENSIONS' own redirects (adding a
 * repository lands on `?tab=repos`) would drop a parameter, and with it the
 * band, at the very moment the step ticks.
 *
 * A SET UP step's trip lasts on its one screen; a FIRST READ step's across
 * the part's screens (the search, BROWSE, the preview, the series,
 * DOWNLOADS) and through the reader. It ends with ✕, with the trip back, or
 * by leaving those screens any other way; opening them on one's own never
 * starts one. `before` is which FIRST READ steps were done when it began, so
 * the band can tell a tick on this trip from one done long ago.
 */
const KEY = 'tsundoku.start.trail';

class Trail {
	step = $state<StepId | null>(null);
	before = $state<StepId[]>([]);

	/** What this tab kept, once it's in the browser. */
	load() {
		try {
			const raw = sessionStorage.getItem(KEY);
			// Before c209 the value was the step alone.
			const v = (raw?.startsWith('{') ? JSON.parse(raw) : { step: raw }) as {
				step?: unknown;
				before?: unknown;
			};
			const ok = typeof v.step === 'string' && (STEPS as string[]).includes(v.step);
			this.step = ok && TRAIL[v.step as StepId] ? (v.step as StepId) : null;
			this.before = Array.isArray(v.before)
				? STEPS.filter((s) => (v.before as unknown[]).includes(s))
				: [];
		} catch {
			this.step = null;
			this.before = [];
		}
	}

	begin(id: StepId, before: StepId[] = []) {
		this.step = id;
		this.before = before;
		try {
			sessionStorage.setItem(KEY, JSON.stringify({ step: id, before }));
		} catch {
			// Storage refused: the band shows on this screen until it's left.
		}
	}

	end() {
		this.step = null;
		this.before = [];
		try {
			sessionStorage.removeItem(KEY);
		} catch {
			// Nothing kept, nothing to drop.
		}
	}

	/** The control FIRST READ's next step means, ringed on this screen (FirstRead boards 2). */
	ring(start: StartView | null, path: string): 'add' | 'download' | null {
		if (!start || !this.step || partOf(this.step) !== 'read' || !trailHere(this.step, path))
			return null;
		return readTrail(start, this.before).ring;
	}

	/** After a navigation: the trip ends once its screens are left. */
	follow(pathname: string) {
		if (this.step && !trailLasts(this.step, pathname)) this.end();
	}
}

export const trail = new Trail();

/** How often an open GET STARTED asks for its list again (c722): the trip band's own 5 s. */
export const START_POLL_MS = 5000;

/**
 * An open GET STARTED list asks for itself again (doc/ONBOARDING.md, "What
 * ticks a step without a reload"; card c722). A step is ticked by what is
 * there, and much of it arrives from elsewhere: a phone pairing over Wi-Fi
 * (04), a download finishing, another tab. The layout's load, where the list
 * comes from, reruns on a client-side navigation only when something it
 * depends on changes, and nothing it reads does: so a list opened before the
 * phone paired kept 04 open until a reload. While the page is in view it asks
 * every 5 s (`invalidate('tsundoku:start')`, the layout's own key, as the trip
 * band does), and once at once when the page comes back into view or the
 * window regains focus. Hidden, it asks nothing. Returns the stop, for an
 * `$effect` to hand back.
 */
export function pollStart(every = START_POLL_MS): () => void {
	const ask = () => void invalidate('tsundoku:start');
	const t = setInterval(() => {
		if (document.visibilityState === 'visible') ask();
	}, every);
	const back = () => {
		if (document.visibilityState === 'visible') ask();
	};
	document.addEventListener('visibilitychange', back);
	addEventListener('focus', back);
	return () => {
		clearInterval(t);
		document.removeEventListener('visibilitychange', back);
		removeEventListener('focus', back);
	};
}

import { TRAIL, STEPS, type StepId } from './library/start.ts';

/**
 * The way back to GET STARTED (doc/ONBOARDING.md, "The way back"; the
 * handoff's board 2): a step's link starts a trip, and the screen it opens
 * wears a band back to the list for as long as the trip lasts. Kept in the
 * tab's sessionStorage, not the URL: EXTENSIONS' own redirects (adding a
 * repository lands on `?tab=repos`) would drop a parameter, and with it the
 * band, at the very moment the step ticks.
 *
 * It ends with ✕, with the trip back, or by leaving the step's screen any
 * other way (the sidebar, the top bar); opening EXTENSIONS on one's own
 * never starts one.
 */
const KEY = 'tsundoku.start.trail';

class Trail {
	step = $state<StepId | null>(null);

	/** What this tab kept, once it's in the browser. */
	load() {
		try {
			const v = sessionStorage.getItem(KEY);
			this.step = v && (STEPS as string[]).includes(v) && TRAIL[v as StepId] ? (v as StepId) : null;
		} catch {
			this.step = null;
		}
	}

	begin(id: StepId) {
		this.step = id;
		try {
			sessionStorage.setItem(KEY, id);
		} catch {
			// Storage refused: the band shows on this screen until it's left.
		}
	}

	end() {
		this.step = null;
		try {
			sessionStorage.removeItem(KEY);
		} catch {
			// Nothing kept, nothing to drop.
		}
	}

	/** After a navigation: the trip ends once its screen is left. */
	follow(pathname: string) {
		const t = this.step ? TRAIL[this.step] : null;
		if (t && !pathname.startsWith(t.path)) this.end();
	}
}

export const trail = new Trail();

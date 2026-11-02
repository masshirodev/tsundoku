/**
 * What the remote's keys mean, as pure decisions (doc/TV.md, "The remote").
 * The layer in layer.ts wires these to the DOM; the timing and the state of a
 * held OK are here so a spec can pin them without a browser.
 *
 * A remote sends: the D-pad as the four arrows, OK as Enter, BACK as a history
 * back or Escape, often MENU as the ContextMenu key, and the media keys.
 */

/** The hold the pointer's long press has always used (src/lib/actions/longpress.ts). */
export const HOLD_MS = 450;

/**
 * BACK in the page: Escape for a keyboard, and the two names browsers give the
 * back button's own key. A WebView hands BACK to the app rather than the page,
 * which is why `window.tsundokuBack()` exists (c236's contract).
 */
export function isBackKey(key: string): boolean {
	return key === 'Escape' || key === 'BrowserBack' || key === 'GoBack';
}

/** MENU: the focused thing's options, at once, where the remote has the key. */
export function isOptionsKey(key: string): boolean {
	return key === 'ContextMenu';
}

/** OK. The D-pad's centre arrives as Enter, and so does a keyboard's. */
export function isOkKey(key: string): boolean {
	return key === 'Enter';
}

/**
 * OK, pressed or held. A short press is the click its release would have made;
 * a hold past `ms` is the focused thing's options instead. A held key repeats,
 * and neither a repeat nor the release after a hold may press or open again.
 *
 * The layer calls `down` on keydown and `up` on keyup; `cancel` on a blur.
 */
export class OkPress {
	#timer: ReturnType<typeof setTimeout> | undefined;
	#armed = false;
	#fired = false;

	constructor(
		private readonly hold: () => void,
		private readonly press: () => void,
		private readonly ms = HOLD_MS
	) {}

	/** Whether OK is down now: pressed, and not yet released or cancelled. */
	get armed(): boolean {
		return this.#armed;
	}

	/**
	 * Whether the key event is the layer's. False: leave it to the page.
	 *
	 * A keydown while OK is already down is a repeat, whatever its `repeat`
	 * says: Android TV's WebView sends a held D-pad centre as a stream of
	 * keydowns, and restarting the hold on each one meant it never fired
	 * (2026-11-02, the first real TV; MENU, one key, worked).
	 */
	down(repeat: boolean): boolean {
		if (repeat || this.#armed) return this.#armed;
		this.#armed = true;
		this.#fired = false;
		clearTimeout(this.#timer);
		this.#timer = setTimeout(() => {
			this.#fired = true;
			this.hold();
		}, this.ms);
		return true;
	}

	/** The release: a click only when the hold never fired. */
	up(): void {
		if (!this.#armed) return;
		this.#armed = false;
		clearTimeout(this.#timer);
		const fired = this.#fired;
		this.#fired = false;
		if (!fired) this.press();
	}

	/** Nothing is pressed: the screen changed under it. */
	cancel(): void {
		this.#armed = false;
		this.#fired = false;
		clearTimeout(this.#timer);
	}
}

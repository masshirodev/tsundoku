/**
 * What the remote's keys mean, as pure decisions (doc/TV.md, "The remote").
 * The layer in layer.ts wires these to the DOM; the timing and the state of a
 * held OK are here so a spec can pin them without a browser.
 *
 * A remote sends: the D-pad as the four arrows, OK as Enter, BACK as a history
 * back or Escape, often MENU as the ContextMenu key, and the media keys.
 */

import type { Direction } from './geometry';

/** The hold the pointer's long press has always used (src/lib/actions/longpress.ts). */
export const HOLD_MS = 450;

/**
 * BACK in the page: Escape for a keyboard, and the two names browsers give the
 * back button's own key. A WebView hands BACK to the app rather than the page,
 * which is why `window.tsundokuBack()` exists (the app's contract).
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
	 * keydowns, and restarting the hold on each one means it never fires (on a
	 * real TV; MENU, one key, works).
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

/**
 * What a slider, or a control that says it adjusts, is to the arrows: the
 * nearest one around the focused thing (`dom.ts`, `keepsArrow`, reads it off
 * the element).
 */
export type SliderShape = {
	/** `data-focus-adjust`'s value: null without the attribute, '' or a word with it. */
	adjust: string | null;
	/** `role="slider"`. */
	slider: boolean;
	/** A native `<input type="range">`. */
	range: boolean;
	/** `aria-orientation`, null when not said (a slider is horizontal by default). */
	orientation: string | null;
};

/**
 * Whether the thing keeps this arrow for its own value rather than letting the
 * pad move on (doc/FOCUS.md, "Within it").
 *
 * - A slider (`role="slider"`, or a native range) keeps the two arrows along
 *   its axis and lets the other two leave, with no attribute: ← → on a
 *   horizontal one, ↑ ↓ on one that says `aria-orientation="vertical"`. A
 *   remote has no other keys for the value, and no other way out of a row.
 * - `data-focus-adjust` says the same of anything else (the TV's rating, a
 *   ruled row of buttons): ← → are its own, ↑ ↓ leave. On a slider it
 *   wins over the slider's axis.
 * - `data-focus-adjust="none"` is the way out: a slider that must not
 *   adjust under the pad (its value moved some other way) lets all four go.
 */
export function sliderKeeps(shape: SliderShape, direction: Direction): boolean {
	if (shape.adjust === 'none') return false;
	const across = direction === 'left' || direction === 'right';
	if (shape.adjust !== null) return across;
	if (!shape.slider && !shape.range) return false;
	return shape.orientation === 'vertical' ? !across : across;
}

/** A slider, a native range, or a thing that says it adjusts (or that it doesn't). */
export const adjusts = (s: SliderShape) => s.adjust !== null || s.slider || s.range;

/**
 * The same, from the focused thing outward (itself first, then each parent):
 * the nearest that adjusts decides, so a slider inside an adjusting row is its
 * own slider. Null when none does, and the text entries' rules apply.
 */
export function arrowKept(chain: readonly SliderShape[], direction: Direction): boolean | null {
	const owner = chain.find(adjusts);
	return owner ? sliderKeeps(owner, direction) : null;
}

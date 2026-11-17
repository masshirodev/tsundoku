/**
 * Smooth scrolling for the vertical strip on a PC (doc/READER.md, "Scrolling
 * on a PC"). A mouse wheel's notch, and ↑ / ↓ by a screen, ease the strip
 * toward where they aim instead of jumping there: smooth, like Mihon, without
 * losing responsiveness.
 *
 * Responsiveness is the constraint, so it's an exponential approach, not a
 * timed tween: every frame covers the same share of what's left, so it moves
 * at once (the first frame already covers most of a notch), and a second notch
 * extends the target rather than queueing behind the first, so it never trails
 * the hand. A scroll from anything else (the scrollbar, a drag, the strip
 * keeping its place) stops it where it is.
 *
 * Pure apart from what it's given: the clock and the window are injected.
 */

/** How quickly it closes in: ~95% of the way in 3 × TAU. 40 ms settles a notch in ~120 ms. */
export const TAU = 40;

/** One frame's step toward `target` after `dt` ms. */
export function approach(y: number, target: number, dt: number, tau = TAU): number {
	const next = y + (target - y) * (1 - Math.exp(-Math.max(0, dt) / tau));
	// The last half pixel is reached, not approached forever.
	return Math.abs(target - next) < 0.5 ? target : next;
}

type WheelLike = Pick<WheelEvent, 'deltaMode' | 'deltaX' | 'deltaY'>;

/**
 * Whether a wheel event is a mouse wheel's notch, to smooth, rather than a
 * trackpad's or a touchscreen's stream, which the browser already scrolls
 * smoothly and which must stay native (momentum, rubber-banding).
 *
 * - Firefox reports a mouse wheel in lines (deltaMode 1).
 * - Chromium reports CSS pixels: 100 a notch at 100% scaling, divided by the
 *   screen's scale elsewhere (80 at 125%, 66.67 at 150%, 44.44 at 225%). A
 *   rule on the CSS pixels alone took those for a trackpad, and never smoothed
 *   a scaled screen's wheel (found by the tablet project's 2.25). Times the
 *   scale, a notch is a whole 100 or 120 device pixels; a trackpad's deltas are
 *   small and uneven. Its legacy `wheelDeltaY` doesn't help: it is -1.2 times
 *   the CSS delta, scaled the same way (-53 at 2.25).
 */
export function isNotch(e: WheelLike, scale = 1): boolean {
	if (e.deltaY === 0 || Math.abs(e.deltaX) > Math.abs(e.deltaY)) return false;
	if (e.deltaMode === 1 || e.deltaMode === 2) return true;
	const device = Math.abs(e.deltaY) * scale;
	const near = (unit: number) => Math.abs(device - Math.round(device / unit) * unit) < 0.5;
	return device >= 99.5 && (near(100) || near(120));
}

/** A wheel event's distance in pixels: lines as the browser would count them, pages as a screen. */
export function wheelPixels(
	e: Pick<WheelEvent, 'deltaMode' | 'deltaY'>,
	screen: number,
	line = 40
): number {
	if (e.deltaMode === 1) return e.deltaY * line;
	if (e.deltaMode === 2) return e.deltaY * screen;
	return e.deltaY;
}

/**
 * Ctrl + ↑ / ↓: a nudge, to bring a panel the screen cut in two into view
 * without the mouse. It also sets how far ← / → pan a strip zoomed wider than
 * the screen.
 */
export const NUDGE = 100;

/**
 * How long a key's move takes. The wheel's approach starts at full speed so a
 * notch feels instant, which over a whole screen is a lurch: keys glide
 * instead, starting gently and settling, the longer the move the longer the
 * glide. 320 ms for a screen reads as slow, so a screen takes 220 ms.
 */
export const GLIDE_SCREEN = 220;
export const GLIDE_NUDGE = 160;

/** Ease in and out: no jolt at the start, none at the end. */
export const easeInOut = (p: number) => (p < 0.5 ? 4 * p * p * p : 1 - Math.pow(-2 * p + 2, 3) / 2);

/** Ease out only: fast at first, slower to the end (a held key coming up). */
export const easeOut = (p: number) => 1 - Math.pow(1 - p, 3);

/** ↑ / ↓, PageUp / PageDown, Space: a screen, less a little, so the last line read stays in sight. */
export const screenStep = (height: number) => Math.round(height * 0.85);

/** A speed going from `from` to `to` (px per ms, signed) over `ms`, begun at `t0`, then staying. */
type Ramp = { from: number; to: number; t0: number; ms: number };

/** A ramp's speed `at` ms after it began. */
const rampSpeed = (r: Ramp, at: number) =>
	r.from + (r.to - r.from) * Math.min(1, Math.max(0, at) / r.ms);

/** How far a ramp has carried the strip `at` ms after it began. */
const rampDistance = (r: Ramp, at: number) => {
	const up = Math.min(at, r.ms);
	return r.from * up + ((r.to - r.from) * up * up) / (2 * r.ms) + r.to * (at - up);
};

/** How steep an ease is at `p`, in progress per unit of progress. */
function slope(ease: (p: number) => number, p: number): number {
	const lo = Math.max(0, p - 1e-3);
	const hi = Math.min(1, p + 1e-3);
	return hi > lo ? (ease(hi) - ease(lo)) / (hi - lo) : 0;
}

type Host = {
	now(): number;
	frame(cb: (t: number) => void): number;
	cancel(id: number): void;
	get y(): number;
	set y(v: number);
	/** The furthest the window scrolls. */
	max(): number;
};

export class SmoothScroll {
	private target = 0;
	private shown = 0;
	private last = 0;
	private id = 0;
	/** A key's glide in flight: from where, when, for how long, easing how. */
	private glider: {
		from: number;
		t0: number;
		ms: number;
		ease: (p: number) => number;
	} | null = null;
	/**
	 * A held key while one is down: its speed in px per ms, signed, as a
	 * ramp from the speed the strip had to the steady one. Null when
	 * nothing is held and when a glide is a press's own.
	 */
	private held: Ramp | null = null;
	constructor(private host: Host) {}
	/**
	 * Where the strip is going: the glide's target while it moves, else where
	 * it is. A key step is measured from here, as `glide` adds to it.
	 */
	get aim(): number {
		return this.moving ? this.target : this.host.y;
	}

	get moving(): boolean {
		return this.id !== 0;
	}

	/** The wheel: aim `by` pixels further than where it's going (or where it is, if still). */
	by(by: number) {
		const from = this.moving ? this.target : this.host.y;
		this.target = Math.min(Math.max(0, from + by), this.host.max());
		// A glide in flight becomes the approach from where it is.
		this.glider = null;
		this.held = null;
		this.start();
	}

	/**
	 * A key: glide `by` pixels further than where it's going, over `ms`. Pressed
	 * again mid-glide, it carries on from where the strip is to the new aim.
	 */
	glide(by: number, ms: number) {
		const from = this.moving ? this.target : this.host.y;
		this.target = Math.min(Math.max(0, from + by), this.host.max());
		this.glider = { from: this.host.y, t0: this.host.now(), ms, ease: easeInOut };
		// A fresh press is not a held one, even if one was going.
		this.held = null;
		this.start();
	}

	/**
	 * A key held down: its repeats must not stack steps, or the aim runs
	 * far ahead of the strip and it keeps travelling after the key comes up.
	 * The strip moves at the speed one press covers in its glide — `by` over
	 * `ms`, not a new number — until `letGo`, reaching it over that same `ms`:
	 * at full speed from the first repeat, a screen's start read as the
	 * lurch keys were given a glide to avoid.
	 *
	 * Called on every repeat, so one that finds its own ramp leaves it alone, or
	 * the ramp would never get past its start. That holds across something else
	 * scrolling (`step`), which stops the strip for a frame and no longer: the
	 * browser's scroll anchoring does that as images come in above, and a fresh
	 * ramp each time would sag for 220 ms. Reaching the end does drop the ramp
	 * (`step`), so a strip that grows starts again from rest. With no ramp and
	 * something else in flight it starts at the speed the strip has, since a
	 * press's glide can still be moving on a short repeat delay and a halt
	 * would be its own jolt.
	 */
	hold(by: number, ms: number) {
		if (!by || ms <= 0) return;
		const to = by / ms;
		if (this.held?.to !== to) {
			const t0 = this.host.now();
			this.held = { from: this.speed(t0), to, t0, ms };
		}
		this.glider = null;
		this.target = this.host.y;
		this.start();
	}

	/**
	 * The key came up, or something else ended the hold: ease to a stop, one
	 * `GLIDE_NUDGE` long. A cubic ease-out starts at three times its average
	 * speed, so a third of the speed times the glide keeps the speed it had and
	 * stops 33 px (a nudge's) later for a 100 px nudge. The speed it **had**: a
	 * key up mid-ramp has not reached the held speed, and easing out from
	 * that would be a shove forward.
	 */
	letGo() {
		if (this.held === null) return;
		const speed = this.speed(this.host.now());
		this.held = null;
		const from = this.host.y;
		const to = Math.min(Math.max(0, from + (speed * GLIDE_NUDGE) / 3), this.host.max());
		this.target = to;
		this.glider = { from, t0: this.host.now(), ms: GLIDE_NUDGE, ease: easeOut };
		this.start();
	}

	/** How fast the strip is moving at `now`, in px per ms, signed. */
	private speed(now: number): number {
		if (!this.moving) return 0;
		if (this.held) return rampSpeed(this.held, now - this.held.t0);
		const g = this.glider;
		if (!g) return (this.target - this.host.y) / TAU;
		const p = (now - g.t0) / g.ms;
		return (slope(g.ease, p) * (this.target - g.from)) / g.ms;
	}

	private start() {
		if (this.moving) return;
		this.shown = this.host.y;
		this.last = this.host.now();
		this.id = this.host.frame(this.step);
	}

	/**
	 * The strip kept its place (a chapter or a reshaped page arrived above, the
	 * window resized): the window moved with the content, nothing moved on
	 * screen. An ease in flight moves with it, rather than stopping as it would
	 * for a scroll from anything else, which would lose the notch.
	 *
	 * `moved` is how far the content moved, which differs from the app's scroll
	 * when the browser had already scrolled part of the way: a strip window that
	 * drops a chapter above gets shorter than the scroll position, so Chromium
	 * clamps it before the correction runs. The window's own
	 * position is the truth after the app's scroll, so `shown` takes it; the
	 * ease's timeline takes the content's move, or the strip would end that
	 * much short of its aim.
	 */
	shift(moved: number) {
		if (!this.moving) return;
		this.shown = this.host.y;
		if (this.glider) this.glider.from += moved;
		this.target = Math.min(Math.max(0, this.target + moved), this.host.max());
	}

	stop() {
		if (this.id) this.host.cancel(this.id);
		this.id = 0;
		this.held = null;
	}

	private step = (t: number) => {
		// Something else scrolled since the last frame: it wins.
		if (Math.abs(this.host.y - this.shown) > 1) return void (this.id = 0);
		const h = this.held;
		if (h !== null) {
			// The held key's scroll: what the ramp covers between the two frames,
			// so its shape does not depend on the frame rate. Clamped at 0 like a
			// glide's p: a frame is stamped when it began, which
			// under load is before the key, and a negative delta ran a held arrow
			// the wrong way on its first frame.
			const a = Math.max(0, this.last - h.t0);
			const b = Math.max(a, t - h.t0);
			// From `shown`, never the window's position: scrollY is whole pixels,
			// and the ramp's first steps on a fast screen are less than one.
			const y = Math.min(
				Math.max(0, this.shown + rampDistance(h, b) - rampDistance(h, a)),
				this.host.max()
			);
			this.last = t;
			this.host.y = y;
			this.shown = y;
			this.target = y;
			// It stops at the end it is heading for, where a release has nothing
			// left to ease out of. Only that one: a hold down from the very top
			// sits at 0 until its first step is big enough to count.
			if (y === (h.to < 0 ? 0 : this.host.max())) {
				this.id = 0;
				this.held = null;
			} else {
				this.id = this.host.frame(this.step);
			}
			return;
		}
		const g = this.glider;
		const y = g
			? (() => {
					// Clamped at 0 too: a frame is stamped when it began, which
					// under load can be before the key, and a negative p eased the
					// strip the wrong way first.
					const p = Math.min(1, Math.max(0, (t - g.t0) / g.ms));
					return p >= 1 ? this.target : g.from + (this.target - g.from) * g.ease(p);
				})()
			: approach(this.shown, this.target, t - this.last);
		this.last = t;
		this.host.y = y;
		this.shown = this.host.y;
		this.id = y === this.target ? 0 : this.host.frame(this.step);
		if (!this.id) this.glider = null;
	};
}

/**
 * Sent on window by the strip when it keeps its place. `detail` is how far it
 * scrolled, as its readers (the strip specs' `kept` counters) count on; `moved`
 * is how far the content itself moved, which is the same number unless the
 * browser had already scrolled part of the way (see `SmoothScroll.shift`).
 */
export const KEPT_PLACE = 'tsundoku:kept-place';

export class KeptPlace extends CustomEvent<number> {
	constructor(
		scrolled: number,
		readonly moved: number
	) {
		super(KEPT_PLACE, { detail: scrolled });
	}
}

/**
 * Scroll the window by `dy` to keep the reader's place, and say so (see
 * `SmoothScroll.shift`). `moved` is how far the content moved, when the browser
 * clamped the window to a document that shrank under it.
 */
export function keepPlaceBy(dy: number, moved = dy) {
	window.scrollBy(0, dy);
	window.dispatchEvent(new KeptPlace(dy, moved));
}

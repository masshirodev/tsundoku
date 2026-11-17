/**
 * Every tap is heard (doc/MOTION.md, "Pressing").
 *
 * The design's press is an inversion: the cell flips to ink. Left to `:active`
 * it would rarely be seen, because a quick tap on a phone ends before
 * `:active` paints and iOS never applies it at all without a touch listener.
 * So the press is one layer for the whole app: a pointer going down on
 * anything pressable marks it `data-pressed`, the CSS in
 * src/lib/styles/motion.css draws it, and the mark is held long enough to be
 * seen. Small things also sink a little (`scale` 0.97).
 *
 * An element chooses with `data-press`: `off` (nothing, for scrims and
 * surfaces the size of the screen), `scale` (it sinks but keeps its colours: a
 * switch, a rating bar), `fill` (it inverts but doesn't sink: a full-width
 * row). Unmarked, it inverts, and it sinks when it's small.
 */

export const PRESSABLE =
	'a[href], button, label:has(input[type="checkbox"], input[type="radio"]), summary, [role="button"], [role="tab"], [role="switch"], [role="option"], [role="menuitem"], [role="radio"], [role="checkbox"]';

/** How long a press shows at least, so a quick tap is seen. */
export const HOLD_MS = 100;
/** A finger waits this long before pressing, so a scroll that starts on a tile doesn't flash it. */
export const TOUCH_DELAY_MS = 60;
/** A finger that moves this far is scrolling, not tapping. */
export const SLOP_PX = 10;
/** Wider than this, a thing inverts without sinking: a row sinking reads as the page lurching. */
export const SINK_MAX_W = 360;
/** Covering more of the screen than this, a thing isn't pressed at all: it is a surface. */
export const SURFACE_SHARE = 0.25;
const SINK = 0.97;

export type PressMode = 'both' | 'fill' | 'scale';

type Box = { width: number; height: number };

/** How an element shows a press, or null when it doesn't. */
export function pressMode(
	asked: string | null,
	role: string | null,
	box: Box,
	viewport: Box
): PressMode | null {
	if (asked === 'off') return null;
	if (asked === 'scale' || asked === 'fill' || asked === 'both') return asked;
	if (box.width * box.height > SURFACE_SHARE * viewport.width * viewport.height) return null;
	if (role === 'switch' || role === 'slider') return 'scale';
	return box.width <= SINK_MAX_W ? 'both' : 'fill';
}

function isDisabled(el: Element): boolean {
	return (
		el.matches(':disabled') ||
		el.getAttribute('aria-disabled') === 'true' ||
		el.closest('[inert]') !== null
	);
}

/** The element a pointer pressed, or null when it isn't pressable. */
export function pressTarget(target: EventTarget | null): Element | null {
	if (!(target instanceof Element)) return null;
	const el = target.closest(PRESSABLE);
	if (!el || isDisabled(el)) return null;
	if (el.closest('[data-press="off"]')) return null;
	return el;
}

/**
 * Install the press layer on the document. Returns its removal. Called once,
 * from the root layout.
 */
export function installPress(): () => void {
	const reduced = matchMedia('(prefers-reduced-motion: reduce)');
	const sinks = new WeakMap<Element, Animation>();

	let current: {
		el: Element;
		mode: PressMode;
		pointer: number;
		x: number;
		y: number;
		shownAt: number | null;
		timer: ReturnType<typeof setTimeout> | undefined;
	} | null = null;

	const sink = (el: Element, to: number) => {
		if (reduced.matches || !(el instanceof HTMLElement || el instanceof SVGElement)) return;
		const from = sinks.get(el) ? getComputedStyle(el).scale : '1';
		sinks.get(el)?.cancel();
		const anim = el.animate(
			{ scale: [from === 'none' ? '1' : from, String(to)] },
			// Pressing is --motion-press on --ease-out; letting go takes as long, so it never snaps.
			{ duration: 140, easing: 'cubic-bezier(0.23, 1, 0.32, 1)', fill: 'forwards' }
		);
		sinks.set(el, anim);
		if (to === 1) {
			anim.onfinish = () => {
				if (sinks.get(el) === anim) {
					anim.cancel();
					sinks.delete(el);
				}
			};
		}
	};

	const show = () => {
		if (!current || current.shownAt !== null) return;
		current.shownAt = performance.now();
		current.el.setAttribute('data-pressed', current.mode);
		if (current.mode !== 'fill') sink(current.el, SINK);
	};

	const release = (now: boolean) => {
		const press = current;
		if (!press) return;
		current = null;
		clearTimeout(press.timer);
		if (press.shownAt === null) return;
		const end = () => {
			// Pressed again while this one was held: the new press lets it go.
			if (current?.el === press.el) return;
			press.el.removeAttribute('data-pressed');
			if (press.mode !== 'fill') sink(press.el, 1);
		};
		const left = HOLD_MS - (performance.now() - press.shownAt);
		if (now || left <= 0) end();
		else setTimeout(end, left);
	};

	const down = (e: PointerEvent) => {
		if (e.pointerType === 'mouse' && e.button !== 0) return;
		release(true);
		const el = pressTarget(e.target);
		if (!el) return;
		const rect = el.getBoundingClientRect();
		const mode = pressMode(el.getAttribute('data-press'), el.getAttribute('role'), rect, {
			width: innerWidth,
			height: innerHeight
		});
		if (!mode) return;
		current = {
			el,
			mode,
			pointer: e.pointerId,
			x: e.clientX,
			y: e.clientY,
			shownAt: null,
			timer: undefined
		};
		if (e.pointerType === 'touch') current.timer = setTimeout(show, TOUCH_DELAY_MS);
		else show();
	};

	const move = (e: PointerEvent) => {
		if (!current || e.pointerId !== current.pointer || e.pointerType !== 'touch') return;
		if (Math.hypot(e.clientX - current.x, e.clientY - current.y) > SLOP_PX) release(true);
	};

	const up = (e: PointerEvent) => {
		if (!current || e.pointerId !== current.pointer) return;
		// A quick tap ends before the finger's delay: it was a tap, so show it now and hold it.
		show();
		release(false);
	};

	const cancel = (e: PointerEvent) => {
		if (current && e.pointerId === current.pointer) release(true);
	};

	// iOS applies :active only once something listens for touches. The layer
	// doesn't need it, but the components' own :active rules do.
	const touch = () => undefined;

	const opts = { capture: true, passive: true } as const;
	addEventListener('pointerdown', down, opts);
	addEventListener('pointermove', move, opts);
	addEventListener('pointerup', up, opts);
	addEventListener('pointercancel', cancel, opts);
	document.addEventListener('touchstart', touch, { passive: true });
	return () => {
		release(true);
		removeEventListener('pointerdown', down, opts);
		removeEventListener('pointermove', move, opts);
		removeEventListener('pointerup', up, opts);
		removeEventListener('pointercancel', cancel, opts);
		document.removeEventListener('touchstart', touch);
	};
}

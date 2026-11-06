import { describe, expect, it } from 'vitest';
import {
	SmoothScroll,
	easeInOut,
	approach,
	isNotch,
	screenStep,
	wheelPixels
} from '../src/lib/reader/smooth-scroll.ts';

/** A window to scroll, and a clock that only moves when the spec says. */
function fake(max = 10_000) {
	let now = 0;
	let y = 0;
	const queue: ((t: number) => void)[] = [];
	const host = {
		now: () => now,
		frame: (cb: (t: number) => void) => queue.push(cb),
		cancel: () => void queue.splice(0),
		get y() {
			return y;
		},
		set y(v: number) {
			y = v;
		},
		max: () => max
	};
	/** Run frames 16 ms apart, `n` of them or until it stops. */
	const run = (n = 1000) => {
		for (let i = 0; i < n && queue.length; i++) {
			now += 16;
			queue.shift()!(now);
		}
	};
	return { host, run, at: () => y, scrollTo: (v: number) => (y = v) };
}

describe('smooth scrolling on a PC (c192)', () => {
	it('moves at once and settles a notch in about 120 ms', () => {
		expect(approach(0, 100, 16)).toBeGreaterThan(30);
		expect(approach(0, 100, 120)).toBeGreaterThan(94);
		expect(approach(99.7, 100, 16)).toBe(100);
	});

	it('eases a notch to exactly where it aims, and a second extends the aim', () => {
		const f = fake();
		const s = new SmoothScroll(f.host);
		s.by(100);
		f.run(1);
		const first = f.at();
		expect(first).toBeGreaterThan(30);
		expect(first).toBeLessThan(100);
		s.by(100);
		f.run();
		expect(f.at()).toBe(200);
		expect(s.moving).toBe(false);
	});

	it('stops at the ends, and when something else scrolls', () => {
		const f = fake(150);
		const s = new SmoothScroll(f.host);
		s.by(500);
		f.run();
		expect(f.at()).toBe(150);
		s.by(-100);
		f.run(1);
		f.scrollTo(20);
		f.run();
		expect(f.at()).toBe(20);
		expect(s.moving).toBe(false);
	});

	it('moves with the content when the strip keeps its place, rather than losing the notch', () => {
		const f = fake();
		const s = new SmoothScroll(f.host);
		s.by(100);
		f.run(1);
		// A chapter of 5000 px arrives above: the strip scrolls with it, and says so.
		f.scrollTo(f.at() + 5000);
		s.shift(5000);
		f.run();
		expect(f.at()).toBe(5100);
	});

	it('glides a key’s move gently: slow at first, slow at the end, there on time', () => {
		expect(easeInOut(0)).toBe(0);
		expect(easeInOut(0.5)).toBe(0.5);
		expect(easeInOut(1)).toBe(1);
		const f = fake();
		const s = new SmoothScroll(f.host);
		s.glide(765, 220);
		f.run(1);
		// The first frame of a screen's glide is a few pixels, not a third of it.
		expect(f.at()).toBeLessThan(10);
		f.run();
		expect(f.at()).toBe(765);
		// Pressed again mid-glide: on from where it is, to the further aim.
		s.glide(765, 220);
		f.run(5);
		s.glide(765, 220);
		f.run();
		expect(f.at()).toBe(765 * 3);
	});

	it('holds a key at a steady speed, and a repeat adds no step to the aim (c668)', () => {
		const f = fake();
		const s = new SmoothScroll(f.host);
		// A screen's move: 765 px over 220 ms, so 3.5 px per frame at 16 ms.
		s.hold(765, 220);
		f.run(1);
		expect(f.at()).toBeCloseTo((765 / 220) * 16, 1);
		// Repeats re-assert the speed, they do not stack steps: after 10 more
		// frames (176 ms) it is at one speed's distance, not ten screens'.
		for (let i = 0; i < 10; i++) {
			s.hold(765, 220);
			f.run(1);
		}
		expect(f.at()).toBeCloseTo((765 / 220) * 176, 1);
		expect(f.at()).toBeLessThan(765);
	});

	it('eases a released hold to a stop within a short distance (c668)', () => {
		const f = fake();
		const s = new SmoothScroll(f.host);
		s.hold(765, 220);
		f.run(10);
		const atRelease = f.at();
		s.letGo();
		f.run();
		// Cubic ease-out: the distance that keeps the held speed is a third of
		// speed × the stop glide, and it is reached, not approached forever.
		expect(f.at()).toBeCloseTo(atRelease + ((765 / 220) * 160) / 3, 1);
		expect(f.at() - atRelease).toBeLessThan(240);
		expect(s.moving).toBe(false);
		// Nothing is left scheduled: the strip stays where it stopped.
		const stopped = f.at();
		f.run(10);
		expect(f.at()).toBe(stopped);
	});

	it('a fresh press after a hold still adds a whole step (c668)', () => {
		const f = fake();
		const s = new SmoothScroll(f.host);
		s.hold(100, 160);
		f.run(5);
		s.letGo();
		f.run();
		const stopped = f.at();
		// Two separate ↓ presses add up, as before the hold existed.
		s.glide(100, 160);
		f.run();
		s.glide(100, 160);
		f.run();
		expect(f.at()).toBeCloseTo(stopped + 200, 6);
	});

	it('never glides the wrong way first, when a frame is stamped before the key (c568)', () => {
		// A frame's timestamp is when the frame began, and under load that can be
		// before the key's performance.now(): wave 24 measured the strip moving
		// -33 px on a nudge, then +85 on the reverse, so a nudge read as lost.
		let now = 1000;
		let y = 500;
		const seen: number[] = [];
		const queue: ((t: number) => void)[] = [];
		const host = {
			now: () => now,
			frame: (cb: (t: number) => void) => queue.push(cb),
			cancel: () => void queue.splice(0),
			get y() {
				return y;
			},
			set y(v: number) {
				y = v;
				seen.push(v);
			},
			max: () => 10_000
		};
		const s = new SmoothScroll(host);
		s.glide(100, 160);
		// Stamped 12 ms before the key, then on as usual.
		queue.shift()!(now - 12);
		for (let i = 0; i < 100 && queue.length; i++) queue.shift()!((now += 16));
		expect(y).toBe(600);
		expect(Math.min(...seen)).toBeGreaterThanOrEqual(500);
		// And back up: never below where it ends, never above where it began.
		seen.length = 0;
		s.glide(-100, 160);
		queue.shift()!(now - 12);
		for (let i = 0; i < 100 && queue.length; i++) queue.shift()!((now += 16));
		expect(y).toBe(500);
		expect(Math.max(...seen)).toBeLessThanOrEqual(600);
	});

	it('smooths a mouse wheel’s notches, never a trackpad’s stream or a sideways wheel', () => {
		expect(isNotch({ deltaMode: 1, deltaX: 0, deltaY: 3 })).toBe(true);
		expect(isNotch({ deltaMode: 0, deltaX: 0, deltaY: 100 })).toBe(true);
		expect(isNotch({ deltaMode: 0, deltaX: 0, deltaY: -120 })).toBe(true);
		expect(isNotch({ deltaMode: 0, deltaX: 0, deltaY: 4.5 })).toBe(false);
		expect(isNotch({ deltaMode: 0, deltaX: 0, deltaY: 12 })).toBe(false);
		expect(isNotch({ deltaMode: 1, deltaX: 3, deltaY: 1 })).toBe(false);
		// A scaled screen (Windows at 150%, a tablet at 2.25): a notch in CSS pixels isn't 100.
		expect(isNotch({ deltaMode: 0, deltaX: 0, deltaY: 66.66666 }, 1.5)).toBe(true);
		expect(isNotch({ deltaMode: 0, deltaX: 0, deltaY: 44.44444444444444 }, 2.25)).toBe(true);
		expect(isNotch({ deltaMode: 0, deltaX: 0, deltaY: 80 }, 1.25)).toBe(true);
		// A trackpad: small and uneven, in both readings.
		expect(isNotch({ deltaMode: 0, deltaX: 0, deltaY: 7.3 }, 1.5)).toBe(false);
		expect(isNotch({ deltaMode: 0, deltaX: 0, deltaY: 37 }, 1)).toBe(false);
		expect(wheelPixels({ deltaMode: 1, deltaY: 3 }, 900)).toBe(120);
		expect(wheelPixels({ deltaMode: 2, deltaY: 1 }, 900)).toBe(900);
		expect(screenStep(900)).toBe(765);
	});
});

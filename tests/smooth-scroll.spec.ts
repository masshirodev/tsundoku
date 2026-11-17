import { afterEach, describe, expect, it, vi } from 'vitest';
import {
	KEPT_PLACE,
	KeptPlace,
	SmoothScroll,
	easeInOut,
	approach,
	isNotch,
	keepPlaceBy,
	screenStep,
	wheelPixels
} from '../src/lib/reader/smooth-scroll.ts';

/** A window to scroll, and a clock that only moves when the spec says. */
function fake(end = 10_000, round = false) {
	let now = 0;
	let y = 0;
	let max = end;
	const queue: ((t: number) => void)[] = [];
	const host = {
		now: () => now,
		frame: (cb: (t: number) => void) => queue.push(cb),
		cancel: () => void queue.splice(0),
		get y() {
			return y;
		},
		set y(v: number) {
			// A browser's scrollY is whole pixels whatever was asked for: measured
			// in Chromium and Firefox at scales 1, 1.25 and 2.25 (100.4 reads 100).
			y = round ? Math.round(v) : v;
		},
		max: () => max
	};
	/** Run frames `dt` ms apart, `n` of them or until it stops. */
	const run = (n = 1000, dt = 16) => {
		for (let i = 0; i < n && queue.length; i++) {
			now += dt;
			queue.shift()!(now);
		}
	};
	return {
		host,
		run,
		at: () => y,
		scrollTo: (v: number) => (y = v),
		setMax: (v: number) => (max = v),
		pending: () => queue.length
	};
}

/** The held speed of a screen's move (765 px over 220 ms), in px per ms. */
const FULL = 765 / 220;
/** How far a hold from rest has gone `ms` after it began: the ramp's own integral. */
const held = (ms: number, full = FULL, ramp = 220) =>
	ms < ramp ? (full * ms * ms) / (2 * ramp) : full * (ms - ramp / 2);

describe('smooth scrolling on a PC', () => {
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

	it('holds a key at a steady speed, and a repeat adds no step to the aim', () => {
		const f = fake();
		const s = new SmoothScroll(f.host);
		s.hold(765, 220);
		f.run(1);
		expect(f.at()).toBeCloseTo(held(16), 1);
		// Repeats re-assert the speed, they do not stack steps: after 10 more
		// frames (176 ms) it is at one speed's distance, not ten screens'.
		for (let i = 0; i < 10; i++) {
			s.hold(765, 220);
			f.run(1);
		}
		expect(f.at()).toBeCloseTo(held(176), 1);
		expect(f.at()).toBeLessThan(765);
	});

	it('eases a released hold to a stop within a short distance', () => {
		const f = fake();
		const s = new SmoothScroll(f.host);
		// Past the ramp, so the key comes up at the full speed.
		s.hold(765, 220);
		f.run(20);
		const atRelease = f.at();
		s.letGo();
		f.run();
		// Cubic ease-out: the distance that keeps the held speed is a third of
		// speed × the stop glide, and it is reached, not approached forever.
		expect(f.at()).toBeCloseTo(atRelease + (FULL * 160) / 3, 1);
		expect(f.at() - atRelease).toBeLessThan(240);
		expect(s.moving).toBe(false);
		// Nothing is left scheduled: the strip stays where it stopped.
		const stopped = f.at();
		f.run(10);
		expect(f.at()).toBe(stopped);
	});

	describe('a held key ramps up', () => {
		it('starts from rest and reaches the full speed over the glide’s own length', () => {
			const f = fake();
			const s = new SmoothScroll(f.host);
			s.hold(765, 220);
			const steps: number[] = [];
			let was = 0;
			for (let i = 0; i < 20; i++) {
				f.run(1);
				steps.push(f.at() - was);
				was = f.at();
			}
			// The ramp's own numbers: speed × t / 220, integrated over each frame.
			expect(steps[0]).toBeCloseTo(2.023, 2);
			expect(steps[1]).toBeCloseTo(6.069, 2);
			expect(steps[2]).toBeCloseTo(10.116, 2);
			// A frame at the steady speed is 55.64 px: the first is under 4% of it.
			expect(FULL * 16).toBeCloseTo(55.636, 2);
			// 220 ms falls inside the fourteenth frame (208 to 224 ms)...
			expect(steps[13]).toBeCloseTo(held(224) - held(208), 2);
			// ...and from the fifteenth it is the steady speed, exactly.
			for (const step of steps.slice(14)) expect(step).toBeCloseTo(55.636, 2);
		});

		it('is the same ramp at any frame rate, and over a long frame', () => {
			for (const dt of [4, 7, 8, 16, 33, 100]) {
				const f = fake();
				const s = new SmoothScroll(f.host);
				s.hold(765, 220);
				const frames = Math.floor(400 / dt);
				f.run(frames, dt);
				expect(f.at(), `${dt} ms a frame`).toBeCloseTo(held(frames * dt), 6);
			}
		});

		it('adds up steps too small for a browser’s whole-pixel scrollY', () => {
			// 144 Hz: the first frame is 0.38 px, which a read of scrollY rounds
			// away, so a ramp that added to scrollY would lose its start.
			const f = fake(10_000, true);
			const s = new SmoothScroll(f.host);
			s.hold(765, 220);
			const dt = 1000 / 144;
			f.run(4, dt);
			expect(Math.abs(f.at() - held(4 * dt))).toBeLessThanOrEqual(0.5);
			expect(f.at()).toBeGreaterThan(0);
			f.run(100, dt);
			expect(Math.abs(f.at() - held(104 * dt))).toBeLessThanOrEqual(0.5);
		});

		it('a repeat mid-ramp does not start the ramp again', () => {
			const f = fake();
			const s = new SmoothScroll(f.host);
			s.hold(765, 220);
			// One repeat a frame, faster than any OS: restarting would never leave the start.
			for (let i = 0; i < 30; i++) {
				f.run(1);
				s.hold(765, 220);
			}
			expect(f.at()).toBeCloseTo(held(480), 6);
		});

		it('a key that comes up mid-ramp eases from the speed it had, not the full one', () => {
			const f = fake();
			const s = new SmoothScroll(f.host);
			s.hold(765, 220);
			f.run(5);
			const atRelease = f.at();
			expect(atRelease).toBeCloseTo(held(80), 6);
			s.letGo();
			f.run();
			// 80 of 220 ms: 1.265 px per ms, so 67.4 px; the full speed's would be 185.5.
			const speed = (FULL * 80) / 220;
			expect(speed).toBeCloseTo(1.2645, 3);
			expect(f.at() - atRelease).toBeCloseTo((speed * 160) / 3, 6);
			expect(s.moving).toBe(false);
		});

		it('a key that comes up on the first frame barely moves', () => {
			const f = fake();
			const s = new SmoothScroll(f.host);
			s.hold(765, 220);
			s.letGo();
			f.run();
			expect(f.at()).toBe(0);
			expect(s.moving).toBe(false);
		});

		it('a different speed mid-ramp carries on from the speed it has', () => {
			const f = fake();
			const s = new SmoothScroll(f.host);
			s.hold(765, 220);
			f.run(5);
			const at = f.at();
			const had = (FULL * 80) / 220;
			// The other way: no jump in speed, it slows through zero and turns.
			s.hold(-765, 220);
			f.run(1);
			expect(f.at() - at).toBeCloseTo(had * 16 + ((-FULL - had) * 16 * 16) / (2 * 220), 6);
			f.run(40);
			expect(f.at()).toBeLessThan(at);
		});

		it('moves with the content when the strip keeps its place mid-ramp', () => {
			const f = fake();
			const s = new SmoothScroll(f.host);
			s.hold(765, 220);
			f.run(5);
			// A chapter of 5000 px arrives above: the strip scrolls with it, and says so.
			f.scrollTo(f.at() + 5000);
			s.shift(5000);
			f.run(5);
			// The ramp is not restarted by it, and no distance is lost or added.
			expect(f.at()).toBeCloseTo(5000 + held(160), 6);
			// The window clamped part of the way: its position is the truth.
			f.scrollTo(f.at() + 700);
			s.shift(700);
			f.run(5);
			expect(f.at()).toBeCloseTo(5700 + held(240), 6);
		});

		it('stop() mid-ramp stops it, and the next hold starts from rest again', () => {
			const f = fake();
			const s = new SmoothScroll(f.host);
			s.hold(765, 220);
			f.run(5);
			const stopped = f.at();
			s.stop();
			expect(s.moving).toBe(false);
			f.run(5);
			expect(f.at()).toBe(stopped);
			// Nothing to ease out of once it is stopped.
			s.letGo();
			f.run();
			expect(f.at()).toBe(stopped);
			s.hold(765, 220);
			f.run(1);
			expect(f.at() - stopped).toBeCloseTo(held(16), 6);
		});

		it('stops at the end mid-ramp, and starts from rest when the strip grows', () => {
			const f = fake(50);
			const s = new SmoothScroll(f.host);
			s.hold(765, 220);
			f.run(5);
			// 80 ms of ramp is 50.6 px: the end comes first.
			expect(held(64)).toBeLessThan(50);
			expect(held(80)).toBeGreaterThan(50);
			expect(f.at()).toBe(50);
			expect(s.moving).toBe(false);
			expect(f.pending()).toBe(0);
			// A repeat at the end has nowhere to go and leaves nothing running.
			s.hold(765, 220);
			f.run(5);
			expect(f.at()).toBe(50);
			expect(s.moving).toBe(false);
			// A chapter arrives below while the key is down: not at full speed at once.
			f.setMax(10_000);
			s.hold(765, 220);
			f.run(1);
			expect(f.at()).toBeCloseTo(50 + held(16), 6);
			s.letGo();
			f.run();
			expect(s.moving).toBe(false);
		});

		it('a key up after the end has nothing to ease out of', () => {
			const f = fake(50);
			const s = new SmoothScroll(f.host);
			s.hold(765, 220);
			f.run(5);
			s.letGo();
			f.run();
			expect(f.at()).toBe(50);
			expect(s.moving).toBe(false);
		});

		it('stops at the top going up, and a hold down from the top is not stopped by being there', () => {
			const f = fake();
			const s = new SmoothScroll(f.host);
			f.scrollTo(30);
			s.hold(-765, 220);
			f.run(100);
			expect(f.at()).toBe(0);
			expect(s.moving).toBe(false);
			s.stop();
			// From 0, a frame stamped before the key moves nothing yet. It is not the end.
			s.hold(765, 220);
			f.run(1, -12);
			expect(f.at()).toBe(0);
			expect(s.moving).toBe(true);
			f.run(1, 28);
			expect(f.at()).toBeGreaterThan(0);
		});

		it('carries on up the same ramp after something else scrolled for a frame', () => {
			const f = fake();
			const s = new SmoothScroll(f.host);
			s.hold(765, 220);
			f.run(5);
			// Scroll anchoring, say: it wins that frame (at 96 ms), and the strip stops.
			f.scrollTo(3000);
			f.run(1);
			expect(f.at()).toBe(3000);
			expect(s.moving).toBe(false);
			// The next repeat resumes where the ramp had got to, not from rest:
			// its frame is 26 px where a fresh ramp's would be 2.
			s.hold(765, 220);
			f.run(1);
			expect(f.at() - 3000).toBeCloseTo(held(112) - held(96), 6);
			expect(held(112) - held(96)).toBeCloseTo(26.3, 1);
		});

		it('a key up after something else scrolled has nothing to ease out of', () => {
			const f = fake();
			const s = new SmoothScroll(f.host);
			s.hold(765, 220);
			f.run(5);
			f.scrollTo(3000);
			f.run(1);
			s.letGo();
			f.run();
			expect(f.at()).toBe(3000);
			expect(s.moving).toBe(false);
		});

		it('takes over a press’s glide in flight at the speed it has, without a halt', () => {
			const f = fake();
			const s = new SmoothScroll(f.host);
			s.glide(765, 220);
			f.run(5);
			const at = f.at();
			// easeInOut's slope at 80 / 220 is 12 p², on a glide averaging FULL.
			const p = 80 / 220;
			const had = 12 * p * p * FULL;
			s.hold(765, 220);
			f.run(1);
			expect(f.at() - at).toBeCloseTo(had * 16 + ((FULL - had) * 16 * 16) / (2 * 220), 2);
		});

		it('takes over a wheel’s approach at the speed it has', () => {
			const f = fake();
			const s = new SmoothScroll(f.host);
			s.by(1000);
			f.run(1);
			const at = f.at();
			const had = (1000 - at) / 40;
			s.hold(765, 220);
			f.run(1);
			expect(f.at() - at).toBeCloseTo(had * 16 + ((FULL - had) * 16 * 16) / (2 * 220), 6);
		});

		it('a glide or a notch mid-ramp takes over as it always has', () => {
			const f = fake();
			const s = new SmoothScroll(f.host);
			s.hold(765, 220);
			f.run(5);
			const at = f.at();
			s.glide(100, 160);
			f.run();
			expect(f.at()).toBeCloseTo(at + 100, 6);
			s.hold(765, 220);
			f.run(5);
			const on = f.at();
			s.by(100);
			f.run();
			expect(f.at()).toBeCloseTo(on + 100, 6);
		});
	});

	it('a fresh press after a hold still adds a whole step', () => {
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

	it('never glides the wrong way first, when a frame is stamped before the key', () => {
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

	it('never holds the wrong way first, when a frame is stamped before the key', () => {
		// The held path's delta is a rAF timestamp minus start()'s now(), which
		// under load can be negative: 12 ms before the key moved a downward hold
		// -41.7 px (the review's reproduction), and in Chromium a held ↑ went
		// down on its first frame in 6 of 8 tries, by up to 94 px.
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
		s.hold(765, 220);
		// Stamped 12 ms before the key, then on as usual.
		queue.shift()!(now - 12);
		for (let i = 0; i < 100 && queue.length; i++) queue.shift()!((now += 16));
		// Downward: never above where it began.
		expect(Math.min(...seen)).toBeGreaterThanOrEqual(500);
		// And up: never below where it began.
		const top = y;
		s.stop();
		seen.length = 0;
		s.hold(-765, 220);
		queue.shift()!(now - 12);
		for (let i = 0; i < 100 && queue.length; i++) queue.shift()!((now += 16));
		expect(Math.max(...seen)).toBeLessThanOrEqual(top);
		expect(y).toBeLessThan(top);
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

describe('keeping the place across a clamp', () => {
	afterEach(() => vi.unstubAllGlobals());

	/** A window whose position a shrinking document has already clamped. */
	function clamped() {
		const events = new EventTarget();
		const scrolls: number[] = [];
		vi.stubGlobal(
			'window',
			Object.assign(events, { scrollBy: (_: number, dy: number) => void scrolls.push(dy) })
		);
		return { events, scrolls };
	}

	it('says the scroll and the content’s move apart, typed, on one event', () => {
		const { events, scrolls } = clamped();
		const heard: Event[] = [];
		events.addEventListener(KEPT_PLACE, (e) => heard.push(e));
		// The browser clamped the window 300 px when a chapter above went: the
		// content moved 200, the app scrolls 500 less than it would have.
		keepPlaceBy(-300, 200);
		expect(scrolls).toEqual([-300]);
		expect(heard).toHaveLength(1);
		const e = heard[0] as KeptPlace;
		expect(e).toBeInstanceOf(KeptPlace);
		expect(e.detail).toBe(-300);
		expect(e.moved).toBe(200);
	});

	it('takes the one number as both when nothing clamped', () => {
		const { events } = clamped();
		let e: KeptPlace | undefined;
		events.addEventListener(KEPT_PLACE, (x) => (e = x as KeptPlace));
		keepPlaceBy(120);
		expect([e?.detail, e?.moved]).toEqual([120, 120]);
	});

	it('a glide’s timeline takes the content’s move, and ends at its aim', () => {
		const f = fake();
		const s = new SmoothScroll(f.host);
		f.scrollTo(5000);
		s.glide(765, 220);
		f.run(3);
		// A chapter above went: the content moved up 1000, the window was clamped
		// and the app's scroll came to 900 of it, leaving the window's truth.
		f.scrollTo(f.at() - 900);
		s.shift(-1000);
		f.run();
		// The aim moved with the content (the timeline is the content's), not the scroll.
		expect(f.at()).toBe(5000 + 765 - 1000);
	});

	it('a clamp past the end keeps the aim inside the document', () => {
		const f = fake(1000);
		const s = new SmoothScroll(f.host);
		f.scrollTo(800);
		s.by(150);
		f.run(1);
		s.shift(5000);
		f.run();
		expect(f.at()).toBe(1000);
	});
});

describe('where the strip is going', () => {
	it('is the glide’s aim while it moves, and where the strip is at rest', () => {
		const f = fake();
		const s = new SmoothScroll(f.host);
		expect(s.aim).toBe(0);
		s.glide(500, 200);
		expect(s.aim).toBe(500);
		f.run();
		expect(s.aim).toBe(500);
		f.scrollTo(800);
		expect(s.aim).toBe(800);
	});
});

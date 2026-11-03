import { describe, expect, it } from 'vitest';
import {
	cubicBezier,
	depthOf,
	easeDrawer,
	easeOut,
	leaveFrame,
	screenMove
} from '../src/lib/motion';
import { pressMode, SINK_MAX_W } from '../src/lib/press';

/** Motion's decisions (doc/MOTION.md, card c396); the feel itself is motion.e2e.ts's. */

describe('cubicBezier', () => {
	it('starts at 0 and ends at 1, whatever is asked outside', () => {
		expect(easeOut(0)).toBe(0);
		expect(easeOut(1)).toBe(1);
		expect(easeOut(-1)).toBe(0);
		expect(easeOut(2)).toBe(1);
	});

	it('is the identity for a straight line', () => {
		const linear = cubicBezier(0, 0, 1, 1);
		for (const t of [0.1, 0.25, 0.5, 0.9]) expect(linear(t)).toBeCloseTo(t, 4);
	});

	it('front-loads an ease-out: most of the way there early', () => {
		expect(easeOut(0.25)).toBeGreaterThan(0.6);
		expect(easeDrawer(0.5)).toBeGreaterThan(0.8);
	});

	it('only climbs', () => {
		let last = 0;
		for (let i = 1; i <= 100; i++) {
			const y = easeDrawer(i / 100);
			expect(y).toBeGreaterThanOrEqual(last);
			last = y;
		}
	});

	it('falls back to bisection where the slope is flat', () => {
		// Flat at both ends in x: Newton's step has nothing to divide by.
		const flat = cubicBezier(0, 0.5, 1, 0.5);
		expect(flat(0.001)).toBeGreaterThan(0);
		expect(flat(0.5)).toBeCloseTo(0.5, 3);
	});
});

describe('leaveFrame', () => {
	it('fades what faded in', () => {
		expect(leaveFrame('fade', 0.25, false, false)).toBe('opacity: 0.75;');
	});

	it('slides a sheet down, opaque', () => {
		expect(leaveFrame('down', 0.5, false, false)).toBe('translate: 0 50%;');
	});

	it('slides a sheet right on a TV, where sheets are panels', () => {
		expect(leaveFrame('down', 1, false, true)).toBe('translate: 100% 0;');
		expect(leaveFrame('right', 0.5, false, false)).toBe('translate: 50% 0;');
	});

	it('shrinks a dialog a little as it fades, never to nothing', () => {
		expect(leaveFrame('pop', 1, false, false)).toBe('opacity: 0; scale: 0.96;');
	});

	it('keeps only the fade under reduced motion', () => {
		for (const kind of ['down', 'right', 'pop'] as const)
			expect(leaveFrame(kind, 0.5, true, false)).toBe('opacity: 0.5;');
	});
});

describe('screenMove', () => {
	const nav = (
		from: string | null,
		to: string | null,
		more: Partial<Parameters<typeof screenMove>[0]> = {}
	) => screenMove({ type: 'link', from, to, covered: false, ...more });

	it('counts depth by the path', () => {
		expect(depthOf('/')).toBe(0);
		expect(depthOf('/history')).toBe(1);
		expect(depthOf('/series/[id]')).toBe(2);
	});

	it('pushes deeper screens and pulls shallower ones', () => {
		expect(nav('/', '/series/[id]')).toBe('forward');
		expect(nav('/series/[id]', '/')).toBe('back');
	});

	it('fades into and out of a reader, which is fixed to the screen', () => {
		expect(nav('/series/[id]', '/read/[entry]')).toBe('fade');
		expect(nav('/read/[entry]', '/series/[id]', { type: 'popstate', delta: -1 })).toBe('fade');
	});

	it('fades between screens side by side', () => {
		expect(nav('/history', '/downloads')).toBe('fade');
	});

	it("doesn't move the same screen: tabs, filters, the next chapter", () => {
		expect(nav('/', '/')).toBeNull();
		expect(nav('/read/[entry]', '/read/[entry]')).toBeNull();
	});

	it("doesn't move without both ends", () => {
		expect(nav(null, '/')).toBeNull();
		expect(nav('/', null)).toBeNull();
	});

	it('follows history', () => {
		expect(nav('/series/[id]', '/', { type: 'popstate', delta: -1 })).toBe('back');
		expect(nav('/', '/series/[id]', { type: 'popstate', delta: 1 })).toBe('forward');
		expect(nav('/', '/series/[id]', { type: 'popstate' })).toBe('fade');
	});

	it('only crossfades onto an outline already showing the next screen', () => {
		expect(nav('/', '/series/[id]', { covered: true })).toBe('fade');
	});
});

describe('pressMode', () => {
	const vp = { width: 1000, height: 800 };

	it('does what the element asks', () => {
		const box = { width: 10, height: 10 };
		expect(pressMode('off', null, box, vp)).toBeNull();
		expect(pressMode('scale', null, box, vp)).toBe('scale');
		expect(pressMode('fill', null, box, vp)).toBe('fill');
		expect(pressMode('both', null, { width: 900, height: 700 }, vp)).toBe('both');
	});

	it('leaves surfaces the size of the screen alone: scrims, tap zones', () => {
		expect(pressMode(null, null, { width: 1000, height: 800 }, vp)).toBeNull();
		expect(pressMode(null, null, { width: 600, height: 400 }, vp)).toBeNull();
	});

	it('sinks a switch without inverting it', () => {
		expect(pressMode(null, 'switch', { width: 48, height: 28 }, vp)).toBe('scale');
	});

	it('inverts and sinks small things, and only inverts wide rows', () => {
		expect(pressMode(null, null, { width: SINK_MAX_W, height: 48 }, vp)).toBe('both');
		expect(pressMode(null, null, { width: SINK_MAX_W + 1, height: 48 }, vp)).toBe('fill');
	});
});

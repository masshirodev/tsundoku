import { describe, expect, it } from 'vitest';
import { askedLine, destinationOf, fillOf, nextChangeIn, phaseAt } from '$lib/waiting';

describe('phaseAt', () => {
	it('follows the design’s scale: pressed, line at 150 ms, outline at 1 s, stalled at 10 s', () => {
		expect(phaseAt(null)).toBe('idle');
		expect(phaseAt(0)).toBe('pressed');
		expect(phaseAt(149)).toBe('pressed');
		expect(phaseAt(150)).toBe('line');
		expect(phaseAt(999)).toBe('line');
		expect(phaseAt(1000)).toBe('outline');
		expect(phaseAt(9999)).toBe('outline');
		expect(phaseAt(10_000)).toBe('stalled');
	});

	it('wakes exactly when the phase changes, then once a second while stalled', () => {
		expect(nextChangeIn(0)).toBe(150);
		expect(nextChangeIn(400)).toBe(600);
		expect(nextChangeIn(5000)).toBe(5000);
		expect(nextChangeIn(12_000)).toBe(1000);
	});
});

describe('fillOf', () => {
	it('moves only with bytes that arrived, and never without a length', () => {
		expect(fillOf(0, 1000)).toBe(0);
		expect(fillOf(250, 1000)).toBe(0.25);
		expect(fillOf(2000, 1000)).toBe(1);
		expect(fillOf(500, 0)).toBe(0);
	});
});

describe('destinationOf', () => {
	const u = (s: string) => new URL(s, 'https://x');
	it('tells the screens that wait differently apart', () => {
		expect(destinationOf(u('/series/42?from=all'), '/series/[id]')).toEqual({
			kind: 'series',
			id: 42
		});
		expect(destinationOf(u('/?shelf=all'), '/')).toEqual({ kind: 'library' });
		expect(destinationOf(u('/?tag=artist:Seo%20Haram'), '/')).toEqual({
			kind: 'person',
			tag: 'artist:Seo Haram'
		});
		expect(destinationOf(u('/history'), '/history')).toEqual({ kind: 'history' });
		expect(destinationOf(u('/search?q=x'), '/search')).toEqual({ kind: 'search' });
		expect(destinationOf(u('/read/1'), '/read/[entry]')).toEqual({ kind: 'other' });
	});

	it('says how long it has been asking', () => {
		expect(askedLine(12_400)).toBe('ASKED 12 S AGO · STILL ASKING');
	});
});

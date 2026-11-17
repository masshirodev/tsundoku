import { describe, expect, it } from 'vitest';
import { GUESS_WAIT_MS, guessStep, type Guessing } from '../src/lib/reader/strip-guess.ts';

/** A screen 800 px tall and a step of 720 px: the middle is 400 px below the top. */
const VIEW = 800;
const STEP = 720;
const page = (top: number, height = VIEW, waited = 0): Guessing => ({
	top,
	bottom: top + height,
	waited
});

describe('a key step over pages still guessing their size', () => {
	it('goes the whole step when nothing is guessing', () => {
		expect(guessStep([], 0, STEP, VIEW)).toEqual({ by: STEP, stop: null });
	});

	it('goes the whole step when the guess is beyond it', () => {
		// The middle lands at 1120, inside a page that ends at 1500: not crossed.
		expect(guessStep([page(700)], 0, STEP, VIEW)).toEqual({ by: STEP, stop: null });
	});

	it('stops at the top of a page it would carry the middle past', () => {
		// A guess from 500 to 1000 (shorter than a screen, as before the min
		// height): the middle would go from 400 to 1120, over all of it.
		expect(guessStep([page(500, 500)], 0, STEP, VIEW)).toEqual({ by: 500, stop: 0 });
	});

	it('does not move when the reader already stands in that page', () => {
		// Inside the guess, its bottom within the step: held where it is.
		expect(guessStep([page(0)], 300, STEP, VIEW)).toEqual({ by: 0, stop: 0 });
	});

	it('lets a page already read past by a wheel go', () => {
		// The page's bottom is above the middle: it is behind the reader.
		expect(guessStep([page(0, 300)], 0, STEP, VIEW)).toEqual({ by: STEP, stop: null });
	});

	it('releases a page that has held for its limit, and no sooner', () => {
		const near = (waited: number) => [page(200, 500, waited)];
		expect(guessStep(near(GUESS_WAIT_MS - 1), 0, STEP, VIEW).stop).toBe(0);
		expect(guessStep(near(GUESS_WAIT_MS), 0, STEP, VIEW)).toEqual({ by: STEP, stop: null });
	});

	it('asks every page in the path, not only the first', () => {
		// The first guess hung past its limit; the one after it, also crossed
		// by this step, has not held yet and stops it (the review's medium).
		const pages = [page(100, 200, GUESS_WAIT_MS), page(300, 300)];
		expect(guessStep(pages, 0, STEP, VIEW)).toEqual({ by: 300, stop: 1 });
	});
});

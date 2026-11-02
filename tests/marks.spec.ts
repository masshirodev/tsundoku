import { describe, expect, it } from 'vitest';
import { chooseMarks, saneRange, withinBounds, type MarkRow } from '$lib/library/marks';

// The opening and ending a player uses (doc/ANIME.md, "Openings and endings";
// card c239): the source's own timestamps beat AniSkip's, and both beat a
// fingerprint's. Each part is chosen on its own, since a finder may know one.

const row = (
	method: MarkRow['method'],
	intro: [number, number] | null,
	ending: [number, number] | null
): MarkRow => ({
	method,
	intro: intro ? { start: intro[0], end: intro[1] } : null,
	ending: ending ? { start: ending[0], end: ending[1] } : null
});

describe('an episode’s marks', () => {
	it('takes the source’s opening and ending over every other finder', () => {
		const chosen = chooseMarks(
			[
				row('source', [85, 175], [1290, 1380]),
				row('aniskip', [90, 180], [1300, 1390]),
				row('fingerprint', [80, 170], [1280, 1370])
			],
			1440
		);
		expect(chosen).toEqual({
			intro: { start: 85, end: 175 },
			ending: { start: 1290, end: 1380 },
			introFrom: 'source',
			endingFrom: 'source'
		});
	});

	it('lets AniSkip fill only what the source left empty', () => {
		const chosen = chooseMarks(
			[row('source', [85, 175], null), row('aniskip', [90, 180], [1300, 1390])],
			1440
		);
		expect(chosen.intro).toEqual({ start: 85, end: 175 });
		expect(chosen.introFrom).toBe('source');
		expect(chosen.ending).toEqual({ start: 1300, end: 1390 });
		expect(chosen.endingFrom).toBe('aniskip');
	});

	it('falls through to a fingerprint for a part the others don’t know', () => {
		const chosen = chooseMarks(
			[row('aniskip', null, null), row('fingerprint', [20, 50], [1400, 1430])],
			1440
		);
		expect(chosen.intro).toEqual({ start: 20, end: 50 });
		expect(chosen.introFrom).toBe('fingerprint');
		expect(chosen.ending).toEqual({ start: 1400, end: 1430 });
	});

	it('ignores a mark that runs past the episode, or backwards', () => {
		const chosen = chooseMarks(
			[row('source', [2000, 2100], [100, 50]), row('aniskip', [85, 175], [1290, 1380])],
			1440
		);
		expect(chosen.introFrom).toBe('aniskip');
		expect(chosen.endingFrom).toBe('aniskip');
		expect(saneRange({ start: 10, end: 10 }, 1440)).toBe(false);
		expect(saneRange({ start: -1, end: 10 }, 1440)).toBe(false);
		expect(saneRange({ start: 10, end: 60 }, 1440)).toBe(true);
		// Without a known length any positive span is still a span.
		expect(saneRange({ start: 10, end: 5000 }, null)).toBe(true);
	});

	it('keeps a fingerprint’s opening and ending inside the sane lengths', () => {
		expect(withinBounds({ start: 0, end: 14 }, 15, 120)).toBe(false);
		expect(withinBounds({ start: 0, end: 15 }, 15, 120)).toBe(true);
		expect(withinBounds({ start: 0, end: 120 }, 15, 120)).toBe(true);
		expect(withinBounds({ start: 0, end: 121 }, 15, 120)).toBe(false);
		expect(withinBounds({ start: 0, end: 180 }, 15, 180)).toBe(true);
	});
});

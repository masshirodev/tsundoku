import { describe, expect, it } from 'vitest';
import { hitBlock, outlined, rings, shownBlocks } from '$lib/japanese/blocks';
import { ocrLines, type OcrPlace } from '$lib/japanese/ocr';
import { parseSearch } from '$lib/library/search';
import type { TextBlock } from '$lib/japanese/ocr';

const block = (box: [number, number, number, number]): TextBlock => ({
	box,
	vertical: true,
	lines: ['テスト']
});

describe('text blocks on a page', () => {
	const blocks = [block([0.6, 0.05, 0.2, 0.1]), block([0.1, 0.4, 0.2, 0.1])];

	it('outlines with the controls by default, always, or never', () => {
		expect(outlined('controls', true)).toBe(true);
		expect(outlined('controls', false)).toBe(false);
		expect(outlined('always', false)).toBe(true);
		expect(outlined('never', true)).toBe(false);
	});

	it('keeps each block where it is on an uncropped page', () => {
		expect(shownBlocks(blocks, null).map((b) => b.index)).toEqual([0, 1]);
		expect(shownBlocks(null, null)).toEqual([]);
	});

	it('moves blocks with a crop, and drops one outside what is shown', () => {
		// A 10% border cropped from the left and right: x 0.6 of the page is 0.625 of what's left.
		const shown = shownBlocks(blocks, [0, 0.1, 0, 0.1]);
		expect(shown[0].box[0]).toBeCloseTo(0.625);
		expect(shownBlocks([block([0.01, 0.4, 0.05, 0.1])], [0, 0, 0, 0.2])).toEqual([]);
	});

	it('finds the block under a tap, the smallest where two overlap', () => {
		const shown = shownBlocks([block([0.1, 0.1, 0.5, 0.5]), block([0.2, 0.2, 0.1, 0.1])], null);
		expect(hitBlock(shown, 0.25, 0.25)?.index).toBe(1);
		expect(hitBlock(shown, 0.5, 0.5)?.index).toBe(0);
		expect(hitBlock(shown, 0.9, 0.9)).toBeNull();
	});

	it('rings every block while outlined, and the one looked up in any case', () => {
		const shown = shownBlocks(blocks, null);
		expect(rings(shown, true, null)).toHaveLength(2);
		expect(rings(shown, false, 1)).toEqual([{ box: blocks[1].box, selected: true }]);
		expect(rings(shown, false, null)).toEqual([]);
	});
});

describe("the series screen's OCR row", () => {
	const place = (p: Partial<OcrPlace>): OcrPlace => ({
		japanese: true,
		done: 41,
		total: 58,
		ahead: 0,
		next: 'CH. 42',
		failed: 0,
		running: true,
		notText: 0,
		...p
	});

	it('says running, with a bar, while the workstation reads it', () => {
		const l = ocrLines(place({}));
		expect(l.a).toBe('41 OF 58 CHAPTERS');
		expect(l.b).toBe('RUNNING ON THE WORKSTATION · CH. 42 NEXT');
		expect(l.bar).toBeCloseTo(41 / 58);
	});

	it('says queued behind other series', () => {
		const l = ocrLines(place({ done: 0, ahead: 2, running: false }));
		expect(l).toMatchObject({
			a: '0 OF 58 CHAPTERS · QUEUED',
			b: 'WAITING FOR 2 SERIES ON THE WORKSTATION',
			bar: null
		});
	});

	it('has no second line once done', () => {
		expect(ocrLines(place({ done: 58, ahead: null }))).toMatchObject({
			a: '58 OF 58 CHAPTERS',
			b: null
		});
	});

	it('offers OCR on a series not seen as Japanese', () => {
		expect(ocrLines(place({ japanese: false }))).toMatchObject({
			a: 'NOT DETECTED AS JAPANESE',
			offer: true
		});
	});

	it("says which chapters didn't read", () => {
		expect(ocrLines(place({ ahead: null, failed: 3, running: false })).b).toBe(
			"3 DIDN'T READ · TRIED AGAIN IN A WEEK"
		);
	});
});

describe('/words', () => {
	it('is a command, exact like the others', () => {
		expect(parseSearch('/words')).toEqual({ type: 'command', command: 'words' });
		expect(parseSearch('words')).toEqual({ type: 'query', text: 'words' });
	});
});

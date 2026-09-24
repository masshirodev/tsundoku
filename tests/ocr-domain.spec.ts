import { describe, expect, it } from 'vitest';
import { blockAt, blocksOf, blockText, pageIndexOf } from '$lib/japanese/ocr';

describe('OCR blocks', () => {
	const page = {
		img_path: '0003.jpg',
		img_width: 1000,
		img_height: 2000,
		blocks: [
			{
				box: [100, 200, 300, 600] as [number, number, number, number],
				vertical: true,
				lines: ['やっぱ', 'かっけェ']
			},
			{ box: [0, 0, 10, 10] as [number, number, number, number], vertical: false, lines: ['  '] }
		]
	};

	it('become fractions of the page, and empty ones are dropped', () => {
		expect(blocksOf(page)).toEqual([
			{ box: [0.1, 0.1, 0.2, 0.2], vertical: true, lines: ['やっぱ', 'かっけェ'] }
		]);
		expect(blocksOf({ ...page, img_width: 0 })).toEqual([]);
	});

	it('know their page from the name the worker gave it', () => {
		expect(pageIndexOf('0003.jpg')).toBe(3);
		expect(pageIndexOf('batch/12/0120.png')).toBe(120);
		expect(pageIndexOf('cover.jpg')).toBeNull();
	});

	it('are found under a tap, the smallest when they overlap', () => {
		const outer = {
			box: [0.1, 0.1, 0.5, 0.5] as [number, number, number, number],
			vertical: true,
			lines: ['a']
		};
		const inner = {
			box: [0.2, 0.2, 0.1, 0.1] as [number, number, number, number],
			vertical: true,
			lines: ['b']
		};
		expect(blockAt([outer, inner], 0.25, 0.25)).toBe(inner);
		expect(blockAt([outer, inner], 0.5, 0.5)).toBe(outer);
		expect(blockAt([outer, inner], 0.9, 0.9)).toBeNull();
		expect(blockText({ box: [0, 0, 1, 1], vertical: true, lines: ['やっぱ', 'かっけェ'] })).toBe(
			'やっぱかっけェ'
		);
	});
});

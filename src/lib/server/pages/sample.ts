import { crc32, deflateSync } from 'node:zlib';

/**
 * Pages for the sample library `yarn run seed` writes, which has no image
 * files: a generated PNG per page, so the reader can be developed and tested
 * against something that turns, loads and lays out like a chapter. Paper
 * ground, a panel grid tinted by the series, and the page number drawn in
 * block digits, so a screenshot says which page it shows. Every seventh page
 * is a double-width spread, for landscape.
 *
 * Only series whose path starts with `sample:` use this (src/lib/server/fixtures.ts).
 */
export const SAMPLE_PREFIX = 'sample:';

export function sampleSize(page: number): { w: number; h: number } {
	return page > 0 && page % 7 === 6 ? { w: 1600, h: 1136 } : { w: 800, h: 1136 };
}

// 3x5 block digits.
const DIGITS = [
	'111101101101111',
	'010110010010111',
	'111001111100111',
	'111001111001111',
	'101101111001001',
	'111100111001111',
	'111100111101111',
	'111001001001001',
	'111101111101111',
	'111101111001111'
];

function hsl(h: number, s: number, l: number): [number, number, number] {
	const a = s * Math.min(l, 1 - l);
	const f = (n: number) => {
		const k = (n + h / 30) % 12;
		return Math.round(255 * (l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1))));
	};
	return [f(0), f(8), f(4)];
}

function chunk(type: string, data: Buffer): Buffer {
	const len = Buffer.alloc(4);
	len.writeUInt32BE(data.length);
	const td = Buffer.concat([Buffer.from(type, 'ascii'), data]);
	const crc = Buffer.alloc(4);
	crc.writeUInt32BE(crc32(td) >>> 0);
	return Buffer.concat([len, td, crc]);
}

const cache = new Map<string, Buffer>();

/** PNG for page `page` (0-based) of a sample series tinted `hue`. */
export function samplePage(hue: number, page: number): Buffer {
	const key = `${hue}:${page}`;
	const hit = cache.get(key);
	if (hit) return hit;
	const { w, h } = sampleSize(page);
	const paper: [number, number, number] = [242, 240, 234];
	const ink: [number, number, number] = [21, 21, 21];
	const tint = hsl(hue, 0.25, 0.72);
	const rows = Buffer.alloc((w * 3 + 1) * h);
	const set = (x: number, y: number, c: [number, number, number]) => {
		const o = y * (w * 3 + 1) + 1 + x * 3;
		rows[o] = c[0];
		rows[o + 1] = c[1];
		rows[o + 2] = c[2];
	};
	const rect = (x0: number, y0: number, x1: number, y1: number, c: [number, number, number]) => {
		for (let y = Math.max(0, y0); y < Math.min(h, y1); y++)
			for (let x = Math.max(0, x0); x < Math.min(w, x1); x++) set(x, y, c);
	};
	rect(0, 0, w, h, paper);
	// Panels: a layout that changes with the page, bordered in ink.
	const m = 40;
	const split = [0.34, 0.5, 0.62][page % 3];
	const panels: [number, number, number, number][] = [
		[m, m, w - m, Math.round(h * split) - 8],
		[m, Math.round(h * split) + 8, Math.round(w * 0.5) - 8, h - m],
		[Math.round(w * 0.5) + 8, Math.round(h * split) + 8, w - m, h - m]
	];
	for (const [x0, y0, x1, y1] of panels) {
		rect(x0, y0, x1, y1, ink);
		rect(x0 + 3, y0 + 3, x1 - 3, y1 - 3, tint);
	}
	// The page number, 1-based, centred in the first panel.
	const label = String(page + 1);
	const cell = 22;
	const width = label.length * 4 * cell - cell;
	let x = Math.round((w - width) / 2);
	const y = Math.round(h * split * 0.5) - (5 * cell) / 2;
	rect(x - cell, y - cell, x + width + cell, y + 6 * cell, paper);
	for (const ch of label) {
		const bits = DIGITS[Number(ch)];
		for (let i = 0; i < 15; i++)
			if (bits[i] === '1')
				rect(
					x + (i % 3) * cell,
					y + Math.floor(i / 3) * cell,
					x + (i % 3) * cell + cell,
					y + Math.floor(i / 3) * cell + cell,
					ink
				);
		x += 4 * cell;
	}
	const ihdr = Buffer.alloc(13);
	ihdr.writeUInt32BE(w, 0);
	ihdr.writeUInt32BE(h, 4);
	ihdr[8] = 8; // bit depth
	ihdr[9] = 2; // RGB
	const png = Buffer.concat([
		Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
		chunk('IHDR', ihdr),
		chunk('IDAT', deflateSync(rows, { level: 6 })),
		chunk('IEND', Buffer.alloc(0))
	]);
	if (cache.size > 300) cache.delete(cache.keys().next().value!);
	cache.set(key, png);
	return png;
}

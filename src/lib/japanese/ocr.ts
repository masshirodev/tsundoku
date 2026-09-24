/**
 * OCR'd text on a page (doc/JAPANESE.md). Pure: the worker
 * (src/lib/server/japanese/ocr.ts) runs mokuro and stores what these make of
 * its output; the reader draws from the same shape.
 */

/** One speech bubble or caption. */
export type TextBlock = {
	/** Left, top, width, height: fractions of the page, so any size it's drawn at fits. */
	box: [number, number, number, number];
	vertical: boolean;
	/** The lines, top to bottom (or right to left, vertical), as read. */
	lines: string[];
};

/** A page as mokuro 0.2 writes it in a `.mokuro` file. */
export type MokuroPage = {
	img_path: string;
	img_width: number;
	img_height: number;
	blocks: { box: [number, number, number, number]; vertical: boolean; lines: string[] }[];
};

const round = (n: number) => Math.round(n * 10000) / 10000;

/** A mokuro page's blocks, in fractions of the page; empty ones dropped. */
export function blocksOf(page: MokuroPage): TextBlock[] {
	const w = page.img_width;
	const h = page.img_height;
	if (!(w > 0 && h > 0)) return [];
	return page.blocks
		.map((b): TextBlock => {
			const [x1, y1, x2, y2] = b.box;
			return {
				box: [round(x1 / w), round(y1 / h), round((x2 - x1) / w), round((y2 - y1) / h)],
				vertical: !!b.vertical,
				lines: b.lines.map((l) => l.trim()).filter(Boolean)
			};
		})
		.filter((b) => b.lines.length > 0 && b.box[2] > 0 && b.box[3] > 0);
}

/**
 * The page a mokuro page is: the worker names each page by its index
 * (`0012.png` is page 12, 0-based). Null for anything else.
 */
export function pageIndexOf(imgPath: string): number | null {
	const m = /(?:^|\/)(\d+)\.[a-z0-9]+$/i.exec(imgPath);
	return m ? Number(m[1]) : null;
}

/** The block under a point on the page (fractions), the smallest if they overlap. */
export function blockAt(blocks: TextBlock[], x: number, y: number): TextBlock | null {
	let hit: TextBlock | null = null;
	for (const b of blocks) {
		const [bx, by, bw, bh] = b.box;
		if (x < bx || y < by || x > bx + bw || y > by + bh) continue;
		if (!hit || bw * bh < hit.box[2] * hit.box[3]) hit = b;
	}
	return hit;
}

/** A block's text as one run, for the tokenizer: its lines joined. */
export const blockText = (b: TextBlock) => b.lines.join('');

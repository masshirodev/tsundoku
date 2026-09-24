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

/** Where a series stands with OCR on the workstation (src/lib/server/japanese/ocr.ts). */
export type OcrPlace = {
	japanese: boolean;
	done: number;
	total: number;
	/** Series ahead of it in the queue; null when none of its chapters wait. */
	ahead: number | null;
	/** Its first chapter waiting: "CH. 42". */
	next: string | null;
	/** Chapters that didn't read, waiting a week to be tried again. */
	failed: number;
	/** A run is on the GPU, and this series is first. */
	running: boolean;
};

/**
 * The series screen's OCR row (Index Japanese 4a): two lines, a bar while
 * running, and OCR offered when the series isn't seen as Japanese.
 */
export function ocrLines(p: OcrPlace): {
	a: string;
	b: string | null;
	bar: number | null;
	offer: boolean;
} {
	if (!p.japanese)
		return {
			a: 'NOT DETECTED AS JAPANESE',
			b: 'OCR MAKES THE PAGES LOOKUP-READY',
			bar: null,
			offer: true
		};
	const count = `${p.done} OF ${p.total} CHAPTERS`;
	if (p.total === 0) return { a: 'NO CHAPTERS DOWNLOADED', b: null, bar: null, offer: false };
	if (p.done >= p.total) return { a: count, b: null, bar: null, offer: false };
	if (p.ahead === null)
		return {
			a: count,
			b: `${p.failed} DIDN'T READ · TRIED AGAIN IN A WEEK`,
			bar: null,
			offer: false
		};
	if (p.ahead > 0)
		return {
			a: `${count} · QUEUED`,
			b: `WAITING FOR ${p.ahead} SERIES ON THE WORKSTATION`,
			bar: null,
			offer: false
		};
	const next = p.next ? ` · ${p.next} NEXT` : '';
	return p.running
		? { a: count, b: `RUNNING ON THE WORKSTATION${next}`, bar: p.done / p.total, offer: false }
		: { a: count, b: `NEXT ON THE WORKSTATION · EVERY HALF HOUR`, bar: null, offer: false };
}

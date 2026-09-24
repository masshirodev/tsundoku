import type { Inset } from '$lib/reader/crop';
import { boxInCrop } from './panel';
import type { TextBlock } from './ocr';

/**
 * Text blocks on a page as the reader shows them (doc/JAPANESE.md, "The tap
 * rule"). Pure: the image reader draws and hit-tests from these.
 */

/** READING's BLOCKS row: when the blocks are outlined. Default WITH CONTROLS. */
export type BlocksShown = 'controls' | 'always' | 'never';

export const outlined = (shown: BlocksShown, controls: boolean) =>
	shown === 'always' || (shown === 'controls' && controls);

/** A block where it's drawn: its box in fractions of what's shown of the page. */
export type ShownBlock = { index: number; box: [number, number, number, number] };

/** A page's blocks in what's shown of it, once a crop takes the border off. */
export function shownBlocks(blocks: TextBlock[] | null, inset: Inset | null): ShownBlock[] {
	const out: ShownBlock[] = [];
	(blocks ?? []).forEach((b, index) => {
		const box = boxInCrop(b.box, inset);
		if (box) out.push({ index, box });
	});
	return out;
}

/** The block under a point (fractions of what's shown), the smallest where they overlap. */
export function hitBlock(shown: ShownBlock[], x: number, y: number): ShownBlock | null {
	let hit: ShownBlock | null = null;
	for (const b of shown) {
		const [bx, by, bw, bh] = b.box;
		if (x < bx || y < by || x > bx + bw || y > by + bh) continue;
		if (!hit || bw * bh < hit.box[2] * hit.box[3]) hit = b;
	}
	return hit;
}

/** An outline to draw: the selected block in the accent, the rest in ink. */
export type Ring = { box: [number, number, number, number]; selected: boolean };

export function rings(shown: ShownBlock[], all: boolean, selected: number | null): Ring[] {
	return shown
		.filter((b) => all || b.index === selected)
		.map((b) => ({ box: b.box, selected: b.index === selected }));
}

/**
 * A key step on the strip over pages still guessing their size (c913;
 * doc/READER.md, "A page still guessing its size").
 *
 * A page whose size the reader does not know (read online, or stored but not
 * measurable by the manifest) is drawn at another page's shape until its image
 * arrives. On a strip narrower than the screen that box can be well under a
 * screen tall, so one ↓ crossed a whole page a slow source had not sent, and
 * `Strip`'s `reshaped` then kept the wrong page under the middle. The strip
 * draws such a page at least a screen tall, and a forward key step goes no
 * further than putting the first page it would cross at the top of the screen.
 */

/**
 * How long the reader waits at one page that never loads before the keys go
 * on past it: a source that hangs must not end a chapter on a TV, which has no
 * wheel or thumb to go round it. It counts from the first step that page held,
 * not from the chapter's mount, so a page reached late still holds.
 */
export const GUESS_WAIT_MS = 10_000;

/** A page still guessing, in document coordinates, and how long a step has waited at it. */
export interface Guessing {
	top: number;
	bottom: number;
	/** Milliseconds since this page first held a step; 0 if it never has. */
	waited: number;
}

/**
 * How far a forward step of `step` from `from` (the strip's aim, the top of
 * the screen) may go, and which page stopped it. `pages` are the strip's
 * guessing pages in order, `view` the screen's height. A page whose bottom is
 * already above the middle of the screen has been read past (a wheel, a thumb)
 * and holds nothing; a page the step would carry the middle of the screen past
 * stops it, with its top at the top of the screen, unless it has held for
 * `GUESS_WAIT_MS` already. Every page in the step's path is asked, not only
 * the first: a hung one released lets the next still stop the step.
 */
export function guessStep(
	pages: readonly Guessing[],
	from: number,
	step: number,
	view: number
): { by: number; stop: number | null } {
	const middle = from + view / 2;
	for (let k = 0; k < pages.length; k++) {
		const p = pages[k];
		if (p.bottom <= middle) continue;
		if (p.bottom >= middle + step) break;
		if (p.waited >= GUESS_WAIT_MS) continue;
		return { by: Math.max(0, Math.min(step, p.top - from)), stop: k };
	}
	return { by: step, stop: null };
}

import { getDb } from '$lib/server/db';
import { kindFacts } from '$lib/library/kinds';
import type { Kind } from '$lib/library/types';
import type { TextDirection } from '$lib/reader/text';

/**
 * A novel's reading direction, kept per series (card c440; doc/TEXT-READER.md,
 * "Direction"): `series.text_direction`, rung 69. NULL is the default, L→R,
 * so remembering L→R clears it rather than storing what NULL already means.
 * Its own column: `series.direction` already holds a novel's layout.
 */

/** The series' direction: its own, else L→R. */
export function textDirectionOf(seriesId: number): TextDirection {
	const row = getDb().prepare(`SELECT text_direction FROM series WHERE id = ?`).get(seriesId) as
		{ text_direction: string | null } | undefined;
	return row?.text_direction === 'rtl' ? 'rtl' : 'ltr';
}

/** REMEMBER on the text reader's DIRECTION row. */
export function setTextDirection(seriesId: number, direction: TextDirection): void {
	getDb()
		.prepare(`UPDATE series SET text_direction = ? WHERE id = ?`)
		.run(direction === 'ltr' ? null : direction, seriesId);
}

/** Only a book of text turns its pages this way; a comic has its own DIRECTION. */
export const takesTextDirection = (kind: Kind) => kindFacts(kind).medium === 'text';

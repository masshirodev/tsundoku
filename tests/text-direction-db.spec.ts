import { beforeAll, describe, expect, it } from 'vitest';

// Before anything imports db.ts: getDb() reads this once and memoises.
process.env.DATABASE_PATH = ':memory:';

const { getDb } = await import('$lib/server/db');
const { seedSample } = await import('$lib/server/fixtures');
const lib = await import('$lib/server/library');
const dir = await import('../src/routes/read/[entry]/text-direction.server');
const { KINDS } = await import('$lib/library/kinds');

/**
 * A novel's reading direction, stored (card c440; rung 69,
 * `series.text_direction`): the series' own, else L→R, with L→R stored as
 * NULL, and only a book of text takes one.
 */
beforeAll(() => {
	seedSample(getDb(), Date.UTC(2026, 8, 22));
});

const idOf = (title: string) => lib.listSeries({ reveal: true }).find((s) => s.title === title)!.id;
const stored = (id: number) =>
	(
		getDb().prepare(`SELECT text_direction FROM series WHERE id = ?`).get(id) as {
			text_direction: string | null;
		}
	).text_direction;

describe('a novel’s reading direction', () => {
	it('is L→R until the owner says otherwise, with nothing stored', () => {
		const id = idOf('Mushoku Tensei');
		expect(stored(id)).toBeNull();
		expect(dir.textDirectionOf(id)).toBe('ltr');
	});

	it('keeps R→L, and REMEMBER L→R puts back the NULL that means the default', () => {
		const id = idOf('Mushoku Tensei');
		const layout = getDb().prepare(`SELECT direction FROM series WHERE id = ?`).get(id);
		dir.setTextDirection(id, 'rtl');
		expect(stored(id)).toBe('rtl');
		expect(dir.textDirectionOf(id)).toBe('rtl');
		// The layout, in `direction`, is untouched: the two are separate columns.
		expect(getDb().prepare(`SELECT direction FROM series WHERE id = ?`).get(id)).toEqual(layout);
		dir.setTextDirection(id, 'ltr');
		expect(stored(id)).toBeNull();
		expect(dir.textDirectionOf(id)).toBe('ltr');
	});

	it('is a missing series’ default, not an error', () => {
		expect(dir.textDirectionOf(999_999)).toBe('ltr');
	});

	it('is taken by a book of text only, asked of the kinds registry', () => {
		// Every kind there is, not a hand-picked few.
		expect(KINDS.filter((k) => dir.takesTextDirection(k))).toEqual(['novel']);
	});
});

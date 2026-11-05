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

describe('a novel’s reading direction through GROUP and TAKE OUT (c551)', () => {
	const books = () => import('$lib/server/books');
	const novels = ['Villainess Level 99', 'Tensei Shitara Ken Deshita', 'Honzuki no Gekokujou'];
	// Each case on a fresh seed: GROUP and TAKE OUT rename and re-make series.
	const reset = () => {
		const db = getDb();
		db.exec(`DELETE FROM works; DELETE FROM work_dismissals; DELETE FROM roots;
			DELETE FROM collections; DELETE FROM tags; DELETE FROM scan_jobs;
			DELETE FROM suggestion_dismissals; DELETE FROM person_favourites; DELETE FROM history_removed;
			DELETE FROM tracker_accounts;`);
		seedSample(db, Date.UTC(2026, 8, 22));
	};

	it('a group of volumes reads R→L when its first volume did, and each volume taken out reads R→L again', async () => {
		const { groupIntoSeries, takeOutVolumes } = await books();
		reset();
		const [a, b] = novels.map(idOf);
		dir.setTextDirection(a, 'rtl');
		const { seriesId } = groupIntoSeries({ seriesIds: [a, b], name: 'Grouped R→L' });
		expect(stored(seriesId)).toBe('rtl');
		expect(dir.textDirectionOf(seriesId)).toBe('rtl');
		const out = takeOutVolumes(seriesId);
		expect(out).toHaveLength(2);
		expect(out.map(stored)).toEqual(['rtl', 'rtl']);
	});

	it('takes a later volume’s R→L when the first has none: NULL is the default, not a choice to keep', async () => {
		const { groupIntoSeries } = await books();
		reset();
		const [a, b, c] = novels.map(idOf);
		dir.setTextDirection(c, 'rtl');
		const { seriesId } = groupIntoSeries({ seriesIds: [a, b, c], name: 'Third is R→L' });
		expect(stored(seriesId)).toBe('rtl');
	});

	it('stays the default when no volume has a direction of its own', async () => {
		const { groupIntoSeries, takeOutVolumes } = await books();
		reset();
		const [a, b] = novels.map(idOf);
		const { seriesId } = groupIntoSeries({ seriesIds: [a, b], name: 'Plain' });
		expect(stored(seriesId)).toBeNull();
		expect(takeOutVolumes(seriesId).map(stored)).toEqual([null, null]);
	});

	it('a volume joining a series keeps the series’ own direction, as it keeps its layout', async () => {
		const { groupIntoSeries } = await books();
		reset();
		const [a, b, c] = novels.map(idOf);
		const { seriesId } = groupIntoSeries({ seriesIds: [a, b], name: 'Joined' });
		dir.setTextDirection(c, 'rtl');
		groupIntoSeries({ seriesIds: [c], into: seriesId });
		expect(stored(seriesId)).toBeNull();
		dir.setTextDirection(seriesId, 'rtl');
		expect(stored(seriesId)).toBe('rtl');
	});
});

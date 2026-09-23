import { beforeAll, describe, expect, it } from 'vitest';

// Before anything imports db.ts: getDb() reads this once and memoises.
process.env.DATABASE_PATH = ':memory:';

const { getDb } = await import('$lib/server/db');
const { seedSample } = await import('$lib/server/fixtures');
const lib = await import('$lib/server/library');
const series = await import('$lib/server/series');

beforeAll(() => {
	seedSample(getDb(), Date.UTC(2026, 8, 22));
});

const idOf = (title: string) => lib.listSeries({ reveal: true }).find((s) => s.title === title)!.id;

describe('the series page', () => {
	it('reads metadata, tags and every entry in order', () => {
		const s = series.seriesPage(idOf('Tower of God'), false)!;
		expect(s.altTitles).toEqual(['신의 탑', 'Sin-ui Tap']);
		expect(s.source).toBe('mihon');
		expect(s.entries).toHaveLength(600);
		expect(s.entries.map((e) => e.number).slice(0, 3)).toEqual([1, 2, 3]);
		expect(s.entries[593]).toMatchObject({
			number: 594,
			readAt: null,
			pageCount: 54,
			lastPosition: 11
		});
	});

	it('is unreachable while hidden and reveal is off, like a series that does not exist', () => {
		const hidden = idOf('Kōhai no Himitsu Nikki');
		expect(series.seriesPage(hidden, false)).toBeNull();
		expect(series.seriesPage(hidden, true)).not.toBeNull();
		expect(series.seriesPage(999_999, true)).toBeNull();
	});
});

describe('marking entries', () => {
	it('changes exactly the entries that were not already in that state', () => {
		const id = idOf('Kusuriya no Hitorigoto');
		const s = series.seriesPage(id, false)!;
		const read = s.entries[0].id; // already read
		const unread = s.entries[40].id;
		expect(series.markEntries(id, [read, unread], true)).toBe(1);
		expect(series.markEntries(id, [read, unread], false)).toBe(2);
		expect(series.markEntries(id, [read], true)).toBe(1);
	});

	it('cannot reach into another series', () => {
		const a = idOf('Kusuriya no Hitorigoto');
		const other = series.seriesPage(idOf('Dungeon Meshi'), false)!.entries[0].id;
		expect(series.markEntries(a, [other], false)).toBe(0);
	});
});

describe('direction', () => {
	it('stores the owner’s choice and clears back to the default', () => {
		const id = idOf('Sousou no Frieren');
		series.setDirection(id, 'ltr');
		expect(series.seriesPage(id, false)!.direction).toBe('ltr');
		series.setDirection(id, null);
		expect(series.seriesPage(id, false)!.direction).toBeNull();
	});
});

describe('tags', () => {
	it('adds a tag once, reusing an existing spelling, and removes it', () => {
		const id = idOf('Dungeon Meshi');
		series.addTag(id, { namespace: 'genre', value: 'isekai' });
		series.addTag(id, { namespace: 'genre', value: 'isekai' });
		const tags = series.seriesPage(id, false)!.tags.filter((t) => t.value === 'isekai');
		expect(tags).toEqual([{ namespace: 'genre', value: 'isekai' }]);
		const { n } = getDb()
			.prepare(`SELECT COUNT(*) AS n FROM tags WHERE value = 'isekai'`)
			.get() as { n: number };
		expect(n).toBe(1);
		expect(series.removeTag(id, { namespace: 'genre', value: 'isekai' })).toBe(1);
	});

	it('suggests existing tags by prefix, marking the ones already on this series', () => {
		const id = idOf('Drawing: Saikyou Mangaka wa Oekaki Skill de Isekai Musou Suru');
		const sugg = series.suggestTags(id, { namespace: 'genre', value: 'is' }, false);
		expect(sugg[0]).toMatchObject({ namespace: 'genre', value: 'isekai', onThis: true });
		expect(sugg[0].count).toBeGreaterThan(1);
	});

	it('does not count hidden series in suggestions while reveal is off', () => {
		const hidden = idOf('Kōhai no Himitsu Nikki');
		series.addTag(hidden, { namespace: 'circle', value: 'secret-circle' });
		const other = idOf('Dungeon Meshi');
		expect(series.suggestTags(other, { namespace: 'circle', value: 'secret' }, false)).toEqual([]);
		expect(
			series.suggestTags(other, { namespace: 'circle', value: 'secret' }, true)[0]?.count
		).toBe(1);
	});
});

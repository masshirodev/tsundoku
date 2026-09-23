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

describe('markReadThrough', () => {
	it('reads a chapter and everything before it, and returns only what changed', () => {
		const id = idOf('Dungeon Meshi');
		const s = series.seriesPage(id, false)!;
		const through = s.entries[5];
		const already = s.entries
			.slice(0, 6)
			.filter((e) => e.readAt !== null)
			.map((e) => e.id);
		const changed = series.markReadThrough(id, through.id);
		expect(changed.sort()).toEqual(
			s.entries
				.slice(0, 6)
				.map((e) => e.id)
				.filter((x) => !already.includes(x))
				.sort()
		);
		const after = series.seriesPage(id, false)!.entries;
		expect(after.slice(0, 6).every((e) => e.readAt !== null)).toBe(true);
		expect(after[6].readAt).toBe(s.entries[6].readAt);
		// UNDO puts back exactly those.
		series.markEntries(id, changed, false);
		expect(series.seriesPage(id, false)!.entries.map((e) => e.readAt !== null)).toEqual(
			s.entries.map((e) => e.readAt !== null)
		);
	});

	it('cannot reach into another series', () => {
		const other = series.seriesPage(idOf('Tower of God'), false)!.entries[3].id;
		expect(series.markReadThrough(idOf('Dungeon Meshi'), other)).toEqual([]);
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

describe('the reading log', () => {
	const events = (seriesId: number) =>
		getDb()
			.prepare(
				`SELECT kind, entry_id, page, duration_ms FROM reading_events WHERE series_id = ? ORDER BY id`
			)
			.all(seriesId) as {
			kind: string;
			entry_id: number;
			page: number | null;
			duration_ms: number;
		}[];

	// After the seed's own reading, which ends on 2026-09-22.
	const T = Date.UTC(2026, 8, 23);

	it('moves progress and appends the event together', () => {
		const id = idOf('Chainsaw Man');
		const entry = series.seriesPage(id, false)!.entries[198];
		const before = events(id).length; // the seed's own past reading
		series.recordReading({ seriesId: id, entryId: entry.id, kind: 'open', page: 0, now: T + 1000 });
		series.recordReading({
			seriesId: id,
			entryId: entry.id,
			kind: 'page',
			page: 5,
			durationMs: 42_000,
			now: T + 2000
		});
		series.recordReading({
			seriesId: id,
			entryId: entry.id,
			kind: 'finish',
			page: 23,
			durationMs: 90_000,
			now: T + 3000
		});
		const after = series.seriesPage(id, false)!.entries[198];
		expect(after).toMatchObject({ lastPosition: 23, lastOpenedAt: T + 3000, readAt: T + 3000 });
		expect(events(id).slice(before)).toEqual([
			{ kind: 'open', entry_id: entry.id, page: 0, duration_ms: 0 },
			{ kind: 'page', entry_id: entry.id, page: 5, duration_ms: 42_000 },
			{ kind: 'finish', entry_id: entry.id, page: 23, duration_ms: 90_000 }
		]);
	});

	it('logs an event read offline at its own time, without moving progress back', () => {
		const id = idOf('Chainsaw Man');
		const entry = series.seriesPage(id, false)!.entries[198];
		// Already opened later than the replayed event.
		series.recordReading({
			seriesId: id,
			entryId: entry.id,
			kind: 'page',
			page: 20,
			now: T + 9000
		});
		series.recordReading({ seriesId: id, entryId: entry.id, kind: 'page', page: 7, now: T + 8000 });
		const after = series.seriesPage(id, false)!.entries[198];
		expect(after).toMatchObject({ lastPosition: 20, lastOpenedAt: T + 9000 });
		expect(events(id).at(-1)).toMatchObject({ kind: 'page', page: 7 });
	});

	it('refuses an entry that belongs to another series, writing nothing', () => {
		const a = idOf('Chainsaw Man');
		const other = series.seriesPage(idOf('Dungeon Meshi'), false)!.entries[0].id;
		const before = events(a).length;
		expect(() => series.recordReading({ seriesId: a, entryId: other, kind: 'open' })).toThrow();
		expect(events(a)).toHaveLength(before);
	});

	it('logs manual marks as marks, one per entry that actually changed', () => {
		const id = idOf('Boku no Kokoro no Yabai Yatsu');
		const s = series.seriesPage(id, false)!;
		const read = s.entries[0].id;
		const unread = s.entries[159].id;
		const before = events(id).length;
		series.markEntries(id, [read, unread], true);
		expect(events(id).slice(before)).toEqual([
			{ kind: 'mark_read', entry_id: unread, page: null, duration_ms: 0 }
		]);
	});
});

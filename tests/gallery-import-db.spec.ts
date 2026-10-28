import { describe, expect, it } from 'vitest';
import type { MihonBackup, MihonManga } from '$lib/import/mihon-backup';

// Before anything imports db.ts: getDb() reads this once and memoises.
process.env.DATABASE_PATH = ':memory:';

const { getDb } = await import('$lib/server/db');
const { ensureRoot, writeSeries } = await import('$lib/server/import/write');
const { planMihon } = await import('$lib/import/mihon-plan');
const { listSeries } = await import('$lib/server/library');

// c124: a gallery from a Mihon source is a ONE-OFF, not a one-chapter series.
const manga = (source: string, title: string, chapter: string): MihonManga => ({
	source,
	url: `/${title}/`,
	title,
	artist: '',
	author: '',
	description: '',
	genres: [],
	status: 2,
	thumbnailUrl: '',
	dateAdded: 1_750_000_000_000,
	viewer: 0,
	chapters: [
		{
			url: `/${title}/1`,
			name: chapter,
			scanlator: '',
			read: false,
			bookmark: false,
			lastPageRead: 0,
			dateFetch: 1_750_000_000_000,
			dateUpload: 0,
			number: chapter === 'Chapter 1' ? 1 : -1,
			sourceOrder: 0
		}
	],
	categories: [],
	favorite: true,
	history: [],
	trackers: []
});

const backup: MihonBackup = {
	categories: [],
	sources: new Map([
		['1', 'NHentai'],
		['2', 'Asura Scans']
	]),
	manga: [manga('1', 'A Gallery', 'Chapter'), manga('2', 'A New Series', 'Chapter 1')]
};

const db = getDb();
const root = ensureRoot(db, 'Mihon', '/nowhere/Mihon', false);
for (const s of planMihon(backup, [], 1_800_000_000_000).series)
	writeSeries(s, { rootId: root, jobId: null, now: 1_800_000_000_000, markMissing: false }, db);

const shelf = (s: string) => listSeries({ reveal: true, shelf: s }).map((c) => c.title);

describe('a gallery from a Mihon source', () => {
	it('is on ONE-OFF, and a new series with one chapter so far stays on SERIES', () => {
		expect(shelf('oneoff')).toEqual(['A Gallery']);
		expect(shelf('series')).toEqual(['A New Series']);
	});
});

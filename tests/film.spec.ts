import { describe, expect, it } from 'vitest';
import { filmAction, filmCountLine, filmDownloadRow, kindRow } from '$lib/library/film';

/**
 * A film's screen, the pure part, in the design's words.
 */

const NOW = Date.UTC(2026, 10, 12);
const film = (o: Partial<Parameters<typeof filmAction>[0][number]> = {}) => ({
	id: 1,
	readAt: null,
	lastPosition: null,
	lastOpenedAt: null,
	available: false,
	episode: { durationS: null },
	...o
});

describe('the one primary cell', () => {
	it('PLAY with the length, TMDB’s until the file is measured', () => {
		expect(filmAction([film()], 118, NOW)).toMatchObject({
			label: 'PLAY',
			meta: '1 H 58',
			quiet: false,
			progress: null
		});
		expect(filmAction([film({ episode: { durationS: 7020 } })], 118, NOW).meta).toBe('1 H 57');
		expect(filmAction([film()], null, NOW).meta).toBe('');
	});

	it('CONTINUE with what is left, and the 3px line’s share', () => {
		const a = filmAction(
			[film({ lastPosition: 76 * 60, episode: { durationS: 118 * 60 } })],
			118,
			NOW
		);
		expect(a).toMatchObject({
			label: 'CONTINUE · 42 MIN LEFT',
			meta: '1 H 16 OF 1 H 58',
			quiet: false
		});
		expect(a.progress).toBeCloseTo(76 / 118, 5);
	});

	it('watched, the cell goes quiet and says when', () => {
		expect(filmAction([film({ readAt: Date.UTC(2026, 10, 3, 20) })], 118, NOW)).toMatchObject({
			label: 'WATCH AGAIN',
			meta: 'WATCHED 3 NOV',
			quiet: true
		});
	});
});

describe('the count line', () => {
	it('is the year, the runtime and the genre, and WATCHED once it is', () => {
		const tmdb = { year: 2024, runtime: 118 };
		expect(
			filmCountLine({ tmdb, source: 'Movies Mod', files: 1, genre: 'Drama', watched: false })
		).toBe('2024 · 1 H 58 · DRAMA');
		expect(
			filmCountLine({ tmdb, source: 'Movies Mod', files: 1, genre: 'Drama', watched: true })
		).toBe('2024 · 1 H 58 · DRAMA · WATCHED');
	});

	it('closes up with no TMDB link: FILM · <SOURCE> · 1 FILE, nothing marked unknown', () => {
		expect(
			filmCountLine({ tmdb: null, source: 'Movies Mod', files: 1, genre: 'Drama', watched: false })
		).toBe('FILM · MOVIES MOD · 1 FILE');
	});
});

describe('the DOWNLOAD row of one file', () => {
	it('says where that file is, and nothing else', () => {
		expect(filmDownloadRow({ state: 'none', bytes: 1.19e9, height: 1080 })).toEqual({
			title: 'Not on this computer',
			meta: '1 FILE · 1080P · 1.19 GB',
			cell: 'DOWNLOAD'
		});
		expect(filmDownloadRow({ state: 'queued', ahead: 2, bytes: 1.19e9 })).toEqual({
			title: 'Queued',
			meta: '2 AHEAD OF IT · 1.19 GB',
			cell: 'CANCEL'
		});
		expect(
			filmDownloadRow({ state: 'downloading', done: 0.35, bytes: 1.19e9, leftS: 360 })
		).toEqual({
			title: 'Downloading · 35%',
			meta: '417 MB OF 1.19 GB · 6 MIN LEFT',
			cell: 'CANCEL'
		});
		expect(filmDownloadRow({ state: 'failed', why: "The source's link had expired" })).toEqual({
			title: 'Failed',
			meta: "THE SOURCE'S LINK HAD EXPIRED",
			cell: 'TRY AGAIN'
		});
		expect(filmDownloadRow({ state: 'here', bytes: 1.19e9, height: 1080 })).toEqual({
			title: 'On this computer',
			meta: '1 FILE · 1.19 GB',
			cell: null
		});
	});
});

describe('the KIND row', () => {
	it('names the kind and its folder', () => {
		expect(kindRow({ kind: 'movie', folder: 'Movies', files: 1 })).toEqual({
			title: 'Movie',
			meta: 'MOVIES/ · 1 FILE'
		});
	});
});

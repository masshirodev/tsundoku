import { describe, expect, it } from 'vitest';
import { ago, chapterReached, progressToSend, statusFrom, statusTo } from '$lib/library/tracking';
import {
	partOf,
	partsLabel,
	partsOf,
	seasonPlan,
	seasonSearchTitle,
	seasonsOf,
	watchedReached
} from '$lib/library/anime';

describe('status', () => {
	it('reads each catalogue’s word as tsundoku’s, and back', () => {
		expect(statusFrom('anilist', 'CURRENT')).toBe('reading');
		expect(statusFrom('anilist', 'REPEATING')).toBe('reading');
		expect(statusFrom('anilist', 'PAUSED')).toBe('on_hold');
		expect(statusFrom('mal', 'plan_to_read')).toBe('planning');
		// MAL's anime list says the same statuses in its own words (c298).
		expect(statusFrom('mal', 'watching')).toBe('reading');
		expect(statusFrom('mal', 'plan_to_watch')).toBe('planning');
		expect(statusFrom('mal', null)).toBeNull();
		expect(statusTo('anilist', 'on_hold')).toBe('PAUSED');
		expect(statusTo('mal', 'planning')).toBe('plan_to_read');
	});

	it('writes an anime to MAL in its anime list’s words (c240)', () => {
		expect(statusTo('mal', 'reading', 'anime')).toBe('watching');
		expect(statusTo('mal', 'planning', 'anime')).toBe('plan_to_watch');
		// Everything else is the same word on both lists.
		expect(statusTo('mal', 'on_hold', 'anime')).toBe('on_hold');
		expect(statusTo('mal', 'completed', 'anime')).toBe('completed');
		expect(statusTo('mal', 'dropped', 'anime')).toBe('dropped');
		// AniList's words do not differ by kind, and a manga keeps its own.
		expect(statusTo('anilist', 'reading', 'anime')).toBe('CURRENT');
		expect(statusTo('mal', 'reading', 'manga')).toBe('reading');
		expect(statusTo('mal', 'reading', 'novel')).toBe('reading');
	});
});

describe('progress', () => {
	it('is the highest chapter read, extras rounded down', () => {
		expect(chapterReached([{ position: 3 }, { position: 12.5 }, { position: 7 }])).toBe(12);
		expect(chapterReached([])).toBe(0);
	});

	it('is sent only forward: never a chapter the list has passed, nor one already waiting', () => {
		expect(
			progressToSend({ reached: 188, remote: { progress: 187, status: 'reading' }, waiting: null })
		).toEqual({
			progress: 188,
			status: null
		});
		expect(
			progressToSend({ reached: 180, remote: { progress: 187, status: 'reading' }, waiting: null })
		).toBeNull();
		expect(progressToSend({ reached: 188, remote: null, waiting: 188 })).toBeNull();
		expect(progressToSend({ reached: 0, remote: null, waiting: null })).toBeNull();
	});

	it('starts a series READING when it isn’t on the list, or only planned; any other status is the owner’s', () => {
		expect(progressToSend({ reached: 3, remote: null, waiting: null })?.status).toBe('reading');
		expect(
			progressToSend({ reached: 3, remote: { progress: 0, status: 'planning' }, waiting: null })
				?.status
		).toBe('reading');
		expect(
			progressToSend({ reached: 3, remote: { progress: 1, status: 'on_hold' }, waiting: null })
				?.status
		).toBeNull();
	});

	it('finishes the entry with its last counted episode, once (c240)', () => {
		// The season's last episode: the progress and COMPLETED in one send.
		expect(progressToSend({ reached: 12, remote: null, waiting: null, complete: true })).toEqual({
			progress: 12,
			status: 'completed'
		});
		// Already completed there: nothing to send, however many passes run.
		expect(
			progressToSend({
				reached: 12,
				remote: { progress: 12, status: 'completed' },
				waiting: null,
				complete: true
			})
		).toBeNull();
		// The list is ahead of us: the status alone, never a lower progress.
		expect(
			progressToSend({
				reached: 12,
				remote: { progress: 12, status: 'reading' },
				waiting: null,
				complete: true
			})
		).toEqual({ progress: null, status: 'completed' });
		// A part not yet finished keeps the ordinary rule.
		expect(progressToSend({ reached: 11, remote: null, waiting: null, complete: false })).toEqual({
			progress: 11,
			status: 'reading'
		});
		// ON HOLD and DROPPED are the owner's, the last episode too: the progress
		// goes, the status stays -- and with the progress already there, nothing.
		for (const status of ['on_hold', 'dropped'] as const) {
			expect(
				progressToSend({
					reached: 12,
					remote: { progress: 8, status },
					waiting: null,
					complete: true
				})
			).toEqual({ progress: 12, status: null });
			expect(
				progressToSend({
					reached: 12,
					remote: { progress: 12, status },
					waiting: null,
					complete: true
				})
			).toBeNull();
		}
		// PLANNING is not one of them: the first episode already moved it to WATCHING.
		expect(
			progressToSend({
				reached: 12,
				remote: { progress: 0, status: 'planning' },
				waiting: null,
				complete: true
			})
		).toEqual({ progress: 12, status: 'completed' });
	});
});

describe('a season (c240)', () => {
	const ep = (season: number, number: number, readAt: number | null, note: '' | 'recap' = '') => ({
		id: number * 100 + season,
		number,
		label: `Episode ${number}`,
		readAt,
		lastPosition: null,
		lastOpenedAt: null,
		episode: { durationS: 1440, season, number, note, thumb: '', endingAt: null }
	});

	it('counts each season’s own episodes, and the furthest watched one', () => {
		const rows = [ep(1, 1, 1), ep(1, 2, 1), ep(2, 1, null), ep(2, 2, 1), ep(2, 3, null)];
		expect(seasonsOf(rows).map((s) => [s.season, s.from, s.to, s.aired, s.watched])).toEqual([
			[1, 1, 2, 2, 2],
			[2, 1, 3, 3, 1]
		]);
		expect(watchedReached(rows, { season: 1 })).toBe(2);
		expect(watchedReached(rows, { season: 2, from: 1, to: 1 })).toBe(0);
		expect(watchedReached(rows, { season: 2, from: 2, to: 3 })).toBe(2);
	});

	it('never sends a recap or a half number', () => {
		const rows = [ep(3, 14, 1), ep(3, 14.5, 1, 'recap'), ep(3, 15, 1)];
		expect(watchedReached(rows, { season: 3 })).toBe(15);
		expect(watchedReached([ep(3, 14.5, 1, 'recap')], { season: 3 })).toBe(0);
		// A recap with a whole number of its own is no episode a catalogue counts.
		expect(watchedReached([ep(3, 14, 1), ep(3, 15, 1, 'recap')], { season: 3 })).toBe(14);
	});

	it('splits a season into parts at the first entry’s count', () => {
		expect(
			partsOf(
				[
					{ part: 1, episodes: 12 },
					{ part: 2, episodes: 11 }
				],
				23
			)
		).toEqual([
			{ part: 1, from: 1, to: 12 },
			{ part: 2, from: 13, to: 23 }
		]);
		expect(partsOf([{ part: 1, episodes: 24 }], 24)).toEqual([{ part: 1, from: 1, to: 24 }]);
		expect(
			partOf(
				partsOf(
					[
						{ part: 1, episodes: 12 },
						{ part: 2, episodes: 11 }
					],
					23
				),
				15
			)
		).toEqual({
			part: 2,
			number: 3
		});
	});

	it('folds round the season being watched, and never a fold of one', () => {
		expect(seasonPlan([1, 2, 3], 2, false)).toEqual([
			{ type: 'line', season: 1 },
			{ type: 'line', season: 2 },
			{ type: 'line', season: 3 }
		]);
		expect(seasonPlan([1, 2, 3, 4], 3, false)).toEqual([
			{ type: 'fold', above: true, seasons: [1, 2] },
			{ type: 'line', season: 3 },
			{ type: 'line', season: 4 }
		]);
		expect(seasonPlan([1, 2, 3, 4], 1, false)).toEqual([
			{ type: 'line', season: 1 },
			{ type: 'fold', above: false, seasons: [2, 3, 4] }
		]);
		expect(seasonPlan([1, 2, 3, 4], 2, true)).toEqual([
			{ type: 'toggle', seasons: [1, 2, 3, 4], expanded: true },
			{ type: 'line', season: 1 },
			{ type: 'line', season: 2 },
			{ type: 'line', season: 3 },
			{ type: 'line', season: 4 }
		]);
	});

	it('asks for a season’s own title, and says where an entry is', () => {
		expect(seasonSearchTitle('Sword Art Online', 1)).toBe('Sword Art Online');
		expect(seasonSearchTitle('Sword Art Online', 3)).toBe('Sword Art Online Season 3');
		expect(
			partsLabel(
				partsOf(
					[
						{ part: 1, episodes: 12 },
						{ part: 2, episodes: 11 }
					],
					23
				)
			)
		).toBe('PART 1 · EP. 1 – 12 · PART 2 · EP. 13 – 23');
		expect(partsLabel(partsOf([{ part: 1, episodes: 24 }], 24))).toBe('');
	});
});

describe('the TRACKING row’s clock', () => {
	const now = Date.UTC(2026, 8, 25, 14, 20);

	it('counts time the way the row says it', () => {
		expect(ago(now - 30_000, now)).toBe('JUST NOW');
		expect(ago(now - 3 * 3600_000, now)).toBe('3 H AGO');
		expect(ago(now - 3 * 24 * 3600_000, now)).toBe('3 D AGO');
	});
});

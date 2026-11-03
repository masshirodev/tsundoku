import { describe, expect, it } from 'vitest';
import {
	ago,
	chapterReached,
	progressToSend,
	seasonLine,
	statusFrom,
	statusTo,
	trackLine,
	type SeasonFact,
	type SeasonTrackFacts,
	type TrackFacts
} from '$lib/library/tracking';
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

	it('says a season’s line in the row’s own words', () => {
		const facts = (
			o: Partial<SeasonFact> = {},
			service: 'anilist' | 'mal' = 'anilist'
		): SeasonFact => ({
			service,
			part: 1,
			of: 24,
			signedIn: true,
			linked: true,
			state: { status: 'reading', progress: 8, score: 7 },
			waiting: null,
			sentAt: 1_000,
			...o
		});
		const now = 1_000 + 12 * 60_000;
		const base: SeasonTrackFacts = {
			season: 3,
			part: 1,
			parts: [{ part: 1, from: 1, to: 24 }],
			facts: [facts(), facts({}, 'mal')],
			other: null,
			linked: true,
			waits: null
		};
		expect(seasonLine(base, { now, offline: false })).toMatchObject({
			left: 'WATCHING · EP. 8 OF 24 · 7',
			right: 'ANILIST AND MAL · SENT 12 MIN AGO'
		});
		// MAL said only where it differs.
		expect(
			seasonLine(
				{
					...base,
					facts: [facts(), facts({ state: { status: 'reading', progress: 6, score: 7 } }, 'mal')]
				},
				{ now, offline: false }
			).right
		).toContain('MAL AT EP. 6');
		// A season with no link says so, and nothing is sent.
		expect(
			seasonLine({ ...base, linked: false, facts: [] }, { now, offline: false })
		).toMatchObject({
			left: 'NOT LINKED · NOTHING SENT'
		});
		// Not on the list yet.
		expect(
			seasonLine({ ...base, facts: [facts({ state: null })] }, { now, offline: false })
		).toMatchObject({ left: 'NOT ON YOUR LIST', right: 'ADDED ON ITS FIRST EPISODE' });
		// A failed send is its season's, in ink.
		expect(
			seasonLine(
				{
					...base,
					facts: [
						facts({
							state: null,
							waiting: { progress: 9, failedAt: now, error: 'ANILIST DID NOT ANSWER' }
						})
					]
				},
				{ now, offline: false }
			)
		).toMatchObject({ left: 'EP. 9 NOT SENT', alert: true });
		// Past the entry's count, with no part 2.
		expect(
			seasonLine(
				{
					...base,
					facts: [facts({ state: null })],
					waits: { episode: 13, of: 12, service: 'anilist' }
				},
				{ now, offline: false }
			)
		).toMatchObject({ left: 'EP. 13 WAITS', right: 'ANILIST LISTS 12' });
	});
});

describe('the TRACKING row', () => {
	const now = Date.UTC(2026, 8, 25, 14, 20);
	const f = (o: Partial<TrackFacts>): TrackFacts => ({
		service: 'anilist',
		signedIn: true,
		linked: true,
		state: { status: 'reading', progress: 187, score: 9 },
		waiting: null,
		sentAt: now - 12 * 60_000,
		...o
	});
	const opts = { now, offline: false, mainIsEmpty: false };

	it('says what the list has, and when it was sent (1k)', () => {
		expect(trackLine(f({}), opts)).toMatchObject({
			left: 'ANILIST · READING · CH. 187 · 9',
			right: 'SENT 12 MIN AGO',
			strong: true
		});
		expect(trackLine(f({ service: 'mal' }), opts)).toMatchObject({ strong: false });
	});

	it('says what didn’t go, and why (1n)', () => {
		const l = trackLine(
			f({ service: 'mal', waiting: { progress: 187, failedAt: now, error: 'MAL DID NOT ANSWER' } }),
			opts
		);
		expect(l.left).toBe('MAL · CH. 187 NOT SENT');
		expect(l.right).toMatch(/^MAL DID NOT ANSWER · \d\d:\d\d$/);
		expect(l.alert).toBe(true);
	});

	it('says when a catalogue isn’t signed in, or the series isn’t on its list (1o, 1p)', () => {
		expect(trackLine(f({ service: 'mal', signedIn: false, state: null }), opts).left).toBe(
			'MAL · NOT SIGNED IN'
		);
		expect(trackLine(f({ state: null, sentAt: null }), opts)).toMatchObject({
			left: 'ANILIST · NOT ON YOUR LIST',
			right: 'ADDED ON THE NEXT CHAPTER READ'
		});
		expect(
			trackLine(
				f({ service: 'mal', sentAt: null, state: { status: 'on_hold', progress: 52, score: 7 } }),
				{
					...opts,
					mainIsEmpty: true
				}
			)
		).toMatchObject({
			left: 'MAL · ON HOLD · CH. 52 · 7',
			right: 'SHOWN · ANILIST HAS NOTHING',
			strong: true
		});
	});

	it('offline, says as of when (1q)', () => {
		expect(trackLine(f({}), { ...opts, offline: true }).right).toMatch(/^AS OF \d\d:\d\d$/);
	});

	it('counts time the way the row says it', () => {
		expect(ago(now - 30_000, now)).toBe('JUST NOW');
		expect(ago(now - 3 * 3600_000, now)).toBe('3 H AGO');
		expect(ago(now - 3 * 24 * 3600_000, now)).toBe('3 D AGO');
	});
});

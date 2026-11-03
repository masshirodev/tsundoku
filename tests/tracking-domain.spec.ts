import { describe, expect, it } from 'vitest';
import {
	ago,
	chapterReached,
	progressToSend,
	statusFrom,
	statusTo,
	trackLine,
	type TrackFacts
} from '$lib/library/tracking';

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

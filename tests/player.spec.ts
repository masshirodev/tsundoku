import { describe, expect, it } from 'vitest';
import { nearFrame } from '../src/routes/read/[entry]/seek-preview';
import {
	spriteTile,
	cleanVolume,
	verticalFraction,
	KEY_STEP,
	bufferedTo,
	challengeScale,
	CHROME_MOVE_PX,
	cueAt,
	deviceLang,
	isTap,
	leftLabel,
	movedEnough,
	nextServer,
	offerNextAt,
	openAt,
	parseVtt,
	pictureClick,
	placeLabel,
	playingLabel,
	preferredLang,
	startTracks,
	seekFor,
	stallStep,
	stallClock,
	stallElapsed,
	NO_STALL,
	type StallClock,
	type StallEvent,
	subtitlePx,
	TAP_SLOP_PX
} from '$lib/library/player';

// The player's decisions (doc/ANIME.md, "The player").
describe('subtitles', () => {
	const vtt = [
		'WEBVTT',
		'',
		'1',
		'00:00:01.000 --> 00:00:03.000',
		"There's a town past <i>this</i> ridge",
		'',
		'00:02.500 --> 00:04.000 line:90%',
		'that neither of us &amp; has seen.'
	].join('\n');

	it('are WebVTT’s cues without their markup, overlapping ones together', () => {
		const cues = parseVtt(vtt);
		expect(cues).toEqual([
			{ start: 1, end: 3, text: "There's a town past this ridge" },
			{ start: 2.5, end: 4, text: 'that neither of us & has seen.' }
		]);
		expect(cueAt(cues, 0.5)).toBeNull();
		expect(cueAt(cues, 1.2)).toBe("There's a town past this ridge");
		expect(cueAt(cues, 2.7)).toBe("There's a town past this ridge\nthat neither of us & has seen.");
		expect(cueAt(cues, 4)).toBeNull();
	});

	it('are sized per device, S M L', () => {
		expect([subtitlePx('S', 30), subtitlePx('M', 30), subtitlePx('L', 30)]).toEqual([24, 30, 38]);
	});
});

describe('an episode', () => {
	it('opens where it stopped, unless it counts as watched', () => {
		const e = { lastPosition: 568, readAt: null, durationS: 1440, endingAt: 1290 };
		expect(openAt(e)).toEqual({ at: 568, resumed: true });
		expect(openAt({ ...e, lastPosition: 1300 })).toEqual({ at: 0, resumed: false });
		expect(openAt({ ...e, readAt: 1 })).toEqual({ at: 0, resumed: false });
		expect(openAt({ ...e, lastPosition: 2 })).toEqual({ at: 0, resumed: false });
		// No timestamps: the last 3 %.
		expect(openAt({ ...e, endingAt: null, lastPosition: 1400 })).toEqual({ at: 0, resumed: false });
		expect(openAt({ ...e, durationS: null, lastPosition: 1400 })).toEqual({
			at: 1400,
			resumed: true
		});
	});

	it('offers the next from its ending, or 5 s before the end', () => {
		expect(offerNextAt(1440, 1290)).toBe(1290);
		expect(offerNextAt(1440, null)).toBe(1435);
		expect(offerNextAt(1440, 1500)).toBe(1435);
	});

	it('seeks 10 s a double-tap and 10 more each tap after', () => {
		expect([seekFor(2), seekFor(3), seekFor(5)]).toEqual([10, 20, 40]);
	});

	it('brings the controls back on a move, not on a jitter, and a click is not a drag', () => {
		const at = { x: 100, y: 100 };
		// The mouse resting on a desk: a pixel or two is not a move.
		expect(movedEnough(at, { x: 101, y: 102 })).toBe(false);
		expect(movedEnough(at, { x: 100 + CHROME_MOVE_PX, y: 100 })).toBe(true);
		expect(movedEnough(at, { x: 106, y: 108 })).toBe(false);
		expect(movedEnough(at, { x: 109, y: 109 })).toBe(true);
		expect(movedEnough(at, { x: 100, y: 100 })).toBe(false);
		// A press that wandered is a drag, and neither a tap nor a play/pause.
		expect(isTap(null, at)).toBe(true);
		expect(isTap(at, { x: 102, y: 101 })).toBe(true);
		expect(isTap(at, { x: 100, y: 100 + TAP_SLOP_PX + 1 })).toBe(false);
		// A mouse plays or pauses; a finger shows or hides the controls.
		expect([pictureClick('mouse'), pictureClick('touch')]).toEqual(['toggle', 'chrome']);
	});

	it('names its place and what’s playing', () => {
		expect(placeLabel({ number: 7, season: 2 }, 12, true)).toBe('S2 · EP. 7 OF 12');
		expect(placeLabel({ number: 7, season: null }, 24, false)).toBe('EP. 7 OF 24');
		expect(leftLabel(568, 1440)).toBe('−14:32');
		expect(
			playingLabel({ audio: 'JA', subtitles: 'EN', burnedIn: false, quality: '1080p', speed: 1 })
		).toBe('JA · EN SUBS · 1080P · 1×');
		expect(
			playingLabel({ audio: null, subtitles: null, burnedIn: true, quality: '720p', speed: 1.5 })
		).toBe('SUBS IN THE PICTURE · 720P · 1.5×');
	});
});

describe('servers', () => {
	it('fail over in the source’s order, wrapping, never to one that failed this time', () => {
		expect(nextServer([1, 2, 3], 1, new Set([1]))).toBe(2);
		expect(nextServer([1, 2, 3], 2, new Set([1, 2]))).toBe(3);
		expect(nextServer([1, 2, 3], 3, new Set([3]))).toBe(1);
		expect(nextServer([1, 2, 3], 3, new Set([1, 2, 3]))).toBeNull();
	});

	it('move a stall to the next server first, then one quality down on this one', () => {
		const heights = [1080, 720, 360];
		// Another server left: the stall moves there, whatever the quality.
		expect(stallStep([1, 2], 1, new Set(), heights, 0)).toEqual({ server: 2 });
		// None left (KickAssAnime's one server): 1080p steps to 720p, then 360p.
		expect(stallStep([1], 1, new Set(), heights, 0)).toEqual({ quality: 1 });
		expect(stallStep([1], 1, new Set(), heights, 1)).toEqual({ quality: 2 });
		expect(stallStep([1, 2], 2, new Set([1]), heights, 0)).toEqual({ quality: 1 });
		// The lowest stalled too: nothing, and the list is asked for afresh.
		expect(stallStep([1], 1, new Set(), heights, 2)).toBeNull();
		expect(stallStep([1], 1, new Set(), [1080], 0)).toBeNull();
		// Never sideways: an equal height isn't lighter; an unnamed one steps to the next listed.
		expect(stallStep([1], 1, new Set(), [720, 720, 480], 0)).toEqual({ quality: 2 });
		expect(stallStep([1], 1, new Set(), [null, 480], 0)).toEqual({ quality: 1 });
		expect(stallStep([1], 1, new Set(), [720, null], 0)).toBeNull();
	});

	it('draw the challenge’s known range, never a fill toward an end', () => {
		expect(challengeScale(23)).toEqual({ at: 23 / 60, from: 20 / 60, to: 45 / 60 });
		expect(challengeScale(90).at).toBe(1);
	});
});

describe('settings across anime', () => {
	it('start from this series’ choice, then the last made anywhere, then the device’s language', () => {
		const offered = ['ZH', 'EN', 'ID'];
		expect(preferredLang(offered, ['ID', 'EN', 'EN'])).toBe('ID');
		expect(preferredLang(offered, [undefined, 'EN', 'ZH'])).toBe('EN');
		// A choice this source doesn't offer passes to the next.
		expect(preferredLang(offered, ['JA', undefined, 'EN'])).toBe('EN');
		// OFF is a choice.
		expect(preferredLang(offered, [undefined, null, 'EN'])).toBeNull();
		// None applies: the caller takes the source's first.
		expect(preferredLang(offered, [undefined, undefined, 'PT'])).toBeUndefined();
		expect(deviceLang('en-GB')).toBe('EN');
		expect(deviceLang(undefined)).toBeUndefined();
	});
});

describe('the buffer on the bar', () => {
	it('reaches the end of the range the playhead is in, not the last one', () => {
		const ranges: [number, number][] = [
			[0, 40],
			[600, 700]
		];
		expect(bufferedTo(ranges, 30)).toBe(40);
		expect(bufferedTo(ranges, 650)).toBe(700);
		// Between ranges, just after a seek: nothing ahead yet.
		expect(bufferedTo(ranges, 300)).toBe(300);
		expect(bufferedTo([], 12)).toBe(12);
	});
});

describe('the tracks an anime starts on', () => {
	const offered = { audio: ['JA', 'EN'], subs: ['EN', 'JA'] };
	const none = { series: {}, defaults: {}, last: {} };

	it('plays the source’s original before anything is chosen, subtitles in the device’s language', () => {
		expect(startTracks({ ...offered, ...none, device: 'JA' })).toEqual({
			audio: null,
			subs: 'JA',
			subsize: 'M'
		});
		expect(startTracks({ ...offered, ...none })).toEqual({ audio: null, subs: 'EN', subsize: 'M' });
	});

	it('follows the series, then SETTINGS’ default, then the last choice on any anime', () => {
		const last = { audio: 'EN', subs: 'JA', subsize: 'L' as const };
		expect(startTracks({ ...offered, series: {}, defaults: {}, last })).toEqual({
			audio: 'EN',
			subs: 'JA',
			subsize: 'L'
		});
		expect(
			startTracks({ ...offered, series: {}, defaults: { audio: 'JA', subs: null }, last })
		).toEqual({
			audio: 'JA',
			subs: null,
			subsize: 'L'
		});
		expect(
			startTracks({
				...offered,
				series: { audio: 'EN', subsize: 'S' },
				defaults: { audio: 'JA' },
				last
			})
		).toMatchObject({ audio: 'EN', subsize: 'S' });
	});

	it('passes over a choice the source doesn’t offer', () => {
		expect(
			startTracks({ ...offered, series: { audio: 'ES' }, defaults: { audio: 'EN' }, last: {} })
				.audio
		).toBe('EN');
	});
});

describe('the volume', () => {
	it('keeps 0 to 1 in whole percent, and the full volume for anything not a number', () => {
		const seen: [unknown, number][] = [
			[0.5, 0.5],
			[0.333, 0.33],
			[0, 0],
			[1, 1],
			[1.4, 1],
			[-0.2, 0],
			[Number.NaN, 1],
			[Number.POSITIVE_INFINITY, 1],
			['0.4', 1],
			[null, 1],
			[undefined, 1],
			[{}, 1]
		];
		for (const [v, want] of seen) {
			expect(cleanVolume(v), String(v)).toBe(want);
			// A normaliser holds on its own output.
			expect(cleanVolume(cleanVolume(v))).toBe(cleanVolume(v));
		}
	});

	it('lands ten steps up from 0 on exactly 100 %, and ten down on exactly 0', () => {
		let v = 0;
		for (let i = 0; i < 10; i++) v = cleanVolume(v + KEY_STEP);
		expect(v).toBe(1);
		for (let i = 0; i < 10; i++) v = cleanVolume(v - KEY_STEP);
		expect(v).toBe(0);
	});

	it('reads a vertical slider from the bottom up, clamped to its box', () => {
		const box = { top: 100, height: 120 };
		expect(verticalFraction(220, box)).toBe(0);
		expect(verticalFraction(100, box)).toBe(1);
		expect(verticalFraction(160, box)).toBe(0.5);
		expect(verticalFraction(400, box)).toBe(0);
		expect(verticalFraction(0, box)).toBe(1);
		expect(verticalFraction(160, { top: 0, height: 0 })).toBe(0);
	});
});

describe('the sprite sheet', () => {
	const sprite = { src: '', everyS: 10, w: 160, h: 90, cols: 10, count: 144 };
	it('finds the frame nearest a time, row by row', () => {
		expect(spriteTile(sprite, 0)).toEqual({ x: 0, y: 0 });
		expect(spriteTile(sprite, 4.99)).toEqual({ x: 0, y: 0 });
		expect(spriteTile(sprite, 5)).toEqual({ x: 160, y: 0 });
		expect(spriteTile(sprite, 14.9)).toEqual({ x: 160, y: 0 });
		expect(spriteTile(sprite, 92)).toEqual({ x: 1440, y: 0 });
		expect(spriteTile(sprite, 100)).toEqual({ x: 0, y: 90 });
		expect(spriteTile(sprite, 1430)).toEqual({ x: 480, y: 1260 });
	});
	it('holds the first frame before 0 and the last past the end', () => {
		expect(spriteTile(sprite, -5)).toEqual({ x: 0, y: 0 });
		expect(spriteTile(sprite, 99_999)).toEqual(spriteTile(sprite, 1430));
		expect(spriteTile(sprite, Number.NaN)).toEqual({ x: 0, y: 0 });
		expect(spriteTile({ ...sprite, count: 1 }, 500)).toEqual({ x: 0, y: 0 });
	});
});

/**
 * A stream's frame beside the time under the pointer: shown only near the time
 * it was drawn for, half a percent of the episode and at least a second, so the
 * tip never labels one time's picture with another.
 */
describe('nearFrame', () => {
	it('is near within a second on a short clip, and never with no frame', () => {
		expect(nearFrame(null, 2, 8)).toBe(false);
		expect(nearFrame(2.5, 2.5, 8)).toBe(true);
		expect(nearFrame(2.5, 3.5, 8)).toBe(true);
		expect(nearFrame(2.5, 1.5, 8)).toBe(true);
		// The next stop, 2 s on: the old frame is not this time's.
		expect(nearFrame(2.5, 4.5, 8)).toBe(false);
		expect(nearFrame(2.5, 3.51, 8)).toBe(false);
	});
	it('widens to half a percent of a long episode', () => {
		// 24 min: 7.2 s, a few pixels of a desktop's bar.
		expect(nearFrame(600, 607.1, 1440)).toBe(true);
		expect(nearFrame(600, 592.9, 1440)).toBe(true);
		expect(nearFrame(600, 607.3, 1440)).toBe(false);
	});
	it('holds at a second when the duration is unknown', () => {
		expect(nearFrame(10, 11, 0)).toBe(true);
		expect(nearFrame(10, 11, Number.NaN)).toBe(true);
		expect(nearFrame(10, 11.01, Number.POSITIVE_INFINITY)).toBe(false);
	});
});

describe('the stall clock', () => {
	const at = (now: number, over: Partial<{ paused: boolean; canPlay: boolean }> = {}) => ({
		now,
		paused: false,
		canPlay: false,
		...over
	});
	const run = (events: [StallEvent, number, Partial<{ paused: boolean; canPlay: boolean }>?][]) =>
		events.reduce<StallClock>((c, [e, t, o]) => stallClock(c, e, at(t, o)), NO_STALL);

	it('a stall with no seek starts at the waiting, and playing ends it', () => {
		expect(run([['waiting', 100]])).toEqual({ since: 100, seeking: false });
		expect(
			run([
				['waiting', 100],
				['waiting', 900]
			])
		).toEqual({ since: 100, seeking: false });
		expect(
			run([
				['waiting', 100],
				['playing', 900]
			])
		).toEqual(NO_STALL);
	});

	it('every step of a held key restarts it, so it counts from the last', () => {
		const held = Array.from({ length: 200 }, (_, i): [StallEvent, number] => ['seeking', i * 100]);
		expect(run(held)).toEqual({ since: 19_900, seeking: true });
	});

	it('a waiting during a seek changes nothing, whichever came first', () => {
		expect(
			run([
				['seeking', 100],
				['waiting', 150]
			])
		).toEqual({ since: 100, seeking: true });
		expect(
			run([
				['waiting', 50],
				['seeking', 100]
			])
		).toEqual({ since: 100, seeking: true });
	});

	it('a seek that never lands has run from the last input', () => {
		expect(
			run([
				['seeking', 100],
				['seeking', 400]
			]).since
		).toBe(400);
	});

	it('a seek that lands with something to play stops it', () => {
		expect(
			run([
				['seeking', 100],
				['seeked', 900, { canPlay: true }]
			])
		).toEqual(NO_STALL);
	});

	it('a seek that lands with nothing to play starts afresh from the landing, with no event left', () => {
		expect(
			run([
				['seeking', 100],
				['waiting', 120],
				['seeked', 9000]
			])
		).toEqual({
			since: 9000,
			seeking: false
		});
	});

	it('a playing queued before the seek does not end a seek in progress', () => {
		expect(
			run([
				['seeking', 100],
				['playing', 110]
			])
		).toEqual({ since: 100, seeking: true });
	});

	it('a paused player runs no clock, seeking or landing', () => {
		expect(run([['seeking', 100, { paused: true }]])).toEqual({ since: null, seeking: true });
		expect(run([['seeked', 100, { paused: true }]]).since).toBeNull();
		expect(run([['waiting', 100, { paused: true }]])).toEqual(NO_STALL);
	});

	it('pausing stops it, and play from a seek still in progress starts it at the waiting', () => {
		expect(
			run([
				['waiting', 100],
				['paused', 200, { paused: true }]
			])
		).toEqual(NO_STALL);
		const paused = run([['seeking', 100, { paused: true }]]);
		expect(stallClock(paused, 'waiting', at(500))).toEqual({ since: 500, seeking: true });
	});

	it('a reset forgets a stall and a seek', () => {
		expect(
			run([
				['seeking', 100],
				['reset', 200]
			])
		).toEqual(NO_STALL);
	});

	it('every event from every state keeps seeking true only until a landing or a reset', () => {
		const events: StallEvent[] = ['waiting', 'seeking', 'seeked', 'playing', 'paused', 'reset'];
		const states: StallClock[] = [
			{ since: null, seeking: false },
			{ since: 5, seeking: false },
			{ since: null, seeking: true },
			{ since: 5, seeking: true }
		];
		for (const state of states)
			for (const event of events)
				for (const paused of [false, true])
					for (const canPlay of [false, true]) {
						const next = stallClock(state, event, { now: 9, paused, canPlay });
						const seeking =
							event === 'seeking' || (state.seeking && event !== 'seeked' && event !== 'reset');
						expect(next.seeking, `${JSON.stringify(state)} ${event}`).toBe(seeking);
						// A running clock never moves earlier, and a paused player never starts one.
						if (next.since !== null && next.since !== state.since) {
							expect(paused).toBe(false);
							expect(next.since).toBe(9);
						}
					}
	});

	it('counts whole seconds, so 15 is a full 15 s', () => {
		expect(stallElapsed(0, 14_999)).toBe(14);
		expect(stallElapsed(0, 15_000)).toBe(15);
	});
});

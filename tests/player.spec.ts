import { describe, expect, it } from 'vitest';
import {
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
	subtitlePx,
	TAP_SLOP_PX
} from '$lib/library/player';

// The player's decisions (doc/ANIME.md, "The player"; card c156).
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

	it('offers the next from its ending, or 30 s before the end', () => {
		expect(offerNextAt(1440, 1290)).toBe(1290);
		expect(offerNextAt(1440, null)).toBe(1410);
		expect(offerNextAt(1440, 1500)).toBe(1410);
	});

	it('seeks 10 s a double-tap and 10 more each tap after', () => {
		expect([seekFor(2), seekFor(3), seekFor(5)]).toEqual([10, 20, 40]);
	});

	it('brings the controls back on a move, not on a jitter, and a click is not a drag (c217, c218)', () => {
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

describe('settings across anime (2026-10-29)', () => {
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

describe('the tracks an anime starts on (card c171)', () => {
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

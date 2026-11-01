import { describe, expect, it } from 'vitest';
import {
	aboutBytes,
	animeConfirm,
	animeContinue,
	clock,
	episodeCount,
	episodeLabel,
	episodeMeta,
	episodeRows,
	episodesSpan,
	episodeStatus,
	isWatchedAt,
	seasonLabel,
	seriesCountLine,
	watchedFraction,
	watchingAt,
	type Episode
} from '$lib/library/anime';
import type { SeriesEntry } from '$lib/library/series';

// Anime's words (doc/ANIME.md; card c153), as Anime States and Anime Calls draw them.
const ep = (
	n: number,
	o: Omit<Partial<SeriesEntry>, 'episode'> & { episode?: Partial<Episode> | null } = {}
): SeriesEntry => ({
	id: (o.episode?.season ?? 1) * 100 + n,
	number: n,
	label: `Ep. ${n}`,
	title: '',
	readAt: null,
	lastPosition: null,
	lastOpenedAt: null,
	pageCount: 0,
	file: '',
	bytes: 0,
	rating: 0,
	favourite: false,
	addedAt: 0,
	coverPage: null,
	available: false,
	locator: '',
	matter: '',
	lastOffset: null,
	volume: '',
	originSource: '',
	tags: [],
	...o,
	episode:
		o.episode === null
			? null
			: {
					durationS: 1440,
					season: null,
					number: null,
					note: '',
					thumb: '',
					endingAt: null,
					...o.episode
				}
});

describe('an episode', () => {
	it('tells its time on a clock', () => {
		expect([clock(0), clock(872), clock(3723), clock(-4), clock(59.9)]).toEqual([
			'0:00',
			'14:32',
			'1:02:03',
			'0:00',
			'0:59'
		]);
	});

	it('says its length and what kind of episode it is', () => {
		expect(episodeMeta(ep(1))).toBe('24 MIN');
		expect(episodeMeta(ep(6, { episode: { note: 'recap', durationS: 1380 } }))).toBe(
			'RECAP · 23 MIN'
		);
		expect(episodeMeta(ep(10, { episode: { note: 'filler', durationS: null } }))).toBe('FILLER');
		expect(episodeMeta(ep(2, { episode: null }))).toBe('');
	});

	it('is EP. 7, or S2 EP. 7 where the series has seasons', () => {
		expect(episodeLabel(ep(7, { episode: { season: 2 } }))).toBe('EP. 7');
		expect(episodeLabel(ep(7, { episode: { season: 2 } }), true)).toBe('S2 EP. 7');
		expect(episodeLabel(ep(7.5), true)).toBe('EP. 7.5');
		// Its place is across the series; its number starts again each season.
		expect(episodeLabel(ep(19, { episode: { season: 2, number: 7 } }), true)).toBe('S2 EP. 7');
	});

	it('shows WATCHED, the time left, its size, or NOT DOWNLOADED, which streams', () => {
		expect(episodeStatus(ep(1, { readAt: 5 }), false)).toBe('WATCHED');
		const part = ep(7, { lastPosition: 568, lastOpenedAt: 5 });
		expect(episodeStatus(part, true)).toBe('14:32 LEFT');
		expect(watchedFraction(part)).toBeCloseTo(568 / 1440);
		expect(episodeStatus(ep(8, { available: true, bytes: 410_000_000 }), false)).toBe('410 MB');
		expect(episodeStatus(ep(11), false)).toBe('NOT DOWNLOADED');
	});

	it('is watched at its ending’s start, or in its last 3 % without timestamps', () => {
		expect(isWatchedAt(1349, 1440, 1350)).toBe(false);
		expect(isWatchedAt(1350, 1440, 1350)).toBe(true);
		expect(isWatchedAt(1396, 1440, null)).toBe(false);
		expect(isWatchedAt(1397, 1440, null)).toBe(true);
		// An ending past the end is no ending.
		expect(isWatchedAt(1397, 1440, 2000)).toBe(true);
		expect(isWatchedAt(10, 0, null)).toBe(false);
	});
});

describe('the episode list', () => {
	const s1 = Array.from({ length: 12 }, (_, i) => ep(i + 1, { readAt: 1, episode: { season: 1 } }));
	const s2 = Array.from({ length: 12 }, (_, i) =>
		ep(i + 1, {
			readAt: i < 6 ? 1 : null,
			lastPosition: i === 6 ? 568 : null,
			lastOpenedAt: i === 6 ? 9 : null,
			episode: { season: 2 }
		})
	);

	it('groups by season, folds one watched through, and opens on the one being watched', () => {
		const rows = episodeRows([...s1, ...s2]);
		expect(rows[0]).toEqual({ type: 'fold', season: 1, from: 1, to: 12, count: 12 });
		expect(rows[1]).toEqual({ type: 'head', season: 2, from: 1, to: 12, watched: 6, count: 12 });
		expect(rows.filter((r) => r.type === 'episode')).toHaveLength(12);
		expect(rows.find((r) => r.type === 'episode' && r.current)).toMatchObject({
			entry: { number: 7, episode: { season: 2 } }
		});
		expect(seasonLabel(1, 1, 12)).toBe('SEASON 1 · EP. 1 – 12');
		expect(
			episodeRows([...s1, ...s2], { expanded: true }).filter((r) => r.type === 'head')
		).toHaveLength(2);
	});

	it('stays flat without seasons, as Aniyomi gives most lists', () => {
		const flat = [ep(1, { readAt: 1 }), ep(2), ep(3)];
		expect(episodeRows(flat).map((r) => r.type)).toEqual(['episode', 'episode', 'episode']);
	});

	it('counts what’s watched', () => {
		expect(episodeCount([...s1, ...s2])).toBe('24 · 18 WATCHED');
		expect(episodeCount([ep(1), ep(2)])).toBe('2 · NONE WATCHED');
		expect(seriesCountLine([...s1, ...s2])).toBe('24 EPISODES · 2 SEASONS · 18 WATCHED');
		expect(seriesCountLine([ep(1)])).toBe('1 EPISODE');
	});
});

describe('CONTINUE', () => {
	it('names the season, the episode and the time left', () => {
		const list = [
			ep(6, { readAt: 1, episode: { season: 2 } }),
			ep(7, { lastPosition: 568, lastOpenedAt: 9, episode: { season: 2 } })
		];
		expect(animeContinue(list)).toMatchObject({
			label: 'CONTINUE',
			meta: 'S2 · EP. 7 · 14:32 LEFT',
			short: 'S2 EP. 7 · 14:32 LEFT'
		});
	});

	it('starts a series not begun, saying it streams when it has no file', () => {
		expect(animeContinue([ep(1), ep(2)])).toMatchObject({
			label: 'START',
			meta: 'EP. 1 · STREAMS'
		});
		expect(animeContinue([ep(1, { available: true })]).meta).toBe('EP. 1');
		expect(animeContinue([ep(1, { readAt: 1 })])).toMatchObject({
			label: 'WATCH AGAIN',
			meta: 'EP. 1'
		});
	});

	it('is what the library and the history say', () => {
		const at = ep(7, { lastPosition: 568, lastOpenedAt: 9, episode: { season: 2 } });
		expect(watchingAt(at, true)).toBe('S2 EP. 7 · 14:32 LEFT');
		expect(watchingAt(at, true, false)).toBe('S2 EP. 7 · 9:28');
		expect(watchingAt(ep(3, { readAt: 1 }), false)).toBe('EP. 3');
		expect(episodesSpan(3, 5)).toBe('EP. 3 → 5');
		expect(episodesSpan(4, 4)).toBe('EP. 4');
	});
});

describe('a download’s size', () => {
	it('is ABOUT the bitrate times the length', () => {
		// 1080p at about 2.3 Mbit/s for 24 minutes: about 410 MB.
		expect(aboutBytes(1440, 2_277_778)).toBe(410_000_040);
		expect(aboutBytes(null, 2_000_000)).toBeNull();
		expect(aboutBytes(1440, 0)).toBeNull();
	});
});

describe('ALL’s confirmation', () => {
	it('names the episodes, their ABOUT size at the height chosen, where they go and what they wait behind', () => {
		const eps = Array.from({ length: 24 }, (_, i) => ep(i + 1, { episode: { season: 1 } }));
		expect(
			animeConfirm({
				entries: eps,
				ids: eps.map((e) => e.id),
				elsewhere: 2,
				each: 410_000_000,
				free: 1_400_000_000_000,
				folder: '/mnt/hdd2/tsundoku/library/Anime/Kōri'
			})
		).toEqual({
			title: 'DOWNLOAD 24 EPISODES?',
			lines: [
				'EP. 1 – 24 · SEASON 1 · EVERY EPISODE WITH NO FILE',
				"ABOUT 410 MB AN EPISODE · 9.8 GB IN ALL · FROM THE SOURCE'S BITRATE, SO ABOUT",
				'TO /MNT/HDD2/TSUNDOKU/LIBRARY/ANIME/KŌRI · 1.4 TB FREE',
				'AN EPISODE TAKES MINUTES · BEHIND 2 OTHERS IN THE QUEUE'
			]
		});
		// Before the source has said its bitrate.
		expect(
			animeConfirm({
				entries: eps,
				ids: [eps[0].id],
				elsewhere: 0,
				each: null,
				free: null,
				folder: '/a'
			}).lines[1]
		).toBe('THE SIZE IS ASKED OF THE SOURCE…');
	});
});

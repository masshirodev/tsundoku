import { describe, expect, it } from 'vitest';
import {
	byteRange,
	EPISODE_BUDGET_BYTES,
	episodeMarkerPath,
	evict,
	keepEpisodes,
	parseEpisodeMarker,
	parseMarker
} from '$lib/cache/policy';

// The device keeping episodes (doc/ANIME.md, "Offline"; Anime Calls 01, default 5).
describe('the episodes a device keeps', () => {
	const eps = [
		{ id: 1, position: 1, readAt: 5, available: true },
		{ id: 2, position: 2, readAt: null, available: true },
		{ id: 3, position: 3, readAt: null, available: false },
		{ id: 4, position: 4, readAt: null, available: true }
	];

	it('is the next one downloaded and not watched, while one plays', () => {
		expect(keepEpisodes(eps, 1)).toEqual([2]);
		// EP. 3 isn't on the workstation: the next that is.
		expect(keepEpisodes(eps, 2)).toEqual([4]);
		expect(keepEpisodes(eps, 4)).toEqual([]);
	});

	it('has its own 3 GB, and its own markers, apart from the chapters’', () => {
		expect(EPISODE_BUDGET_BYTES).toBe(3 * 1024 ** 3);
		const path = episodeMarkerPath(7, 42);
		expect(parseEpisodeMarker(path)).toEqual({ seriesId: 7, entryId: 42 });
		expect(parseMarker(path)).toBeNull();
		const cached = [
			{ seriesId: 7, entryId: 1, at: 1, bytes: 2 * 1024 ** 3 },
			{ seriesId: 7, entryId: 2, at: 2, bytes: 2 * 1024 ** 3 }
		];
		expect(evict(cached, [2], EPISODE_BUDGET_BYTES)).toEqual([1]);
	});

	it('is sliced for the player’s Range requests offline', () => {
		expect(byteRange('bytes=0-99', 1000)).toEqual({ start: 0, end: 99 });
		expect(byteRange('bytes=900-', 1000)).toEqual({ start: 900, end: 999 });
		expect(byteRange('bytes=-100', 1000)).toEqual({ start: 900, end: 999 });
		expect(byteRange('bytes=2000-', 1000)).toBeNull();
		expect(byteRange(null, 1000)).toBeNull();
	});
});

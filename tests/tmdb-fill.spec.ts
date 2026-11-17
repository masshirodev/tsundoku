import { describe, expect, it, vi } from 'vitest';
import {
	PER_PASS,
	TMDB_FILL_EVERY_MS,
	TMDB_FIRST_FILL_MS,
	tmdbCadence,
	tmdbFillLoop
} from '$lib/server/tmdb-fill';

/**
 * TMDB's timer: what makes "a key added later backfills" true on an
 * install that never imports. No network: the pass is a stand-in.
 */
describe('tmdbCadence', () => {
	it('runs every ten minutes, the first a minute in', () => {
		expect(tmdbCadence({})).toEqual({ first: TMDB_FIRST_FILL_MS, every: TMDB_FILL_EVERY_MS });
	});

	it('never runs under a stand-in TMDB unless asked', () => {
		expect(tmdbCadence({ TMDB_API_URL: 'http://127.0.0.1:1/3' })).toBeNull();
		expect(
			tmdbCadence({ TMDB_API_URL: 'http://127.0.0.1:1/3', TSUNDOKU_TMDB_FILL_MS: '50' })
		).toEqual({
			first: 50,
			every: 50
		});
	});
});

describe('tmdbFillLoop', () => {
	it('asks for twenty at a time, never joins a pass still running, and survives a failure', async () => {
		let release: () => void = () => {};
		const pass = vi.fn(
			(o: { limit: number }) =>
				new Promise<{ searched: number; linked: number; offered: number }>((ok) => {
					expect(o.limit).toBe(PER_PASS);
					release = () => ok({ searched: 0, linked: 0, offered: 0 });
				})
		);
		const loop = tmdbFillLoop({ first: 1e9, every: 1e9 }, pass);
		const one = loop.tick();
		await loop.tick();
		expect(pass).toHaveBeenCalledTimes(1);
		release();
		await one;
		// Twice in a row: the second is the same failure, and says nothing more.
		pass.mockRejectedValueOnce(new Error('TMDB answered 503'));
		pass.mockRejectedValueOnce(new Error('TMDB answered 503'));
		const log = vi.spyOn(console, 'log').mockImplementation(() => {});
		await loop.tick();
		await loop.tick();
		expect(log.mock.calls.filter((c) => String(c[0]).includes('503'))).toHaveLength(1);
		log.mockRestore();
		loop.stop();
	});
});

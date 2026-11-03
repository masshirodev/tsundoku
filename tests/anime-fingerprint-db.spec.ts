import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// Before anything imports db.ts: getDb() reads this once and memoises.
process.env.DATABASE_PATH = ':memory:';

// Fingerprints of downloaded episodes (doc/ANIME.md, "Openings and endings";
// card c239), with the real ffmpeg and chromaprint: two episodes that share a
// 20 s opening and a 20 s ending, and nothing in between.
const work = mkdtempSync(join(tmpdir(), 'tsundoku-fingerprint-'));
afterAll(() => rmSync(work, { recursive: true, force: true }));

const FFMPEG = process.env.FFMPEG ?? 'ffmpeg';
const noise = (name: string, seconds: number, seed: number) => {
	const file = join(work, name);
	execFileSync(
		FFMPEG,
		[
			'-loglevel',
			'error',
			'-f',
			'lavfi',
			'-i',
			`anoisesrc=color=pink:duration=${seconds}:seed=${seed}`,
			'-c:a',
			'libopus',
			'-b:a',
			'32k',
			file
		],
		{ stdio: 'ignore' }
	);
	return file;
};
const concat = (name: string, parts: string[]) => {
	const file = join(work, name);
	execFileSync(
		FFMPEG,
		[
			'-loglevel',
			'error',
			...parts.flatMap((p) => ['-i', p]),
			'-filter_complex',
			`${parts.map((_, i) => `[${i}:a]`).join('')}concat=n=${parts.length}:v=0:a=1[out]`,
			'-map',
			'[out]',
			'-c:a',
			'libopus',
			'-b:a',
			'32k',
			file
		],
		{ stdio: 'ignore' }
	);
	return file;
};

const { getDb } = await import('$lib/server/db');
const marks = await import('$lib/server/anime/marks');
const { fingerprintFile } = await import('$lib/server/anime/fingerprint');
const { FINGERPRINT_RETRY_MS, fingerprintSeason, wantSkipMarks, skipMarksIdle } =
	await import('$lib/server/anime/skip-marks');

const db = getDb();
const root = Number(
	db.prepare(`INSERT INTO roots (name, path, hidden) VALUES ('Anime', '/nowhere', 0)`).run()
		.lastInsertRowid
);
let n = 0;
const series = (path: string, hidden = 0) =>
	Number(
		db
			.prepare(
				`INSERT INTO series (root_id, title, kind, added_at, origin_key, hidden, path)
				VALUES (?, ?, 'anime', 0, ?, ?, ?)`
			)
			.run(root, `Show ${++n}`, `aniyomi:7000:/show/${n}`, hidden, path).lastInsertRowid
	);
let position = 0;
const episode = (
	seriesId: number,
	file: string,
	o: { season?: number | null; duration?: number; read?: number } = {}
) =>
	Number(
		db
			.prepare(
				`INSERT INTO entries (series_id, position, label, added_at, file, available, duration_s, season,
					episode_number, source_url)
				VALUES (?, ?, 'Ep.', 0, ?, 1, ?, ?, ?, ?)`
			)
			.run(
				seriesId,
				++position,
				file,
				o.duration ?? 340,
				o.season === undefined ? 1 : o.season,
				1,
				`/ep/${position}`
			).lastInsertRowid
	);

let op: string;
let midA: string;
let midB: string;
let ed: string;
let epAFile: string;

beforeAll(() => {
	op = noise('op.mka', 20, 41);
	midA = noise('mid-a.mka', 300, 100);
	midB = noise('mid-b.mka', 300, 200);
	ed = noise('ed.mka', 20, 43);
	epAFile = concat('ep-a.mka', [op, midA, ed]);
	concat('ep-b.mka', [op, midB, ed]);
}, 60_000);

describe('fingerprinting downloaded episodes', () => {
	it('finds the opening and ending two episodes share', async () => {
		const show = series(work);
		const a = episode(show, 'ep-a.mka');
		const b = episode(show, 'ep-b.mka');
		const result = await fingerprintSeason(show, a, { pauseMs: 0 });
		expect(result).toEqual({ episodes: 2, found: 2 });
		for (const id of [a, b]) {
			const chosen = marks.chosenMarks(id);
			expect(chosen.introFrom).toBe('fingerprint');
			expect(chosen.endingFrom).toBe('fingerprint');
			// The shared 20 s opening is at the start, the ending at 320 s.
			expect(chosen.intro!.start).toBeLessThan(3);
			expect(chosen.intro!.end - chosen.intro!.start).toBeGreaterThan(15);
			expect(chosen.ending!.start).toBeGreaterThan(315);
			expect(chosen.ending!.start).toBeLessThan(325);
			expect(chosen.ending!.end - chosen.ending!.start).toBeGreaterThan(15);
			expect(db.prepare(`SELECT ending_at FROM entries WHERE id = ?`).get(id)).toEqual({
				ending_at: chosen.ending!.start
			});
		}
		// Asked again, nothing is read: the answer is kept.
		expect(await fingerprintSeason(show, a, { pauseMs: 0 })).toEqual({ episodes: 0, found: 0 });
	}, 30_000);

	it('leaves the source’s own timestamps ahead of it', async () => {
		const show = series(work);
		const a = episode(show, 'ep-a.mka');
		const b = episode(show, 'ep-b.mka');
		marks.saveSourceMarks(a, {
			intro: { start: 1, end: 25 },
			ending: { start: 300, end: 330 }
		});
		marks.saveSourceMarks(b, {
			intro: { start: 1, end: 25 },
			ending: { start: 300, end: 330 }
		});
		await fingerprintSeason(show, a, { pauseMs: 0 });
		const chosen = marks.chosenMarks(a);
		expect(chosen.introFrom).toBe('source');
		expect(chosen.endingFrom).toBe('source');
		expect(db.prepare(`SELECT ending_at FROM entries WHERE id = ?`).get(a)).toEqual({
			ending_at: 300
		});
	});

	it('reads nothing for a hidden series', async () => {
		const show = series(work, 1);
		const a = episode(show, 'ep-a.mka');
		episode(show, 'ep-b.mka');
		expect(await fingerprintSeason(show, a, { pauseMs: 0 })).toEqual({ episodes: 0, found: 0 });
		expect(marks.chosenMarks(a).intro).toBeNull();
	});

	it('leaves one episode alone: a pair is the least it can compare', async () => {
		const show = series(work);
		const a = episode(show, 'ep-a.mka');
		expect(await fingerprintSeason(show, a, { pauseMs: 0 })).toEqual({ episodes: 1, found: 0 });
		expect(marks.chosenMarks(a).intro).toBeNull();
		expect(marks.markTriedAt(a, 'fingerprint')).toBeNull();
	});

	it('remembers a pair that shared nothing, but not forever', async () => {
		const show = series(work);
		const a = episode(show, 'ep-a.mka');
		const b = episode(show, 'ep-b.mka');
		// Different audio throughout: nothing to match.
		concat('ep-c.mka', [noise('x.mka', 20, 500), noise('y.mka', 300, 501)]);
		db.prepare(`UPDATE entries SET file = ? WHERE id = ?`).run('ep-c.mka', b);
		const now = 1_800_000_000_000;
		const result = await fingerprintSeason(show, a, { pauseMs: 0, now });
		expect(result.found).toBe(0);
		for (const id of [a, b]) {
			expect(marks.chosenMarks(id).intro).toBeNull();
			expect(marks.markTriedAt(id, 'fingerprint')).toBe(now);
			expect(marks.needsLookup(id, 'fingerprint', FINGERPRINT_RETRY_MS, now + 1000)).toBe(false);
			expect(
				marks.needsLookup(id, 'fingerprint', FINGERPRINT_RETRY_MS, now + FINGERPRINT_RETRY_MS)
			).toBe(true);
		}
	}, 30_000);

	it('fingerprints a file through the same reader the queue uses', async () => {
		const prints = await fingerprintFile(epAFile, 340);
		expect(prints.intro?.points.length).toBeGreaterThan(0);
		expect(prints.ending?.points.length).toBeGreaterThan(0);
		expect(prints.intro!.seconds).toBe(85);
		expect(prints.intro!.start).toBe(0);
		expect(prints.ending!.seconds).toBe(240);
		expect(prints.ending!.start).toBe(100);
	}, 30_000);

	// A bundle points FPCALC at its own copy, before anything on PATH (c297):
	// on a build whose ffmpeg has no muxer, this is the only fpcalc that runs.
	const hasMuxer = execFileSync(FFMPEG, ['-hide_banner', '-muxers'], { encoding: 'utf8' }).includes(
		'chromaprint'
	);
	it.skipIf(hasMuxer)(
		'runs the fpcalc FPCALC names, before anything on PATH',
		async () => {
			const marker = join(work, 'fpcalc-was-run');
			const wrapper = join(work, 'fpcalc-wrapper.sh');
			const real = process.env.FPCALC ?? 'fpcalc';
			writeFileSync(wrapper, `#!/bin/sh\ntouch '${marker}'\nexec '${real}' "$@"\n`, {
				mode: 0o755
			});
			const before = process.env.FPCALC;
			process.env.FPCALC = wrapper;
			try {
				const prints = await fingerprintFile(epAFile, 340);
				expect(prints.intro?.points.length).toBeGreaterThan(0);
				expect(existsSync(marker)).toBe(true);
			} finally {
				if (before === undefined) delete process.env.FPCALC;
				else process.env.FPCALC = before;
			}
		},
		30_000
	);

	it('runs in the background, one job at a time, and says when it is idle', async () => {
		const show = series(work);
		const a = episode(show, 'ep-a.mka');
		episode(show, 'ep-b.mka');
		wantSkipMarks(a);
		await skipMarksIdle();
		expect(marks.chosenMarks(a).introFrom).toBe('fingerprint');
	}, 30_000);
});

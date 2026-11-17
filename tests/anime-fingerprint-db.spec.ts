import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromaprintSkip } from './helpers/chromaprint';

// Before anything imports db.ts: getDb() reads this once and memoises.
process.env.DATABASE_PATH = ':memory:';

// Fingerprints of downloaded episodes (doc/ANIME.md, "Openings and endings"),
// with the real ffmpeg and chromaprint: two episodes that share a
// 20 s opening and a 20 s ending, and nothing in between.
const work = mkdtempSync(join(tmpdir(), 'tsundoku-fingerprint-'));
afterAll(() => rmSync(work, { recursive: true, force: true }));

const FFMPEG = process.env.FFMPEG ?? 'ffmpeg';
// A box with no chromaprint at all skips the cases that fingerprint.
const noPrint = chromaprintSkip('anime-fingerprint-db', FFMPEG) !== null;
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
const concat = (name: string, parts: string[], bitrate = '32k') => {
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
			bitrate,
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

// Encoding 1,320 s of Opus: about 15 s on an idle 6-core box, past 60 s on a
// 4-core runner that encodes beside three other spec files.
beforeAll(() => {
	op = noise('op.mka', 20, 41);
	midA = noise('mid-a.mka', 300, 100);
	midB = noise('mid-b.mka', 300, 200);
	ed = noise('ed.mka', 20, 43);
	epAFile = concat('ep-a.mka', [op, midA, ed]);
	concat('ep-b.mka', [op, midB, ed]);
}, 300_000);

describe('fingerprinting downloaded episodes', () => {
	it.skipIf(noPrint)(
		'finds the opening and ending two episodes share',
		async () => {
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
		},
		30_000
	);

	it.skipIf(noPrint)(
		'finds the whole opening behind cold opens of different lengths, through two encodes',
		async () => {
			// Ranma ½ (2024): its opening at 30.75 s in one episode and
			// 83.1 s in another, and found as a 31-48 s piece of a 90 s song. Here a
			// 90 s opening after a 25 s and an 80 s cold open, the second episode
			// encoded at a third of the bitrate, as a 360p stream's audio is.
			const song = noise('song.mka', 90, 77);
			const coldC = noise('cold-c.mka', 25, 301);
			const coldD = noise('cold-d.mka', 80, 302);
			const midC = noise('mid-c.mka', 600, 303);
			const midD = noise('mid-d.mka', 545, 304);
			concat('ep-c-cold.mka', [coldC, song, midC, ed]);
			concat('ep-d-cold.mka', [coldD, song, midD, ed], '12k');
			const show = series(work);
			const c = episode(show, 'ep-c-cold.mka', { duration: 735 });
			const d = episode(show, 'ep-d-cold.mka', { duration: 735 });
			expect(await fingerprintSeason(show, c, { pauseMs: 0 })).toEqual({ episodes: 2, found: 2 });
			const want = { [c]: 25, [d]: 80 };
			for (const id of [c, d]) {
				const intro = marks.chosenMarks(id).intro!;
				// Where the song starts, to a second, and all of it.
				expect(Math.abs(intro.start - want[id])).toBeLessThan(1);
				expect(intro.end - intro.start).toBeGreaterThan(88);
				expect(intro.end - intro.start).toBeLessThan(92);
			}
		},
		120_000
	);

	it.skipIf(noPrint)(
		'keeps the opening most of an episode’s pairs agree on, not one pair’s longer run',
		async () => {
			// The pairing in fingerprintSeason, not agreedSpan alone. A, B and
			// D share a 20 s opening; C shares a longer 40 s stretch with A
			// only, 30 s after A's opening (spans that touch would count as
			// agreeing, and the longer win the tie), a run valid for that pair.
			// A's pairs give it the opening twice (B, D) and the stretch once
			// (C). Four episodes, not three: with one span per partner, three
			// give A two spans that agree with nothing, and the longer wins
			// under either rule.
			const stretch = noise('stretch.mka', 40, 501);
			const cold = noise('cold-e.mka', 10, 502);
			const mid = (seed: number, seconds: number) => noise(`mid-${seed}.mka`, seconds, seed);
			concat('ep-agree-a.mka', [op, mid(515, 30), stretch, mid(511, 270), ed]);
			concat('ep-agree-b.mka', [op, mid(512, 340), ed]);
			concat('ep-agree-c.mka', [cold, stretch, mid(513, 310), ed]);
			concat('ep-agree-d.mka', [op, mid(514, 340), ed]);
			const show = series(work);
			const [a, b, c, d] = ['a', 'b', 'c', 'd'].map((x) =>
				episode(show, `ep-agree-${x}.mka`, { duration: 380 })
			);
			expect(await fingerprintSeason(show, a, { pauseMs: 0 })).toEqual({ episodes: 4, found: 4 });
			// A keeps the opening, where B and D agree, and not the longer stretch C found.
			for (const id of [a, b, d]) {
				const intro = marks.chosenMarks(id).intro!;
				expect(intro.start).toBeLessThan(1);
				expect(intro.end - intro.start).toBeGreaterThan(18);
				expect(intro.end - intro.start).toBeLessThan(22);
			}
			// C has only the stretch, which is what its one pair found.
			const onC = marks.chosenMarks(c).intro!;
			expect(Math.abs(onC.start - 10)).toBeLessThan(1);
			expect(onC.end - onC.start).toBeGreaterThan(38);
		},
		120_000
	);

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

	it.skipIf(noPrint)('leaves one episode alone: a pair is the least it can compare', async () => {
		const show = series(work);
		const a = episode(show, 'ep-a.mka');
		expect(await fingerprintSeason(show, a, { pauseMs: 0 })).toEqual({ episodes: 1, found: 0 });
		expect(marks.chosenMarks(a).intro).toBeNull();
		expect(marks.markTriedAt(a, 'fingerprint')).toBeNull();
	});

	it.skipIf(noPrint)(
		'remembers a pair that shared nothing, but not forever',
		async () => {
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
		},
		30_000
	);

	it.skipIf(noPrint)(
		'fingerprints a file through the same reader the queue uses',
		async () => {
			const prints = await fingerprintFile(epAFile, 340);
			expect(prints.intro?.points.length).toBeGreaterThan(0);
			expect(prints.ending?.points.length).toBeGreaterThan(0);
			expect(prints.intro!.seconds).toBe(85);
			expect(prints.intro!.start).toBe(0);
			expect(prints.ending!.seconds).toBe(240);
			expect(prints.ending!.start).toBe(100);
		},
		30_000
	);

	// On a build whose ffmpeg has no muxer (this workstation's), FPCALC names
	// the fpcalc that runs; it is `fpcalc` on PATH when nothing names one.
	const hasMuxer = execFileSync(FFMPEG, ['-hide_banner', '-muxers'], { encoding: 'utf8' }).includes(
		'chromaprint'
	);
	it.skipIf(hasMuxer || noPrint)(
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

	it.skipIf(noPrint)(
		'runs in the background, one job at a time, and says when it is idle',
		async () => {
			const show = series(work);
			const a = episode(show, 'ep-a.mka');
			episode(show, 'ep-b.mka');
			wantSkipMarks(a);
			await skipMarksIdle();
			expect(marks.chosenMarks(a).introFrom).toBe('fingerprint');
		},
		30_000
	);
});

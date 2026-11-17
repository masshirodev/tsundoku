import { spawn } from 'node:child_process';
import { mkdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import { join } from '../fspath.ts';
import { coverDir } from '../covers.ts';
import { episodeFile } from './streams.ts';
import {
	SPRITE_COLS,
	SPRITE_EVERY_S,
	SPRITE_H,
	SPRITE_W,
	type Sprite
} from '../../library/player.ts';

/**
 * A downloaded episode's seek preview (doc/ANIME.md, "The player"): one sheet of
 * frames, one every `SPRITE_EVERY_S` seconds at `SPRITE_W` x `SPRITE_H`,
 * `SPRITE_COLS` to a row, made by ffmpeg from the file once, in the background,
 * after the episode is first played. It sits beside the episode's picture, as
 * covers/episodes/<id>.sprite.jpg, with a small sidecar (<id>.sprite.json) that
 * names the file it was cut from: its path, its size and its modification time.
 *
 * **A sprite is only ever the file's it was made from.** A sprite of a file
 * that changed is a wrong preview: a re-download (another server, another
 * cut), a deleted download, a MOVE to another source, a scan that finds the
 * file gone, an entry id SQLite hands out again after a delete. Rather than
 * every one of those paths remembering to delete it, every reader asks
 * `currentSprite`, which compares the sidecar with the file there is now and
 * deletes a sprite that no longer matches. Nothing is stored in the database,
 * so no migration is needed for it.
 *
 * Only a file is read: a stream's preview is the player's own (a hidden
 * second picture, fetched only while the pointer is on the scrubber), since a
 * sprite of a stream would mean reading the whole episode.
 */

const FFMPEG = () => process.env.FFMPEG ?? 'ffmpeg';
const FFPROBE = () => process.env.FFPROBE ?? 'ffprobe';

/** A sprite that couldn't be made isn't tried again for this long (a broken file). */
export const SPRITE_RETRY_MS = 6 * 60 * 60 * 1000;

export const spritePath = (entryId: number) =>
	join(coverDir(), 'episodes', `${entryId}.sprite.jpg`);
const metaPath = (entryId: number) => join(coverDir(), 'episodes', `${entryId}.sprite.json`);

/** What the sidecar keeps: the file the sheet was cut from, and the sheet's own shape. */
type SpriteMeta = {
	file: string;
	bytes: number;
	mtimeMs: number;
	everyS: number;
	w: number;
	h: number;
	cols: number;
	count: number;
	madeAt: number;
};

/** The file's identity as the sidecar records it. */
async function fileStamp(path: string): Promise<{ bytes: number; mtimeMs: number } | null> {
	try {
		const s = await stat(path);
		return s.isFile() ? { bytes: s.size, mtimeMs: Math.floor(s.mtimeMs) } : null;
	} catch {
		return null;
	}
}

/** Removes an episode's sprite and its sidecar, if any. */
export async function forgetSprite(entryId: number): Promise<void> {
	await rm(spritePath(entryId), { force: true });
	await rm(metaPath(entryId), { force: true });
}

/**
 * The episode's sprite, if one exists for the file it has now; null
 * otherwise. A sprite left from another file, or from a file that is gone, is
 * deleted here: this is the one place a sprite is judged, so every path that
 * changes the file is covered by it.
 */
export async function currentSprite(entryId: number): Promise<Sprite | null> {
	const raw = await readFile(metaPath(entryId), 'utf8').catch(() => null);
	if (raw === null) return null;
	let meta: SpriteMeta | null;
	try {
		meta = JSON.parse(raw) as SpriteMeta;
	} catch {
		meta = null;
	}
	const file = episodeFile(entryId);
	const now = file ? await fileStamp(file) : null;
	const sheet = await fileStamp(spritePath(entryId));
	if (
		!meta ||
		!file ||
		!now ||
		!sheet ||
		meta.file !== file ||
		meta.bytes !== now.bytes ||
		meta.mtimeMs !== now.mtimeMs
	) {
		await forgetSprite(entryId);
		return null;
	}
	return {
		src: `/api/anime/sprite/${entryId}?v=${meta.madeAt}`,
		everyS: meta.everyS,
		w: meta.w,
		h: meta.h,
		cols: meta.cols,
		count: meta.count
	};
}

/** The file's length in seconds, from its container. */
function lengthOf(path: string): Promise<number | null> {
	return new Promise((ok) => {
		const p = spawn(FFPROBE(), [
			'-v',
			'error',
			'-show_entries',
			'format=duration',
			'-of',
			'default=nw=1:nk=1',
			path
		]);
		let out = '';
		p.stdout.on('data', (b: Buffer) => (out += b.toString()));
		p.on('error', () => ok(null));
		p.on('close', () => {
			const n = Number(out.trim());
			ok(Number.isFinite(n) && n > 0 ? n : null);
		});
	});
}

/**
 * The ffmpeg arguments for one sheet. Only key frames are decoded
 * (`-skip_frame nokey`), so an episode costs seconds rather than a full
 * decode: a frame lands on the key frame nearest its time, which for a
 * preview is close enough. Frame i is the one nearest i x SPRITE_EVERY_S
 * seconds (the fps filter's own rounding). Each frame is fitted into the tile, letterboxed,
 * so a 4:3 episode still lines up on the grid.
 */
export function spriteArgs(input: string, rows: number, output: string): string[] {
	const fit =
		`scale=${SPRITE_W}:${SPRITE_H}:force_original_aspect_ratio=decrease,` +
		`pad=${SPRITE_W}:${SPRITE_H}:(ow-iw)/2:(oh-ih)/2`;
	return [
		'-hide_banner',
		'-loglevel',
		'error',
		'-skip_frame',
		'nokey',
		'-i',
		input,
		'-an',
		'-sn',
		'-vf',
		// eof_action=pass keeps the last mark's frame: by default the filter
		// drops it at the end of the input (a 22 s file gave 2 frames, not 3).
		`fps=1/${SPRITE_EVERY_S}:eof_action=pass,${fit},tile=${SPRITE_COLS}x${rows}`,
		'-frames:v',
		'1',
		'-q:v',
		'5',
		'-y',
		output
	];
}

function run(args: string[]): Promise<void> {
	return new Promise((ok, no) => {
		const p = spawn(FFMPEG(), args, { stdio: ['ignore', 'ignore', 'pipe'] });
		let err = '';
		p.stderr.on('data', (b: Buffer) => (err += b.toString()));
		p.on('error', (e) => no(new Error(`ffmpeg didn't start: ${e.message}`)));
		p.on('close', (code) =>
			code === 0 ? ok() : no(new Error(err.trim().split('\n').pop() || `ffmpeg exited ${code}`))
		);
	});
}

/**
 * Makes the episode's sprite now, from its downloaded file. Returns it, or
 * null when the episode has no file (or ffmpeg could not read it). A sprite
 * already current is returned as it is.
 */
export async function makeSprite(entryId: number, now = Date.now()): Promise<Sprite | null> {
	const have = await currentSprite(entryId);
	if (have) return have;
	const file = episodeFile(entryId);
	if (!file) return null;
	const before = await fileStamp(file);
	const length = await lengthOf(file);
	if (!before || !length) return null;
	const count = Math.max(1, Math.ceil(length / SPRITE_EVERY_S));
	const rows = Math.ceil(count / SPRITE_COLS);
	await mkdir(join(coverDir(), 'episodes'), { recursive: true });
	const partial = `${spritePath(entryId)}.partial.jpg`;
	try {
		await run(spriteArgs(file, rows, partial));
	} catch (e) {
		await rm(partial, { force: true });
		throw e;
	}
	// The file changed while it was read (a download finishing over it): the
	// sheet is of neither, so it is not kept.
	const after = await fileStamp(file);
	if (!after || after.bytes !== before.bytes || after.mtimeMs !== before.mtimeMs) {
		await rm(partial, { force: true });
		return null;
	}
	await rename(partial, spritePath(entryId));
	const meta: SpriteMeta = {
		file,
		...before,
		everyS: SPRITE_EVERY_S,
		w: SPRITE_W,
		h: SPRITE_H,
		cols: SPRITE_COLS,
		count,
		madeAt: now
	};
	await writeFile(metaPath(entryId), JSON.stringify(meta));
	return currentSprite(entryId);
}

// ---- the queue ------------------------------------------------------------------------------------

const queue = new Set<number>();
const failedAt = new Map<number, number>();
let draining: Promise<void> | null = null;

/**
 * Asks for an episode's sprite, in the background, one at a time: only for
 * an episode with a downloaded file, and not one tried and failed within
 * `SPRITE_RETRY_MS`. The player's resolve asks (the videos route), never a
 * page load, and incognito never does. A hidden series' episode gets one
 * too: the file is local, and reading it tells nobody anything.
 */
export function wantSprite(entryId: number): void {
	const at = failedAt.get(entryId);
	if (at !== undefined && Date.now() - at < SPRITE_RETRY_MS) return;
	if (!episodeFile(entryId)) return;
	queue.add(entryId);
	if (!draining)
		draining = drain().finally(() => {
			draining = null;
		});
}

async function drain(): Promise<void> {
	while (queue.size) {
		const id = queue.values().next().value!;
		queue.delete(id);
		const made = await makeSprite(id).catch(() => null);
		if (made) failedAt.delete(id);
		else failedAt.set(id, Date.now());
	}
}

/** Resolves when the queue is empty: tests wait on it. */
export const spritesIdle = () => draining ?? Promise.resolve();

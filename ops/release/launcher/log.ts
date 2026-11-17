/**
 * The bundle's logs (doc/LOGS.md, "The logs"): `logs/tsundoku.log`,
 * `engine.log`, `flaresolverr.log` in the data folder. Every line stamped
 * with when and how loud, and each file rotated before it grows past 5 MB,
 * four old ones kept (`tsundoku.log.1` the newest), so a friend's disk never
 * fills with them. Written synchronously: a few lines a second at most, and a
 * line is on disk before a crash can lose it.
 */
import { appendFileSync, existsSync, renameSync, rmSync, statSync } from 'node:fs';

export type Level = 'INFO' | 'ERROR';

export const MAX_BYTES = 5 * 1024 * 1024;
export const KEEP = 4;

/** One line as it's written: `2026-10-30T18:03:23.487Z INFO  text`. */
export const stamp = (at: Date, level: Level, text: string) =>
	`${at.toISOString()} ${level.padEnd(5)} ${text}\n`;

// Plain fields, never constructor parameter properties (`readonly file` in the
// signature): the bundle runs this with Node's own type stripping, which
// refuses them, and 2026.10.30.8's launcher died on it before starting
// anything (tests/strip-types.spec.ts guards every module the bundle runs).
export class Log {
	readonly file: string;
	private o: { max?: number; keep?: number; now?: () => Date };
	private size: number;
	/** What came without its line's end yet, per level. */
	private partial: Record<Level, string> = { INFO: '', ERROR: '' };

	constructor(file: string, o: { max?: number; keep?: number; now?: () => Date } = {}) {
		this.file = file;
		this.o = o;
		this.size = existsSync(file) ? statSync(file).size : 0;
	}

	line(level: Level, text: string) {
		const s = stamp(this.o.now?.() ?? new Date(), level, text);
		if (this.size + s.length > (this.o.max ?? MAX_BYTES) && this.size > 0) this.rotate();
		appendFileSync(this.file, s);
		this.size += Buffer.byteLength(s);
	}

	/** A child's output, as it comes: whole lines stamped, a partial one kept for the next chunk. */
	write(level: Level, chunk: Buffer | string) {
		const lines = (this.partial[level] + chunk.toString()).split(/\r?\n/);
		this.partial[level] = lines.pop() ?? '';
		for (const l of lines) if (l.length) this.line(level, l);
	}

	/** tsundoku.log -> .1 -> .2 ... the oldest past `keep` deleted. */
	private rotate() {
		const keep = this.o.keep ?? KEEP;
		rmSync(`${this.file}.${keep}`, { force: true });
		for (let i = keep - 1; i >= 1; i--)
			if (existsSync(`${this.file}.${i}`)) renameSync(`${this.file}.${i}`, `${this.file}.${i + 1}`);
		renameSync(this.file, `${this.file}.1`);
		this.size = 0;
	}
}

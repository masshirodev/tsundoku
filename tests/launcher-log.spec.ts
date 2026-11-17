import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { Log, stamp } from '../ops/release/launcher/log.ts';

const dir = mkdtempSync(join(tmpdir(), 'tsundoku-log-'));
afterAll(() => rmSync(dir, { recursive: true, force: true }));
const at = new Date('2026-10-30T18:03:23.487Z');

describe('the bundle’s logs', () => {
	it('stamps every line with when and how loud', () => {
		expect(stamp(at, 'INFO', 'Listening')).toBe('2026-10-30T18:03:23.487Z INFO  Listening\n');
		expect(stamp(at, 'ERROR', 'no')).toBe('2026-10-30T18:03:23.487Z ERROR no\n');
	});

	it('stamps a child’s output line by line, keeping a half line for the next chunk', () => {
		const file = join(dir, 'a.log');
		const log = new Log(file, { now: () => at });
		log.write('INFO', 'one\r\ntw');
		log.write('INFO', 'o\n');
		log.write('ERROR', 'bad\n');
		expect(readFileSync(file, 'utf8').split('\n').filter(Boolean)).toEqual([
			'2026-10-30T18:03:23.487Z INFO  one',
			'2026-10-30T18:03:23.487Z INFO  two',
			'2026-10-30T18:03:23.487Z ERROR bad'
		]);
	});

	it('rotates before a file passes its size, keeping a few old ones', () => {
		const file = join(dir, 'b.log');
		const log = new Log(file, { max: 200, keep: 2, now: () => at });
		for (let i = 0; i < 20; i++) log.line('INFO', `line ${i} ${'x'.repeat(20)}`);
		expect(readFileSync(file).length).toBeLessThanOrEqual(200);
		expect(existsSync(`${file}.1`)).toBe(true);
		expect(existsSync(`${file}.2`)).toBe(true);
		expect(existsSync(`${file}.3`)).toBe(false);
		// The newest lines are in the live file; .1 holds the ones just before.
		expect(readFileSync(file, 'utf8')).toContain('line 19');
	});
});

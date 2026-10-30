import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { ensureSetting, ensureToken, newToken } from '../src/lib/server/first-run.ts';

const work = mkdtempSync(join(tmpdir(), 'tsundoku-first-run-'));
afterAll(() => rmSync(work, { recursive: true, force: true }));

describe('ensureToken', () => {
	it('makes a token on first start, in a new folder, readable by the user only', () => {
		const file = join(work, 'a', 'deep', '.env');
		const first = ensureToken(file, () => 'tok-1');
		expect(first).toEqual({ token: 'tok-1', created: true });
		expect(readFileSync(file, 'utf8')).toBe('TSUNDOKU_TOKEN=tok-1\n');
		if (process.platform !== 'win32') expect(statSync(file).mode & 0o777).toBe(0o600);
	});

	it('keeps the one it made', () => {
		const file = join(work, 'b.env');
		ensureToken(file, () => 'tok-1');
		expect(ensureToken(file, () => 'tok-2')).toEqual({ token: 'tok-1', created: false });
	});

	it('reads a quoted token and adds to a file without one', () => {
		const quoted = join(work, 'c.env');
		writeFileSync(quoted, 'PORT=1\nTSUNDOKU_TOKEN="abc"\n');
		expect(ensureToken(quoted, () => 'x').token).toBe('abc');

		const other = join(work, 'd.env');
		writeFileSync(other, 'PORT=1');
		ensureToken(other, () => 'tok');
		expect(readFileSync(other, 'utf8')).toBe('PORT=1\nTSUNDOKU_TOKEN=tok\n');
	});
});

describe('ensureSetting', () => {
	it('keeps each key apart in the same file (the launcher’s ENGINE_TOKEN)', () => {
		const file = join(work, 'e.env');
		ensureToken(file, () => 'sign-in');
		expect(ensureSetting(file, 'ENGINE_TOKEN', () => 'eng')).toEqual({
			value: 'eng',
			created: true
		});
		expect(ensureSetting(file, 'ENGINE_TOKEN', () => 'other').value).toBe('eng');
		expect(ensureToken(file, () => 'x').token).toBe('sign-in');
		expect(readFileSync(file, 'utf8')).toBe('TSUNDOKU_TOKEN=sign-in\nENGINE_TOKEN=eng\n');
	});
});

describe('newToken', () => {
	it('is 24 url-safe characters, different each time', () => {
		const a = newToken();
		expect(a).toMatch(/^[\w-]{24}$/);
		expect(newToken()).not.toBe(a);
	});
});

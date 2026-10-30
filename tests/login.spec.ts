import { mkdtempSync, readFileSync, rmSync, statSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import {
	clearLogin,
	hashPassword,
	makeLogin,
	parseLogin,
	readLogin,
	sessionFor,
	verifyPassword,
	writeLogin
} from '../src/lib/server/login.ts';

const home = mkdtempSync(join(tmpdir(), 'tsundoku-login-'));
afterAll(() => rmSync(home, { recursive: true, force: true }));

describe('a friend’s password (doc/SIGN-IN.md)', () => {
	it('is kept as a salted scrypt hash, and only the password matches it', () => {
		const h = hashPassword('correct horse');
		expect(h).toMatch(/^scrypt\$16384\$8\$1\$[\w-]+\$[\w-]+$/);
		expect(h).not.toContain('correct horse');
		expect(verifyPassword('correct horse', h)).toBe(true);
		expect(verifyPassword('correct hors', h)).toBe(false);
		expect(verifyPassword('', h)).toBe(false);
		// The same password twice is two different hashes.
		expect(hashPassword('correct horse')).not.toBe(h);
	});

	it('refuses a hash it can’t read rather than throwing', () => {
		expect(verifyPassword('x', 'plain')).toBe(false);
		expect(verifyPassword('x', 'scrypt$0$8$1$abc$def')).toBe(false);
		expect(verifyPassword('x', 'scrypt$nope$8$1$abc$def')).toBe(false);
	});

	it('gives every login a new secret, so a change signs every browser out', () => {
		const a = makeLogin('one password');
		const b = makeLogin('one password');
		expect(sessionFor(a)).not.toBe(sessionFor(b));
		expect(sessionFor(a)).toMatch(/^[0-9a-f]{64}$/);
		expect(makeLogin(null)).toMatchObject({ kind: 'none' });
	});

	it('reads only a whole, well-formed login.json', () => {
		const ok = makeLogin('pw-123456');
		expect(parseLogin(JSON.stringify(ok))).toEqual(ok);
		expect(parseLogin(JSON.stringify(makeLogin(null)))).toMatchObject({ kind: 'none' });
		expect(parseLogin(null)).toBeNull();
		expect(parseLogin('{"kind":"none"')).toBeNull();
		expect(parseLogin(JSON.stringify({ kind: 'none', secret: 'short' }))).toBeNull();
		expect(parseLogin(JSON.stringify({ ...ok, hash: 'plain' }))).toBeNull();
		expect(parseLogin(JSON.stringify({ ...ok, kind: 'token' }))).toBeNull();
	});

	it('writes the file whole, for the user alone, and forgets it on a reset', () => {
		expect(readLogin(home)).toBeNull();
		const l = makeLogin('pw-123456');
		writeLogin(home, l);
		expect(readLogin(home)).toEqual(l);
		if (process.platform !== 'win32')
			expect(statSync(join(home, 'login.json')).mode & 0o777).toBe(0o600);
		expect(readFileSync(join(home, 'login.json'), 'utf8')).not.toContain('pw-123456');
		expect(clearLogin(home)).toBe(true);
		expect(readLogin(home)).toBeNull();
		expect(clearLogin(home)).toBe(false);
	});

	it('sees a file changed under it (the launcher’s reset, an edit), not a stale copy', () => {
		const l = makeLogin(null);
		writeLogin(home, l);
		expect(readLogin(home)?.kind).toBe('none');
		writeFileSync(join(home, 'login.json'), 'torn');
		// A new mtime for certain, even on a clock coarser than the two writes.
		const later = new Date(Date.now() + 5000);
		utimesSync(join(home, 'login.json'), later, later);
		expect(readLogin(home)).toBeNull();
	});
});

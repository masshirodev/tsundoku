import {
	createHash,
	randomBytes,
	scryptSync,
	timingSafeEqual,
	type ScryptOptions
} from 'node:crypto';
import { mkdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join } from './fspath.ts';

/**
 * A friend's sign-in (doc/SIGN-IN.md): a password chosen on first
 * open, or none, kept in `TSUNDOKU_HOME/login.json`. The workstation signs in
 * with its token instead (auth.ts), and never has this file.
 *
 * The file holds an scrypt hash, never the password, and a random secret the
 * session cookie is derived from: setting, changing or removing the password
 * makes a new secret, so every browser signed in before has to sign in again.
 * Deleting the file is the reset (`tsundoku --reset-password`): being at the
 * PC is the proof the library is yours.
 *
 * Plain node, no SvelteKit: serve.ts and the launcher read it too.
 */

export const LOGIN_FILE = 'login.json';

export type Login =
	{ kind: 'password'; hash: string; secret: string } | { kind: 'none'; secret: string };

/** Shorter than this is refused: a password a phone on the Wi-Fi could guess isn't one. */
export const MIN_PASSWORD = 6;

// scrypt's defaults since Node 10 (N=2^14, r=8, p=1): about 50 ms here. The
// parameters are kept in the hash so they can grow without breaking old ones.
const N = 16384;
const R = 8;
const P = 1;
const KEYLEN = 32;

export function hashPassword(password: string, salt = randomBytes(16)): string {
	const key = scryptSync(password, salt, KEYLEN, { N, r: R, p: P });
	return `scrypt$${N}$${R}$${P}$${salt.toString('base64url')}$${key.toString('base64url')}`;
}

export function verifyPassword(password: string, hash: string): boolean {
	const [scheme, n, r, p, salt, key] = hash.split('$');
	if (scheme !== 'scrypt' || !salt || !key) return false;
	const opts: ScryptOptions = { N: Number(n), r: Number(r), p: Number(p) };
	if (![opts.N, opts.r, opts.p].every((v) => Number.isInteger(v) && v! > 0)) return false;
	const want = Buffer.from(key, 'base64url');
	try {
		const got = scryptSync(password, Buffer.from(salt, 'base64url'), want.length, opts);
		return timingSafeEqual(got, want);
	} catch {
		return false;
	}
}

/** A new login: a password's hash, or none; either way a new secret. */
export function makeLogin(password: string | null): Login {
	const secret = randomBytes(32).toString('base64url');
	return password === null
		? { kind: 'none', secret }
		: { kind: 'password', hash: hashPassword(password), secret };
}

/** A login.json's contents, or null for anything that isn't one. */
export function parseLogin(text: string | null | undefined): Login | null {
	if (!text) return null;
	try {
		const l = JSON.parse(text) as Partial<Login> & { hash?: unknown };
		if (typeof l.secret !== 'string' || l.secret.length < 16) return null;
		if (l.kind === 'none') return { kind: 'none', secret: l.secret };
		if (l.kind === 'password' && typeof l.hash === 'string' && l.hash.startsWith('scrypt$'))
			return { kind: 'password', hash: l.hash, secret: l.secret };
	} catch {
		// Torn or hand-edited: as if there were none, so SET UP asks again.
	}
	return null;
}

/** The session cookie's value for this login. Changes with the secret, never with the password alone. */
export function sessionFor(login: Login): string {
	return createHash('sha256').update(`tsundoku/login/v1:${login.secret}`).digest('hex');
}

export const loginPath = (home: string) => join(home, LOGIN_FILE);

// Read on every request, so a reset from the launcher (the file deleted while
// the app runs) shows SET UP at once; kept while the file's mtime is the same.
let cached: { file: string; mtimeMs: number; login: Login | null } | null = null;

export function readLogin(home: string): Login | null {
	const file = loginPath(home);
	let mtimeMs: number;
	try {
		mtimeMs = statSync(file).mtimeMs;
	} catch {
		cached = null;
		return null;
	}
	if (cached?.file === file && cached.mtimeMs === mtimeMs) return cached.login;
	let login: Login | null = null;
	try {
		login = parseLogin(readFileSync(file, 'utf8'));
	} catch {
		// Unreadable: as absent.
	}
	cached = { file, mtimeMs, login };
	return login;
}

/** Written whole and renamed into place, readable by the user alone. */
export function writeLogin(home: string, login: Login): void {
	const file = loginPath(home);
	mkdirSync(home, { recursive: true });
	const tmp = `${file}.${process.pid}.tmp`;
	writeFileSync(tmp, JSON.stringify(login) + '\n', { mode: 0o600 });
	renameSync(tmp, file);
	cached = null;
}

/** Forget the login: the next open is SET UP. True if there was one. */
export function clearLogin(home: string): boolean {
	const file = loginPath(home);
	let had = true;
	try {
		statSync(file);
	} catch {
		had = false;
	}
	rmSync(file, { force: true });
	cached = null;
	return had;
}

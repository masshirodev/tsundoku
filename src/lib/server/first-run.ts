import { randomBytes } from 'node:crypto';
import { appendFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs';
import { dirname } from './fspath.ts';

/**
 * A friend's first start (doc/DISTRIBUTION.md, "The local serve mode"). The
 * developer's install makes its token by hand and keeps it in a secrets manager;
 * a friend's install has neither, and an app that exits with "TSUNDOKU_TOKEN is
 * not set" is an app that was never opened. So serve.ts makes one, once, and
 * keeps it in the data folder's own .env, where it is read on every start after.
 */

/** 18 random bytes, as the README's one-liner has always made them. */
export const newToken = () => randomBytes(18).toString('base64url');

/**
 * The value of `key` in `file`, adding a new one if the file has none.
 * Returns it and whether it was made just now, so the caller can say so
 * once. The file is the user's own: only ever appended to, created with
 * mode 600. The launcher keeps ENGINE_TOKEN this way too (doc/RELEASE.md).
 */
export function ensureSetting(file: string, key: string, make: () => string) {
	const text = existsSync(file) ? readFileSync(file, 'utf8') : '';
	const found = new RegExp(`^${key}=["']?([^"'\\r\\n]+)["']?\\s*$`, 'm').exec(text)?.[1];
	if (found) return { value: found, created: false };
	const value = make();
	mkdirSync(dirname(file), { recursive: true });
	const sep = text === '' || text.endsWith('\n') ? '' : '\n';
	appendFileSync(file, `${sep}${key}=${value}\n`, { mode: 0o600 });
	return { value, created: true };
}

/** The sign-in token in `file`, made on a first start (serve.ts). */
export function ensureToken(file: string, make: () => string = newToken) {
	const { value, created } = ensureSetting(file, 'TSUNDOKU_TOKEN', make);
	return { token: value, created };
}

import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import type { Cookies } from '@sveltejs/kit';
import { getDb } from './db.ts';
import { SESSION_COOKIE } from './session.ts';

/**
 * Reveal and theme live in cookies because the server needs both before it
 * renders: reveal decides which rows are even queried, and the theme has to be
 * on <html> in the first byte or a light-mode reader gets a dark flash.
 *
 * Reveal is a session cookie on purpose -- no maxAge -- so closing the app is
 * another way it turns itself off, and its value carries an expiry of its own
 * besides (revealValue, below). The theme persists.
 */
export const REVEAL_COOKIE = 'tsundoku_reveal';
export const THEME_COOKIE = 'tsundoku_theme';
/**
 * Incognito reading (doc/PRIVACY.md): while set, the reader's progress calls
 * are refused before they reach the log. A session cookie like reveal; END
 * ends it, and a trip to the background does not.
 */
export const INCOGNITO_COOKIE = 'tsundoku_incognito';

/**
 * Set by the app once its script runs (routes/+layout.svelte). Streamed data
 * needs script to resolve, so a page that streams (a slow source in BROWSE)
 * awaits it on the server for a browser without, rather than draw its
 * waiting state forever. A first visit with script awaits too, once.
 */
export const SCRIPT_COOKIE = 'tsundoku_js';

export const hasScript = (cookies: Cookies): boolean => cookies.get(SCRIPT_COOKIE) === '1';

export type Theme = 'dark' | 'light';

/**
 * Reveal is a signed value, not a flag. A flag could be set by anyone holding
 * the session (a paired TV, a browser's devtools), which would make the
 * fingerprint gate (doc/PRIVACY.md) a page-side courtesy rather than the
 * server's rule. Only the server can make this value: `v1.<expiry>.<mac>`, an
 * HMAC over the purpose, the expiry and a hash of the session cookie it was
 * made beside, with a key that never leaves the database.
 *
 * The session binding means signing in again (a rotated token, a changed
 * password) ends reveal, and a value lifted from one browser's session is
 * nothing to a device signed in another way. The expiry is a backstop for a
 * browser that keeps its session cookies for days, as an installed app may:
 * reveal never outlives it, however the app was closed.
 */
export const REVEAL_TTL_MS = 12 * 60 * 60_000;
const REVEAL_KEY = 'reveal_key';

/**
 * The install's reveal key: 32 random bytes made on first use and kept in the
 * `settings` table, so a restart doesn't end reveal and every process serving
 * the same database agrees. Not one of the SETTINGS screen's keys
 * (settings.ts), so no page reads or posts it.
 */
function revealKey(): Buffer {
	const db = getDb();
	const known = revealKeys.get(db);
	if (known) return known;
	const read = () =>
		db.prepare(`SELECT value FROM settings WHERE key = ?`).get(REVEAL_KEY) as
			{ value: string } | undefined;
	// Read first: every request asks, and an INSERT, even one that ends up
	// ignored, would take the write lock behind a running import.
	let row = read();
	if (!row) {
		db.prepare(`INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)`).run(
			REVEAL_KEY,
			randomBytes(32).toString('base64url')
		);
		row = read()!;
	}
	const key = Buffer.from(row.value, 'base64url');
	revealKeys.set(db, key);
	return key;
}
/** Per database handle, so a spec's fresh in-memory database gets a key of its own. */
const revealKeys = new WeakMap<object, Buffer>();

const sessionHash = (session: string | undefined) =>
	createHash('sha256')
		.update(session ?? '')
		.digest('base64url');

const revealMac = (expires: number, session: string | undefined) =>
	createHmac('sha256', revealKey())
		.update(`tsundoku/reveal/v1:${expires}:${sessionHash(session)}`)
		.digest();

/** A reveal value for the session cookie it will sit beside, good until `now + REVEAL_TTL_MS`. */
export function revealValue(session: string | undefined, now = Date.now()): string {
	const expires = now + REVEAL_TTL_MS;
	return `v1.${expires}.${revealMac(expires, session).toString('base64url')}`;
}

/** Whether `value` is one the server made for this session and it hasn't run out. */
export function revealValid(
	value: string | undefined,
	session: string | undefined,
	now = Date.now()
): boolean {
	const m = /^v1\.(\d{1,15})\.([A-Za-z0-9_-]{43})$/.exec(value ?? '');
	if (!m) return false;
	const expires = Number(m[1]);
	// Later than a fresh value could be is not one the server made.
	if (expires <= now || expires > now + REVEAL_TTL_MS) return false;
	return timingSafeEqual(Buffer.from(m[2], 'base64url'), revealMac(expires, session));
}

export function isRevealed(cookies: Cookies): boolean {
	return revealValid(cookies.get(REVEAL_COOKIE), cookies.get(SESSION_COOKIE));
}

export function setRevealed(cookies: Cookies, on: boolean, secure: boolean): void {
	if (on)
		cookies.set(REVEAL_COOKIE, revealValue(cookies.get(SESSION_COOKIE)), {
			path: '/',
			httpOnly: true,
			sameSite: 'lax',
			secure
		});
	else cookies.delete(REVEAL_COOKIE, { path: '/' });
}

export function isIncognito(cookies: Cookies): boolean {
	return cookies.get(INCOGNITO_COOKIE) === '1';
}

export function setIncognito(cookies: Cookies, on: boolean, secure: boolean): void {
	if (on)
		cookies.set(INCOGNITO_COOKIE, '1', { path: '/', httpOnly: true, sameSite: 'lax', secure });
	else cookies.delete(INCOGNITO_COOKIE, { path: '/' });
}

export function themeOf(cookies: Cookies): Theme {
	return cookies.get(THEME_COOKIE) === 'light' ? 'light' : 'dark';
}

export function setTheme(cookies: Cookies, theme: Theme, secure: boolean): void {
	cookies.set(THEME_COOKIE, theme, {
		path: '/',
		httpOnly: false,
		sameSite: 'lax',
		secure,
		maxAge: 60 * 60 * 24 * 365
	});
}

/**
 * Apply a search-field command. Shared by the search form, the reveal banner
 * and the incognito band. `incognito-end` is END's, not something typed.
 */
export function runCommand(
	cookies: Cookies,
	command: string,
	url: URL,
	opts: { gated?: boolean } = {}
): boolean {
	const secure = url.protocol === 'https:';
	// Behind the fingerprint gate, reveal only comes from /api/unlock/verify
	// (doc/PRIVACY.md): a plain POST of "/reveal" does nothing.
	if (command === 'reveal') {
		if (opts.gated) return false;
		setRevealed(cookies, true, secure);
	} else if (command === 'hide') setRevealed(cookies, false, secure);
	else if (command === 'light' || command === 'dark') setTheme(cookies, command, secure);
	else if (command === 'incognito') setIncognito(cookies, true, secure);
	else if (command === 'incognito-end') setIncognito(cookies, false, secure);
	else return false;
	return true;
}

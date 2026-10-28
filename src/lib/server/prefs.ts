import type { Cookies } from '@sveltejs/kit';

/**
 * Reveal and theme live in cookies because the server needs both before it
 * renders: reveal decides which rows are even queried, and the theme has to be
 * on <html> in the first byte or a light-mode reader gets a dark flash.
 *
 * Reveal is a session cookie on purpose -- no maxAge -- so closing the app is
 * another way it turns itself off. The theme persists.
 */
export const REVEAL_COOKIE = 'tsundoku_reveal';
export const THEME_COOKIE = 'tsundoku_theme';
/**
 * Incognito reading (doc/PRIVACY.md): while set, the reader's progress calls
 * are refused before they reach the log. A session cookie like reveal, and
 * like reveal it ends when the app goes to the background.
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

export function isRevealed(cookies: Cookies): boolean {
	return cookies.get(REVEAL_COOKIE) === '1';
}

export function setRevealed(cookies: Cookies, on: boolean, secure: boolean): void {
	if (on) cookies.set(REVEAL_COOKIE, '1', { path: '/', httpOnly: true, sameSite: 'lax', secure });
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

/** Leaving the app ends both session modes: nothing hidden or untracked survives a trip to the background. */
export function endSessionModes(cookies: Cookies): boolean {
	const was = isRevealed(cookies) || isIncognito(cookies);
	cookies.delete(REVEAL_COOKIE, { path: '/' });
	cookies.delete(INCOGNITO_COOKIE, { path: '/' });
	return was;
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

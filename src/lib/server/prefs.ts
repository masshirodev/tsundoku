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

export type Theme = 'dark' | 'light';

export function isRevealed(cookies: Cookies): boolean {
	return cookies.get(REVEAL_COOKIE) === '1';
}

export function setRevealed(cookies: Cookies, on: boolean, secure: boolean): void {
	if (on) cookies.set(REVEAL_COOKIE, '1', { path: '/', httpOnly: true, sameSite: 'lax', secure });
	else cookies.delete(REVEAL_COOKIE, { path: '/' });
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

/** Apply a search-field command. Shared by the search form and the reveal banner. */
export function runCommand(cookies: Cookies, command: string, url: URL): boolean {
	const secure = url.protocol === 'https:';
	if (command === 'reveal') setRevealed(cookies, true, secure);
	else if (command === 'hide') setRevealed(cookies, false, secure);
	else if (command === 'light' || command === 'dark') setTheme(cookies, command, secure);
	else return false;
	return true;
}

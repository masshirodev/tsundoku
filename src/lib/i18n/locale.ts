import { baseLocale, isLocale, locales, type Locale } from '../paraglide/runtime.js';

/**
 * Which language a device reads tsundoku in (doc/I18N.md). AUTO follows the
 * browser (Accept-Language); a choice in SETTINGS › 08 — DEVICES is this
 * cookie, set only by that choice, so AUTO stays AUTO when the browser's
 * language changes later.
 */
export const LANG_COOKIE = 'tsundoku_lang';

export type LangChoice = 'auto' | Locale;

/** The cookie's value as a locale, or none (AUTO, or something we never wrote). */
export function chosenLocale(raw: string | null | undefined): Locale | undefined {
	return raw && isLocale(raw) ? raw : undefined;
}

/** A request's cookie header, read for the language cookie alone. */
export function localeFromCookieHeader(header: string | null): Locale | undefined {
	const hit = header
		?.split(';')
		.map((c) => c.trim())
		.find((c) => c.startsWith(`${LANG_COOKIE}=`));
	return chosenLocale(hit ? decodeURIComponent(hit.slice(LANG_COOKIE.length + 1)) : undefined);
}

/** What <html lang> says, for the client: the server already decided (hooks.server.ts). */
export const localeFromLang = (lang: string | undefined): Locale =>
	chosenLocale(lang) ?? baseLocale;

/** Each language by its own name, as a picker lists them: a reader finds theirs without reading ours. */
export const ENDONYMS: Record<Locale, string> = {
	en: 'ENGLISH',
	'pt-BR': 'PORTUGUÊS (BRASIL)'
};

export const LOCALES: readonly Locale[] = locales;

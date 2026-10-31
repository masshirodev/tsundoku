import { overwriteGetLocale } from '$lib/paraglide/runtime';
import { localeFromLang } from '$lib/i18n/locale';

/**
 * The browser never decides the language itself (doc/I18N.md): the server
 * did, from the device's choice or Accept-Language, and wrote it on <html>.
 * Reading it back means the hydrated page can't disagree with the first one.
 */
export const init = () => {
	const locale = localeFromLang(document.documentElement.lang);
	overwriteGetLocale(() => locale);
};

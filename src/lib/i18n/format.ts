import { getLocale } from '../paraglide/runtime.js';

/**
 * Numbers and dates in the reader's language (doc/I18N.md), never a fixed
 * 'en-US': 1,234 in English is 1.234 in Portuguese.
 */
export const num = (n: number): string => n.toLocaleString(getLocale());

/** Upper case by the language's rules, for a title shown in a mono label. */
export const upper = (s: string): string => s.toLocaleUpperCase(getLocale());

import { getDb } from './db.ts';

/**
 * The library's own preferences (the SETTINGS screen; rung 24's `settings`),
 * as opposed to a device's (the READING sheet, in each browser): the language
 * a folded book opens in (doc/EDITIONS.md), when the download queue was paused
 * from tsundoku (doc/DOWNLOADING.md; '' while it isn't), and the languages
 * BROWSE lists sources in (doc/BROWSE.md).
 */
const DEFAULTS = {
	edition_language: 'english',
	downloads_paused_at: '',
	// The languages BROWSE lists sources in, and the available extensions open
	// filtered to (doc/BROWSE.md): the owner reads English and Japanese.
	browse_languages: 'en,ja'
} as const;
export type SettingKey = keyof typeof DEFAULTS;

export function getSetting(key: SettingKey): string {
	const row = getDb().prepare(`SELECT value FROM settings WHERE key = ?`).get(key) as
		{ value: string } | undefined;
	return row?.value ?? DEFAULTS[key];
}

export function setSetting(key: SettingKey, value: string): void {
	getDb()
		.prepare(
			`INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value`
		)
		.run(key, value);
}

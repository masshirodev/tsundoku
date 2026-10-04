import { getDb } from './db.ts';

/**
 * The library's own preferences (the SETTINGS screen; rung 24's `settings`),
 * as opposed to a device's (the READING sheet, in each browser). Two keys so
 * far: the language a folded book opens in (doc/EDITIONS.md), and when the
 * download queue was paused from tsundoku (doc/DOWNLOADING.md); '' while it isn't.
 */
const DEFAULTS = { edition_language: 'english', downloads_paused_at: '' } as const;
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

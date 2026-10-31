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
	browse_languages: 'en,ja',
	// The height episodes download at (doc/ANIME.md, "Downloading"; default 3).
	anime_download_quality: '1080',
	// The rest are the SETTINGS page's (doc/SETTINGS.md; card c171). Where a
	// series of each kind starts reading, until it remembers its own.
	mode_manga: 'rtl',
	mode_manhwa: 'vertical',
	mode_doujin: 'rtl',
	mode_novel: 'paged',
	// What every anime starts in. '' is FOLLOW THE PLAYER: the last choice made
	// on any anime stands in (anime_last), else the source's original.
	anime_audio_default: '',
	anime_subs_default: '',
	anime_subsize_default: '',
	// The player's last choice on any anime, with where and when: JSON, or ''.
	anime_last: '',
	// Audio a download keeps beside the original, comma-separated; '' keeps
	// every track (c160). Subtitles: 'all', or 'audio' for the same languages.
	anime_download_audio: '',
	anime_download_subs: 'all',
	// GET STARTED's skipped steps (doc/ONBOARDING.md; card c208): a JSON list,
	// kept on the computer so the PC and a paired phone show the same list.
	start_skipped: '[]'
} as const;
export type SettingKey = keyof typeof DEFAULTS;

export function getSetting(key: SettingKey): string {
	const row = getDb().prepare(`SELECT value FROM settings WHERE key = ?`).get(key) as
		{ value: string } | undefined;
	return row?.value ?? DEFAULTS[key];
}

/** Is this one of the library's keys? (The page posts them by name.) */
export const isSettingKey = (key: string): key is SettingKey => key in DEFAULTS;

export const settingDefault = (key: SettingKey): string => DEFAULTS[key];

/** Back to the default: the row goes, so a later change of default reaches it. */
export function clearSetting(key: SettingKey): void {
	getDb().prepare(`DELETE FROM settings WHERE key = ?`).run(key);
}

/** Whether the owner set it, as opposed to it standing at its default. */
export function isSet(key: SettingKey): boolean {
	return !!getDb().prepare(`SELECT 1 FROM settings WHERE key = ?`).get(key);
}

export function setSetting(key: SettingKey, value: string): void {
	getDb()
		.prepare(
			`INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value`
		)
		.run(key, value);
}

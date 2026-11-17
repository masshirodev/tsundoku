import { getDb } from '../db.ts';
import { clearSetting, getSetting, setSetting } from '../settings.ts';
import { visibleWhere } from '../visibility.ts';
import { SUB_SIZES, type SubSize } from '../../library/player.ts';

/**
 * What the player starts an anime in (doc/ANIME.md, "The player";
 * doc/SETTINGS.md, "Watching"). The server keeps a series' audio and
 * subtitles, and the last choice on any anime, not each browser, so SETTINGS
 * can set a default every anime starts in and list the series that differ
 * from it.
 *
 * Where a track comes from, first that answers: the series' own choice, the
 * default set on SETTINGS, the last choice made on any anime (FOLLOW THE
 * PLAYER), then the source's original for audio (question 3) and the
 * device's language for subtitles.
 */

export type What = 'audio' | 'subs' | 'subsize';
export const WHATS: What[] = ['audio', 'subs', 'subsize'];

/** A choice: a track's language, null for subtitles off, or a subtitle size. */
export type Choice = { audio?: string; subs?: string | null; subsize?: SubSize };

export type PlayerStart = {
	/** This series' own choice, field by field. */
	series: Choice;
	/** SETTINGS' default; a field missing is FOLLOW THE PLAYER. */
	defaults: Choice;
	/** The last choice on any anime. */
	last: Choice;
};

type Last = Partial<Record<What, { v: string | null; seriesId: number; at: number }>>;

/**
 * A track's code (langCode): two or three capitals, and a variant or two
 * after them -- PT-BR, ES-419, ZH-HANT, and ES-2 for the second of two
 * tracks that came to the same code. A whole word ("HUNGARIAN", which the
 * sheet once showed) never passed, so none is kept.
 */
const isLang = (v: unknown): v is string =>
	typeof v === 'string' && /^[A-Z]{2,3}(-[A-Z0-9]{1,4}){0,2}$/.test(v);

/** Only what a choice can be: a browser's word is checked. */
export function cleanChoice(what: What, v: unknown): string | null | undefined {
	if (what === 'audio') return isLang(v) ? v : undefined;
	if (what === 'subs') return v === null ? null : isLang(v) ? v : undefined;
	return (SUB_SIZES as readonly unknown[]).includes(v) ? (v as SubSize) : undefined;
}

function seriesChoice(seriesId: number): Choice {
	const r = getDb()
		.prepare(`SELECT choice FROM series_player WHERE series_id = ?`)
		.get(seriesId) as { choice: string } | undefined;
	return r ? (JSON.parse(r.choice) as Choice) : {};
}

function last(): Last {
	const raw = getSetting('anime_last');
	return raw ? (JSON.parse(raw) as Last) : {};
}

const DEFAULT_KEY = {
	audio: 'anime_audio_default',
	subs: 'anime_subs_default',
	subsize: 'anime_subsize_default'
} as const;

/** SETTINGS' defaults; '' is none set, and subtitles 'off' is off. */
export function defaults(): Choice {
	const out: Choice = {};
	const audio = getSetting('anime_audio_default');
	if (audio) out.audio = audio;
	const subs = getSetting('anime_subs_default');
	if (subs) out.subs = subs === 'off' ? null : subs;
	const size = getSetting('anime_subsize_default');
	if (size) out.subsize = size as SubSize;
	return out;
}

export function playerStart(seriesId: number): PlayerStart {
	const l = last();
	const lastChoice: Choice = {};
	if (l.audio?.v) lastChoice.audio = l.audio.v;
	if (l.subs) lastChoice.subs = l.subs.v;
	if (l.subsize?.v) lastChoice.subsize = l.subsize.v as SubSize;
	return { series: seriesChoice(seriesId), defaults: defaults(), last: lastChoice };
}

/** A choice made in the player's sheet: this series', and the last on any anime. */
export function choose(seriesId: number, what: What, v: string | null, now = Date.now()): void {
	const db = getDb();
	const choice = { ...seriesChoice(seriesId), [what]: v };
	db.prepare(
		`INSERT INTO series_player (series_id, choice, chosen_at) VALUES (?, ?, ?)
		ON CONFLICT (series_id) DO UPDATE SET choice = excluded.choice, chosen_at = excluded.chosen_at`
	).run(seriesId, JSON.stringify(choice), now);
	setSetting('anime_last', JSON.stringify({ ...last(), [what]: { v, seriesId, at: now } }));
}

/** A default set on SETTINGS; undefined is FOLLOW THE PLAYER again. */
export function setDefault(what: What, v: string | null | undefined): void {
	if (v === undefined) return clearSetting(DEFAULT_KEY[what]);
	setSetting(DEFAULT_KEY[what], v === null ? 'off' : v);
}

export type Override = {
	seriesId: number;
	title: string;
	value: string | null;
	chosenAt: number;
};

/**
 * The series that differ (N SERIES DIFFER →, 2A): with a default set, each
 * whose own choice is another; with none, each that has one of its own.
 * Hidden series only with reveal on, as every list.
 */
export function overrides(what: 'audio' | 'subs', reveal: boolean): Override[] {
	const def = defaults()[what];
	const rows = getDb()
		.prepare(
			`SELECT p.series_id, s.title, p.choice, p.chosen_at FROM series_player p
			JOIN series s ON s.id = p.series_id JOIN roots r ON r.id = s.root_id
			WHERE ${visibleWhere(reveal)} ORDER BY p.chosen_at DESC`
		)
		.all() as { series_id: number; title: string; choice: string; chosen_at: number }[];
	return rows.flatMap((r) => {
		const c = JSON.parse(r.choice) as Choice;
		if (!(what in c)) return [];
		const v = c[what] ?? null;
		if (def !== undefined && v === def) return [];
		return [{ seriesId: r.series_id, title: r.title, value: v, chosenAt: r.chosen_at }];
	});
}

/** ✕ on one override, or CLEAR ALL N: the series goes back to the default. */
export function clearOverride(what: 'audio' | 'subs', seriesIds: number[]): void {
	const db = getDb();
	const get = db.prepare(`SELECT choice FROM series_player WHERE series_id = ?`);
	const put = db.prepare(`UPDATE series_player SET choice = ? WHERE series_id = ?`);
	const drop = db.prepare(`DELETE FROM series_player WHERE series_id = ?`);
	db.transaction(() => {
		for (const id of seriesIds) {
			const r = get.get(id) as { choice: string } | undefined;
			if (!r) continue;
			const c = JSON.parse(r.choice) as Choice;
			delete c[what];
			// The size goes with the track: it was chosen for it.
			if (what === 'subs') delete c.subsize;
			if (Object.keys(c).length) put.run(JSON.stringify(c), id);
			else drop.run(id);
		}
	})();
}

/**
 * The last choice, for WATCHING's meta line: "JA, ON HOLLIN'S FERRY". A
 * hidden series isn't named while reveal is off.
 */
export function lastChoice(
	what: What,
	reveal: boolean
): { v: string | null; title: string | null; at: number } | null {
	const l = last()[what];
	if (!l) return null;
	const s = getDb()
		.prepare(
			`SELECT s.title FROM series s JOIN roots r ON r.id = s.root_id WHERE s.id = ? AND ${visibleWhere(reveal)}`
		)
		.get(l.seriesId) as { title: string } | undefined;
	return { v: l.v, title: s?.title ?? null, at: l.at };
}

/**
 * What a browser kept before the server did (`tsundoku:anime:<series>:<what>`,
 * and `tsundoku:anime:<what>` for the last choice), taken once: a series' choice
 * here already is newer, so it stays.
 */
export function adoptLegacy(keys: Record<string, unknown>, now = Date.now()): number {
	const db = getDb();
	const has = db.prepare(`SELECT 1 FROM series_player WHERE series_id = ?`);
	const exists = db.prepare(`SELECT 1 FROM series WHERE id = ? AND kind = 'anime'`);
	const put = db.prepare(
		`INSERT INTO series_player (series_id, choice, chosen_at) VALUES (?, ?, ?)`
	);
	const bySeries = new Map<number, Choice>();
	const lastOut: Choice = {};
	for (const [k, raw] of Object.entries(keys)) {
		const m = /^tsundoku:anime:(?:(\d+):)?(audio|subs|subsize)$/.exec(k);
		if (!m) continue;
		const what = m[2] as What;
		const v = cleanChoice(what, raw);
		if (v === undefined) continue;
		if (m[1] === undefined) Object.assign(lastOut, { [what]: v });
		else {
			const id = Number(m[1]);
			bySeries.set(id, { ...bySeries.get(id), [what]: v });
		}
	}
	let n = 0;
	db.transaction(() => {
		for (const [id, c] of bySeries)
			if (exists.get(id) && !has.get(id)) {
				put.run(id, JSON.stringify(c), now);
				n += 1;
			}
		if (!getSetting('anime_last') && Object.keys(lastOut).length)
			setSetting(
				'anime_last',
				JSON.stringify(
					Object.fromEntries(
						Object.entries(lastOut).map(([w, v]) => [w, { v, seriesId: 0, at: now }])
					)
				)
			);
	})();
	return n;
}

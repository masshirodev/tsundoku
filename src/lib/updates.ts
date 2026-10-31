import { formatBytes } from './library/series.ts';
import { m } from './paraglide/messages.js';
import { getLocale } from './paraglide/runtime.js';
import { upper } from './i18n/format.ts';

/**
 * A new version, told in the browser (doc/UPDATES.md): the modal on entry
 * (Getting Started handoff, board 4; card c208), the library's bands, and
 * SETTINGS › UPDATES. The words and the rules for when it asks are here,
 * pure; `installAndWait` is the one loop both SETTINGS and the modal run.
 * The words are the reader's language (doc/I18N.md), made when asked for.
 */

/** The server's view, as GET /api/updates and the layout give it (server/updates.ts). */
export type Install =
	| { phase: 'downloading'; bytes: number; total: number }
	| { phase: 'installing' }
	| { phase: 'failed'; error: string };
export type UpdateView = {
	current: string;
	checkedAt: number | null;
	available: { version: string; date: string; notes: string; size: number | null } | null;
	platform: 'windows' | 'linux' | 'other';
	how: 'install' | 'download';
	download: string | null;
	error: string | null;
	install: Install | null;
};

/**
 * LATER snoozes the modal for a day, for that version (the owner, 2026-10-30:
 * "later can mean a day... they can still update through the settings").
 * The handoff drew "quiet until the next version"; the owner's call wins.
 */
export const SNOOZE_MS = 24 * 60 * 60 * 1000;
export const LATER_KEY = 'tsundoku.update.later';
/** The version UPDATE was pressed for, so the reload onto it can say UPDATED TO. */
export const DONE_KEY = 'tsundoku.update.done';

export type Later = { version: string; until: number };

export function parseLater(raw: string | null): Later | null {
	try {
		const v = JSON.parse(raw ?? 'null') as Partial<Later> | null;
		return v && typeof v.version === 'string' && typeof v.until === 'number'
			? { version: v.version, until: v.until }
			: null;
	} catch {
		return null;
	}
}

/** Whether the modal asks about `version` now: not while LATER's day for it runs. */
export function asks(version: string, later: Later | null, now: number): boolean {
	return !(later && later.version === version && now < later.until);
}

export const laterFor = (version: string, now: number): Later => ({
	version,
	until: now + SNOOZE_MS
});

/** The release notes, a line each: the manifest keeps them as lines of one string. */
export const noteLines = (notes: string) =>
	notes
		.split(/\r?\n/)
		.map((l) => l.trim())
		.filter(Boolean);

/** "2026-11-02" as the modal says it: "2 NOV". Anything else as it came. */
export function releasedOn(date: string): string {
	const d = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
	if (!d || Number(d[2]) < 1 || Number(d[2]) > 12) return date.toUpperCase();
	const month = new Intl.DateTimeFormat(getLocale(), { month: 'short', timeZone: 'UTC' })
		.format(Date.UTC(Number(d[1]), Number(d[2]) - 1, 1))
		.replace('.', '');
	return `${Number(d[3])} ${upper(month)}`;
}

/** The modal's meta line: "RELEASED 2 NOV · 182 MB · SIGNED BY TSUNDOKU'S RELEASE KEY". */
export function offerMeta(v: Pick<UpdateView, 'available' | 'how' | 'platform'>): string {
	if (!v.available) return '';
	const size = v.available.size ? formatBytes(v.available.size) : '';
	const parts: string[] = [m.update_released({ date: releasedOn(v.available.date) })];
	if (v.how === 'download' && v.platform !== 'other') parts.push(v.platform.toUpperCase());
	if (size) parts.push(size);
	parts.push(v.how === 'install' ? m.update_signed_key() : m.update_signed());
	return parts.join(' · ');
}

/**
 * "76 OF 182 MB · 41%": what's come counted in the total's own unit, whole
 * where the total is, so the two read alike (board 4A).
 */
export function downloadLine(i: { bytes: number; total: number }): string {
	const pct = i.total > 0 ? Math.floor((i.bytes / i.total) * 100) : 0;
	return `${amount(i)} · ${pct}%`;
}

/** "76 OF 182 MB", the part of downloadLine the library's band says too. */
function amount(i: { bytes: number; total: number }): string {
	const of = formatBytes(i.total);
	const k = Math.max(0, ['B', 'KB', 'MB', 'GB', 'TB'].indexOf(of.split(' ')[1] ?? 'B'));
	const inUnit = i.bytes / 1000 ** k;
	const whole = /^\d+ /.test(of);
	const got = whole ? String(Math.floor(inUnit)) : inUnit.toFixed(1);
	return m.update_amount({ got, of });
}

export const percent = (i: { bytes: number; total: number }) =>
	i.total > 0 ? Math.min(1, i.bytes / i.total) : 0;

/** The waiting clock: "0:24". */
export function clock(ms: number): string {
	const s = Math.max(0, Math.floor(ms / 1000));
	return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

/**
 * The library's band while an UPDATE runs with its modal hidden (board 4F):
 * what it's doing, in two lines. Null when nothing runs.
 */
export function runningBand(i: Install | null): { title: string; detail: string } | null {
	if (!i || i.phase === 'failed') return null;
	if (i.phase === 'installing')
		return { title: m.update_band_installing(), detail: m.update_band_reopen() };
	return {
		title: m.update_band_downloading({ pct: Math.floor(percent(i) * 100) }),
		detail: `${amount(i)} · ${m.update_band_reopen()}`
	};
}

/**
 * UPDATE: ask the server to install, then follow it until the new version
 * answers, and reload onto it. The installer stops this server, so for a
 * while nothing answers; `onView` hears each view the old server gives, and
 * `onAway` each poll that finds nobody. Ends early on a failure.
 */
export async function installAndWait(o: {
	target: string;
	onView: (v: UpdateView) => void;
	onAway?: () => void;
	onRefused?: (why: string) => void;
	fetcher?: typeof fetch;
	reload?: () => void;
	every?: number;
}): Promise<void> {
	const f = o.fetcher ?? fetch;
	const r = await f('/api/updates', {
		method: 'POST',
		headers: { 'content-type': 'application/json' },
		body: JSON.stringify({ action: 'install' })
	});
	if (!r.ok) {
		// Refused before anything started (no newer version, a download copy):
		// said as a failure, so the modal can offer TRY AGAIN.
		const said = await r
			.json()
			.then((j: { message?: unknown }) => (typeof j.message === 'string' ? j.message : ''))
			.catch(() => '');
		const why = said || m.update_refused({ status: r.status });
		return o.onRefused?.(why);
	}
	o.onView((await r.json()) as UpdateView);
	try {
		localStorage.setItem(DONE_KEY, o.target);
	} catch {
		// Storage refused: no UPDATED TO band after, nothing worse.
	}
	for (;;) {
		try {
			const g = await f('/api/updates', { cache: 'no-store' });
			if (g.ok) {
				const now = (await g.json()) as UpdateView;
				if (now.current === o.target) return (o.reload ?? (() => location.reload()))();
				o.onView(now);
				if (now.install?.phase === 'failed') return;
			} else o.onAway?.();
		} catch {
			// Stopped by the installer: the new version isn't up yet.
			o.onAway?.();
		}
		await new Promise((ok) => setTimeout(ok, o.every ?? 1000));
	}
}

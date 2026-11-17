import { m } from '$lib/paraglide/messages';
import type { Install, UpdateView } from '$lib/updates';

/**
 * The Android app's own update, as its bridge tells it (doc/UPDATES.md,
 * "The Android apps"; the app's Updater.State.toJson). The app decides
 * everything: it checks the release, downloads it and installs it. These only
 * say so, in the shapes the computer's update already draws.
 */
export type AppUpdatePhase =
	| 'idle'
	| 'checking'
	| 'current'
	| 'available'
	| 'downloading'
	| 'ready'
	| 'permission'
	| 'installing'
	| 'error';

export type AppUpdate = {
	running: string;
	phase: AppUpdatePhase;
	checkedAt: number;
	version?: string;
	date?: string;
	notes?: string;
	size?: number;
	got?: number;
	error?: string;
};

/** The bridge's answer, or null: "" means this app has no updater. */
export function parseAppUpdate(json: string): AppUpdate | null {
	if (!json) return null;
	try {
		const s = JSON.parse(json) as Partial<AppUpdate>;
		return typeof s?.running === 'string' && typeof s.phase === 'string' ? (s as AppUpdate) : null;
	} catch {
		return null;
	}
}

/** A release is being offered, or is on its way in. */
const OFFERED: AppUpdatePhase[] = ['available', 'ready', 'downloading', 'permission', 'installing'];

/**
 * Whether the release is one to offer. An error only counts when UPDATE was
 * pressed: a failed check also ends in `error`, holding the release it last
 * read, and that one may be the version running.
 */
export const offered = (s: AppUpdate | null, pressed: boolean): boolean =>
	!!s?.version && (OFFERED.includes(s.phase) || (pressed && s.phase === 'error'));

/** The release in the shape the update modal draws. */
export function appView(s: AppUpdate): UpdateView {
	return {
		current: s.running,
		checkedAt: s.checkedAt || null,
		available: {
			version: s.version ?? '',
			date: s.date ?? '',
			notes: s.notes ?? '',
			size: s.size ?? null
		},
		platform: 'other',
		how: 'install',
		download: null,
		error: null,
		install: appInstall(s)
	};
}

/** What the update is doing, as the library's band and the modal count it. */
export function appInstall(s: AppUpdate): Install | null {
	if (s.phase === 'downloading')
		return { phase: 'downloading', bytes: s.got ?? 0, total: s.size ?? 0 };
	if (s.phase === 'permission' || s.phase === 'installing') return { phase: 'installing' };
	if (s.phase === 'error') return { phase: 'failed', error: s.error ?? '' };
	return null;
}

/** Which of the modal's faces this phase is. The app can't be "away": it is what installs. */
export function appModalPhase(s: AppUpdate): 'offer' | 'downloading' | 'installing' | 'failed' {
	const i = appInstall(s);
	return i?.phase ?? 'offer';
}

/** SETTINGS' THIS APP line. `when` words a time as the computer's row does. */
export function appLine(s: AppUpdate, when: (at: number) => string): string {
	switch (s.phase) {
		case 'checking':
			return m.update_app_checking();
		case 'downloading':
			return m.update_app_downloading({
				pct: s.size ? Math.floor(((s.got ?? 0) / s.size) * 100) : 0
			});
		case 'permission':
			return m.update_app_permission();
		case 'installing':
			return m.update_app_installing();
		case 'error':
			return (s.error ?? '').toUpperCase();
		case 'available':
		case 'ready':
			return m.update_app_out({ version: s.version ?? '', date: s.date ?? '' });
		default:
			return s.checkedAt
				? m.update_app_current({ when: when(s.checkedAt) })
				: m.update_app_not_checked();
	}
}

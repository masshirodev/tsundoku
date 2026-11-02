/**
 * Syncing the tablet into the library folder (doc/SYNC.md). Syncthing on the
 * tablet sends Mihon's, Hentoid's and the EPUB library's folders; on this
 * box they're receive-only and ignore deletes, so what the owner deletes on
 * the tablet to free its space stays here. A timer asks the app to import
 * once Syncthing has finished and something arrived.
 *
 * Pure: the timer (scripts/sync-import.ts) and the setup (scripts/sync-setup.ts)
 * talk to Syncthing and the app; these are the rules they follow.
 */

/**
 * Where each synced folder lands under LIBRARY_ROOT. The importer reads the
 * Hentoid and Library folders whole and the Mihon folder's `autobackup/`; its
 * `downloads/` and `local/` are kept and not read (c191, doc/SYNC.md).
 */
export const SYNC_TARGETS = ['Mihon', 'Hentoid', 'Library'] as const;
export type SyncTarget = (typeof SYNC_TARGETS)[number];

/**
 * Which target a folder the tablet offers is, from the label it was given
 * there. Null when it's none of them, and the setup leaves it alone.
 */
export function targetOf(label: string): SyncTarget | null {
	const l = label.toLowerCase();
	if (l.includes('mihon') || l.includes('tachi')) return 'Mihon';
	if (l.includes('hentoid')) return 'Hentoid';
	if (/\b(library|books|epub|novels?)\b/.test(l)) return 'Library';
	return null;
}

/**
 * Never synced. Deletes are ignored here, so a file that exists on the
 * tablet only for a moment would stay forever: Mihon downloads a chapter
 * into `<chapter>_tmp` (and a CBZ as `<chapter>.cbz_tmp`) and renames it when
 * done; other apps write `.tmp` and `.part`. `(?d)` lets Syncthing remove an
 * ignored file when it's in the way of deleting a folder.
 */
export const IGNORE_PATTERNS = ['(?d)*_tmp', '(?d)*.tmp', '(?d)*.part', '(?d).thumbnails'];

/** How every synced folder is set up on this box. */
export const FOLDER_SETTINGS = {
	type: 'receiveonly',
	ignoreDelete: true,
	fsWatcherEnabled: true,
	rescanIntervalS: 3600
} as const;

export type FolderStatus = {
	id: string;
	state: string;
	needFiles: number;
	sequence: number;
};

export type SyncDecision =
	| { kind: 'none'; why: string }
	| { kind: 'wait'; why: string }
	| { kind: 'unchanged' }
	| { kind: 'import'; sequences: Record<string, number> };

/**
 * Whether the timer should ask for an import now. Only when every synced
 * folder is idle with nothing left to receive -- a half-received chapter
 * would import with half its pages -- and one has received something since
 * the last import (its sequence moved).
 */
export function syncDecision(folders: FolderStatus[], last: Record<string, number>): SyncDecision {
	if (folders.length === 0) return { kind: 'none', why: 'no synced folder under LIBRARY_ROOT' };
	const busy = folders.find((f) => f.state !== 'idle' || f.needFiles > 0);
	if (busy)
		return {
			kind: 'wait',
			why: `${busy.id} is ${busy.state}${busy.needFiles ? `, ${busy.needFiles} files to come` : ''}`
		};
	const sequences = Object.fromEntries(folders.map((f) => [f.id, f.sequence]));
	const moved = folders.some((f) => last[f.id] !== f.sequence);
	return moved ? { kind: 'import', sequences } : { kind: 'unchanged' };
}

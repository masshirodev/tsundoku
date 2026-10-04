/**
 * Downloading on the workstation (doc/DOWNLOADING.md). Suwayomi-Server runs
 * Mihon's extensions on the JVM and writes Mihon's own download layout into
 * `devices/suwayomi/Mihon/` under LIBRARY_ROOT, so the importer reads it as
 * one more device. A timer asks the app to import whenever something new is
 * on disk, downloads still running or not.
 *
 * Pure: the timer (scripts/suwayomi-import.ts) talks to Suwayomi, the disk and
 * the app; these are the rules it follows.
 */

/** The device folder Suwayomi writes into: `LIBRARY_ROOT/devices/<this>/Mihon`. */
export const SUWAYOMI_DEVICE = 'suwayomi';

/** What is on disk, cheap enough to take every ten minutes. */
export type Fingerprint = { files: number; bytes: number; newest: number };

export type QueueItem = { state: string };

/** What the timer asks Suwayomi: its queue, and whether chapters are written as CBZs. */
export type SuwayomiStatus = { queue: QueueItem[]; cbz: boolean };

export type SuwayomiDecision =
	| { kind: 'none'; why: string }
	| { kind: 'wait'; why: string }
	| { kind: 'unchanged' }
	| { kind: 'import'; fingerprint: Fingerprint };

/**
 * Whether the timer should ask for an import now: when the downloads differ
 * from the last import -- a count alone would miss one chapter deleted and
 * another downloaded.
 *
 * A running queue doesn't hold it back. Suwayomi gathers a chapter's pages
 * elsewhere and writes its CBZ in one go, the zip's index last, so a chapter
 * caught mid-write has no index and the importer refuses it as unreadable
 * until the next import, rather than taking half its pages (measured
 * 2026-10-04, doc/DOWNLOADING.md). With CBZ off a chapter is a folder that
 * fills page by page and has no such tell, so then it waits for the queue.
 */
export function suwayomiDecision(
	status: SuwayomiStatus | null,
	now: Fingerprint,
	last: Fingerprint | null
): SuwayomiDecision {
	if (status === null) return { kind: 'none', why: 'Suwayomi is not answering' };
	const busy = status.queue.filter((q) => q.state !== 'FINISHED');
	if (busy.length && !status.cbz)
		return { kind: 'wait', why: `${busy.length} in the download queue, and CBZ is off` };
	if (now.files === 0) return { kind: 'none', why: 'nothing downloaded yet' };
	const same =
		last !== null &&
		last.files === now.files &&
		last.bytes === now.bytes &&
		last.newest === now.newest;
	return same ? { kind: 'unchanged' } : { kind: 'import', fingerprint: now };
}

/**
 * The backups the timer took itself that can go: all but the newest `keep`.
 * Suwayomi's own daily ones (`….auto_<date>.tachibk`) are left to its
 * BACKUP_TTL. The importer reads only the newest, by the date in the name.
 */
export function backupsToPrune(names: string[], keep = 3): string[] {
	const stamp = (n: string) => /(\d{4}-\d{2}-\d{2}_\d{2}-\d{2})/.exec(n)?.[1] ?? n;
	const own = names
		.filter((n) => n.endsWith('.tachibk') && !n.includes('.auto_'))
		.sort((a, b) => stamp(a).localeCompare(stamp(b)));
	return own.slice(0, Math.max(0, own.length - keep));
}

import { error, fail } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import { isRevealed } from '$lib/server/prefs';
import { importRow, previewImport, startBackupImport } from '$lib/server/import/backup';
import { backupEntry, sourcesLacking } from '$lib/server/import/log';
import { getDb } from '$lib/server/db';
import { libraryRoot } from '$lib/server/import';
import { join } from '$lib/server/fspath';
import { fromTv, TV_REFUSAL } from '$lib/server/import/tv';

/**
 * One chosen file (c438): its preview while nothing is written
 * (Import-Preview), its progress while it runs or waits (Import-Progress,
 * Import-File-States E), its result once it has (Import-Result). The page
 * follows the row's state; a refused file shows why.
 */
export const load: PageServerLoad = ({ params, cookies, request }) => {
	// The TV never imports (c511): refused before anything is read, its
	// preview, its IMPORT and its result alike.
	if (fromTv(request)) return { view: 'tv' as const, reason: TV_REFUSAL };
	const id = Number(params.id);
	const row = Number.isInteger(id) ? importRow(id) : null;
	if (!row) error(404, 'no such import');
	const reveal = isRevealed(cookies);
	if (row.state === 'read' || row.state === 'refused') {
		const p = previewImport(id, reveal);
		if (!p) error(404, 'no such import');
		return p.ok
			? { view: 'preview' as const, row, preview: p.preview, running: otherJob(id) }
			: { view: 'refused' as const, row, reason: p.reason };
	}
	if (row.state === 'running' || row.state === 'waiting')
		return { view: 'progress' as const, row, running: otherJob(id) };
	return {
		view: 'result' as const,
		row,
		entry: backupEntry(row, reveal),
		lacking: sourcesLacking(id, reveal),
		// The one Mihon folder tsundoku reads downloads from (doc/IMPORT-MIHON.md).
		downloads: join(libraryRoot(), 'devices', 'tsundoku', 'Mihon', 'downloads')
	};
};

/** A scan or another import running ahead of this one: its label and how far it is. */
function otherJob(id: number): { label: string; progress: number } | null {
	const j = getDb()
		.prepare(
			`SELECT j.source_label, j.bytes_done, j.bytes_total, i.series_done, i.series_total
			FROM scan_jobs j LEFT JOIN imports i ON i.job_id = j.id
			WHERE j.finished_at IS NULL AND (i.id IS NULL OR i.id != ?) ORDER BY j.id DESC LIMIT 1`
		)
		.get(id) as
		| {
				source_label: string;
				bytes_done: number;
				bytes_total: number;
				series_done: number | null;
				series_total: number | null;
		  }
		| undefined;
	if (!j) return null;
	const progress =
		j.series_total !== null
			? j.series_total > 0
				? (j.series_done ?? 0) / j.series_total
				: 0
			: j.bytes_total > 0
				? j.bytes_done / j.bytes_total
				: 0;
	return { label: j.source_label, progress };
}

export const actions: Actions = {
	/** IMPORT: with the categories left out. Runs on the computer; the page follows it. */
	import: async ({ params, request }) => {
		if (fromTv(request)) return fail(403, { message: TV_REFUSAL });
		const form = await request.formData();
		const leaveOut = form.getAll('leaveOut').map(String);
		const r = startBackupImport(Number(params.id), {
			leaveOut,
			// Covers and links follow, as after START SCAN: never in a spec.
			covers: process.env.TSUNDOKU_IMPORT_COVERS !== '0'
		});
		if (!r.started) return fail(409, { message: r.reason });
		return { started: true };
	}
};

import { getDb } from './db.ts';
import { getSetting, setSetting } from './settings.ts';
import { VISIBLE_SQL } from './visibility.ts';
import { kindFacts, type Kind } from '../library/kinds.ts';
import { recordView } from './browsing.ts';
import { previewIdOf } from './downloads.ts';
import { browseList } from './engine/browse.ts';
import { downloadsBackend } from './engine/run.ts';
import {
	parseSkipped,
	startView,
	withSkip,
	type FirstReadExtras,
	type FirstReadSource,
	type StartFacts,
	type StartView,
	type StepId
} from '../library/start.ts';

/**
 * GET STARTED's facts (doc/ONBOARDING.md; cards c208, c209): what a step is ticked
 * by, read from what's really there. Counts only: the layout asks on every
 * page, so this stays a handful of COUNT(*)s.
 */
export function startFacts(reveal: boolean): StartFacts {
	const n = (sql: string) => (getDb().prepare(sql).get() as { n: number }).n;
	const seen = reveal ? '' : ` AND ${VISIBLE_SQL}`;
	const series = (where: string) =>
		n(`SELECT COUNT(*) AS n FROM series s JOIN roots r ON r.id = s.root_id WHERE ${where}${seen}`);
	// A series from a source carries its key and no scan; one a scan or a backup
	// brought in has the scan's id, or no key at all (doc/ONBOARDING.md, "03 and 06").
	const fromSource = `s.scan_job_id IS NULL AND s.origin_key IS NOT NULL`;
	const entriesOf = (table: string, where = '1') =>
		`SELECT COUNT(*) FROM ${table} t JOIN entries e ON e.id = t.entry_id
			JOIN series s ON s.id = e.series_id JOIN roots r ON r.id = s.root_id WHERE ${where}${seen}`;
	return {
		repositories: n(
			`SELECT (SELECT COUNT(*) FROM engine_repos) + (SELECT COUNT(*) FROM novel_repos) AS n`
		),
		installed: n(
			`SELECT (SELECT COUNT(*) FROM engine_extensions) + (SELECT COUNT(*) FROM novel_plugins) AS n`
		),
		series: series(`s.in_library = 1 AND NOT (${fromSource})`),
		// Which door a device came in by isn't recorded, so a phone, tablet or TV
		// that has checked in at all stands for "a second device over Tailscale".
		phones: n(
			`SELECT (SELECT COUNT(*) FROM paired_devices)
				+ (SELECT COUNT(*) FROM devices WHERE kind IN ('phone', 'tablet', 'tv')) AS n`
		),
		// A record is written on the first chapter or episode opened, never by the preview alone.
		records: series(`s.in_library = 0 AND s.origin_key IS NOT NULL`),
		added: series(`s.in_library = 1 AND ${fromSource}`),
		queued: n(
			`SELECT COUNT(*) AS n FROM download_queue q JOIN series s ON s.id = q.series_id
				JOIN roots r ON r.id = s.root_id WHERE 1${seen}`
		),
		downloaded: n(
			`SELECT (${entriesOf('engine_chapters', 't.downloaded_at IS NOT NULL')})
				+ (${entriesOf('novel_chapters')})
				+ (${entriesOf('anime_episodes', 't.downloaded_at IS NOT NULL')}) AS n`
		)
	};
}

export const skippedSteps = () => parseSkipped(getSetting('start_skipped'));

export function startNow(reveal: boolean): StartView {
	return startView(startFacts(reveal), skippedSteps());
}

/** SKIP, or UNDO a skip. */
export function setSkipped(id: StepId, on: boolean): void {
	setSetting('start_skipped', JSON.stringify(withSkip(skippedSteps(), id, on)));
}

/** The sources a library reads from, as the first day and 05 list them: on the engine only. */
export function readSources(reveal: boolean): FirstReadSource[] {
	if (downloadsBackend() !== 'engine') return [];
	const b = browseList(reveal);
	return [...b.manga, ...b.anime, ...b.novels].map((r) => ({
		id: r.id,
		label: r.label,
		kind: r.kind,
		lang: r.lang
	}));
}

export function firstReadExtras(
	reveal: boolean,
	sources: FirstReadSource[] = readSources(reveal)
): FirstReadExtras {
	const db = getDb();
	const seen = reveal ? '' : ` AND ${VISIBLE_SQL}`;
	const rec = db
		.prepare(
			`SELECT s.id, s.title, s.source, s.kind, s.origin_key FROM series s JOIN roots r ON r.id = s.root_id
			WHERE s.in_library = 0 AND s.pruned_at IS NULL AND s.origin_key IS NOT NULL${seen}
			ORDER BY s.browsed_at DESC LIMIT 1`
		)
		.get() as
		{ id: number; title: string; source: string; kind: string; origin_key: string } | undefined;
	let record: FirstReadExtras['record'] = null;
	const previewId = rec ? previewIdOf(rec.origin_key) : null;
	const view = rec ? recordView(rec.origin_key) : null;
	if (rec && previewId && view) {
		const order = db
			.prepare(`SELECT id FROM entries WHERE series_id = ? AND shadowed = 0 ORDER BY position`)
			.all(rec.id) as { id: number }[];
		const at = view.next ? order.findIndex((e) => e.id === view.next!.id) + 1 : view.total;
		const anime = kindFacts(rec.kind as Kind).medium === 'video';
		record = {
			previewId,
			title: rec.title,
			source: rec.source,
			anime,
			at: Math.max(at, 1),
			total: view.total,
			label: view.next?.label ?? '',
			page: !anime && view.next?.position != null ? view.next.position + 1 : null
		};
	}
	const pickOf = (where: string) =>
		db
			.prepare(
				`SELECT s.id, s.title, s.kind,
					(SELECT COUNT(*) FROM entries e WHERE e.series_id = s.id AND e.shadowed = 0) AS total,
					(SELECT COUNT(*) FROM entries e WHERE e.series_id = s.id AND e.shadowed = 0 AND e.file != '') AS downloaded,
					(SELECT COUNT(*) FROM entries e WHERE e.series_id = s.id AND e.shadowed = 0 AND e.file = ''
						AND e.read_at IS NULL) AS missing
				FROM series s JOIN roots r ON r.id = s.root_id
				WHERE s.in_library = 1 AND ${where}${seen} ORDER BY s.added_at DESC, s.id DESC LIMIT 1`
			)
			.get() as
			| {
					id: number;
					title: string;
					kind: string;
					total: number;
					downloaded: number;
					missing: number;
			  }
			| undefined;
	const p = pickOf(`s.scan_job_id IS NULL AND s.origin_key IS NOT NULL`) ?? pickOf('1');
	return {
		sources,
		record,
		pick: p
			? {
					id: p.id,
					title: p.title,
					anime: kindFacts(p.kind as Kind).medium === 'video',
					total: p.total,
					downloaded: p.downloaded,
					missing: p.missing
				}
			: null
	};
}

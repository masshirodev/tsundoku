import { getDb } from './db.ts';
import { getSetting, setSetting } from './settings.ts';
import { VISIBLE_SQL } from './visibility.ts';
import {
	parseSkipped,
	startView,
	withSkip,
	type StartFacts,
	type StartView,
	type StepId
} from '../library/start.ts';

/**
 * GET STARTED's facts (doc/ONBOARDING.md; card c208): what a step is ticked
 * by, read from what's really there. Counts only: the layout asks on every
 * page, so this stays a handful of COUNT(*)s.
 */
export function startFacts(reveal: boolean): StartFacts {
	const n = (sql: string) => (getDb().prepare(sql).get() as { n: number }).n;
	return {
		repositories: n(
			`SELECT (SELECT COUNT(*) FROM engine_repos) + (SELECT COUNT(*) FROM novel_repos) AS n`
		),
		installed: n(
			`SELECT (SELECT COUNT(*) FROM engine_extensions) + (SELECT COUNT(*) FROM novel_plugins) AS n`
		),
		series: n(
			`SELECT COUNT(*) AS n FROM series s LEFT JOIN roots r ON r.id = s.root_id
			WHERE s.in_library = 1${reveal ? '' : ` AND ${VISIBLE_SQL}`}`
		),
		// Which door a device came in by isn't recorded, so a phone or tablet that
		// has checked in at all stands for "a second device over Tailscale".
		phones: n(
			`SELECT (SELECT COUNT(*) FROM paired_devices)
				+ (SELECT COUNT(*) FROM devices WHERE kind IN ('phone', 'tablet')) AS n`
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

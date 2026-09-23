/**
 * Which database snapshots to keep (doc/BACKUPS.md). Pure, so the rule is
 * tested without a disk.
 *
 * A snapshot is `<base>-YYYYMMDD-HHMMSS.sqlite`, stamped in local time, where
 * `<base>` is the database file's own name: the real library and the dev
 * database back up side by side without pruning each other. Anything else in
 * the folder -- a pre-migration snapshot, a file somebody put there -- is
 * never touched.
 */

export type Tiers = { daily: number; weekly: number; monthly: number };

export const DEFAULT_TIERS: Tiers = { daily: 7, weekly: 8, monthly: 12 };

const pad = (n: number, w = 2) => String(n).padStart(w, '0');

export function stamp(d: Date): string {
	return (
		`${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-` +
		`${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`
	);
}

export const snapshotName = (base: string, d: Date) => `${base}-${stamp(d)}.sqlite`;

/** The time a snapshot was taken, or null for anything that isn't one of `base`'s. */
export function parseSnapshot(base: string, name: string): Date | null {
	if (!name.startsWith(`${base}-`)) return null;
	const m = /^(\d{4})(\d{2})(\d{2})-(\d{2})(\d{2})(\d{2})\.sqlite$/.exec(
		name.slice(base.length + 1)
	);
	if (!m) return null;
	const [, y, mo, d, h, mi, s] = m.map(Number);
	const date = new Date(y, mo - 1, d, h, mi, s);
	// 20261341 parses into some other day; that isn't a name this wrote.
	return stamp(date) === name.slice(base.length + 1, -'.sqlite'.length) ? date : null;
}

const dayKey = (d: Date) => `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
const monthKey = (d: Date) => `${d.getFullYear()}-${d.getMonth()}`;
/** ISO week: weeks start on Monday, and a week belongs to the year of its Thursday. */
function weekKey(d: Date): string {
	const t = new Date(d.getFullYear(), d.getMonth(), d.getDate());
	t.setDate(t.getDate() + 3 - ((t.getDay() + 6) % 7));
	const jan4 = new Date(t.getFullYear(), 0, 4);
	const week =
		1 + Math.round(((t.getTime() - jan4.getTime()) / 86400000 - 3 + ((jan4.getDay() + 6) % 7)) / 7);
	return `${t.getFullYear()}-W${week}`;
}

/**
 * The newest snapshot of each of the last `daily` days that have one, of the
 * last `weekly` weeks, and of the last `monthly` months. A snapshot can count
 * for all three. The newest snapshot is always kept, whatever the tiers say.
 */
export function toKeep(base: string, names: string[], tiers: Tiers = DEFAULT_TIERS): Set<string> {
	const snaps = names
		.map((name) => ({ name, at: parseSnapshot(base, name) }))
		.filter((s): s is { name: string; at: Date } => s.at !== null)
		.sort((a, b) => b.at.getTime() - a.at.getTime());
	const keep = new Set<string>();
	if (snaps.length > 0) keep.add(snaps[0].name);
	for (const [key, limit] of [
		[dayKey, tiers.daily],
		[weekKey, tiers.weekly],
		[monthKey, tiers.monthly]
	] as const) {
		const seen = new Set<string>();
		for (const s of snaps) {
			const k = key(s.at);
			if (seen.has(k)) continue;
			if (seen.size >= limit) break;
			seen.add(k);
			keep.add(s.name);
		}
	}
	return keep;
}

/** What to delete: `base`'s snapshots that no tier keeps. */
export function toPrune(base: string, names: string[], tiers: Tiers = DEFAULT_TIERS): string[] {
	const keep = toKeep(base, names, tiers);
	return names.filter((n) => parseSnapshot(base, n) !== null && !keep.has(n));
}

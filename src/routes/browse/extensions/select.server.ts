import { getDb } from '$lib/server/db';
import { browseSources } from '$lib/server/engine/browse';
import { installed } from '$lib/server/engine/extensions';
import { installedPlugins } from '$lib/server/novels/plugins';
import {
	isSourceFlag,
	setSourceFlagValues,
	setSourceFlags,
	sourceFlagsOf,
	type FlagFact,
	type SourceFlag
} from '$lib/server/engine/source-flags';

/**
 * EXTENSIONS' SELECT (card c696): a press on the bulk bar sets one of
 * tsundoku's switches on every source of every ticked extension, and the band
 * under the tabs says what changed with one UNDO for the whole press.
 *
 * The owner's decision (2026-11-08) is the rule this file keeps: **a row is a
 * package and a switch is a source id**, so a press changes every source of
 * the extension, including a language BROWSE does not list. The list is built
 * from the engine's own `engine_sources` rows (`browseSources(true)`, all
 * languages and hidden ones), never from the rows the screen happens to draw.
 * An LNReader plugin is the other store (`plugins.ts`): its package is
 * `ln:<id>`, and that one id is every source it has.
 *
 * The band is its URL, as CONCEAL's is (c523): a reload says the same, and
 * UNDO posts the facts it was given. The facts are each source's value before
 * the press, so a mixed selection comes back mixed and a source already on
 * stays on.
 */

/** An LNReader plugin's package, or null for a Mihon or Aniyomi extension. */
export const pluginOf = (pkg: string) => (pkg.startsWith('ln:') ? pkg.slice(3) : null);

/** A package's sources, every language, keyed by BROWSE's package: `ln:<id>` for a plugin. */
export function packageSources(): Map<string, string[]> {
	const out = new Map<string, string[]>();
	for (const s of browseSources(true)) out.set(s.pkg, [...(out.get(s.pkg) ?? []), s.id]);
	return out;
}

/** Every installed package, an extension's or a plugin's (`ln:<id>`), whether or not reveal lists it. */
export function installedPackages(): Set<string> {
	const out = new Set(installed().map((e) => e.pkg));
	for (const p of installedPlugins()) out.add(`ln:${p.id}`);
	return out;
}

/**
 * The sources of one package: the engine's rows for an extension, and the
 * plugin's one id for an LNReader plugin even if the source list is not
 * readable (a plugin's switch is keyed by that id either way).
 */
export function sourcesOfPackage(pkg: string, grouped = packageSources()): string[] {
	return grouped.get(pkg) ?? (pluginOf(pkg) ? [pkg] : []);
}

/** The packages a form ticked, in the order given, each once, whatever the row's state. */
export function tickedPackages(form: FormData): string[] {
	const seen = new Set<string>();
	for (const raw of form.getAll('pkg').map(String))
		if (/^(ln:)?[A-Za-z0-9._-]{1,200}$/.test(raw)) seen.add(raw);
	return [...seen];
}

/**
 * At most this many facts are carried in a band's URL, so a press and its UNDO
 * stay well under Node's 16 KB for a request's head. A selection of every row
 * MangaDex has is 61 sources; the whole installed list is nowhere near it.
 */
export const FACTS_MAX = 2000;

/** The facts as one compact URL value: `id|1,id|0`, where `|` is in neither kind of id. */
export const encodeFacts = (facts: readonly FlagFact[]) =>
	facts.map((f) => `${f.sourceId}|${f.previous ? 1 : 0}`).join(',');

/** A band's facts, ignoring anything malformed; an empty answer is no undo. */
export function decodeFacts(raw: string | null | undefined): FlagFact[] {
	if (!raw) return [];
	return raw
		.split(',')
		.slice(0, FACTS_MAX)
		.flatMap((part) => {
			const at = part.lastIndexOf('|');
			if (at <= 0) return [];
			const sourceId = part.slice(0, at);
			const value = part.slice(at + 1);
			if (!/^(ln:)?[A-Za-z0-9._-]{1,200}$/.test(sourceId)) return [];
			if (value !== '0' && value !== '1') return [];
			return [{ sourceId, previous: value === '1' }];
		});
}

/**
 * A press's write: one switch on every source of the ticked packages, in one
 * transaction. `miss` is a package whose sources are not known (a failed
 * extension the engine never listed, from which there is nothing to switch);
 * `gone` is one removed since it was ticked, on another device. Neither is a
 * success, and the band counts them.
 */
export type FlagPress = {
	flag: SourceFlag;
	to: boolean;
	/** Every package's sources, and what each was before: UNDO's facts. */
	facts: FlagFact[];
	/** Ticked packages, and those one or more sources of which changed. */
	of: number;
	chg: number;
	miss: string[];
	gone: string[];
};

export function pressFlag(
	pkgs: readonly string[],
	flag: SourceFlag,
	to: boolean,
	db = getDb()
): FlagPress {
	const grouped = packageSources();
	const have = installedPackages();
	const miss: string[] = [];
	const gone: string[] = [];
	/** Each package's ids, for counting what changed by package. */
	const byPkg = new Map<string, string[]>();
	for (const pkg of pkgs) {
		if (!have.has(pkg)) {
			gone.push(pkg);
			continue;
		}
		const ids = sourcesOfPackage(pkg, grouped);
		if (ids.length === 0) {
			miss.push(pkg);
			continue;
		}
		byPkg.set(pkg, ids);
	}
	const all = [...new Set([...byPkg.values()].flat())];
	if (all.length > FACTS_MAX) throw new Error(`more than ${FACTS_MAX} sources`);
	const facts = all.length ? setSourceFlags(all, flag, to, db) : [];
	return {
		flag,
		to,
		facts,
		of: byPkg.size + miss.length + gone.length,
		// Every package with a source is now at `to`: that is how many the band counts.
		chg: byPkg.size,
		miss,
		gone
	};
}

/**
 * Whether UNDO may run whole: every source the press changed still has the
 * value it set. A source changed since, on its own settings page, is named by
 * its package; an UNDO that took back half a press would be a lie, so it
 * refuses whole (`doc/BANDS.md`'s c469 shape).
 */
export function undoRefusal(
	flag: SourceFlag,
	to: boolean,
	facts: readonly FlagFact[],
	db = getDb()
): string | null {
	const now = sourceFlagsOf(
		facts.map((f) => f.sourceId),
		db
	);
	const changed = facts.find((f) => now.get(f.sourceId)?.[flag] !== to);
	if (!changed) return null;
	const name = browseSources(true).find((s) => s.id === changed.sourceId)?.name ?? changed.sourceId;
	return `UNDO REFUSED · ${name.toUpperCase()} WAS CHANGED SINCE`;
}

/** UNDO: each source back to its value before the press, in one transaction. */
export function undoFlagPress(flag: SourceFlag, facts: readonly FlagFact[], db = getDb()): void {
	setSourceFlagValues(
		flag,
		facts.map((f) => ({ sourceId: f.sourceId, on: f.previous })),
		db
	);
}

/** One band at a time, and the parameters each kind carries (c696; doc/BANDS.md). */
export const SELECT_BAND_PARAMS = [
	'band',
	'flag',
	'to',
	'from',
	'of',
	'chg',
	'miss',
	'gone',
	'done',
	'stayed',
	'series',
	'queued',
	'followed'
] as const;

/** A band's own URL parameters, as the action writes them: one band, replaced by the next press. */
export function bandQuery(
	kind: string,
	values: Record<string, string | string[] | number>
): string {
	const q = new URLSearchParams({ band: kind });
	for (const [key, value] of Object.entries(values))
		for (const v of Array.isArray(value) ? value : [value]) if (v !== '') q.append(key, String(v));
	return q.toString();
}

/** The selection as URL parameters: `select=1` and one `pkg` each, the no-script world's state. */
export function selectQuery(pkgs: readonly string[], extra = ''): string {
	const q = new URLSearchParams({ select: '1' });
	for (const pkg of pkgs) q.append('pkg', pkg);
	return extra ? `${q.toString()}&${extra}` : q.toString();
}

/** A band's package lists, as carried. */
export const listOf = (raw: string | null | undefined) =>
	(raw ?? '').split(',').filter((p) => /^(ln:)?[A-Za-z0-9._-]{1,200}$/.test(p));

export type FlagsBand = {
	flag: SourceFlag;
	to: boolean;
	facts: FlagFact[];
	of: number;
	chg: number;
	miss: string[];
	gone: string[];
};

/** The flags band, from its URL; null when there is none or it names no switch. */
export function flagsBand(p: URLSearchParams): FlagsBand | null {
	if (p.get('band') !== 'flags') return null;
	const flag = p.get('flag') ?? '';
	const to = p.get('to');
	if (!isSourceFlag(flag) || (to !== '0' && to !== '1')) return null;
	const facts = decodeFacts(p.get('from'));
	return {
		flag,
		to: to === '1',
		facts,
		of: Number(p.get('of')) || 0,
		chg: Number(p.get('chg')) || 0,
		miss: listOf(p.get('miss')),
		gone: listOf(p.get('gone'))
	};
}

/** What each switch of a package does, in the band's words: the press's own line. */
export function flagWords(flag: SourceFlag, to: boolean): string {
	if (flag === 'hidden') return to ? 'REVEAL SHOWS THEM' : 'LISTED, SEARCHED AND NAMED AGAIN';
	if (flag === 'addedHidden')
		return to
			? 'A SERIES ADDED FROM THEM ARRIVES HIDDEN'
			: 'A SERIES ADDED FROM THEM ARRIVES SHOWN';
	if (flag === 'offHistory')
		return to
			? 'THEIR READS LEAVE HISTORY, AND STILL COUNT FOR PROGRESS'
			: 'THEIR READS SHOW IN HISTORY AGAIN';
	return to
		? 'NOTHING FROM THEM IS SENT TO ANILIST, MAL OR RANOBE'
		: 'THEY ARE SENT TO ANILIST, MAL AND RANOBE AGAIN';
}

/** The switch's name as the settings page and the bar write it. */
export const FLAG_NAMES: Record<SourceFlag, string> = {
	hidden: 'HIDDEN',
	addedHidden: 'ADDED HIDDEN',
	offHistory: 'OFF HISTORY',
	neverTracked: 'NEVER TRACKED'
};

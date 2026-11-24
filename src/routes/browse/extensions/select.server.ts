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
 * EXTENSIONS' SELECT: a press on the bulk bar sets one of
 * tsundoku's switches on every source of every ticked extension, and the band
 * under the tabs says what changed with one UNDO for the whole press.
 *
 * The rule this file keeps: **a row is a package and a switch is a source id**,
 * so a press changes every source of the extension, including a language BROWSE
 * does not list. The list is built from the engine's own `engine_sources` rows
 * (`browseSources(true)`, all languages and hidden ones), never from the rows
 * the screen happens to draw. An LNReader plugin is the other store
 * (`plugins.ts`): its package is `ln:<id>`, and that one id is every source it
 * has.
 *
 * The band is its URL, as CONCEAL's is: a reload says the same, and
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
 * How many facts `decodeFacts` will read from a band's URL: a ceiling on the
 * work a hand-made link can ask for, not a bound on the URL's length. The
 * length is `LOCATION_BUDGET`'s (below), on the whole redirect, because Node
 * refuses a request head past 16 KB and the band would arrive after the press
 * was already written.
 */
export const FACTS_MAX = 2000;

/**
 * The most a press's whole `Location` may cost, in bytes, before it is
 * written: the page's path, `select=1` and one `pkg` per ticked package, and
 * the band's own query. URLSearchParams encodes `|` and `,` (about 26 bytes a
 * fact), and Node answers a request head past 16 KB with 431 after the press
 * has taken effect; 12 KB leaves 4 KB for the request line and the browser's
 * headers, cookie included. The band's query alone is not the cost: `pkg` is
 * bounded only by how many extensions the user ticks.
 */
export const LOCATION_BUDGET = 12_000;

/** Whether the redirect a press would write is small enough for a browser to follow. */
export const pressFits = (location: string) => location.length <= LOCATION_BUDGET;

/** A press with more sources than `FACTS_MAX`: refused before anything is written. */
export class TooManySourcesError extends Error {
	constructor() {
		super(`more than ${FACTS_MAX} sources`);
		this.name = 'TooManySourcesError';
	}
}

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
	/** The source ids the press would set. */
	ids: string[];
	/** Ticked packages, and those one or more sources of which changed. */
	of: number;
	chg: number;
	miss: string[];
	gone: string[];
};

/**
 * What a press would do, before anything is written: the ids it covers, what
 * each is before (UNDO's facts) and the packages it cannot change. The flags
 * action measures its whole redirect with this and refuses a press too large
 * for a URL (`LOCATION_BUDGET`) without writing; `applyFlag` is then the one
 * write.
 */
export function planFlag(
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
	const ids = [...new Set([...byPkg.values()].flat())];
	if (ids.length > FACTS_MAX) throw new TooManySourcesError();
	const current = sourceFlagsOf(ids, db);
	return {
		flag,
		to,
		ids,
		facts: ids.map((sourceId) => ({ sourceId, previous: current.get(sourceId)?.[flag] ?? false })),
		of: byPkg.size + miss.length + gone.length,
		// Every package with a source is now at `to`: that is how many the band counts.
		chg: byPkg.size,
		miss,
		gone
	};
}

/** The one write a planned press makes: every source in one transaction. */
export function applyFlag(plan: FlagPress, db = getDb()): FlagFact[] {
	return plan.ids.length ? setSourceFlags(plan.ids, plan.flag, plan.to, db) : [];
}

/**
 * Whether UNDO may run whole: every source the press changed still has the
 * value it set. A source changed since, on its own settings page, is named by
 * its package; an UNDO that took back half a press would be a lie, so it
 * refuses whole. Outside reveal a source that is hidden now is not named:
 * hidden means hidden, so the band says "A SOURCE".
 */
export function undoRefusal(
	flag: SourceFlag,
	to: boolean,
	facts: readonly FlagFact[],
	reveal = false,
	db = getDb()
): string | null {
	const now = sourceFlagsOf(
		facts.map((f) => f.sourceId),
		db
	);
	const changed = facts.find((f) => now.get(f.sourceId)?.[flag] !== to);
	if (!changed) return null;
	const name = (reveal ? browseSources(true) : browseSources(false)).find(
		(s) => s.id === changed.sourceId
	)?.name;
	return `UNDO REFUSED · ${(name ?? 'A SOURCE').toUpperCase()} WAS CHANGED SINCE`;
}

/** UNDO: each source back to its value before the press, in one transaction. */
export function undoFlagPress(flag: SourceFlag, facts: readonly FlagFact[], db = getDb()): void {
	setSourceFlagValues(
		flag,
		facts.map((f) => ({ sourceId: f.sourceId, on: f.previous })),
		db
	);
}

/** A band's own URL parameters, as the action writes them: one band, replaced by the next press. */
export function bandQuery(
	kind: string,
	values: Record<string, string | string[] | number>
): string {
	const q = new URLSearchParams({ band: kind });
	// An empty value is left out, except inside a list: a list is positional
	// (UPDATE's `ver`, one per `done`), and dropping one would shift the rest.
	for (const [key, value] of Object.entries(values))
		if (Array.isArray(value)) for (const v of value) q.append(key, String(v));
		else if (value !== '') q.append(key, String(value));
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

/**
 * A band's repeated parameter as one list. `bandQuery` writes `done=a&done=b`,
 * so a single `.get()` would keep only the first row; every reader of a list
 * goes through this.
 */
export const listParam = (p: URLSearchParams, key: string) => listOf(p.getAll(key).join(','));

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
		miss: listParam(p, 'miss'),
		gone: listParam(p, 'gone')
	};
}

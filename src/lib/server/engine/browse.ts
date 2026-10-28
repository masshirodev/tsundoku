import { getDb } from '../db.ts';
import { sourceUse } from '../library-sources.ts';
import { mostlyHidden } from '../../library/downloads.ts';
import { cleanSchema, type EngineFilter, type FilterField } from '../../library/browse-filters.ts';
import type { SearchHit } from '../suwayomi-library.ts';
import { asHits, callSource, type EngineManga } from './backend.ts';
import { preferences } from './extensions.ts';
import { preferenceSnapshot } from './protocol.ts';

/**
 * Browsing a source (doc/BROWSE.md; card c141): its POPULAR and LATEST
 * lists, its own filters, and a search inside it, on the engine. Pages are
 * asked for one at a time and kept for a while, so MORE, back and a reload
 * re-draw what was loaded without asking the site again; a source's answer to
 * the same question doesn't change by the minute.
 */

export type Mode = 'popular' | 'latest' | 'filtered';

export type BrowseSource = {
	id: string;
	name: string;
	lang: string;
	kind: 'manga' | 'anime';
	/** Series the library has from it that the viewer may see, and of those how many are hidden (0 with reveal off). */
	series: number;
	hidden: number;
	/** Shown only while reveal is on: more than half of what's here from it is hidden. */
	mostlyHidden: boolean;
	/** The extension's own word when the engine refused it, else ''. */
	failed: string;
};

/**
 * Every installed source BROWSE may name. Hidden means hidden: with reveal
 * off, a mostly-hidden source isn't listed, named or counted (doc/PRIVACY.md).
 */
export function browseSources(reveal: boolean): BrowseSource[] {
	const rows = getDb()
		.prepare(
			`SELECT s.id, s.name, s.lang, e.kind, e.failed
			FROM engine_sources s JOIN engine_extensions e ON e.pkg = s.pkg
			ORDER BY s.name COLLATE NOCASE, s.lang`
		)
		.all() as { id: string; name: string; lang: string; kind: 'manga' | 'anime'; failed: string }[];
	const use = sourceUse();
	const out: BrowseSource[] = [];
	for (const r of rows) {
		const u = use.get(r.id) ?? { series: 0, hidden: 0 };
		const hiddenMostly = mostlyHidden(u);
		if (hiddenMostly && !reveal) continue;
		// Counts are what reveal lets the viewer see.
		out.push({
			...r,
			series: reveal ? u.series : u.series - u.hidden,
			hidden: reveal ? u.hidden : 0,
			mostlyHidden: hiddenMostly
		});
	}
	return out;
}

/** One source, if BROWSE may name it to this viewer. */
export const browseSource = (id: string, reveal: boolean): BrowseSource | null =>
	browseSources(reveal).find((s) => s.id === id) ?? null;

// ---- what a source can do, kept per its settings -------------------------------------------

const KEEP_MS = 15 * 60 * 1000;
const MAX_PAGES = 20;
const MAX_KEPT = 300;

type Kept<T> = { at: number; value: T };
const kept = new Map<string, Kept<unknown>>();

/**
 * Asks once and keeps the answer for KEEP_MS. A setting is part of the key,
 * since one can change what a source lists ("Settings, per type": the page
 * asks again on return). A failure isn't kept: the next visit asks again.
 */
async function keep<T>(key: string, ask: () => Promise<T>): Promise<T> {
	const k = kept.get(key);
	if (k && Date.now() - k.at < KEEP_MS) return k.value as T;
	const value = await ask();
	kept.set(key, { at: Date.now(), value });
	if (kept.size > MAX_KEPT) {
		// Oldest first: a Map iterates in insertion order.
		for (const old of kept.keys()) {
			kept.delete(old);
			if (kept.size <= MAX_KEPT) break;
		}
	}
	return value;
}

/** Forgets what a source answered: after a setting changes, or an update. */
export function forgetSource(sourceId: string): void {
	for (const k of [...kept.keys()]) if (k.startsWith(`${sourceId}\n`)) kept.delete(k);
}

const settingsKey = (sourceId: string) => JSON.stringify(preferenceSnapshot(preferences(sourceId)));

const keyOf = (sourceId: string, ...parts: unknown[]) =>
	[sourceId, settingsKey(sourceId), ...parts.map((p) => JSON.stringify(p))].join('\n');

/** A first call through a site's browser check took 42 s in the spike. */
const SLOW_MS = 60_000;

export const supportsLatest = (sourceId: string) =>
	keep(keyOf(sourceId, 'latest?'), () =>
		callSource<boolean>(sourceId, 'supportLatestManga', {}, SLOW_MS)
	);

export const filterSchema = (sourceId: string): Promise<FilterField[]> =>
	keep(keyOf(sourceId, 'filters'), async () =>
		cleanSchema(await callSource<unknown>(sourceId, 'filterSchemaManga', {}, SLOW_MS))
	);

type Page = { mangas: EngineManga[]; hasNextPage: boolean };

function askPage(
	sourceId: string,
	mode: Mode,
	page: number,
	query: string,
	filters: EngineFilter[]
): Promise<Page> {
	const method =
		mode === 'popular'
			? 'getPopularManga'
			: mode === 'latest'
				? 'getLatestManga'
				: 'getSearchManga';
	const args = mode === 'filtered' ? { page, search: query, filterList: filters } : { page };
	return keep(keyOf(sourceId, mode, page, query, filters), () =>
		callSource<Page>(sourceId, method, args, SLOW_MS)
	);
}

export type Shelf = { hits: SearchHit[]; more: boolean; pages: number };

/**
 * Pages 1 to [pages] of a list ("It scrolls on, and the URL keeps the
 * place"): what back returns to and what the no-script MORE link renders.
 * Stops early at the source's last page.
 */
export async function shelf(
	sourceId: string,
	mode: Mode,
	opts: { pages: number; query?: string; filters?: EngineFilter[]; reveal: boolean }
): Promise<Shelf> {
	const want = Math.min(Math.max(1, Math.floor(opts.pages) || 1), MAX_PAGES);
	const mangas: EngineManga[] = [];
	let more = false;
	let pages = 0;
	for (let p = 1; p <= want; p++) {
		const got = await askPage(sourceId, mode, p, opts.query ?? '', opts.filters ?? []);
		mangas.push(...got.mangas);
		pages = p;
		more = got.hasNextPage && got.mangas.length > 0;
		if (!more) break;
	}
	return { hits: asHits(sourceId, mangas, opts.reveal), more: more && pages < MAX_PAGES, pages };
}

/** For tests: forget everything kept. */
export const forgetAll = () => kept.clear();

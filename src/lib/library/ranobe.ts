import type { Kind } from './types.ts';

/**
 * Ranobe, the pure part (doc/RANOBE.md): what is sent there, how a file's
 * entries become Ranobe's units, and when a unit counts as read. No database,
 * no network.
 */

/**
 * The kinds Ranobe tracks. Novels only, for now: comics stay on AniList, the
 * main list for them (ranobe/doc/API-V1.md, "For Tsundoku"). Widening this is
 * the whole change when the owner extends it.
 */
export const RANOBE_KINDS: readonly Kind[] = ['novel'];

/** Ranobe's kinds a tsundoku novel may be, for `/search?kind=`. */
export const RANOBE_SEARCH_KINDS = 'light_novel,web_novel';

/** The language an EPUB with none recorded is taken to be in. */
export const DEFAULT_LANG = 'en';

/** A unit number as Ranobe compares it: "05" is volume 5, "12.50" is 12.5. */
export function unitNumber(raw: string): string {
	const t = raw.trim();
	if (!/^\d+(\.\d+)?$/.test(t)) return t;
	const n = Number(t);
	return String(n);
}

/**
 * The volume a series is, when it is one EPUB volume: "Vol. 2", "Volume 5",
 * "Book 10", or a bare number at the end ("The Beginning After The End 08").
 * A span of chapters ("1-1429", "c1-591") is no volume, and nor is a title
 * with no number.
 */
export function volumeOf(...names: string[]): string | null {
	for (const raw of names) {
		const name = raw.replace(/\.epub$/i, '');
		const named = name.match(/\b(?:vol(?:ume)?|book)\b\.?\s*(\d+(?:\.\d+)?)/i);
		if (named) return unitNumber(named[1]);
		if (/\bc?\d+\s*-\s*\d+\s*$/i.test(name)) continue;
		const bare = name.match(/\s(\d{1,3})\s*$/);
		if (bare) return unitNumber(bare[1]);
	}
	return null;
}

/**
 * The chapter an entry is, from its label: "254 Hello Darkness", "Chapter 12:
 * …", "Ch. 3". Null when the label doesn't lead with one ("Prologue").
 */
export function chapterOf(label: string): string | null {
	const m = label.trim().match(/^(?:ch(?:apter)?\.?\s*)?(\d+(?:\.\d+)?)\b/i);
	return m ? unitNumber(m[1]) : null;
}

export type Unit = { ref: string; type: string; number: string };

export type MappedEntry = {
	id: number;
	label: string;
	/** 'front' or 'back' is the book's matter, never a unit's reading. */
	matter: string;
	readAt: number | null;
};

/** The volume an entry is, when its label says so: "Vol. 3", "Volume 12". */
export function entryVolumeOf(label: string): string | null {
	const m = label.trim().match(/^vol(?:ume)?\.?\s*(\d+(?:\.\d+)?)\b/i);
	return m ? unitNumber(m[1]) : null;
}

/**
 * Each entry's unit, following the edition's own table of contents
 * (API-V1.md step 4). Three shapes of series:
 *
 * - **One EPUB volume**: its body maps onto that volume.
 * - **A volume per entry** ("Vol. 3"): each onto its volume.
 * - **A chapter per entry** ("254 Hello Darkness"): each onto its chapter,
 *   when the edition counts chapters.
 *
 * Matter, and anything the edition doesn't list, maps to nothing.
 */
export function mapUnits(
	units: Unit[],
	series: { volume: string | null; entries: MappedEntry[] }
): Map<number, string> {
	const out = new Map<number, string>();
	const body = series.entries.filter((e) => !e.matter);
	const of = (type: string) =>
		new Map(units.filter((u) => u.type === type).map((u) => [unitNumber(u.number), u.ref]));
	const volumes = of('volume');
	const chapters = of('chapter');
	if (series.volume !== null && volumes.has(series.volume)) {
		const ref = volumes.get(series.volume)!;
		for (const e of body) out.set(e.id, ref);
		return out;
	}
	for (const e of body) {
		const v = entryVolumeOf(e.label);
		const c = v === null ? chapterOf(e.label) : null;
		const ref = v !== null ? volumes.get(v) : c !== null ? chapters.get(c) : undefined;
		if (ref) out.set(e.id, ref);
	}
	return out;
}

/**
 * Which units are read here, and when: a unit is read once every entry
 * mapped onto it is, at the last of those reads. A volume half read is not
 * read, so nothing goes for it yet.
 */
export function unitsRead(
	entries: { unit: string; readAt: number | null }[]
): Map<string, number | null> {
	const byUnit = new Map<string, number | null>();
	for (const e of entries) {
		if (!byUnit.has(e.unit)) byUnit.set(e.unit, e.readAt);
		else {
			const had = byUnit.get(e.unit) ?? null;
			byUnit.set(e.unit, had === null || e.readAt === null ? null : Math.max(had, e.readAt));
		}
	}
	return byUnit;
}

export type UnitSend = { unit: string; readAt: number | null; sentAt: number | null };

/**
 * Whether a unit has something to send: read here and not sent (a read), or
 * sent and read no longer (the DELETE). Only ever what tsundoku itself sent
 * is taken back: a read made on the site is never undone from here.
 */
export function unitWants(u: UnitSend): 'read' | 'unread' | null {
	if (u.readAt !== null && u.sentAt === null) return 'read';
	if (u.readAt === null && u.sentAt !== null) return 'unread';
	return null;
}

/** An edition Ranobe lists for a work, as `/works/{ref}` gives it. */
export type EditionSummary = {
	ref: string;
	lang: string;
	origin: string;
	format: string;
	units: Record<string, number>;
};

/**
 * The edition a series reads, among a work's: the series' language, a
 * licensed release before a fan one, an ebook before print. None in the
 * language is null, and the pass suggests one (doc/RANOBE.md, "Editions").
 */
export function chooseEdition(editions: EditionSummary[], lang: string): EditionSummary | null {
	const rank = (e: EditionSummary) =>
		(e.origin === 'licensed' ? 0 : e.origin === 'original' ? 1 : 2) * 2 +
		(e.format === 'ebook' ? 0 : 1);
	const fits = editions
		.filter((e) => e.lang === lang || e.lang.startsWith(`${lang}-`))
		.sort((a, b) => rank(a) - rank(b));
	return fits[0] ?? null;
}

/**
 * The units an edition suggestion lists: volumes 1 to the highest this
 * library holds, since a volume 5 in English means there were four before it.
 * Nothing when no series of the work is a volume.
 */
export function suggestedUnits(volumes: string[]): { type: string; number: string }[] {
	const top = Math.max(0, ...volumes.map(Number).filter((n) => Number.isInteger(n) && n > 0));
	return Array.from({ length: top }, (_, i) => ({ type: 'volume', number: String(i + 1) }));
}

/** A read's time as Ranobe takes it. */
export const iso = (at: number) => new Date(at).toISOString();

/** Tsundoku's rating out of 10 as Ranobe's: 0, unrated, is null. */
export const ratingOut = (rating: number): number | null => (rating > 0 ? rating : null);

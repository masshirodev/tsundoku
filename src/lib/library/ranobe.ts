import type { Kind } from './types.ts';
import { kindFacts } from './kinds.ts';

/**
 * Ranobe, the pure part (doc/RANOBE.md): what is sent there, how a file's
 * entries become Ranobe's units, and when a unit counts as read. No database,
 * no network.
 */

/**
 * The kinds Ranobe tracks. Novels since card c66; manga and manhwa since card
 * c98 (2026-10-14), once Ranobe's works counted their own chapters (its card
 * c226); anime since card c240 (2026-11-03), as one work for the whole show,
 * its episodes counted straight through the seasons (Ranobe c134,
 * doc/RANOBE.md, "Anime"). Doujinshi never, whichever importer made them:
 * Hentoid's books, or a Mihon gallery source's series.
 */
// Its own order (novel first, then the comics, then anime): the search's kind
// options read it, so it is stated, not derived and sorted.
export const RANOBE_KINDS: readonly Kind[] = ['novel', 'manga', 'manhwa', 'anime'];

/**
 * Whether a kind reads against the work's own units rather than an
 * edition's (doc/RANOBE.md, "Comics"). A comic is read as the work's
 * chapters: no edition to choose, nothing to suggest.
 */
export const byWork = (kind: Kind) => kind !== 'novel';

/** Ranobe's kinds a tsundoku series of this kind may be, for `/search?kind=`. */
export const searchKinds = (kind: Kind) =>
	// What is watched, not read: Ranobe files it under its own video kinds (c240).
	kindFacts(kind).medium === 'video'
		? 'anime,donghua'
		: byWork(kind)
			? 'manga,manhwa,manhua'
			: 'light_novel,web_novel';

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

/**
 * A work's own units, as `GET /works/{ref}?fields=units` gives them: the
 * kind's canonical type, `1..count`, and the numbers outside the run it
 * lists (`12.5`). Null when Ranobe doesn't count them yet.
 */
export type WorkUnits = {
	type: string;
	/** Null on a running work that doesn't know how many yet. */
	count: number | null;
	extra: string[];
	/** Still coming out: any number is a unit, past the count or with none. */
	open?: boolean;
};

/** How far Ranobe takes a running work's numbers (its OPEN_RUN_LIMIT). */
export const OPEN_RUN_LIMIT = 10_000;

/**
 * A comic chapter's number, from its label: "Ch. 154", "Chapter 12.5",
 * "Episode 3" (a webtoon's), "Vol.2 Ch.15 - …". Null for "Prologue".
 */
export function comicChapterOf(label: string): string | null {
	const t = label.trim();
	const inVolume = t.match(
		/^vol(?:ume)?\.?\s*\d+(?:\.\d+)?\s*ch(?:apter)?\.?\s*(\d+(?:\.\d+)?)\b/i
	);
	if (inVolume) return unitNumber(inVolume[1]);
	const episode = t.match(/^ep(?:isode)?\.?\s*(\d+(?:\.\d+)?)\b/i);
	if (episode) return unitNumber(episode[1]);
	return chapterOf(t);
}

/**
 * Whether the work lists a number among its units. A finished work lists
 * `1..count` and its extras, and Ranobe refuses anything else, never folding
 * 12.5 into 12; a running one takes any number from 1 to 10,000, whole or
 * not (Ranobe's API-V1.md, "On a running work").
 */
export function workLists(units: WorkUnits, number: string): boolean {
	const n = unitNumber(number);
	if (units.extra.some((x) => unitNumber(x) === n)) return true;
	if (units.open) return Number(n) >= 1 && Number(n) <= OPEN_RUN_LIMIT;
	return /^\d+$/.test(n) && Number(n) >= 1 && Number(n) <= (units.count ?? 0);
}

/**
 * Each comic entry's unit, as the work's own chapter (`w123:chapter:154`):
 * every body entry whose number the work lists. On a finished work a chapter
 * past the count waits for Ranobe to count it; matter and unnumbered entries
 * map to nothing.
 */
export function mapWorkUnits(
	work: string,
	units: WorkUnits | null,
	entries: MappedEntry[]
): Map<number, string> {
	const out = new Map<number, string>();
	if (!units || units.type !== 'chapter') return out;
	for (const e of entries) {
		if (e.matter) continue;
		const n = comicChapterOf(e.label);
		if (n !== null && workLists(units, n)) out.set(e.id, `${work}:${units.type}:${n}`);
	}
	return out;
}

/**
 * Each episode's unit, as Ranobe counts an anime: the work's own episodes,
 * numbered straight through the seasons -- season 1's EP. 24 is 24, season
 * 2's EP. 1 is 25 (Ranobe c134, "A series is one entry"). A series here can
 * hold several seasons while Ranobe holds one work, so the number is the
 * episode's place in the list, not the one the source printed. A recap and a
 * half number are not episodes a catalogue numbers, and map to nothing.
 */
export function mapAnimeUnits(
	work: string,
	units: WorkUnits | null,
	entries: MappedEntry[]
): Map<number, string> {
	const out = new Map<number, string>();
	if (!units || !units.type) return out;
	let n = 0;
	for (const e of entries) {
		if (e.matter) continue;
		const number = episodeOf(e.label);
		// A recap and a half number are no aired episode: they take no number,
		// and are never sent (as AniList and MAL never get them either).
		if (number === null || e.recap || !/^\d+$/.test(number)) continue;
		n += 1;
		const ref = `${work}:${units.type}:${n}`;
		if (workLists(units, String(n))) out.set(e.id, ref);
	}
	return out;
}

/**
 * An episode's own number from its label ("Episode 5", "Ep. 12", "5"), or
 * null for a recap and for a title with no number. A half number ("14.5") is
 * a real episode in the list and is counted, as Ranobe's own run never folds
 * a fraction: it maps only when the work lists it.
 */
export function episodeOf(label: string): string | null {
	const t = label.trim();
	const m = t.match(/^(?:ep(?:isode)?\b\.?\s*)?(\d+(?:\.\d+)?)\b/i);
	return m ? unitNumber(m[1]) : null;
}

export type MappedEntry = {
	id: number;
	label: string;
	/** 'front' or 'back' is the book's matter, never a unit's reading. */
	matter: string;
	readAt: number | null;
	/** An anime's recap: listed, never a catalogue's episode (c240). */
	recap?: boolean;
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

// ---- the review (Ranobe Review; doc/RANOBE.md, "The review") --------------------------------

/** A work Ranobe's search answered, as kept for the review. */
export type RanobeCandidate = {
	work: string;
	kind: string;
	title: string;
	/** The title or alias that matched: why it's there at all. */
	matched: string;
	status: string;
	years: string;
	units: Record<string, number>;
	cover: { url: string; sensitive: boolean } | null;
	/** Chosen for another series of the same title just now (1c): "VOL. 2". */
	prior?: string;
};

const KIND_LABEL: Record<string, string> = {
	light_novel: 'LIGHT NOVEL',
	web_novel: 'WEB NOVEL'
};
export const kindLabel = (kind: string) =>
	KIND_LABEL[kind] ?? kind.replace(/_/g, ' ').toUpperCase();

/** "33 VOLUMES · 470 CHAPTERS", volumes first; "1 VOLUME". */
export function unitsLabel(units: Record<string, number>): string {
	const order = ['volume', 'chapter'];
	return Object.entries(units)
		.filter(([, n]) => n > 0)
		.sort(([a], [b]) => {
			const ia = order.indexOf(a);
			const ib = order.indexOf(b);
			return (ia < 0 ? 9 : ia) - (ib < 0 ? 9 : ib);
		})
		.map(([t, n]) => `${n.toLocaleString('en')} ${t.toUpperCase()}${n === 1 ? '' : 'S'}`)
		.join(' · ');
}

/** A Ranobe work's page: `ranobe.ink/w2`, `https://ranobe.ink/w2`, `/w2`. Null for anything else. */
export function parseRanobeUrl(text: string): string | null {
	const m = text.trim().match(/^(?:(?:https?:\/\/)?(?:www\.)?ranobe\.ink)?\/(w\d+)(?:[/?#].*)?$/i);
	return m ? m[1].toLowerCase() : null;
}
export const ranobeUrl = (ref: string) => `https://ranobe.ink/${ref}`;

/** "RANOBE W388 · WEB NOVEL". */
export const ranobeIds = (c: Pick<RanobeCandidate, 'work' | 'kind'>) =>
	`RANOBE ${c.work.toUpperCase()} · ${kindLabel(c.kind)}`;

/**
 * Why a candidate is there, in the review's words: chosen for a sibling
 * just now; the title equal once the volume is taken off; or what matched.
 */
export function ranobeWhy(
	series: { title: string; base: string },
	c: RanobeCandidate,
	normalise: (t: string) => string
): string {
	if (c.prior) return `CHOSEN FOR ${c.prior} JUST NOW`;
	const n = normalise(c.title);
	if (n === normalise(series.title)) return 'TITLE EQUAL';
	if (n === normalise(series.base)) {
		const cut = series.title.slice(series.base.length).replace(/^[\s,:;–—-]+/, '');
		return cut ? `TITLE EQUAL WITHOUT “${cut.toUpperCase()}”` : 'TITLE EQUAL';
	}
	if (c.matched && normalise(c.matched) !== n) return `MATCHED “${c.matched}”`;
	return 'SHARES THE TITLE';
}

export type RanobeRow = { label: string; value: string; agree: boolean };

/** MATCHED, KIND, YEARS, STATUS, UNITS: the review's candidate rows (1a). */
export function ranobeRows(c: RanobeCandidate): RanobeRow[] {
	return [
		{ label: 'MATCHED', value: c.matched || c.title, agree: true },
		{ label: 'KIND', value: kindLabel(c.kind), agree: false },
		{ label: 'YEARS', value: c.years || '—', agree: false },
		{
			label: 'STATUS',
			value: c.status ? c.status.replace(/_/g, ' ').toUpperCase() : '—',
			agree: false
		},
		{ label: 'UNITS', value: unitsLabel(c.units) || '—', agree: false }
	];
}

/** Under the candidate's cover: a missing one, or one Ranobe flags as not to be shown. */
export const coverNote = (c: Pick<RanobeCandidate, 'cover'>) =>
	!c.cover ? 'NO COVER' : c.cover.sensitive ? 'SENSITIVE · NOT SHOWN' : null;

// ---- the TRACKING line (Ranobe Series 2a–2k) -------------------------------------------------

export type RanobeFacts = {
	configured: boolean;
	hidden: boolean;
	linked: boolean;
	/** Suggested to Ranobe from its EPUB, waiting for the owner there (card c72). */
	suggested: boolean;
	/** The edition the series reads; null while it waits on one. A comic has none. */
	edition: boolean;
	/** A comic, read as the work's own chapters (card c98). */
	comic: boolean;
	/** An anime, read as the work's own episodes, one work across the seasons (c240). */
	anime?: boolean;
	/** The work counts its units on Ranobe, so a comic's reads can go. */
	counted: boolean;
	/** The suggestion for it was refused or withdrawn. */
	suggestionRefused: boolean;
	lang: string;
	/** What Ranobe says of the entry, as last read or answered. */
	remote: {
		status: string | null;
		progress: { type: string; number: string; of: number | null } | null;
		rating: number | null;
		favourite: boolean;
	} | null;
	sentAt: number | null;
	/** The first unit that didn't go, and why. */
	failed: { unit: string; error: string; at: number } | null;
	/** A unit partly read here: VOL. 6, 6 of 9. */
	half: { unit: string; read: number; of: number } | null;
};

export type TrackLineOut = { l: string; r: string; strong: boolean; rStrong: boolean };

const LANG_NAME: Record<string, string> = { en: 'ENGLISH', ja: 'JAPANESE', pt: 'PORTUGUESE' };
export const langName = (lang: string) => LANG_NAME[lang.split('-')[0]] ?? lang.toUpperCase();

/** "VOL. 5", "CH. 254", from a unit ref or a type and number. */
export function unitLabel(u: string | { type: string; number: string }): string {
	const [type, number] =
		typeof u === 'string' ? (u.split(':').slice(1) as [string, string]) : [u.type, u.number];
	const short: Record<string, string> = { volume: 'VOL.', chapter: 'CH.', episode: 'EP.' };
	return `${short[type] ?? type.toUpperCase()} ${number}`;
}

/** "READING · VOL. 5 OF 6 · 8 · FAV": status, how far, rating, as far as known. */
export function remoteLine(r: NonNullable<RanobeFacts['remote']>): string {
	return [
		r.status ? r.status.replace(/_/g, ' ').toUpperCase() : '',
		r.progress
			? `${unitLabel(r.progress)}${r.progress.of ? ` OF ${r.progress.of.toLocaleString('en')}` : ''}`
			: '',
		r.rating ? String(r.rating) : '',
		r.favourite ? 'FAV' : ''
	]
		.filter(Boolean)
		.join(' · ');
}

/**
 * The TRACKING row's lines for a novel (2a–2k): the first is what Ranobe
 * says, with what tsundoku did on the right; a second, quiet one only when
 * there's more to say. Null: no Ranobe line at all (no token).
 */
export function ranobeLines(
	f: RanobeFacts,
	o: {
		now: number;
		offline: boolean;
		ago: (at: number, now: number) => string;
		clock: (at: number) => string;
	}
): { lines: TrackLineOut[]; retry: boolean } | null {
	if (!f.configured) return null;
	const line = (l: string, r = '', strong = true, rStrong = false): TrackLineOut => ({
		l,
		r,
		strong,
		rStrong
	});
	if (f.hidden)
		return {
			lines: [line('NOTHING SENT · HIDDEN SERIES STAY OFF RANOBE', '', false)],
			retry: false
		};
	if (!f.linked && f.suggested)
		return {
			lines: [
				line('RANOBE · SUGGESTED, WAITING FOR YOUR REVIEW', 'NOTHING SENT YET'),
				line('LINKED IN THE PASS AFTER YOU APPROVE IT ON RANOBE', '', false)
			],
			retry: false
		};
	if (!f.linked)
		return {
			lines: [line('NOT ON RANOBE', 'NOTHING SENT · READS STAY HERE', false)],
			retry: false
		};
	if (f.comic && !f.counted)
		return {
			lines: [
				line(`RANOBE · WAITING ON ITS ${f.anime ? 'EPISODE' : 'CHAPTER'} COUNT`, 'NOTHING SENT'),
				line(
					`RANOBE DOESN’T COUNT THIS WORK’S ${f.anime ? 'EPISODES' : 'CHAPTERS'} YET · READS GO ONCE IT DOES`,
					'',
					false
				)
			],
			retry: false
		};
	if (!f.comic && !f.edition)
		return {
			lines: [
				line('RANOBE · WAITING ON AN EDITION', 'NOTHING SENT'),
				line(
					`NO ${langName(f.lang)} EDITION ON RANOBE${f.suggestionRefused ? ' · THE ONE SUGGESTED WAS REFUSED' : ' · ONE IS SUGGESTED IN THE NEXT PASS'}`,
					'',
					false
				)
			],
			retry: false
		};
	const said = f.remote ? remoteLine(f.remote) : '';
	if (f.failed && !o.offline) {
		const second =
			f.failed.error === 'RANOBE REFUSED THE TOKEN'
				? line('A NEW RANOBE_TOKEN IN .ENV, THEN TRY AGAIN', '', false)
				: f.failed.error === 'RANOBE REFUSED IT'
					? line(
							`THE ${f.comic ? 'WORK' : 'EDITION'} HAS NO ${unitLabel(f.failed.unit)} · TRIED AGAIN WITH THE NEXT SEND`,
							'',
							false
						)
					: line(said ? `${said} · AS RANOBE LAST SAID` : 'NOTHING ON RANOBE YET', '', false);
		return {
			lines: [
				line(
					`RANOBE · ${unitLabel(f.failed.unit)} NOT SENT`,
					`${f.failed.error} · ${o.clock(f.failed.at)}`,
					true,
					true
				),
				second
			],
			retry: true
		};
	}
	const right = o.offline
		? f.sentAt
			? `AS OF ${o.clock(f.sentAt)}`
			: ''
		: f.sentAt
			? `SENT ${o.ago(f.sentAt, o.now)}`
			: f.remote
				? 'ON YOUR LIBRARY'
				: 'ADDED ON THE FIRST READ';
	const lines = [line(said ? `RANOBE · ${said}` : 'RANOBE · NOT IN YOUR LIBRARY YET', right)];
	if (f.half && !o.offline)
		lines.push(
			line(
				`${unitLabel(f.half.unit)} · ${f.half.read} OF ${f.half.of} CHAPTERS READ HERE`,
				`SENT ONCE ALL ${f.half.of} ARE`,
				false
			)
		);
	return { lines, retry: false };
}

/**
 * A unit partly read here, for the quiet second line (2b): the first, in
 * reading order, with some but not all of its entries read. Only units that
 * span several entries count: a web novel's chapter is one entry.
 */
export function halfRead(
	entries: { unit: string; readAt: number | null }[]
): { unit: string; read: number; of: number } | null {
	const by = new Map<string, { read: number; of: number }>();
	for (const e of entries) {
		const u = by.get(e.unit) ?? { read: 0, of: 0 };
		u.of += 1;
		if (e.readAt !== null) u.read += 1;
		by.set(e.unit, u);
	}
	for (const [unit, u] of by) if (u.of > 1 && u.read > 0 && u.read < u.of) return { unit, ...u };
	return null;
}

// ---- suggesting a work (card c72; doc/RANOBE.md, "Suggesting a novel") ----------------------

/** The language a name's script says: Hangul is Korean, kana Japanese, Han alone Chinese. */
export function scriptLang(s: string): string | null {
	if (/\p{Script=Hangul}/u.test(s)) return 'ko';
	if (/[\p{Script=Hiragana}\p{Script=Katakana}]/u.test(s)) return 'ja';
	if (/\p{Script=Han}/u.test(s)) return 'zh';
	return null;
}

const LANG3: Record<string, string> = {
	eng: 'en',
	jpn: 'ja',
	kor: 'ko',
	chi: 'zh',
	zho: 'zh',
	por: 'pt',
	spa: 'es',
	fre: 'fr',
	fra: 'fr',
	ger: 'de',
	deu: 'de'
};

/** An EPUB's dc:language as a BCP 47 tag: `en_US` is `en-US`, `eng` is `en`. Null when unreadable. */
export function epubLang(raw: string): string | null {
	const t = raw.trim().replace(/_/g, '-');
	const [base, ...rest] = t.split('-');
	const b = (LANG3[base.toLowerCase()] ?? base).toLowerCase();
	if (!/^[a-z]{2,3}$/.test(b)) return null;
	const region = rest.filter((r) => /^[A-Za-z0-9]{2,8}$/.test(r));
	return [b, ...region.map((r) => (r.length === 2 ? r.toUpperCase() : r))].join('-');
}

/** A name that is no author: a file's placeholder, or a ripper's credit with a URL in it. */
const NOT_A_NAME =
	/^(to be implemented|unknown|anonymous|n\/?a|none|author|various|admin)$|https?:\/\/|www\.|\.(com|net|org|io)\b/i;

export type SuggestedPerson = { name: string; latin: string | null; lang: string | null };

/**
 * The EPUB's creators as the people to suggest: authors only when the file
 * names roles, placeholders and rippers' credits dropped, the same name
 * spelt twice kept once ("Turtle Me", "TurtleMe"), and a native name in
 * brackets split out ("Sing-shong (싱숑)"). Ranobe files a person under the
 * native name, with the romanisation beside it.
 */
export function suggestedPeople(creators: { name: string; role: string }[]): SuggestedPerson[] {
	const roled = creators.some((c) => c.role);
	const out: SuggestedPerson[] = [];
	const seen = new Set<string>();
	for (const c of creators) {
		if (roled && c.role && c.role.toLowerCase() !== 'aut') continue;
		const name = c.name.replace(/\s+/g, ' ').trim();
		if (!name || NOT_A_NAME.test(name)) continue;
		const m = name.match(/^(.+?)\s*[(（]([^)）]+)[)）]$/);
		const [a, b] = m ? [m[1].trim(), m[2].trim()] : [name, ''];
		const native = [a, b].find((x) => x && scriptLang(x)) ?? null;
		const latin = [a, b].find((x) => x && !scriptLang(x)) ?? null;
		const key = (native ?? latin ?? '').toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');
		if (!key || seen.has(key)) continue;
		seen.add(key);
		out.push(
			native
				? { name: native, latin, lang: scriptLang(native) }
				: { name: latin!, latin: null, lang: null }
		);
	}
	return out;
}

/**
 * The bundle a series suggests (API-V1.md, "Bundles"): its authors as
 * people, then the work crediting them. Only what the file says, and two
 * guesses the owner corrects on Ranobe before approving: the kind (a series
 * that is one volume is a light novel, one of chapters a web novel), and the
 * original language (the author's script; `und`, undetermined, when it
 * doesn't say).
 */
export function workBundle(o: {
	title: string;
	/** Other titles the file gives, in brackets: "(Ranker Who Lives Twice Novel)". */
	aliases?: string[];
	volume: string | null;
	people: SuggestedPerson[];
	lang: string | null;
	file: string;
}): {
	reason: string;
	source: string;
	items: { key: string; type: 'person' | 'work'; snapshot: Record<string, unknown> }[];
} {
	const people = o.people.map((p, i) => ({
		key: `author${i + 1}`,
		type: 'person' as const,
		snapshot: {
			hidden: false,
			name: p.name,
			reading: null,
			latin: p.latin,
			lang: p.lang,
			aliases: [],
			description: null,
			externalIds: []
		}
	}));
	// Ranobe requires a title in the work's original language, and the only
	// title the file has is its own, the translation's. So the work goes in
	// under that language, and the guess at the real original -- the author's
	// script -- goes in the reason, where the owner reads it before approving.
	const lang = o.lang ?? 'en';
	const guessed = o.people.map((p) => p.lang).find((l) => l !== null) ?? null;
	const kind = o.volume !== null ? 'light_novel' : 'web_novel';
	return {
		reason: [
			`From Tsundoku: an EPUB${o.volume ? ` of volume ${o.volume}` : ''} that Ranobe's search didn't find.`,
			'The title and author are the file’s own.',
			`The kind (${kind === 'light_novel' ? 'light novel, from a volume' : 'web novel, from chapters'}) is a guess.`,
			`The original language is set to ${lang}, the file’s, only because a title in it is required;`,
			guessed
				? `the author's name says it's probably ${guessed}. Add the original title and fix it before approving.`
				: 'the file doesn’t say what it is. Fix it before approving.'
		].join(' '),
		source: `epub:${o.file}`,
		items: [
			...people,
			{
				key: 'work',
				type: 'work',
				snapshot: {
					kind,
					hidden: false,
					originalLang: lang,
					titles: [{ lang, title: o.title, latin: null, official: false }],
					aliases: [...new Set(o.aliases ?? [])].filter((a) => a && a !== o.title),
					status: 'unknown',
					adult: false,
					synopses: [],
					coverImageId: null,
					bannerImageId: null,
					images: [],
					attributes: {},
					credits: people.map((p) => ({
						personId: `@${p.key}`,
						orgId: null,
						role: 'author',
						note: null
					})),
					cast: [],
					tags: [],
					relations: [],
					externalIds: []
				}
			}
		]
	};
}

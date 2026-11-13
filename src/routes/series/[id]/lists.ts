/**
 * The series screen's LISTS row, the pure part (card c424; the handoff in
 * doc/handoffs/series-lists/, doc/SERIES.md "LISTS"). LINK said which entry a
 * series is, TRACKING what the owner's lists say of it; both listed AniList,
 * MAL and Ranobe, so the row is one now, with a line per list: the entry, the
 * list's word for it, what was sent, and its cells.
 *
 * Everything here is derived from what the server already hands the panel
 * (`LinkState`, `Tracking`, `RanobeSeries`, an anime's `SeasonRow`s), so the
 * component only draws. No database, no network, no Svelte.
 */

import { kindFacts, kindUnit } from '$lib/library/kinds';
import { anilistUrl, isAnime, malUrl, viaLabel, type SeasonRow } from '$lib/library/catalogue';
import { partsLabel, seasonPlan } from '$lib/library/anime';
import {
	ago,
	clock,
	listState,
	mainList,
	SERVICE_NAME,
	statusLabel,
	type TrackFacts
} from '$lib/library/tracking';
import { ranobeLines } from '$lib/library/ranobe';
import type { Kind } from '$lib/library/types';
import type { LinkState } from '$lib/server/catalogue';
import type { TmdbLinkState } from '$lib/server/tmdb-links';
import { runtimeWords } from '$lib/library/tmdb';
import type { SeasonTrack, Tracking } from '$lib/server/tracking';
import type { RanobeSeries } from '$lib/server/ranobe-review';

// The signed-in-first rule lives with the library's tracking (c518): the
// server's word for a season's other part asks it too.
export { listState, mainList };

/** Which list EDIT opens the sheet on: AniList's (a season's, on an anime), or Ranobe's. */
export type SheetAt = { list: 'anilist'; season: number | null } | { list: 'ranobe' };

/**
 * One cell at a line's end. Its order is the handoff's rule: TRY AGAIN, SIGN
 * IN →, FIND or CHANGE, PASTE A LINK, EDIT (`CELL_ORDER`).
 */
export type Cell = {
	key: 'retry' | 'signin' | 'find' | 'change' | 'paste' | 'edit' | 'open' | 'setup';
	label: string;
	accent: boolean;
	/** Offline: drawn at 35%, not a control. OPEN ↗ is the one cell that never dims. */
	dim: boolean;
	href?: string;
	external?: boolean;
	/** A form the cell posts: `?/retryTracking` with its season, `?/retryRanobe`. */
	post?: { action: string; fields: Record<string, string> };
	/** EDIT: the sheet, on this line's entry and season tab. */
	edit?: SheetAt;
};

/** A line under the title: what the list says (left), what tsundoku did about it (right). */
export type StateLine = {
	l: string;
	r: string;
	/** Grey, regular: MAL's own line, a quiet second word, NOT ON YOUR LIST. */
	quiet: boolean;
	/** The right half in ink: why a send failed. */
	alert: boolean;
};

export type Line = {
	key: string;
	/** ANILIST, RNB, or S3 on an anime with seasons. */
	tag: string;
	/** The season being watched: its tag inverted. */
	on: boolean;
	title: string;
	/** Not linked: the title in grey. */
	muted: boolean;
	/** …and a size down, on an anime's lines (1C's `t mu sm`; 1B keeps the size). */
	small: boolean;
	meta: string;
	states: StateLine[];
	cells: Cell[];
	/** Ranobe's line under an anime's seasons: a rule above it (1C). */
	under: boolean;
};

export type Item =
	| { type: 'line'; line: Line }
	| { type: 'fold'; tag: string; word: string; ink: boolean; above: boolean }
	| { type: 'toggle'; count: number; expanded: boolean };

export type Lists = {
	/** The strip's note, right of LISTS: why the row is offline, or that a hidden show sends nothing. */
	note: string;
	items: Item[];
};

export type ListsInput = {
	seriesId: number;
	kind: Kind;
	link: LinkState | null;
	/** A film's or a show's TMDB link (c989); null or absent for any other kind. */
	tmdb?: TmdbLinkState | null;
	tracking: Tracking | null;
	ranobe: RanobeSeries | null;
	/** An anime's seasons; null for anything else. */
	seasons: SeasonRow[] | null;
	/** Its source is NEVER TRACKED (c522): every line says why, and no line offers a send. */
	neverTracked: boolean;
	/** SHOW on a fold: every season drawn. */
	expanded: boolean;
	offline: boolean;
	now: number;
	/** `resolve('/links')` and `resolve('/settings')`, so this stays free of `$app`. */
	linksHref: string;
	settingsHref: string;
};

const CELL_ORDER: Cell['key'][] = [
	'setup',
	'retry',
	'signin',
	'find',
	'change',
	'paste',
	'open',
	'edit'
];
const sortCells = (cells: Cell[]) =>
	cells.sort((a, b) => CELL_ORDER.indexOf(a.key) - CELL_ORDER.indexOf(b.key));

/**
 * Why a NEVER TRACKED series' line sends nothing (c522): the switch is its
 * source's, set on that source's settings page, so it is said on every line
 * that has a catalogue behind it instead of a send that would not happen.
 * One spelling, so the panel's row and its spec cannot drift apart.
 */
export const NEVER_TRACKED_WHY = 'NOTHING SENT · ITS SOURCE IS NEVER TRACKED';
const neverTrackedLine = (): StateLine => ({
	l: NEVER_TRACKED_WHY,
	r: '',
	quiet: true,
	alert: false
});

/** The strip's words offline (1B, 8): the one place the row says why every cell dims. */
export const OFFLINE_NOTE = '○ OFFLINE · CHANGES NEED THE WORKSTATION';

/** "MANGA", "ONE SHOT", "TV SHORT": a stored AniList format, as a line says it. */
export const formatWords = (format: string | null | undefined) =>
	format ? format.replace(/_/g, ' ') : '';

/**
 * A comic's word by where it comes from (c520; the handoff's 1B, `MANHWA ·
 * 2020`). AniList files every comic under one format, MANGA, and keeps the
 * country apart (`countryOfOrigin`, rung 70). A map from the country, not a
 * kind's name: the series' own kind is the library's word, this is the entry's.
 */
const COMIC_BY_COUNTRY: Record<string, string> = {
	JP: 'MANGA',
	KR: 'MANHWA',
	CN: 'MANHUA',
	TW: 'MANHUA'
};

/**
 * An entry's format as a line says it, a comic's by its country: a link not
 * asked yet (no country) or from a country the map doesn't name says its
 * format, as before rung 70. Every other format is its own word.
 */
export const entryWords = (
	format: string | null | undefined,
	country: string | null | undefined
) =>
	format === 'MANGA' && country && COMIC_BY_COUNTRY[country]
		? COMIC_BY_COUNTRY[country]
		: formatWords(format);

/**
 * The tag in front of a season's line. A flat list is never here (it draws as
 * one ANILIST line); season 0 beside numbered seasons is the episodes the
 * source gave none, and is named so, never S0 (c423).
 */
export const seasonCellTag = (season: number) => (season > 0 ? `S${season}` : 'OTHER');

/**
 * What the sheet calls the season it is on: SEASON 3 on a show with several,
 * THE OTHER EPISODES for the unnumbered ones beside them, and nothing at all
 * on a flat list or a show of one season, whose one season is 0 or 1 inside
 * and never named (c423).
 */
export function seasonWords(
	season: number | null,
	tabbed: boolean
): { subject: string; scope: string } {
	if (season === null) return { subject: '', scope: 'BOTH CATALOGUES' };
	const name = !tabbed ? '' : season > 0 ? `SEASON ${season}` : 'THE OTHER EPISODES';
	const owner = name ? (name.endsWith('S') ? `${name}’` : `${name}’S`) : 'THE SHOW’S';
	return { subject: name, scope: `${owner} ENTRY ON BOTH CATALOGUES` };
}

/** A fold's tag: "S1 – S2"; the unnumbered episodes, when the run holds them, as OTHER. */
export function foldTag(list: number[]): string {
	const numbered = list.filter((n) => n > 0);
	const run =
		numbered.length === 0
			? ''
			: numbered.length === 1
				? `S${numbered[0]}`
				: `S${numbered[0]} – S${numbered[numbered.length - 1]}`;
	return [list.includes(0) ? 'OTHER' : '', run].filter(Boolean).join(' + ');
}

/** The unit a line counts in, from the registry: "CH.", "EP.". */
const unitOf = (kind: Kind) => `${kindUnit(kind).short}.`;
const isVideo = (kind: Kind) => kindFacts(kind).medium === 'video';
/** "ADDED ON THE NEXT CHAPTER READ", "… EPISODE WATCHED". */
const addedOnNext = (kind: Kind) =>
	`ADDED ON THE NEXT ${kindUnit(kind).long} ${kindUnit(kind).done}`;

type ListState = NonNullable<TrackFacts['state']>;

/** "READING · CH. 214 · 9", "WATCHING · EP. 8 OF 24 · 8". */
function stateWords(s: ListState, kind: Kind, of: number | null = null): string {
	return [
		s.status ? statusLabel(s.status, isVideo(kind)) : '',
		s.progress > 0 ? `${unitOf(kind)} ${s.progress}${of ? ` OF ${of}` : ''}` : '',
		s.score ? String(Math.round(s.score * 10) / 10) : ''
	]
		.filter(Boolean)
		.join(' · ');
}

const sameState = (a: ListState | null, b: ListState | null) =>
	(!a && !b) || (!!a && !!b && a.status === b.status && a.progress === b.progress);

/** What tsundoku did about one list's entry, for a line's right half. */
function sentWords(f: TrackFacts, o: { offline: boolean; now: number }): string {
	if (o.offline) return f.sentAt ? `AS OF ${clock(f.sentAt)}` : '';
	if (f.waiting) return 'SENDING';
	return f.sentAt ? `SENT ${ago(f.sentAt, o.now)}` : '';
}

/** A send that failed: its own reason, and when. */
const failedWhy = (f: TrackFacts) =>
	`${f.waiting?.error ?? `${SERVICE_NAME[f.service]} DID NOT ANSWER`} · ${clock(f.waiting!.failedAt!)}`;

/**
 * The state lines of one entry on AniList (and MAL, through it): a comic's,
 * or one season's of an anime (Q3). MAL folds into AniList's line, and gets a
 * quiet line of its own only when it differs: signed in or out where AniList
 * isn't, a failed send, or another word or chapter on its list.
 *
 * `full` is the season being watched, or a comic: what was sent is said. A
 * season not being watched carries its word only (Q4), and a failure, which
 * is always that season's to say.
 */
export function entryStates(
	facts: (TrackFacts & { of?: number | null })[],
	o: {
		kind: Kind;
		offline: boolean;
		now: number;
		full: boolean;
		/** `PART 2 · `: the part being watched, when the season has two. */
		lead?: string;
		/** The other part's word, on the right (1C, a season in two parts). */
		other?: string;
		/** An episode past every part's count (`SeasonTrack.waits`). */
		waits?: { episode: number; of: number; service: TrackFacts['service'] } | null;
	}
): StateLine[] {
	const a = facts.find((f) => f.service === 'anilist' && f.linked) ?? null;
	const m = facts.find((f) => f.service === 'mal' && f.linked) ?? null;
	const main = mainList(facts);
	if (!main) return [];
	const other = a && m ? (main === a ? m : a) : null;
	const on = other ? SERVICE_NAME[other.service] : '';
	const failed = (f: TrackFacts) => !!f.waiting?.failedAt;
	const folded =
		!!other &&
		other.signedIn === main.signedIn &&
		!failed(other) &&
		!failed(main) &&
		sameState(main.state, other.state);
	const names = folded ? 'ANILIST AND MAL' : SERVICE_NAME[main.service];
	// MAL alone (AniList hasn't been asked yet, or has no entry): its name leads.
	const prefix = main === m ? 'MAL · ' : '';
	const unit = unitOf(o.kind);
	const lead = o.lead ?? '';
	const of = main.of ?? null;
	const out: StateLine[] = [];
	const line = (l: string, r: string, quiet = false, alert = false): StateLine => ({
		l,
		r: o.full || alert ? r : '',
		quiet,
		alert
	});
	if (!main.signedIn) {
		out.push(
			main.state
				? line(
						`${prefix}${lead}${stateWords(main.state, o.kind, of)}`,
						'NOT SIGNED IN · NOTHING SENT'
					)
				: line(`${names} · NOT SIGNED IN`, 'NOTHING SENT', true)
		);
	} else if (failed(main)) {
		const p = main.waiting?.progress ?? main.state?.progress ?? 0;
		out.push(line(`${prefix}${lead}${unit} ${p} NOT SENT`, failedWhy(main), false, true));
	} else if (!main.state) {
		if (o.waits)
			out.push(
				line(
					`${unit} ${o.waits.episode} WAITS`,
					`${SERVICE_NAME[o.waits.service]} LISTS ${o.waits.of}`
				)
			);
		else
			out.push(
				line(
					`${prefix}${lead}NOT ON YOUR LIST`,
					o.offline ? '' : main.waiting ? 'SENDING' : addedOnNext(o.kind),
					true
				)
			);
	} else {
		const sent = sentWords(main, o);
		const said = sent
			? folded && !o.offline && main.sentAt && !main.waiting
				? `ANILIST AND MAL · ${sent}`
				: sent
			: main === m && !a
				? 'SHOWN · ANILIST HAS NOTHING'
				: folded
					? 'ANILIST AND MAL · ON YOUR LIST'
					: 'ON YOUR LIST';
		if (o.other) {
			// Two parts: the other part's word on the right, and what was sent under it.
			out.push(line(`${lead}${stateWords(main.state, o.kind, of)}`, o.other));
			if (o.full) out.push(line(`${names} · ${said}`, '', true));
		} else out.push(line(`${prefix}${lead}${stateWords(main.state, o.kind, of)}`, said));
	}
	if (other && !folded && (o.full || failed(other))) {
		if (!other.signedIn)
			out.push(
				line(
					other.state?.progress ? `${on} AT ${unit} ${other.state.progress}` : on,
					'NOT SIGNED IN · NOTHING SENT',
					true
				)
			);
		else if (failed(other)) {
			const p = other.waiting?.progress ?? other.state?.progress ?? 0;
			out.push(line(`${on} · ${unit} ${p} NOT SENT`, failedWhy(other), true, true));
		} else if (!other.state)
			out.push(
				line(
					`${on} · NOT ON YOUR LIST`,
					o.offline ? '' : other.waiting ? 'SENDING' : addedOnNext(o.kind),
					true
				)
			);
		else
			out.push(
				line(
					main.state && main.state.status === other.state.status
						? `${on} AT ${unit} ${other.state.progress}`
						: `${on} · ${stateWords(other.state, o.kind, other.of ?? null)}`,
					sentWords(other, o) || 'ON YOUR LIST',
					true
				)
			);
	}
	return out;
}

/** TRY AGAIN or SIGN IN → for an entry's lists: what failed, or who is signed out. */
function trackCells(
	facts: TrackFacts[],
	o: { offline: boolean; settingsHref: string; season: number | null }
): Cell[] {
	const linked = facts.filter((f) => f.linked);
	const failed = linked.filter((f) => f.waiting?.failedAt);
	// A sign-in that expired is not tried again: SIGN IN → takes TRY AGAIN's place (1B, 4).
	const isExpired = (f: TrackFacts) => /SIGN-IN EXPIRED/.test(f.waiting?.error ?? '');
	const expired = failed.some(isExpired);
	const out: Cell[] = [];
	// Another list's failure is still tried again beside an expired sign-in.
	if (failed.some((f) => !isExpired(f)))
		out.push({
			key: 'retry',
			label: 'TRY AGAIN',
			accent: false,
			dim: o.offline,
			post: {
				action: '?/retryTracking',
				fields: o.season === null ? {} : { season: String(o.season) }
			}
		});
	if (expired || linked.some((f) => !f.signedIn))
		out.push({
			key: 'signin',
			label: 'SIGN IN →',
			accent: false,
			dim: o.offline,
			href: o.settingsHref
		});
	return out;
}

/** The entry's own catalogue page, by its stored format: `/anime/` or `/manga/` (c298). */
function entryHref(
	l: { anilistId: number | null; malId: number | null; kind?: Kind | null },
	kind: Kind
): string | null {
	const k = l.kind ?? kind;
	return l.anilistId ? anilistUrl(l.anilistId, k) : l.malId ? malUrl(l.malId, k) : null;
}

/** EDIT, or offline the one cell that still works, OPEN ↗ (1B, 8). */
function editCell(at: SheetAt, offline: boolean, openHref: string | null): Cell | null {
	if (!offline) return { key: 'edit', label: 'EDIT', accent: false, dim: false, edit: at };
	return openHref
		? { key: 'open', label: 'OPEN ↗', accent: false, dim: false, href: openHref, external: true }
		: null;
}

/** What the last search did, for a line not linked (1B, 1): never who ran it (c337). */
function searchWords(
	s: {
		hidden: boolean;
		queued: boolean;
		candidates: number;
		searched: boolean;
		decision: 'none' | 'unlinked' | null;
	},
	where = 'ANILIST'
): string {
	if (s.hidden) return 'HIDDEN SERIES ARE NEVER SEARCHED';
	if (s.decision === 'unlinked') return 'UNLINKED · NO PASS ASKS AGAIN';
	if (s.decision === 'none') return 'NONE OF THESE · NO PASS ASKS AGAIN';
	// A queued search really does wait for the next pass, so it may say so.
	if (s.queued) return 'A SEARCH WAITS FOR THE NEXT COVER PASS';
	if (s.candidates) return `${s.candidates} FOUND ON ${where} · NOT FOR CERTAIN`;
	return s.searched ? `NOTHING FOUND ON ${where}` : 'NOT SEARCHED YET · THE NEXT PASS SEARCHES IT';
}

/** FIND and PASTE A LINK for a line not linked; a hidden series gets PASTE alone, as its accent. */
function findCells(o: {
	href: string;
	hidden: boolean;
	settled: boolean;
	offline: boolean;
	/** A season's line keeps one cell: PASTE A LINK is on the review it opens (1C). */
	one: boolean;
}): Cell[] {
	if (o.hidden)
		return [
			{
				key: 'paste',
				label: o.one ? 'PASTE' : 'PASTE A LINK',
				accent: true,
				dim: o.offline,
				href: `${o.href}&paste`
			}
		];
	const find: Cell = {
		key: 'find',
		label: 'FIND',
		// A settled line's FIND is plain: the owner already said no (1C).
		accent: !o.settled,
		dim: o.offline,
		href: o.href
	};
	return o.one
		? [find]
		: [
				find,
				{
					key: 'paste',
					label: 'PASTE A LINK',
					accent: false,
					dim: o.offline,
					href: `${o.href}&paste`
				}
			];
}

/** CHANGE on a line linked to the wrong kind: its accent, asking this kind's own catalogue (1B, 6). */
const changeCell = (href: string, offline: boolean): Cell => ({
	key: 'change',
	label: 'CHANGE',
	accent: true,
	dim: offline,
	href
});

/** A comic's or a novel's AniList line, or a one-season anime's (a flat list is one: 1C, 12). */
function anilistLine(i: ListsInput, season: SeasonTrack | null, oneSeason: SeasonRow | null): Line {
	const link = i.link!;
	const l = link.linked;
	const findHref = `${i.linksHref}?series=${i.seriesId}`;
	const hidden = link.hidden;
	const t = i.tracking;
	const cells: Cell[] = [];
	const states: StateLine[] = [];
	let meta: string;
	if (!l) {
		meta = searchWords(
			oneSeason
				? {
						hidden,
						queued: oneSeason.queued,
						candidates: oneSeason.candidates,
						searched: oneSeason.searched,
						decision: oneSeason.decision
					}
				: link
		);
		// Nothing is linked, so there is no send to take away; the row still says
		// why it would never send (c522). FIND stays: a search is an ask, not a
		// send, and a link is still what gives it its cover and details.
		if (i.neverTracked) states.push(neverTrackedLine());
		cells.push(
			...findCells({
				href: findHref,
				hidden,
				settled: !!(oneSeason?.decision ?? link.decision),
				offline: i.offline,
				one: false
			})
		);
	} else {
		const sl = oneSeason?.link ?? null;
		meta = [
			// The comparison moved here from the LINK row with its logic (the kind ratchet).
			l.coverOnly
				? kindFacts(i.kind).medium === 'text'
					? 'THE COMIC’S ENTRY'
					: 'THE NOVEL’S ENTRY'
				: '',
			entryWords(l.format, l.country),
			sl?.episodes ? `${sl.episodes} EP.` : '',
			// A season's own year, else the comic's (rung 70); never `null`.
			(sl?.year ?? l.year) ? String(sl?.year ?? l.year) : '',
			l.malId ? `MAL ${l.malId}` : l.anilistId ? `ANILIST ${l.anilistId}` : '',
			l.resolving ? 'ANILIST ASKED IN THE NEXT COVER PASS' : ''
		]
			.filter(Boolean)
			.join(' · ');
		const tracked = !!t && t.catalogueTracks;
		if (i.neverTracked) states.push(neverTrackedLine());
		else if (hidden)
			states.push({
				l: 'NOTHING SENT · HIDDEN SERIES STAY OFF EVERY LIST',
				r: '',
				quiet: true,
				alert: false
			});
		else if (l.wrongKind) {
			states.push({
				l: 'LINKED TO THE WRONG KIND · NOTHING SENT',
				r: '',
				quiet: false,
				alert: false
			});
			states.push({
				l: `CHANGE SEARCHES ANILIST’S ${kindFacts(i.kind).catalogue.type}`,
				r: '',
				quiet: true,
				alert: false
			});
			cells.push(changeCell(findHref, i.offline));
		} else if (l.coverOnly)
			states.push({
				l: 'COVER AND DETAILS ONLY · NEVER TRACKED',
				r: '',
				quiet: true,
				alert: false
			});
		else if (t && !tracked)
			states.push({
				l: i.ranobe?.configured
					? 'COVER AND DETAILS · TRACKED ON RANOBE'
					: 'COVER AND DETAILS · NOT TRACKED HERE',
				r: '',
				quiet: true,
				alert: false
			});
		else if (t) {
			const facts = season ? season.facts : t.facts;
			states.push(
				...entryStates(facts, {
					kind: i.kind,
					offline: i.offline,
					now: i.now,
					full: true,
					lead: season && season.part > 1 ? `PART ${season.part} · ` : '',
					other: season ? otherPart(season) : undefined,
					waits: season?.waits ?? null
				})
			);
			cells.push(
				...trackCells(facts, {
					offline: i.offline,
					settingsHref: i.settingsHref,
					season: season ? season.season : null
				})
			);
		}
		// EDIT opens the sheet that sets STATUS and SCORE, which is a send: a
		// NEVER TRACKED series (c522) keeps only OPEN ↗, the cell offline gives.
		const edit =
			i.neverTracked && !i.offline
				? null
				: editCell(
						{ list: 'anilist', season: season ? season.season : null },
						i.offline,
						entryHref(l, i.kind)
					);
		if (edit) cells.push(edit);
	}
	return {
		key: 'anilist',
		tag: 'ANILIST',
		on: false,
		title: l ? l.title || l.ids || 'Linked' : 'Not linked',
		muted: !l,
		small: !l && !!oneSeason,
		meta,
		states,
		cells: sortCells(cells),
		under: false
	};
}

/** "PART 1 COMPLETED", the other part's own word when the season has two (1C). */
function otherPart(sv: SeasonTrack): string | undefined {
	const o = sv.other;
	if (!o) return undefined;
	return [
		`PART ${o.part}`,
		o.state ? statusLabel(o.state, true) : 'NOT LISTED',
		o.state !== 'completed' && o.progress > 0 ? `${o.progress} OF ${o.of ?? '—'}` : ''
	]
		.filter(Boolean)
		.join(' ');
}

/** One season's line on an anime with several (1C, 11). */
function seasonLineOf(i: ListsInput, sv: SeasonRow, open: boolean): Line {
	const t = i.tracking?.seasons?.find((s) => s.season === sv.season) ?? null;
	const hidden = !!i.tracking?.hidden || !!i.link?.hidden;
	const findHref = `${i.linksHref}?series=${i.seriesId}&season=${sv.season}`;
	const l = sv.link;
	const cells: Cell[] = [];
	const states: StateLine[] = [];
	let meta = '';
	if (!l) {
		meta = searchWords({
			hidden,
			queued: sv.queued,
			candidates: sv.candidates,
			searched: sv.searched,
			decision: sv.decision
		});
		// Unlinked, so no send to take away; the line still says why it never would (c522).
		if (i.neverTracked) states.push(neverTrackedLine());
		cells.push(
			...findCells({
				href: findHref,
				hidden,
				settled: !!sv.decision,
				offline: i.offline,
				one: true
			})
		);
	} else {
		const parts = sv.parts.filter((p) => p.link);
		// Only the season being watched adds its meta (Q4); a hidden show says nothing
		// else of a season, so every linked season keeps its meta there.
		if (open || hidden)
			meta = [
				parts.length > 1 ? `${parts.length} PARTS` : '',
				parts.length > 1 ? partsLabel(parts).replace(/PART \d · /g, '') : '',
				formatWords(l.format),
				l.episodes && parts.length < 2 ? `${l.episodes} EP.` : '',
				l.year ? String(l.year) : '',
				hidden ? viaLabel(l.via) : l.malId ? `MAL ${l.malId}` : ''
			]
				.filter(Boolean)
				.join(' · ');
		if (i.neverTracked) states.push(neverTrackedLine());
		else if (t && !hidden) {
			if (t.wrongKind) {
				states.push({
					l: 'LINKED TO THE WRONG KIND · NOTHING SENT',
					r: '',
					quiet: false,
					alert: false
				});
				cells.push(changeCell(findHref, i.offline));
			} else if (t.coverOnly)
				states.push({
					l: 'COVER AND DETAILS ONLY · NEVER TRACKED',
					r: '',
					quiet: true,
					alert: false
				});
			else {
				states.push(
					...entryStates(t.facts, {
						kind: i.kind,
						offline: i.offline,
						now: i.now,
						full: open,
						lead: t.part > 1 ? `PART ${t.part} · ` : '',
						other: open ? otherPart(t) : undefined,
						waits: t.waits
					})
				);
				cells.push(
					...trackCells(t.facts, {
						offline: i.offline,
						settingsHref: i.settingsHref,
						season: sv.season
					})
				);
			}
		}
		// A season's EDIT sets its STATUS and SCORE, a send: NEVER TRACKED keeps OPEN ↗ alone.
		const edit =
			i.neverTracked && !i.offline
				? null
				: editCell(
						{ list: 'anilist', season: sv.season },
						i.offline,
						entryHref({ ...l, kind: null }, i.kind)
					);
		if (edit) cells.push(edit);
	}
	return {
		key: `s${sv.season}`,
		tag: seasonCellTag(sv.season),
		on: open,
		title: l ? l.title : 'Not linked',
		muted: !l,
		small: !l,
		meta,
		states,
		cells: sortCells(cells),
		under: false
	};
}

/** Ranobe's line: a comic's or a novel's work, or one work across an anime's seasons (1B, 9, 10). */
function ranobeLine(i: ListsInput, under: boolean): Line {
	const r = i.ranobe!;
	const anime = !!i.seasons;
	const findHref = `${i.linksHref}?series=${i.seriesId}&service=ranobe`;
	const cells: Cell[] = [];
	const states: StateLine[] = [];
	const track = ranobeLines(r.facts, { now: i.now, offline: i.offline, ago, clock });
	// The tag says RANOBE already, so a line doesn't lead with it.
	const bare = (s: string) => s.replace(/^RANOBE · /, '');
	let meta: string;
	if (r.link) {
		const many = (i.seasons?.length ?? 0) > 1;
		meta = anime
			? [
					r.link.meta.split(' · ')[0],
					many ? `ONE ENTRY FOR ALL ${i.seasons!.length} SEASONS` : 'ONE ENTRY FOR THE SERIES'
				]
					.filter(Boolean)
					.join(' · ')
			: r.link.meta;
		// NEVER TRACKED (c522): the reason, instead of what was sent and the cells
		// that send it. FIND and PASTE a link stay: a search is an ask, not a send.
		if (i.neverTracked) states.push(neverTrackedLine());
		else {
			for (const t of track?.lines ?? [])
				states.push({ l: bare(t.l), r: t.r, quiet: !t.strong, alert: t.rStrong });
			if (track?.retry)
				cells.push({
					key: 'retry',
					label: 'TRY AGAIN',
					accent: false,
					dim: i.offline,
					post: { action: '?/retryRanobe', fields: {} }
				});
		}
		const edit =
			i.neverTracked && !i.offline ? null : editCell({ list: 'ranobe' }, i.offline, r.link.href);
		if (edit) cells.push(edit);
	} else {
		meta = r.unlinkedMeta;
		// Not linked, only a suggestion waiting says more than the title does.
		if (i.neverTracked) states.push(neverTrackedLine());
		else if (r.facts.suggested)
			for (const t of track?.lines ?? [])
				states.push({ l: bare(t.l), r: t.r, quiet: !t.strong, alert: t.rStrong });
		cells.push(
			...findCells({
				href: findHref,
				hidden: r.hidden,
				settled: false,
				offline: i.offline,
				one: anime
			})
		);
	}
	return {
		key: 'ranobe',
		tag: 'RNB',
		on: false,
		title: r.link ? r.link.title : r.hidden ? 'Not linked' : 'Not on Ranobe',
		muted: !r.link,
		small: !r.link && anime,
		meta,
		states,
		cells: sortCells(cells),
		under
	};
}

/** What a fold says of the seasons in it: what wants the owner first, in ink. */
function foldWord(i: ListsInput, list: number[]): { word: string; ink: boolean } {
	const rows = list
		.map((n) => i.seasons?.find((s) => s.season === n))
		.filter((s): s is SeasonRow => !!s);
	const unlinked = rows.filter((s) => !s.link && !s.parts.some((p) => p.link));
	if (unlinked.length) return { word: `${unlinked.length} NOT LINKED`, ink: true };
	const tracks = list
		.map((n) => i.tracking?.seasons?.find((s) => s.season === n))
		.filter((s): s is SeasonTrack => !!s);
	if (tracks.some((s) => s.facts.some((f) => f.waiting?.failedAt)))
		return { word: 'A SEND FAILED', ink: true };
	const word = (s: SeasonTrack) => listState(s.facts)?.status ?? null;
	if (tracks.length === rows.length && tracks.every((s) => word(s) === 'completed'))
		return { word: 'COMPLETED', ink: false };
	return { word: 'LINKED', ink: false };
}

/**
 * The row, in order: the line that tracks comes first (AniList on a comic,
 * Ranobe on a novel, the seasons on an anime), then the other list. Null when
 * there is nothing to list: a doujin is never linked.
 */
/**
 * A film's or a show's TMDB line (c989; the keys handoff, Board 2:
 * doc/handoffs/keys-accounts/Keys-Rows.dc.html). With no key it is the one
 * place that says why the film is only its title and cover: a muted "Not
 * looked up", the source it comes from, and SET UP → in ink, not the accent
 * (the accent marks what is the owner's or active, and this is neither yet).
 * With a key it is an ordinary link line: the entry, `FILM · 2019 · 1 H 52` or
 * `SHOW · 2024 · 3 SEASONS ON TMDB`, and CHANGE; not linked, the AniList line's
 * search words and FIND.
 */
export function tmdbLine(i: ListsInput, t: TmdbLinkState): Line {
	const film = i.kind === 'movie';
	const findHref = `${i.linksHref}?series=${i.seriesId}`;
	const base = { key: 'tmdb', tag: 'TMDB', on: false, small: false, under: false, states: [] };
	if (!t.configured)
		return {
			...base,
			title: 'Not looked up',
			muted: true,
			meta: `NO TMDB KEY · TITLE AND COVER FROM ${t.source}`,
			cells: [
				{
					key: 'setup',
					label: 'SET UP →',
					accent: false,
					// A link to read, not a workstation call: it works offline too.
					dim: false,
					href: `${i.settingsHref}?section=catalogues#tmdb`
				}
			]
		};
	const l = t.linked;
	if (!l)
		return {
			...base,
			title: 'Not linked',
			muted: true,
			meta: searchWords(t, 'TMDB'),
			cells: sortCells(
				findCells({
					href: findHref,
					hidden: t.hidden,
					settled: !!t.decision,
					offline: i.offline,
					one: false
				})
			)
		};
	return {
		...base,
		title: l.title || `TMDB ${l.tmdbId}`,
		muted: false,
		meta: [
			film ? 'FILM' : 'SHOW',
			l.year ? String(l.year) : '',
			film ? runtimeWords(l.runtime) : l.seasons ? `${l.seasons} SEASONS ON TMDB` : ''
		]
			.filter(Boolean)
			.join(' · '),
		cells: [{ key: 'change', label: 'CHANGE', accent: false, dim: i.offline, href: findHref }]
	};
}

export function listsRow(i: ListsInput): Lists | null {
	// A film or a show has no AniList line: its catalogue is TMDB's (c989).
	if (i.tmdb)
		return {
			note: i.offline ? OFFLINE_NOTE : '',
			items: [{ type: 'line', line: tmdbLine(i, i.tmdb) }]
		};
	if (!i.link && !(i.ranobe?.configured && i.ranobe)) return null;
	const onRanobe = !!i.ranobe?.configured;
	const hidden = !!i.tracking?.hidden || !!i.link?.hidden;
	const items: Item[] = [];
	const many = isAnime(i.kind) && !!i.seasons && i.seasons.length > 1;
	if (many) {
		const numbers = i.seasons!.map((s) => s.season);
		const open = i.tracking?.openSeason ?? numbers[0];
		for (const plan of seasonPlan(numbers, open, i.expanded)) {
			if (plan.type === 'line') {
				const sv = i.seasons!.find((s) => s.season === plan.season);
				if (sv) items.push({ type: 'line', line: seasonLineOf(i, sv, sv.season === open) });
			} else if (plan.type === 'fold')
				items.push({
					type: 'fold',
					tag: foldTag(plan.seasons),
					above: plan.above,
					...foldWord(i, plan.seasons)
				});
			else items.push({ type: 'toggle', count: plan.seasons.length, expanded: plan.expanded });
		}
		if (onRanobe) items.push({ type: 'line', line: ranobeLine(i, true) });
	} else {
		const lines: Line[] = [];
		const one = isAnime(i.kind) && i.seasons?.length === 1 ? i.seasons[0] : null;
		const season = one ? (i.tracking?.seasons?.find((s) => s.season === one.season) ?? null) : null;
		if (i.link) lines.push(anilistLine(i, season, one));
		if (onRanobe) {
			const rnb = ranobeLine(i, false);
			// The line that tracks comes first: Ranobe, where AniList takes none of it.
			if (i.tracking && !i.tracking.catalogueTracks) lines.unshift(rnb);
			else lines.push(rnb);
		}
		items.push(...lines.map((line): Item => ({ type: 'line', line })));
	}
	return {
		note: i.offline
			? OFFLINE_NOTE
			: i.neverTracked
				? 'NOTHING SENT · NEVER TRACKED'
				: hidden && many
					? 'NOTHING SENT · HIDDEN'
					: '',
		items
	};
}

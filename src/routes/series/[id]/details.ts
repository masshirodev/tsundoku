import type { Lists } from './lists';

/**
 * DETAILS, the fold on a phone and a TV (doc/SERIES.md, "DETAILS", which
 * says why the tablet in portrait does not fold): the rows a
 * visit rarely touches fold behind one 64px line, and the line says enough
 * that a problem isn't hidden. Everything here is read from facts the panel
 * already has (each mark's source is named on its function); nothing asks the
 * server again.
 */

/** Something that needs the user, inside the fold: inked on the folded line. */
export type DetailsMark = {
	/** Who it is about, for the count's list: `MAL`, `S2`, `MANGADEX`. */
	tag: string;
	/** What the line says when it is the only one. */
	text: string;
};

/** Work under way inside the fold: the quiet line's word and the 3px bar's fill. */
export type DetailsRunning = { word: string; fraction: number };

export type DetailsLine = {
	/** The line over the names; '' draws the names alone. */
	state: string;
	/** In ink and 500: something needs the user. */
	ink: boolean;
	/** The names of what is inside, in their order. */
	names: string[];
	/** The bar's fill, 0–1, while something runs; null draws no bar. */
	bar: number | null;
};

/** The localStorage key: open or closed, everywhere on this device (not per series). */
export const DETAILS_KEY = 'tsundoku:series-details';

/** The stored word, read back: anything but '1' is the default, closed. */
export const detailsOpen = (stored: string | null | undefined): boolean => stored === '1';

/** How many names the TV's 352px column spells out before `· N MORE`. */
export const TV_NAMES = 4;

/** The names line: all of them, or the first `max` and how many more. */
export function namesLine(names: string[], max = Infinity): string {
	if (names.length <= max) return names.join(' · ');
	return [...names.slice(0, max), `${names.length - max} MORE`].join(' · ');
}

const MAL_LEAD = /^MAL · /;

/**
 * LISTS' marks (lists.ts): a send that failed, which is a state line in
 * `alert` (`entryStates`' NOT SENT, under TRY AGAIN), and a list not linked,
 * which is AniList's or a season's line titled `Not linked` with FIND on it.
 * A fold of seasons in ink (`foldWord`) carries a failure inside it. Ranobe's
 * `Not linked` is a hidden series that sends nothing on purpose, and `Not on
 * Ranobe` a fact, so neither is a mark.
 */
export function listsMarks(lists: Lists | null): DetailsMark[] {
	if (!lists) return [];
	const out: DetailsMark[] = [];
	for (const item of lists.items) {
		if (item.type === 'fold') {
			if (item.ink) out.push({ tag: item.tag, text: `${item.tag} · ${item.word}` });
			continue;
		}
		if (item.type !== 'line') continue;
		const l = item.line;
		const failed = l.states.find((s) => s.alert);
		if (failed) {
			// A second list's failure names itself (`MAL · CH. 186 NOT SENT`).
			const tag = MAL_LEAD.test(failed.l) ? 'MAL' : l.tag;
			out.push({ tag, text: MAL_LEAD.test(failed.l) ? failed.l : `${l.tag} · ${failed.l}` });
		} else if (
			l.key !== 'ranobe' &&
			l.title === 'Not linked' &&
			l.cells.some((c) => c.key === 'find')
		) {
			out.push({ tag: l.tag, text: `${l.tag} NOT LINKED · NOTHING IS SENT` });
		}
	}
	return out;
}

/** SOURCE's mark (doc/MOVE.md): its trouble in ink, `NOT ANSWERED …`, named by the source. */
export function sourceMark(
	move: { eligible: boolean; source: string; trouble: string | null } | null | undefined
): DetailsMark[] {
	if (!move?.eligible || !move.trouble) return [];
	const tag = move.source.toUpperCase();
	return [{ tag, text: `${tag} · ${move.trouble}` }];
}

/**
 * What was sent, in LISTS' own words: the line's state says where the list is
 * (`READING · CH. 214 · 9`) and its right half that it was sent (`SENT 12 MIN
 * AGO`, `ANILIST AND MAL · SENT …`), so the folded line says `SENT CH. 214`. A
 * list that sent nothing, or whose send failed, has no such word.
 */
export function sentWord(lists: Lists | null): string {
	for (const item of lists?.items ?? []) {
		if (item.type !== 'line') continue;
		for (const s of item.line.states) {
			if (s.alert || s.quiet || !/(^|· )SENT /.test(s.r)) continue;
			const unit = /\b(?:CH|EP|VOL)\. [\d.]+/.exec(s.l);
			if (unit) return `SENT ${unit[0]}`;
		}
	}
	return '';
}

/**
 * The folded line: quiet in text-2 when nothing needs the user, the one
 * mark's words in ink when one does, and `2 TO LOOK AT · MAL · MANGADEX` when
 * several do. Running work keeps whichever line it is and fills the bar. It
 * never opens the fold: the mark tells, the user decides.
 */
export function detailsLine(o: {
	names: string[];
	marks: DetailsMark[];
	/** The quiet words, in order: FOLLOWING or the direction, then what was sent. */
	quiet: string[];
	running: DetailsRunning | null;
}): DetailsLine {
	const bar = o.running ? Math.min(1, Math.max(0, o.running.fraction)) : null;
	if (o.marks.length === 1) return { state: o.marks[0].text, ink: true, names: o.names, bar };
	if (o.marks.length > 1) {
		const tags = [...new Set(o.marks.map((m) => m.tag))];
		return {
			state: [`${o.marks.length} TO LOOK AT`, ...tags].join(' · '),
			ink: true,
			names: o.names,
			bar
		};
	}
	const quiet = o.running ? [o.running.word, ...o.quiet.slice(1)] : o.quiet;
	return { state: quiet.filter(Boolean).join(' · '), ink: false, names: o.names, bar };
}

/**
 * Tracking, the pure part (doc/TRACKING.md): status in tsundoku's words and
 * each catalogue's, the forward-only rule, and which list an entry's line
 * speaks for (`mainList`). The lines themselves are the series screen's
 * (`src/routes/series/[id]/lists.ts`). No database, no network.
 */

import { isAnime } from './catalogue.ts';
import type { Kind } from './types.ts';

export type Service = 'anilist' | 'mal';
export const SERVICES: Service[] = ['anilist', 'mal'];
export const SERVICE_NAME: Record<Service, string> = { anilist: 'ANILIST', mal: 'MAL' };

/** A list status in tsundoku's words: the sheet's five (Series Link 1m). */
export type Status = 'reading' | 'planning' | 'on_hold' | 'completed' | 'dropped';
export const STATUSES: Status[] = ['reading', 'planning', 'on_hold', 'completed', 'dropped'];
export const STATUS_LABEL: Record<Status, string> = {
	reading: 'READING',
	planning: 'PLANNING',
	on_hold: 'ON HOLD',
	completed: 'COMPLETED',
	dropped: 'DROPPED'
};

const FROM: Record<Service, Record<string, Status>> = {
	// AniList's MediaListStatus. REPEATING is reading again.
	anilist: {
		CURRENT: 'reading',
		REPEATING: 'reading',
		PLANNING: 'planning',
		PAUSED: 'on_hold',
		COMPLETED: 'completed',
		DROPPED: 'dropped'
	},
	mal: {
		reading: 'reading',
		plan_to_read: 'planning',
		// MAL's anime list says the same two in its own words; no manga row is
		// ever either, so one map still holds both lists (c298).
		watching: 'reading',
		plan_to_watch: 'planning',
		on_hold: 'on_hold',
		completed: 'completed',
		dropped: 'dropped'
	}
};
const TO: Record<Service, Record<Status, string>> = {
	anilist: {
		reading: 'CURRENT',
		planning: 'PLANNING',
		on_hold: 'PAUSED',
		completed: 'COMPLETED',
		dropped: 'DROPPED'
	},
	mal: {
		reading: 'reading',
		planning: 'plan_to_read',
		on_hold: 'on_hold',
		completed: 'completed',
		dropped: 'dropped'
	}
};

export const statusFrom = (service: Service, remote: string | null | undefined): Status | null =>
	remote ? (FROM[service][remote] ?? null) : null;

/**
 * Tsundoku's status in one catalogue's words. MAL keeps two lists with two
 * sets of words -- `reading`/`plan_to_read` for a manga, `watching`/
 * `plan_to_watch` for an anime -- so the entry's own kind decides the two
 * that differ (c240). Without a kind it is the manga's words, which is what
 * every caller but an anime's send means.
 */
export const statusTo = (service: Service, status: Status, kind?: Kind): string => {
	if (service === 'mal' && isAnime(kind)) {
		if (status === 'reading') return 'watching';
		if (status === 'planning') return 'plan_to_watch';
	}
	return TO[service][status];
};

/**
 * How far a series has been read, as a chapter a catalogue counts: the
 * highest chapter number among the entries read. Extras sit between numbers
 * (Ch. 12.5), so it's rounded down. Nothing read is 0.
 */
export function chapterReached(read: { position: number }[]): number {
	return read.reduce((m, e) => Math.max(m, Math.floor(e.position)), 0);
}

/**
 * What a chapter (or an episode) read here would send: the progress, only
 * when it's further than the catalogue has and than what already waits (a
 * lower one is never sent: Mihon on the phone can be ahead). A series on
 * nobody's list, or only planned, starts READING; any other status is the
 * owner's and stays.
 *
 * `complete` is the anime's own rule (c240): the part's last counted episode
 * is watched, so the entry itself is done. It is queued as COMPLETED unless
 * the catalogue already says so -- which is what keeps it from being sent
 * again on every pass. When the progress has already gone (the list was
 * ahead of us), only the status is sent, so nothing is ever lowered. ON HOLD
 * and DROPPED are the owner's even then: the progress goes, the status stays
 * (Track Calls, question 2: "never overwritten").
 */
export function progressToSend(o: {
	reached: number;
	remote: { progress: number; status: Status | null } | null;
	waiting: number | null;
	complete?: boolean;
}): { progress: number | null; status: Status | null } | null {
	if (o.reached <= 0) return null;
	const known = Math.max(o.remote?.progress ?? 0, o.waiting ?? 0);
	const owners = o.remote?.status === 'on_hold' || o.remote?.status === 'dropped';
	const done = !!o.complete && o.remote?.status !== 'completed' && !owners;
	if (o.reached <= known) {
		// The progress has gone (the list can be ahead of us): the last episode
		// finishes the entry, and a status alone is sent -- nothing lowered.
		return done && (o.remote?.progress ?? 0) >= o.reached
			? { progress: null, status: 'completed' }
			: null;
	}
	const status: Status | null = done
		? 'completed'
		: !o.remote?.status || o.remote.status === 'planning'
			? 'reading'
			: null;
	return { progress: o.reached, status };
}

/** "12 MIN AGO", "3 H AGO", "2 D AGO", or "JUST NOW". */
export function ago(at: number, now: number): string {
	const m = Math.floor((now - at) / 60_000);
	if (m < 1) return 'JUST NOW';
	if (m < 60) return `${m} MIN AGO`;
	const h = Math.floor(m / 60);
	if (h < 48) return `${h} H AGO`;
	return `${Math.floor(h / 24)} D AGO`;
}

/** "09:14", local to the owner's device. */
export const clock = (at: number) =>
	new Date(at).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });

/** What one catalogue's line on the TRACKING row needs to know. */
export type TrackFacts = {
	service: Service;
	signedIn: boolean;
	/** On the owner's list there: what it says. */
	state: { status: Status | null; progress: number; score: number | null } | null;
	/** Waiting to be sent, and why it didn't go. */
	waiting: { progress: number | null; failedAt: number | null; error: string | null } | null;
	sentAt: number | null;
	/** The link names an entry on this catalogue. */
	linked: boolean;
};

/**
 * Tsundoku's status in the row's words. An anime is watched rather than read
 * (c240, the design's "WATCHING"): the underlying status is the same one.
 */
export const statusLabel = (status: Status, live = false): string =>
	live && status === 'reading' ? 'WATCHING' : STATUS_LABEL[status];

/**
 * The list an entry's line speaks for: the first linked list that is signed
 * in, AniList before MAL, and AniList when neither is (c518). A MAL-only
 * owner with AniList linked but signed out sees MAL's word; the signed-out
 * list is then the quiet line that differs. The series screen's line, a
 * fold's word, the sheet's STATUS and the server's word for a season's other
 * part all ask this, so they agree.
 */
export function mainList<F extends TrackFacts>(facts: F[]): F | null {
	const linked = facts.filter((f) => f.linked);
	const a = linked.find((f) => f.service === 'anilist') ?? null;
	const m = linked.find((f) => f.service === 'mal') ?? null;
	return [a, m].find((f) => f?.signedIn) ?? a ?? m;
}

/** The word an entry's lists say: the main list's, else the other linked list's. */
export function listState<F extends TrackFacts>(facts: F[]): F['state'] {
	const main = mainList(facts);
	return main?.state ?? facts.find((f) => f.linked && f !== main && f.state)?.state ?? null;
}

// ---- a season's facts (c240; doc/TRACKING.md, "The screens") --------------------------------

/** One catalogue's facts for a season's part, with the entry's own episode count. */
export type SeasonFact = TrackFacts & { part: number; of: number | null };

/** What the server knows of one season's parts: the other part's word and an episode that waits. */
export type SeasonTrackFacts = {
	season: number;
	/** The part being watched: part 2 when that is where the watched mark is. */
	part: number;
	/** Where each linked part starts and ends in the season's own numbering. */
	parts: { part: number; from: number; to: number }[];
	facts: SeasonFact[];
	/** The other part, when the season has two: its own word, on the right. */
	other: { part: number; state: Status | null; progress: number; of: number | null } | null;
	/** A season with no link at all: nothing is sent, and the row says so. */
	linked: boolean;
	/** An episode watched past the entry's count, with no part 2 to take it. */
	waits: { episode: number; of: number; service: Service } | null;
};

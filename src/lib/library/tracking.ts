/**
 * Tracking, the pure part (doc/TRACKING.md): status in tsundoku's words and
 * each catalogue's, the forward-only rule, and the lines the series screen's
 * TRACKING row shows. No database, no network.
 */

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
export const statusTo = (service: Service, status: Status): string => TO[service][status];

/**
 * How far a series has been read, as a chapter a catalogue counts: the
 * highest chapter number among the entries read. Extras sit between numbers
 * (Ch. 12.5), so it's rounded down. Nothing read is 0.
 */
export function chapterReached(read: { position: number }[]): number {
	return read.reduce((m, e) => Math.max(m, Math.floor(e.position)), 0);
}

/**
 * What a chapter read here would send: the chapter, only when it's further
 * than the catalogue has and than what already waits (a lower one is never
 * sent: Mihon on the phone can be ahead). A series on nobody's list, or
 * only planned, starts READING; any other status is the owner's and stays.
 */
export function progressToSend(o: {
	reached: number;
	remote: { progress: number; status: Status | null } | null;
	waiting: number | null;
}): { progress: number; status: Status | null } | null {
	const known = Math.max(o.remote?.progress ?? 0, o.waiting ?? 0);
	if (o.reached <= 0 || o.reached <= known) return null;
	const status = !o.remote?.status || o.remote.status === 'planning' ? 'reading' : null;
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

/** "ANILIST · READING · CH. 187 · 9": status, chapter, score, as far as known. */
export function stateLine(service: Service, s: NonNullable<TrackFacts['state']>): string {
	return [
		SERVICE_NAME[service],
		s.status ? STATUS_LABEL[s.status] : '',
		s.progress > 0 ? `CH. ${s.progress}` : '',
		s.score ? String(Math.round(s.score * 10) / 10) : ''
	]
		.filter(Boolean)
		.join(' · ');
}

/**
 * One catalogue's line (Series Link 1k–1q): left, what it says; right, what
 * tsundoku did about it. `strong` draws the line in ink rather than grey: the
 * main list (AniList), and a send that failed.
 */
export function trackLine(
	f: TrackFacts,
	o: { now: number; offline: boolean; mainIsEmpty: boolean }
): { left: string; right: string; strong: boolean; alert: boolean } {
	const name = SERVICE_NAME[f.service];
	if (!f.linked) return { left: `${name} · NO ENTRY`, right: '', strong: false, alert: false };
	if (!f.signedIn)
		return {
			left: f.state ? stateLine(f.service, f.state) : `${name} · NOT SIGNED IN`,
			right: f.state ? 'NOT SIGNED IN · NOTHING SENT' : 'NOTHING SENT',
			strong: false,
			alert: false
		};
	if (f.waiting?.failedAt)
		return {
			left: `${name} · CH. ${f.waiting.progress ?? f.state?.progress ?? 0} NOT SENT`,
			right: `${f.waiting.error ?? `${name} DID NOT ANSWER`} · ${clock(f.waiting.failedAt)}`,
			strong: true,
			alert: true
		};
	if (!f.state)
		return {
			left: `${name} · NOT ON YOUR LIST`,
			right: f.waiting ? 'SENDING' : 'ADDED ON THE NEXT CHAPTER READ',
			strong: false,
			alert: false
		};
	const right = o.offline
		? f.sentAt
			? `AS OF ${clock(f.sentAt)}`
			: ''
		: f.waiting
			? 'SENDING'
			: f.sentAt
				? `SENT ${ago(f.sentAt, o.now)}`
				: f.service === 'mal' && o.mainIsEmpty
					? 'SHOWN · ANILIST HAS NOTHING'
					: 'ON YOUR LIST';
	return {
		left: stateLine(f.service, f.state),
		right,
		strong: f.service === 'anilist' || o.mainIsEmpty,
		alert: false
	};
}

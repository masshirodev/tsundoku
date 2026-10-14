import { randomBytes } from 'node:crypto';
import { getDb } from './db.ts';
import { HIDDEN_SQL } from './visibility.ts';
import {
	MEDIA,
	SignedOut,
	Unreachable,
	anilistAs,
	linkFromList,
	linkableByTitle,
	toCandidate,
	type Media
} from './catalogue.ts';
import * as ranobe from './ranobe.ts';
import { cleanTitle, coverOnly, normaliseTitle, type Kind } from '../library/catalogue.ts';
import {
	SERVICES,
	SERVICE_NAME,
	chapterReached,
	progressToSend,
	statusFrom,
	statusTo,
	type Service,
	type Status,
	type TrackFacts
} from '../library/tracking.ts';

/**
 * Tracking (doc/TRACKING.md): the owner's AniList and MAL lists, read, and
 * written forward from what's read here.
 *
 * - **Sign-ins** are OAuth, from SETTINGS: AniList's code grant (a token for
 *   a year, no refresh), MAL's with a plain PKCE verifier (31 days, refreshed).
 * - **Reading the lists** keeps what each says of a linked series, and links
 *   an entry on the AniList list to its series when the title is sure.
 * - **Sending** follows a chapter finished here: the furthest one, only when
 *   it's further than the list has. Never for a hidden series, never through
 *   a cover-only link, never while incognito (the reading isn't recorded).
 */

type Account = {
	service: Service;
	user_id: string;
	user_name: string;
	access_token: string;
	refresh_token: string | null;
	expires_at: number | null;
	signed_in_at: number;
	list_read_at: number | null;
};

const env = (k: string) => process.env[k] ?? '';

export function account(service: Service): Account | null {
	return (
		(getDb().prepare(`SELECT * FROM tracker_accounts WHERE service = ?`).get(service) as
			Account | undefined) ?? null
	);
}

/** Whether a catalogue can be signed in to at all: its app registered, its keys in .env. */
export const configured = (service: Service) =>
	service === 'anilist'
		? !!env('ANILIST_CLIENT_ID') && !!env('ANILIST_CLIENT_SECRET')
		: !!env('MAL_CLIENT_ID') && !!env('MAL_CLIENT_SECRET');

// ---- signing in ---------------------------------------------------------------------------

/** Where a catalogue sends the owner back: registered with each app, exactly. */
export const redirectUri = (origin: string, service: Service) =>
	`${origin}/settings/catalogues/${service}`;

/**
 * The first half of a sign-in: where to send the owner, and what to keep in
 * a cookie until they're back (the state, and MAL's verifier).
 */
export function signInStart(service: Service, origin: string): { url: string; keep: string } {
	const state = randomBytes(18).toString('base64url');
	if (service === 'anilist') {
		const q = new URLSearchParams({
			client_id: env('ANILIST_CLIENT_ID'),
			redirect_uri: redirectUri(origin, service),
			response_type: 'code',
			state
		});
		return { url: `https://anilist.co/api/v2/oauth/authorize?${q}`, keep: state };
	}
	// MAL takes only the plain method: the challenge is the verifier itself.
	const verifier = randomBytes(48).toString('base64url');
	const q = new URLSearchParams({
		response_type: 'code',
		client_id: env('MAL_CLIENT_ID'),
		redirect_uri: redirectUri(origin, service),
		state,
		code_challenge: verifier,
		code_challenge_method: 'plain'
	});
	return { url: `https://myanimelist.net/v1/oauth2/authorize?${q}`, keep: `${state}.${verifier}` };
}

type Tokens = { access: string; refresh: string | null; expiresAt: number | null };

async function tokenRequest(url: string, body: Record<string, string>, json: boolean) {
	let res: Response;
	try {
		res = await fetch(url, {
			method: 'POST',
			headers: {
				'content-type': json ? 'application/json' : 'application/x-www-form-urlencoded',
				accept: 'application/json'
			},
			body: json ? JSON.stringify(body) : new URLSearchParams(body).toString(),
			signal: AbortSignal.timeout(20_000)
		});
	} catch (e) {
		throw new Unreachable(String(e));
	}
	const t = (await res.json().catch(() => null)) as {
		access_token?: string;
		refresh_token?: string;
		expires_in?: number;
	} | null;
	if (!res.ok || !t?.access_token) throw new SignedOut(`sign-in refused (${res.status})`);
	return {
		access: t.access_token,
		refresh: t.refresh_token ?? null,
		expiresAt: t.expires_in ? Date.now() + t.expires_in * 1000 : null
	} satisfies Tokens;
}

/**
 * The second half: the code the catalogue sent back, checked against the
 * state kept, traded for a token, and the account saved. Then the list is
 * read, in the background.
 */
export async function signInFinish(
	service: Service,
	origin: string,
	o: { code: string; state: string; kept: string },
	now = Date.now()
): Promise<{ userName: string; listRead: Promise<unknown> }> {
	const [state, verifier] = o.kept.split('.');
	if (!state || state !== o.state) throw new SignedOut('the sign-in came back for another request');
	const tokens =
		service === 'anilist'
			? await tokenRequest(
					'https://anilist.co/api/v2/oauth/token',
					{
						grant_type: 'authorization_code',
						client_id: env('ANILIST_CLIENT_ID'),
						client_secret: env('ANILIST_CLIENT_SECRET'),
						redirect_uri: redirectUri(origin, service),
						code: o.code
					},
					true
				)
			: await tokenRequest(
					'https://myanimelist.net/v1/oauth2/token',
					{
						grant_type: 'authorization_code',
						client_id: env('MAL_CLIENT_ID'),
						client_secret: env('MAL_CLIENT_SECRET'),
						redirect_uri: redirectUri(origin, service),
						code: o.code,
						code_verifier: verifier ?? ''
					},
					false
				);
	const who =
		service === 'anilist' ? await anilistViewer(tokens.access) : await malViewer(tokens.access);
	getDb()
		.prepare(
			`INSERT INTO tracker_accounts (service, user_id, user_name, access_token, refresh_token, expires_at, signed_in_at)
			VALUES (?, ?, ?, ?, ?, ?, ?)
			ON CONFLICT (service) DO UPDATE SET user_id = excluded.user_id, user_name = excluded.user_name,
				access_token = excluded.access_token, refresh_token = excluded.refresh_token,
				expires_at = excluded.expires_at, signed_in_at = excluded.signed_in_at`
		)
		.run(service, who.id, who.name, tokens.access, tokens.refresh, tokens.expiresAt, now);
	// Read in the background: the owner is back on SETTINGS before a long list is.
	const listRead = readList(service).catch((e: unknown) =>
		console.error(`tsundoku: reading the ${service} list failed:`, e)
	);
	return { userName: who.name, listRead };
}

/** SIGN OUT: the token goes, and so does what waited to be sent; what the list said stays, as of then. */
export function signOut(service: Service): void {
	const db = getDb();
	db.transaction(() => {
		db.prepare(`DELETE FROM tracker_accounts WHERE service = ?`).run(service);
		db.prepare(`DELETE FROM tracker_sends WHERE service = ?`).run(service);
	})();
}

async function anilistViewer(token: string): Promise<{ id: string; name: string }> {
	const d = (await anilistAs(token, `{ Viewer { id name } }`)) as {
		Viewer: { id: number; name: string };
	};
	return { id: String(d.Viewer.id), name: d.Viewer.name };
}

async function mal(
	token: string,
	path: string,
	init: { method?: string; form?: Record<string, string> } = {}
): Promise<unknown> {
	// The same switch as AniList's: the e2e server reaches no catalogue at all.
	if (process.env.TSUNDOKU_ANILIST === 'off') throw new Unreachable('switched off');
	let res: Response;
	try {
		res = await fetch(`https://api.myanimelist.net/v2${path}`, {
			method: init.method ?? 'GET',
			headers: {
				authorization: `Bearer ${token}`,
				...(init.form ? { 'content-type': 'application/x-www-form-urlencoded' } : {})
			},
			body: init.form ? new URLSearchParams(init.form).toString() : undefined,
			signal: AbortSignal.timeout(20_000)
		});
	} catch (e) {
		throw new Unreachable(String(e));
	}
	if (res.status === 401) throw new SignedOut('MAL refused the sign-in');
	if (!res.ok) throw new Error(`MAL ${res.status}`);
	return res.json();
}

async function malViewer(token: string): Promise<{ id: string; name: string }> {
	const d = (await mal(token, '/users/@me')) as { id: number; name: string };
	return { id: String(d.id), name: d.name };
}

/** MAL's token, refreshed when it has less than a day left. */
async function malToken(a: Account, now = Date.now()): Promise<string> {
	if (!a.expires_at || a.expires_at - now > 24 * 3600_000 || !a.refresh_token)
		return a.access_token;
	const t = await tokenRequest(
		'https://myanimelist.net/v1/oauth2/token',
		{
			grant_type: 'refresh_token',
			client_id: env('MAL_CLIENT_ID'),
			client_secret: env('MAL_CLIENT_SECRET'),
			refresh_token: a.refresh_token
		},
		false
	);
	getDb()
		.prepare(
			`UPDATE tracker_accounts SET access_token = ?, refresh_token = COALESCE(?, refresh_token), expires_at = ? WHERE service = 'mal'`
		)
		.run(t.access, t.refresh, t.expiresAt);
	return t.access;
}

// ---- reading the lists ----------------------------------------------------------------------

type ListEntry = { mediaId: number; status: Status | null; progress: number; score: number | null };

/**
 * What a list says, kept per linked series. `readFrom` is when the read
 * began: a series sent to since then keeps what the send made of it, since
 * the list, as read, didn't have it yet.
 */
function saveState(
	service: Service,
	byMedia: Map<number, ListEntry>,
	readFrom: number,
	now: number
): number {
	const db = getDb();
	const col = service === 'anilist' ? 'anilist_id' : 'mal_id';
	const links = db
		.prepare(`SELECT series_id, ${col} AS media FROM series_links WHERE ${col} IS NOT NULL`)
		.all() as { series_id: number; media: number }[];
	const put = db.prepare(
		`INSERT INTO tracker_state (series_id, service, status, score, progress, read_at) VALUES (?, ?, ?, ?, ?, ?)
		ON CONFLICT (series_id, service) DO UPDATE SET status = excluded.status, score = excluded.score,
			progress = excluded.progress, read_at = excluded.read_at
		WHERE tracker_state.sent_at IS NULL OR tracker_state.sent_at < ?`
	);
	const drop = db.prepare(
		`DELETE FROM tracker_state WHERE series_id = ? AND service = ? AND (sent_at IS NULL OR sent_at < ?)`
	);
	let n = 0;
	db.transaction(() => {
		for (const l of links) {
			const e = byMedia.get(l.media);
			// Off the list now: nothing to show for it.
			if (!e) drop.run(l.series_id, service, readFrom);
			else {
				put.run(l.series_id, service, e.status, e.score, e.progress, now, readFrom);
				n += 1;
			}
		}
		db.prepare(`UPDATE tracker_accounts SET list_read_at = ? WHERE service = ?`).run(now, service);
	})();
	return n;
}

/**
 * Read the owner's list on one catalogue: what it says of each linked
 * series. AniList's list also links: an entry of it whose title is sure for
 * exactly one unlinked series in view links that series ('list'), and its
 * score fills an unrated series' rating (1w).
 */
export async function readList(
	service: Service,
	now = Date.now()
): Promise<{ entries: number; linked: number }> {
	const a = account(service);
	if (!a) return { entries: 0, linked: 0 };
	// The clock, not `now`: sends are stamped by it, and this is compared with them.
	const readFrom = Date.now();
	if (service === 'mal') {
		const token = await malToken(a, now);
		const byMedia = new Map<number, ListEntry>();
		let path: string | null = '/users/@me/mangalist?fields=list_status&limit=1000&nsfw=true';
		while (path) {
			const page = (await mal(token, path)) as {
				data: {
					node: { id: number };
					list_status: { status: string; score: number; num_chapters_read: number };
				}[];
				paging?: { next?: string };
			};
			for (const d of page.data)
				byMedia.set(d.node.id, {
					mediaId: d.node.id,
					status: statusFrom('mal', d.list_status.status),
					progress: d.list_status.num_chapters_read ?? 0,
					score: d.list_status.score || null
				});
			path = page.paging?.next
				? page.paging.next.replace('https://api.myanimelist.net/v2', '')
				: null;
		}
		saveState('mal', byMedia, readFrom, now);
		return { entries: byMedia.size, linked: 0 };
	}
	const data = (await anilistAs(
		a.access_token,
		`query ($userId: Int) { MediaListCollection(userId: $userId, type: MANGA) {
			lists { entries { mediaId status progress score(format: POINT_10) media { ...M } } }
		} } ${MEDIA}`,
		{ userId: Number(a.user_id) }
	)) as {
		MediaListCollection: {
			lists: {
				entries: {
					mediaId: number;
					status: string;
					progress: number;
					score: number;
					media: Media;
				}[];
			}[];
		};
	};
	const entries = data.MediaListCollection.lists.flatMap((l) => l.entries);
	// Links first, so their state is saved with the rest.
	const linked = linkFromEntries(entries, now);
	const byMedia = new Map<number, ListEntry>(
		entries.map((e) => [
			e.mediaId,
			{
				mediaId: e.mediaId,
				status: statusFrom('anilist', e.status),
				progress: e.progress ?? 0,
				score: e.score || null
			}
		])
	);
	saveState('anilist', byMedia, readFrom, now);
	return { entries: entries.length, linked };
}

function linkFromEntries(
	entries: { mediaId: number; score: number; media: Media }[],
	now: number
): number {
	const taken = new Set(
		(
			getDb().prepare(`SELECT anilist_id FROM series_links WHERE anilist_id IS NOT NULL`).all() as {
				anilist_id: number;
			}[]
		).map((r) => r.anilist_id)
	);
	const index = linkableByTitle();
	let n = 0;
	for (const e of entries) {
		if (taken.has(e.mediaId)) continue;
		const c = toCandidate(e.media);
		const titles = [c.title, ...c.alts].flatMap((t) => [t, cleanTitle(t)]);
		const found = new Map<number, Kind>();
		for (const t of titles)
			for (const s of index.get(normaliseTitle(t)) ?? []) found.set(s.id, s.kind);
		// Of the series' own kind only: a list entry across kinds is no sure link.
		const fits = [...found].filter(([, kind]) => !coverOnly(kind, c.format));
		if (fits.length !== 1) continue;
		const [seriesId] = fits[0];
		linkFromList(seriesId, c, e.score || null, now);
		taken.add(e.mediaId);
		for (const [k, list] of index)
			index.set(
				k,
				list.filter((s) => s.id !== seriesId)
			);
		n += 1;
	}
	return n;
}

/** Both lists, for the pass after an import: each on its own, so one failing doesn't stop the other. */
export async function readLists(now = Date.now()): Promise<void> {
	for (const s of SERVICES)
		if (account(s))
			await readList(s, now).catch((e: unknown) => {
				if (!(e instanceof Unreachable))
					console.error(`tsundoku: reading the ${s} list failed:`, e);
			});
}

// ---- sending --------------------------------------------------------------------------------

type Target = { service: Service; mediaId: number };

/**
 * Where a series' progress may go: each catalogue signed in whose entry the
 * link names. None for a hidden series, a cover-only link, or anything but a
 * comic (a novel's chapters aren't counted yet: doc/TRACKING.md, "Not yet").
 */
function targets(seriesId: number): Target[] {
	const r = getDb()
		.prepare(
			`SELECT s.kind, ${HIDDEN_SQL} AS hidden, l.anilist_id, l.mal_id, l.format
			FROM series s JOIN roots r ON r.id = s.root_id JOIN series_links l ON l.series_id = s.id
			WHERE s.id = ?`
		)
		.get(seriesId) as
		| {
				kind: Kind;
				hidden: number;
				anilist_id: number | null;
				mal_id: number | null;
				format: string | null;
		  }
		| undefined;
	if (!r || r.hidden || (r.kind !== 'manga' && r.kind !== 'manhwa')) return [];
	if (coverOnly(r.kind, r.format ?? '')) return [];
	const out: Target[] = [];
	if (r.anilist_id && account('anilist')) out.push({ service: 'anilist', mediaId: r.anilist_id });
	if (r.mal_id && account('mal')) out.push({ service: 'mal', mediaId: r.mal_id });
	return out;
}

function waitingRow(seriesId: number, service: Service) {
	return getDb()
		.prepare(
			`SELECT progress, status, score FROM tracker_sends WHERE series_id = ? AND service = ?`
		)
		.get(seriesId, service) as
		{ progress: number | null; status: Status | null; score: number | null } | undefined;
}

function stateRow(seriesId: number, service: Service) {
	return getDb()
		.prepare(
			`SELECT status, progress, score FROM tracker_state WHERE series_id = ? AND service = ?`
		)
		.get(seriesId, service) as
		{ status: Status | null; progress: number; score: number | null } | undefined;
}

function want(
	seriesId: number,
	service: Service,
	w: { progress?: number | null; status?: Status | null; score?: number | null },
	now: number
): void {
	const had = waitingRow(seriesId, service);
	getDb()
		.prepare(
			`INSERT INTO tracker_sends (series_id, service, progress, status, score, wanted_at) VALUES (?, ?, ?, ?, ?, ?)
			ON CONFLICT (series_id, service) DO UPDATE SET progress = excluded.progress, status = excluded.status,
				score = excluded.score, wanted_at = excluded.wanted_at, failed_at = NULL, error = NULL`
		)
		.run(
			seriesId,
			service,
			w.progress !== undefined ? w.progress : (had?.progress ?? null),
			w.status !== undefined ? w.status : (had?.status ?? null),
			w.score !== undefined ? w.score : (had?.score ?? null),
			now
		);
}

/**
 * A chapter of this series was finished here: the furthest chapter read, to
 * every catalogue that has less. Returns how many sends it queued.
 */
export function queueProgress(seriesId: number, now = Date.now()): number {
	const t = targets(seriesId);
	if (!t.length) return 0;
	const read = getDb()
		.prepare(
			`SELECT position FROM entries WHERE series_id = ? AND read_at IS NOT NULL AND shadowed = 0`
		)
		.all(seriesId) as { position: number }[];
	const reached = chapterReached(read);
	let n = 0;
	for (const { service } of t) {
		const remote = stateRow(seriesId, service);
		const r = progressToSend({
			reached,
			remote: remote ? { progress: remote.progress, status: remote.status } : null,
			waiting: waitingRow(seriesId, service)?.progress ?? null
		});
		if (!r) continue;
		want(
			seriesId,
			service,
			{ progress: r.progress, ...(r.status ? { status: r.status } : {}) },
			now
		);
		n += 1;
	}
	return n;
}

/** The TRACKING sheet's edit (Series Link 1m): status and score, to both catalogues. */
export function editTracking(
	seriesId: number,
	e: { status?: Status; score?: number | null },
	now = Date.now()
): number {
	const t = targets(seriesId);
	for (const { service } of t) want(seriesId, service, { ...e }, now);
	return t.length;
}

async function sendOne(
	service: Service,
	mediaId: number,
	w: { progress: number | null; status: Status | null; score: number | null },
	now: number
): Promise<void> {
	const a = account(service);
	if (!a) throw new SignedOut('not signed in');
	if (service === 'anilist') {
		await anilistAs(
			a.access_token,
			`mutation ($mediaId: Int, $progress: Int, $status: MediaListStatus, $scoreRaw: Int) {
				SaveMediaListEntry(mediaId: $mediaId, progress: $progress, status: $status, scoreRaw: $scoreRaw) { id }
			}`,
			{
				mediaId,
				...(w.progress !== null ? { progress: w.progress } : {}),
				...(w.status ? { status: statusTo('anilist', w.status) } : {}),
				// Out of 10 here; scoreRaw is AniList's 100, whatever format the owner shows.
				...(w.score !== null ? { scoreRaw: Math.round(w.score * 10) } : {})
			}
		);
		return;
	}
	const form: Record<string, string> = {};
	if (w.progress !== null) form.num_chapters_read = String(w.progress);
	if (w.status) form.status = statusTo('mal', w.status);
	if (w.score !== null) form.score = String(Math.round(w.score));
	await mal(await malToken(a, now), `/manga/${mediaId}/my_list_status`, { method: 'PATCH', form });
}

/**
 * Send what waits: each catalogue its own, one at a time. A send that fails
 * stays, with why, for TRY AGAIN or the next chapter read.
 */
export async function sendPending(
	opts: { seriesId?: number; now?: number } = {}
): Promise<{ sent: number; failed: number }> {
	const db = getDb();
	const now = opts.now ?? Date.now();
	const rows = db
		.prepare(
			`SELECT w.series_id, w.service, w.progress, w.status, w.score, l.anilist_id, l.mal_id
			FROM tracker_sends w JOIN series_links l ON l.series_id = w.series_id
			${opts.seriesId !== undefined ? 'WHERE w.series_id = ?' : ''}`
		)
		.all(...(opts.seriesId !== undefined ? [opts.seriesId] : [])) as {
		series_id: number;
		service: Service;
		progress: number | null;
		status: Status | null;
		score: number | null;
		anilist_id: number | null;
		mal_id: number | null;
	}[];
	let sent = 0;
	let failed = 0;
	for (const r of rows) {
		const mediaId = r.service === 'anilist' ? r.anilist_id : r.mal_id;
		// Still allowed? A series hidden since, or a link changed, sends nothing.
		if (!mediaId || !targets(r.series_id).some((t) => t.service === r.service)) {
			db.prepare(`DELETE FROM tracker_sends WHERE series_id = ? AND service = ?`).run(
				r.series_id,
				r.service
			);
			continue;
		}
		try {
			await sendOne(r.service, mediaId, r, now);
			const had = stateRow(r.series_id, r.service);
			db.transaction(() => {
				db.prepare(
					`INSERT INTO tracker_state (series_id, service, status, score, progress, sent_at) VALUES (?, ?, ?, ?, ?, ?)
					ON CONFLICT (series_id, service) DO UPDATE SET status = excluded.status, score = excluded.score,
						progress = excluded.progress, sent_at = excluded.sent_at`
				).run(
					r.series_id,
					r.service,
					r.status ?? had?.status ?? 'reading',
					r.score !== null ? r.score || null : (had?.score ?? null),
					Math.max(r.progress ?? 0, had?.progress ?? 0),
					now
				);
				db.prepare(`DELETE FROM tracker_sends WHERE series_id = ? AND service = ?`).run(
					r.series_id,
					r.service
				);
			})();
			sent += 1;
		} catch (e) {
			const why =
				e instanceof SignedOut
					? `${SERVICE_NAME[r.service]} SIGN-IN EXPIRED`
					: e instanceof Unreachable
						? `${SERVICE_NAME[r.service]} DID NOT ANSWER`
						: `${SERVICE_NAME[r.service]} REFUSED IT`;
			db.prepare(
				`UPDATE tracker_sends SET failed_at = ?, error = ? WHERE series_id = ? AND service = ?`
			).run(now, why, r.series_id, r.service);
			failed += 1;
		}
	}
	return { sent, failed };
}

/**
 * A rating set here is the score both catalogues get (c67: one number, out
 * of 10 on every side). 0, unrated, clears the score. Same rules as any send:
 * never a hidden series, never through a cover-only link.
 */
export async function afterRating(seriesIds: number[], rating: number): Promise<void> {
	for (const id of seriesIds)
		if (editTracking(id, { score: rating }) > 0) await sendPending({ seriesId: id });
}

/**
 * After a chapter is finished or marked read: queue, then send, off the
 * request. Ranobe hears of it too, for the novels and comics it tracks
 * (doc/RANOBE.md); a comic's progress still goes to AniList as well.
 */
export function afterReading(seriesId: number): void {
	ranobe.afterReading(seriesId);
	if (queueProgress(seriesId) > 0)
		void sendPending({ seriesId }).catch((e: unknown) =>
			console.error('tsundoku: sending progress failed:', e)
		);
}

// ---- what the screens show ------------------------------------------------------------------

export type Tracking = {
	facts: TrackFacts[];
	/** Hidden: nothing is sent (Series Link 1s). */
	hidden: boolean;
	/** Cover-only link: never tracked. */
	coverOnly: boolean;
	/** The sheet's starting point: the main list's word, else MAL's. */
	status: Status | null;
	score: number | null;
	links: { service: Service; mediaId: number }[];
};

/** The TRACKING row (Series Link 1k–1s). Null when the series isn't linked. */
export function trackingOf(seriesId: number): Tracking | null {
	const db = getDb();
	const r = db
		.prepare(
			`SELECT s.kind, ${HIDDEN_SQL} AS hidden, l.anilist_id, l.mal_id, l.format
			FROM series s JOIN roots r ON r.id = s.root_id JOIN series_links l ON l.series_id = s.id WHERE s.id = ?`
		)
		.get(seriesId) as
		| {
				kind: Kind;
				hidden: number;
				anilist_id: number | null;
				mal_id: number | null;
				format: string | null;
		  }
		| undefined;
	if (!r) return null;
	const facts = SERVICES.map((service): TrackFacts => {
		const st = db
			.prepare(
				`SELECT status, progress, score, read_at, sent_at FROM tracker_state WHERE series_id = ? AND service = ?`
			)
			.get(seriesId, service) as
			| {
					status: Status | null;
					progress: number;
					score: number | null;
					read_at: number | null;
					sent_at: number | null;
			  }
			| undefined;
		const w = db
			.prepare(
				`SELECT progress, failed_at, error FROM tracker_sends WHERE series_id = ? AND service = ?`
			)
			.get(seriesId, service) as
			{ progress: number | null; failed_at: number | null; error: string | null } | undefined;
		return {
			service,
			signedIn: !!account(service),
			linked: service === 'anilist' ? !!r.anilist_id : !!r.mal_id,
			// Known from reading the list, or from sending to it.
			state: st ? { status: st.status, progress: st.progress, score: st.score } : null,
			waiting: w ? { progress: w.progress, failedAt: w.failed_at, error: w.error } : null,
			sentAt: st?.sent_at ?? null
		};
	});
	const main =
		facts.find((f) => f.service === 'anilist')?.state ??
		facts.find((f) => f.service === 'mal')?.state ??
		null;
	return {
		facts,
		hidden: !!r.hidden,
		coverOnly: coverOnly(r.kind, r.format ?? ''),
		status: main?.status ?? null,
		score: main?.score ?? null,
		links: [
			...(r.anilist_id ? [{ service: 'anilist' as const, mediaId: r.anilist_id }] : []),
			...(r.mal_id ? [{ service: 'mal' as const, mediaId: r.mal_id }] : [])
		]
	};
}

export type AccountView = {
	service: Service;
	configured: boolean;
	userName: string | null;
	listReadAt: number | null;
	/** A year's AniList token: when it runs out. */
	expiresAt: number | null;
	failed: { count: number; at: number | null; error: string | null };
	waiting: number;
	/** MAL links from Mihon: shown, but nothing sent until signed in. */
	linked: number;
};

/** SETTINGS' CATALOGUES rows (Catalogue Links 1u, 1v). */
export function accounts(): AccountView[] {
	const db = getDb();
	return SERVICES.map((service) => {
		const a = account(service);
		const f = db
			.prepare(
				`SELECT COUNT(*) AS n, MAX(failed_at) AS at, (SELECT error FROM tracker_sends WHERE service = ? AND failed_at IS NOT NULL ORDER BY failed_at DESC LIMIT 1) AS error
				FROM tracker_sends WHERE service = ? AND failed_at IS NOT NULL`
			)
			.get(service, service) as { n: number; at: number | null; error: string | null };
		const waiting = (
			db
				.prepare(`SELECT COUNT(*) AS n FROM tracker_sends WHERE service = ? AND failed_at IS NULL`)
				.get(service) as {
				n: number;
			}
		).n;
		const linked = (
			db
				.prepare(
					`SELECT COUNT(*) AS n FROM series_links WHERE ${service === 'anilist' ? 'anilist_id' : 'mal_id'} IS NOT NULL`
				)
				.get() as { n: number }
		).n;
		return {
			service,
			configured: configured(service),
			userName: a?.user_name ?? null,
			listReadAt: a?.list_read_at ?? null,
			expiresAt: a?.expires_at ?? null,
			failed: { count: f.n, at: f.at, error: f.error },
			waiting,
			linked
		};
	});
}

/** TRY AGAIN, on SETTINGS: every send that failed, for one catalogue. */
export async function retry(service: Service): Promise<{ sent: number; failed: number }> {
	getDb()
		.prepare(`UPDATE tracker_sends SET failed_at = NULL, error = NULL WHERE service = ?`)
		.run(service);
	const ids = (
		getDb()
			.prepare(`SELECT DISTINCT series_id FROM tracker_sends WHERE service = ?`)
			.all(service) as {
			series_id: number;
		}[]
	).map((r) => r.series_id);
	let sent = 0;
	let failed = 0;
	for (const id of ids) {
		const r = await sendPending({ seriesId: id });
		sent += r.sent;
		failed += r.failed;
	}
	return { sent, failed };
}

import { randomBytes } from 'node:crypto';
import { getDb } from './db.ts';
import { HIDDEN_SQL } from './visibility.ts';
import {
	MEDIA,
	SignedOut,
	Unreachable,
	anilistAs,
	family,
	fillRating,
	linkFromList,
	linkableByTitle,
	toCandidate,
	type Media
} from './catalogue.ts';
import * as ranobe from './ranobe.ts';
import {
	cleanTitle,
	coverOnly,
	normaliseTitle,
	sameKind,
	candidateKind,
	wrongKind,
	type Candidate,
	type Kind
} from '../library/catalogue.ts';
import {
	linkSeason,
	seasonForTitles,
	seasonKind,
	seasonUntracked,
	seriesSeasons,
	type SeasonLink
} from './season-links.ts';
import { watchedReached } from '../library/anime.ts';
import {
	SERVICES,
	SERVICE_NAME,
	chapterReached,
	progressToSend,
	statusFrom,
	statusTo,
	type SeasonFact,
	type SeasonTrackFacts,
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
 * Where a list row's state is filed. AniList's media ids are one sequence for
 * both lists; MAL's manga and anime ids are not, so a MAL id is filed under a
 * family. The family is the *linked entry's* when its format is known -- a
 * manga series linked to a MAL anime entry is on the anime list, and reading
 * the manga list's row for that id would show another work's status and
 * progress (c298's wrong-kind link). With no format yet, the series' own kind
 * is the best there is.
 */
const stateKey = (service: Service, media: number, kind: Kind, format: string | null): string =>
	service === 'mal'
		? `${family(format ? (candidateKind({ format, country: '' }) ?? kind) : kind)}:${media}`
		: String(media);

/**
 * What a list says, kept per linked series. `readFrom` is when the read
 * began: a series sent to since then keeps what the send made of it, since
 * the list, as read, didn't have it yet.
 */
function saveState(
	service: Service,
	byMedia: Map<string, ListEntry>,
	readFrom: number,
	now: number
): number {
	const db = getDb();
	const col = service === 'anilist' ? 'anilist_id' : 'mal_id';
	const links = db
		.prepare(
			`SELECT l.series_id, l.${col} AS media, l.format, s.kind
			FROM series_links l JOIN series s ON s.id = l.series_id
			WHERE l.${col} IS NOT NULL`
		)
		.all() as { series_id: number; media: number; format: string | null; kind: Kind }[];
	// An anime's links are per season (c240): the row that says what the list
	// has of a season is `season_tracker_state`, keyed the season's own way.
	const seasons = db
		.prepare(
			`SELECT l.series_id, l.season, l.part, l.${col} AS media, l.format
			FROM series_season_links l WHERE l.${col} IS NOT NULL`
		)
		.all() as {
		series_id: number;
		season: number;
		part: number;
		media: number;
		format: string | null;
	}[];
	const put = db.prepare(
		`INSERT INTO tracker_state (series_id, service, status, score, progress, read_at) VALUES (?, ?, ?, ?, ?, ?)
		ON CONFLICT (series_id, service) DO UPDATE SET status = excluded.status, score = excluded.score,
			progress = excluded.progress, read_at = excluded.read_at
		WHERE tracker_state.sent_at IS NULL OR tracker_state.sent_at < ?`
	);
	const drop = db.prepare(
		`DELETE FROM tracker_state WHERE series_id = ? AND service = ? AND (sent_at IS NULL OR sent_at < ?)`
	);
	const putSeason = db.prepare(
		`INSERT INTO season_tracker_state (series_id, season, part, service, status, score, progress, read_at)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?)
		ON CONFLICT (series_id, season, part, service) DO UPDATE SET status = excluded.status,
			score = excluded.score, progress = excluded.progress, read_at = excluded.read_at
		WHERE season_tracker_state.sent_at IS NULL OR season_tracker_state.sent_at < ?`
	);
	const dropSeason = db.prepare(
		`DELETE FROM season_tracker_state WHERE series_id = ? AND season = ? AND part = ? AND service = ?
		AND (sent_at IS NULL OR sent_at < ?)`
	);
	let n = 0;
	db.transaction(() => {
		for (const l of links) {
			const e = byMedia.get(stateKey(service, l.media, l.kind, l.format));
			// Off the list now: nothing to show for it.
			if (!e) drop.run(l.series_id, service, readFrom);
			else {
				put.run(l.series_id, service, e.status, e.score, e.progress, now, readFrom);
				n += 1;
			}
		}
		for (const l of seasons) {
			const e = byMedia.get(stateKey(service, l.media, 'anime', l.format));
			if (!e) dropSeason.run(l.series_id, l.season, l.part, service, readFrom);
			else {
				putSeason.run(
					l.series_id,
					l.season,
					l.part,
					service,
					e.status,
					e.score,
					e.progress,
					now,
					readFrom
				);
				n += 1;
			}
		}
		db.prepare(`UPDATE tracker_accounts SET list_read_at = ? WHERE service = ?`).run(now, service);
	})();
	return n;
}

/**
 * Read the owner's list on one catalogue: what it says of each linked
 * series. Both of AniList's lists are read (manga and anime), and both of
 * MAL's, since a series is linked to whichever kind it is. AniList's lists
 * also link: an entry whose title is sure for exactly one unlinked series of
 * its own kind in view links that series ('list'), and its score fills an
 * unrated series' rating (1w).
 */
export async function readList(
	service: Service,
	now = Date.now()
): Promise<{ entries: number; linked: number }> {
	const a = account(service);
	if (!a) return { entries: 0, linked: 0 };
	// The clock, not `now`: sends are stamped by it, and this is compared with them.
	const readFrom = Date.now();
	const byMedia = new Map<string, ListEntry>();
	if (service === 'mal') {
		const token = await malToken(a, now);
		let read = 0;
		for (const list of ['mangalist', 'animelist'] as const) {
			const fam = family(list === 'animelist' ? 'anime' : 'manga');
			let path: string | null = `/users/@me/${list}?fields=list_status&limit=1000&nsfw=true`;
			while (path) {
				const page = (await mal(token, path)) as {
					data: {
						node: { id: number };
						list_status: {
							status: string;
							score: number;
							num_chapters_read?: number;
							num_episodes_watched?: number;
						};
					}[];
					paging?: { next?: string };
				};
				for (const d of page.data) {
					byMedia.set(`${fam}:${d.node.id}`, {
						mediaId: d.node.id,
						status: statusFrom('mal', d.list_status.status),
						progress: d.list_status.num_chapters_read ?? d.list_status.num_episodes_watched ?? 0,
						score: d.list_status.score || null
					});
					read += 1;
				}
				path = page.paging?.next
					? page.paging.next.replace('https://api.myanimelist.net/v2', '')
					: null;
			}
		}
		saveState('mal', byMedia, readFrom, now);
		// The rows read, not the map's size: one id in each family is two rows.
		return { entries: read, linked: 0 };
	}
	const entries: {
		mediaId: number;
		status: string;
		progress: number;
		score: number;
		media: Media;
	}[] = [];
	for (const type of ['MANGA', 'ANIME'] as const) {
		const data = (await anilistAs(
			a.access_token,
			`query ($userId: Int) { MediaListCollection(userId: $userId, type: ${type}) {
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
		entries.push(...data.MediaListCollection.lists.flatMap((l) => l.entries));
	}
	// Links first, so their state is saved with the rest.
	const linked = linkFromEntries(entries, now);
	for (const e of entries)
		byMedia.set(String(e.mediaId), {
			mediaId: e.mediaId,
			status: statusFrom('anilist', e.status),
			progress: e.progress ?? 0,
			score: e.score || null
		});
	saveState('anilist', byMedia, readFrom, now);
	return { entries: entries.length, linked };
}

function linkFromEntries(
	entries: { mediaId: number; score: number; media: Media }[],
	now: number
): number {
	const db = getDb();
	const taken = new Set(
		(
			db
				.prepare(
					`SELECT anilist_id FROM series_links WHERE anilist_id IS NOT NULL
					UNION SELECT anilist_id FROM series_season_links WHERE anilist_id IS NOT NULL`
				)
				.all() as { anilist_id: number }[]
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
		// Of the series' own kind only: a list entry across kinds is no sure link
		// (a manga's title on an anime is another work; c298).
		const entryKind = candidateKind(c);
		const fits = [...found].filter(([, kind]) => sameKind(kind, entryKind));
		if (fits.length !== 1) continue;
		const [seriesId, kind] = fits[0];
		// An anime's entry is one season of the show (c240): the season whose own
		// title it names, or the one being watched.
		if (kind === 'anime') linkSeasonFromList(seriesId, c, e.score || null, now);
		else linkFromList(seriesId, c, e.score || null, now);
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

/**
 * A link from the owner's AniList list to one season of an anime (c240): the
 * season the entry's own title names, else the one being watched. The series'
 * rating is filled once, as any link from the list does (1w), and the score
 * is kept on the season's own row.
 */
export function linkSeasonFromList(
	seriesId: number,
	c: Candidate,
	score: number | null,
	now = Date.now()
): void {
	const db = getDb();
	const season = seasonForTitles(seriesId, [c.title, ...c.alts, cleanTitle(c.title)]);
	const view = seriesSeasons(seriesId);
	const part = view?.seasons.find((s) => s.season === season)?.parts[0]?.part ?? 1;
	db.transaction(() => {
		linkSeason(seriesId, season, part, c, 'list', now);
		const filled = fillRating(db, seriesId, score);
		db.prepare(
			`UPDATE series_season_links SET score = ?, filled_rating = ? WHERE series_id = ? AND season = ? AND part = ?`
		).run(score || null, filled, seriesId, season, part);
	})();
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

/**
 * Where a series' progress may go: each catalogue signed in whose entry the
 * link names. A season of an anime is its own target (c240), with the episode
 * range its part covers; a comic is one target for the whole series.
 */
type Target = {
	seriesId: number;
	service: Service;
	mediaId: number;
	/** The season this target is (0 for a comic, or a flat list). */
	season: number;
	part: number;
	/** The entry's own kind: it decides the MAL endpoint and the field (c240). */
	kind: Kind;
	/** The first and last episode of the season's part, in the season's numbering. */
	from: number;
	to: number;
	/** The season's last linked part: past its count, an episode waits (c240). */
	last: boolean;
};

/** The episodes of a season, read once for its targets. */
function animeEntries(seriesId: number) {
	return getDb()
		.prepare(
			`SELECT COALESCE(season, 0) AS season, COALESCE(episode_number, position) AS number,
				COALESCE(episode_note, '') AS note, read_at AS readAt
			FROM entries WHERE series_id = ? AND shadowed = 0 ORDER BY position, id`
		)
		.all(seriesId) as { season: number; number: number; note: string; readAt: number | null }[];
}

/**
 * Where a series' progress may go: each catalogue signed in whose entry the
 * link names. None for a hidden series, a cover-only link, or a season whose
 * own link names nothing. Both kinds whose unit is an episode or a chapter
 * send (c240 widened this from comics alone): an anime sends the episode
 * within its season, a comic its chapter.
 */
function targets(seriesId: number): Target[] {
	const r = getDb()
		.prepare(
			`SELECT s.kind, ${HIDDEN_SQL} AS hidden FROM series s JOIN roots r ON r.id = s.root_id WHERE s.id = ?`
		)
		.get(seriesId) as { kind: Kind; hidden: number } | undefined;
	if (!r || r.hidden) return [];
	if (r.kind === 'anime') {
		const view = seriesSeasons(seriesId);
		if (!view) return [];
		const out: Target[] = [];
		for (const sv of view.seasons) {
			const lastPart = sv.parts[sv.parts.length - 1]?.part ?? 1;
			for (const p of sv.parts) {
				const l = p.link;
				if (!l) continue;
				// The same refusals as a comic's (c298, c240): a wrong-kind entry and
				// a cover-only link send nothing, and the season is left out.
				if (seasonUntracked(r.kind, l)) continue;
				const kind = seasonKind(l) ?? r.kind;
				const base = {
					seriesId,
					season: sv.season,
					part: p.part,
					kind,
					from: p.from,
					to: p.to,
					last: p.part === lastPart
				};
				if (l.anilistId && account('anilist'))
					out.push({ ...base, service: 'anilist', mediaId: l.anilistId });
				if (l.malId && account('mal')) out.push({ ...base, service: 'mal', mediaId: l.malId });
			}
		}
		return out;
	}
	// A comic, and only a comic: a novel's chapters still go to Ranobe alone
	// (doc/TRACKING.md, "Not yet").
	if (r.kind !== 'manga' && r.kind !== 'manhwa') return [];
	const l = getDb()
		.prepare(`SELECT anilist_id, mal_id, format FROM series_links WHERE series_id = ?`)
		.get(seriesId) as
		{ anilist_id: number | null; mal_id: number | null; format: string | null } | undefined;
	if (!l) return [];
	if (coverOnly(r.kind, l.format ?? '')) return [];
	// A link whose entry is the other kind sends nothing (c298): an anime entry
	// never takes a manga's chapters, nor the other way round. An entry whose
	// format isn't known yet is not a contradiction.
	const entryKind = l.format ? candidateKind({ format: l.format, country: '' }) : null;
	if (entryKind !== null && !sameKind(r.kind, entryKind)) return [];
	const out: Target[] = [];
	const base = { seriesId, season: 0, part: 1, kind: r.kind, from: 1, to: 0, last: true };
	if (l.anilist_id && account('anilist'))
		out.push({ ...base, service: 'anilist', mediaId: l.anilist_id });
	if (l.mal_id && account('mal')) out.push({ ...base, service: 'mal', mediaId: l.mal_id });
	return out;
}

function waitingRow(t: Target) {
	const db = getDb();
	if (t.kind === 'anime')
		return db
			.prepare(
				`SELECT progress, status, score FROM season_tracker_sends
				WHERE series_id = ? AND season = ? AND part = ? AND service = ?`
			)
			.get(t.seriesId, t.season, t.part, t.service) as
			{ progress: number | null; status: Status | null; score: number | null } | undefined;
	return db
		.prepare(
			`SELECT progress, status, score FROM tracker_sends WHERE series_id = ? AND service = ?`
		)
		.get(t.seriesId, t.service) as
		{ progress: number | null; status: Status | null; score: number | null } | undefined;
}

function stateRow(t: Target) {
	const db = getDb();
	if (t.kind === 'anime')
		return db
			.prepare(
				`SELECT status, progress, score FROM season_tracker_state
				WHERE series_id = ? AND season = ? AND part = ? AND service = ?`
			)
			.get(t.seriesId, t.season, t.part, t.service) as
			{ status: Status | null; progress: number; score: number | null } | undefined;
	return db
		.prepare(
			`SELECT status, progress, score FROM tracker_state WHERE series_id = ? AND service = ?`
		)
		.get(t.seriesId, t.service) as
		{ status: Status | null; progress: number; score: number | null } | undefined;
}

function want(
	t: Target,
	w: { progress?: number | null; status?: Status | null; score?: number | null },
	now: number
): void {
	const db = getDb();
	const had = waitingRow(t);
	const progress = w.progress !== undefined ? w.progress : (had?.progress ?? null);
	const status = w.status !== undefined ? w.status : (had?.status ?? null);
	const score = w.score !== undefined ? w.score : (had?.score ?? null);
	if (t.kind === 'anime')
		db.prepare(
			`INSERT INTO season_tracker_sends (series_id, season, part, service, progress, status, score, wanted_at)
			VALUES (?, ?, ?, ?, ?, ?, ?, ?)
			ON CONFLICT (series_id, season, part, service) DO UPDATE SET progress = excluded.progress,
				status = excluded.status, score = excluded.score, wanted_at = excluded.wanted_at,
				failed_at = NULL, error = NULL`
		).run(t.seriesId, t.season, t.part, t.service, progress, status, score, now);
	else
		db.prepare(
			`INSERT INTO tracker_sends (series_id, service, progress, status, score, wanted_at) VALUES (?, ?, ?, ?, ?, ?)
			ON CONFLICT (series_id, service) DO UPDATE SET progress = excluded.progress, status = excluded.status,
				score = excluded.score, wanted_at = excluded.wanted_at, failed_at = NULL, error = NULL`
		).run(t.seriesId, t.service, progress, status, score, now);
}

/**
 * What a target has to send: the highest chapter read here (a comic), or the
 * highest episode watched in the season -- within its part (c240). Both are
 * counted in the entry's own numbering, so part 2's EP. 3 is what a catalogue
 * hears about, not EP. 15.
 */
function reachedFor(t: Target, o: { chapters: number }): number {
	if (t.kind !== 'anime') return o.chapters;
	const entries = animeEntries(t.seriesId);
	const seasonTop = watchedReached(
		entries.map((e) => ({
			id: 0,
			number: e.number,
			readAt: e.readAt,
			lastPosition: null,
			lastOpenedAt: null,
			episode: {
				durationS: null,
				season: e.season,
				number: e.number,
				note: (e.note as '' | 'filler' | 'recap') ?? '',
				thumb: '',
				endingAt: null
			}
		})),
		{ season: t.season }
	);
	// A run watched into a later part fills the ones before it: EP. 15 of the
	// design's SAO S4 is part 2's EP. 3, and part 1 completed itself at 12.
	// The last part has nowhere for the extra episodes to go, so they wait.
	if (!t.last && seasonTop >= t.from) return Math.min(seasonTop, t.to) - t.from + 1;
	if (t.last && seasonTop > t.to) return 0;
	// `counted` lives in library/anime: a recap or a half number is never sent.
	const top = watchedReached(
		entries.map((e) => ({
			id: 0,
			number: e.number,
			readAt: e.readAt,
			lastPosition: null,
			lastOpenedAt: null,
			episode: {
				durationS: null,
				season: e.season,
				number: e.number,
				note: (e.note as '' | 'filler' | 'recap') ?? '',
				thumb: '',
				endingAt: null
			}
		})),
		{ season: t.season, from: t.from, to: t.to }
	);
	// The part's own numbering: part 2 starts at 1, not at part 1's last + 1.
	return top > 0 ? top - t.from + 1 : 0;
}

/**
 * A chapter (or an episode) of this series was finished here: the furthest
 * one read, to every catalogue that has less. Returns how many sends it
 * queued. An anime queues one per season, and a part's send never overwrites
 * its sibling's: they are separate rows (c240).
 */
export function queueProgress(seriesId: number, now = Date.now()): number {
	const t = targets(seriesId);
	if (!t.length) return 0;
	const read = getDb()
		.prepare(
			`SELECT position FROM entries WHERE series_id = ? AND read_at IS NOT NULL AND shadowed = 0`
		)
		.all(seriesId) as { position: number }[];
	const chapters = chapterReached(read);
	let n = 0;
	for (const target of t) {
		const reached = reachedFor(target, { chapters });
		if (reached <= 0) continue;
		const remote = stateRow(target);
		const r = progressToSend({
			reached,
			remote: remote ? { progress: remote.progress, status: remote.status } : null,
			waiting: waitingRow(target)?.progress ?? null
		});
		if (!r) continue;
		want(target, { progress: r.progress, ...(r.status ? { status: r.status } : {}) }, now);
		n += 1;
	}
	return n;
}

/**
 * The TRACKING sheet's edit (Series Link 1m): status and score, to both
 * catalogues. An anime sets the season it was asked about (`season`, `part`);
 * the others keep their own (c240).
 */
export function editTracking(
	seriesId: number,
	e: { status?: Status; score?: number | null },
	now = Date.now(),
	o: { season?: number; part?: number } = {}
): number {
	const all = targets(seriesId);
	const t =
		o.season === undefined
			? all
			: all.filter((x) => x.season === o.season && x.part === (o.part ?? 1));
	for (const target of t) want(target, { ...e }, now);
	return t.length;
}

async function sendOne(
	t: Target,
	w: { progress: number | null; status: Status | null; score: number | null },
	now: number
): Promise<void> {
	const a = account(t.service);
	if (!a) throw new SignedOut('not signed in');
	if (t.service === 'anilist') {
		await anilistAs(
			a.access_token,
			`mutation ($mediaId: Int, $progress: Int, $status: MediaListStatus, $scoreRaw: Int) {
				SaveMediaListEntry(mediaId: $mediaId, progress: $progress, status: $status, scoreRaw: $scoreRaw) { id }
			}`,
			{
				mediaId: t.mediaId,
				...(w.progress !== null ? { progress: w.progress } : {}),
				...(w.status ? { status: statusTo('anilist', w.status) } : {}),
				// Out of 10 here; scoreRaw is AniList's 100, whatever format the owner shows.
				...(w.score !== null ? { scoreRaw: Math.round(w.score * 10) } : {})
			}
		);
		return;
	}
	// MAL keeps two lists: an anime entry takes `num_watched_episodes` on
	// `/anime/`, a manga's entry `num_chapters_read` on `/manga/` (c240).
	const anime = t.kind === 'anime';
	const form: Record<string, string> = {};
	if (w.progress !== null)
		form[anime ? 'num_watched_episodes' : 'num_chapters_read'] = String(w.progress);
	if (w.status) form.status = statusTo('mal', w.status);
	if (w.score !== null) form.score = String(Math.round(w.score));
	await mal(await malToken(a, now), `/${anime ? 'anime' : 'manga'}/${t.mediaId}/my_list_status`, {
		method: 'PATCH',
		form
	});
}

/** The series with something waiting: both tables, once each. */
function pendingSeries(service?: Service): number[] {
	const db = getDb();
	const rows = db
		.prepare(`SELECT DISTINCT series_id FROM tracker_sends ${service ? 'WHERE service = ?' : ''}`)
		.all(...(service ? [service] : [])) as { series_id: number }[];
	const seasons = db
		.prepare(
			`SELECT DISTINCT series_id FROM season_tracker_sends ${service ? 'WHERE service = ?' : ''}`
		)
		.all(...(service ? [service] : [])) as { series_id: number }[];
	return [...new Set([...rows, ...seasons].map((r) => r.series_id))];
}

/** Drop what waits for a target that no longer exists: a season unlinked, a series hidden. */
function pruneSends(seriesId: number, live: Target[]): void {
	const db = getDb();
	for (const r of db
		.prepare(`SELECT service FROM tracker_sends WHERE series_id = ?`)
		.all(seriesId) as { service: Service }[])
		if (!live.some((t) => t.kind !== 'anime' && t.service === r.service))
			db.prepare(`DELETE FROM tracker_sends WHERE series_id = ? AND service = ?`).run(
				seriesId,
				r.service
			);
	for (const r of db
		.prepare(`SELECT service, season, part FROM season_tracker_sends WHERE series_id = ?`)
		.all(seriesId) as { service: Service; season: number; part: number }[])
		if (
			!live.some(
				(t) =>
					t.kind === 'anime' &&
					t.service === r.service &&
					t.season === r.season &&
					t.part === r.part
			)
		)
			db.prepare(
				`DELETE FROM season_tracker_sends WHERE series_id = ? AND season = ? AND part = ? AND service = ?`
			).run(seriesId, r.season, r.part, r.service);
}

/**
 * Send what waits: each catalogue its own, one at a time. A send that fails
 * stays, with why, for TRY AGAIN or the next chapter read. A season's send is
 * its own row, so one season's failure never holds another's up (c240).
 */
export async function sendPending(
	opts: { seriesId?: number; now?: number } = {}
): Promise<{ sent: number; failed: number }> {
	const db = getDb();
	const now = opts.now ?? Date.now();
	const ids = opts.seriesId !== undefined ? [opts.seriesId] : pendingSeries();
	let sent = 0;
	let failed = 0;
	for (const seriesId of ids) {
		const live = targets(seriesId);
		pruneSends(seriesId, live);
		for (const target of live) {
			const w = waitingRow(target);
			if (!w) continue;
			try {
				await sendOne(target, w, now);
				const had = stateRow(target);
				const row = {
					status: w.status ?? had?.status ?? 'reading',
					score: w.score !== null ? w.score || null : (had?.score ?? null),
					progress: Math.max(w.progress ?? 0, had?.progress ?? 0)
				};
				db.transaction(() => {
					if (target.kind === 'anime') {
						db.prepare(
							`INSERT INTO season_tracker_state (series_id, season, part, service, status, score, progress, sent_at)
							VALUES (?, ?, ?, ?, ?, ?, ?, ?)
							ON CONFLICT (series_id, season, part, service) DO UPDATE SET status = excluded.status,
								score = excluded.score, progress = excluded.progress, sent_at = excluded.sent_at`
						).run(
							seriesId,
							target.season,
							target.part,
							target.service,
							row.status,
							row.score,
							row.progress,
							now
						);
						db.prepare(
							`DELETE FROM season_tracker_sends WHERE series_id = ? AND season = ? AND part = ? AND service = ?`
						).run(seriesId, target.season, target.part, target.service);
					} else {
						db.prepare(
							`INSERT INTO tracker_state (series_id, service, status, score, progress, sent_at) VALUES (?, ?, ?, ?, ?, ?)
							ON CONFLICT (series_id, service) DO UPDATE SET status = excluded.status, score = excluded.score,
								progress = excluded.progress, sent_at = excluded.sent_at`
						).run(seriesId, target.service, row.status, row.score, row.progress, now);
						db.prepare(`DELETE FROM tracker_sends WHERE series_id = ? AND service = ?`).run(
							seriesId,
							target.service
						);
					}
				})();
				sent += 1;
			} catch (e) {
				const why =
					e instanceof SignedOut
						? `${SERVICE_NAME[target.service]} SIGN-IN EXPIRED`
						: e instanceof Unreachable
							? `${SERVICE_NAME[target.service]} DID NOT ANSWER`
							: `${SERVICE_NAME[target.service]} REFUSED IT`;
				if (target.kind === 'anime')
					db.prepare(
						`UPDATE season_tracker_sends SET failed_at = ?, error = ?
						WHERE series_id = ? AND season = ? AND part = ? AND service = ?`
					).run(now, why, seriesId, target.season, target.part, target.service);
				else
					db.prepare(
						`UPDATE tracker_sends SET failed_at = ?, error = ? WHERE series_id = ? AND service = ?`
					).run(now, why, seriesId, target.service);
				failed += 1;
			}
		}
	}
	return { sent, failed };
}

/**
 * A rating set here is the score both catalogues get (c67: one number, out
 * of 10 on every side). 0, unrated, clears the score. Same rules as any send:
 * never a hidden series, never through a cover-only link.
 *
 * An anime sends it to the season being watched only (c240): a series has one
 * rating and four entries, and sending it to all of them would overwrite the
 * scores the owner gave earlier seasons.
 */
export async function afterRating(seriesIds: number[], rating: number): Promise<void> {
	for (const id of seriesIds) {
		const where = ratingPart(id);
		if (editTracking(id, { score: rating }, Date.now(), where) > 0)
			await sendPending({ seriesId: id });
	}
}

/** The season, and the part of it, a rating and the sheet's edit go to: the one being watched. */
export function ratingPart(seriesId: number): { season?: number; part?: number } {
	const view = seriesSeasons(seriesId);
	if (!view) return {};
	const sv = view.seasons.find((s) => s.season === view.open) ?? view.seasons[0];
	if (!sv) return {};
	const watched = getDb()
		.prepare(
			`SELECT MAX(COALESCE(episode_number, position)) AS n FROM entries
			WHERE series_id = ? AND shadowed = 0 AND read_at IS NOT NULL`
		)
		.get(seriesId) as { n: number | null };
	const part = sv.parts.find((p) => (watched.n ?? 0) >= p.from && (watched.n ?? 0) <= p.to);
	return { season: sv.season, part: part?.part ?? sv.parts[0]?.part ?? 1 };
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
	/** An anime: one entry per season (c240), the open one first in `openSeason`. */
	seasons?: SeasonTrack[];
	openSeason?: number;
};

/** One season's part of the TRACKING row: its link, its facts, and its parts. */
export type SeasonTrack = {
	season: number;
	from: number;
	to: number;
	count: number;
	aired: number;
	watched: number;
	/** The part being watched. */
	part: number;
	parts: { part: number; from: number; to: number }[];
	/** Part 1's link, which is the season's line. */
	link: SeasonLink | null;
	facts: SeasonFact[];
	/** The other part's own word, when the season has two. */
	other: SeasonTrackFacts['other'];
	/** An episode past every part's count. */
	waits: SeasonTrackFacts['waits'];
	hidden: boolean;
	coverOnly: boolean;
	wrongKind: boolean;
};

/**
 * `series_links` keeps meaning what it meant for a comic (one entry for the
 * series). An anime answers per season (c240): the row's own `facts` are the
 * open season's, and `seasons` carries every one of them, which is what the
 * panel draws its lines from.
 */
export function trackingOf(seriesId: number): Tracking | null {
	const db = getDb();
	const r = db
		.prepare(
			`SELECT s.kind, ${HIDDEN_SQL} AS hidden, l.anilist_id, l.mal_id, l.format
			FROM series s JOIN roots r ON r.id = s.root_id LEFT JOIN series_links l ON l.series_id = s.id WHERE s.id = ?`
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
	if (r.kind === 'anime') {
		const seasons = seasonsTracking(seriesId, !!r.hidden);
		const open = seriesSeasons(seriesId)?.open ?? 0;
		const at = seasons.find((s) => s.season === open) ?? seasons[0] ?? null;
		const main =
			at?.facts.find((f) => f.service === 'anilist')?.state ??
			at?.facts.find((f) => f.service === 'mal')?.state ??
			null;
		return {
			facts: at?.facts ?? [],
			hidden: !!r.hidden,
			coverOnly: !!at?.coverOnly,
			status: main?.status ?? null,
			score: main?.score ?? null,
			links: factsLinks(at?.facts ?? [], at?.link ?? null),
			seasons,
			openSeason: open
		};
	}
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

/** The ids the sheet's OPEN cells use, from a season's link. */
function factsLinks(
	facts: SeasonFact[],
	link: SeasonLink | null
): { service: Service; mediaId: number }[] {
	return facts
		.filter((f) => f.linked)
		.map((f) => ({
			service: f.service,
			mediaId: (f.service === 'anilist' ? link?.anilistId : link?.malId) ?? 0
		}))
		.filter((l) => l.mediaId > 0);
}

/** Every season's line, for the panel and the sheet: one per season, its parts folded in. */
function seasonsTracking(seriesId: number, hidden: boolean): SeasonTrack[] {
	const view = seriesSeasons(seriesId);
	if (!view) return [];
	const db = getDb();
	const entries = animeEntries(seriesId);
	const of = (season: number, from?: number, to?: number) =>
		watchedReached(
			entries.map((e) => ({
				id: 0,
				number: e.number,
				readAt: e.readAt,
				lastPosition: null,
				lastOpenedAt: null,
				episode: {
					durationS: null,
					season: e.season,
					number: e.number,
					note: (e.note as '' | 'filler' | 'recap') ?? '',
					thumb: '',
					endingAt: null
				}
			})),
			{ season, from, to }
		);
	return view.seasons.map((sv) => {
		const watchedAll = of(sv.season);
		const parts = sv.parts;
		const at = parts.find((p) => watchedAll >= p.from && watchedAll <= p.to) ??
			parts[0] ?? { part: 1, from: 1, to: sv.aired };
		const facts: SeasonFact[] = SERVICES.map((service): SeasonFact => {
			const l = parts.find((p) => p.part === at.part)?.link ?? null;
			const mediaId = service === 'anilist' ? l?.anilistId : l?.malId;
			const st = l
				? (db
						.prepare(
							`SELECT status, progress, score, read_at, sent_at FROM season_tracker_state
							WHERE series_id = ? AND season = ? AND part = ? AND service = ?`
						)
						.get(seriesId, sv.season, at.part, service) as
						| {
								status: Status | null;
								progress: number;
								score: number | null;
								read_at: number | null;
								sent_at: number | null;
						  }
						| undefined)
				: undefined;
			const w = l
				? (db
						.prepare(
							`SELECT progress, failed_at, error FROM season_tracker_sends
							WHERE series_id = ? AND season = ? AND part = ? AND service = ?`
						)
						.get(seriesId, sv.season, at.part, service) as
						{ progress: number | null; failed_at: number | null; error: string | null } | undefined)
				: undefined;
			return {
				service,
				part: at.part,
				of: l?.episodes ?? at.to,
				signedIn: !!account(service),
				linked: !!mediaId,
				state: st ? { status: st.status, progress: st.progress, score: st.score } : null,
				waiting: w ? { progress: w.progress, failedAt: w.failed_at, error: w.error } : null,
				sentAt: st?.sent_at ?? null
			};
		});
		const otherPart = parts.find((p) => p.part !== at.part) ?? null;
		const otherLink = otherPart?.link ?? null;
		const otherSt = otherPart
			? ((db
					.prepare(
						`SELECT status, progress, score FROM season_tracker_state
						WHERE series_id = ? AND season = ? AND part = ? AND service = 'anilist'`
					)
					.get(seriesId, sv.season, otherPart.part) as
					{ status: Status | null; progress: number; score: number | null } | undefined) ??
				(db
					.prepare(
						`SELECT status, progress, score FROM season_tracker_state
						WHERE series_id = ? AND season = ? AND part = ? AND service = 'mal'`
					)
					.get(seriesId, sv.season, otherPart.part) as
					{ status: Status | null; progress: number; score: number | null } | undefined))
			: undefined;
		const last = parts[parts.length - 1];
		const service = facts.find((f) => f.service === 'anilist')?.linked ? 'anilist' : 'mal';
		return {
			season: sv.season,
			from: sv.from,
			to: sv.to,
			count: sv.count,
			aired: sv.aired,
			watched: sv.watched,
			part: at.part,
			parts: parts.map((p) => ({ part: p.part, from: p.from, to: p.to })),
			link: sv.link,
			facts,
			other:
				otherPart && otherLink
					? {
							part: otherPart.part,
							state: otherSt?.status ?? null,
							progress: otherSt?.progress ?? 0,
							of: otherLink.episodes ?? otherPart.to
						}
					: null,
			waits: last && watchedAll > last.to ? { episode: watchedAll, of: last.to, service } : null,
			hidden,
			coverOnly: !!sv.link && coverOnly('anime', sv.link.format ?? ''),
			wrongKind: !!sv.link && wrongKind('anime', sv.link.format ?? '')
		};
	});
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
					`SELECT COUNT(*) AS n FROM (
						SELECT series_id FROM series_links WHERE ${service === 'anilist' ? 'anilist_id' : 'mal_id'} IS NOT NULL
						UNION
						SELECT series_id FROM series_season_links WHERE ${service === 'anilist' ? 'anilist_id' : 'mal_id'} IS NOT NULL
					)`
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
	const db = getDb();
	db.prepare(`UPDATE tracker_sends SET failed_at = NULL, error = NULL WHERE service = ?`).run(
		service
	);
	db.prepare(
		`UPDATE season_tracker_sends SET failed_at = NULL, error = NULL WHERE service = ?`
	).run(service);
	let sent = 0;
	let failed = 0;
	for (const id of pendingSeries(service)) {
		const r = await sendPending({ seriesId: id });
		sent += r.sent;
		failed += r.failed;
	}
	return { sent, failed };
}

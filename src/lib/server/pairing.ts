import { createHash, randomBytes, randomInt, timingSafeEqual } from 'node:crypto';
import { deviceLabel, isTvApp } from '../settings/catalog.ts';
import { getDb } from './db.ts';

/**
 * Pairing a phone over Wi-Fi (doc/WIFI.md). The computer shows a
 * code; the phone's camera opens it; the phone is signed in, as a device of
 * its own that SIGN OUT can end (a lost phone).
 *
 * - **The code** lives in memory, one at a time: good for 10 minutes and one
 *   phone, once. Opening SETTINGS
 *   makes a fresh one; a restart forgets it, which costs a new code.
 * - **A paired device** is a random token in its cookie and that token's
 *   SHA-256 here (v54, `paired_devices`), never the token: a copy of the
 *   database signs nobody in. It names the Wi-Fi address it was paired at,
 *   since its cookie belongs to that address: when the router hands the
 *   computer another, the phone has to scan again.
 */

export const CODE_MS = 10 * 60_000;
export const PAIRED_COOKIE = 'tsundoku_paired';

export type Code = { code: string; madeAt: number; used: { at: number; who: string } | null };

export type Redeemed = 'ok' | 'expired' | 'used' | 'unknown';

/** The one pairing code, pure apart from the clock and randomness it's given. */
export class Pairing {
	private code: Code | null = null;
	constructor(private make: () => string = () => randomBytes(12).toString('base64url')) {}

	/** A new code, replacing any other: NEW CODE, and every opening of SETTINGS. */
	fresh(now: number): Code {
		this.code = { code: this.make(), madeAt: now, used: null };
		return this.code;
	}

	/** The code as it stands: null when there's none yet. */
	current(): Code | null {
		return this.code;
	}

	state(now: number): 'none' | 'live' | 'used' | 'expired' {
		if (!this.code) return 'none';
		if (this.code.used) return 'used';
		return now - this.code.madeAt >= CODE_MS ? 'expired' : 'live';
	}

	/** A phone scanned `code`: once, within its 10 minutes, and only the current one. */
	redeem(code: string, now: number, who: string): Redeemed {
		const c = this.code;
		if (!c || c.code !== code) return 'unknown';
		if (c.used) return 'used';
		if (now - c.madeAt >= CODE_MS) return 'expired';
		c.used = { at: now, who };
		return 'ok';
	}
}

/** The process's one pairing, shared by SETTINGS and /pair. */
export const pairing = new Pairing();

// ---- One paired cookie per origin -------------------------------------------

/**
 * The paired cookie's name on this origin. A browser's jar -- the TV's
 * WebView's included -- scopes a cookie by host, not by port or scheme, so
 * every tsundoku on one computer would share one name: pairing a second one
 * would sign the TV out of the first, and FORGET on either would forget both.
 *
 * A name may not hold `:`, so the origin is not written into it whole: the
 * port, the scheme's default when the URL has none, and `s` before it for
 * https (`tsundoku_paired_42143`, `tsundoku_paired_s443`). The host is not
 * needed, since the jar keeps one set per host already. The TV app derives the
 * same name for FORGET (`Forget.pairedCookie`); both read
 * `android/app/src/test/resources/paired-cookies.tsv`.
 *
 * The URL is the request's own (`event.url`): built from `ORIGIN` on a served
 * instance and from the Host header under `vite` and on the Wi-Fi listeners,
 * which is in each case the origin the TV typed.
 */
export function pairedCookie(url: URL | string): string {
	const u = typeof url === 'string' ? new URL(url) : url;
	const https = u.protocol === 'https:';
	return `${PAIRED_COOKIE}_${https ? 's' : ''}${u.port || (https ? '443' : '80')}`;
}

/** Any paired cookie's name: the per-origin ones and the shared `tsundoku_paired` older pairings carry. */
export const PAIRED_COOKIE_NAME = /^tsundoku_paired(?:_s?\d+)?$/;

/**
 * How the shared name is expired: with the options it was set with. SvelteKit's
 * `delete` otherwise defaults to `Secure` on any host but localhost, and a
 * browser ignores a Secure write over plain http, so the old cookie stayed
 * (found by tests/tv-pair-origins.e2e.ts, not by a fake jar).
 */
type PairedDelete = Omit<typeof PAIRED_COOKIE_OPTIONS, 'maxAge'>;
const PAIRED_DELETE: PairedDelete = { path: '/', httpOnly: true, sameSite: 'lax', secure: false };

/** What the guard and the routes need of SvelteKit's `cookies`. */
type Jar = {
	get(name: string): string | undefined;
	set(name: string, value: string, opts: typeof PAIRED_COOKIE_OPTIONS): void;
	delete(name: string, opts: PairedDelete): void;
};

/**
 * The paired token a request carries for this origin: its own name first,
 * then the shared one, for a device paired under it. What `/api/devices/sync`
 * reads to join the row; by then `readPaired` has moved an old one over.
 */
export function pairedToken(url: URL, get: (name: string) => string | undefined) {
	return get(pairedCookie(url)) ?? get(PAIRED_COOKIE);
}

/**
 * The paired device this request's cookie names, if `check` takes its token
 * (`pairedBy`, or `friendPaired` for a friend's Wi-Fi listener).
 *
 * A device paired under the shared name carries only that. If that token is
 * one of this server's own pairings, this request writes it again under this
 * origin's name and expires the shared one, so the device stays paired and is
 * never asked for digits again. A shared token this server does not know is
 * another server's on the same host: it is left exactly as it is, for that
 * server to move when the device next opens it.
 */
export function readPaired(
	jar: Jar,
	url: URL,
	check: (token: string | undefined) => Paired | null
): Paired | null {
	const name = pairedCookie(url);
	const own = jar.get(name);
	const found = own === undefined ? null : check(own);
	if (found) return found;
	const old = jar.get(PAIRED_COOKIE);
	if (old === undefined || old === own) return null;
	const moved = check(old);
	if (moved) {
		jar.set(name, old, PAIRED_COOKIE_OPTIONS);
		jar.delete(PAIRED_COOKIE, PAIRED_DELETE);
	}
	return moved;
}

/**
 * The cookie a paired device carries, both for the phone's scanned link and
 * for the TV's typed code: one shape, so the two signs don't drift. Its name
 * is this origin's (`pairedCookie`).
 */
export const PAIRED_COOKIE_OPTIONS = {
	path: '/',
	httpOnly: true,
	sameSite: 'lax' as const,
	// Plain http over the home network: a Secure cookie would never come back.
	secure: false,
	// A year, renewed by nothing: SIGN OUT on the computer is how it ends.
	maxAge: 60 * 60 * 24 * 365
};

/**
 * The TV's code (doc/TV.md, "Pairing"): six digits, typed with a
 * remote, because a TV has no camera. Six digits is a million guesses, so this
 * one has limits the phone's link never needed: five wrong tries burn it, and
 * a new one is made on the computer.
 *
 * One at a time, beside the phone's: the panel shows both, SETTINGS makes
 * fresh ones, and a code is good for the same 10 minutes and one TV, once.
 * Compared by digest, so a wrong code costs the same whatever it shares with
 * the right one.
 */
export const TV_TRIES = 5;

/**
 * How long a used TV code stays ✓ USED before `/pair/tv` may replace it
 * (`renewForTv`): the same 2 minutes `wifi.ts`'s `USED_SHOWN_MS` keeps it up
 * on the computer, which `tests/wifi-db.spec.ts` holds the two to.
 */
export const TV_USED_SHOWN_MS = 2 * 60_000;

export type TvCode = {
	code: string;
	madeAt: number;
	used: { at: number; who: string } | null;
	tries: number;
};

export type TvState = 'none' | 'live' | 'used' | 'expired' | 'burned';
/** `wrong` always has a try left; the fifth one is `burned`. */
export type TvRedeemed = 'ok' | 'wrong' | 'expired' | 'used' | 'burned';

/** Six digits, leading zeros kept ("004219"): what a remote types. */
export const sixDigits = () => String(randomInt(0, 1_000_000)).padStart(6, '0');

const sameCode = (a: string, b: string) =>
	timingSafeEqual(createHash('sha256').update(a).digest(), createHash('sha256').update(b).digest());

/** The one TV code, pure apart from the clock and randomness it's given. */
export class TvPairing {
	private code: TvCode | null = null;
	constructor(private make: () => string = sixDigits) {}

	/** A new code, replacing any other: NEW CODE, and every opening of SETTINGS. */
	fresh(now: number): TvCode {
		this.code = { code: this.make(), madeAt: now, used: null, tries: 0 };
		return this.code;
	}

	current(): TvCode | null {
		return this.code;
	}

	/** How many wrong tries are left: five until one is spent. */
	triesLeft(): number {
		return Math.max(0, TV_TRIES - (this.code?.tries ?? 0));
	}

	/**
	 * The one answer to "what is the TV's code now", which every caller reads:
	 * SETTINGS' DEVICES row and its refresh (`tvCodeNow`), the WI-FI panel
	 * (`wifiView`), `/pair/tv`'s page and its PAIR (`redeem`), and the
	 * computer's `/api/pair/tv`.
	 *
	 * **Burned is burned for good**: a code five wrong tries burned
	 * stays `burned` past its 10 minutes, rather than turning `expired`. Asking
	 * the clock first would turn the DEVICES row's BURNED into EXPIRED once
	 * the 10 minutes ran out, and restart the 5 s poll a burned code never
	 * needs, while `/pair/tv` kept NO TRIES LEFT by a rule of its own. EXPIRED's remedy is one the TV's page makes by itself
	 * (`renewForTv`); a burned code's is the computer's alone, so the two must
	 * never be told apart by the clock. A used code is `used` whatever its
	 * tries: `redeem` never marks a burned code used.
	 */
	state(now: number): TvState {
		const c = this.code;
		if (!c) return 'none';
		if (c.used) return 'used';
		if (c.tries >= TV_TRIES) return 'burned';
		return now - c.madeAt >= CODE_MS ? 'expired' : 'live';
	}

	/**
	 * `/pair/tv`'s own renewal: a TV that is
	 * not paired and arrives with no code to type, or with one that has merely
	 * run out, gets a new one, so the page is never THIS CODE EXPIRED with
	 * nothing to do but walk to the computer. True when it made one.
	 *
	 * - **None**: made.
	 * - **Expired**, with tries left: replaced.
	 * - **Burned** (five wrong tries): kept, past its 10 minutes or not
	 *   (`state` says `burned` either way). Only the computer makes another.
	 * - **Used**: replaced once it is older than the 2 minutes the computer
	 *   keeps ✓ USED up (`TV_USED_SHOWN_MS`). A TV that is not paired and
	 *   finds a used code is another device than the one that spent it, or the
	 *   same one signed out since; before then, the computer's row is still
	 *   turning ✓ USED and listing the TV that used it.
	 * - **Live**: kept.
	 *
	 * The new code keeps the old one's wrong tries. `fresh` -- the user, on
	 * the computer -- is the only thing that gives five again, so a guesser
	 * who opens this page every 10 minutes still has five wrong guesses per
	 * code made on the computer, not five per 10 minutes.
	 */
	renewForTv(now: number): boolean {
		const c = this.code;
		if (!c) {
			this.fresh(now);
			return true;
		}
		if (c.tries >= TV_TRIES) return false;
		const spent = c.used ? now - c.used.at > TV_USED_SHOWN_MS : now - c.madeAt >= CODE_MS;
		if (!spent) return false;
		this.code = { code: this.make(), madeAt: now, used: null, tries: c.tries };
		return true;
	}

	/**
	 * A TV typed `code`: once, within its 10 minutes, with a try to spare.
	 * `wrong` is a guess that still leaves tries; the last one burns the code.
	 * Asked in `state`'s order, so a burned code past its 10 minutes
	 * answers `burned`, the band that says only the computer makes another.
	 */
	redeem(code: string, now: number, who: string): TvRedeemed {
		const c = this.code;
		if (!c) return 'expired';
		if (c.used) return 'used';
		if (c.tries >= TV_TRIES) return 'burned';
		if (now - c.madeAt >= CODE_MS) return 'expired';
		if (!sameCode(c.code, code)) {
			c.tries += 1;
			return c.tries >= TV_TRIES ? 'burned' : 'wrong';
		}
		c.used = { at: now, who };
		return 'ok';
	}
}

/** The computer's one TV code, beside the phone's (`pairing`). */
export const tvPairing = new TvPairing();

// ---- Where a TV's cookie signs in ------------------------------------------

/** The names a request is the computer itself under: a TV's cookie is never a door there. */
const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);

/**
 * The host a request must name for a TV's paired cookie to sign it in: the
 * instance's own public origin's, as `scripts/serve.ts` sets `ORIGIN` (the
 * tailnet name in `https` mode, the tailnet address in `http`).
 *
 * Null when there is no origin to compare against, or when that origin is a
 * loopback one: the tailnet only, never localhost -- the computer itself
 * gains nothing from a TV's cookie -- and fail closed, so no origin means no
 * door at all.
 */
export function tailnetHost(origin: string | null | undefined): string | null {
	if (!origin) return null;
	let url: URL;
	try {
		url = new URL(origin);
	} catch {
		return null;
	}
	if (LOOPBACK_HOSTS.has(url.hostname)) return null;
	return url.host.toLowerCase();
}

/** Whether a request's Host names that door. */
export function tailnetDoor(
	origin: string | null | undefined,
	host: string | null | undefined
): boolean {
	const door = tailnetHost(origin);
	return door !== null && !!host && host.toLowerCase() === door;
}

/**
 * Whether a TV's paired cookie can be a door on this instance at all: its
 * `ORIGIN` names a host that is not loopback (`tailnetHost`). The hook asks
 * `tailnetDoor` with the same `process.env.ORIGIN`, so this is false exactly
 * where the hook would refuse every TV's cookie: `yarn run dev`, `vite
 * preview` and `scripts/serve.ts` in `local` mode, none of which set one.
 */
export const tvDoor = (origin: string | null | undefined = process.env.ORIGIN): boolean =>
	tailnetHost(origin) !== null;

/**
 * Whether SETTINGS › 08 — DEVICES draws the TV's six digits itself
 * (doc/WIFI.md, "Where they show").
 *
 * Only where the cookie those digits set is a door. On a friend's install the
 * WI-FI panel carries them, and a paired device is never shown the code that
 * would pair another. A friend's install served over the tailnet has no WI-FI
 * panel, but its guard reads a paired cookie only over Wi-Fi (`friendPaired`),
 * so drawing the digits there would pair a TV and land it on `/login` -- the
 * bug this check exists to prevent. The token install with no `ORIGIN` (`door`
 * false, `tvDoor`) is the same bug on another shape: the hook refuses every
 * paired cookie there, so a TV would pair and land on `/login` too.
 * The block is the token install's, served on its tailnet origin.
 */
export function tvBlockFor(o: {
	hasWifi: boolean;
	viaLan: boolean;
	paired: boolean;
	friend: boolean;
	door: boolean;
}): boolean {
	return o.door && !o.hasWifi && !o.viaLan && !o.paired && !o.friend;
}

/** Whole minutes left, as the panel counts them (no ticking seconds: motion here is minimal). */
export const minutesLeft = (c: Code, now: number) =>
	Math.max(0, Math.ceil((CODE_MS - (now - c.madeAt)) / 60_000) - 1);

/**
 * "Android phone · Chrome", from the user agent alone: the device hasn't said
 * its screen yet. The TV app appends `TsundokuTV/<version>`, and that is what
 * names it a TV in DEVICES rather than an Android tablet.
 */
export function pairedLabel(ua: string): string {
	if (isTvApp(ua)) return deviceLabel(ua, 'tv');
	const kind =
		/iPad|Tablet/i.test(ua) || (/Android/i.test(ua) && !/Mobile/i.test(ua)) ? 'tablet' : 'phone';
	return deviceLabel(ua, kind);
}

const hash = (token: string) => createHash('sha256').update(token).digest('hex');

export type Paired = {
	label: string;
	address: string;
	pairedAt: number;
	seenAt: number;
	deviceId: string | null;
};

/** A phone just paired: its token, to set as its cookie. Kept here only as a hash. */
export function addPaired(o: { label: string; address: string }, now = Date.now()): string {
	const token = randomBytes(32).toString('base64url');
	getDb()
		.prepare(
			`INSERT INTO paired_devices (token_hash, label, address, paired_at, seen_at) VALUES (?, ?, ?, ?, ?)`
		)
		.run(hash(token), o.label.slice(0, 80), o.address, now, now);
	return token;
}

type Row = {
	label: string;
	address: string;
	paired_at: number;
	seen_at: number;
	device_id: string | null;
};
const shape = (r: Row): Paired => ({
	label: r.label,
	address: r.address,
	pairedAt: r.paired_at,
	seenAt: r.seen_at,
	deviceId: r.device_id
});

/** The paired device a cookie names, if it still is one; seen now. */
export function pairedBy(token: string | undefined, now = Date.now()): Paired | null {
	if (!token) return null;
	const db = getDb();
	const r = db.prepare(`SELECT * FROM paired_devices WHERE token_hash = ?`).get(hash(token)) as
		Row | undefined;
	if (!r) return null;
	// At most once a minute: every image on a page asks.
	if (now - r.seen_at > 60_000)
		db.prepare(`UPDATE paired_devices SET seen_at = ? WHERE token_hash = ?`).run(now, hash(token));
	return shape(r);
}

/**
 * A friend's install: the paired cookie a request carries, read only over
 * Wi-Fi (doc/SIGN-IN.md). Never over localhost, whatever the origin says --
 * a phone's cookie must not become this computer's password bypass.
 */
export function friendPaired(lan: boolean, cookie: string | undefined): Paired | null {
	return lan ? pairedBy(cookie) : null;
}

/** The browser's own device id, once it checks in (devices.ts): what joins it to its DEVICES row. */
export function linkPaired(token: string, deviceId: string): void {
	getDb()
		.prepare(`UPDATE paired_devices SET device_id = ? WHERE token_hash = ? AND device_id IS NOT ?`)
		.run(deviceId, hash(token), deviceId);
}

/** Paired devices by their DEVICES row's id. */
export function pairedDevices(): Map<string, Paired> {
	const rows = getDb()
		.prepare(`SELECT * FROM paired_devices WHERE device_id IS NOT NULL`)
		.all() as Row[];
	return new Map(rows.map((r) => [r.device_id!, shape(r)]));
}

/** SIGN OUT: the device's pairing goes, and its next request is signed out. At once, no confirm. */
export function signOutDevice(deviceId: string): boolean {
	return (
		getDb().prepare(`DELETE FROM paired_devices WHERE device_id = ?`).run(deviceId).changes > 0
	);
}

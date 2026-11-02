import { createHash, randomBytes, randomInt, timingSafeEqual } from 'node:crypto';
import { deviceLabel, isTvApp } from '$lib/settings/catalog';
import { getDb } from './db';

/**
 * Pairing a phone over Wi-Fi (doc/WIFI.md; card c188). The computer shows a
 * code; the phone's camera opens it; the phone is signed in, as a device of
 * its own that SIGN OUT can end (a lost phone).
 *
 * - **The code** lives in memory, one at a time: good for 10 minutes and one
 *   phone, once (the owner's answers 02, via the handoff). Opening SETTINGS
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

/**
 * The cookie a paired device carries, both for the phone's scanned link and
 * for the TV's typed code: one shape, so the two signs don't drift.
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
 * The TV's code (c236; doc/TV.md, "Claims to check"): six digits, typed with a
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

	state(now: number): TvState {
		const c = this.code;
		if (!c) return 'none';
		if (c.used) return 'used';
		if (now - c.madeAt >= CODE_MS) return 'expired';
		return c.tries >= TV_TRIES ? 'burned' : 'live';
	}

	/**
	 * A TV typed `code`: once, within its 10 minutes, with a try to spare.
	 * `wrong` is a guess that still leaves tries; the last one burns the code.
	 */
	redeem(code: string, now: number, who: string): TvRedeemed {
		const c = this.code;
		if (!c) return 'expired';
		if (c.used) return 'used';
		if (now - c.madeAt >= CODE_MS) return 'expired';
		if (c.tries >= TV_TRIES) return 'burned';
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

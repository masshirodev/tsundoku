import { env } from '$env/dynamic/private';
import type { LanControl, LanStatus } from './lan-listen.ts';
import { lanOrigin } from './lan.ts';
import { minutesLeft, pairedDevices, pairing } from './pairing.ts';

/**
 * WI-FI in SETTINGS (doc/WIFI.md; card c188): the app's view of the
 * listeners serve.ts runs in local mode (lan-listen.ts), through the one
 * object it leaves on `globalThis`. Absent everywhere else (the workstation,
 * dev, a test's preview), and then there's no WI-FI row at all: the
 * handoff draws it only for a local install.
 */

const control = () => (globalThis as { __tsundokuLan?: LanControl }).__tsundokuLan ?? null;

/** Whether this install can let a phone in over Wi-Fi: a friend's, local, run by serve.ts. */
export const wifiAvailable = () =>
	control() !== null && env.TSUNDOKU_LOGIN === 'password' && env.TSUNDOKU_SERVE === 'local';

export function wifiStatus(): LanStatus | null {
	return wifiAvailable() ? control()!.status() : null;
}

export async function setWifi(on: boolean): Promise<LanStatus | null> {
	return wifiAvailable() ? control()!.setOn(on) : null;
}

/** The address a phone opens now, if WI-FI is on and listening. */
export function phoneOrigin(): string | null {
	const s = wifiStatus();
	const c = control();
	if (!s?.on || s.reach.kind !== 'home' || !s.listening.length || !c) return null;
	return lanOrigin(s.reach.address, c.port);
}

/** Which door a request came in by: `lan` only through a Wi-Fi listener (lan-listen.ts). */
export const viaLan = (headers: Headers) => headers.get('x-tsundoku-via') === 'lan';

/** The Hosts a Wi-Fi request may name: the addresses it listens on now. */
export function lanHosts(): string[] {
	return wifiStatus()?.listening ?? [];
}

// ---- What SETTINGS shows (doc/WIFI.md; Wifi.dc.html) ------------------------------

export type WifiView = {
	on: boolean;
	/** home: listening (or about to); public: ON can't be pressed (2D); none: no address yet (2D). */
	reach: 'home' | 'public' | 'none';
	/** The public address that rules ON out, or the home one a phone opens. */
	address: string | null;
	/** The address a phone opens, once it's listening. */
	phone: string | null;
	listening: boolean;
	/** Windows asks, once: STARTING… names the dialog until the first start (2A). */
	firstTime: boolean;
	error: string | null;
	/** The address the router took away (2C), while a phone paired at it hasn't scanned again. */
	changed: { from: string; to: string } | null;
	code: {
		url: string;
		state: 'live' | 'used' | 'expired';
		minutes: number;
		usedBy: string | null;
		usedAt: number | null;
	} | null;
};

/** How long a used code's ✓ USED stays on the panel before opening SETTINGS makes a new one. */
const USED_SHOWN_MS = 2 * 60_000;

export function wifiView(o: { fresh?: boolean; now?: number } = {}): WifiView | null {
	const s = wifiStatus();
	if (!s) return null;
	const now = o.now ?? Date.now();
	const phone = phoneOrigin();
	// Opening SETTINGS shows a code that works: a new one unless the current is
	// still live (kept, counting down) or was used just now (USED stays up,
	// with NEW CODE, until pressed). A reload of the page's data when a phone
	// pairs mustn't replace the code it just used.
	const st = pairing.state(now);
	const used = pairing.current()?.used;
	const unusable =
		st === 'none' || st === 'expired' || (st === 'used' && !!used && now - used.at > USED_SHOWN_MS);
	if (phone && (unusable || o.fresh)) pairing.fresh(now);
	const c = pairing.current();
	const state = pairing.state(now);
	// The band stays while a phone is still paired at the old address.
	const stale = s.changed
		? [...pairedDevices().values()].some((p) => p.address === s.changed!.from + portOf(phone))
		: false;
	return {
		on: s.on,
		reach: s.reach.kind,
		address: s.reach.kind === 'none' ? null : s.reach.address,
		phone,
		listening: s.listening.length > 0,
		firstTime: s.firstTime,
		error: s.error,
		changed: stale ? s.changed : null,
		code:
			phone && c && state !== 'none'
				? {
						url: `${phone}/pair/${c.code}`,
						state,
						minutes: minutesLeft(c, now),
						usedBy: c.used?.who ?? null,
						usedAt: c.used?.at ?? null
					}
				: null
	};
}

const portOf = (origin: string | null) => (origin ? `:${new URL(origin).port}` : '');

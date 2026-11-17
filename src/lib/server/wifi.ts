import { env } from '$env/dynamic/private';
import type { LanControl, LanStatus } from './lan-listen.ts';
import { homeSubnet, lanOrigin } from './lan.ts';
import {
	firewallFound,
	firewallView,
	noPhoneYet,
	quietMs,
	serverPlatform,
	type FirewallView
} from './firewall.ts';
import { friendLogin } from './auth.ts';
import {
	CODE_MS,
	minutesLeft,
	pairedDevices,
	pairing,
	tvBlockFor,
	tvDoor,
	tvPairing,
	type Paired,
	type TvState
} from './pairing.ts';

/**
 * WI-FI in SETTINGS (doc/WIFI.md): the app's view of the listeners serve.ts
 * runs in local mode (lan-listen.ts), through the one
 * object it leaves on `globalThis`. Absent everywhere else (a tailnet
 * install, dev, a test's preview), and then there's no WI-FI row at all: it
 * is drawn only for a local install.
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

/** Which listener a request came in by: `lan` only through a Wi-Fi listener (lan-listen.ts). */
export const viaLan = (headers: Headers) => headers.get('x-tsundoku-via') === 'lan';

/** The Hosts a Wi-Fi request may name: the addresses it listens on now. */
export function lanHosts(): string[] {
	return wifiStatus()?.listening ?? [];
}

// ---- What SETTINGS shows (doc/WIFI.md) ------------------------------------------

export type WifiView = {
	on: boolean;
	/** home: listening (or about to); public: ON can't be pressed; none: no address yet. */
	reach: 'home' | 'public' | 'none';
	/** The public address that rules ON out, or the home one a phone opens. */
	address: string | null;
	/** The address a phone opens, once it's listening. */
	phone: string | null;
	listening: boolean;
	/** Windows asks, once: STARTING… names the dialog until the first start. */
	firstTime: boolean;
	error: string | null;
	/** The address the router took away, while a phone paired at it hasn't scanned again. */
	changed: { from: string; to: string } | null;
	code: {
		url: string;
		state: 'live' | 'used' | 'expired';
		minutes: number;
		usedBy: string | null;
		usedAt: number | null;
	} | null;
	/**
	 * The TV's six digits, beside the phone's code: typed with a remote.
	 * In every state a code can be in, burned and expired included: the panel
	 * polls this view every 5 s, and only the page's load and NEW CODE may
	 * replace a spent code (`wifiView`'s `renew` and `fresh`), so five wrong
	 * tries on `/pair/tv` stay burned while the panel is open.
	 */
	tv: {
		code: string;
		state: ShownTvState;
		minutes: number;
		left: number;
	} | null;
};

/**
 * Whether a code is past showing: expired, burned, or used longer ago than the
 * 2 minutes the ✓ USED stays up. Then opening SETTINGS on the computer
 * replaces it (`wifiView({ renew })`, `tvPanel({ renew })`, on a real visit
 * only, `settingsVisit`); NEW CODE and ON make one whatever the code
 * (`fresh`), and so does the computer's own `POST /api/pair/tv`. Neither the
 * WI-FI panel's poll (`GET /api/wifi`) nor the DEVICES row's refresh
 * (`tvCodeNow`) makes one, and the TV's own page makes one only when
 * there is none, or the only one has merely expired or was used over these
 * 2 minutes ago, never over a burned one (`TvPairing.renewForTv`).
 * doc/WIFI.md, "Which doors make a code", is the list.
 */
const CODES: ('none' | 'live' | 'used' | 'expired' | 'burned')[] = ['none', 'expired', 'burned'];

/** How long a used code's ✓ USED stays on the panel before opening SETTINGS makes a new one. */
const USED_SHOWN_MS = 2 * 60_000;

const spent = (state: string, used: { at: number } | null | undefined, now: number) =>
	CODES.includes(state as (typeof CODES)[number]) ||
	(state === 'used' && !!used && now - used.at > USED_SHOWN_MS);

/**
 * Whether a run of SETTINGS' load is a real visit to the page, the one place
 * besides NEW CODE and ON where a spent code is replaced: a document GET, which is the page opened, typed,
 * reloaded or come back to by the browser. A data request is not: the load
 * also reruns for every reload of the page's data (`invalidateAll()`, an
 * enhanced form, the layout's RESCAN or theme), and a code five wrong tries
 * burned while the user changed an unrelated setting must stay burned.
 *
 * A client-side navigation into SETTINGS is a data request too, so it can't
 * be told from a reload here; the page sends `?/renew` for it instead, from
 * `afterNavigate` (`src/routes/settings/+page.svelte`). A POST is never a
 * visit: the load that follows a form posted without script is the form's.
 */
export function settingsVisit(o: { isDataRequest: boolean; method: string }): boolean {
	return !o.isDataRequest && o.method === 'GET';
}

/**
 * Every state the WI-FI panel's TV code can be in: the view reads the code as
 * it is, as the DEVICES row's refresh does (`tvCodeNow`), so a code five wrong
 * tries burned is drawn BURNED until the user makes another.
 */
export type ShownTvState = Exclude<TvState, 'none'>;

/**
 * The WI-FI panel's view (`GET /api/wifi`, the page's load, ON, OFF, NEW CODE).
 *
 * Read only unless asked. Which callers may make a code:
 * - `renew`: replace a spent code (`spent`), keeping a live one and a just-used
 *   one. Only a real visit to SETTINGS on the computer passes it (the load on
 *   a `settingsVisit`, and `?/renew` after a client-side navigation): opening
 *   the page shows a code that works, and a reload of its data never makes
 *   one.
 * - `fresh`: replace both codes whatever they are. ON and NEW CODE only.
 * - neither: the codes as they are, burned and expired included. The panel's
 *   5 s poll, OFF, and every access check. A poll that replaced a burned TV code
 *   gave anyone on the Wi-Fi five more guesses every 5 s while the panel was
 *   open; an access check that did would make one on every request it guarded.
 */
export function wifiView(
	o: { renew?: boolean; fresh?: boolean; now?: number } = {}
): WifiView | null {
	const s = wifiStatus();
	if (!s) return null;
	const now = o.now ?? Date.now();
	const phone = phoneOrigin();
	// Opening SETTINGS shows a code that works: a new one unless the current is
	// still live (kept, counting down) or was used just now (USED stays up,
	// with NEW CODE, until pressed). A reload of the page's data when a phone
	// pairs mustn't replace the code it just used.
	const renew = (state: string, used: { at: number } | null | undefined) =>
		!!phone && (o.fresh || (o.renew && spent(state, used, now)));
	if (renew(pairing.state(now), pairing.current()?.used)) pairing.fresh(now);
	// The TV's code follows the same rule: one beside the phone's, and NEW
	// CODE replaces both, so the two countdowns can diverge only by a reopen.
	if (renew(tvPairing.state(now), tvPairing.current()?.used)) tvPairing.fresh(now);
	const c = pairing.current();
	const state = pairing.state(now);
	const tvc = tvPairing.current();
	const tvState = tvPairing.state(now);
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
				: null,
		tv:
			phone && tvc && tvState !== 'none'
				? {
						code: tvc.code,
						state: tvState,
						minutes: minutesLeft(tvc, now),
						left: tvPairing.triesLeft()
					}
				: null
	};
}

/**
 * The panel's view with what it says about a firewall (doc/WIFI.md, "A
 * firewall on the computer"): the server's platform, the firewall the probe
 * found on, the running app's port and the computer's own home network for
 * the lines to copy, and whether a live code has waited 30 s with nothing yet
 * showing a phone can reach this computer (no request by these listeners, no
 * paired phone). What the load, the poll and ON, OFF and NEW CODE
 * answer, so a press never drops the line the poll drew. Null fields where
 * there is no home address to name.
 */
export type WifiAnswer = WifiView & { firewall: FirewallView | null; noPhoneYet: boolean };

export async function wifiAnswer(
	o: { renew?: boolean; fresh?: boolean; now?: number } = {}
): Promise<WifiAnswer | null> {
	const view = wifiView(o);
	if (!view) return null;
	const now = o.now ?? Date.now();
	const s = wifiStatus();
	const c = control();
	const home = s?.reach.kind === 'home' ? s.reach.address : null;
	const platform = serverPlatform();
	const firewall =
		home && c
			? firewallView({
					platform,
					found: await firewallFound(platform, now),
					port: c.port,
					subnet: homeSubnet(home)
				})
			: null;
	const code = pairing.current();
	return {
		...view,
		firewall,
		noPhoneYet: noPhoneYet({
			live: !!view.phone && view.listening && view.code?.state === 'live',
			madeAt: code?.madeAt ?? null,
			reachedAt: s?.reachedAt,
			paired: pairedDevices().size,
			now,
			quiet: quietMs()
		})
	};
}

const portOf = (origin: string | null) => (origin ? `:${new URL(origin).port}` : '');

// ---- The TV's digits where there is no WI-FI panel -------------------------

export type TvPanel = {
	code: string;
	/**
	 * Every state a code can be in. The load (`tvPanel`) gives live or used on
	 * a real visit, since it replaces a spent code then (`renew`), and on a
	 * reload of the page's data the code as it is, any state; the row's
	 * refresh (`tvCodeNow`) gives the code as it is too, burned and expired
	 * included, and the row draws them.
	 */
	state: Exclude<TvState, 'none'>;
	minutes: number;
	/** Tries left before a wrong guess burns the code */
	left: number;
	/** When the six digits stop working: the page ticks its own countdown from this. */
	expiresAt: number;
};

/**
 * The TV's code as it is right now, spent or not, and nothing made: what the
 * DEVICES row's refresh (`GET /settings/tv`) answers with.
 *
 * Read only, on purpose. Five wrong tries on `/pair/tv` burn the code, and
 * only the user makes another (NEW CODE, or opening SETTINGS): a refresh
 * that replaced a burned code would give a guesser five more tries every time
 * the open page asked, which is no lockout at all.
 */
export function tvCodeNow(now: number = Date.now()): TvPanel | null {
	const c = tvPairing.current();
	const state = tvPairing.state(now);
	if (!c || state === 'none') return null;
	return {
		code: c.code,
		state,
		minutes: minutesLeft(c, now),
		left: tvPairing.triesLeft(),
		expiresAt: c.madeAt + CODE_MS
	};
}

/**
 * The TV's six digits on an install with no WI-FI panel to carry them: an
 * instance served on the tailnet with the token, where there is
 * no phone's QR and SETTINGS › 08 — DEVICES is the only place the code can be
 * seen (doc/WIFI.md).
 *
 * Freshness is `wifiView`'s rule: with `renew`, a live code is kept and counts
 * down, and anything spent (expired, burned, used longer ago than ✓ USED stays
 * up) is replaced. Only a real visit passes it (`settingsVisit`,
 * `?/renew`); a reload of the page's data reads the code as it is, so a burn
 * stays. `fresh` is NEW CODE. Only the page's load, `?/renew` and `?/tvCode`
 * call this; the row's refresh never does.
 */
export function tvPanel(
	o: { renew?: boolean; fresh?: boolean; now?: number } = {}
): TvPanel | null {
	const now = o.now ?? Date.now();
	if (o.fresh || (o.renew && spent(tvPairing.state(now), tvPairing.current()?.used, now)))
		tvPairing.fresh(now);
	return tvCodeNow(now);
}

/**
 * Whether this request may see or make the TV's six digits in SETTINGS ›
 * 08 — DEVICES: `tvBlockFor`, asked with this instance's and this request's
 * facts. Every route that draws the block or makes its code asks this one
 * function -- the load, `?/tvCode` (NEW CODE) and `GET /settings/tv` (the
 * row's refresh) -- so none can make a code that nothing on its screen can
 * use.
 */
export function tvBlockHere(locals: { via: 'local' | 'lan'; paired: Paired | null }): boolean {
	return tvBlockFor({
		// Whether there is a panel at all, asked of the listeners: `wifiView()`
		// here once made a code on every request the check guarded.
		hasWifi: wifiStatus() !== null,
		viaLan: locals.via === 'lan',
		paired: !!locals.paired,
		friend: friendLogin(),
		door: tvDoor()
	});
}

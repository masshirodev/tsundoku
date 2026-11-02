import { DEVICE_KEYS, deviceKind, type DeviceKind, type Json } from './catalog.ts';
import type { Stamped } from './stamped.ts';

/**
 * This device's settings, in its browser (doc/SETTINGS.md, "Devices"; card
 * c171). Every reader reads and writes them here, so each change is stamped
 * and the workstation's copy follows: the readers keep working offline, and
 * the SETTINGS page can show and change another device's. Storage can be
 * refused (a private window): a setting then lasts the visit, as before.
 */

const ID_KEY = 'tsundoku.device';
const STAMPS_KEY = 'tsundoku.device.stamps';
/** What a browser kept before c171, for the workstation to take once (anime/choices.ts). */
const LEGACY = /^tsundoku:anime:(?:\d+:)?(audio|subs|subsize)$/;

function get(key: string): string | null {
	try {
		return localStorage.getItem(key);
	} catch {
		return null;
	}
}
function put(key: string, v: string | null): void {
	try {
		if (v === null) localStorage.removeItem(key);
		else localStorage.setItem(key, v);
	} catch {
		// Refused storage: the visit's only.
	}
}

export function readLocal<T>(key: string, fallback: T): T {
	const v = get(key);
	if (v === null) return fallback;
	try {
		return JSON.parse(v) as T;
	} catch {
		return fallback;
	}
}

function stamps(): Record<string, number> {
	return readLocal<Record<string, number>>(STAMPS_KEY, {});
}

type Listener = (key: string) => void;
const listeners = new Set<Listener>();
/** A key changed here or from the workstation: the SETTINGS page redraws its row. */
export function onLocalChange(fn: Listener): () => void {
	listeners.add(fn);
	return () => listeners.delete(fn);
}

/**
 * A device setting changed: stored, stamped now, and sent to the workstation
 * soon. Undefined resets it, which is kept as a stamped removal so the reset
 * reaches the workstation too.
 */
export function writeLocal(key: string, value: Json | undefined, now = Date.now()): void {
	put(key, value === undefined || value === null ? null : JSON.stringify(value));
	if (DEVICE_KEYS.includes(key)) {
		put(STAMPS_KEY, JSON.stringify({ ...stamps(), [key]: now }));
		syncSoon();
	}
	for (const fn of listeners) fn(key);
}

/** This browser's id, made on first use: a device is its browser, there are no accounts. */
export function deviceId(): string {
	let id = get(ID_KEY);
	if (!id) {
		id =
			typeof crypto !== 'undefined' && 'randomUUID' in crypto
				? crypto.randomUUID()
				: Array.from({ length: 4 }, () => Math.random().toString(16).slice(2, 10)).join('-');
		put(ID_KEY, id);
	}
	return id;
}

export function thisKind(): DeviceKind {
	return deviceKind({
		width: Math.min(screen.width, innerWidth || screen.width),
		coarse: matchMedia('(pointer: coarse)').matches,
		// A TV reports no pointer at all: the layout's own query (layout.css).
		pointerNone: matchMedia('(pointer: none)').matches
	});
}

/** Every device key as stored here, with its stamp; a value kept before c171 has stamp 0. */
export function localStamped(): Stamped {
	const at = stamps();
	const out: Stamped = {};
	for (const k of DEVICE_KEYS) {
		const raw = get(k);
		if (raw === null && at[k] === undefined) continue;
		let v: Json;
		try {
			v = raw === null ? null : (JSON.parse(raw) as Json);
		} catch {
			continue;
		}
		out[k] = { v, at: at[k] ?? 0 };
	}
	return out;
}

/** Take what the workstation has newer: stored with its stamp, so it isn't sent back as new. */
export function applyNewer(newer: Stamped): string[] {
	const at = stamps();
	const changed: string[] = [];
	for (const [k, e] of Object.entries(newer)) {
		if (!DEVICE_KEYS.includes(k)) continue;
		put(k, e.v === null ? null : JSON.stringify(e.v));
		at[k] = e.at;
		changed.push(k);
	}
	if (changed.length) put(STAMPS_KEY, JSON.stringify(at));
	for (const k of changed) for (const fn of listeners) fn(k);
	return changed;
}

function legacyKeys(): Record<string, Json> {
	const out: Record<string, Json> = {};
	try {
		for (let i = 0; i < localStorage.length; i++) {
			const k = localStorage.key(i);
			if (k && LEGACY.test(k)) out[k] = readLocal<Json>(k, null);
		}
	} catch {
		// Refused storage: nothing kept to hand over.
	}
	return out;
}

let timer: ReturnType<typeof setTimeout> | null = null;
let syncing: Promise<boolean> | null = null;

function syncSoon() {
	if (typeof window === 'undefined') return;
	if (timer) clearTimeout(timer);
	timer = setTimeout(() => void syncDevice(), 1500);
}

/**
 * Check in with the workstation: send this device's record, take what's
 * newer there. Offline, or the workstation not answering, it waits for the
 * next change, the next load, or the network coming back. Resolves whether
 * it reached the workstation.
 */
export function syncDevice(o: { register?: boolean } = {}): Promise<boolean> {
	if (syncing && !o.register) return syncing;
	syncing = (async () => {
		try {
			const legacy = legacyKeys();
			const res = await fetch('/api/devices/sync', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				keepalive: true,
				body: JSON.stringify({
					id: deviceId(),
					kind: thisKind(),
					settings: localStamped(),
					legacy,
					// SETTINGS lists this device even with nothing changed yet.
					register: !!o.register
				})
			});
			if (!res.ok) return false;
			const body = (await res.json()) as { newer: Stamped };
			applyNewer(body.newer);
			// Handed over: the workstation keeps them now (anime/choices.ts).
			for (const k of Object.keys(legacy)) put(k, null);
			return true;
		} catch {
			return false;
		} finally {
			syncing = null;
		}
	})();
	return syncing;
}

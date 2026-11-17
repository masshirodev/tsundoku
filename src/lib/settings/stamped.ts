import { valueDef, type Json, type ValueId, type Values } from './catalog.ts';

/**
 * A device's settings as the workstation keeps them (doc/SETTINGS.md,
 * "Devices"): each storage key with the
 * value it holds and when it was set. The browser keeps the same record
 * beside its storage, so either side can be newer: a reader changed offline,
 * or this page changing another device's settings. The newer stamp wins, key
 * by key. A value of `null` with a stamp is a reset: the key goes, and the
 * default stands.
 */
export type Stamped = Record<string, { v: Json; at: number }>;

/** Key by key, the newer of the two; a tie keeps [a]'s, so a resend changes nothing. */
export function mergeStamped(a: Stamped, b: Stamped): Stamped {
	const out: Stamped = { ...a };
	for (const [k, e] of Object.entries(b)) if (!out[k] || e.at > out[k].at) out[k] = e;
	return out;
}

/** The keys where [theirs] is newer than [mine]: what a device has to take. */
export function newerIn(mine: Stamped, theirs: Stamped): Stamped {
	const out: Stamped = {};
	for (const [k, e] of Object.entries(theirs)) if (!mine[k] || e.at > mine[k].at) out[k] = e;
	return out;
}

/** A stamped record as it's read: the keys that hold something. */
export const plain = (s: Stamped): Record<string, Json> =>
	Object.fromEntries(Object.entries(s).flatMap(([k, e]) => (e.v === null ? [] : [[k, e.v]])));

/** One value out of a device's storage: a key, or a field of the object stored at it. */
export function readValue(id: ValueId, store: Record<string, Json>): Json | undefined {
	const d = valueDef(id);
	const raw = store[d.key];
	if (!d.field) return raw;
	return raw && typeof raw === 'object' && !Array.isArray(raw) && d.field in raw
		? (raw as Record<string, Json>)[d.field]
		: undefined;
}

/**
 * What storing [v] at [id] makes of the key: the value itself, or the object
 * with that field set. Undefined resets it: the key's removal (null), or the
 * field taken out of the object.
 */
export function writeValue(id: ValueId, store: Record<string, Json>, v: Json | undefined): Json {
	const d = valueDef(id);
	if (!d.field) return v === undefined ? null : v;
	const raw = store[d.key];
	const obj = raw && typeof raw === 'object' && !Array.isArray(raw) ? { ...raw } : {};
	if (v === undefined) delete (obj as Record<string, Json>)[d.field];
	else (obj as Record<string, Json>)[d.field] = v;
	return Object.keys(obj).length ? obj : null;
}

/** Every device value of [store] the page shows, by value id. */
export function deviceValues(ids: ValueId[], store: Record<string, Json>): Values {
	const out: Values = {};
	for (const id of ids) {
		const v = readValue(id, store);
		if (v !== undefined) out[id] = v;
	}
	return out;
}

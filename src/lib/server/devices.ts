import { getDb } from './db.ts';
import { DEVICE_KEYS, type DeviceKind, type Json } from '../settings/catalog.ts';
import { mergeStamped, newerIn, type Stamped } from '../settings/stamped.ts';

/**
 * Each device's own settings, kept on the workstation too (doc/SETTINGS.md,
 * "Devices"; the owner's answer to question 1). A browser keeps its
 * settings in its own storage, so the readers work offline, and sends them
 * here stamped; this keeps the newer of each key, and answers with whatever
 * here is newer than the browser's (a change this page made from another
 * device). A device is a random id its browser keeps: there are no accounts.
 */

export type DeviceRow = {
	id: string;
	kind: DeviceKind;
	label: string;
	seenAt: number;
	settings: Stamped;
};

const KINDS: DeviceKind[] = ['phone', 'tablet', 'desktop', 'tv'];
/** A browser makes its id with crypto.randomUUID; anything else isn't one. */
const ID = /^[0-9a-f-]{16,64}$/;

export const isDeviceId = (id: unknown): id is string => typeof id === 'string' && ID.test(id);

/** Only the keys a device keeps, each a value and a stamp: what a browser sends is checked. */
export function cleanStamped(raw: unknown): Stamped {
	const out: Stamped = {};
	if (!raw || typeof raw !== 'object') return out;
	for (const [k, e] of Object.entries(raw as Record<string, unknown>)) {
		if (!DEVICE_KEYS.includes(k) || !e || typeof e !== 'object') continue;
		const { v, at } = e as { v?: unknown; at?: unknown };
		if (typeof at !== 'number' || !Number.isFinite(at)) continue;
		// A value is what a browser stored as JSON; a megabyte of it isn't a setting.
		if (JSON.stringify(v ?? null).length > 4096) continue;
		out[k] = { v: (v ?? null) as Json, at };
	}
	return out;
}

function row(id: string): DeviceRow | null {
	const r = getDb()
		.prepare(`SELECT id, kind, label, seen_at, settings FROM devices WHERE id = ?`)
		.get(id) as
		{ id: string; kind: DeviceKind; label: string; seen_at: number; settings: string } | undefined;
	return r
		? {
				id: r.id,
				kind: r.kind,
				label: r.label,
				seenAt: r.seen_at,
				settings: JSON.parse(r.settings) as Stamped
			}
		: null;
}

export const device = row;

/** A device not seen for this long is forgotten: a browser whose storage was cleared is a new one. */
export const FORGET_MS = 180 * 24 * 3600_000;

/**
 * A browser checking in: its record merged into the kept one, which comes
 * back as what the browser has to take. A browser with nothing to keep isn't
 * recorded until it opens SETTINGS ([register]): otherwise every fresh
 * browser, a private window, a test's, would be a device forever.
 */
export function syncDevice(
	o: { id: string; kind: DeviceKind; label: string; settings: Stamped; register?: boolean },
	now = Date.now()
): { newer: Stamped; created: boolean } {
	if (!isDeviceId(o.id) || !KINDS.includes(o.kind)) throw new Error('not a device');
	const db = getDb();
	db.prepare(`DELETE FROM devices WHERE seen_at < ?`).run(now - FORGET_MS);
	const kept = row(o.id);
	if (!kept && !o.register && Object.keys(o.settings).length === 0)
		return { newer: {}, created: false };
	const merged = mergeStamped(kept?.settings ?? {}, o.settings);
	db.prepare(
		`INSERT INTO devices (id, kind, label, seen_at, settings) VALUES (?, ?, ?, ?, ?)
		ON CONFLICT (id) DO UPDATE SET kind = excluded.kind, label = excluded.label,
			seen_at = excluded.seen_at, settings = excluded.settings`
	).run(o.id, o.kind, o.label.slice(0, 80), now, JSON.stringify(merged));
	return { newer: newerIn(o.settings, merged), created: !kept };
}

/** Every device that has checked in, the most recently seen first. */
export function listDevices(): DeviceRow[] {
	return (
		getDb().prepare(`SELECT id FROM devices ORDER BY seen_at DESC`).all() as { id: string }[]
	).map((r) => row(r.id)!);
}

/**
 * This page changing another device's settings (2C): stamped now, so the
 * device takes it the next time it opens, unless it changed the same key since.
 */
export function setDeviceKey(id: string, key: string, v: Json, now = Date.now()): boolean {
	const kept = row(id);
	if (!kept || !DEVICE_KEYS.includes(key)) return false;
	const settings = { ...kept.settings, [key]: { v, at: now } };
	getDb().prepare(`UPDATE devices SET settings = ? WHERE id = ?`).run(JSON.stringify(settings), id);
	return true;
}

/**
 * START FROM another device (question 1): a new device takes every key the
 * other one holds, stamped now, so its own browser takes them on the next
 * check-in.
 */
export function startFrom(id: string, from: string, now = Date.now()): boolean {
	const to = row(id);
	const src = row(from);
	if (!to || !src || id === from) return false;
	const settings: Stamped = { ...to.settings };
	for (const [k, e] of Object.entries(src.settings)) settings[k] = { v: e.v, at: now };
	getDb().prepare(`UPDATE devices SET settings = ? WHERE id = ?`).run(JSON.stringify(settings), id);
	return true;
}

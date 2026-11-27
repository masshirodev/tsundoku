// Refusals of the reader's own network, as tsundoku's screens meet them
// (c1156; handoff `fetcher-options`, revision 1). The fetcher's error carries
// what it refused as data (`Refusal`), but a screen only sees the sentence:
// the request went through the engine's Java, or the server worker, often in
// the tab that leads rather than the one on screen, and before this page's
// script ran. So the tab that relays a request records each refusal here, in
// localStorage, which every tab of the origin shares, and a screen looks up
// the refusal whose sentence it is showing (`refusalIn`).
import type { Refusal } from '../fetcher/protocol.ts';

export const REFUSALS_KEY = 'tsundoku:refusals';
/** How long a refusal is remembered: long enough to reach its screen, no longer. */
export const REFUSAL_TTL_MS = 10 * 60_000;
const KEEP = 30;

export interface Refused extends Refusal {
	/** The fetcher's sentence, as the screen shows it. */
	message: string;
	/** When, in ms. */
	at: number;
}

/** The part of `Storage` used, so a spec passes a map. */
export interface KeyValue {
	getItem(key: string): string | null;
	setItem(key: string, value: string): void;
}

/** The refusals remembered, newest first, within the TTL; anything unreadable is none. */
export function readRefusals(store: KeyValue, now: number): Refused[] {
	let list: unknown;
	try {
		list = JSON.parse(store.getItem(REFUSALS_KEY) ?? '[]');
	} catch {
		return [];
	}
	if (!Array.isArray(list)) return [];
	return list
		.filter(
			(r): r is Refused =>
				!!r &&
				typeof r.host === 'string' &&
				typeof r.port === 'string' &&
				typeof r.message === 'string' &&
				typeof r.asked === 'boolean' &&
				typeof r.at === 'number' &&
				now - r.at < REFUSAL_TTL_MS
		)
		.sort((a, b) => b.at - a.at);
}

/** Remembers one refusal; the same sentence again moves to the front. */
export function recordRefusal(
	store: KeyValue,
	refusal: Refusal,
	message: string,
	now: number
): void {
	const rest = readRefusals(store, now).filter((r) => r.message !== message);
	const next: Refused[] = [{ ...refusal, message, at: now }, ...rest].slice(0, KEEP);
	try {
		store.setItem(REFUSALS_KEY, JSON.stringify(next));
	} catch {
		// A full or refused storage only loses the ALLOW offer, never the request.
	}
}

/** The refusal whose sentence [text] shows (an error that carries it), newest first. */
export function refusalIn(text: string, list: readonly Refused[]): Refused | null {
	const lower = text.toLowerCase();
	return list.find((r) => lower.includes(r.message.toLowerCase())) ?? null;
}

/**
 * The address a proxy on the reader's network would be: refusals for two or
 * more different hosts that all answered from it (in Chromium, the browser
 * reports a proxy's address as the one every answer came from).
 */
export function proxySuspect(
	list: readonly Refused[]
): { address: string; hosts: string[]; since: number } | null {
	const by = new Map<string, { hosts: Set<string>; since: number }>();
	for (const r of list) {
		if (!r.answeredFrom) continue;
		const seen = by.get(r.answeredFrom) ?? { hosts: new Set(), since: r.at };
		seen.hosts.add(r.host);
		seen.since = Math.min(seen.since, r.at);
		by.set(r.answeredFrom, seen);
	}
	let best: { address: string; hosts: string[]; since: number } | null = null;
	for (const [address, seen] of by) {
		if (seen.hosts.size < 2) continue;
		if (!best || seen.hosts.size > best.hosts.length)
			best = { address, hosts: [...seen.hosts], since: seen.since };
	}
	return best;
}

/**
 * Forgets the refusals an ALLOW answered: those of [host], and those that
 * answered from it (a proxy's), so the screens stop offering what is allowed.
 */
export function forgetRefusals(store: KeyValue, host: string, now: number): void {
	const rest = readRefusals(store, now).filter((r) => r.host !== host && r.answeredFrom !== host);
	try {
		store.setItem(REFUSALS_KEY, JSON.stringify(rest));
	} catch {
		// Nothing to forget in a storage that can't be written.
	}
}

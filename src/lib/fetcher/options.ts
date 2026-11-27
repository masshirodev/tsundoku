// The fetcher's options page, as rules (c1156; handoff `fetcher-options`,
// revision 1): what ADD BY HAND keeps or refuses, and what each entry on the
// list covers. The page (fetcher/options.ts) only draws these.
import { ipVersion } from '../server/public-ip.ts';
import { entryAllows, isOwnNetwork, parseAllowEntry } from './reach.ts';

/** Why ADD BY HAND won't keep what was typed (the handoff's FieldStates board). */
export type HandRefusal =
	/** Two words, or nothing a URL can read as a host. */
	| { why: 'no-host' }
	/** An address of another kind: `ftp://nas.lan/books`. */
	| { why: 'scheme'; scheme: string; host: string | null }
	/** A name and password in the address: nothing of it is kept. */
	| { why: 'password'; host: string | null }
	/** A host on the internet: the fetcher reaches it already. */
	| { why: 'public'; host: string }
	/** Covered by an entry on the list already. */
	| { why: 'covered'; host: string; by: string }
	/** A port outside 1 to 65535. */
	| { why: 'port' };

export type HandResult = { ok: true; entry: string } | ({ ok: false } & HandRefusal);

/** The host of a typed address, when a URL can read one, for a refusal to name. */
function hostOf(typed: string): string | null {
	try {
		return new URL(typed).hostname || null;
	} catch {
		return null;
	}
}

/**
 * What ADD BY HAND makes of [text], given the list as it is: the entry it
 * would keep, or why it won't. Nothing is stored until the reader presses ADD.
 */
export function checkHandEntry(text: string, list: readonly string[]): HandResult {
	const typed = text.trim();
	if (!typed || /\s/.test(typed)) return { ok: false, why: 'no-host' };
	const scheme = /^([a-z][a-z0-9+.-]*):\/\//i.exec(typed)?.[1].toLowerCase();
	if (scheme && scheme !== 'http' && scheme !== 'https')
		return { ok: false, why: 'scheme', scheme, host: hostOf(typed) };
	const withScheme = scheme ? typed : `http://${typed}`;
	// Checked before the URL is read: a port out of range is not a URL at all.
	const authority = withScheme.replace(/^[^:]+:\/\//, '').split(/[/?#]/)[0];
	if (/@/.test(authority)) return { ok: false, why: 'password', host: hostOf(withScheme) };
	const port = /:(\d+)$/.exec(authority)?.[1];
	if (port !== undefined && (Number(port) < 1 || Number(port) > 65535))
		return { ok: false, why: 'port' };
	const entry = parseAllowEntry(typed);
	if (!entry) return { ok: false, why: 'no-host' };
	const { host } = coverage(entry);
	const at = new URL(`http://${host}/`);
	if (!isOwnNetwork(at)) return { ok: false, why: 'public', host };
	if (list.includes(entry)) return { ok: false, why: 'covered', host, by: entry };
	const wanted = coverage(entry);
	const by = list.find((e) => {
		const c = coverage(e);
		if (c.host !== wanted.host) return false;
		if (c.port === null) return true;
		if (wanted.port === null) return false;
		const probe = new URL(`http://${host}/`);
		probe.port = wanted.port === '80' ? '' : wanted.port;
		return entryAllows(e, probe);
	});
	if (by) return { ok: false, why: 'covered', host, by };
	return { ok: true, entry };
}

/** What an entry covers, as the list draws it. */
export interface Coverage {
	host: string;
	/** Null for every port. */
	port: string | null;
	/** An address, not a name: a proxy at it is covered too. */
	address: boolean;
}

export function coverage(entry: string): Coverage {
	const m = /^(\[[^\]]+\]|[^:[\]]+):(\d+)$/.exec(entry);
	const host = m ? m[1] : entry;
	const bare = host.replace(/^\[|\]$/g, '');
	return { host, port: m ? m[2] : null, address: ipVersion(bare) !== 0 };
}

/** Where each entry on the list came from, kept beside it (`allowedHostsMeta`). */
export const ALLOWED_META_KEY = 'allowedHostsMeta';

export interface EntryMeta {
	/** `asked`: the reader allowed it when tsundoku asked; `hand`: typed under ADD BY HAND. */
	via: 'asked' | 'hand';
	/** When, in ms. */
	at: number;
}

/** The meta from what storage holds, keeping only well-formed records. */
export function readMeta(stored: Record<string, unknown>): Record<string, EntryMeta> {
	const raw = stored[ALLOWED_META_KEY];
	const out: Record<string, EntryMeta> = {};
	if (!raw || typeof raw !== 'object') return out;
	for (const [entry, meta] of Object.entries(raw as Record<string, unknown>)) {
		const m = meta as Partial<EntryMeta> | null;
		if (m && (m.via === 'asked' || m.via === 'hand') && typeof m.at === 'number')
			out[entry] = { via: m.via, at: m.at };
	}
	return out;
}

/**
 * What ADD BY HAND drops from a whole address to keep its host and port, for
 * the KEEPS row to say (`http://` and `/repo/index.min.json`); empty when
 * the host was typed alone.
 */
export function droppedParts(text: string): string[] {
	const typed = text.trim();
	const scheme = /^([a-z][a-z0-9+.-]*:\/\/)/i.exec(typed)?.[1];
	const rest = scheme ? typed.slice(scheme.length) : typed;
	const at = rest.search(/[/?#]/);
	const tail = at === -1 ? '' : rest.slice(at);
	return [...(scheme ? [scheme.toLowerCase()] : []), ...(tail && tail !== '/' ? [tail] : [])];
}

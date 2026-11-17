import { resolve } from '$app/paths';

/**
 * Lookups made offline (doc/JAPANESE.md, "The panel"): kept on this device and
 * sent to the workstation's log when it's reachable again, with the time they
 * were made. Incognito never queues: nothing is logged at all.
 */

export type LookupBody = {
	seriesId: number;
	entryId: number | null;
	place: string;
	lemma: string;
	surface: string;
	reading: string | null;
	pos: string;
	sentence: string;
	at: number;
};

const KEY = 'tsundoku.lookups';
const MAX = 500;

function read(): LookupBody[] {
	try {
		return JSON.parse(localStorage.getItem(KEY) ?? '[]') as LookupBody[];
	} catch {
		return [];
	}
}

function write(items: LookupBody[]) {
	try {
		if (items.length) localStorage.setItem(KEY, JSON.stringify(items.slice(-MAX)));
		else localStorage.removeItem(KEY);
	} catch {
		// Private mode or full: a lookup offline goes unlogged.
	}
}

export function queueLookup(body: LookupBody): void {
	write([...read(), body]);
}

/** Send what was queued; what the workstation doesn't take stays for next time. */
export async function flushLookups(): Promise<void> {
	const items = read();
	if (items.length === 0) return;
	const left: LookupBody[] = [];
	for (const [i, b] of items.entries()) {
		try {
			const r = await fetch(resolve('/api/lookups'), {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify(b)
			});
			// A series gone or hidden since: nothing to keep it for.
			if (!r.ok && r.status !== 404) left.push(b);
		} catch {
			left.push(...items.slice(i));
			break;
		}
	}
	write(left);
}

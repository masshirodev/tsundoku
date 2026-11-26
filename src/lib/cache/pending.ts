import { resolve } from '$app/paths';

/**
 * Reading done offline (doc/OFFLINE.md). A progress event that can't reach
 * the workstation is kept in this browser's storage with the time it
 * happened, and sent when the workstation answers again -- the reader's next
 * successful event, or the browser coming back online. The server logs each
 * at its own time and never lets one move progress backwards.
 */
const KEY = 'tsundoku.pending';
const MAX = 2000;

function read(): string[] {
	try {
		return JSON.parse(localStorage.getItem(KEY) ?? '[]') as string[];
	} catch {
		return [];
	}
}

function write(items: string[]): void {
	try {
		if (items.length) localStorage.setItem(KEY, JSON.stringify(items.slice(-MAX)));
		else localStorage.removeItem(KEY);
	} catch {
		// Storage refused: this event is lost, as it would have been before.
	}
}

export function queuePending(body: string): void {
	write([...read(), body]);
}

/** One kept event let go, the first copy of it: the server has it. */
function letGo(body: string): void {
	const items = read();
	const at = items.indexOf(body);
	if (at < 0) return;
	items.splice(at, 1);
	write(items);
}

/** The server's own answer to a reading event: JSON, never a page served in its place. */
const taken = (res: Response) =>
	res.ok && (res.headers.get('content-type') ?? '').includes('application/json');

/** Events sent and not yet answered: a flush leaves them to their own send. */
const sending = new Set<string>();

/**
 * Sends one reading event, and answers the server's response, or null when
 * the server wasn't reached (the event is then kept, as before).
 *
 * In the web edition the server runs in the leading tab (doc/WEB-EDITION.md),
 * so a tab closed or reloaded right after a chapter's last page takes the
 * FINISH on its way with it: the event is kept *first* and let go only once
 * the server has it, and the next start sends what is left (c1123,
 * 2026-11-26). An event the server took just before the tab went, whose
 * answer never came, can be sent twice; the server never lets one move
 * progress backwards.
 */
export async function postReading(body: string, web = __WEB_EDITION__): Promise<Response | null> {
	if (web) queuePending(body);
	sending.add(body);
	try {
		const res = await fetch(resolve('/api/reading'), {
			method: 'POST',
			body,
			headers: { 'content-type': 'application/json' },
			// In the web edition the server is this tab: nothing to keep alive,
			// and Firefox sends a keepalive request past the service worker
			// (web/keepalive.js).
			keepalive: !web
		});
		// Only the server's own answer lets go of it: a page served in its
		// place (a request that missed the service worker) took nothing.
		if (web && (taken(res) || refusedForGood(res.status))) letGo(body);
		return res;
	} catch {
		// Offline: kept on the tablet with its own time, and sent when the
		// workstation answers again (doc/OFFLINE.md).
		if (!web) queuePending(body);
		return null;
	} finally {
		sending.delete(body);
	}
}

/**
 * The reader closing (`pagehide`): a beacon, which outlives the page. In the
 * web edition the server goes with the page, so the event is kept for the
 * next start instead; a beacon as well could be taken twice.
 */
export function closeReading(body: string, online: boolean, web = __WEB_EDITION__): void {
	if (web) return queuePending(body);
	const sent =
		online &&
		navigator.sendBeacon?.(resolve('/api/reading'), new Blob([body], { type: 'application/json' }));
	if (!sent) queuePending(body);
}

/**
 * Whether an answer means this event will never be taken, so it is dropped
 * rather than left to block the rest behind it: a 4xx about the event itself
 * (an entry since removed, a series hidden again, a body the server can't
 * read). Everything else keeps the queue for the next try: a 5xx or no answer
 * is the workstation not ready yet, which is the very case the queue exists
 * for, and a 401, 403, 408 or 429 says something about this browser or this
 * moment, not about the event.
 */
export function refusedForGood(status: number): boolean {
	return status >= 400 && status < 500 && ![401, 403, 408, 429].includes(status);
}

let flushing = false;

/**
 * Send what was kept, oldest first; stop at the first that doesn't go
 * through. Answers how many the server took. An event still on its way in
 * `postReading` is left to it.
 */
export async function flushPending(): Promise<number> {
	if (flushing) return 0;
	flushing = true;
	let count = 0;
	try {
		for (;;) {
			const next = read().find((b) => !sending.has(b));
			if (next === undefined) return count;
			let res: Response;
			try {
				res = await fetch(resolve('/api/reading'), {
					method: 'POST',
					body: next,
					headers: { 'content-type': 'application/json' }
				});
			} catch {
				return count;
			}
			if (!taken(res) && !refusedForGood(res.status)) return count;
			letGo(next);
			if (res.ok) count++;
		}
	} finally {
		flushing = false;
	}
}

if (typeof window !== 'undefined') addEventListener('online', () => void flushPending());

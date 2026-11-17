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

/** Send what was kept, oldest first; stop at the first that doesn't go through. */
export async function flushPending(): Promise<void> {
	if (flushing) return;
	flushing = true;
	try {
		let items = read();
		while (items.length) {
			let res: Response;
			try {
				res = await fetch(resolve('/api/reading'), {
					method: 'POST',
					body: items[0],
					headers: { 'content-type': 'application/json' }
				});
			} catch {
				return;
			}
			if (!res.ok && !refusedForGood(res.status)) return;
			items = items.slice(1);
			write(items);
		}
	} finally {
		flushing = false;
	}
}

if (typeof window !== 'undefined') addEventListener('online', () => void flushPending());

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
			// A 4xx (an entry since removed, a series hidden again) will never
			// succeed: drop it rather than block the rest behind it.
			if (!res.ok && res.status < 400) return;
			items = items.slice(1);
			write(items);
		}
	} finally {
		flushing = false;
	}
}

if (typeof window !== 'undefined') addEventListener('online', () => void flushPending());

/**
 * Highlights made offline (c842; doc/OFFLINE.md, "Writes that wait"). A highlight
 * that can't reach the workstation waits in this browser's IndexedDB, survives
 * the app being closed, and is sent at the next connection with no further
 * press: the app's layout starts the send, so it doesn't depend on a reader
 * being open. "Can't reach the workstation" is more than the device being
 * offline: the POST that comes back with nothing waits here too.
 *
 * **It keeps trying while anything waits**: a timer and a return-to-app listener
 * that exist only then, started by a press or by a pass that leaves something
 * behind, so nothing polls when nothing waits.
 *
 * **Nothing a reader must not leave behind is in here.** No item holds a title,
 * and a hidden series or reveal never queues (the reader's guard): a 404 is
 * hidden as well as gone, so a refusal can't say whose page it was.
 *
 * It is the first queued write that isn't reading progress, and it is built as
 * the mechanism rather than for one caller: an item names its own address and
 * body, so a page (H3) and a quote (H2) go through the same door, and a rating
 * or FAV could later. Nothing else uses it yet.
 *
 * **It sends once** by two things together. One row per [key] here, so two
 * presses are one item. And the workstation's answer to the same thing asked
 * again is the one already made (`keepPage`'s one highlight per page), which
 * is what makes a resend safe: a tab that dies between the POST and the
 * removal, a reload mid-send, and the same page kept on a second device all
 * reach it twice and leave one row.
 */

export type RefusedWhy = 'gone' | 'source' | 'refused';

export interface QueuedHighlight {
	/** One per highlight: `keepKey` for a page. */
	key: string;
	/** Where it goes and what it says, as the online press would have sent it. */
	url: string;
	body: Record<string, unknown>;
	entry: number;
	/** What the band calls it if it comes back refused: `P. 5`, and never the series. */
	label: string;
	at: number;
	tries: number;
	/** A source that failed isn't asked again before this (ms). */
	after?: number;
	/** Set when the workstation refused it: kept only until the reader has been told. */
	refused: RefusedWhy | null;
}

export type NewHighlight = Pick<QueuedHighlight, 'key' | 'url' | 'body' | 'entry' | 'label'>;

/** The little of IndexedDB the queue uses, so its rules can be tested without one. */
export interface QueueStore {
	all(): Promise<QueuedHighlight[]>;
	get(key: string): Promise<QueuedHighlight | undefined>;
	put(item: QueuedHighlight): Promise<void>;
	remove(key: string): Promise<void>;
}

/** A source that didn't send the page is asked again this many times, then told. */
export const SOURCE_TRIES = 3;
/** Between a source's tries, so the connection's timer doesn't spend them in a minute. */
export const SOURCE_WAIT_MS = 5 * 60_000;
/** How often a waiting item is tried: a workstation waking fires no event. */
export const RETRY_MS = 15_000;

/**
 * What an answer means for the item and the ones behind it.
 * - `sent`: done, remove it.
 * - `stop`: nothing can get through now; it and the rest wait for the next connection.
 *   A 403 is this: incognito is on at the moment, which says nothing of the item.
 * - `later`: this one's source failed; it waits, and the rest go on.
 * - `refused`: it will never go; kept to be told, and the rest go on.
 */
export type Arrival =
	{ do: 'sent' } | { do: 'stop' } | { do: 'later' } | { do: 'refused'; why: RefusedWhy };

export function arrival(status: number | null, tries: number): Arrival {
	if (status === null || status === 401 || status === 403) return { do: 'stop' };
	if (status >= 200 && status < 300) return { do: 'sent' };
	if (status === 502)
		return tries + 1 >= SOURCE_TRIES ? { do: 'refused', why: 'source' } : { do: 'later' };
	if (status === 404 || status === 410) return { do: 'refused', why: 'gone' };
	if (status >= 400 && status < 500) return { do: 'refused', why: 'refused' };
	return { do: 'stop' };
}

/** What the reader is told of one refused on arrival. */
export function refusedDetail(why: RefusedWhy): string {
	return why === 'gone'
		? 'ITS SERIES OR CHAPTER IS GONE'
		: why === 'source'
			? 'THE SOURCE DID NOT SEND IT'
			: 'THE WORKSTATION REFUSED IT';
}

const DB = 'tsundoku.highlights-queue';
const STORE = 'items';

function open(): Promise<IDBDatabase> {
	return new Promise((ok, no) => {
		const r = indexedDB.open(DB, 1);
		r.onupgradeneeded = () => r.result.createObjectStore(STORE, { keyPath: 'key' });
		r.onsuccess = () => ok(r.result);
		r.onerror = () => no(r.error);
	});
}

async function tx<T>(mode: IDBTransactionMode, run: (s: IDBObjectStore) => IDBRequest<T>) {
	const db = await open();
	try {
		return await new Promise<T>((ok, no) => {
			const t = db.transaction(STORE, mode);
			const r = run(t.objectStore(STORE));
			// The transaction's end, not the request's: a write isn't kept until then.
			t.oncomplete = () => ok(r.result);
			t.onabort = t.onerror = () => no(t.error);
		});
	} finally {
		db.close();
	}
}

const indexedStore: QueueStore = {
	all: () => tx('readonly', (s) => s.getAll() as IDBRequest<QueuedHighlight[]>),
	get: (key) => tx('readonly', (s) => s.get(key) as IDBRequest<QueuedHighlight | undefined>),
	put: async (item) => void (await tx('readwrite', (s) => s.put(item))),
	remove: async (key) => void (await tx('readwrite', (s) => s.delete(key)))
};

let store: QueueStore = indexedStore;
/** Tests only: the rules without a browser's IndexedDB, and none of the last case's trying. */
export function useQueueStore(s: QueueStore) {
	store = s;
	stopTrying();
	sending = false;
	again = false;
}

export type QueueChange = {
	sent: { item: QueuedHighlight; answer: unknown }[];
	/** Refused by this pass: told once, where what was refused before was told on opening. */
	refused: QueuedHighlight[];
};
const listeners = new Set<(c: QueueChange) => void>();
/** Told after anything changes; [sent] are the ones the workstation just took. */
export function onQueueChange(fn: (c: QueueChange) => void): () => void {
	listeners.add(fn);
	return () => listeners.delete(fn);
}
const changed = (sent: QueueChange['sent'] = [], refused: QueuedHighlight[] = []) =>
	listeners.forEach((fn) => fn({ sent, refused }));

let retry: ReturnType<typeof setTimeout> | undefined;
let listening = false;
/** Bumped by a press, so a pass ending with nothing left can't stop that press's timer. */
let presses = 0;

function onReturn() {
	if (document.visibilityState === 'visible') void flushHighlights();
}
function keepTrying() {
	retry ??= setTimeout(() => {
		retry = undefined;
		void flushHighlights();
	}, RETRY_MS);
	if (!listening && typeof document !== 'undefined') {
		document.addEventListener('visibilitychange', onReturn);
		listening = true;
	}
}
function stopTrying() {
	clearTimeout(retry);
	retry = undefined;
	if (listening) document.removeEventListener('visibilitychange', onReturn);
	listening = false;
}

/**
 * Waits on the device until the next connection. `false`: this browser won't
 * keep it (storage refused), and the press must say so. The same key twice is
 * the one item, so a second press changes nothing and asks nothing; but a page
 * refused and pressed again is a new request, and its row starts over.
 */
export async function queueHighlight(h: NewHighlight, now = Date.now()): Promise<boolean> {
	try {
		const had = await store.get(h.key);
		if (!had || had.refused) await store.put({ ...h, at: now, tries: 0, refused: null });
		presses++;
		keepTrying();
		changed();
		return true;
	} catch {
		return false;
	}
}

/** Taken back before it was sent. Nothing was asked of the workstation. */
export async function takeBackHighlight(key: string): Promise<void> {
	await store.remove(key).catch(() => undefined);
	changed();
}

async function everything(): Promise<QueuedHighlight[]> {
	try {
		return (await store.all()).sort((a, b) => a.at - b.at);
	} catch {
		return [];
	}
}

export const waitingHighlights = async () => (await everything()).filter((i) => !i.refused);
export const refusedHighlights = async () => (await everything()).filter((i) => i.refused);

/**
 * The reader has been told, or the page has been kept online since: a refused
 * one is gone for good. Only while it is still refused: a band left on screen
 * can be older than a press that made it wait again.
 */
export async function dismissRefused(keys: string[]): Promise<void> {
	for (const key of keys) {
		const item = await store.get(key).catch(() => undefined);
		if (item?.refused) await store.remove(key).catch(() => undefined);
	}
	changed();
}

async function sendAll(): Promise<void> {
	const sent: QueueChange['sent'] = [];
	const refused: QueuedHighlight[] = [];
	let moved = false;
	for (const item of await waitingHighlights()) {
		if (item.after && Date.now() < item.after) continue;
		// Taken back since the list was read.
		if (!(await store.get(item.key).catch(() => undefined))) continue;
		let status: number | null;
		let answer: unknown = null;
		try {
			const res = await fetch(item.url, {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify(item.body)
			});
			// A redirect to the sign-in page answers 200 with a page, not a highlight.
			status = res.redirected ? null : res.status;
			if (res.ok && !res.redirected) answer = await res.json().catch(() => null);
		} catch {
			status = null;
		}
		const a = arrival(status, item.tries);
		if (a.do === 'stop') break;
		moved = true;
		if (a.do === 'sent') {
			await store.remove(item.key).catch(() => undefined);
			sent.push({ item, answer });
			continue;
		}
		// DON'T SEND during the POST: writing the answer down would bring it back.
		if (!(await store.get(item.key).catch(() => undefined))) continue;
		if (a.do === 'later') {
			const after = Date.now() + SOURCE_WAIT_MS;
			await store.put({ ...item, tries: item.tries + 1, after }).catch(() => undefined);
		} else {
			const told = { ...item, refused: a.why };
			await store.put(told).catch(() => undefined);
			refused.push(told);
		}
	}
	if (moved) changed(sent, refused);
}

type Locks = {
	request(
		name: string,
		o: { ifAvailable: boolean },
		f: (lock: unknown) => Promise<void>
	): Promise<void>;
};
let sending = false;
/** A flush asked for during a pass: it may have found what that pass's list didn't. */
let again = false;

async function pass(): Promise<void> {
	const device = globalThis.navigator as { locks?: Locks; onLine?: boolean } | undefined;
	// Said to be offline: asking would only fail, and the timer is still there.
	if (device?.onLine === false) return;
	try {
		if (device?.locks)
			await device.locks.request(DB, { ifAvailable: true }, async (lock) => {
				// Another tab is sending: this one's timer comes back to it.
				if (lock) await sendAll();
			});
		else await sendAll();
	} catch {
		// Tried again by the timer, the next connection or the next open.
	}
}

/**
 * Send what waits, oldest first, one sender at a time: in this tab by a flag,
 * and across tabs by a lock where the browser has one (a plain-http address
 * doesn't), where the workstation's own one-per-highlight still holds. Whatever
 * is left when it ends keeps the trying going, and nothing left ends it.
 */
export async function flushHighlights(): Promise<void> {
	if (sending) {
		again = true;
		return;
	}
	sending = true;
	do {
		again = false;
		await pass();
	} while (again);
	sending = false;
	const pressed = presses;
	if ((await waitingHighlights()).length) keepTrying();
	else if (pressed === presses) stopTrying();
}

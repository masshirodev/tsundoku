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
 * or FAV could later.
 *
 * **It sends once** by two things together. One row per [key] here, so two
 * presses are one item. And the workstation's answer to the same thing asked
 * again is the one already made (`keepPage`'s one highlight per page), which
 * is what makes a resend safe: a tab that dies between the POST and the
 * removal, a reload mid-send, and the same page kept on a second device all
 * reach it twice and leave one row.
 */

import { mergeNotes } from '$lib/library/highlights';

export type RefusedWhy = 'gone' | 'source' | 'refused';

/**
 * A quote a press took in while it waited (c702's round 3), carried on the
 * press's item so a refusal of that press can put it back. The words are the
 * book's, so it lives only as long as the item that covers it.
 */
export interface CoveredHighlight {
	key: string;
	url: string;
	body: Record<string, unknown>;
	entry: number;
	label: string;
	/** What the reader changed while it waited (N7), carried to the item put back. */
	revised?: string[];
	/** A covered join's own covers, so a chain of joins keeps them all. */
	covers?: CoveredHighlight[];
}

export interface QueuedHighlight {
	/** One per highlight: `keepKey` for a page, `quoteKey` for a quote. */
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
	/** Which of the body's fields the reader changed while it waited (Novel N7). */
	revised?: string[];
	/** What this item took in as a join: put back if the join itself is refused (c702). */
	covers?: CoveredHighlight[];
}

/** A quote's item (H2), told from a page's by its key: each reader tells only its own. */
export const QUOTE_KEY_PREFIX = 'quote:';
export const isQuoteKey = (key: string) => key.startsWith(QUOTE_KEY_PREFIX);
export const quoteKey = (
	entry: number,
	block: number,
	offset: number,
	endBlock: number,
	endOffset: number
) => `${QUOTE_KEY_PREFIX}${entry}:${block}.${offset}-${endBlock}.${endOffset}`;

export type NewHighlight = Pick<QueuedHighlight, 'key' | 'url' | 'body' | 'entry' | 'label'> & {
	covers?: CoveredHighlight[];
	revised?: string[];
};

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
/**
 * Items a later press covers, and which incarnation of each: its key and the
 * `at` that names that very item. A take-back is not always "not wanted":
 * a selection joining a waiting quote removes it because the press that covers
 * it is sent by its own door (c702). The POST already out for the removed item
 * may still make a row, and the workstation folds that row into the covering
 * one, keeping its id — so a DELETE there would take the join, note and all.
 */
const superseded = new Map<string, number>();
/**
 * The item the queue last knew waiting under each key, kept past a take-back
 * that a covering press made (`supersedeHighlight` removes the item but what a
 * joining press needs to carry on is still here), and repopulated by every read
 * so a reload's press finds what the page before it queued. A take-back that
 * wants the item gone clears it.
 */
const remembered = new Map<string, QueuedHighlight>();
function remember(item: QueuedHighlight) {
	if (item.refused) remembered.delete(item.key);
	else remembered.set(item.key, item);
}
/** What the queue last knew under [key]: a joining press carries its fields on (c702). */
export function carriedBy(key: string): QueuedHighlight | undefined {
	return remembered.get(key);
}
/** Tests only: the rules without a browser's IndexedDB, and none of the last case's trying. */
export function useQueueStore(s: QueueStore) {
	store = s;
	stopTrying();
	sending = false;
	again = false;
	superseded.clear();
	remembered.clear();
	running.clear();
}

/** Tests only: which keys still carry a take-back record, so its clearing can be seen. */
export function supersededKeys(): string[] {
	return [...superseded.keys()];
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
 * One store mutation at a time per key (c702's round 2): `keepSpan` takes a
 * waiting quote back and then writes the press that covers it in the same
 * tick, without awaiting the first. Both read and write the one key, so a press
 * started before the take-back's removal is done would find the item it is
 * replacing, write nothing, and then be removed — the queue empty under
 * `WAITING TO BE SENT`. Chaining them keeps `inFlight.set` where it is (a
 * DELETE must find a press in flight synchronously) and holds nothing across a
 * POST, whose answer still reads the store while the next press waits.
 */
const running = new Map<string, Promise<unknown>>();
function serial<T>(key: string, run: () => Promise<T>): Promise<T> {
	const before = running.get(key) ?? Promise.resolve();
	const next = before.then(run, run);
	const done = next.catch(() => undefined);
	running.set(key, done);
	void done.then(() => {
		if (running.get(key) === done) running.delete(key);
	});
	return next;
}

/**
 * Waits on the device until the next connection. `false`: this browser won't
 * keep it (storage refused), and the press must say so. The same key twice is
 * the one item, so a second press changes nothing and asks nothing; but a page
 * refused and pressed again is a new request, and its row starts over.
 */
export function queueHighlight(h: NewHighlight, now = Date.now()): Promise<boolean> {
	return serial(h.key, async () => {
		try {
			const had = await store.get(h.key);
			if (!had || had.refused) {
				// This key now names this very item: a record left by an earlier
				// take-back is not about the POST it will have.
				superseded.delete(h.key);
				const item: QueuedHighlight = {
					...h,
					// Only what the caller says this press changed: a `remembered`
					// entry can outlive the item it was (a join sent, then its span
					// pressed afresh), and a fresh press must not inherit it.
					revised: h.revised,
					at: now,
					tries: 0,
					refused: null
				};
				await store.put(item);
				remember(item);
			} else remember(had);
			presses++;
			keepTrying();
			changed();
			return true;
		} catch {
			return false;
		}
	});
}

/**
 * A press that covers waiting items goes on the device, and only then do they
 * leave it (c702's round 4): a device that will not keep the press keeps what
 * it covers, so nothing waiting is lost to a refused write. `covered` are the
 * keys the press takes in; the press's own key among them is the exact re-press
 * of that item, which this write replaces whole (one `put`, so the item is never
 * absent) rather than finding it there and keeping the older one. `false`: the
 * press was not kept, and every covered item is still on the device.
 */
export async function queueCovering(
	h: NewHighlight,
	covered: string[],
	now = Date.now()
): Promise<boolean> {
	const kept = covered.includes(h.key)
		? await replaceHighlight(h, now)
		: await queueHighlight(h, now);
	if (!kept) return false;
	for (const key of covered) if (key !== h.key) await supersedeHighlight(key);
	return true;
}

/** [h] written over whatever waits under its key: the exact re-press's one write. */
function replaceHighlight(h: NewHighlight, now: number): Promise<boolean> {
	return serial(h.key, async () => {
		try {
			// The key names this press now; a record a take-back left is an older item's.
			superseded.delete(h.key);
			const item: QueuedHighlight = { ...h, revised: h.revised, at: now, tries: 0, refused: null };
			await store.put(item);
			remember(item);
			presses++;
			keepTrying();
			changed();
			return true;
		} catch {
			return false;
		}
	});
}

/**
 * A change to something still waiting (Novel N7: its note and colour can be
 * changed before it goes): the item's body, merged. Nothing is told to the
 * workstation, since it hasn't heard of the highlight yet. `false`: nothing
 * took the change (it was sent in the moment, or storage refused), so the
 * caller doesn't claim it.
 */
export function reviseHighlight(key: string, patch: Record<string, unknown>): Promise<boolean> {
	return serial(key, async () => {
		const had = await store.get(key).catch(() => undefined);
		if (!had || had.refused) return false;
		const revised = [...new Set([...(had.revised ?? []), ...Object.keys(patch)])];
		return store.put({ ...had, body: { ...had.body, ...patch }, revised }).then(
			() => {
				remember({ ...had, body: { ...had.body, ...patch }, revised });
				return true;
			},
			() => false
		);
	});
}

/**
 * Taken back before it was sent, and not wanted. Nothing was asked of the
 * workstation. Hands back the item it removed: an UNDO has to restore what the
 * DELETE took, covers and `revised` included (c702), not a body rebuilt from
 * the page, which cannot say what waited inside it.
 */
export function takeBackHighlight(key: string): Promise<QueuedHighlight | undefined> {
	return serial(key, async () => {
		const item = await store.get(key).catch(() => undefined);
		await store.remove(key).catch(() => undefined);
		remembered.delete(key);
		changed();
		return item;
	});
}

/**
 * Taken back because a later press covers it: a selection joined a quote still
 * waiting on the device. Nothing is owed to the workstation for this item, and
 * a POST already on its way must not DELETE what it made (`landed`).
 */
export function supersedeHighlight(key: string): Promise<void> {
	return serial(key, async () => {
		const item = await store.get(key).catch(() => undefined);
		if (item) {
			superseded.set(key, item.at);
			// What it was waits here for the press that covers it: that press puts
			// it on its own item and hands it back if the press is refused.
			remember(item);
		}
		await store.remove(key).catch(() => undefined);
		changed();
	});
}

async function everything(): Promise<QueuedHighlight[]> {
	try {
		const list = (await store.all()).sort((a, b) => a.at - b.at);
		for (const item of list) remember(item);
		return list;
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
		await serial(key, async () => {
			const item = await store.get(key).catch(() => undefined);
			if (item?.refused) {
				await store.remove(key).catch(() => undefined);
				remembered.delete(key);
			}
		});
	}
	changed();
}

type RowAnswer = {
	highlight?: { id?: number; note?: string; colour?: string };
	made?: boolean;
};

/** A highlight's own address, beside the door that made it: `/api/highlights/<id>`. */
const rowUrl = (item: QueuedHighlight, id: number) => item.url.replace(/\/[^/]*$/, `/${id}`);

/**
 * What the reader changed that the answer doesn't say (a note typed during the
 * POST, a colour chosen for a row that was already there): the row's fields
 * to set. A note the POST itself wrote is replaced, since that's still the
 * reader's draft; a note the row had first is merged with it, as the door would.
 */
function unsaid(
	posted: QueuedHighlight,
	latest: QueuedHighlight,
	row: NonNullable<RowAnswer['highlight']>
): Record<string, string> {
	const was = posted.body as { note?: string };
	const now = latest.body as { note?: string; colour?: string };
	const patch: Record<string, string> = {};
	if (latest.revised?.includes('colour') && now.colour && now.colour !== row.colour)
		patch.colour = now.colour;
	if (typeof now.note === 'string' && now.note !== was.note) {
		const had = row.note ?? '';
		const note = had === (was.note ?? '').trim() ? now.note : mergeNotes(had, now.note);
		if (note.trim() !== had) patch.note = note.trim();
	}
	return patch;
}

/** A POST that landed but whose item stays or has gone: nothing to tell the reader yet. */
const NOT_DONE = Symbol('not done');

/**
 * The answer to a POST that landed, with whatever was revised while it was out
 * sent after it. `NOT_DONE`: a change couldn't be sent, so the item goes on
 * waiting and the next pass carries it; or it was taken back meanwhile, and
 * what the press made has been set aside again. (`null` is a real answer: a
 * body that wasn't JSON, from a door that kept the highlight.)
 */
async function landed(item: QueuedHighlight, answer: unknown): Promise<unknown> {
	const a = answer as RowAnswer | null;
	const id = a?.highlight?.id;
	let posted = item;
	let row = a?.highlight;
	// Bounded: each round needs the reader to have typed during the last PATCH.
	for (let round = 0; round < 4; round++) {
		const latest = await store.get(item.key).catch(() => undefined);
		if (!latest) {
			// The item went while its POST was out. Two meanings, and only one of
			// them is a DELETE: DON'T SEND or DELETE takes back what this POST made
			// (`made: true`), while a press covering it (`supersedeHighlight`) has
			// had this row folded into the covering one, whose id it kept.
			const covered = superseded.get(item.key) === item.at;
			superseded.delete(item.key);
			if (!covered && id && a?.made)
				await fetch(rowUrl(item, id), { method: 'DELETE' }).catch(() => undefined);
			return NOT_DONE;
		}
		// The item is here: whatever a record said of this key is an older item's.
		superseded.delete(item.key);
		if (!id || !row) return answer;
		const patch = unsaid(posted, latest, row);
		if (Object.keys(patch).length === 0) break;
		const ok = await fetch(rowUrl(item, id), {
			method: 'PATCH',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify(patch)
		}).then(
			(r) => r.ok,
			() => false
		);
		if (!ok) return NOT_DONE;
		posted = latest;
		row = { ...row, ...patch };
	}
	return { ...a, highlight: row };
}

async function sendAll(): Promise<void> {
	const refused: QueuedHighlight[] = [];
	let moved = false;
	for (const listed of await waitingHighlights()) {
		if (listed.after && Date.now() < listed.after) continue;
		// Read again: taken back or revised since the list was.
		const item = await store.get(listed.key).catch(() => undefined);
		if (!item || item.refused) continue;
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
		if (a.do === 'stop') {
			// A taken-back item is gone, and nothing will ever read its record: this
			// POST's own end is the last chance to clear it.
			superseded.delete(item.key);
			break;
		}
		moved = true;
		if (a.do === 'sent') {
			const told = await landed(item, answer);
			if (told === NOT_DONE) continue;
			await store.remove(item.key).catch(() => undefined);
			remembered.delete(item.key);
			// At once and not at the pass's end: the reader's copy stops being `waiting`
			// the moment its row in the store does, so a late note finds the real row.
			changed([{ item, answer: told }]);
			continue;
		}
		// DON'T SEND during the POST: writing the answer down would bring it back.
		const latest = await store.get(item.key).catch(() => undefined);
		if (!latest) {
			superseded.delete(item.key);
			remembered.delete(item.key);
			continue;
		}
		if (a.do === 'later') {
			const after = Date.now() + SOURCE_WAIT_MS;
			const later: QueuedHighlight = { ...latest, tries: latest.tries + 1, after };
			await store.put(later).catch(() => undefined);
			remember(later);
		} else {
			// A join covers the waiting quotes it took in (c702's round 3): a
			// refusal of the join must not lose them, notes included. Put each
			// back as `queueHighlight` would (which clears the record its
			// take-back left) before the join is stored refused. A cover under
			// the item's own key is the press itself, not something it covers.
			for (const c of latest.covers ?? []) {
				if (c.key === item.key) continue;
				await queueHighlight(c).catch(() => false);
			}
			// Nothing to resend, and a quote's body is the book's words: gone with the refusal.
			const told: QueuedHighlight = {
				...latest,
				body: {},
				covers: undefined,
				revised: undefined,
				refused: a.why
			};
			await store.put(told).catch(() => undefined);
			remembered.delete(item.key);
			refused.push(told);
		}
	}
	if (moved) changed([], refused);
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

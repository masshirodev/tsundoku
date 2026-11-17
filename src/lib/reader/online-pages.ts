import { SvelteMap } from 'svelte/reactivity';

/**
 * The pages of a chapter read online, held in memory near the page being read
 * (c1038; doc/READING-ONLINE.md, "Manga online").
 *
 * An online page is answered `private, no-store`, so the browser keeps nothing
 * it can hand a new `<img>`: a turn mounts a fresh element for the page turned
 * to, and the browser asked the workstation for it again, which asked the
 * engine, which asked the source. Holding a preloaded `Image` does not help:
 * measured in Chromium (c1038), a no-store image held that way was fetched
 * again by the next element anyway, forward turns included, whenever garbage
 * collection had run. So the reader holds the bytes itself: each page near the
 * one being read is fetched once, kept as a Blob behind an object URL, and the
 * page draws from that.
 *
 * Nothing is written anywhere (the owner's answer to question 4 still holds):
 * a Blob lives in this tab's memory, at most `ONLINE_HELD` of them, the oldest
 * let go as new ones come, and all of them when the reader is left.
 *
 * Module-level on purpose: moving on to the next chapter is a navigation from
 * /read to /read, which rebuilds the reader, and the next chapter's first pages
 * fetched near the end of this one should still be here when it opens.
 */

/** How many pages are held: the screens around the page being read, the next chapter's first two, and some slack for turning back. */
export const ONLINE_HELD = 12;

/** Where a page stands: being fetched, ready to draw from `url`, or refused by the source. */
export type Held = { state: 'pending' } | { state: 'ready'; url: string } | { state: 'failed' };

/** A version the server named as read online (src/lib/server/pages/online.ts, `onlineManifest`). */
export const isOnlineVersion = (v: string | null | undefined) => !!v && v.startsWith('online-');

type Deps = {
	fetch: (url: string, init: { signal: AbortSignal }) => Promise<Response>;
	createUrl: (blob: Blob) => string;
	revokeUrl: (url: string) => void;
	/** Decodes a ready page ahead of its turn and keeps it decoded; returns what to let go with it. */
	decode?: (url: string) => unknown;
	/** Runs the release check after the current navigation has mounted the next reader. */
	later: (fn: () => void) => void;
	max: number;
};

export function onlinePages(deps: Partial<Deps> = {}) {
	const d: Deps = {
		fetch: (url, init) => fetch(url, init),
		createUrl: (b) => URL.createObjectURL(b),
		revokeUrl: (u) => URL.revokeObjectURL(u),
		later: (fn) => setTimeout(fn, 0),
		...deps,
		// An option given as undefined is the default, not "no limit".
		max: deps.max ?? ONLINE_HELD
	};
	// Insertion order is age: `touch` moves a page to the newest end.
	const held = new SvelteMap<string, Held>();
	const work = new Map<string, AbortController>();
	const decoded = new Map<string, unknown>();
	let holders = 0;

	function drop(src: string) {
		const h = held.get(src);
		if (h?.state === 'ready') d.revokeUrl(h.url);
		work.get(src)?.abort();
		work.delete(src);
		decoded.delete(src);
		held.delete(src);
	}

	function touch(src: string) {
		const h = held.get(src);
		if (!h) return;
		held.delete(src);
		held.set(src, h);
	}

	function start(src: string) {
		const ac = new AbortController();
		work.set(src, ac);
		held.set(src, { state: 'pending' });
		// Only the fetch that is still this page's may write: a dropped or
		// retried page's late answer is let go.
		const mine = () => work.get(src) === ac;
		d.fetch(src, { signal: ac.signal })
			.then((r) => {
				if (!r.ok) throw new Error(`page ${r.status}`);
				return r.blob();
			})
			.then((blob) => {
				if (!mine()) return;
				work.delete(src);
				const url = d.createUrl(blob);
				held.set(src, { state: 'ready', url });
				if (d.decode) decoded.set(src, d.decode(url));
			})
			.catch(() => {
				if (!mine()) return;
				work.delete(src);
				held.set(src, { state: 'failed' });
			});
	}

	function want(src: string, again: boolean) {
		const h = held.get(src);
		if (h && !(again && h.state === 'failed')) return touch(src);
		if (h) drop(src);
		start(src);
	}

	return {
		/** The page's state, read reactively; `undefined` until it is asked for. */
		get: (src: string): Held | undefined => held.get(src),
		/**
		 * Holds the pages on screen and the ones a turn reaches next. A page on
		 * screen that the source refused while it was only near is asked again
		 * (a preload's failure may be passing); one near is not, so a source that
		 * is down isn't asked on every turn. Pages on screen are wanted last, so
		 * they are the newest and the last to be let go.
		 */
		keep(onScreen: string[], near: string[] = []) {
			for (const s of near) if (!onScreen.includes(s)) want(s, false);
			for (const s of onScreen) want(s, true);
			for (const s of [...held.keys()]) {
				if (held.size <= d.max) break;
				if (!onScreen.includes(s)) drop(s);
			}
		},
		/** RETRY on a page the source refused. */
		retry(src: string) {
			drop(src);
			start(src);
		},
		/**
		 * A reader holds the pages while it is mounted. Its release lets them
		 * all go unless another reader has mounted by then: a chapter change
		 * mounts the next one in the same navigation.
		 */
		hold(): () => void {
			holders += 1;
			let released = false;
			return () => {
				if (released) return;
				released = true;
				holders -= 1;
				d.later(() => {
					if (holders === 0) for (const s of [...held.keys()]) drop(s);
				});
			};
		},
		/** For tests: how many are held. */
		get size() {
			return held.size;
		}
	};
}

/** Decodes a page off the main path and keeps the element, so the image stays decoded for its turn. */
function decodeImage(url: string) {
	const img = new Image();
	img.decoding = 'async';
	img.src = url;
	void img.decode?.().catch(() => undefined);
	return img;
}

/** The one the image reader uses. Only touched in the browser: the reader asks it from effects. */
export const onlineHeld = onlinePages({ decode: decodeImage });

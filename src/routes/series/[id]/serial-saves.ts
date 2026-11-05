/**
 * One save in flight per field, the last tap's value winning (c566,
 * doc/SERIES.md, "FAV and the rating").
 *
 * The series screen shows a tap at once and saves behind it. Two quick taps
 * used to post together, so the server could store them in either order, and
 * the first answer's reload put the stored value back over the second tap
 * (`series-flow`'s "rating fills up…", red under load in wave 24). Here a
 * tap's save waits for the one before it on the same key, and each answer
 * says whether a newer tap is queued behind it: a superseded save leaves the
 * reload, and any failure band, to the newest.
 *
 * A latest turn's reload is part of its turn (round 2): the next save on the
 * key waits until that turn has settled, not merely answered, so a tap made
 * during the reload posts only once the reload has landed, and is judged
 * against the value it brought (what is stored, PUT BACK's label). A save
 * whose turn comes after a newer tap is queued is not sent at all: only the
 * last value matters, and sending each one would make N taps N round trips.
 */
export type Turn = {
	/** The save went through. */
	ok: boolean;
	/** No newer tap on this key was queued while it waited or ran. */
	latest: boolean;
	/**
	 * An earlier save on this key, superseded since, went through: the stored
	 * value is no longer the one the page last loaded, so a failure band must
	 * reload before it names what PUT BACK would put back.
	 */
	earlierStored: boolean;
	/**
	 * A tap on this key came after this one (asked at any time, so a latest
	 * turn can ask after its reload whether a tap came during it). Never
	 * `pending()`: an older turn still reloading is pending too, and is not
	 * newer.
	 */
	newer: () => boolean;
};

type Chain = {
	/** Resolves once the last queued turn lets the next one go. */
	tail: Promise<unknown>;
	taps: number;
	running: number;
	stored: boolean;
	/** Lets the next save go: set while a latest turn is answered and not yet settled. */
	held: (() => void) | null;
	/** The last turn has let the next one go (or there was none): a new save is sent at once. */
	idle: boolean;
};

/** A save that throws is a save that did not go through; it never stops the queue. */
function attempt(save: () => Promise<boolean>): Promise<boolean> {
	try {
		return save().catch(() => false);
	} catch {
		return Promise.resolve(false);
	}
}

export class SerialSaves {
	#chains = new Map<string, Chain>();

	/**
	 * Queue `save` behind this key's earlier saves: it runs once each earlier
	 * one has answered, and a latest one has settled. Superseded by then, it is
	 * not sent, and answers as a superseded save that did not go through.
	 */
	run(key: string, save: () => Promise<boolean>): Promise<Turn> {
		let c = this.#chains.get(key);
		if (!c) {
			c = { tail: Promise.resolve(), taps: 0, running: 0, stored: false, held: null, idle: true };
			this.#chains.set(key, c);
		}
		const chain = c;
		const tap = ++chain.taps;
		chain.running++;
		const newer = () => {
			const now = this.#chains.get(key);
			return chain.taps > tap || (now !== undefined && now !== chain);
		};
		let open!: () => void;
		const gate = new Promise<void>((r) => (open = r));
		const release = () => {
			open();
			if (chain.tail === gate) chain.idle = true;
		};
		// Nothing ahead of it: sent now, in the tap's own task. Waiting even a
		// microtask would let a second tap of the same event loop turn count as
		// newer, and the first would never be sent.
		const sent = chain.idle
			? attempt(save)
			: chain.tail.then(() => (newer() ? false : attempt(save)));
		chain.idle = false;
		chain.tail = gate;
		return sent.then((ok) => {
			const latest = !newer();
			const earlierStored = chain.stored;
			if (latest) {
				chain.stored = false;
				// The next save waits for this turn's `settle`, its reload included.
				chain.held = release;
			} else {
				if (ok) chain.stored = true;
				release();
				this.#done(key, chain);
			}
			return { ok, latest, earlierStored, newer };
		});
	}

	/**
	 * Say a `latest` turn has finished, its reload or its band included: call
	 * it once for each such turn, in a `finally`, so a reload that throws
	 * still lets the queue go (a superseded one settles itself). Until then
	 * the key is pending, the page keeps its local value over the stored one,
	 * and the next save on the key waits.
	 */
	settle(key: string): void {
		const c = this.#chains.get(key);
		if (!c) return;
		const release = c.held;
		c.held = null;
		release?.();
		this.#done(key, c);
	}

	#done(key: string, c: Chain) {
		c.running--;
		if (c.running <= 0 && this.#chains.get(key) === c) this.#chains.delete(key);
	}

	/** A save on `key` is queued, running, or answered and awaiting its reload. */
	pending(key: string): boolean {
		return (this.#chains.get(key)?.running ?? 0) > 0;
	}
}

/**
 * The series screen's queue. One for the whole app, not one per panel: a
 * panel mounted again (out to the library and back within a slow save) must
 * still wait for the save the last one started. Only ever run from a tap, so
 * the server's copy of this module never holds anything.
 */
export const seriesSaves = new SerialSaves();

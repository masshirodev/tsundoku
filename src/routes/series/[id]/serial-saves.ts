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
};

type Chain = { tail: Promise<unknown>; taps: number; running: number; stored: boolean };

export class SerialSaves {
	#chains = new Map<string, Chain>();

	/** Queue `save` behind this key's earlier saves; it runs once they have answered. */
	run(key: string, save: () => Promise<boolean>): Promise<Turn> {
		let c = this.#chains.get(key);
		if (!c) {
			c = { tail: Promise.resolve(), taps: 0, running: 0, stored: false };
			this.#chains.set(key, c);
		}
		const chain = c;
		const tap = ++chain.taps;
		chain.running++;
		// A save that throws is a save that did not go through; it never stops the queue.
		const sent = chain.tail.then(() => save().catch(() => false));
		chain.tail = sent;
		return sent.then((ok) => {
			const latest = tap === chain.taps;
			const earlierStored = chain.stored;
			if (latest) chain.stored = false;
			else {
				if (ok) chain.stored = true;
				this.#done(key, chain);
			}
			return { ok, latest, earlierStored };
		});
	}

	/**
	 * Say a `latest` turn has finished, its reload or its band included: call
	 * it once for each such turn (a superseded one settles itself). Until then
	 * the key is pending, and the page keeps its local value over the stored
	 * one.
	 */
	settle(key: string): void {
		const c = this.#chains.get(key);
		if (c) this.#done(key, c);
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

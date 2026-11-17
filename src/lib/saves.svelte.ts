/**
 * Writes that failed (doc/WAITING.md). A write shows its result at once and
 * saves behind it. When the save doesn't go through, the new value stays --
 * drawn dashed, "not stored yet" -- and a band offers RETRY and PUT BACK. It
 * also tries again by itself with the next request that reaches the
 * workstation. The value only changes back when asked to.
 *
 * Failures are held per save, so a second one never takes the first one's
 * way back. They live here, not on a page, so they outlive the
 * screen that raised them.
 */
export type FailedSave = {
	/** What the band says: "RATING 4 NOT SAVED". */
	what: string;
	/** The value it would go back to: "PUT BACK 3". */
	putBackLabel: string;
	/** Which control shows it dashed: `rating:<series>`, `fav:<series>`. */
	key: string;
	retry: () => Promise<boolean>;
	putBack: () => void;
};

class Saves {
	/**
	 * Oldest first, one per `key`. `$state.raw`: each change replaces the list,
	 * so a failure stays the object `fail` was given, and "is this still the
	 * failure I retried?" can be asked by identity.
	 */
	failed = $state.raw<FailedSave[]>([]);

	/** Failures whose retry is out, so a nudge or a second tap does not double it. */
	#out = new Set<FailedSave>();

	fail(f: FailedSave) {
		this.failed = [...this.failed.filter((x) => x.key !== f.key), f];
	}

	/** The control `key` holds a value that isn't stored. */
	unsaved(key: string): boolean {
		return this.failed.some((x) => x.key === key);
	}

	async retry(key: string) {
		const f = this.failed.find((x) => x.key === key);
		if (!f || this.#out.has(f)) return;
		this.#out.add(f);
		try {
			// Only this failure: by the time it lands the list may hold others,
			// or a newer failure of this same key, which still has its own say.
			if (await f.retry()) this.failed = this.failed.filter((x) => x !== f);
		} finally {
			this.#out.delete(f);
		}
	}

	putBack(key: string) {
		const f = this.failed.find((x) => x.key === key);
		if (!f) return;
		f.putBack();
		this.failed = this.failed.filter((x) => x !== f);
	}

	/** Something reached the workstation: try each failed save again, once. */
	nudge() {
		for (const f of this.failed) void this.retry(f.key);
	}

	/** Its control saved something newer: this failure no longer matters. */
	clear(key: string) {
		this.failed = this.failed.filter((x) => x.key !== key);
	}
}

export const saves = new Saves();

/**
 * POST a form action and say whether it was stored. A network failure, a
 * 5xx or an action's `fail()` are all "not stored".
 */
export async function postAction(url: string, fields: Record<string, string>): Promise<boolean> {
	const body = new FormData();
	for (const [k, v] of Object.entries(fields)) body.set(k, v);
	try {
		const res = await fetch(url, {
			method: 'POST',
			body,
			headers: { 'x-sveltekit-action': 'true' }
		});
		if (!res.ok) return false;
		const json = (await res.json()) as { type?: string };
		return json.type === 'success';
	} catch {
		return false;
	}
}

/**
 * Writes that failed (Loading States 1o; doc/WAITING.md). A write shows its
 * result at once and saves behind it. When the save doesn't go through, the
 * new value stays -- drawn dashed, Index's "not stored yet" -- and a band
 * offers RETRY and PUT BACK. It also tries again by itself with the next
 * request that reaches the workstation. The value only changes back if the
 * owner asks.
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
	failed = $state<FailedSave | null>(null);

	fail(f: FailedSave) {
		this.failed = f;
	}

	/** The control `key` holds a value that isn't stored. */
	unsaved(key: string): boolean {
		return this.failed?.key === key;
	}

	async retry() {
		const f = this.failed;
		if (!f) return;
		if (await f.retry()) this.failed = null;
	}

	putBack() {
		this.failed?.putBack();
		this.failed = null;
	}

	/** Something reached the workstation: try the failed save again, once. */
	nudge() {
		if (this.failed) void this.retry();
	}

	/** Its control saved something newer: this failure no longer matters. */
	clear(key: string) {
		if (this.failed?.key === key) this.failed = null;
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

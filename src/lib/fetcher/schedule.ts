// Keeping concurrent requests' session rules apart.
//
// Every request gets its own rule, and a rule id must be unique among the
// session's rules or the browser refuses to add it. Ids are handed out from
// the ones not in use and given back when the request ends, so they stay
// small however long the browser runs.
//
// Two requests in flight to the same URL with the same method would each
// match the other's rule, and which rule's headers win is not defined. So
// those run one after another; requests to anything else run at once.

export class RuleIds {
	private readonly used = new Set<number>();

	/** The smallest id not in use. */
	take(): number {
		let id = 1;
		while (this.used.has(id)) id++;
		this.used.add(id);
		return id;
	}

	release(id: number): void {
		this.used.delete(id);
	}

	get inUse(): number {
		return this.used.size;
	}
}

export class KeyedQueue {
	private readonly tails = new Map<string, Promise<unknown>>();

	/** Runs `task` after every earlier task with the same key has settled. */
	run<T>(key: string, task: () => Promise<T>): Promise<T> {
		const before = this.tails.get(key) ?? Promise.resolve();
		const result = before.then(task, task);
		const tail = result.then(
			() => undefined,
			() => undefined
		);
		this.tails.set(key, tail);
		// The last task for a key removes the key, so the map holds only keys
		// with work pending.
		void tail.then(() => {
			if (this.tails.get(key) === tail) this.tails.delete(key);
		});
		return result;
	}

	get pending(): number {
		return this.tails.size;
	}
}

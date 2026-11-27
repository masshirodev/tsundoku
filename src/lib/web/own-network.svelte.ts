// What tsundoku's screens know of refusals of the reader's own network
// (c1156), read from where the relaying tab recorded them
// (src/lib/web/refusals.ts), and the ALLOW action that asks the fetcher.
import { connectFetcher, type AllowAnswer } from './fetcher-client.ts';
import { forgetRefusals, proxySuspect, readRefusals, refusalIn, type Refused } from './refusals.ts';

/** The refusals remembered, kept fresh as any tab records more. */
class OwnNetwork {
	list = $state<Refused[]>([]);

	constructor() {
		if (typeof window === 'undefined') return;
		const read = () => (this.list = readRefusals(localStorage, Date.now()));
		read();
		addEventListener('storage', (event) => {
			if (event.key === null || event.key === 'tsundoku:refusals') read();
		});
		addEventListener('tsundoku:refused', read);
	}

	/** The refusal whose sentence [error] shows, if any. */
	in(error: string | null | undefined): Refused | null {
		return error ? refusalIn(error, this.list) : null;
	}

	/** The reader allowed [host]: what it was refused is no longer offered. */
	forget(host: string) {
		forgetRefusals(localStorage, host, Date.now());
		this.list = readRefusals(localStorage, Date.now());
	}

	/** A proxy on the reader's network, when two or more sites answered from one address. */
	get proxy() {
		return proxySuspect(this.list);
	}
}

export const ownNetwork = new OwnNetwork();

/**
 * Asks the fetcher, from a press, to have the reader allow [host] on [port]
 * (or every port without one). Connects afresh: any tab of tsundoku's has the
 * content script, whichever tab relayed the refused request.
 */
export async function askToAllow(host: string, port?: string): Promise<AllowAnswer | 'no-fetcher'> {
	const connection = await connectFetcher(window, { timeoutMs: 3000 });
	if (connection.state !== 'ready') return 'no-fetcher';
	try {
		return await connection.fetcher.allow(host, port);
	} finally {
		connection.fetcher.close();
	}
}

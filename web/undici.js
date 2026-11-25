// undici, Node's HTTP client, for the web edition's server worker
// (doc/WEB-EDITION.md). The browser has fetch of its own. tsundoku takes one
// thing from undici, the Agent that src/lib/server/net-guard.ts gives fetch so
// a server cannot be steered at private addresses; in a tab the "server" is the
// reader's own browser, whose own rules govern private addresses, and the
// browser's fetch ignores a dispatcher. So the Agent is kept as a name only.
export class Agent {
	constructor(options = {}) {
		this.options = options;
	}
	close() {
		return Promise.resolve();
	}
	destroy() {
		return Promise.resolve();
	}
}
export const fetch = (...a) => globalThis.fetch(...a);
export default { Agent, fetch };

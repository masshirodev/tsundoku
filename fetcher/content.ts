// The fetcher's content script, on tsundoku's own pages only (the manifest's
// matches, and startRelay checks the origin again): relays the page's requests
// to the background (src/lib/fetcher/relay.ts).
import { startRelay } from '../src/lib/fetcher/relay.ts';
import type { RuntimeReply } from '../src/lib/fetcher/service.ts';

const api = typeof browser === 'undefined' ? chrome : browser;

startRelay({
	win: window,
	send: (message) => api.runtime.sendMessage(message) as Promise<RuntimeReply | undefined>,
	version: api.runtime.getManifest().version,
	edition: __FETCHER_EDITION__
});

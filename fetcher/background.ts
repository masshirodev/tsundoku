// The fetcher's background (a service worker in Chromium, an event page in
// Firefox): hands the browser's APIs to the service, which does the work
// (src/lib/fetcher/service.ts).
import list from '../src/lib/fetcher/public_suffix_list.dat?raw';
import { siteAccessFrom } from '../src/lib/fetcher/protocol.ts';
import { parseSuffixList, type SuffixRules } from '../src/lib/fetcher/psl.ts';
import { createFetcherService } from '../src/lib/fetcher/service.ts';

const api = typeof browser === 'undefined' ? chrome : browser;

// Parsed on the first request, not on every wake of the background.
let suffixes: SuffixRules | undefined;

const service = createFetcherService({
	extensionId: api.runtime.id,
	edition: __FETCHER_EDITION__,
	async siteAccess() {
		const all = await api.permissions.contains({ origins: ['<all_urls>'] });
		const { origins = [] } = await api.permissions.getAll();
		return siteAccessFrom(all, origins, __FETCHER_EDITION__);
	},
	suffixes: () => (suffixes ??= parseSuffixList(list)),
	getCookies: (query) => api.cookies.getAll(query),
	addRule: (rule) => api.declarativeNetRequest.updateSessionRules({ addRules: [rule] }),
	removeRule: (id) => api.declarativeNetRequest.updateSessionRules({ removeRuleIds: [id] }),
	async clearRules() {
		const rules = await api.declarativeNetRequest.getSessionRules();
		if (rules.length) {
			await api.declarativeNetRequest.updateSessionRules({ removeRuleIds: rules.map((r) => r.id) });
		}
	},
	fetch: (url, init) => fetch(url, init)
});

api.runtime.onMessage.addListener((message, sender, sendResponse) => {
	const reply = service.answer(message, sender);
	if (!reply) return false;
	void reply.then(sendResponse);
	// Keeps the channel open for the asynchronous answer, in both browsers.
	return true;
});

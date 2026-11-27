// The fetcher's background (a service worker in Chromium, an event page in
// Firefox): hands the browser's APIs to the service, which does the work
// (src/lib/fetcher/service.ts).
import list from '../src/lib/fetcher/public_suffix_list.dat?raw';
import { siteAccessFrom } from '../src/lib/fetcher/protocol.ts';
import { parseSuffixList, type SuffixRules } from '../src/lib/fetcher/psl.ts';
import { ALLOWED_META_KEY, readMeta } from '../src/lib/fetcher/options.ts';
import { ALLOWED_HOSTS_KEY, readAllowedHosts } from '../src/lib/fetcher/reach.ts';
import { createFetcherService } from '../src/lib/fetcher/service.ts';
import type { RequestEvent } from '../src/lib/fetcher/watch.ts';

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
	replaceRules: (removeRuleIds, addRules) =>
		api.declarativeNetRequest.updateSessionRules({ removeRuleIds, addRules }),
	allowedHosts: async () => readAllowedHosts(await api.storage.local.get(ALLOWED_HOSTS_KEY)),
	async saveAllowedHosts(hosts, asked) {
		const meta = readMeta(await api.storage.local.get(ALLOWED_META_KEY));
		meta[asked] = { via: 'asked', at: Date.now() };
		await api.storage.local.set({ [ALLOWED_HOSTS_KEY]: hosts, [ALLOWED_META_KEY]: meta });
	},
	ownBase: api.runtime.getURL(''),
	// The confirmation window: a small window of its own where there are
	// windows, a tab on Firefox for Android, which has none.
	async openAsk(id) {
		const url = api.runtime.getURL(`confirm.html?ask=${encodeURIComponent(id)}`);
		if (api.windows) {
			const made = await api.windows.create({
				url,
				type: 'popup',
				width: 440,
				height: 460,
				focused: true
			});
			if (made.id === undefined) throw new Error('no window');
			return made.id;
		}
		const tab = await api.tabs.create({ url, active: true });
		if (tab.id === undefined) throw new Error('no tab');
		return tab.id;
	},
	async focusWindow(id) {
		await (api.windows
			? api.windows.update(id, { focused: true })
			: api.tabs.update(id, { active: true }));
	},
	closeWindow: (id) => (api.windows ? api.windows.remove(id) : api.tabs.remove(id)),
	// Firefox lets an extension resolve a name before a request is sent;
	// Chromium has no such call, and its check comes after (reach.ts).
	resolve: api.dns ? async (host) => (await api.dns!.resolve(host)).addresses : undefined,
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

// The fetcher's own requests as the browser makes them: every redirect hop,
// and the address each one connected to (src/lib/fetcher/watch.ts). Only
// requests outside every tab, which is where an extension's own are.
// Firefox's extension origin is a per-install UUID, not the id, so it is asked for.
const own = new URL(api.runtime.getURL('')).origin;
function asEvent(details: WebExtRequestDetails): RequestEvent {
	const from = details.initiator ?? details.originUrl ?? '';
	return {
		requestId: details.requestId,
		url: details.url,
		method: details.method,
		tabId: details.tabId,
		fromExtension: from === own || from.startsWith(`${own}/`),
		ip: details.ip,
		redirectUrl: details.redirectUrl,
		proxied: Boolean(details.proxyInfo)
	};
}
const filter = { urls: ['<all_urls>'], tabId: -1 };
api.webRequest.onBeforeRequest.addListener(
	(details) => {
		const answer = service.requestStarted(asEvent(details));
		// Firefox waits on the answer and may cancel; Chromium only observes.
		return api.dns ? answer : undefined;
	},
	filter,
	api.dns ? ['blocking'] : []
);
api.webRequest.onBeforeRedirect.addListener((d) => service.requestConnected(asEvent(d)), filter);
api.webRequest.onResponseStarted.addListener((d) => service.requestConnected(asEvent(d)), filter);
api.webRequest.onCompleted.addListener((d) => service.requestFinished(asEvent(d)), filter);
api.webRequest.onErrorOccurred.addListener((d) => service.requestFinished(asEvent(d)), filter);

// The reader changed the allowed hosts in the fetcher's options.
api.storage.onChanged.addListener((changes, area) => {
	if (area === 'local' && ALLOWED_HOSTS_KEY in changes) {
		void service.setAllowedHosts(
			readAllowedHosts({ [ALLOWED_HOSTS_KEY]: changes[ALLOWED_HOSTS_KEY].newValue })
		);
	}
});

// The confirmation window closing unanswered is a CANCEL; a tab that loads
// a new page may ask again about a host it cancelled (src/lib/fetcher/asks.ts).
if (api.windows) api.windows.onRemoved.addListener((id) => service.windowClosed(id));
else api.tabs.onRemoved.addListener((id) => service.windowClosed(id));
api.tabs.onUpdated.addListener((tabId, change) => {
	if (change.status === 'loading') service.tabLoaded(tabId);
});

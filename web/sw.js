// The web edition's service worker (doc/WEB-EDITION.md). Static files (the
// built client, static/) go to the network as usual. Every other request of
// the app, a page's data, a form action, /api/*, an <img> of a cover, is the
// server's: it is handed to the page that made it, which hands it to its
// server worker. A navigation gets the app's shell, which then loads its data
// the same way.
//
// The service worker cannot run the server itself: SQLite's OPFS files need a
// dedicated worker's synchronous access handles, which a service worker has
// not got.
const STATIC = new Set(__TSUNDOKU_STATIC__);

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));

self.addEventListener('fetch', (event) => {
	const url = new URL(event.request.url);
	if (url.origin !== self.location.origin) return;
	if (
		url.pathname.startsWith('/_app/') ||
		url.pathname.startsWith('/server/') ||
		STATIC.has(url.pathname)
	)
		return;
	if (event.request.mode === 'navigate') {
		// A form posted without use:enhance is a navigation: it goes to the
		// server like any request, through the page that sent it (still open
		// while its navigation is pending). Its answer is shown by the shell,
		// so it must be a redirect; an action that answers with a page instead
		// is sent back to the page's address, its result lost.
		if (event.request.method === 'POST') event.respondWith(postedForm(event));
		else event.respondWith(fetch('/index.html'));
		return;
	}
	event.respondWith(viaPage(event));
});

async function postedForm(event) {
	const response = await viaPage(event);
	if (response.status >= 300 && response.status < 400) return response;
	return Response.redirect(event.request.url, 303);
}

/** The page a request belongs to: its own, or for a navigation, which has
 * none yet, the window it is leaving. */
async function pageOf(event) {
	if (event.clientId) return self.clients.get(event.clientId);
	const windows = await self.clients.matchAll({ type: 'window' });
	return windows.find((w) => w.focused) ?? windows[0] ?? null;
}

let nextId = 1;

async function viaPage(event) {
	const client = await pageOf(event);
	if (!client) return new Response('the web edition has no page to answer this', { status: 503 });
	const req = event.request;
	const body = req.method === 'GET' || req.method === 'HEAD' ? null : await req.arrayBuffer();
	const channel = new MessageChannel();
	const answer = new Promise((resolve) => (channel.port1.onmessage = ({ data }) => resolve(data)));
	client.postMessage(
		{
			type: 'tsundoku-request',
			id: nextId++,
			url: req.url,
			method: req.method,
			headers: [...req.headers],
			body
		},
		[channel.port2, ...(body ? [body] : [])]
	);
	const r = await answer;
	return new Response(r.status === 204 || r.status === 304 ? null : r.body, {
		status: r.status,
		statusText: r.statusText,
		headers: r.headers
	});
}

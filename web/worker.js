// The web edition's server: SvelteKit's own Server, built for the self-hosted
// app's routes, running in a dedicated Worker of the page (doc/WEB-EDITION.md).
// The service worker hands it the page's requests through the page (boot.js);
// it answers with exactly what the Node server would have.
import './process.js';
import { keepCookies, setCookiesOf, withCookie } from './cookies.js';
import { enginePort } from './engine-port.js';
import { ready } from './sqlite.js';
import { Server } from 'tsundoku-web:server';
import { manifest } from 'tsundoku-web:manifest';

// Before any server code makes a response: the cookies it sets are kept
// (web/cookies.js), though the browser drops them from a script-made one.
keepCookies();

// The tab shows each step as it really finishes (web/start.js, STEPS): the
// server's code is loaded once this module runs at all; then the library
// opens (SQLite and its pool); then the server starts, which on a first visit
// climbs every migration.
self.postMessage({ type: 'tsundoku-step', step: 'server' });

/** What this browser lacks for the library, as the could-not-start screen names it. */
function missing() {
	const handle = /** @type {any} */ (globalThis).FileSystemFileHandle;
	return handle && 'createSyncAccessHandle' in handle.prototype ? [] : ['SYNCHRONOUS FILE ACCESS'];
}

const started = (async () => {
	const lacking = missing();
	if (lacking.length > 0)
		throw Object.assign(new Error(`missing: ${lacking.join(', ')}`), { missing: lacking });
	await ready();
	self.postMessage({ type: 'tsundoku-step', step: 'library' });
	const server = new Server(manifest);
	await server.init({
		env: globalThis.process.env,
		read: (file) => fetch(`/${file}`).then((r) => r.body)
	});
	return server;
})();

// Before any server code runs a request: its calls to ENGINE_URL go to the
// engine's worker, every other fetch is the browser's.
const engine = enginePort(globalThis.fetch.bind(globalThis));
globalThis.fetch = engine.fetch;

self.onmessage = async ({ data, ports }) => {
	// The tab's word on the engine (web/boot.js): a port when it starts one,
	// then each change of state.
	if (data?.type === 'tsundoku-engine') return engine.set(data, ports[0]);
	if (data?.type !== 'tsundoku-request') return;
	const { id, url, method, headers, body, cookie } = data;
	try {
		const server = await started;
		const request = withCookie(
			new Request(url, { method, headers, body: body ?? undefined }),
			cookie ?? ''
		);
		const response = await server.respond(request, { getClientAddress: () => '127.0.0.1' });
		const buffer = await response.arrayBuffer();
		self.postMessage(
			{
				type: 'tsundoku-response',
				id,
				status: response.status,
				statusText: response.statusText,
				headers: [...response.headers],
				setCookies: setCookiesOf(response.headers),
				body: buffer
			},
			[buffer]
		);
	} catch (e) {
		const text = new TextEncoder().encode(`web edition server error: ${e?.stack ?? e}`).buffer;
		self.postMessage(
			{
				type: 'tsundoku-response',
				id,
				status: 500,
				statusText: 'Server error',
				headers: [['content-type', 'text/plain']],
				body: text
			},
			[text]
		);
	}
};

started.then(
	() => self.postMessage({ type: 'tsundoku-ready' }),
	// The name and what is missing travel beside the text: the tab tells a
	// refused storage and a browser too old apart by them (web/start.js, classify).
	(e) =>
		self.postMessage({
			type: 'tsundoku-failed',
			// Firefox's stack leaves the message out; Chrome's starts with it.
			error:
				e?.stack && String(e.stack).includes(String(e?.message))
					? String(e.stack)
					: [String(e), e?.stack].filter(Boolean).join('\n'),
			name: typeof e?.name === 'string' ? e.name : '',
			missing: Array.isArray(e?.missing) ? e.missing : []
		})
);

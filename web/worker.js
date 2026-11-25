// The web edition's server: SvelteKit's own Server, built for the self-hosted
// app's routes, running in a dedicated Worker of the page (doc/WEB-EDITION.md).
// The service worker hands it the page's requests through the page (boot.js);
// it answers with exactly what the Node server would have.
import './process.js';
import { ready } from './sqlite.js';
import { Server } from 'tsundoku-web:server';
import { manifest } from 'tsundoku-web:manifest';

const started = (async () => {
	await ready();
	const server = new Server(manifest);
	await server.init({
		env: globalThis.process.env,
		read: (file) => fetch(`/${file}`).then((r) => r.body)
	});
	return server;
})();

self.onmessage = async ({ data }) => {
	if (data?.type !== 'tsundoku-request') return;
	const { id, url, method, headers, body } = data;
	try {
		const server = await started;
		const request = new Request(url, { method, headers, body: body ?? undefined });
		const response = await server.respond(request, { getClientAddress: () => '127.0.0.1' });
		const buffer = await response.arrayBuffer();
		self.postMessage(
			{
				type: 'tsundoku-response',
				id,
				status: response.status,
				statusText: response.statusText,
				headers: [...response.headers],
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
	(e) => self.postMessage({ type: 'tsundoku-failed', error: String(e?.stack ?? e) })
);

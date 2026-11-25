// Runs before SvelteKit's client in the web edition's shell (the adapter
// rewrites index.html to call it). It makes sure the service worker controls
// the page, starts the server worker, relays the service worker's requests to
// it, and only then starts the app, whose very first data request already
// needs the server (doc/WEB-EDITION.md).
const status = (text) => {
	document.documentElement.dataset.webBoot = text;
};

async function boot() {
	status('registering');
	await navigator.serviceWorker.register('/sw.js', { scope: '/' });
	await navigator.serviceWorker.ready;
	if (!navigator.serviceWorker.controller) {
		// A first visit is not controlled until it loads again.
		status('reloading');
		location.reload();
		return;
	}

	status('starting the server');
	const server = new Worker('/server/worker.js', { type: 'module' });
	const pending = new Map();
	const started = new Promise((resolve, reject) => {
		server.onmessage = ({ data }) => {
			if (data.type === 'tsundoku-ready') resolve();
			else if (data.type === 'tsundoku-failed') reject(new Error(data.error));
			else if (data.type === 'tsundoku-response') {
				const port = pending.get(data.id);
				pending.delete(data.id);
				port?.postMessage(data, data.body ? [data.body] : []);
			}
		};
	});

	let next = 1;
	navigator.serviceWorker.onmessage = ({ data, ports }) => {
		if (data?.type !== 'tsundoku-request') return;
		const id = next++;
		pending.set(id, ports[0]);
		server.postMessage({ ...data, id }, data.body ? [data.body] : []);
	};

	await started;
	status('ready');
	window.__tsundokuStart();
}

boot().catch((e) => {
	status('failed');
	document.body.textContent = `The web edition could not start: ${e?.message ?? e}`;
	console.error(e);
});

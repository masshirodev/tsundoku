/**
 * Moving the web edition's open tabs to a new build, together
 * (doc/WEB-EDITION.md, "A new build"; c1138).
 *
 * The self-hosted app learns of a deploy from `/_app/version.json` and loads
 * the next screen whole, from the new build (src/routes/+layout.svelte). In
 * the web edition one tab's server answers every tab, so one tab moving alone
 * would leave the others' clients on one build and the server on another. So
 * the tab going somewhere first makes sure the new service worker is in
 * (`registration.update()`; it takes over by itself), then asks it to send
 * every other tab to the new build, and goes there itself. The first tab to
 * start again starts the new server.
 *
 * If no newer worker is in yet (the host has not finished the deploy, or the
 * check failed), the tab only goes where it was going: the worker serves the
 * build every tab runs, and the next navigation tries again.
 */
import { version } from '$app/environment';
import { MESSAGES } from './relay';

/** Has the browser fetch the service worker again, so a deploy's new one installs. */
export async function checkForNewWorker(): Promise<void> {
	const registration = await navigator.serviceWorker?.getRegistration();
	await registration?.update().catch(() => {});
}

/** Waits for a worker on its way in to take over this tab, or gives up. */
function takeover(ms: number): Promise<void> {
	return new Promise((resolve) => {
		const done = () => {
			clearTimeout(timer);
			navigator.serviceWorker.removeEventListener('controllerchange', done);
			resolve();
		};
		const timer = setTimeout(done, ms);
		navigator.serviceWorker.addEventListener('controllerchange', done);
	});
}

/** Asks the service worker controlling this tab; its answer, or null if none comes. */
function ask(type: string, ms: number): Promise<unknown> {
	const controller = navigator.serviceWorker?.controller;
	if (!controller) return Promise.resolve(null);
	const channel = new MessageChannel();
	return new Promise((resolve) => {
		const timer = setTimeout(() => resolve(null), ms);
		channel.port1.onmessage = ({ data }) => {
			clearTimeout(timer);
			resolve(data);
		};
		controller.postMessage({ type }, [channel.port2]);
	});
}

/** The build of the service worker controlling this tab; null if it does not answer. */
async function workerBuild(ms: number): Promise<string | null> {
	const build = await ask(MESSAGES.workerBuild, ms);
	return typeof build === 'string' ? build : null;
}

/** Goes to `href` on the new build, taking every other open tab with it. */
export async function moveToNewBuild(href: string): Promise<void> {
	await checkForNewWorker();
	const registration = await navigator.serviceWorker?.getRegistration();
	if (registration?.installing || registration?.waiting) await takeover(10_000);
	const build = await workerBuild(2_000);
	// Its answer before going: a navigation sent first could reach the worker
	// before the word to move, and be given the old build again.
	if (build && build !== version) await ask(MESSAGES.moving, 2_000);
	location.href = href;
}

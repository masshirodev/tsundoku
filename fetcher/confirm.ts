// The confirmation window (c1156; handoff `fetcher-options`, revision 1): the
// fetcher asks the reader whether tsundoku may reach a device on their own
// network. It shows only what the background knows itself (the asking tab's
// origin, the host and port, what the fetcher saw of the address), never text
// the page sent, and CANCEL holds the focus, so Enter never allows.
import type { RuntimeReply } from '../src/lib/fetcher/service.ts';
import { wordsFor } from '../src/lib/fetcher/words.ts';

const api = typeof browser === 'undefined' ? chrome : browser;
const words = wordsFor(navigator.language);
document.documentElement.lang = navigator.language.toLowerCase().startsWith('pt') ? 'pt-BR' : 'en';
if (matchMedia('(prefers-color-scheme: light)').matches)
	document.documentElement.dataset.theme = 'light';

const id = new URLSearchParams(location.search).get('ask') ?? '';
const el = (name: string) => document.getElementById(name)!;
el('fetcher').textContent = words.fetcher;
el('asks-you').textContent = words.asksYou;

async function show() {
	const reply = (await api.runtime.sendMessage({ kind: 'ask-details', id })) as
		RuntimeReply | undefined;
	const details = reply?.kind === 'ask-details' ? reply.details : null;
	if (!details) {
		el('over').textContent = words.askOver;
		el('over').hidden = false;
		return;
	}
	el('origin').textContent = new URL(details.origin).host;
	el('asks-to-reach').textContent = words.asksToReach;
	el('target').textContent = details.port ? `${details.host}:${details.port}` : details.host;
	el('what').textContent = details.port ? words.deviceOnPort(details.port) : words.addressEveryPort;
	if (details.seen) {
		const since = new Date(details.seen.since).toLocaleTimeString(navigator.language, {
			hour: '2-digit',
			minute: '2-digit'
		});
		el('seen').textContent = words.seen(details.seen.sites, since);
		el('seen').hidden = false;
	}
	el('may-reach').textContent = words.mayReach;
	el('cancel').textContent = words.cancel;
	el('allow').textContent = words.allow;
	el('ask').hidden = false;
	el('choose').hidden = false;
	el('cancel').focus();
}

async function answer(allowed: boolean) {
	for (const b of ['cancel', 'allow']) (el(b) as HTMLButtonElement).disabled = true;
	// The background closes this window once the answer is in.
	await api.runtime.sendMessage({ kind: 'ask-answer', id, allowed });
}

el('cancel').addEventListener('click', () => void answer(false));
el('allow').addEventListener('click', () => void answer(true));
addEventListener('keydown', (event) => {
	if (event.key === 'Escape') void answer(false);
});
void show();

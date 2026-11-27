// The fetcher's options page (c1156; handoff `fetcher-options`, revision 1):
// the hosts allowed on the reader's own network, REMOVE with UNDO, and ADD BY
// HAND folded away. The usual way in is the confirmation window, from
// tsundoku's own ALLOW; this page is for looking, undoing and the rare hand
// entry. Its rules are src/lib/fetcher/options.ts; the list is the same
// storage key the background reads, so a change here is in force at once.
import {
	ALLOWED_META_KEY,
	checkHandEntry,
	coverage,
	droppedParts,
	readMeta,
	type EntryMeta,
	type HandResult
} from '../src/lib/fetcher/options.ts';
import { PRODUCTION_ORIGINS } from '../src/lib/fetcher/protocol.ts';
import { ALLOWED_HOSTS_KEY, readAllowedHosts } from '../src/lib/fetcher/reach.ts';
import { wordsFor } from '../src/lib/fetcher/words.ts';

const api = typeof browser === 'undefined' ? chrome : browser;
const words = wordsFor(navigator.language);
document.documentElement.lang = navigator.language.toLowerCase().startsWith('pt') ? 'pt-BR' : 'en';
if (matchMedia('(prefers-color-scheme: light)').matches)
	document.documentElement.dataset.theme = 'light';

const el = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const text = (id: string, value: string) => (el(id).textContent = value);

text('title', words.options);
text('answers', words.answersOnly(new URL(PRODUCTION_ORIGINS[0]).host));
text('intro', words.intro);
text('list-label', `01 — ${words.allowedLabel}`);
text('remove-hint', words.removeHint);
text('hand-label', words.addByHand);
text('hand-open', words.open);
text('hand-close', words.close);
text('field-label', words.fieldLabel);
text('field-note', words.fieldNote);
text('add-button', words.add);
text('keeps', words.keeps);
text('port-rule', words.portRule);
text('undo', words.undo);
text('removed-note', words.refusedAgain);
el<HTMLInputElement>('add').placeholder = words.placeholder;

let list: string[] = [];
let meta: Record<string, EntryMeta> = {};

async function load() {
	const stored = await api.storage.local.get(ALLOWED_HOSTS_KEY);
	const storedMeta = await api.storage.local.get(ALLOWED_META_KEY);
	list = readAllowedHosts(stored);
	meta = readMeta(storedMeta);
	draw();
}

const save = () => api.storage.local.set({ [ALLOWED_HOSTS_KEY]: list, [ALLOWED_META_KEY]: meta });

function dayOf(at: number): string {
	const day = new Date(at);
	const today = new Date();
	return day.toDateString() === today.toDateString()
		? words.today
		: day.toLocaleDateString(navigator.language, { day: 'numeric', month: 'short' }).toUpperCase();
}

function covers(entry: string): string {
	const c = coverage(entry);
	const parts: string[] = [c.port ? words.portOnly(c.port) : words.everyPort];
	if (c.address) parts.push(words.proxyCovered);
	const m = meta[entry];
	if (m?.via === 'asked') parts.push(words.whenAsked(dayOf(m.at)));
	return parts.join(' · ');
}

function draw() {
	const rows = el('list');
	rows.replaceChildren();
	text('list-count', list.length ? words.count(list.length) : words.none);
	el('remove-hint').hidden = list.length === 0;
	if (list.length === 0) {
		const empty = document.createElement('div');
		empty.className = 'empty';
		empty.textContent = words.empty;
		rows.append(empty);
		return;
	}
	// Newest first: the list is stored in the order entries were added.
	for (const entry of [...list].reverse()) {
		const row = document.createElement('div');
		row.className = 'entry';
		const h = document.createElement('div');
		h.className = 'h';
		const host = document.createElement('span');
		host.className = 'host';
		host.textContent = entry;
		const cov = document.createElement('span');
		cov.className = 'cov';
		cov.textContent = covers(entry);
		h.append(host, cov);
		const remove = document.createElement('button');
		remove.type = 'button';
		remove.className = 'cell';
		remove.textContent = words.remove;
		remove.setAttribute('aria-label', `${words.remove} ${entry}`);
		remove.addEventListener('click', () => void removeEntry(entry));
		row.append(h, remove);
		rows.append(row);
	}
	check();
}

// REMOVE is at once; the band offers UNDO until the page is left, which puts
// the entry back as it was, where it was.
let undo: (() => Promise<void>) | null = null;

async function removeEntry(entry: string) {
	const at = list.indexOf(entry);
	const was = meta[entry];
	list = list.filter((e) => e !== entry);
	delete meta[entry];
	await save();
	text('removed-what', words.removed(entry));
	el('removed').hidden = false;
	undo = async () => {
		if (!list.includes(entry)) list.splice(Math.min(at, list.length), 0, entry);
		if (was) meta[entry] = was;
		await save();
		el('removed').hidden = true;
		undo = null;
		draw();
	};
	draw();
}
el('undo').addEventListener('click', () => void undo?.());

// ---- ADD BY HAND ----
// The kept entry may be widened to every port, or narrowed back.
let everyPort = false;
let result: HandResult = { ok: false, why: 'no-host' };

function kept(): string | null {
	if (!result.ok) return null;
	return everyPort ? coverage(result.entry).host : result.entry;
}

function check() {
	const input = el<HTMLInputElement>('add');
	const typed = input.value;
	result = checkHandEntry(typed, list);
	const msg = el('msg');
	const keep = el('keep');
	input.classList.toggle('on', typed.trim() !== '');
	(el('add-button') as HTMLButtonElement).disabled = !result.ok;
	msg.hidden = true;
	keep.hidden = true;
	if (!typed.trim()) return;
	if (!result.ok) {
		const [head, note] = refusalWords(result);
		msg.replaceChildren(
			head,
			' · ',
			Object.assign(document.createElement('span'), { className: 's', textContent: note })
		);
		msg.hidden = false;
		return;
	}
	const entry = kept()!;
	const c = coverage(entry);
	const dropped = droppedParts(typed);
	text('keep-entry', entry);
	text(
		'keep-note',
		[
			c.port ? words.portOnly(c.port) : words.everyPort,
			...(dropped.length ? [words.drops(dropped.join(' + '))] : [])
		].join(' · ')
	);
	const toggle = el('keep-toggle');
	toggle.hidden = coverage(result.entry).port === null;
	toggle.textContent = everyPort ? words.thisPortOnly : words.everyPortInstead;
	text('keep-prose', words.mayReachHost(c.host, c.port));
	keep.hidden = false;
}

function refusalWords(r: Exclude<HandResult, { ok: true }>): [string, string] {
	switch (r.why) {
		case 'no-host':
			return [words.noHost, words.noHostHint];
		case 'scheme':
			return [words.scheme(r.scheme), words.schemeHint(r.host ?? 'nas.lan')];
		case 'password':
			return [words.password, words.passwordHint(r.host ?? '')];
		case 'public':
			return [words.publicHost(r.host), words.publicHint];
		case 'covered':
			return [words.covered, words.coveredHint(r.by, coverage(r.by).port)];
		case 'port':
			return [words.badPort, words.badPortHint];
	}
}

el('add').addEventListener('input', () => {
	everyPort = false;
	check();
});
el('keep-toggle').addEventListener('click', () => {
	everyPort = !everyPort;
	check();
});
el('form').addEventListener('submit', (event) => {
	event.preventDefault();
	const entry = kept();
	if (!entry || list.includes(entry)) return;
	list = [...list, entry];
	meta[entry] = { via: 'hand', at: Date.now() };
	el<HTMLInputElement>('add').value = '';
	void save().then(draw);
});

// An ALLOW from tsundoku while this page is open shows up at once.
api.storage.onChanged.addListener((changes, area) => {
	if (area === 'local' && (ALLOWED_HOSTS_KEY in changes || ALLOWED_META_KEY in changes))
		void load();
});
void load();

'use strict';
/**
 * The host LNReader plugins run in (doc/NOVELS.md, "The plugin host"; card
 * c147). A child process of the app, started by host.ts under Node's
 * permission model with an empty environment: it may read only itself, the
 * project's node_modules and the plugin store, and may not write, spawn,
 * start workers or load addons. Plugin code is evaluated in a vm context
 * whose require hands out only the shims below and the libraries plugins are
 * written against, and whose fetch refuses loopback and private addresses.
 *
 * Plain CommonJS, not TypeScript, and never bundled: it's started as a file.
 *
 * Messages (IPC): { id, op: 'info' | 'call', file, method?, args? } in;
 * { id, ok: true, value } or { id, ok: false, error } out. The first message
 * may be { op: 'config', allow: ['127.0.0.1:4170'] }: loopback ports the
 * parent opens on purpose, for tests. Nothing else can open one. When a site
 * answers with a browser check the host sends { op: 'challenge', id, url } and
 * the parent answers { op: 'challenge-result', id, ok, value } (card c152).
 */
const vm = require('node:vm');
const fs = require('node:fs');
const dns = require('node:dns/promises');
const net = require('node:net');
const { AsyncLocalStorage } = require('node:async_hooks');

// The browser User-Agent the engine sends (engine/protocol.ts): sites answer it.
const USER_AGENT =
	'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Mobile Safari/537.36';

let allowed = new Set();

/**
 * What went wrong with a call's requests, kept per call: fetchText answers ''
 * on any failure, as LNReader's runtime does, so a plugin whose site refused
 * it answers an empty list. When a call comes back empty, this is why
 * (`explained` below) — a refused address, a bot check's 403, a site down.
 */
const trouble = new AsyncLocalStorage();
const note = (why) => {
	const t = trouble.getStore();
	if (t && !t.why) t.why = why;
};

// ---- a fetch that stays on the internet ---------------------------------------------------

/** Loopback, private, link-local, unique-local and unspecified addresses: never a plugin's site. */
function isPrivate(ip) {
	if (net.isIPv4(ip)) {
		const [a, b] = ip.split('.').map(Number);
		return (
			a === 0 ||
			a === 10 ||
			a === 127 ||
			(a === 100 && b >= 64 && b <= 127) ||
			(a === 169 && b === 254) ||
			(a === 172 && b >= 16 && b <= 31) ||
			(a === 192 && b === 168) ||
			a >= 224
		);
	}
	const v = ip.toLowerCase();
	if (v.startsWith('::ffff:')) return isPrivate(v.slice(7));
	return (
		v === '::' ||
		v === '::1' ||
		v.startsWith('fc') ||
		v.startsWith('fd') ||
		v.startsWith('fe8') ||
		v.startsWith('fe9') ||
		v.startsWith('fea') ||
		v.startsWith('feb')
	);
}

async function checkUrl(url) {
	const u = new URL(url);
	if (u.protocol !== 'https:' && u.protocol !== 'http:') throw new Error(`refused: ${u.protocol}`);
	const port = u.port || (u.protocol === 'https:' ? '443' : '80');
	if (allowed.has(`${u.hostname}:${port}`)) return;
	const host = u.hostname.replace(/^\[|\]$/g, '');
	const addrs = net.isIP(host)
		? [host]
		: (await dns.lookup(host, { all: true })).map((a) => a.address);
	if (addrs.length === 0 || addrs.some(isPrivate))
		throw new Error(`refused: ${u.hostname} is not on the internet`);
}

/** fetch, with every hop of a redirect checked: an automatic one would skip the check. */
async function guardedFetch(input, init = {}) {
	let url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
	const headers = new Headers(init.headers || {});
	if (!headers.has('user-agent')) headers.set('user-agent', USER_AGENT);
	const opts = {
		...init,
		headers,
		redirect: 'manual'
	};
	// One retry for the whole request: a site that keeps answering with a check
	// is a check that wasn't passed, not something to keep asking about.
	let retried = false;
	// One 30 s budget for the whole request, redirects included: a fresh one per
	// hop would let a six-hop chain run 180 s, past the 120 s the app allows a
	// novel call. The retry after a clearance gets its own, since a solve takes
	// 20-45 s first. A caller's own signal is never reset.
	let deadline = init.signal || AbortSignal.timeout(30_000);
	const attempt = () => ({ ...opts, signal: deadline });
	for (let hop = 0; hop < 6; hop++) {
		try {
			await checkUrl(url);
		} catch (e) {
			note(e.message);
			throw e;
		}
		let res;
		try {
			res = await fetch(url, withJar(attempt(), url));
		} catch (e) {
			note(`${new URL(url).hostname} did not answer (${(e.cause && e.cause.code) || e.message})`);
			throw e;
		}
		let challenge = await isChallenge(res);
		if (challenge && !retried) {
			retried = true;
			const clearance = await challengeFor(url);
			if (clearance) {
				deadline = init.signal || AbortSignal.timeout(30_000);
				try {
					res = await fetch(url, withJar(attempt(), url));
				} catch (e) {
					note(
						`${new URL(url).hostname} did not answer (${(e.cause && e.cause.code) || e.message})`
					);
					throw e;
				}
				challenge = await isChallenge(res);
				// The site refused the clearance it was just given. Remember that
				// where it is seen: the next chapter would otherwise pay the same
				// solve and retry for a check this host cannot pass.
				if (challenge) refused.set(hostOf(url), Date.now());
				else refused.delete(hostOf(url));
			}
		}
		if (challenge)
			note(`${new URL(url).hostname} answered ${res.status} (its check could not be passed)`);
		else if (res.status >= 400) note(`${new URL(url).hostname} answered ${res.status}`);
		const to = res.status >= 300 && res.status < 400 ? res.headers.get('location') : null;
		if (!to) return res;
		url = new URL(to, url).href;
		if (
			res.status === 303 ||
			((res.status === 301 || res.status === 302) && opts.method && opts.method !== 'GET')
		)
			Object.assign(opts, { method: 'GET', body: undefined });
	}
	throw new Error('refused: too many redirects');
}

// ---- a site's browser check (doc/NOVELS.md, "Past a site's bot check"; c152) ---------------
// The host refuses local addresses, and a solver is one, so it can't reach one
// itself. It asks the parent over IPC, naming only the URL; the app checks the
// address is on the internet and answers with that host's clearance cookies
// and user agent, or nothing. Never the solver's address, never .env.

/** A host's clearance, from the app: cookies as a Cookie header's value, and the agent to send. */
const jars = new Map();
/**
 * Hosts whose clearance the site still refused, and when: the retry above
 * already asked, so asking again inside the window pays a solve and a retry
 * for nothing — a 148-chapter download would pay 148 times.
 */
const refused = new Map();
const REFUSED_MS = 10 * 60_000;
let challengeId = 1;
const asked = new Map();
const solving = new Map();

const hostOf = (url) => new URL(url).hostname.toLowerCase();

/** The app's own timeout is shorter; this only stops a plugin waiting on nobody. */
const CHALLENGE_MS = 70_000;

function askChallenge(url) {
	const id = challengeId++;
	return new Promise((resolve) => {
		const timer = setTimeout(() => {
			asked.delete(id);
			resolve(null);
		}, CHALLENGE_MS);
		asked.set(id, { resolve, timer });
		try {
			process.send({ op: 'challenge', id, url });
		} catch {
			clearTimeout(timer);
			asked.delete(id);
			resolve(null);
		}
	});
}

/** One solve per host at a time: a plugin asking in a loop waits on the first, not a queue. */
function challengeFor(url) {
	const host = hostOf(url);
	// A clearance this host just refused is not asked for again: the one request
	// the call makes is already a check, and there is nothing to retry with.
	const at = refused.get(host);
	if (at !== undefined && Date.now() - at < REFUSED_MS) return Promise.resolve(null);
	let one = solving.get(host);
	if (!one) {
		one = askChallenge(url)
			.then((clearance) => {
				if (clearance && (clearance.cookies || clearance.userAgent)) jars.set(host, clearance);
				return clearance;
			})
			.finally(() => solving.delete(host));
		solving.set(host, one);
	}
	return one;
}

/** The jar of the host [url] is on, and of no other: a redirect to another host carries none of it. */
function withJar(opts, url) {
	const u = new URL(url);
	const jar = jars.get(hostOf(url));
	if (!jar) return opts;
	const headers = new Headers(opts.headers || {});
	const own = headers.get('cookie');
	// A jar goes as one Cookie header, so one secure cookie in it makes the whole
	// jar https-only: a cf_clearance in clear text is the one thing it must never
	// be. http stays reachable (checkUrl allows it); it just gets no clearance.
	const secure = jar.httpsOnly && u.protocol !== 'https:';
	if (jar.cookies && !secure) headers.set('cookie', own ? `${own}; ${jar.cookies}` : jar.cookies);
	if (jar.userAgent) headers.set('user-agent', jar.userAgent);
	return { ...opts, headers };
}

/**
 * Whether a response is a site's check, not the site's own answer: a 403 it
 * meant is left alone. Only Cloudflare's mitigation header and its challenge
 * page are markers — `cf-ray` and `server: cloudflare` ride on every response
 * it proxies, so a members-only 403 or a maintenance 503 carries them too.
 */
async function isChallenge(res) {
	if (res.status !== 403 && res.status !== 503) return false;
	const mitigated = res.headers.get('cf-mitigated');
	if (mitigated && /challenge/i.test(mitigated)) return true;
	try {
		const body = await res.clone().text();
		return body.includes('__cf_chl') || body.includes('/cdn-cgi/challenge-platform/');
	} catch {
		return false;
	}
}

// ---- the shims: @libs/*, as LNReader's runtime gives them (lnreader-plugins, MIT) ------------
// Adapted from lnreader-plugins' src/lib (fetch, storage), Copyright (c) 2021
// Rajarshee Chatterjee, under the MIT licence in LICENSE-lnreader-plugins.txt
// beside this file. Unlike the rest of tsundoku, this section stays MIT.

const DEFAULT_HEADERS = {
	Connection: 'keep-alive',
	Accept: '*/*',
	'Accept-Language': '*',
	'Sec-Fetch-Mode': 'cors',
	'Accept-Encoding': 'gzip, deflate'
};
const withDefaults = (init = {}) => {
	const h = new Headers(init.headers || {});
	for (const [k, v] of Object.entries(DEFAULT_HEADERS)) if (!h.has(k)) h.set(k, v);
	return { ...init, headers: h };
};
const libFetch = {
	fetchApi: (url, init) => guardedFetch(url, withDefaults(init)),
	fetchText: async (url, init, encoding) => {
		try {
			const res = await guardedFetch(url, withDefaults(init));
			if (!res.ok) return '';
			return new TextDecoder(encoding).decode(await res.arrayBuffer());
		} catch {
			return '';
		}
	},
	fetchFile: async (url, init) => {
		try {
			const res = await guardedFetch(url, withDefaults(init));
			if (!res.ok) return '';
			return Buffer.from(await res.arrayBuffer()).toString('base64');
		} catch {
			return '';
		}
	},
	fetchProto: async (protoInit, url, init) => {
		const { parse } = require('protobufjs');
		const root = parse(protoInit.proto).root;
		const Req = root.lookupType(protoInit.requestType);
		const err = Req.verify(protoInit.requestData || {});
		if (err) throw new Error(`Invalid Proto: ${err}`);
		const body = Req.encode(Req.create(protoInit.requestData || {})).finish();
		// gRPC-web framing: a zero flag byte, then the length, big-endian.
		const frame = new Uint8Array(5 + body.length);
		new DataView(frame.buffer).setUint32(1, body.length);
		frame.set(body, 5);
		const res = await guardedFetch(url, withDefaults({ method: 'POST', ...init, body: frame }));
		const bytes = new Uint8Array(await res.arrayBuffer());
		const len = new DataView(bytes.buffer, bytes.byteOffset).getUint32(1);
		const Res = root.lookupType(protoInit.responseType);
		return Res.toObject(Res.decode(bytes.slice(5, 5 + len)));
	}
};

class Storage {
	constructor() {
		this.db = {};
	}
	set(key, value, expires) {
		this.db[key] = {
			created: new Date(),
			value,
			expires: expires instanceof Date ? expires.getTime() : expires
		};
	}
	get(key, raw) {
		const item = this.db[key];
		if (item && item.expires && Date.now() > item.expires) {
			delete this.db[key];
			return undefined;
		}
		return raw ? item : item && item.value;
	}
	getAllKeys() {
		return Object.keys(this.db);
	}
	delete(key) {
		delete this.db[key];
	}
	clearAll() {
		this.db = {};
	}
}
const webStorage = () => {
	const m = new Map();
	return { get: () => Object.fromEntries(m) };
};

const NovelStatus = {
	Unknown: 'Unknown',
	Ongoing: 'Ongoing',
	Completed: 'Completed',
	Licensed: 'Licensed',
	PublishingFinished: 'Publishing Finished',
	Cancelled: 'Cancelled',
	OnHiatus: 'On Hiatus',
	STUB: 'STUB',
	Inactive: 'Inactive'
};
const FilterTypes = {
	TextInput: 'Text',
	Picker: 'Picker',
	CheckboxGroup: 'Checkbox',
	Switch: 'Switch',
	ExcludableCheckboxGroup: 'XCheckbox'
};
const defaultCover =
	'https://github.com/LNReader/lnreader-plugins/blob/main/icons/src/coverNotAvailable.jpg?raw=true';
const isUrlAbsolute = (url) => /^(?:[a-z][a-z\d+\-.]*:)?\/\//i.test(url);

/** The npm libraries a plugin may require, loaded on first use. */
const lent = {
	'@libs/aes': () => require('@noble/ciphers/aes.js'),
	cheerio: () => require('cheerio'),
	dayjs: () => require('dayjs'),
	htmlparser2: () => require('htmlparser2')
};

/** What a plugin may require, and nothing else: no fs, net or child_process. */
function makeRequire() {
	const storage = new Storage();
	const libs = {
		'@libs/fetch': libFetch,
		'@libs/storage': { storage, localStorage: webStorage(), sessionStorage: webStorage() },
		'@libs/novelStatus': { NovelStatus },
		'@libs/defaultCover': { defaultCover },
		'@libs/filterInputs': { FilterTypes },
		'@libs/isAbsoluteUrl': { isUrlAbsolute },
		...lent
	};
	return (name) => {
		if (!(name in libs)) throw new Error(`A plugin can't require ${name}`);
		const v = libs[name];
		return typeof v === 'function' && name !== '@libs/fetch' ? v() : v;
	};
}

// ---- plugins ------------------------------------------------------------------------------

const plugins = new Map();

function load(file) {
	const known = plugins.get(file);
	if (known) return known;
	const code = fs.readFileSync(file, 'utf8');
	const module = { exports: {} };
	const context = vm.createContext({
		module,
		exports: module.exports,
		require: makeRequire(),
		fetch: guardedFetch,
		console: { log() {}, warn() {}, error() {}, info() {}, debug() {} },
		setTimeout,
		clearTimeout,
		setInterval,
		clearInterval,
		URL,
		URLSearchParams,
		TextDecoder,
		TextEncoder,
		Headers,
		FormData,
		AbortController,
		AbortSignal,
		atob,
		btoa,
		Buffer
	});
	// The libraries it names, read from disk before its code runs: a first
	// require counts against the 5 s its own code is given, and on a cold
	// Windows install (Defender scanning Program Files) cheerio alone outlasted
	// it (2026.11.01's smoke test). Node keeps them, so the plugin's own
	// require is then instant, and the limit is the plugin's code alone.
	for (const m of code.matchAll(/\brequire\(\s*['"]([^'"]+)['"]\s*\)/g))
		if (Object.hasOwn(lent, m[1])) lent[m[1]]();
	vm.runInContext(code, context, { filename: file, timeout: 5_000 });
	const exported = module.exports.default || module.exports;
	const plugin = typeof exported === 'function' ? new exported() : exported;
	plugins.set(file, plugin);
	return plugin;
}

/** A plugin's filters' starting values, as popularNovels expects them: { key: { type, value } }. */
function defaults(filters) {
	const out = {};
	for (const [k, f] of Object.entries(filters || {})) out[k] = { type: f.type, value: f.value };
	return out;
}

/** Nothing: an empty list, no chapters, no text. */
const empty = (v) =>
	v === null ||
	v === undefined ||
	v === '' ||
	(Array.isArray(v) && v.length === 0) ||
	(typeof v === 'object' &&
		!Array.isArray(v) &&
		Array.isArray(v.chapters) &&
		v.chapters.length === 0 &&
		!v.name);

/** A call's answer, or, when it's empty and a request failed on the way, why. */
async function explained(m) {
	const t = { why: null };
	const value = await trouble.run(t, () => handle(m));
	if (t.why && empty(value)) throw new Error(t.why);
	return value;
}

async function handle(m) {
	if (m.op === 'config') {
		allowed = new Set(m.allow || []);
		return null;
	}
	const p = load(m.file);
	if (m.op === 'info')
		return {
			id: p.id,
			name: p.name,
			site: p.site,
			version: p.version,
			filters: p.filters || null,
			paged: typeof p.parsePage === 'function'
		};
	const args = m.args || [];
	switch (m.method) {
		case 'popularNovels': {
			const [page, opts] = args;
			return p.popularNovels(page, {
				showLatestNovels: !!(opts && opts.showLatestNovels),
				filters: (opts && opts.filters) || defaults(p.filters)
			});
		}
		case 'searchNovels':
			return p.searchNovels(args[0], args[1]);
		case 'parseNovel':
			return p.parseNovel(args[0]);
		case 'parsePage':
			if (typeof p.parsePage !== 'function') throw new Error('This plugin has no pages');
			return p.parsePage(args[0], args[1]);
		case 'parseChapter':
			return p.parseChapter(args[0]);
		case 'resolveUrl':
			return typeof p.resolveUrl === 'function' ? p.resolveUrl(args[0], args[1]) : null;
		default:
			throw new Error(`No such method: ${m.method}`);
	}
}

process.on('message', (m) => {
	// The app's answer to a site's check: a clearance for the host asked about, or nothing.
	if (m && m.op === 'challenge-result') {
		const wait = asked.get(m.id);
		if (!wait) return;
		asked.delete(m.id);
		clearTimeout(wait.timer);
		wait.resolve(m.ok && m.value ? m.value : null);
		return;
	}
	Promise.resolve()
		.then(() => explained(m))
		.then(
			(value) =>
				process.send({ id: m.id, ok: true, value: JSON.parse(JSON.stringify(value ?? null)) }),
			(e) => process.send({ id: m.id, ok: false, error: String((e && e.message) || e) })
		);
});
// A plugin's stray rejection must not take every other call down with it.
process.on('unhandledRejection', () => {});

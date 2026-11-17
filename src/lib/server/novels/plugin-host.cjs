'use strict';
/**
 * The host LNReader plugins run in (doc/NOVELS.md, "The plugin host"; card
 * c147). A child process of the app, started by host.ts under Node's
 * permission model with an empty environment: it may read only itself, the
 * address guard, the project's node_modules and the plugin store, and may not
 * write, spawn, start workers or load addons. Plugin code is evaluated in a vm
 * context whose require hands out only the shims below and the libraries
 * plugins are written against, and whose fetch refuses anything but the
 * internet, checked again on the addresses each connection actually uses.
 *
 * Plain CommonJS, not TypeScript, and never bundled: it's started as a file.
 *
 * Messages (IPC): { id, op: 'info' | 'call' | 'chapter', file, method?, args?, path? } in;
 * { id, ok: true, value } or { id, ok: false, error } out. The first message
 * may be { op: 'config', allow: ['127.0.0.1:4170'] }: loopback ports the
 * parent opens on purpose, for tests. Nothing else can open one. When a site
 * answers with a browser check the host sends { op: 'challenge', id, url } and
 * the parent answers { op: 'challenge-result', id, ok, value } (card c152).
 * { id, op: 'forget', site } clears the refused memo below for that site's
 * hosts, and answers how many it cleared: TRY AGAIN on the source page (c294).
 * A host in that memo is in page mode (card c335): its requests go to the
 * parent as { op: 'page', id, url, method, postData? }, answered
 * { op: 'page-result', id, ok, value: { url, status, contentType, body } } or
 * { op: 'page-result', id, ok: false, error, fixed?, unsent?, unchecked? },
 * where `fixed` marks a refusal no new solve can change, `unsent` one made
 * before the browser was asked (c630), and `unchecked` a page that came back
 * whose last address this app could not look up (c688). { id, op: 'modes' } answers the
 * hosts in page mode and until when. The config message may carry refusedMs,
 * page mode's length, for tests.
 */
const vm = require('node:vm');
const fs = require('node:fs');
const dns = require('node:dns/promises');
const net = require('node:net');
const { AsyncLocalStorage } = require('node:async_hooks');
// The app's own address guard, the same file the server imports: one rule for
// what is on the internet. Node strips its types as it loads it.
const guard = require('../net-guard.ts');
// And for every fetch in this process, not only the shims': code that got out
// of the vm context and called the process's own fetch still meets the guard.
require('undici').setGlobalDispatcher(guard.publicDispatcher());

// The browser User-Agent the engine sends (engine/protocol.ts): sites answer it.
const USER_AGENT =
	'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Mobile Safari/537.36';

let allowed = new Set();

/**
 * What went wrong with a call's requests, kept per call: fetchText answers ''
 * on any failure, as LNReader's runtime does, so a plugin whose site refused
 * it answers an empty list. When a call comes back empty, this is why
 * (`explained` below) — a refused address, a bot check's 403, a site down.
 * `urls` is where each request in the call ended, for a chapter's pictures
 * (c631): `{ asked, at }`, the address the plugin asked for and the one it
 * finally read.
 */
const trouble = new AsyncLocalStorage();
const note = (why) => {
	const t = trouble.getStore();
	if (t && !t.why) t.why = why;
};

/**
 * Keeps where [asked]'s request ended, for the call that made it. Both are
 * stored as the URLs they name, not as the strings the plugin typed: a plugin
 * that spells a chapter `…/a b.html`, or with an upper-case host, asks for the
 * same page as the encoded spelling the downloader computes, and a literal
 * comparison would lose the address without saying so (c631).
 */
function noteAt(asked, at) {
	const t = trouble.getStore();
	if (!t) return;
	const href = (u) => {
		try {
			return new URL(u).href;
		} catch {
			return u;
		}
	};
	t.urls.push({ asked: href(asked), at: href(at) });
}

// ---- a fetch that stays on the internet ---------------------------------------------------

async function checkUrl(url) {
	const u = new URL(url);
	if (u.protocol !== 'https:' && u.protocol !== 'http:') throw new Error(`refused: ${u.protocol}`);
	const port = u.port || (u.protocol === 'https:' ? '443' : '80');
	if (allowed.has(`${u.hostname}:${port}`)) return;
	const host = u.hostname.replace(/^\[|\]$/g, '');
	const addrs = net.isIP(host)
		? [host]
		: (await dns.lookup(host, { all: true })).map((a) => a.address);
	if (addrs.length === 0 || !addrs.every(guard.isPublicIp))
		throw new Error(`refused: ${u.hostname} is not on the internet`);
}

/**
 * The connection pool for [url]: the guard's, whose sockets connect only to
 * public addresses, so a name can't pass checkUrl and then connect somewhere
 * else. A loopback port the parent opened for a test is the one exception.
 */
let openPool = null;
function poolFor(url) {
	const u = new URL(url);
	const port = u.port || (u.protocol === 'https:' ? '443' : '80');
	if (!allowed.has(`${u.hostname}:${port}`)) return guard.publicDispatcher();
	openPool ??= new (require('undici').Agent)();
	return openPool;
}

/** Why a fetch to [url] failed, in the call's words: the guard's refusal says so. */
function failedFetch(url, e) {
	const host = new URL(url).hostname;
	if (e && e.cause instanceof guard.NotPublicError) {
		const why = `refused: ${host} is not on the internet`;
		note(why);
		return new Error(why);
	}
	note(`${host} did not answer (${(e.cause && e.cause.code) || e.message})`);
	return e;
}

/** fetch, with every hop of a redirect checked: an automatic one would skip the check. */
async function guardedFetch(input, init = {}) {
	let url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
	// Where the plugin's own request began: a chapter's pictures are relative to
	// the page this address ended at, not to the plugin's site (c631). `noteAt`
	// stores both as URLs, so another spelling of the same address still
	// matches the chapter the plugin asked for.
	const asked = url;
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
	const attempt = (at) => ({ ...opts, signal: deadline, dispatcher: poolFor(at) });
	for (let hop = 0; hop < 6; hop++) {
		try {
			await checkUrl(url);
		} catch (e) {
			note(e.message);
			throw e;
		}
		// A host whose check is bound to the browser that solved it: its own
		// fetch is a check every time, so only the solver's browser asks it.
		if (inPageMode(hostOf(url))) return pageFetch(asked, url, opts, init[WANTS_FILE] === true);
		let res;
		try {
			res = await fetch(url, withJar(attempt(url), url));
		} catch (e) {
			throw failedFetch(url, e);
		}
		let challenge = await isChallenge(res);
		let refusedNow = false;
		if (challenge && !retried) {
			retried = true;
			const clearance = await challengeFor(url);
			if (clearance) {
				deadline = init.signal || AbortSignal.timeout(30_000);
				try {
					res = await fetch(url, withJar(attempt(url), url));
				} catch (e) {
					throw failedFetch(url, e);
				}
				challenge = await isChallenge(res);
				// The site refused the clearance it was just given. Remember that
				// where it is seen: the next chapter would otherwise pay the same
				// solve and retry for a check this host cannot pass.
				if (challenge) {
					refused.set(hostOf(url), Date.now());
					refusedNow = true;
				} else refused.delete(hostOf(url));
			}
		}
		// The host has just entered page mode: this same request is the first
		// to go through the solver's browser, so the call that taught the host
		// is answered too, not only the ones after it.
		if (refusedNow) return pageFetch(asked, url, opts, init[WANTS_FILE] === true);
		if (challenge)
			note(`${new URL(url).hostname} answered ${res.status} (its check could not be passed)`);
		else if (res.status >= 400) note(`${new URL(url).hostname} answered ${res.status}`);
		const to = res.status >= 300 && res.status < 400 ? res.headers.get('location') : null;
		if (!to) {
			noteAt(asked, url);
			return res;
		}
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
let refusedMs = 10 * 60_000;
let challengeId = 1;
const asked = new Map();
const solving = new Map();

const hostOf = (url) => new URL(url).hostname.toLowerCase();

/**
 * Forgets the refusals of [site]'s hosts: one host is the other or under it,
 * as the app's `sameSite` (novels/solver.ts). Ten minutes is right for a
 * download's next chapter, but not for someone who just fixed the solver's
 * address or whose site changed its check and pressed TRY AGAIN (c294); the
 * next call then pays one solve and one retry, and is remembered again if the
 * site still refuses.
 */
function forgetRefused(site) {
	let name;
	try {
		name = new URL(site).hostname.toLowerCase();
	} catch {
		name = String(site || '').toLowerCase();
	}
	const bare = name.replace(/^www\./, '');
	if (!bare) return 0;
	let n = 0;
	for (const host of [...refused.keys()])
		if (host === bare || host.endsWith(`.${bare}`) || bare.endsWith(`.${host}`)) {
			refused.delete(host);
			n++;
		}
	return n;
}

/** The app's own timeout is shorter; this only stops a plugin waiting on nobody. */
const CHALLENGE_MS = 70_000;

/** Asks the parent [msg] and waits for its answer's message, or null: a timeout or a closed channel. */
function askParent(msg) {
	const id = challengeId++;
	return new Promise((resolve) => {
		const timer = setTimeout(() => {
			asked.delete(id);
			resolve(null);
		}, CHALLENGE_MS);
		asked.set(id, { resolve, timer });
		try {
			process.send({ ...msg, id });
		} catch {
			clearTimeout(timer);
			asked.delete(id);
			resolve(null);
		}
	});
}

const askChallenge = (url) =>
	askParent({ op: 'challenge', url }).then((m) => (m && m.ok && m.value ? m.value : null));

// ---- page mode: a check bound to the browser that solved it (doc/NOVELS.md; c335) ----------
// NovelFull and Scribble Hub refuse the clearance they just issued to any
// client but the solver's own browser (measured 2026-11-02). A host whose
// retry with a fresh clearance was still a check enters page mode then, for
// the refused memo's ten minutes (from that refusal, not extended by use):
// every request to it is a page the parent fetches through the solver, which
// checks the address first. It leaves when the ten minutes are up (the next
// request is the host's own again, and pays a solve and a retry), when TRY
// AGAIN forgets the site, or when the host process restarts. A page that is
// still a check, or that doesn't come, leaves it where it is: the ten minutes
// are what keep a download from paying a solve and a retry per chapter.

/** Set by fetchFile: a picture or a file can't come through the solver's browser, which renders pages. */
const WANTS_FILE = Symbol('wants a file');

function inPageMode(host) {
	const at = refused.get(host);
	return at !== undefined && Date.now() - at < refusedMs;
}

/** The hosts in page mode, and until when. */
function modes() {
	const out = {};
	for (const [host, at] of refused) if (Date.now() - at < refusedMs) out[host] = at + refusedMs;
	return out;
}

const pageTrouble = (host, why) =>
	`${host}'s page did not come through the solver (its check could not be passed): ${why}`;
const pageUnchecked = (host, why) => `${host}'s page was fetched and not used: ${why}`;

/**
 * Fails a page-mode request the solver was asked for and did not answer with
 * a page, for a reason a new solve may change: the solver's own failure, a
 * timeout, its browser dying, or a page that came back but whose last address
 * this app could not check (its own DNS, not the host's check). The phrase
 * "its check could not be passed" is what the browse page reads as a refused
 * check, and offers TRY AGAIN for, forgetting both memos (`again=1`). The
 * last of those (`unchecked`, c688) says no such thing, since no check
 * failed: its TRY AGAIN forgets nothing and asks the page again, which is a
 * new lookup, and pays no solve.
 */
function refusePage(host, why, unchecked = false) {
	const message = unchecked ? pageUnchecked(host, why) : pageTrouble(host, why);
	note(message);
	throw new Error(message);
}

/**
 * Fails a page-mode request the app answered, but never with a page, and for a
 * reason no solve can change: an address `checkPublic` refuses, one the
 * browser was redirected to off the internet, a document that is Chromium's
 * image page (c630). The sentence doesn't claim a check, so the browse page's
 * TRY AGAIN for it does not forget the memo (no `again=1`) and pays no new
 * solve: the host stays in page mode and the next call is one page again.
 */
function refuseFixed(host, why) {
	const message = `${host}'s page can't come through the solver, and no solve changes that: ${why}`;
	note(message);
	throw new Error(message);
}

/**
 * Fails a request page mode won't send at all, before anything is asked. No
 * check was involved, so the sentence doesn't claim one: the browse page's
 * TRY AGAIN for it does not forget the memo (no `again=1`), so it pays no new
 * solve. Also where an address this app could not look up lands (c630): the
 * solver's browser was never asked, and asking again asks the lookup again.
 */
function refuseShape(host, why) {
	const message = `${host}'s page can't come through the solver: ${why}`;
	note(message);
	throw new Error(message);
}

const FORM_ONLY = "the solver's browser posts a url-encoded form only";

/**
 * What the solver's browser can send for [opts]: GET, or POST with a
 * url-encoded form (FlareSolverr's request.post takes postData and nothing
 * else). A FormData of strings is that form (Scribble Hub's chapter list posts
 * one); a JSON, multipart or binary body, or a FormData holding a file, is
 * refused with a sentence, never sent as something it wasn't.
 */
function pageForm(host, opts) {
	const method = String(opts.method || 'GET').toUpperCase();
	if (method === 'GET' || method === 'HEAD') return { method: 'GET' };
	if (method !== 'POST')
		refuseShape(host, `the solver's browser sends GET and POST only, not ${method}`);
	const body = opts.body;
	if (body === undefined || body === null) return { method, postData: '' };
	if (body instanceof URLSearchParams) return { method, postData: body.toString() };
	if (body instanceof FormData) {
		for (const [, value] of body)
			if (typeof value !== 'string') refuseShape(host, `${FORM_ONLY}, and a file can't go in one`);
		return { method, postData: new URLSearchParams(body).toString() };
	}
	const type = (opts.headers && opts.headers.get('content-type')) || '';
	if (typeof body === 'string' && (!type || /application\/x-www-form-urlencoded/i.test(type)))
		return { method, postData: body };
	return refuseShape(host, `${FORM_ONLY}, not ${typeof body === 'string' ? type : 'this body'}`);
}

/** [url]'s page through the solver, as a Response whose url is where the browser ended. */
async function pageFetch(asked, url, opts, wantsFile) {
	const host = hostOf(url);
	if (wantsFile)
		refuseShape(host, "a file is not a page, and the solver's browser hands back pages only");
	const form = pageForm(host, opts);
	const m = await askParent({ op: 'page', url, ...form });
	if (!m) refusePage(host, 'the app did not answer');
	if (!m.ok || !m.value) {
		const why = String(m.error || 'the solver gave no page');
		// The app marks a refusal no new solve can change (c630): the address,
		// or a document that is not a page. Saying a check failed would make
		// the browse page's TRY AGAIN forget the memos for nothing.
		if (m.fixed) refuseFixed(host, why);
		// An address this app could not look up: the browser was never asked, so
		// it is the unsent family, and asking again asks the lookup again rather
		// than paying a solve for a DNS hiccup.
		if (m.unsent) refuseShape(host, why);
		refusePage(host, why, !!m.unchecked);
	}
	const page = m.value;
	const at = typeof page.url === 'string' && page.url ? page.url : url;
	// The parent checked the browser's last address is on the internet; this
	// host's own rule (its test ports included) holds for it too.
	try {
		await checkUrl(at);
	} catch (e) {
		note(e.message);
		throw e;
	}
	const status = Number(page.status) || 200;
	const empty = status === 204 || status === 205 || status === 304;
	const res = new Response(empty ? null : String(page.body ?? ''), {
		status,
		headers: { 'content-type': String(page.contentType || 'text/html; charset=utf-8') }
	});
	// A plugin resolves relative links against the page it got, which is the
	// one the browser ended on after its redirects, not the URL it asked.
	Object.defineProperty(res, 'url', { value: at });
	Object.defineProperty(res, 'redirected', { value: at !== url });
	noteAt(asked, at);
	if (await isChallenge(res))
		note(`${hostOf(at)} answered ${res.status} (its check could not be passed)`);
	else if (res.status >= 400) note(`${hostOf(at)} answered ${res.status}`);
	return res;
}

/** One solve per host at a time: a plugin asking in a loop waits on the first, not a queue. */
function challengeFor(url) {
	const host = hostOf(url);
	// A clearance this host just refused is not asked for again: the one request
	// the call makes is already a check, and there is nothing to retry with.
	const at = refused.get(host);
	if (at !== undefined && Date.now() - at < refusedMs) return Promise.resolve(null);
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
			const res = await guardedFetch(url, { ...withDefaults(init), [WANTS_FILE]: true });
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

/**
 * The address the chapter's own request ended at, or null when the plugin
 * asked for something else (an API, a cover): a chapter's pictures are
 * relative to the page it was read from, and a redirect moves that page
 * (c631). [path] is the chapter, as the plugin was given it.
 */
function chapterBase(t, site, path) {
	let own;
	try {
		own = new URL(path, site).href;
	} catch {
		return null;
	}
	for (let i = t.urls.length - 1; i >= 0; i--) if (t.urls[i].asked === own) return t.urls[i].at;
	return null;
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
	const t = { why: null, urls: [] };
	const value = await trouble.run(t, () => handle(m));
	if (t.why && empty(value)) throw new Error(t.why);
	return value;
}

async function handle(m) {
	if (m.op === 'config') {
		allowed = new Set(m.allow || []);
		if (typeof m.refusedMs === 'number' && m.refusedMs >= 0) refusedMs = m.refusedMs;
		return null;
	}
	if (m.op === 'forget') return forgetRefused(m.site);
	if (m.op === 'modes') return modes();
	const p = load(m.file);
	// A chapter and the page it came from (c631). Its HTML is the plugin's own
	// answer; the address is the one the chapter's request ended at, after any
	// redirect, so the server can resolve the chapter's relative pictures.
	if (m.op === 'chapter') {
		const path = String(m.path ?? '');
		const html = await p.parseChapter(path);
		const t = trouble.getStore();
		// fetchText answers '' on a site that failed it: the call's trouble is why.
		if (t.why && (typeof html !== 'string' || html === '')) throw new Error(t.why);
		return { html, url: chapterBase(t, p.site, path) };
	}
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
	// The app's answer to a site's check (a clearance for the host asked about,
	// or nothing) or to a page asked in page mode (the page, or why not).
	if (m && (m.op === 'challenge-result' || m.op === 'page-result')) {
		const wait = asked.get(m.id);
		if (!wait) return;
		asked.delete(m.id);
		clearTimeout(wait.timer);
		wait.resolve(m);
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

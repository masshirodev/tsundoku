// The fetcher's background: answers the content script's runtime messages.
// Everything it needs from the browser is passed in (fetcher/background.ts
// passes the real APIs), so the whole of it runs in a spec with fakes.

import { cookieHeader, cookieUrls, hasClearance, type CookieLike } from './cookies.ts';
import { decodeBody, encodeBody, type Transport, type WireBody } from './bytes.ts';
import { buildRule, FetcherError, normaliseTarget, planRequest, responseHeaders } from './plan.ts';
import {
	mayAnswer,
	type FetcherEdition,
	type SiteAccess,
	type FetcherResponse,
	type HeaderList,
	type MessageSenderLike
} from './protocol.ts';
import { siteOf, type SuffixRules } from './psl.ts';
import { builtInAllowed, guardRules, lookupRefusal, parseAllowEntry, refusal } from './reach.ts';
import { KeyedQueue, RuleIds } from './schedule.ts';
import { RequestWatch, type RequestEvent } from './watch.ts';

/** A request as it crosses from the content script: the body in the probed form. */
export interface WireRequest {
	url: string;
	method?: string;
	headers?: HeaderList;
	body?: WireBody | null;
}

export type WireResponse = Omit<FetcherResponse, 'body'> & { body: WireBody };

export type RuntimeRequest =
	{ kind: 'probe'; bytes: unknown } | { kind: 'fetch'; transport: Transport; request: WireRequest };

export type RuntimeReply =
	| { kind: 'probe'; bytes: unknown; access: SiteAccess }
	| { kind: 'fetched'; ok: true; response: WireResponse }
	| { kind: 'fetched'; ok: false; message: string };

export interface CookieQuery {
	url: string;
	partitionKey?: { topLevelSite: string };
}

export interface FetcherDeps {
	extensionId: string;
	/** The build's edition (fetcher/build.ts), which decides the origins answered. */
	edition: FetcherEdition;
	/** How much of the web the visitor let the extension reach, asked afresh. */
	siteAccess(): Promise<SiteAccess>;
	/** The Public Suffix List, parsed when first needed. */
	suffixes(): SuffixRules;
	getCookies(query: CookieQuery): Promise<CookieLike[]>;
	addRule(rule: ReturnType<typeof buildRule>): Promise<void>;
	removeRule(id: number): Promise<void>;
	/** Removes every session rule: run once, before the first is added. */
	clearRules(): Promise<void>;
	/**
	 * Replaces the guard's session rules (reach.ts, check 2): removes the ids
	 * given, adds the rules given, in one update.
	 */
	replaceRules(removeIds: number[], add: ReturnType<typeof guardRules>): Promise<void>;
	/** The hosts the reader allowed in the fetcher's options, as stored. */
	allowedHosts(): Promise<string[]>;
	/**
	 * The addresses a name resolves to, where the browser lets an extension
	 * ask before a request is sent (Firefox's `dns`); absent in Chromium.
	 */
	resolve?(host: string): Promise<string[]>;
	fetch(url: string, init: RequestInit): Promise<Response>;
}

export function createFetcherService(deps: FetcherDeps) {
	const ids = new RuleIds();
	const queue = new KeyedQueue();
	// Session rules outlive the background: a Chromium service worker or a
	// Firefox event page that was stopped mid-request leaves its rules behind,
	// and a fresh start would hand out their ids again. Requests never survive
	// the background, so every rule present at start is a leftover.
	const cleared = deps.clearRules().catch(() => undefined);

	// What the fetcher may reach on the reader's own network (reach.ts). The
	// guard's rules go in before the first request is sent; a fetcher that
	// could not install them sends nothing, rather than sending unguarded.
	let allowed: string[] = builtInAllowed(deps.edition);
	let guardIds: number[] = [];
	const watch = new RequestWatch(() => allowed);
	async function installGuard(reader: readonly string[]) {
		const entries = reader.map(parseAllowEntry).filter((e): e is string => e !== null);
		const next = [...new Set([...builtInAllowed(deps.edition), ...entries])];
		const rules = guardRules(next);
		await deps.replaceRules(guardIds, rules);
		guardIds = rules.map((r) => r.id);
		allowed = next;
	}
	const ready = cleared.then(async () => installGuard(await deps.allowedHosts()));
	// Each later change waits for the one before, so two never interleave.
	let guarding: Promise<unknown> = ready;

	async function readCookies(url: string) {
		const partitionKey = { topLevelSite: siteOf(url, deps.suffixes()) };
		const unpartitioned: CookieLike[] = [];
		const partitioned: CookieLike[] = [];
		for (const query of cookieUrls(url)) {
			unpartitioned.push(...(await deps.getCookies({ url: query })));
			try {
				partitioned.push(...(await deps.getCookies({ url: query, partitionKey })));
			} catch {
				// A browser without cookie partitions has none to give.
			}
		}
		const all = [...unpartitioned, ...partitioned];
		return { header: cookieHeader(unpartitioned, partitioned), clearance: hasClearance(all) };
	}

	/** fetch() and its body, with a network failure named as one. */
	async function send(url: string, init: RequestInit) {
		try {
			const response = await deps.fetch(url, init);
			return { response, bytes: new Uint8Array(await response.arrayBuffer()) };
		} catch (error) {
			// fetch() rejects with a TypeError worded differently by each browser.
			throw new FetcherError(`network error: ${error instanceof Error ? error.message : error}`);
		}
	}

	async function fetchOne(wire: WireRequest, transport: Transport): Promise<RuntimeReply> {
		const body = wire.body ? decodeBody(wire.body) : null;
		const request = { url: wire.url, method: wire.method, headers: wire.headers, body };
		const target = normaliseTarget(request);
		try {
			await ready;
		} catch (error) {
			throw new FetcherError(`the fetcher's guard could not be set up: ${describe(error)}`);
		}
		const refused = refusal(target.url, allowed);
		if (refused) throw new FetcherError(refused);
		return queue.run(`${target.method} ${target.url}`, async () => {
			// Read in turn, not before queueing: the request ahead may have been
			// answered with cookies this one must carry.
			const plan = planRequest(request, await readCookies(target.url));
			const id = ids.take();
			try {
				await deps.addRule(buildRule(id, plan));
			} catch (error) {
				ids.release(id);
				throw error;
			}
			const watching = watch.expect(plan.method, plan.url);
			try {
				let sent;
				try {
					sent = await send(plan.url, {
						method: plan.method,
						headers: plan.headers,
						body: body?.length ? body : undefined,
						// Cookies the site sets in reply are kept by the browser; the
						// Cookie header sent is the rule's (cookies.ts).
						credentials: 'include',
						// The page's Referer, if any, is the rule's; never the extension's.
						referrerPolicy: 'no-referrer',
						// The engine keeps its own cache, by the headers it reads.
						cache: 'no-store',
						redirect: 'follow'
					});
				} catch (error) {
					// A hop the guard's rules blocked fails as a bare network
					// error: what the watch saw is the reason to give.
					const why = await watching.done();
					throw why ? new FetcherError(why) : error;
				}
				// An answer from the reader's own network arrives as any other.
				const why = await watching.done();
				if (why) throw new FetcherError(why);
				const { response, bytes } = sent;
				const headers: HeaderList = [];
				response.headers.forEach((value, name) => headers.push([name, value]));
				return {
					kind: 'fetched' as const,
					ok: true as const,
					response: {
						status: response.status,
						statusText: response.statusText,
						url: response.url,
						redirected: response.redirected,
						headers: responseHeaders(headers),
						body: encodeBody(bytes, transport)
					}
				};
			} finally {
				// A rule that could not be removed keeps its id for good: handing
				// the id out again would fail to add, and the rule would still
				// match its URL. The removal's error reaches the page.
				await deps.removeRule(id);
				ids.release(id);
			}
		});
	}

	return {
		/**
		 * The reply to one runtime message, or null when it is not to be
		 * answered at all: a message from anywhere but this extension's content
		 * script on an allowed origin, or not one of the protocol's.
		 */
		answer(message: unknown, sender: MessageSenderLike): Promise<RuntimeReply> | null {
			if (!mayAnswer(sender, deps.extensionId, deps.edition)) return null;
			const m = message as Partial<RuntimeRequest> | null;
			if (m?.kind === 'probe') {
				// A browser that cannot say is treated as giving no access: the
				// page then tells the visitor to grant it, rather than failing later.
				return deps.siteAccess().then(
					(access) => ({ kind: 'probe' as const, bytes: m.bytes, access }),
					() => ({ kind: 'probe' as const, bytes: m.bytes, access: 'none' as const })
				);
			}
			if (m?.kind !== 'fetch' || !m.request) return null;
			return fetchOne(m.request, m.transport === 'binary' ? 'binary' : 'base64').catch(
				(error: unknown) => ({
					kind: 'fetched' as const,
					ok: false as const,
					message: describe(error)
				})
			);
		},
		/**
		 * A webRequest event before a request is sent (fetcher/background.ts).
		 * Where the browser can resolve names first (Firefox), a public name
		 * that resolves to the reader's own network is refused here, before
		 * anything is sent: `cancel` is the listener's answer.
		 */
		async requestStarted(event: RequestEvent): Promise<{ cancel: boolean }> {
			const watched = watch.started(event);
			if (!watched || watched.refused || !deps.resolve) return { cancel: false };
			const why = await lookupRefusal(event.url, allowed, deps.resolve).catch(() => null);
			if (!why) return { cancel: false };
			watch.refuse(event, why);
			return { cancel: true };
		},
		/** A webRequest event that names the address connected to: a redirect, or the answer. */
		requestConnected(event: RequestEvent): void {
			watch.connected(event);
		},
		/** A webRequest event that ends a request: it completed, or failed. */
		requestFinished(event: RequestEvent): void {
			watch.finished(event);
		},
		/** The reader changed the allowed hosts in the fetcher's options. */
		setAllowedHosts(hosts: string[]): Promise<void> {
			guarding = guarding.then(
				() => installGuard(hosts),
				() => installGuard(hosts)
			);
			return guarding as Promise<void>;
		},
		/** For specs: the hosts allowed now, built-in ones included. */
		get allowed(): readonly string[] {
			return allowed;
		},
		/** For specs: how many rule ids are held now. */
		get rulesInUse() {
			return ids.inUse;
		},
		/** For specs: how many requests are being watched. */
		get watching() {
			return watch.size;
		}
	};
}

function describe(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

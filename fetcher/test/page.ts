// The test page: tsundoku's real fetcher client, driven through every case the
// browser test asserts, with what it saw posted back to the server (Firefox
// cannot be read from directly: Playwright does not load add-ons there).
import { connectFetcher } from '../../src/lib/web/fetcher-client.ts';
import type { FetcherResponse } from '../../src/lib/fetcher/protocol.ts';
import { ENGINE_AGENT } from './shared.ts';

const label = new URLSearchParams(location.search).get('label') ?? 'page';
const port = location.port;
const clearanceSite = `http://localhost:${port}`;
const plainSite = `http://[::1]:${port}`;

function report(result: unknown) {
	return fetch(`/results?label=${label}`, { method: 'POST', body: JSON.stringify(result) });
}

function summary(response: FetcherResponse) {
	return {
		status: response.status,
		url: response.url,
		redirected: response.redirected,
		headers: response.headers,
		bytes: [...response.body],
		text: new TextDecoder().decode(response.body)
	};
}

async function attempt<T>(run: () => Promise<T>) {
	try {
		return { ok: true, value: await run() };
	} catch (error) {
		return { ok: false, error: error instanceof Error ? error.message : String(error) };
	}
}

async function main() {
	const connection = await connectFetcher(window, { timeoutMs: 5000 });
	if (connection.state !== 'ready') return report({ state: connection.state });
	const { fetcher } = connection;

	// The test visits the clearance site in a tab first, as a visitor would.
	for (let i = 0; i < 300; i++) {
		const { cookiesSet } = await (await fetch('/state')).json();
		if (cookiesSet) break;
		await new Promise((r) => setTimeout(r, 100));
	}

	const cases: Record<string, unknown> = {};
	cases.clearance = await attempt(async () =>
		summary(
			await fetcher.fetch({
				url: `${clearanceSite}/echo?case=clearance#fragment`,
				headers: [
					['User-Agent', ENGINE_AGENT],
					['Referer', `${clearanceSite}/from`],
					['Cookie', 'page=evil'],
					['Accept-Encoding', 'x-made-up'],
					['X-Tsundoku-Test', 'yes']
				]
			})
		)
	);
	cases.post = await attempt(async () =>
		summary(
			await fetcher.fetch({
				url: `${plainSite}/echo?case=post&binary=1`,
				method: 'post',
				headers: [
					['User-Agent', ENGINE_AGENT],
					['Origin', plainSite],
					['Content-Type', 'application/octet-stream']
				],
				body: Uint8Array.from({ length: 256 }, (_, i) => i)
			})
		)
	);
	cases.gzip = await attempt(async () =>
		summary(await fetcher.fetch({ url: `${plainSite}/echo?case=gzip&gzip=1` }))
	);
	cases.redirect = await attempt(async () =>
		summary(await fetcher.fetch({ url: `${plainSite}/redirect` }))
	);
	// Eight at once to one URL, each with its own Referer: each must arrive
	// with its own, which only holds if their rules never overlap.
	cases.same = await attempt(() =>
		Promise.all(
			Array.from({ length: 8 }, (_, i) =>
				fetcher
					.fetch({
						url: `${clearanceSite}/echo?case=same`,
						headers: [
							['Referer', `${clearanceSite}/ref/${i}`],
							['X-Seq', String(i)]
						]
					})
					.then((r) => r.status)
			)
		)
	);
	cases.many = await attempt(() =>
		Promise.all(
			Array.from({ length: 8 }, (_, i) =>
				fetcher
					.fetch({
						url: `${plainSite}/echo?case=many&n=${i}`,
						headers: [
							['User-Agent', `${ENGINE_AGENT} n${i}`],
							['Referer', `${plainSite}/ref/${i}`]
						]
					})
					.then((r) => r.status)
			)
		)
	);
	cases.unreachable = await attempt(() => fetcher.fetch({ url: 'http://127.0.0.1:1/' }));
	cases.notHttp = await attempt(() => fetcher.fetch({ url: 'file:///etc/hostname' }));

	return report({
		state: 'ready',
		protocol: fetcher.protocol,
		version: fetcher.version,
		transport: fetcher.transport,
		access: fetcher.access,
		userAgent: navigator.userAgent,
		cases
	});
}

main().catch((error) => report({ state: 'crashed', error: String(error) }));

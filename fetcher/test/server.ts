// The browser test's one server, playing both parts on one port: tsundoku's
// page at http://127.0.0.1 (an allowed origin), and the "sources" the page
// fetches through the extension at http://localhost (a site with a Cloudflare
// clearance cookie) and http://[::1] (a site with none). A site is scheme and
// host, never port, so the three hosts are three sites. The page posts what
// it saw to /results; every request a source received is kept in `received`,
// which is what the test asserts against.
import { createServer, type IncomingHttpHeaders } from 'node:http';
import type { AddressInfo } from 'node:net';
import { gzipSync } from 'node:zlib';
import { BINARY_ANSWER } from './shared.ts';

export interface Received {
	host: string;
	method: string;
	url: string;
	headers: IncomingHttpHeaders;
	body: number[];
}

export async function startServer(pageScript: string) {
	const received: Received[] = [];
	const results = new Map<string, unknown>();
	let cookiesSet = false;

	const server = createServer(async (req, res) => {
		const url = new URL(req.url ?? '/', `http://${req.headers.host}`);
		const chunks: Buffer[] = [];
		for await (const chunk of req) chunks.push(chunk as Buffer);
		const body = Buffer.concat(chunks);

		const send = (status: number, type: string, content: string | Buffer, extra = {}) => {
			res.writeHead(status, { 'content-type': type, 'cache-control': 'no-store', ...extra });
			res.end(content);
		};

		switch (url.pathname) {
			case '/page':
				return send(
					200,
					'text/html; charset=utf-8',
					'<!doctype html><meta charset="utf-8"><title>fetcher test</title><script src="/page.js"></script>'
				);
			case '/page.js':
				return send(200, 'text/javascript', pageScript);
			case '/set-cookies':
				// Visited in a tab, as the visitor would visit a source. The
				// partitioned one stands for Cloudflare's clearance: Secure is
				// required with Partitioned, and both browsers allow it over
				// http on localhost, which they count as a secure context.
				cookiesSet = true;
				res.setHeader('set-cookie', [
					'plain=p1; Path=/; SameSite=Lax',
					'cf_clearance=c1; Path=/; Secure; SameSite=None; Partitioned'
				]);
				return send(200, 'text/html', '<!doctype html><title>cookies set</title>');
			case '/state':
				return send(200, 'application/json', JSON.stringify({ cookiesSet }));
			case '/results':
				results.set(url.searchParams.get('label') ?? '', JSON.parse(body.toString('utf8')));
				return send(204, 'text/plain', '');
			case '/redirect':
				received.push(record());
				res.writeHead(302, { location: '/echo?case=redirected' });
				return res.end();
			case '/echo': {
				received.push(record());
				if (url.searchParams.has('binary')) {
					return send(200, 'application/octet-stream', Buffer.from(BINARY_ANSWER));
				}
				const json = JSON.stringify({ case: url.searchParams.get('case'), headers: req.headers });
				if (url.searchParams.has('gzip')) {
					return send(200, 'application/json', gzipSync(json), { 'content-encoding': 'gzip' });
				}
				return send(200, 'application/json', json);
			}
			default:
				return send(404, 'text/plain', 'not here');
		}

		function record(): Received {
			return {
				host: url.hostname,
				method: req.method ?? '',
				url: url.pathname + url.search,
				headers: req.headers,
				body: [...body]
			};
		}
	});

	// `::` takes IPv4 too, so 127.0.0.1, localhost and [::1] all reach it.
	await new Promise<void>((resolve) => server.listen(0, '::', resolve));
	const { port } = server.address() as AddressInfo;
	return {
		port,
		received,
		results,
		close: () => new Promise<void>((resolve) => server.close(() => resolve()))
	};
}

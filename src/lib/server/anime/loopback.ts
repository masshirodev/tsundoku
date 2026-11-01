import { randomBytes } from 'node:crypto';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { pipeline, Readable } from 'node:stream';
import { serveMedia, serveSubtitle, StreamError } from './streams.ts';

/**
 * The loopback proxy ffmpeg reads through (doc/ANIME.md, "Downloading"):
 * ffmpeg never fetches anything itself, so every fetch passes the same guard
 * as the player's (internet only, the engine only where the engine named
 * it). Downloads mux through it; episode pictures take a frame through it.
 */

let proxy: { server: Server; port: number; secret: string } | null = null;

/** The proxy, started once: only tsundoku's own two media routes, and only with the secret. */
export async function loopback(): Promise<{ port: number; secret: string }> {
	if (proxy) return proxy;
	const secret = randomBytes(24).toString('base64url');
	const server = createServer(async (req, res) => {
		if (req.headers['x-tsundoku'] !== secret) return res.writeHead(403).end();
		const m = /^\/api\/anime\/(media|subtitle)\/([A-Za-z0-9_-]{32})$/.exec(req.url ?? '');
		if (!m) return res.writeHead(404).end();
		try {
			const r =
				m[1] === 'media'
					? await serveMedia(m[2], (req.headers.range as string) ?? null)
					: await serveSubtitle(m[2]);
			res.writeHead(r.status, Object.fromEntries(r.headers));
			// pipeline, not pipe: a body that fails midway (the engine fetch's timeout
			// firing on a long stream) emitted 'error' with no listener, and that
			// ended the whole server, twice in its first 20 minutes on 2026.11.01.1.
			// Now the reader just sees its connection cut.
			if (r.body) pipeline(Readable.fromWeb(r.body as never), res, () => {});
			else res.end();
		} catch (e) {
			res.writeHead(e instanceof StreamError ? e.status : 502).end();
		}
	});
	await new Promise<void>((ok) => server.listen(0, '127.0.0.1', ok));
	server.unref();
	proxy = { server, port: (server.address() as AddressInfo).port, secret };
	return proxy;
}

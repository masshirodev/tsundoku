import { request } from 'node:http';
import { afterEach, describe, expect, it, vi } from 'vitest';

// The loopback proxy ffmpeg reads through (src/lib/server/anime/loopback.ts).
// A body that fails midway, as the engine fetch's timeout does on a long
// stream, emitted 'error' on a stream nobody listened to, and Node ended the
// whole server: twice in 2026.11.01.1's first twenty minutes on the
// workstation. It must cost the reader its connection, and nothing else.
const failMidway = vi.hoisted(() => ({ on: true }));
vi.mock('../src/lib/server/anime/streams.ts', () => {
	class StreamError extends Error {
		constructor(public status: number) {
			super(String(status));
		}
	}
	return {
		StreamError,
		serveSubtitle: async () => ({ status: 404, headers: new Headers(), body: null }),
		serveMedia: async () => {
			let sent = false;
			const body = new ReadableStream<Uint8Array>({
				pull(c) {
					if (!sent) {
						sent = true;
						c.enqueue(new TextEncoder().encode('first bytes'));
						return;
					}
					if (failMidway.on)
						c.error(new DOMException('The operation was aborted due to timeout', 'TimeoutError'));
					else c.close();
				}
			});
			return { status: 200, headers: new Headers({ 'content-type': 'video/mp2t' }), body };
		}
	};
});

const { loopback } = await import('../src/lib/server/anime/loopback.ts');

function get(port: number, secret: string): Promise<{ status: number; error: string | null }> {
	return new Promise((done) => {
		const req = request(
			{
				host: '127.0.0.1',
				port,
				path: `/api/anime/media/${'a'.repeat(32)}`,
				headers: { 'x-tsundoku': secret }
			},
			(res) => {
				res.on('data', () => {});
				res.on('end', () => done({ status: res.statusCode ?? 0, error: null }));
				res.on('error', (e) => done({ status: res.statusCode ?? 0, error: e.message }));
				res.on('aborted', () => done({ status: res.statusCode ?? 0, error: 'aborted' }));
			}
		);
		req.on('error', (e) => done({ status: 0, error: e.message }));
		req.end();
	});
}

describe('the loopback proxy', () => {
	const uncaught: unknown[] = [];
	const onUncaught = (e: unknown) => uncaught.push(e);
	afterEach(() => {
		process.off('uncaughtException', onUncaught);
	});

	it('cuts the connection when a body fails midway, and keeps serving', async () => {
		process.on('uncaughtException', onUncaught);
		const { port, secret } = await loopback();
		// The reader sees its connection end early (before or after the headers
		// reach it, depending on timing), never a whole body.
		const cut = await get(port, secret);
		expect(cut.error).not.toBeNull();
		// Give an unhandled 'error' its tick to surface, as it did in production.
		await new Promise((r) => setTimeout(r, 50));
		expect(uncaught).toEqual([]);
		// And the proxy still answers the next request whole.
		failMidway.on = false;
		expect(await get(port, secret)).toEqual({ status: 200, error: null });
	});
});

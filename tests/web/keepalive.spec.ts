import { describe, expect, it, vi } from 'vitest';
import { withoutKeepalive } from '../../web/keepalive.js';

// web/keepalive.js: Firefox sends a keepalive request past the service worker,
// so the web edition's page sends its own without the flag.
describe('the page’s fetch in the web edition', () => {
	const ORIGIN = 'https://tsundoku.lt';
	const seen = () => {
		const calls: [unknown, RequestInit | undefined][] = [];
		const fetch = vi.fn(async (input: unknown, init?: RequestInit) => {
			calls.push([input, init]);
			return new Response(null);
		});
		return {
			calls,
			wrapped: withoutKeepalive(fetch as unknown as typeof globalThis.fetch, ORIGIN)
		};
	};

	it('drops keepalive from a request to its own address, keeping the rest', async () => {
		const { calls, wrapped } = seen();
		await wrapped('/api/reading', { method: 'POST', body: 'x', keepalive: true });
		await wrapped(`${ORIGIN}/api/devices/sync`, { keepalive: true });
		await wrapped(new Request(`${ORIGIN}/api/x`), { keepalive: true });
		expect(calls.map(([, i]) => i?.keepalive)).toEqual([false, false, false]);
		expect(calls[0][1]).toMatchObject({ method: 'POST', body: 'x' });
	});

	it('leaves another site’s request, and a request without the flag, as they were', async () => {
		const { calls, wrapped } = seen();
		const init = { keepalive: true };
		await wrapped('https://elsewhere.example/beacon', init);
		await wrapped('/api/plain', { method: 'GET' });
		await wrapped('/api/none');
		expect(calls[0][1]).toBe(init);
		expect(calls[1][1]).toEqual({ method: 'GET' });
		expect(calls[2][1]).toBeUndefined();
	});
});

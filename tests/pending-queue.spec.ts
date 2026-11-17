import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The reader's offline progress queue (src/lib/cache/pending.ts; doc/OFFLINE.md,
 * "Reading offline doesn't lose stats"). The first flush after a reconnection
 * often meets a workstation still starting, and that answer must keep the queue.
 */

const KEY = 'tsundoku.pending';
let store: Map<string, string>;

beforeEach(() => {
	store = new Map();
	vi.stubGlobal('localStorage', {
		getItem: (k: string) => store.get(k) ?? null,
		setItem: (k: string, v: string) => void store.set(k, v),
		removeItem: (k: string) => void store.delete(k)
	});
});

afterEach(() => {
	vi.unstubAllGlobals();
	vi.resetModules();
});

const queued = () => JSON.parse(store.get(KEY) ?? '[]') as string[];

/** A fresh module with three events waiting, and fetch answering each call from `answers`. */
async function withQueue(answers: (number | 'network')[]) {
	const { flushPending, queuePending } = await import('$lib/cache/pending');
	for (const n of [1, 2, 3]) queuePending(`{"n":${n}}`);
	const sent: string[] = [];
	vi.stubGlobal(
		'fetch',
		vi.fn(async (_url: string, init: RequestInit) => {
			sent.push(String(init.body));
			const a = answers.shift() ?? 200;
			if (a === 'network') throw new TypeError('Failed to fetch');
			return new Response(null, { status: a });
		})
	);
	return { flushPending, sent };
}

describe('flushPending', () => {
	it('sends everything when the workstation takes it', async () => {
		const { flushPending, sent } = await withQueue([200, 200, 200]);
		await flushPending();
		expect(sent).toEqual(['{"n":1}', '{"n":2}', '{"n":3}']);
		expect(store.has(KEY)).toBe(false);
	});

	it.each([500, 502, 503, 504])('keeps every event on a %i', async (status) => {
		const { flushPending, sent } = await withQueue([status]);
		await flushPending();
		expect(sent).toHaveLength(1);
		expect(queued()).toEqual(['{"n":1}', '{"n":2}', '{"n":3}']);
	});

	it('keeps every event when nothing answers', async () => {
		const { flushPending } = await withQueue(['network']);
		await flushPending();
		expect(queued()).toEqual(['{"n":1}', '{"n":2}', '{"n":3}']);
	});

	it.each([401, 403, 408, 429])('keeps every event on a %i', async (status) => {
		const { flushPending } = await withQueue([status]);
		await flushPending();
		expect(queued()).toEqual(['{"n":1}', '{"n":2}', '{"n":3}']);
	});

	it.each([400, 404, 410])('drops only the event a %i refuses, and goes on', async (status) => {
		const { flushPending, sent } = await withQueue([200, status, 200]);
		await flushPending();
		expect(sent).toEqual(['{"n":1}', '{"n":2}', '{"n":3}']);
		expect(store.has(KEY)).toBe(false);
	});

	it('stops at a 503 after sending what went before, keeping the rest in order', async () => {
		const { flushPending } = await withQueue([200, 503]);
		await flushPending();
		expect(queued()).toEqual(['{"n":2}', '{"n":3}']);
	});
});

import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
	arrival,
	dismissRefused,
	flushHighlights,
	onQueueChange,
	queueHighlight,
	refusedHighlights,
	SOURCE_TRIES,
	takeBackHighlight,
	useQueueStore,
	waitingHighlights,
	type NewHighlight,
	type QueuedHighlight,
	type QueueStore
} from '$lib/cache/pending-highlights';

/**
 * The offline queue's rules (c842; doc/OFFLINE.md): one item per highlight, what
 * each answer means, and sending once. IndexedDB itself and the reconnection
 * are tests/highlights-queue-flow.e2e.ts's; this is a Map behind the same four
 * calls.
 */
function memory(): QueueStore & { items: Map<string, QueuedHighlight> } {
	const items = new Map<string, QueuedHighlight>();
	return {
		items,
		all: async () => [...items.values()],
		get: async (k) => items.get(k),
		put: async (i) => void items.set(i.key, i),
		remove: async (k) => void items.delete(k)
	};
}

const page = (n: number): NewHighlight => ({
	key: `7:${n}:`,
	url: '/api/highlights/pages',
	body: { entry: 7, page: n, pageEnd: null, rtl: false },
	entry: 7,
	label: `P. ${n + 1}`,
	series: 'Lamplighter'
});

let store: ReturnType<typeof memory>;
const fetchMock = vi.fn();
const answer = (status: number, body: unknown = { highlight: { id: 1 } }) =>
	new Response(status === 204 ? null : JSON.stringify(body), { status });

beforeEach(() => {
	store = memory();
	useQueueStore(store);
	fetchMock.mockReset();
	vi.stubGlobal('fetch', fetchMock);
});

describe('what an answer means', () => {
	it('every status family, in full', () => {
		const expected: [number | null, string][] = [
			[null, 'stop'],
			[200, 'sent'],
			[201, 'sent'],
			[400, 'refused'],
			[401, 'stop'],
			[403, 'stop'],
			[404, 'refused'],
			[410, 'refused'],
			[422, 'refused'],
			[500, 'stop'],
			[502, 'later'],
			[503, 'stop']
		];
		for (const [status, verb] of expected) expect(arrival(status, 0).do, String(status)).toBe(verb);
	});

	it('a source that never sends it is told, after its tries and not before', () => {
		expect(arrival(502, SOURCE_TRIES - 2)).toEqual({ do: 'later' });
		expect(arrival(502, SOURCE_TRIES - 1)).toEqual({ do: 'refused', why: 'source' });
	});

	it('says why', () => {
		expect(arrival(404, 0)).toEqual({ do: 'refused', why: 'gone' });
		expect(arrival(422, 0)).toEqual({ do: 'refused', why: 'refused' });
	});
});

describe('the queue', () => {
	it('two presses are one item, and ask nothing of the workstation', async () => {
		await queueHighlight(page(1), 10);
		await queueHighlight(page(1), 20);
		expect(await waitingHighlights()).toHaveLength(1);
		expect((await waitingHighlights())[0].at).toBe(10);
		expect(fetchMock).not.toHaveBeenCalled();
	});

	it('sends oldest first, once, and tells who is listening what the workstation made', async () => {
		await queueHighlight(page(2), 20);
		await queueHighlight(page(1), 10);
		fetchMock.mockImplementation(async () => answer(201));
		const seen: unknown[] = [];
		const off = onQueueChange((c) => seen.push(...c.sent.map((s) => s.item.key)));
		await flushHighlights();
		off();
		expect(fetchMock.mock.calls.map((c) => JSON.parse(c[1].body).page)).toEqual([1, 2]);
		expect(seen).toEqual(['7:1:', '7:2:']);
		expect(await waitingHighlights()).toEqual([]);
		// Nothing left to send: a second connection asks nothing.
		await flushHighlights();
		expect(fetchMock).toHaveBeenCalledTimes(2);
	});

	it('a connection that fails stops the rest and keeps them all', async () => {
		await queueHighlight(page(1), 10);
		await queueHighlight(page(2), 20);
		fetchMock.mockRejectedValue(new TypeError('network'));
		await flushHighlights();
		expect(fetchMock).toHaveBeenCalledTimes(1);
		expect(await waitingHighlights()).toHaveLength(2);
	});

	it('incognito turned on since is not a refusal: it stops, and everything waits', async () => {
		await queueHighlight(page(1), 10);
		await queueHighlight(page(2), 20);
		fetchMock.mockImplementation(async () => answer(403));
		await flushHighlights();
		expect(fetchMock).toHaveBeenCalledTimes(1);
		expect(await waitingHighlights()).toHaveLength(2);
		expect(await refusedHighlights()).toEqual([]);
	});

	it('a redirect to the sign-in page is not a highlight kept', async () => {
		await queueHighlight(page(1), 10);
		const r = answer(200);
		Object.defineProperty(r, 'redirected', { value: true });
		fetchMock.mockResolvedValue(r);
		await flushHighlights();
		expect(await waitingHighlights()).toHaveLength(1);
	});

	it('a refused one is kept to be told, the rest go on, and telling removes it', async () => {
		await queueHighlight(page(1), 10);
		await queueHighlight(page(2), 20);
		fetchMock
			.mockImplementationOnce(async () => answer(404))
			.mockImplementationOnce(async () => answer(201));
		await flushHighlights();
		const refused = await refusedHighlights();
		expect(refused.map((r) => [r.key, r.refused])).toEqual([['7:1:', 'gone']]);
		expect(await waitingHighlights()).toEqual([]);
		// It is not sent again.
		await flushHighlights();
		expect(fetchMock).toHaveBeenCalledTimes(2);
		await dismissRefused(['7:1:']);
		expect(store.items.size).toBe(0);
	});

	it('a source that failed waits for the next connection, and the rest go on', async () => {
		await queueHighlight(page(1), 10);
		await queueHighlight(page(2), 20);
		fetchMock
			.mockImplementationOnce(async () => answer(502))
			.mockImplementationOnce(async () => answer(201));
		await flushHighlights();
		expect((await waitingHighlights()).map((i) => [i.key, i.tries])).toEqual([['7:1:', 1]]);
	});

	it('its tries run out on the third failure, and it is told', async () => {
		await queueHighlight(page(1), 10);
		fetchMock.mockImplementation(async () => answer(502));
		for (let i = 0; i < SOURCE_TRIES; i++) await flushHighlights();
		expect(fetchMock).toHaveBeenCalledTimes(SOURCE_TRIES);
		expect((await refusedHighlights()).map((r) => r.refused)).toEqual(['source']);
	});

	it('a tab that dies between the POST and the removal sends it again, and that is the whole of the cost', async () => {
		await queueHighlight(page(1), 10);
		const remove = store.remove;
		store.remove = async () => {
			throw new Error('the tab died here');
		};
		fetchMock.mockImplementation(async () => answer(201));
		await flushHighlights();
		// Still there, because the removal never happened...
		expect(await waitingHighlights()).toHaveLength(1);
		store.remove = remove;
		// ...so the next open asks again, and the workstation answers the one it made.
		fetchMock.mockImplementation(async () => answer(200, { highlight: { id: 1 }, made: false }));
		await flushHighlights();
		expect(fetchMock).toHaveBeenCalledTimes(2);
		expect(await waitingHighlights()).toEqual([]);
	});

	it('two sends at once in a tab make one pass', async () => {
		await queueHighlight(page(1), 10);
		let release: (r: Response) => void = () => {};
		fetchMock.mockImplementation(() => new Promise((r) => (release = r)));
		const a = flushHighlights();
		const b = flushHighlights();
		await b;
		await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
		release(answer(201));
		await a;
		expect(fetchMock).toHaveBeenCalledTimes(1);
	});

	it('taken back before it is sent, nothing is asked', async () => {
		await queueHighlight(page(1), 10);
		await takeBackHighlight('7:1:');
		await flushHighlights();
		expect(fetchMock).not.toHaveBeenCalled();
	});

	it('taken back while the sender is on its way to it, it is not sent', async () => {
		await queueHighlight(page(1), 10);
		await queueHighlight(page(2), 20);
		fetchMock.mockImplementationOnce(async () => {
			await takeBackHighlight('7:2:');
			return answer(201);
		});
		await flushHighlights();
		expect(fetchMock).toHaveBeenCalledTimes(1);
		expect(store.items.size).toBe(0);
	});

	it('storage that refuses says so, so the press can', async () => {
		store.put = async () => {
			throw new Error('quota');
		};
		expect(await queueHighlight(page(1), 10)).toBe(false);
	});
});

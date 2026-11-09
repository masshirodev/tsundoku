import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
	arrival,
	dismissRefused,
	flushHighlights,
	onQueueChange,
	queueHighlight,
	refusedDetail,
	refusedHighlights,
	RETRY_MS,
	SOURCE_TRIES,
	SOURCE_WAIT_MS,
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
	label: `P. ${n + 1}`
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

// A timer a case left behind is not the next case's.
afterEach(() => useQueueStore(memory()));

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

describe('pressing a page again', () => {
	it('a refused page pressed again is a fresh item: one ask, and it goes', async () => {
		await queueHighlight(page(1), 10);
		fetchMock.mockImplementationOnce(async () => answer(404));
		await flushHighlights();
		expect(await refusedHighlights()).toHaveLength(1);

		expect(await queueHighlight(page(1), 50)).toBe(true);
		expect(await refusedHighlights()).toEqual([]);
		expect((await waitingHighlights())[0]).toMatchObject({ at: 50, tries: 0, refused: null });

		fetchMock.mockReset();
		fetchMock.mockImplementation(async () => answer(201));
		await flushHighlights();
		expect(fetchMock).toHaveBeenCalledTimes(1);
		expect(store.items.size).toBe(0);
	});

	it('pressed again while it waits, it is left exactly as it was', async () => {
		await queueHighlight(page(1), 10);
		fetchMock.mockImplementationOnce(async () => answer(502));
		await flushHighlights();
		const before = (await waitingHighlights())[0];
		expect(before).toMatchObject({ at: 10, tries: 1 });
		await queueHighlight(page(1), 99);
		expect((await waitingHighlights())[0]).toEqual(before);
	});

	it('a DISMISS left on screen does not take a page pressed again since', async () => {
		await queueHighlight(page(1), 10);
		fetchMock.mockImplementationOnce(async () => answer(404));
		await flushHighlights();
		await queueHighlight(page(1), 50);
		await dismissRefused(['7:1:']);
		expect(await waitingHighlights()).toHaveLength(1);
	});

	it('the reason never says why a 404 was one, and no item carries a title', async () => {
		expect(refusedDetail('gone')).not.toMatch(/hidden/i);
		await queueHighlight(page(1), 10);
		expect(Object.keys((await waitingHighlights())[0])).not.toContain('series');
	});
});

describe('keeping on trying while anything waits', () => {
	beforeEach(() => {
		vi.useFakeTimers();
	});
	afterEach(() => {
		vi.useRealTimers();
		vi.unstubAllGlobals();
	});
	const down = () => fetchMock.mockRejectedValue(new TypeError('network'));
	const up = () => {
		fetchMock.mockReset();
		fetchMock.mockImplementation(async () => answer(201));
	};

	it('a flush asked for during a pass runs once more after it', async () => {
		await queueHighlight(page(1), 10);
		let release: (r: Response) => void = () => {};
		fetchMock.mockImplementationOnce(() => new Promise((r) => (release = r)));
		fetchMock.mockImplementation(async () => answer(201));
		const pass = flushHighlights();
		await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
		// It reads its list at the start, so only a second pass can find this one.
		await queueHighlight(page(2), 20);
		await flushHighlights();
		release(answer(201));
		await pass;
		expect(fetchMock.mock.calls.map((c) => JSON.parse(c[1].body).page)).toEqual([1, 2]);
	});

	it('with nothing waiting it asks nothing and leaves no timer', async () => {
		await flushHighlights();
		await vi.advanceTimersByTimeAsync(RETRY_MS * 4);
		expect(fetchMock).not.toHaveBeenCalled();
		expect(vi.getTimerCount()).toBe(0);
	});

	it('tries on a timer while it waits, and the timer ends with the queue', async () => {
		await queueHighlight(page(1), 10);
		down();
		await flushHighlights();
		expect(fetchMock).toHaveBeenCalledTimes(1);
		expect(vi.getTimerCount()).toBe(1);
		await vi.advanceTimersByTimeAsync(RETRY_MS);
		expect(fetchMock).toHaveBeenCalledTimes(2);

		up();
		await vi.advanceTimersByTimeAsync(RETRY_MS);
		expect(fetchMock).toHaveBeenCalledTimes(1);
		expect(store.items.size).toBe(0);
		expect(vi.getTimerCount()).toBe(0);
		await vi.advanceTimersByTimeAsync(RETRY_MS * 4);
		expect(fetchMock).toHaveBeenCalledTimes(1);
	});

	it('a press starts the trying by itself, with no flush asked for', async () => {
		fetchMock.mockImplementation(async () => answer(201));
		await queueHighlight(page(1), 10);
		expect(vi.getTimerCount()).toBe(1);
		await vi.advanceTimersByTimeAsync(RETRY_MS);
		expect(fetchMock).toHaveBeenCalledTimes(1);
		expect(store.items.size).toBe(0);
	});

	it('a press landing as a pass ends keeps its timer', async () => {
		fetchMock.mockImplementation(async () => answer(201));
		const all = store.all;
		let reads = 0;
		store.all = async () => {
			const seen = await all();
			// The second read is the one that decides whether anything still waits.
			if (++reads === 2) await queueHighlight(page(1), 10);
			return seen;
		};
		await flushHighlights();
		expect(store.items.size).toBe(1);
		expect(vi.getTimerCount()).toBe(1);
	});

	it('only a refused one left is not worth a timer', async () => {
		await queueHighlight(page(1), 10);
		fetchMock.mockImplementation(async () => answer(404));
		await flushHighlights();
		expect(await refusedHighlights()).toHaveLength(1);
		expect(vi.getTimerCount()).toBe(0);
	});

	it('coming back to the app tries at once, and only while something waits', async () => {
		const doc = Object.assign(new EventTarget(), { visibilityState: 'hidden' });
		vi.stubGlobal('document', doc);
		await queueHighlight(page(1), 10);
		down();
		await flushHighlights();
		expect(fetchMock).toHaveBeenCalledTimes(1);

		doc.dispatchEvent(new Event('visibilitychange'));
		await vi.advanceTimersByTimeAsync(0);
		expect(fetchMock).toHaveBeenCalledTimes(1);

		doc.visibilityState = 'visible';
		up();
		doc.dispatchEvent(new Event('visibilitychange'));
		await vi.advanceTimersByTimeAsync(0);
		expect(fetchMock).toHaveBeenCalledTimes(1);
		expect(store.items.size).toBe(0);

		doc.dispatchEvent(new Event('visibilitychange'));
		await vi.advanceTimersByTimeAsync(0);
		expect(fetchMock).toHaveBeenCalledTimes(1);
	});

	it('a device that says it is offline is asked nothing, and goes on waiting', async () => {
		vi.stubGlobal('navigator', { onLine: false });
		await queueHighlight(page(1), 10);
		await vi.advanceTimersByTimeAsync(RETRY_MS * 2);
		expect(fetchMock).not.toHaveBeenCalled();
		expect(vi.getTimerCount()).toBe(1);
	});

	it.each([404, 502])("DON'T SEND during its POST: a %i does not bring it back", async (status) => {
		await queueHighlight(page(1), 10);
		fetchMock.mockImplementationOnce(async () => {
			await takeBackHighlight('7:1:');
			return answer(status);
		});
		await flushHighlights();
		expect(store.items.size).toBe(0);
		expect(vi.getTimerCount()).toBe(0);
	});

	it("a source that failed is left alone for a while, not spent on the connection's timer", async () => {
		await queueHighlight(page(1), 10);
		fetchMock.mockImplementation(async () => answer(502));
		await flushHighlights();
		expect(fetchMock).toHaveBeenCalledTimes(1);
		await vi.advanceTimersByTimeAsync(SOURCE_WAIT_MS - RETRY_MS);
		expect(fetchMock).toHaveBeenCalledTimes(1);
		await vi.advanceTimersByTimeAsync(RETRY_MS * 2);
		expect(fetchMock).toHaveBeenCalledTimes(2);
	});

	it('its tries run out on the third failure, and it is told', async () => {
		await queueHighlight(page(1), 10);
		fetchMock.mockImplementation(async () => answer(502));
		await flushHighlights();
		await vi.advanceTimersByTimeAsync(
			SOURCE_WAIT_MS * (SOURCE_TRIES - 1) + RETRY_MS * SOURCE_TRIES
		);
		expect(fetchMock).toHaveBeenCalledTimes(SOURCE_TRIES);
		expect((await refusedHighlights()).map((r) => r.refused)).toEqual(['source']);
		expect(vi.getTimerCount()).toBe(0);
	});

	it('a change says what a pass refused, so a reader tells it once', async () => {
		await queueHighlight(page(1), 10);
		const told: string[][] = [];
		const off = onQueueChange((c) => told.push(c.refused.map((r) => r.key)));
		fetchMock.mockImplementation(async () => answer(404));
		await flushHighlights();
		await queueHighlight(page(2), 20);
		off();
		expect(told).toEqual([['7:1:'], []]);
	});
});

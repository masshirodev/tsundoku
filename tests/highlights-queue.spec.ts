import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
	arrival,
	carriedBy,
	dismissRefused,
	flushHighlights,
	isQuoteKey,
	onQueueChange,
	queueCovering,
	queueHighlight,
	quoteKey,
	refusedDetail,
	refusedHighlights,
	reviseHighlight,
	RETRY_MS,
	SOURCE_TRIES,
	SOURCE_WAIT_MS,
	supersedeHighlight,
	supersededKeys,
	takeBackHighlight,
	useQueueStore,
	waitingHighlights,
	type NewHighlight,
	type QueuedHighlight,
	type QueueStore
} from '$lib/cache/pending-highlights';

/**
 * The offline queue's rules (doc/OFFLINE.md): one item per highlight, what
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

/**
 * A store whose reads and deletes take a real turn, as IndexedDB's do: the
 * race between a take-back and the press that covers it needs the two to
 * interleave, and a Map resolves both in one microtask.
 */
function slow(): QueueStore & { items: Map<string, QueuedHighlight> } {
	const items = new Map<string, QueuedHighlight>();
	const turn = () => new Promise<void>((ok) => setTimeout(ok, 2));
	return {
		items,
		all: async () => {
			await turn();
			return [...items.values()];
		},
		get: async (k) => {
			await turn();
			return items.get(k);
		},
		put: async (i) => {
			await turn();
			items.set(i.key, i);
		},
		remove: async (k) => {
			await turn();
			items.delete(k);
		}
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

	it('a take-back still landing does not swallow the press that covers it', async () => {
		// `keepSpan`'s order, in one tick: the supersede, then the covering
		// press, with nothing awaited between them. On a store that takes real
		// turns, an unsequenced press reads the item it is replacing, writes
		// nothing, and the take-back's removal leaves the queue empty.
		const s = slow();
		useQueueStore(s);
		expect(await queueHighlight(page(1), 10)).toBe(true);
		const taken = supersedeHighlight('7:1:');
		const pressed = queueHighlight(page(1), 20);
		await taken;
		expect(await pressed).toBe(true);
		const items = await waitingHighlights();
		expect(items).toHaveLength(1);
		expect(items[0]).toMatchObject({ key: '7:1:', at: 20 });
		expect(fetchMock).not.toHaveBeenCalled();
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

describe('a quote waits like a page', () => {
	const key = 'quote:9:0.0-0.5';
	const quote = (body: Record<string, unknown>): NewHighlight => ({
		key,
		url: '/api/highlights/quotes',
		body,
		entry: 9,
		label: '¶ 1'
	});
	it('its key says it is a quote, and a page key does not', () => {
		expect(isQuoteKey(key)).toBe(true);
		expect(isQuoteKey('7:2:')).toBe(false);
		expect(quoteKey(9, 0, 0, 0, 5)).toBe(key);
	});
	it('what waits can change before it goes', async () => {
		await queueHighlight(quote({ note: '' }), 1);
		await reviseHighlight(key, { note: 'mine', colour: 'blue' });
		const [item] = await waitingHighlights();
		expect(item.body).toEqual({ note: 'mine', colour: 'blue' });
		fetchMock.mockResolvedValue(answer(201));
		await flushHighlights();
		expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({ note: 'mine', colour: 'blue' });
	});
	it('a revision of what is not waiting is nothing', async () => {
		await reviseHighlight(key, { note: 'x' });
		expect(await waitingHighlights()).toEqual([]);
		expect(store.items.size).toBe(0);
	});
	it('a refused quote keeps no words on the device', async () => {
		await queueHighlight(quote({ quote: 'the words of the book' }), 1);
		fetchMock.mockResolvedValue(answer(404));
		await flushHighlights();
		const [told] = await refusedHighlights();
		expect(told.refused).toBe('gone');
		expect(JSON.stringify(told)).not.toContain('the words of the book');
		expect(told.body).toEqual({});
	});

	describe('what happens to a quote while its POST is out', () => {
		/** Runs `during` while the POST is held, then answers it. */
		const holding = (during: () => Promise<unknown>, status = 201, body?: unknown) =>
			fetchMock.mockImplementationOnce(async () => {
				await during();
				return answer(status, body);
			});
		const made = (over: Record<string, unknown> = {}) => ({
			highlight: { id: 41, note: '', colour: 'yellow', ...over },
			made: true,
			folded: []
		});
		const calls = (method: string) =>
			fetchMock.mock.calls.filter((c) => (c[1] as RequestInit).method === method);

		it('a revision during the held POST is sent after it, and the answer says so', async () => {
			await queueHighlight(quote({ note: '', colour: 'yellow' }), 1);
			holding(() => reviseHighlight(key, { note: 'typed during the POST' }), 201, made());
			fetchMock.mockResolvedValueOnce(answer(200, { ok: true }));
			const told: unknown[] = [];
			const off = onQueueChange((c) => told.push(...c.sent.map((s) => s.answer)));
			await flushHighlights();
			off();
			const [patch] = calls('PATCH');
			expect(patch[0]).toBe('/api/highlights/41');
			expect(JSON.parse((patch[1] as RequestInit).body as string)).toEqual({
				note: 'typed during the POST'
			});
			expect(store.items.size).toBe(0);
			expect(told).toEqual([
				expect.objectContaining({
					highlight: expect.objectContaining({ id: 41, note: 'typed during the POST' })
				})
			]);
		});

		it('a note the POST carried is replaced by the reader’s next, not appended to', async () => {
			await queueHighlight(quote({ note: 'abc', colour: 'yellow' }), 1);
			holding(() => reviseHighlight(key, { note: 'xyz' }), 201, made({ note: 'abc' }));
			fetchMock.mockResolvedValueOnce(answer(200, { ok: true }));
			await flushHighlights();
			expect(JSON.parse((calls('PATCH')[0][1] as RequestInit).body as string)).toEqual({
				note: 'xyz'
			});
		});

		it('a note the row had first is merged, not replaced', async () => {
			await queueHighlight(quote({ note: '', colour: 'yellow' }), 1);
			holding(() => reviseHighlight(key, { note: 'mine' }), 200, {
				...made({ note: 'on the row' }),
				made: false
			});
			fetchMock.mockResolvedValueOnce(answer(200, { ok: true }));
			await flushHighlights();
			expect(JSON.parse((calls('PATCH')[0][1] as RequestInit).body as string)).toEqual({
				note: 'on the row\n\nmine'
			});
		});

		it('a colour chosen while it waited is set on a row that was already there', async () => {
			await queueHighlight(quote({ note: '', colour: 'yellow' }), 1);
			await reviseHighlight(key, { colour: 'blue' });
			fetchMock.mockResolvedValueOnce(answer(200, { ...made({ colour: 'orange' }), made: false }));
			fetchMock.mockResolvedValueOnce(answer(200, { ok: true }));
			await flushHighlights();
			expect(JSON.parse((calls('PATCH')[0][1] as RequestInit).body as string)).toEqual({
				colour: 'blue'
			});
		});

		it('a colour nobody chose leaves the row’s alone', async () => {
			await queueHighlight(quote({ note: '', colour: 'yellow' }), 1);
			fetchMock.mockResolvedValueOnce(answer(200, { ...made({ colour: 'orange' }), made: false }));
			await flushHighlights();
			expect(calls('PATCH')).toHaveLength(0);
			expect(store.items.size).toBe(0);
		});

		it('nothing revised asks nothing after the POST', async () => {
			await queueHighlight(quote({ note: 'n', colour: 'yellow' }), 1);
			fetchMock.mockResolvedValueOnce(answer(201, made({ note: 'n' })));
			await flushHighlights();
			expect(fetchMock).toHaveBeenCalledTimes(1);
			expect(store.items.size).toBe(0);
		});

		it('a revision the workstation did not take keeps it waiting, with the words', async () => {
			await queueHighlight(quote({ note: '', colour: 'yellow' }), 1);
			holding(() => reviseHighlight(key, { note: 'still mine' }), 201, made());
			fetchMock.mockResolvedValueOnce(answer(500));
			await flushHighlights();
			expect(store.items.size).toBe(1);
			const [item] = await waitingHighlights();
			expect(item.body.note).toBe('still mine');
		});

		it('the POST sends what the row says when it goes, not what the list read', async () => {
			await queueHighlight(page(1), 1);
			await queueHighlight(quote({ note: 'old', colour: 'yellow' }), 2);
			// The first POST is held, and this one's note changes behind the list.
			holding(() => reviseHighlight(key, { note: 'newer' }), 201);
			fetchMock.mockResolvedValueOnce(answer(201, made({ note: 'newer' })));
			await flushHighlights();
			expect(JSON.parse((fetchMock.mock.calls[1][1] as RequestInit).body as string).note).toBe(
				'newer'
			);
		});

		it('a revision of what has just been sent says it took nothing', async () => {
			await queueHighlight(quote({ note: '', colour: 'yellow' }), 1);
			expect(await reviseHighlight(key, { note: 'waits' })).toBe(true);
			fetchMock.mockResolvedValueOnce(answer(201, made({ note: 'waits' })));
			await flushHighlights();
			expect(await reviseHighlight(key, { note: 'too late' })).toBe(false);
		});

		it('taken back during a POST that made it: what it made is set aside', async () => {
			await queueHighlight(quote({ note: '', colour: 'yellow' }), 1);
			holding(() => takeBackHighlight(key), 201, made());
			fetchMock.mockResolvedValueOnce(answer(200, { ok: true }));
			const told: string[] = [];
			const off = onQueueChange((c) => told.push(...c.sent.map((s) => s.item.key)));
			await flushHighlights();
			off();
			const [del] = calls('DELETE');
			expect(del[0]).toBe('/api/highlights/41');
			expect(store.items.size).toBe(0);
			expect(told).toEqual([]);
		});

		it('superseded during a POST that made it: the join keeps the row, so no DELETE', async () => {
			// A selection joins a waiting quote: its take-back is 'the press
			// covers this', not 'not wanted'. The workstation makes the row this
			// POST asks for, then folds it into the covering press's row and keeps
			// its id, so a DELETE here would take the join and its note away.
			await queueHighlight(quote({ note: 'kept by the join', colour: 'yellow' }), 1);
			holding(() => supersedeHighlight(key), 201, made());
			await flushHighlights();
			// The POST really ran: the absence of a DELETE is not a POST that never was.
			expect(calls('POST')).toHaveLength(1);
			expect(calls('DELETE')).toHaveLength(0);
			expect(store.items.size).toBe(0);
		});

		it('superseded before its POST was out: a later take-back still says the DELETE', async () => {
			// The record names the item it was made for, not the key forever: a
			// take-back with nothing on its way leaves one nobody will consume.
			await queueHighlight(quote({ note: '', colour: 'yellow' }), 1);
			await supersedeHighlight(key);
			expect(await waitingHighlights()).toEqual([]);
			// The same key waits again from elsewhere (a second tab's press), and
			// this time it is genuinely not wanted while its POST is out.
			await store.put({
				...quote({ note: '', colour: 'yellow' }),
				at: 9,
				tries: 0,
				refused: null
			});
			holding(() => takeBackHighlight(key), 201, made());
			await flushHighlights();
			expect(calls('POST')).toHaveLength(1);
			expect(calls('DELETE')).toHaveLength(1);
			expect(store.items.size).toBe(0);
		});

		it('superseded during a POST that answered an existing row: no DELETE, and the item goes', async () => {
			await queueHighlight(quote({ note: '', colour: 'yellow' }), 1);
			holding(() => supersedeHighlight(key), 200, { ...made(), made: false });
			await flushHighlights();
			expect(calls('POST')).toHaveLength(1);
			expect(calls('DELETE')).toHaveLength(0);
			expect(store.items.size).toBe(0);
		});

		it('a re-queue of a superseded key clears the record the take-back left', async () => {
			// A join refused at the workstation puts back what it took in: the item
			// is written anew under the same key, and that clears the record, so a
			// later POST's end cannot mistake the new item for the old one's.
			await queueHighlight(quote({ note: 'kept by the join', colour: 'yellow' }), 1);
			await supersedeHighlight(key);
			expect(supersededKeys()).toEqual([key]);
			await queueHighlight(quote({ note: 'kept by the join', colour: 'yellow' }), 2);
			expect(supersededKeys()).toEqual([]);
			expect((await waitingHighlights()).map((i) => i.at)).toEqual([2]);
		});

		it('superseded and pressed again during the POST: the row stands, and the item goes', async () => {
			// The exact re-press of the same span: the same key, a new incarnation.
			await queueHighlight(quote({ note: '', colour: 'yellow' }), 1);
			holding(
				async () => {
					await supersedeHighlight(key);
					await queueHighlight(quote({ note: '', colour: 'yellow' }), 2);
				},
				201,
				made()
			);
			await flushHighlights();
			expect(calls('POST')).toHaveLength(1);
			expect(calls('DELETE')).toHaveLength(0);
			expect(store.items.size).toBe(0);
		});

		it('superseded during a POST that was refused: the item goes, and nothing is left behind', async () => {
			await queueHighlight(quote({ note: '', colour: 'yellow' }), 1);
			holding(() => supersedeHighlight(key), 404);
			await flushHighlights();
			expect(calls('POST')).toHaveLength(1);
			expect(calls('DELETE')).toHaveLength(0);
			expect(store.items.size).toBe(0);
			expect(await refusedHighlights()).toEqual([]);
			// Nothing will ever consume the record: this end clears it.
			expect(supersededKeys()).toEqual([]);
		});

		it('superseded during a POST that stops: the record is cleared, and the next pass has nothing', async () => {
			await queueHighlight(quote({ note: '', colour: 'yellow' }), 1);
			fetchMock.mockImplementationOnce(async () => {
				await supersedeHighlight(key);
				throw new TypeError('the connection dropped');
			});
			await flushHighlights();
			expect(calls('POST')).toHaveLength(1);
			expect(await waitingHighlights()).toEqual([]);
			// The item is gone and no `landed` will read the record: this end is
			// its last chance to clear it.
			expect(supersededKeys()).toEqual([]);
			fetchMock.mockReset();
			fetchMock.mockImplementation(async () => answer(201));
			await flushHighlights();
			expect(fetchMock).not.toHaveBeenCalled();
		});

		it('a press covering it during a refused POST leaves the new item refused, not DELETEd', async () => {
			await queueHighlight(quote({ note: '', colour: 'yellow' }), 1);
			holding(async () => {
				await supersedeHighlight(key);
				await queueHighlight(quote({ note: '', colour: 'yellow' }), 2);
			}, 404);
			await flushHighlights();
			expect(calls('POST')).toHaveLength(1);
			expect(calls('DELETE')).toHaveLength(0);
			expect((await refusedHighlights()).map((i) => i.at)).toEqual([2]);
		});

		it('a second join takes back the first join’s waiting item while its POST is out', async () => {
			const first = 'quote:9:0.0-0.5';
			const second = 'quote:9:0.0-0.9';
			await queueHighlight({ ...quote({ note: 'the join’s note' }), key: first }, 1);
			holding(
				async () => {
					await supersedeHighlight(first);
					await queueHighlight({ ...quote({ note: 'the join’s note' }), key: second }, 2);
				},
				201,
				made()
			);
			await flushHighlights();
			expect(calls('POST')).toHaveLength(1);
			expect(calls('DELETE')).toHaveLength(0);
			// The first join's row was folded into the second's press, not DELETEd.
			const left = await waitingHighlights();
			expect(left.map((i) => i.key)).toEqual([second]);
		});

		it('taken back during a POST that answered an existing row: that row is left alone', async () => {
			await queueHighlight(quote({ note: '', colour: 'yellow' }), 1);
			holding(() => takeBackHighlight(key), 200, { ...made(), made: false });
			await flushHighlights();
			expect(calls('DELETE')).toHaveLength(0);
			expect(store.items.size).toBe(0);
		});

		it('taken back and pressed again during the POST: the row stands, and the item goes', async () => {
			await queueHighlight(quote({ note: '', colour: 'yellow' }), 1);
			holding(
				async () => {
					await takeBackHighlight(key);
					await queueHighlight(quote({ note: '', colour: 'yellow' }), 2);
				},
				201,
				made()
			);
			await flushHighlights();
			expect(calls('DELETE')).toHaveLength(0);
			expect(store.items.size).toBe(0);
		});

		it('an answer that is not JSON is still sent: it leaves the queue', async () => {
			await queueHighlight(quote({ note: '', colour: 'yellow' }), 1);
			fetchMock.mockResolvedValueOnce(new Response('not json', { status: 201 }));
			await flushHighlights();
			expect(store.items.size).toBe(0);
		});

		it('every item is told as it lands, so a late note finds its row', async () => {
			await queueHighlight(page(1), 1);
			await queueHighlight(page(2), 2);
			fetchMock.mockImplementation(async () => answer(201));
			const sizes: number[] = [];
			const off = onQueueChange((c) => {
				if (c.sent.length) sizes.push(store.items.size);
			});
			await flushHighlights();
			off();
			expect(sizes).toEqual([1, 0]);
		});
	});

	describe('what a queued join covers', () => {
		/** The waiting quote a join takes in: its own key, with the note a refusal must keep. */
		const covered: NewHighlight = {
			key: 'quote:9:0.0-0.2',
			url: '/api/highlights/quotes',
			body: {
				entry: 9,
				block: 0,
				offset: 0,
				endBlock: 0,
				endOffset: 2,
				quote: 'two',
				note: 'the note the refusal must keep',
				colour: 'yellow'
			},
			entry: 9,
			label: '¶ 1'
		};
		const made = (over: Record<string, unknown> = {}) => ({
			highlight: { id: 41, note: '', colour: 'yellow', ...over },
			made: true,
			folded: []
		});
		/** The press that covers it: a union span, its item carrying `covers`. */
		const join = (covers: NewHighlight[]): NewHighlight => ({
			key: 'quote:9:0.0-0.9',
			url: '/api/highlights/quotes',
			body: {
				entry: 9,
				block: 0,
				offset: 0,
				endBlock: 0,
				endOffset: 9,
				note: '',
				colour: 'yellow'
			},
			entry: 9,
			label: '¶ 1',
			covers
		});
		/** A quote waits, then a join takes it in and goes on waiting in its place. */
		async function waitingJoin(cover: NewHighlight = covered) {
			await queueHighlight(cover, 1);
			await supersedeHighlight(cover.key);
			const press = join([cover]);
			await queueHighlight(press, 2);
			return press;
		}

		it('refused: puts back what it covered, with its note, and clears the record', async () => {
			const press = await waitingJoin();
			expect(supersededKeys()).toEqual([covered.key]);
			fetchMock.mockImplementationOnce(async () => answer(400));
			await flushHighlights();
			const waiting = await waitingHighlights();
			expect(waiting.map((i) => i.key)).toEqual([covered.key]);
			expect(waiting[0].body).toEqual(covered.body);
			expect(await refusedHighlights()).toEqual([
				expect.objectContaining({ key: press.key, refused: 'refused', body: {} })
			]);
			expect(supersededKeys()).toEqual([]);
		});

		it('sent: what it covered stays taken back', async () => {
			await waitingJoin();
			fetchMock.mockImplementationOnce(async () => answer(201, made()));
			await flushHighlights();
			expect(fetchMock).toHaveBeenCalledTimes(1);
			expect(store.items.size).toBe(0);
			expect(await waitingHighlights()).toEqual([]);
		});

		it('taken back before it goes: covers go with it, and nothing is asked', async () => {
			const press = await waitingJoin();
			await takeBackHighlight(press.key);
			await flushHighlights();
			expect(fetchMock).not.toHaveBeenCalled();
			expect(store.items.size).toBe(0);
			expect(await refusedHighlights()).toEqual([]);
		});

		it('revised while its POST is out: the covers still come back', async () => {
			// The reader changes the join itself while the flush's POST is out: the
			// item's latest copy is what a refusal reads, and its covers are unchanged.
			const press = await waitingJoin();
			fetchMock.mockImplementationOnce(async () => {
				expect(await reviseHighlight(press.key, { colour: 'blue' })).toBe(true);
				return answer(400);
			});
			await flushHighlights();
			const waiting = await waitingHighlights();
			expect(waiting.map((i) => i.key)).toEqual([covered.key]);
			expect(waiting[0].body.note).toBe(covered.body.note);
		});

		it('a second join over a waiting join carries its covers on', async () => {
			const first = await waitingJoin();
			await supersedeHighlight(first.key);
			const carried = carriedBy(first.key)!;
			expect(carried.covers?.map((c) => c.key)).toEqual([covered.key]);
			const second = { ...carried, key: 'quote:9:0.0-0.12', covers: [carried] };
			await queueHighlight(second, 3);
			// The second refused: the first comes back waiting, with its own covers.
			fetchMock.mockImplementationOnce(async () => answer(400));
			await flushHighlights();
			let waiting = await waitingHighlights();
			expect(waiting.map((i) => i.key)).toEqual([first.key]);
			expect(waiting[0].covers?.map((c) => c.key)).toEqual([covered.key]);
			// And when it too is refused, the quote it covered is back with its note.
			fetchMock.mockImplementationOnce(async () => answer(400));
			await flushHighlights();
			waiting = await waitingHighlights();
			expect(waiting.map((i) => i.key)).toEqual([covered.key]);
			expect(waiting[0].body.note).toBe(covered.body.note);
		});

		it('what the reader changed while it waited comes back with it', async () => {
			// W's own POST is out and the reader turns it blue: the join
			// that covers it is refused, and the item put back must still
			// say the colour was changed, or a row already made keeps the
			// colour nobody chose.
			await queueHighlight(covered, 1);
			expect(await reviseHighlight(covered.key, { colour: 'blue' })).toBe(true);
			await supersedeHighlight(covered.key);
			expect(carriedBy(covered.key)?.revised).toEqual(['colour']);
			// The cover is what `coverOf` builds: the drawn quote's body plus what
			// the queue knew of it, `revised` included.
			const press = join([
				{ ...covered, body: { ...covered.body, colour: 'blue' }, revised: ['colour'] }
			]);
			await queueHighlight(press, 2);
			fetchMock.mockImplementationOnce(async () => answer(400));
			await flushHighlights();
			const [back] = await waitingHighlights();
			expect(back.revised).toEqual(['colour']);
			expect(back.body.colour).toBe('blue');
			// Its own POST lands against a row made with the old colour: only the
			// carried list says to patch it, as `unsaid` reads.
			fetchMock.mockReset();
			fetchMock.mockResolvedValueOnce(answer(200, { ...made({ colour: 'orange' }), made: false }));
			fetchMock.mockResolvedValueOnce(answer(200, { ok: true }));
			await flushHighlights();
			const [patch] = fetchMock.mock.calls.filter((c) => (c[1] as RequestInit).method === 'PATCH');
			expect(JSON.parse((patch[1] as RequestInit).body as string)).toEqual({ colour: 'blue' });
			expect(await waitingHighlights()).toEqual([]);
		});

		it('a take-back hands back what the item covered, and UNDO puts it all back', async () => {
			// DELETE of a waiting join, then UNDO. Were the take-back to return
			// nothing, the UNDO could only rebuild the page's body, and a refusal
			// of that join would lose the quote and its note for good.
			const press = await waitingJoin();
			const taken = await takeBackHighlight(press.key);
			expect(taken?.key).toBe(press.key);
			expect(taken?.covers?.map((c) => c.key)).toEqual([covered.key]);
			expect(taken?.covers?.[0]?.body.note).toBe(covered.body.note);
			expect(await waitingHighlights()).toEqual([]);
			// The UNDO re-queues what the take-back handed back, as the reader does.
			await queueHighlight(
				{
					key: press.key,
					url: press.url,
					body: press.body,
					entry: press.entry,
					label: press.label,
					covers: taken?.covers,
					revised: taken?.revised
				},
				3
			);
			fetchMock.mockImplementationOnce(async () => answer(400));
			await flushHighlights();
			const waiting = await waitingHighlights();
			expect(waiting.map((i) => i.key)).toEqual([covered.key]);
			expect(waiting[0].body.note).toBe(covered.body.note);
		});

		it('a stop or a later keeps the join and what it covers', async () => {
			// A reload's retry or a refused connection answers 401 (stop) or a
			// source's 502 (later): the item stays, and so must what it covers.
			const press = await waitingJoin();
			fetchMock.mockImplementationOnce(async () => answer(401));
			await flushHighlights();
			let [waiting] = await waitingHighlights();
			expect(waiting.key).toBe(press.key);
			expect(waiting.covers?.map((c) => c.key)).toEqual([covered.key]);
			fetchMock.mockImplementationOnce(async () => answer(502));
			await flushHighlights();
			[waiting] = await waitingHighlights();
			expect(waiting.key).toBe(press.key);
			expect(waiting.covers?.map((c) => c.key)).toEqual([covered.key]);
		});

		it('a fresh press does not inherit a stale revised from a join that was sent', async () => {
			// W is turned blue while it waits, then a join J under another key
			// covers it and is sent. `remembered` still holds W,
			// because it outlives the item it was; a press of W's span afterwards
			// is a new request, and no colour was changed of it.
			await queueHighlight(covered, 1);
			expect(await reviseHighlight(covered.key, { colour: 'blue' })).toBe(true);
			const press = join([covered]);
			await supersedeHighlight(covered.key);
			await queueHighlight(press, 2);
			fetchMock.mockImplementationOnce(async () => answer(201, made()));
			await flushHighlights();
			expect(await waitingHighlights()).toEqual([]);
			expect(carriedBy(covered.key)?.revised).toEqual(['colour']);
			await queueHighlight(covered, 3);
			const [fresh] = await waitingHighlights();
			expect(fresh.key).toBe(covered.key);
			expect(fresh.revised).toBeUndefined();
		});

		it('a press the device will not keep leaves what it covers waiting', async () => {
			await queueHighlight(covered, 1);
			// Storage that still deletes but aborts a write, as a full quota does.
			const put = store.put;
			store.put = async () => {
				throw new DOMException('full', 'QuotaExceededError');
			};
			const kept = await queueCovering(join([covered]), [covered.key], 2);
			store.put = put;
			expect(kept).toBe(false);
			const waiting = await waitingHighlights();
			expect(waiting.map((i) => i.key)).toEqual([covered.key]);
			expect(waiting[0].body).toEqual(covered.body);
			expect(supersededKeys()).toEqual([]);
		});

		it('a press kept on the device supersedes what it covers, after the write', async () => {
			await queueHighlight(covered, 1);
			const press = join([covered]);
			expect(await queueCovering(press, [covered.key], 2)).toBe(true);
			expect((await waitingHighlights()).map((i) => i.key)).toEqual([press.key]);
			// Superseded, not taken back: a POST of the quote's still out DELETEs nothing.
			expect(supersededKeys()).toEqual([covered.key]);
			expect(carriedBy(covered.key)?.body).toEqual(covered.body);
		});

		it('the exact re-press replaces the item in one write, and a refused one keeps the old', async () => {
			await queueHighlight(covered, 1);
			expect(await reviseHighlight(covered.key, { colour: 'blue' })).toBe(true);
			const again: NewHighlight = {
				...covered,
				body: { ...covered.body, colour: 'blue' },
				revised: ['colour']
			};
			const put = store.put;
			store.put = async () => {
				throw new DOMException('full', 'QuotaExceededError');
			};
			expect(await queueCovering(again, [covered.key], 2)).toBe(false);
			store.put = put;
			// Refused: the item that waited is the one still there, revised as it was.
			let [only] = await waitingHighlights();
			expect(only.at).toBe(1);
			expect(only.revised).toEqual(['colour']);
			// Kept: the new item stands in its place, never absent between.
			expect(await queueCovering(again, [covered.key], 3)).toBe(true);
			[only] = await waitingHighlights();
			expect(store.items.size).toBe(1);
			expect(only.at).toBe(3);
			expect(only.revised).toEqual(['colour']);
			expect(supersededKeys()).toEqual([]);
		});

		it('the exact re-press of a waiting quote carries the colour the reader chose', async () => {
			// `waitOnDevice`'s own-span branch: the same key again is this press,
			// and what the reader changed of it while it waited rides the new item.
			// The endpoint answers the repeat with the row it already holds, yellow:
			// only the carried `revised` sends the chosen colour after it.
			await queueHighlight(covered, 1);
			expect(await reviseHighlight(covered.key, { colour: 'blue' })).toBe(true);
			await supersedeHighlight(covered.key);
			const own = carriedBy(covered.key)!;
			expect(own.revised).toEqual(['colour']);
			await queueHighlight({ ...covered, body: { ...own.body }, revised: own.revised }, 2);
			fetchMock.mockResolvedValueOnce(
				answer(200, { highlight: { id: 41, colour: 'yellow' }, made: false })
			);
			fetchMock.mockResolvedValueOnce(answer(200, { ok: true }));
			await flushHighlights();
			const [patch] = fetchMock.mock.calls.filter((c) => (c[1] as RequestInit).method === 'PATCH');
			expect(patch).toBeDefined();
			expect(JSON.parse((patch[1] as RequestInit).body as string)).toEqual({ colour: 'blue' });
			expect(await waitingHighlights()).toEqual([]);
		});
	});
});

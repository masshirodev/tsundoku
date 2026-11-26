/**
 * The web edition's relay, the service worker's half (src/lib/web/relay.ts):
 * requests reach the tab that leads, wait for one when none does, and are
 * answered rather than left hanging when the leader changes under them.
 * The windows here are fakes that answer the way web/boot.js does.
 */
import { describe, expect, it, vi } from 'vitest';
import {
	LEADER_WAIT_MS,
	MESSAGES,
	postedForm,
	relay,
	type Client,
	type RelayAnswer
} from '$lib/web/relay';

type Sent = {
	data: { type: string; url?: string; method?: string; body?: ArrayBuffer | null };
	port?: MessagePort;
};

/** A window: what it was posted, and how to answer a request on its port. */
function windowClient(id: string) {
	const sent: Sent[] = [];
	return {
		id,
		sent,
		postMessage(data: Sent['data'], transfer?: Transferable[]) {
			sent.push({ data, port: transfer?.[0] as MessagePort | undefined });
		},
		answer(i: number, a: Partial<RelayAnswer> = {}) {
			sent
				.filter((s) => s.data.type === MESSAGES.request)
				[i].port!.postMessage({
					status: 200,
					statusText: 'OK',
					headers: [['content-type', 'text/plain']],
					body: new TextEncoder().encode('from ' + id).buffer,
					...a
				});
		}
	};
}
type Win = ReturnType<typeof windowClient>;

function world(...windows: Win[]) {
	const open = new Map(windows.map((w) => [w.id, w]));
	const clients = {
		get: vi.fn(async (id: string) => open.get(id) as unknown as Client | undefined),
		matchAll: vi.fn(async () => [...open.values()] as unknown as Client[])
	};
	const r = relay(clients as never, { waitMs: 200 });
	const leads = (w: Win) => r.onMessage({ data: { type: MESSAGES.leader }, source: w as never });
	const close = (w: Win) => open.delete(w.id);
	return { r, clients, leads, close };
}

const requests = (w: Win) => w.sent.filter((s) => s.data.type === MESSAGES.request);
const tick = () => new Promise((r) => setTimeout(r, 0));

describe('the relay', () => {
	it('sends a request to the leading tab and answers with what its server said', async () => {
		const a = windowClient('a');
		const { r, leads } = world(a);
		leads(a);
		const answer = r.send(new Request('https://t.test/api/x?y=1', { headers: { 'x-h': '1' } }));
		await tick();
		const [req] = requests(a);
		expect(req.data).toMatchObject({ url: 'https://t.test/api/x?y=1', method: 'GET', body: null });
		a.answer(0, { status: 201, statusText: 'Created' });
		const res = await answer;
		expect(res.status).toBe(201);
		expect(await res.text()).toBe('from a');
	});

	it('carries a write’s body', async () => {
		const a = windowClient('a');
		const { r, leads } = world(a);
		leads(a);
		const answer = r.send(
			new Request('https://t.test/?/newShelf', { method: 'POST', body: 'name=Invented' })
		);
		await vi.waitFor(() => expect(requests(a)).toHaveLength(1));
		const { data } = requests(a)[0];
		expect(data.method).toBe('POST');
		expect(new TextDecoder().decode(data.body!)).toBe('name=Invented');
		a.answer(0, {
			status: 303,
			statusText: 'See Other',
			headers: [['location', '/?shelf=1']],
			body: null
		});
		expect((await answer).headers.get('location')).toBe('/?shelf=1');
	});

	it('answers a 204 and a 304 without a body, as a Response must', async () => {
		const a = windowClient('a');
		const { r, leads } = world(a);
		leads(a);
		const first = r.send(new Request('https://t.test/api/a'));
		const second = r.send(new Request('https://t.test/api/b'));
		await vi.waitFor(() => expect(requests(a)).toHaveLength(2));
		a.answer(0, { status: 204, statusText: 'No Content' });
		a.answer(1, { status: 304, statusText: 'Not Modified' });
		expect((await first).status).toBe(204);
		expect((await second).body).toBeNull();
	});

	it('asks the windows who leads when it does not know, and waits for the answer', async () => {
		const a = windowClient('a');
		const b = windowClient('b');
		const { r, leads } = world(a, b);
		const answer = r.send(new Request('https://t.test/api/x'));
		await vi.waitFor(() => expect(b.sent.map((s) => s.data.type)).toContain(MESSAGES.whoLeads));
		expect(a.sent.map((s) => s.data.type)).toContain(MESSAGES.whoLeads);
		leads(b);
		await vi.waitFor(() => expect(requests(b)).toHaveLength(1));
		expect(requests(a)).toHaveLength(0);
		b.answer(0);
		expect(await (await answer).text()).toBe('from b');
	});

	it('answers 503 when no tab leads within the wait', async () => {
		const { r } = world(windowClient('a'));
		const res = await r.send(new Request('https://t.test/api/x'));
		expect(res.status).toBe(503);
		expect(await res.text()).toMatch(/no open tab/);
	});

	it('forgets a leader that closed, and finds the next one', async () => {
		const a = windowClient('a');
		const b = windowClient('b');
		const { r, leads, close } = world(a, b);
		leads(a);
		close(a);
		const answer = r.send(new Request('https://t.test/api/x'));
		await vi.waitFor(() => expect(b.sent.map((s) => s.data.type)).toContain(MESSAGES.whoLeads));
		leads(b);
		await vi.waitFor(() => expect(requests(b)).toHaveLength(1));
		b.answer(0);
		expect((await answer).status).toBe(200);
	});

	it('answers what the old leader was sent with 503 when another takes over', async () => {
		const a = windowClient('a');
		const b = windowClient('b');
		const { r, leads } = world(a, b);
		leads(a);
		const lost = r.send(new Request('https://t.test/api/x'));
		await vi.waitFor(() => expect(requests(a)).toHaveLength(1));
		leads(b);
		const res = await lost;
		expect(res.status).toBe(503);
		expect(await res.text()).toMatch(/closed/);
		// The same leader again is no change: nothing of its own is dropped.
		const kept = r.send(new Request('https://t.test/api/y'));
		await vi.waitFor(() => expect(requests(b)).toHaveLength(1));
		leads(b);
		b.answer(0);
		expect((await kept).status).toBe(200);
	});

	it('answers what a closed leader was sent when another request finds it gone first', async () => {
		const a = windowClient('a');
		const b = windowClient('b');
		const { r, leads, close } = world(a, b);
		leads(a);
		const lost = r.send(new Request('https://t.test/api/x'));
		await vi.waitFor(() => expect(requests(a)).toHaveLength(1));
		// The leader's window closes, and the next request reaches the relay
		// before any tab says it leads now.
		close(a);
		const later = r.send(new Request('https://t.test/api/y'));
		const res = await lost;
		expect(res.status).toBe(503);
		leads(b);
		await vi.waitFor(() => expect(requests(b)).toHaveLength(1));
		b.answer(0);
		expect((await later).status).toBe(200);
	});

	it('answers a lost form action as a refusal the screen can show, never sending it twice', async () => {
		const a = windowClient('a');
		const b = windowClient('b');
		const { r, leads } = world(a, b);
		leads(a);
		const lost = r.send(
			new Request('https://t.test/?/newShelf', {
				method: 'POST',
				headers: { 'x-sveltekit-action': 'true' },
				body: 'name=Invented'
			})
		);
		await vi.waitFor(() => expect(requests(a)).toHaveLength(1));
		leads(b);
		const res = await lost;
		expect(res.status).toBe(503);
		expect(JSON.parse(await res.text())).toMatchObject({ type: 'failure', status: 503 });
		expect(requests(b)).toHaveLength(0);
	});

	it('takes only its own messages, and a leader message only from a window', () => {
		const a = windowClient('a');
		const { r } = world(a);
		expect(r.onMessage({ data: { type: MESSAGES.precache }, source: a as never })).toBe(false);
		expect(r.onMessage({ data: null, source: null })).toBe(false);
		expect(r.onMessage({ data: { type: MESSAGES.leader }, source: null })).toBe(true);
	});

	it('waits a minute by default: a first visit climbs every migration first', () => {
		expect(LEADER_WAIT_MS).toBe(60_000);
	});
});

describe('a form posted without script', () => {
	it('passes a redirect on, for the shell to load', () => {
		const r = new Response(null, { status: 303, headers: { location: '/?shelf=2' } });
		expect(postedForm(r, 'https://t.test/x')).toBe(r);
	});

	it('sends anything else back to the page’s own address', () => {
		const r = postedForm(new Response('a page', { status: 200 }), 'https://t.test/x');
		expect(r.status).toBe(303);
		expect(r.headers.get('location')).toBe('https://t.test/x');
	});
});

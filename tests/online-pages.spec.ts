import { afterEach, describe, expect, it, vi } from 'vitest';
import { isOnlineVersion, onlineHeld, onlinePages, ONLINE_HELD } from '$lib/reader/online-pages';

/**
 * The image reader's copy of a chapter read online (c1038; doc/BROWSING.md,
 * "Manga online"): each page near the one being read fetched once, held in
 * memory, let go oldest first and all at once when the reader is left.
 */

function world(opts: { max?: number; fail?: (url: string) => boolean } = {}) {
	const asked: string[] = [];
	const aborted: string[] = [];
	const revoked: string[] = [];
	const decoded: string[] = [];
	const later: (() => void)[] = [];
	const pending = new Map<
		string,
		{ resolve: (r: Response) => void; reject: (e: unknown) => void }
	>();
	let n = 0;
	const held = onlinePages({
		fetch: (url, { signal }) => {
			asked.push(url);
			signal.addEventListener('abort', () => aborted.push(url));
			return new Promise<Response>((resolve, reject) => pending.set(url, { resolve, reject }));
		},
		createUrl: () => `blob:${++n}`,
		revokeUrl: (u) => revoked.push(u),
		decode: (u) => decoded.push(u),
		later: (fn) => later.push(fn),
		max: opts.max
	});
	/** Answers a page's request (an image, a refusal, or a network error) and lets the chain settle. */
	async function answer(url: string, how: 'ok' | 502 | 'error' = 'ok') {
		const p = pending.get(url)!;
		pending.delete(url);
		if (how === 'error') p.reject(new TypeError('network'));
		else
			p.resolve(
				new Response(how === 'ok' ? new Uint8Array([1, 2, 3]) : 'no', {
					status: how === 'ok' ? 200 : how
				})
			);
		for (let i = 0; i < 5; i++) await Promise.resolve();
		await new Promise((r) => setTimeout(r, 0));
	}
	return { held, asked, aborted, revoked, decoded, later, answer };
}

describe('online pages (c1038)', () => {
	it('names an online version', () => {
		expect(isOnlineVersion('online-1794877950032')).toBe(true);
		expect(isOnlineVersion('3f2a')).toBe(false);
		expect(isOnlineVersion(null)).toBe(false);
		expect(isOnlineVersion(undefined)).toBe(false);
	});

	it('asks for each page once, however often a turn wants it', async () => {
		const w = world();
		w.held.keep(['p2'], ['p3', 'p1', 'p4']);
		expect(w.asked).toEqual(['p3', 'p1', 'p4', 'p2']);
		expect(w.held.get('p2')).toEqual({ state: 'pending' });
		await w.answer('p2');
		expect(w.held.get('p2')).toEqual({ state: 'ready', url: 'blob:1' });
		expect(w.decoded).toEqual(['blob:1']);
		// p. 2 → 3 → 2: nothing new is asked for p. 2, and p. 3 is the request already out.
		w.held.keep(['p3'], ['p4', 'p2', 'p5']);
		w.held.keep(['p2'], ['p3', 'p1', 'p4']);
		expect(w.asked).toEqual(['p3', 'p1', 'p4', 'p2', 'p5']);
		expect(w.held.get('p2')).toEqual({ state: 'ready', url: 'blob:1' });
	});

	it('lets the oldest go past the limit, and never a page on screen', async () => {
		const w = world({ max: 3 });
		w.held.keep(['a'], []);
		await w.answer('a');
		w.held.keep(['b'], ['c']);
		w.held.keep(['d'], []);
		// a is the oldest and ready: its URL is revoked; nothing else was.
		expect(w.held.get('a')).toBeUndefined();
		expect(w.revoked).toEqual(['blob:1']);
		expect(w.held.size).toBe(3);
		// The ones on screen are wanted last, so a crowd of near pages pushes out the old, not them.
		w.held.keep(['x', 'y', 'z'], ['n1', 'n2']);
		expect(['x', 'y', 'z'].map((s) => w.held.get(s)?.state)).toEqual([
			'pending',
			'pending',
			'pending'
		]);
		expect(w.held.size).toBe(3);
		// A pending page let go has its request cancelled, and its late answer is ignored.
		expect(w.aborted).toEqual(expect.arrayContaining(['b', 'c', 'd', 'n1', 'n2']));
		await w.answer('b');
		expect(w.held.get('b')).toBeUndefined();
	});

	it('the default limit is a dozen', () => {
		expect(ONLINE_HELD).toBe(12);
		const w = world();
		w.held.keep(
			[],
			Array.from({ length: 20 }, (_, i) => `p${i}`)
		);
		expect(w.held.size).toBe(12);
	});

	it('a refusal says so; RETRY asks again, and so does reaching a page refused while near', async () => {
		const w = world();
		w.held.keep(['p1'], ['p2']);
		await w.answer('p1', 502);
		await w.answer('p2', 'error');
		expect(w.held.get('p1')).toEqual({ state: 'failed' });
		expect(w.held.get('p2')).toEqual({ state: 'failed' });
		// Still near, not on screen: a source that is down is not asked on every turn.
		w.held.keep(['p1'], ['p2']);
		expect(w.asked.filter((u) => u === 'p2')).toHaveLength(1);
		// On screen: asked once more (the turn that reaches it).
		expect(w.asked.filter((u) => u === 'p1')).toHaveLength(2);
		await w.answer('p1', 502);
		w.held.retry('p1');
		expect(w.held.get('p1')).toEqual({ state: 'pending' });
		await w.answer('p1');
		expect(w.held.get('p1')?.state).toBe('ready');
		// A retry of a pending page cancels the first request and keeps only the second's answer.
		w.held.keep(['p3'], []);
		w.held.retry('p3');
		expect(w.aborted).toContain('p3');
	});

	it('leaving the reader lets every page go; moving on to the next chapter keeps them', async () => {
		const w = world();
		const first = w.held.hold();
		w.held.keep(['p1'], ['next-0']);
		await w.answer('p1');
		await w.answer('next-0');
		// A chapter change: the old reader is released, the new one mounts before the check runs.
		first();
		const second = w.held.hold();
		w.later.splice(0).forEach((fn) => fn());
		expect(w.held.get('next-0')?.state).toBe('ready');
		// Releasing twice counts once.
		first();
		w.later.splice(0).forEach((fn) => fn());
		expect(w.held.size).toBe(2);
		// Leaving for the series screen: nothing is left, and every URL is revoked.
		second();
		w.later.splice(0).forEach((fn) => fn());
		expect(w.held.size).toBe(0);
		expect(w.revoked.sort()).toEqual(['blob:1', 'blob:2']);
	});

	describe('in the browser', () => {
		afterEach(() => vi.unstubAllGlobals());

		it("the reader's own: fetches, keeps an object URL, decodes it, and lets go when the reader is left", async () => {
			const decodedSrc: string[] = [];
			vi.stubGlobal(
				'fetch',
				vi.fn(async () => new Response(new Uint8Array([137, 80, 78, 71]), { status: 200 }))
			);
			vi.stubGlobal(
				'Image',
				class {
					decoding = '';
					src = '';
					decode() {
						decodedSrc.push(this.src);
						return Promise.reject(new Error('not an image here'));
					}
				}
			);
			const release = onlineHeld.hold();
			onlineHeld.keep(['/api/entries/1/pages/0?v=online-1'], []);
			await vi.waitFor(() =>
				expect(onlineHeld.get('/api/entries/1/pages/0?v=online-1')?.state).toBe('ready')
			);
			const h = onlineHeld.get('/api/entries/1/pages/0?v=online-1');
			const url = h?.state === 'ready' ? h.url : '';
			expect(url).toMatch(/^blob:/);
			expect(decodedSrc).toEqual([url]);
			release();
			await vi.waitFor(() => expect(onlineHeld.size).toBe(0));
			// Revoked: the Blob behind it is gone.
			expect(await (await import('node:buffer')).resolveObjectURL(url)).toBeUndefined();
		});
	});
});

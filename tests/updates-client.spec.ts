import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
	DONE_KEY,
	SNOOZE_MS,
	asks,
	clock,
	downloadLine,
	installAndWait,
	laterFor,
	noteLines,
	offerMeta,
	parseLater,
	releasedOn,
	runningBand,
	type UpdateView
} from '../src/lib/updates';

/**
 * The update modal on entry (doc/UPDATES.md, "Told on entry"):
 * when it asks, its words, and the UPDATE loop it shares with SETTINGS. The
 * modal itself can't be reached end to end: it needs a release-dated build
 * and a manifest signed with the release key, which no test holds.
 */

const view = (o: Partial<UpdateView> = {}): UpdateView => ({
	current: '2026.10.30.4',
	checkedAt: 1,
	available: { version: '2026.11.02', date: '2026-11-02', notes: 'One.\nTwo.', size: 182_000_000 },
	platform: 'windows',
	how: 'install',
	download: null,
	error: null,
	install: null,
	...o
});

describe('when the modal asks', () => {
	const now = 1_000_000;
	it('asks about a version until LATER, then not for a day', () => {
		expect(asks('2026.11.02', null, now)).toBe(true);
		const later = laterFor('2026.11.02', now);
		expect(later.until - now).toBe(SNOOZE_MS);
		expect(asks('2026.11.02', later, now + SNOOZE_MS - 1)).toBe(false);
		expect(asks('2026.11.02', later, now + SNOOZE_MS)).toBe(true);
	});
	it('a newer version asks at once, whatever LATER said about the last', () => {
		expect(asks('2026.11.05', laterFor('2026.11.02', now), now)).toBe(true);
	});
	it('reads what it kept, and nothing broken', () => {
		expect(parseLater(JSON.stringify({ version: 'v', until: 5 }))).toEqual({
			version: 'v',
			until: 5
		});
		for (const bad of [null, '', '{', '[]', '{"version":1,"until":2}', '"x"'])
			expect(parseLater(bad)).toBeNull();
	});
});

describe("the modal's words", () => {
	it('says when, how big and signed by what', () => {
		expect(offerMeta(view())).toBe("RELEASED 2 NOV · 182 MB · SIGNED BY TSUNDOKU'S RELEASE KEY");
		expect(
			offerMeta(
				view({
					how: 'download',
					platform: 'linux',
					available: { ...view().available!, size: 164_000_000 }
				})
			)
		).toBe('RELEASED 2 NOV · LINUX · 164 MB · SIGNED');
		expect(offerMeta(view({ available: { ...view().available!, size: null } }))).toBe(
			"RELEASED 2 NOV · SIGNED BY TSUNDOKU'S RELEASE KEY"
		);
		expect(offerMeta(view({ available: null }))).toBe('');
	});
	it('dates and notes', () => {
		expect(releasedOn('2026-01-09')).toBe('9 JAN');
		expect(releasedOn('9999-13-01')).toBe('9999-13-01');
		expect(noteLines('A.\r\n\n  B.  \n')).toEqual(['A.', 'B.']);
	});
	it('counts a download, and the wait', () => {
		expect(downloadLine({ bytes: 76_000_000, total: 182_000_000 })).toBe('76 OF 182 MB · 41%');
		expect(downloadLine({ bytes: 0, total: 182_000_000 })).toBe('0 OF 182 MB · 0%');
		expect(clock(24_900)).toBe('0:24');
		expect(clock(125_000)).toBe('2:05');
		expect(clock(-5)).toBe('0:00');
	});
	it("the library's band while a hidden UPDATE runs", () => {
		expect(runningBand(null)).toBeNull();
		expect(runningBand({ phase: 'failed', error: 'x' })).toBeNull();
		expect(runningBand({ phase: 'downloading', bytes: 76_000_000, total: 182_000_000 })).toEqual({
			title: 'UPDATING · 41%',
			detail: '76 OF 182 MB · TSUNDOKU WILL REOPEN BY ITSELF'
		});
		expect(runningBand({ phase: 'installing' })?.title).toBe('UPDATING · INSTALLING');
	});
});

describe('UPDATE, followed until the new version answers', () => {
	const store = new Map<string, string>();
	beforeEach(() => {
		store.clear();
		vi.stubGlobal('localStorage', {
			getItem: (k: string) => store.get(k) ?? null,
			setItem: (k: string, v: string) => void store.set(k, v),
			removeItem: (k: string) => void store.delete(k)
		});
	});
	afterEach(() => vi.unstubAllGlobals());

	const json = (body: unknown, status = 200) =>
		new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

	it('hears the old server, then nobody, then reloads onto the new one', async () => {
		const answers: (() => Response)[] = [
			() => json(view({ install: { phase: 'downloading', bytes: 0, total: 10 } }), 202),
			() => json(view({ install: { phase: 'installing' } })),
			() => {
				throw new TypeError('fetch failed');
			},
			() => json(view({ current: '2026.11.02', available: null }))
		];
		const fetcher = vi.fn(async () => answers.shift()!());
		const seen: string[] = [];
		let away = 0;
		const reload = vi.fn();
		await installAndWait({
			target: '2026.11.02',
			onView: (v) => seen.push(v.install?.phase ?? 'none'),
			onAway: () => away++,
			fetcher: fetcher as unknown as typeof fetch,
			reload,
			every: 0
		});
		expect(seen).toEqual(['downloading', 'installing']);
		expect(away).toBe(1);
		expect(reload).toHaveBeenCalledOnce();
		// The reload's library says UPDATED TO, once.
		expect(store.get(DONE_KEY)).toBe('2026.11.02');
	});

	it('stops at a failure, and a refusal says why', async () => {
		const failed = vi.fn(async () =>
			json(view({ install: { phase: 'failed', error: 'downloaded 3 bytes, expected 10' } }))
		);
		const views: UpdateView[] = [];
		await installAndWait({
			target: '2026.11.02',
			onView: (v) => views.push(v),
			fetcher: failed as unknown as typeof fetch,
			every: 0
		});
		expect(views.at(-1)?.install).toEqual({
			phase: 'failed',
			error: 'downloaded 3 bytes, expected 10'
		});

		const refused = vi.fn(async () => json({ message: 'this copy updates by download' }, 409));
		let why = '';
		await installAndWait({
			target: '2026.11.02',
			onView: () => {},
			onRefused: (w) => (why = w),
			fetcher: refused as unknown as typeof fetch
		});
		expect(why).toBe('this copy updates by download');
		expect(refused).toHaveBeenCalledOnce();
	});
});

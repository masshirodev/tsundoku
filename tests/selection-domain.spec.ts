import { afterEach, describe, expect, it, vi } from 'vitest';
import {
	carrySelection,
	drawnToNote,
	FACTS_MAX,
	goneCount,
	landing,
	pickedOfCard,
	pickedOfCards,
	pickedOfPart,
	readFacts,
	takeCarried,
	UnseenFacts,
	workTap,
	workTicks,
	pickedInOrder,
	refreshFacts,
	titlesLine,
	unseenCount,
	workOf,
	type FactsAnswer,
	type Picked
} from '../src/lib/library/selection';
import type { LibraryCard, WorkPart } from '../src/lib/library/works';

// The facts SELECT keeps about each series it ticked, so a selection that
// outlives the shelf it was made on still knows what it holds (c698;
// doc/LIBRARY.md, "A selection outlives the shelf").

const pick = (id: number, over: Partial<Picked> = {}): Picked => ({
	id,
	title: `Series ${id}`,
	hue: id * 10,
	addedAt: 1000 + id,
	cover: null,
	kind: 'manga',
	entryCount: 10,
	meta: 'MANGA · 10 CH.',
	work: null,
	inWork: null,
	hidden: false,
	language: null,
	languages: undefined,
	...over
});

const factsOf = (...ps: Picked[]) => new Map(ps.map((p) => [p.id, p]));

describe('pickedInOrder', () => {
	it('keeps the order the ids were selected in, which is GROUP’s BY HAND', () => {
		const facts = factsOf(pick(1), pick(2), pick(3));
		expect(pickedInOrder([3, 1, 2], facts).map((p) => p.id)).toEqual([3, 1, 2]);
	});
	it('leaves out an id the page never drew', () => {
		expect(pickedInOrder([1, 9, 2], factsOf(pick(1), pick(2))).map((p) => p.id)).toEqual([1, 2]);
	});
	it('answers nothing for nothing selected', () => {
		expect(pickedInOrder([], factsOf(pick(1)))).toEqual([]);
	});
});

describe('unseenCount', () => {
	it('counts the ids with no facts, and only those', () => {
		const facts = factsOf(pick(1), pick(2));
		expect(unseenCount([1, 2], facts)).toBe(0);
		expect(unseenCount([1, 7, 8], facts)).toBe(2);
		expect(unseenCount([], facts)).toBe(0);
	});
});

describe('titlesLine', () => {
	const facts = factsOf(pick(1), pick(2), pick(3), pick(4));
	it('names up to three, upper case, in selection order', () => {
		expect(titlesLine([2, 1], facts)).toBe('SERIES 2, SERIES 1');
		expect(titlesLine([3, 2, 1], facts)).toBe('SERIES 3, SERIES 2, SERIES 1');
	});
	it('counts the rest past three, seen or not', () => {
		expect(titlesLine([1, 2, 3, 4], facts)).toBe('SERIES 1, SERIES 2, SERIES 3 AND 1 MORE');
		// An unseen id among the first three is skipped by name and still counted.
		expect(titlesLine([9, 1, 2, 3, 4], facts)).toBe('SERIES 1, SERIES 2, SERIES 3 AND 2 MORE');
	});
	it('counts the unseen beside fewer than three names', () => {
		expect(titlesLine([1, 9], facts)).toBe('SERIES 1 AND 1 MORE');
	});
	it('is empty when no selected series was ever drawn', () => {
		expect(titlesLine([8, 9], facts)).toBe('');
		expect(titlesLine([], facts)).toBe('');
	});
});

describe('workOf', () => {
	const facts = factsOf(pick(1, { work: { id: 5, name: 'Noted' } }), pick(2));
	it('prefers the page’s own answer for a series it draws', () => {
		expect(workOf(1, { '1': { id: 6, name: 'Now' } }, facts)).toEqual({ id: 6, name: 'Now' });
	});
	it('falls back to what was noted for a series out of sight', () => {
		expect(workOf(1, {}, facts)).toEqual({ id: 5, name: 'Noted' });
	});
	it('is none for a series in no Work, or one never seen', () => {
		expect(workOf(2, {}, facts)).toBeNull();
		expect(workOf(9, {}, facts)).toBeNull();
	});
});

describe('what FOLD reads', () => {
	const card = {
		id: 1,
		title: 'T',
		hue: 1,
		addedAt: 1,
		cover: null,
		kind: 'doujin',
		hidden: false
	};
	it('carries the card’s alone, and leaves it absent where the card said nothing', () => {
		const of = (alone?: boolean) =>
			pickedOfCard({ ...card, entryCount: 1, readCount: 0, alone } as LibraryCard, null).alone;
		expect(of(true)).toBe(true);
		expect(of(false)).toBe(false);
		expect(of(undefined)).toBeUndefined();
	});
	it('notes the series again when alone changed, as an extra arriving does', () => {
		const facts = factsOf(pick(1, { alone: true }));
		expect(refreshFacts(new Set([1]), facts, [pick(1, { alone: false })]).set).toEqual([
			pick(1, { alone: false })
		]);
		expect(refreshFacts(new Set([1]), facts, [pick(1, { alone: true })]).set).toEqual([]);
	});
});

describe('refreshFacts', () => {
	it('notes a drawn series once it is selected, and not before', () => {
		const drawn = [pick(1), pick(2)];
		expect(refreshFacts(new Set([2]), new Map(), drawn)).toEqual({ set: [pick(2)], drop: [] });
		expect(refreshFacts(new Set(), new Map(), drawn)).toEqual({ set: [], drop: [] });
	});
	it('keeps the facts of a selected series that is no longer drawn', () => {
		const facts = factsOf(pick(1));
		expect(refreshFacts(new Set([1]), facts, [pick(2)])).toEqual({ set: [], drop: [] });
	});
	it('forgets the facts of a series no longer selected, drawn or not', () => {
		const facts = factsOf(pick(1), pick(2));
		expect(refreshFacts(new Set([2]), facts, [pick(1), pick(2)])).toEqual({ set: [], drop: [1] });
	});
	it('keeps the facts of a row SHOW still lists, unticked or not', () => {
		const facts = factsOf(pick(1), pick(2));
		expect(refreshFacts(new Set([2]), facts, [], new Set([1, 2]))).toEqual({ set: [], drop: [] });
		// Unticked rows are not noted afresh, only kept.
		expect(refreshFacts(new Set([2]), facts, [pick(1, { title: 'New' })], new Set([1]))).toEqual({
			set: [],
			drop: []
		});
		// Once SHOW closes, they go.
		expect(refreshFacts(new Set([2]), facts, [])).toEqual({ set: [], drop: [1] });
	});
	it('writes nothing when what is drawn is what was noted', () => {
		const facts = factsOf(pick(1));
		expect(refreshFacts(new Set([1]), facts, [pick(1)])).toEqual({ set: [], drop: [] });
		// Its own output, applied, changes nothing further.
		const again = refreshFacts(new Set([1]), facts, [{ ...pick(1) }]);
		expect(again).toEqual({ set: [], drop: [] });
	});
	it('refreshes every fact a bulk action reads when it changes on screen', () => {
		const was = pick(1);
		const changes: Partial<Picked>[] = [
			{ title: 'Renamed' },
			{ hue: 1 },
			{ addedAt: 1 },
			{ cover: 4 },
			{ kind: 'novel' },
			{ entryCount: 11 },
			{ meta: 'NOVEL · 1 VOL.' },
			{ work: { id: 3, name: 'W' } },
			{ inWork: 'W' },
			{ hidden: true },
			{ language: 'ja' },
			{ languages: ['en', 'ja'] }
		];
		for (const c of changes) {
			const now = { ...was, ...c };
			expect(refreshFacts(new Set([1]), factsOf(was), [now]), JSON.stringify(c)).toEqual({
				set: [now],
				drop: []
			});
		}
		// A Work renamed, same id.
		const inWork = pick(1, { work: { id: 3, name: 'W' } });
		const renamed = pick(1, { work: { id: 3, name: 'W2' } });
		expect(refreshFacts(new Set([1]), factsOf(inWork), [renamed]).set).toEqual([renamed]);
	});
});

describe('drawnToNote', () => {
	const counted = () => {
		let calls = 0;
		const drawn = () => {
			calls++;
			return [pick(1), pick(2)];
		};
		return { drawn, calls: () => calls };
	};
	it('never builds the drawn series while SELECT is off', () => {
		const c = counted();
		expect([...drawnToNote(false, new Set(), c.drawn)]).toEqual([]);
		// Off with ids left over (none should be, stopSelecting clears them): still no pass.
		expect([...drawnToNote(false, new Set([1]), c.drawn)]).toEqual([]);
		expect(c.calls()).toBe(0);
	});
	it('never builds them while selecting with nothing ticked', () => {
		const c = counted();
		expect([...drawnToNote(true, new Set(), c.drawn)]).toEqual([]);
		expect(c.calls()).toBe(0);
	});
	it('builds them once per pass while something is ticked', () => {
		const c = counted();
		expect([...drawnToNote(true, new Set([2]), c.drawn)].map((p) => p.id)).toEqual([1, 2]);
		expect(c.calls()).toBe(1);
	});
	it('a skipped pass still forgets what left the selection, and keeps what SHOW holds', () => {
		// The last tick undone in SHOW: nothing selected, 1 held by the open sheet, 2 gone.
		const facts = factsOf(pick(1), pick(2));
		const drawn = drawnToNote(true, new Set(), () => [pick(1), pick(2)]);
		expect(refreshFacts(new Set(), facts, drawn, new Set([1]))).toEqual({ set: [], drop: [2] });
	});
});

const card = (over: Partial<LibraryCard> = {}): LibraryCard => ({
	id: 7,
	title: 'Haibara',
	kind: 'novel',
	rating: 0,
	favourite: false,
	hidden: false,
	newCount: 0,
	entryCount: 3,
	readCount: 1,
	hue: 40,
	cover: 2,
	indexed: true,
	addedAt: 1234,
	lastOpenedAt: null,
	...over
});
const part = (over: Partial<WorkPart> = {}): WorkPart => ({
	seriesId: 9,
	title: 'Zelkova: Roots',
	kind: 'manga',
	rating: 0,
	favourite: false,
	cover: null,
	position: 1,
	addedAt: 99,
	entries: 4,
	read: 4,
	lastOpenedAt: null,
	status: '',
	hidden: true,
	...over
});

describe('pickedOfCard and pickedOfPart: a search hit carries what GROUP and SHOW read', () => {
	it('keeps a card’s facts, its GROUP row line and its Work', () => {
		const p = pickedOfCard(card({ language: 'japanese' }), { id: 3, name: 'Saga' });
		expect(p).toEqual({
			id: 7,
			title: 'Haibara',
			hue: 40,
			addedAt: 1234,
			cover: 2,
			kind: 'novel',
			entryCount: 3,
			readCount: 1,
			show: null,
			meta: 'NOVEL · 3 VOL · 1 READ',
			work: { id: 3, name: 'Saga' },
			inWork: 'Saga',
			hidden: false,
			language: 'japanese',
			languages: undefined
		});
		expect(pickedOfCard(card(), null)).toMatchObject({ work: null, inWork: null, language: null });
	});
	it('a part reads its Work’s name as GROUP’s row does, and says READ ✓ only when it is', () => {
		const done = pickedOfPart(part(), 'Zelkova', { id: 5, name: 'Zelkova' });
		expect(done).toMatchObject({ id: 9, inWork: 'Zelkova', work: { id: 5, name: 'Zelkova' } });
		expect(done.meta).toMatch(/ · READ ✓$/);
		expect(done.hidden).toBe(true);
		expect(pickedOfPart(part({ read: 1 }), 'Zelkova', null).meta).not.toMatch(/READ/);
		// No entries is never finished.
		expect(pickedOfPart(part({ entries: 0, read: 0 }), 'Z', null).meta).not.toMatch(/READ/);
	});
});

describe('workTicks and workTap: a Work’s row ticks its parts', () => {
	it('names every state, and a tap ticks the rest or unticks them all', () => {
		const parts = [1, 2];
		expect(workTicks(parts, new Set())).toEqual({ ticked: 0, total: 2, state: 'none' });
		expect(workTicks(parts, new Set([2, 5]))).toEqual({ ticked: 1, total: 2, state: 'some' });
		expect(workTicks(parts, new Set([1, 2]))).toEqual({ ticked: 2, total: 2, state: 'all' });
		expect(workTap(parts, new Set())).toEqual({ add: [1, 2], remove: [] });
		expect(workTap(parts, new Set([2]))).toEqual({ add: [1], remove: [] });
		expect(workTap(parts, new Set([1, 2]))).toEqual({ add: [], remove: [1, 2] });
	});
	it('a Work with no visible parts is never ticked, and a tap does nothing', () => {
		expect(workTicks([], new Set([1])).state).toBe('none');
		expect(workTap([], new Set([1]))).toEqual({ add: [], remove: [] });
	});
});

describe('carrySelection and takeCarried: the selection between the library and the search', () => {
	const g = globalThis as { window?: unknown };
	afterEach(() => {
		takeCarried('');
		delete g.window;
	});
	it('is written only in a browser: on the server the module is every request’s', () => {
		carrySelection({ ids: [1], facts: [], to: '/search' });
		expect(takeCarried('/search')).toBeNull();
	});
	it('lands where it was carried to, once, in the order it was ticked', () => {
		g.window = {};
		const facts = [pick(3), pick(1)];
		carrySelection({ ids: [3, 1], facts, to: '/?sort=title' });
		facts.push(pick(9));
		const got = takeCarried('/?sort=title');
		expect(got?.ids).toEqual([3, 1]);
		// A copy: what the leaving screen does after does not reach it.
		expect(got?.facts.map((p) => p.id)).toEqual([3, 1]);
		expect(takeCarried('/?sort=title')).toBeNull();
	});
	it('is dropped by an arrival anywhere else, so a cancelled trip leaves nothing behind', () => {
		g.window = {};
		carrySelection({ ids: [1], facts: [], to: '/search' });
		expect(takeCarried('/?shelf=new')).toBeNull();
		expect(takeCarried('/search')).toBeNull();
	});
	it('compares a landing by path and query, not by origin or hash', () => {
		expect(landing(new URL('http://a:1/search?q=x#top'))).toBe('/search?q=x');
		expect(landing(new URL('http://a:1/'))).toBe('/');
	});
});

describe('pickedOfCards: the by-id answer, as facts', () => {
	it('takes a series in no Work as itself and a Work tile’s wanted parts as parts', () => {
		const face = card({ id: 20, title: 'Zelkova: Roots' });
		const tile = {
			...face,
			tile: {
				id: 4,
				name: 'Zelkova',
				face,
				parts: [part({ seriesId: 20 }), part({ seriesId: 21, title: 'Zelkova: Crown' })],
				newCount: 0,
				hidden: false
			}
		};
		const got = pickedOfCards([card({ id: 7 }), card({ id: 8 }), tile], new Set([7, 21, 99]));
		expect(got.map((p) => p.id)).toEqual([7, 21]);
		expect(got[1]).toMatchObject({ inWork: 'Zelkova', work: { id: 4, name: 'Zelkova' } });
	});
});

describe('UnseenFacts: SELECT ALL’s unloaded series, read by id', () => {
	const later = () => {
		const answers: ((v: FactsAnswer | null) => void)[] = [];
		const asked: number[][] = [];
		const read = (ids: readonly number[]) => {
			asked.push([...ids]);
			return new Promise<FactsAnswer | null>((r) => answers.push(r));
		};
		/** Answers the latest read, or the `n`th. */
		const answer = (v: FactsAnswer | null, n = answers.length - 1) => answers[n](v);
		return { read, asked, answer };
	};

	it('asks once for the ids with no facts, notes what comes back, and takes out what does not', async () => {
		const r = later();
		const u = new UnseenFacts(r.read);
		const selected = new Set([1, 2, 3]);
		const facts = new Map([[1, pick(1)]]);
		const done = u.fill(selected, facts);
		expect(r.asked).toEqual([[2, 3]]);
		expect([...u.asking]).toEqual([2, 3]);
		// SHOW opened again while the read is out: nothing asked twice, and it
		// waits for the read that is out.
		const again = u.fill(selected, facts);
		expect(r.asked).toHaveLength(1);
		r.answer({ picked: [pick(2)], missing: [3] });
		await Promise.all([done, again]);
		expect([...facts.keys()]).toEqual([1, 2]);
		// 3: named missing (deleted since, or hidden with reveal off). Out of the selection, counted.
		expect([...selected]).toEqual([1, 2]);
		expect([...u.gone]).toEqual([3]);
		expect([...u.asking]).toEqual([]);
		// And a later SHOW asks nothing more.
		await u.fill(selected, facts);
		expect(r.asked).toHaveLength(1);
	});
	it('a read that could not be made leaves them selected, unlisted, and asks again next time', async () => {
		const r = later();
		const u = new UnseenFacts(r.read);
		const selected = new Set([5]);
		const facts = new Map<number, Picked>();
		const done = u.fill(selected, facts);
		r.answer(null);
		await done;
		expect([...selected]).toEqual([5]);
		expect(u.gone.size).toBe(0);
		void u.fill(selected, facts);
		expect(r.asked).toEqual([[5], [5]]);
	});
	it('an answer after ✕ (reset) is dropped', async () => {
		const r = later();
		const u = new UnseenFacts(r.read);
		const selected = new Set([5, 6]);
		const facts = new Map<number, Picked>();
		const done = u.fill(selected, facts);
		u.reset();
		selected.clear();
		r.answer({ picked: [pick(5)], missing: [6] });
		await done;
		expect(facts.size).toBe(0);
		expect(u.gone.size).toBe(0);
		expect(u.asking.size).toBe(0);
	});
	it('an id unticked while it was asked is not noted, unless SHOW holds its row', async () => {
		const r = later();
		const u = new UnseenFacts(r.read);
		const selected = new Set([5, 6]);
		const facts = new Map<number, Picked>();
		const done = u.fill(selected, facts, () => new Set([6]));
		selected.delete(5);
		selected.delete(6);
		r.answer({ picked: [pick(5), pick(6)], missing: [] });
		await done;
		expect([...facts.keys()]).toEqual([6]);
	});
	it('an answer that leaves ids out without naming them missing takes nothing out (a capped read)', async () => {
		const r = later();
		const u = new UnseenFacts(r.read);
		const selected = new Set([1, 2, 3]);
		const facts = new Map<number, Picked>();
		const done = u.fill(selected, facts);
		r.answer({ picked: [pick(1)], missing: [] });
		await done;
		expect([...facts.keys()]).toEqual([1]);
		// 2 and 3: not answered, not gone. Selected, unlisted, asked again next time.
		expect([...selected]).toEqual([1, 2, 3]);
		expect(u.gone.size).toBe(0);
		void u.fill(selected, facts);
		expect(r.asked).toEqual([
			[1, 2, 3],
			[2, 3]
		]);
	});
	it('a missing id the read was not asked for is not taken out', async () => {
		const r = later();
		const u = new UnseenFacts(r.read);
		const selected = new Set([1, 9]);
		const facts = new Map([[9, pick(9)]]);
		const done = u.fill(selected, facts);
		r.answer({ picked: [], missing: [1, 9] });
		await done;
		expect([...selected]).toEqual([9]);
		expect([...u.gone]).toEqual([1]);
	});
	it('a fill while an earlier read is out settles only once that read has, with its facts in', async () => {
		const r = later();
		const u = new UnseenFacts(r.read);
		const selected = new Set([1, 2]);
		const facts = new Map<number, Picked>();
		// SELECT ALL's own read, held.
		void u.fill(selected, facts);
		// GROUP tapped while it is out: nothing new to ask, but it must wait.
		let settled = false;
		const group = u.fill(selected, facts).then(() => (settled = true));
		expect(r.asked).toHaveLength(1);
		await Promise.resolve();
		await Promise.resolve();
		expect(settled).toBe(false);
		r.answer({ picked: [pick(1), pick(2)], missing: [] }, 0);
		await group;
		expect(settled).toBe(true);
		expect([...facts.keys()]).toEqual([1, 2]);
	});
	it('a fill that asks for more waits for its own read and the earlier one both', async () => {
		const r = later();
		const u = new UnseenFacts(r.read);
		const selected = new Set([1]);
		const facts = new Map<number, Picked>();
		void u.fill(selected, facts);
		selected.add(2);
		let settled = false;
		const group = u.fill(selected, facts).then(() => (settled = true));
		expect(r.asked).toEqual([[1], [2]]);
		r.answer({ picked: [pick(2)], missing: [] }, 1);
		await new Promise((ok) => setTimeout(ok, 0));
		expect(settled).toBe(false);
		r.answer({ picked: [pick(1)], missing: [] }, 0);
		await group;
		expect([...facts.keys()].sort()).toEqual([1, 2]);
	});
	it('a read that throws is a read not made: they stay selected', async () => {
		const u = new UnseenFacts(() => Promise.reject(new Error('offline')));
		const selected = new Set([4]);
		await u.fill(selected, new Map());
		expect([...selected]).toEqual([4]);
		expect(u.gone.size).toBe(0);
		expect(u.asking.size).toBe(0);
	});
	it('after ✕ (reset), a new fill does not wait on the dropped read', async () => {
		const r = later();
		const u = new UnseenFacts(r.read);
		void u.fill(new Set([1]), new Map());
		u.reset();
		const facts = new Map<number, Picked>();
		const done = u.fill(new Set([2]), facts);
		r.answer({ picked: [pick(2)], missing: [] }, 1);
		await done;
		expect([...facts.keys()]).toEqual([2]);
	});
});

describe('goneCount: what SHOW says the read took out', () => {
	it('counts an id named missing only while it is still out', () => {
		const gone = new Set([3, 4]);
		expect(goneCount([1, 3, 4], gone, new Set([1]), new Map())).toBe(2);
		// 4 ticked again by hand from a tile, and drawn: listed, not TAKEN OUT.
		expect(goneCount([1, 3, 4], gone, new Set([1, 4]), new Map([[4, pick(4)]]))).toBe(1);
		// Ticked again but not yet drawn, or drawn and unticked in SHOW: still not out.
		expect(goneCount([3, 4], gone, new Set([4]), new Map())).toBe(1);
		expect(goneCount([3, 4], gone, new Set(), new Map([[4, pick(4)]]))).toBe(1);
	});
});

describe('readFacts: the by-id read, in chunks', () => {
	afterEach(() => vi.unstubAllGlobals());

	it('sends at most FACTS_MAX ids a POST, and joins what each answers', async () => {
		const bodies: number[][] = [];
		vi.stubGlobal(
			'fetch',
			vi.fn(async (url: string, init: RequestInit) => {
				const { ids } = JSON.parse(String(init.body)) as { ids: number[] };
				// The show row's own read, asked beside the cards: no row has one here.
				if (String(url).endsWith('/series/facts')) return new Response('{}');
				bodies.push(ids);
				return new Response(
					JSON.stringify({ series: [card({ id: ids[0] })], missing: [ids[ids.length - 1]] })
				);
			})
		);
		const ids = Array.from({ length: FACTS_MAX + 2 }, (_, i) => i + 1);
		const got = await readFacts(ids);
		expect(bodies.map((b) => b.length)).toEqual([FACTS_MAX, 2]);
		expect(got?.picked.map((p) => p.id)).toEqual([1, FACTS_MAX + 1]);
		expect(got?.missing).toEqual([FACTS_MAX, FACTS_MAX + 2]);
	});
	it('is null when the first POST fails, and keeps what came back when a later one does', async () => {
		vi.stubGlobal(
			'fetch',
			vi.fn(async () => new Response('', { status: 500 }))
		);
		expect(await readFacts([1])).toBeNull();
		let n = 0;
		vi.stubGlobal(
			'fetch',
			vi.fn(async () =>
				n++ === 0
					? new Response(JSON.stringify({ series: [card({ id: 1 })], missing: [] }))
					: new Response('', { status: 500 })
			)
		);
		const got = await readFacts(Array.from({ length: FACTS_MAX + 1 }, (_, i) => i + 1));
		expect(got?.picked.map((p) => p.id)).toEqual([1]);
	});
});

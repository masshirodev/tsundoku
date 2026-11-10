import { afterEach, describe, expect, it, vi } from 'vitest';
import {
	addOnlyLine,
	barCount,
	firstTenLine,
	inBrowseWorld,
	oneTag,
	pressLine,
	showGroups,
	showMeta,
	tickable,
	tickedHere,
	whereLabel,
	type Tick,
	type TickSource
} from '$lib/library/browse-select';
import {
	lanesLine,
	lanesOf,
	resultLines,
	retriable,
	runLanes,
	runningTitle,
	undoBefore,
	undoneLines,
	visibleItems,
	type PressAnswer,
	type PressItem
} from '$lib/library/browse-press';
import type { FilterField } from '$lib/library/browse-filters';

/**
 * SELECT in a source's catalog (card c868; doc/BROWSE.md, "SELECT in a
 * catalog"): the domain layer, pure, before any of it is drawn. The lines are
 * the boards' own words (doc/handoffs/browse-select/: Bars, Results, Show-Tablet).
 */

const MD: TickSource = {
	id: '1',
	name: 'MangaDex',
	family: 'mihon',
	addsHidden: false,
	hidden: false
};
const AS: TickSource = { ...MD, id: '2', name: 'Asura Scans' };
const WC: TickSource = { ...MD, id: '3', name: 'Weeb Central', addsHidden: true };
const NB: TickSource = { ...MD, id: 'ln:nb', name: 'NovelBin', family: 'lnreader' };
const KA: TickSource = { ...MD, id: '4', name: 'KickAssAnime', family: 'aniyomi' };
const TOON: TickSource = { ...MD, id: '5', name: 'Toonily', hidden: true };

let n = 0;
function tick(source: TickSource, over: Partial<Tick> = {}): Tick {
	n++;
	return {
		id: `${source.id}~m${n}`,
		title: `Series ${n}`,
		cover: '',
		hue: 0,
		meta: 'ONGOING',
		source,
		twin: false,
		where: 'POPULAR',
		list: 'popular',
		...over
	};
}

const added = (seriesId: number, over: Partial<Extract<PressAnswer, { status: 'added' }>> = {}) =>
	({
		status: 'added',
		seriesId,
		hidden: false,
		sourceHidden: false,
		queued: 10,
		...over
	}) as PressAnswer;

describe('what can be ticked', () => {
	it('is only what the press could add', () => {
		expect(tickable({ match: { kind: 'new' } })).toBe(true);
		// SAME TITLE is another source's copy: tickable, and counted.
		expect(tickable({ match: { kind: 'same-title' } })).toBe(true);
		expect(tickable({ match: { kind: 'in-library' } })).toBe(false);
		// ADDING, by the server's word or by this tab's own run.
		expect(tickable({ match: { kind: 'new' }, adding: true })).toBe(false);
		expect(tickable({ match: { kind: 'new' } }, true)).toBe(false);
	});
});

describe('where a list is', () => {
	it('names the tab, a search, a filter and a tag', () => {
		expect(whereLabel('popular', '', null)).toBe('POPULAR');
		expect(whereLabel('latest', '', null)).toBe('LATEST');
		expect(whereLabel('filtered', 'solo', null)).toBe('SEARCH "solo"');
		expect(whereLabel('filtered', '', null)).toBe('FILTERED');
		expect(whereLabel('filtered', '', 'Action')).toBe('GENRE: ACTION');
	});

	const schema: FilterField[] = [
		{ type: 'header', name: 'h' },
		{ type: 'select', name: 'Status', state: 0, values: ['All', 'Ongoing'] },
		{ type: 'checkbox', name: 'Has chapters', state: false },
		{
			type: 'group',
			name: 'Genre',
			children: [
				{ type: 'tristate', name: 'Action', state: 0 },
				{ type: 'tristate', name: 'Romance', state: 0 }
			]
		}
	];
	const moved = (f: (s: FilterField[]) => void) => {
		const copy = structuredClone(schema);
		f(copy);
		return copy;
	};

	it('reads a tag arrival as one included genre and nothing else', () => {
		expect(
			oneTag(
				schema,
				moved((s) => (s[3].children![0].state = 1))
			)
		).toBe('Action');
		expect(
			oneTag(
				schema,
				moved((s) => (s[2].state = true))
			)
		).toBe('Has chapters');
	});

	it('reads anything else as FILTERED', () => {
		expect(oneTag(schema, schema)).toBeNull();
		expect(
			oneTag(
				schema,
				moved((s) => (s[3].children![0].state = 2))
			)
		).toBeNull();
		expect(
			oneTag(
				schema,
				moved((s) => (s[1].state = 1))
			)
		).toBeNull();
		expect(
			oneTag(
				schema,
				moved((s) => {
					s[3].children![0].state = 1;
					s[3].children![1].state = 1;
				})
			)
		).toBeNull();
	});
});

describe('the bar and the bulk bar', () => {
	it('counts the selection, and its sources once there are two', () => {
		expect(barCount([tick(MD), tick(MD)])).toEqual({ count: '2 SELECTED', sources: '' });
		expect(barCount([tick(MD), tick(AS)])).toEqual({ count: '2 SELECTED', sources: '· 2 SOURCES' });
	});

	it('says what the press will do, one source, all new (Bars A)', () => {
		const ticks = Array.from({ length: 9 }, () => tick(MD));
		expect(pressLine(ticks, 'popular')).toEqual({
			lead: '9 TO ADD',
			wide: [],
			phone: [],
			right: 'MANGADEX',
			rightPhone: '1 SOURCE'
		});
		expect(addOnlyLine(9)).toBe('9 SERIES · NOTHING DOWNLOADS');
		expect(firstTenLine(ticks)).toBe('UP TO 90 CHAPTERS');
	});

	it('says sources, a twin and a source that adds hidden (Bars B)', () => {
		const ticks = [
			...Array.from({ length: 11 }, () => tick(MD)),
			tick(MD, { twin: true }),
			...Array.from({ length: 3 }, () => tick(WC))
		].slice(0, 14);
		ticks.push(tick(WC));
		const l = pressLine(ticks.slice(0, 14), 'popular');
		expect(l.lead).toBe('14 TO ADD');
		expect(l.wide).toEqual([
			'MANGADEX 12 · WEEB CENTRAL 2',
			'1 HAS A TWIN IN LIBRARY',
			'WEEB CENTRAL ADDS ITS 2 HIDDEN'
		]);
		expect(l.phone).toEqual(['1 TWIN IN LIBRARY']);
		expect(l.right).toBe('2 SOURCES');
		expect(pressLine([tick(WC)], null).wide).toEqual(['WEEB CENTRAL ADDS IT HIDDEN']);
	});

	it('counts kinds apart, chapters and episodes too (Bars C)', () => {
		const ticks = [tick(MD), tick(MD), tick(MD), tick(NB), tick(KA), tick(KA)];
		expect(pressLine(ticks, null).wide[0]).toBe('3 MANGA · 1 NOVEL · 2 ANIME');
		expect(firstTenLine(ticks)).toBe('UP TO 40 CHAPTERS · 20 EPISODES');
		expect(firstTenLine([])).toBe('');
	});

	it('says what the list on screen does not draw', () => {
		const latest = Array.from({ length: 4 }, () => tick(MD, { where: 'LATEST', list: 'latest' }));
		expect(pressLine([tick(MD), ...latest], 'popular').wide).toEqual([
			'4 OF THEM TICKED IN LATEST'
		]);
		const mixed = [tick(MD, { where: 'LATEST', list: 'latest' }), tick(MD)];
		expect(pressLine(mixed, 'search').wide).toEqual(['2 NOT IN THIS LIST']);
		// BROWSE has no list: nothing is "not in it".
		expect(pressLine(mixed, null).wide).toEqual([]);
		expect(pressLine([tick(MD, { twin: true }), tick(MD, { twin: true })], null).wide).toEqual([
			'2 HAVE A TWIN IN LIBRARY'
		]);
	});
});

describe('SHOW', () => {
	it('groups by source, in tick order, and counts what the list on screen lacks', () => {
		const a = tick(MD);
		const b = tick(AS);
		const c = tick(MD, { where: 'LATEST', list: 'latest', twin: true });
		const facts = new Map([a, b, c].map((t) => [t.id, t]));
		const g = showGroups([a.id, b.id, c.id, 'gone'], facts, 'popular');
		expect(g.map((x) => [x.source.name, x.ticks.map((t) => t.id), x.away])).toEqual([
			['MangaDex', [a.id, c.id], 1],
			['Asura Scans', [b.id], 0]
		]);
		expect(showGroups([a.id], facts, null)[0].away).toBe(0);
		expect(showMeta(a)).toBe('MANGA · TICKED IN POPULAR');
		expect(showMeta(c)).toBe('MANGA · TICKED IN LATEST · SAME TITLE IN LIBRARY');
	});

	it('says on BROWSE how many of a source are ticked', () => {
		const ticks = [tick(MD), tick(MD), tick(AS)];
		expect(tickedHere(ticks, MD.id)).toBe('2 TICKED');
		expect(tickedHere(ticks, 'none')).toBe('');
	});
});

describe('the browse world', () => {
	it('is BROWSE, a source page and a preview, and nothing else', () => {
		expect(inBrowseWorld('/browse')).toBe(true);
		expect(inBrowseWorld('/browse/[source]')).toBe(true);
		expect(inBrowseWorld('/downloads/source/[id]')).toBe(true);
		expect(inBrowseWorld('/browse/[source]/settings')).toBe(false);
		expect(inBrowseWorld('/')).toBe(false);
		expect(inBrowseWorld(null)).toBe(false);
	});
});

describe('the press', () => {
	it('makes a lane per source, in tick order', () => {
		const a = tick(MD);
		const b = tick(AS);
		const c = tick(MD);
		expect(lanesOf([a, b, c]).map((l) => l.map((t) => t.id))).toEqual([[a.id, c.id], [b.id]]);
	});

	it('runs lanes at once, one at a time within a lane, and retries a failure once at its end', async () => {
		const a = tick(MD);
		const b = tick(MD);
		const c = tick(AS);
		const asked: string[] = [];
		const inFlight = new Map<string, number>();
		let most = 0;
		const tries = new Map<string, number>();
		const first: [string, string, boolean][] = [];
		await runLanes(
			[a, b, c],
			async (t) => {
				asked.push(t.id);
				const lane = t.source.id;
				inFlight.set(lane, (inFlight.get(lane) ?? 0) + 1);
				most = Math.max(most, inFlight.get(lane)!);
				await new Promise((r) => setTimeout(r, 5));
				inFlight.set(lane, inFlight.get(lane)! - 1);
				tries.set(t.id, (tries.get(t.id) ?? 0) + 1);
				// a refuses once, then is added; c fails for good after one retry.
				if (t.id === a.id && tries.get(t.id) === 1) return { status: 'failed', reason: 'refused' };
				if (t.id === c.id) throw new Error('offline');
				return added(1);
			},
			(t, answer, final) => first.push([t.id, answer.status, final])
		);
		// a: refused (not final), then added; c: no answer twice, the second final.
		expect(first.filter((r) => r[0] === a.id)).toEqual([
			[a.id, 'failed', false],
			[a.id, 'added', true]
		]);
		expect(first.filter((r) => r[0] === c.id)).toEqual([
			[c.id, 'failed', false],
			[c.id, 'failed', true]
		]);
		const reports: [string, string, boolean][] = [];
		await runLanes(
			[a, b, c],
			async (t) => (t.id === c.id ? { status: 'failed', reason: 'deleted' } : added(1)),
			(t, answer, final) => reports.push([t.id, answer.status, final])
		);
		expect(most).toBe(1);
		// The two lanes started together: a and c asked before b.
		expect(asked.slice(0, 2).sort()).toEqual([a.id, c.id].sort());
		expect(asked.filter((id) => id === a.id)).toHaveLength(2);
		expect(asked.filter((id) => id === c.id)).toHaveLength(2);
		// A failure that would answer the same is not asked again.
		expect(reports.filter((r) => r[0] === c.id)).toEqual([[c.id, 'failed', true]]);
		expect(retriable('deleted')).toBe(false);
		expect(retriable('no-answer')).toBe(true);
	});

	it('says how it runs: the title, how far, and its lanes', () => {
		const items: PressItem[] = [
			{ tick: tick(MD), answer: added(1) },
			{ tick: tick(MD), answer: null },
			{ tick: tick(AS), answer: null }
		];
		expect(runningTitle(items)).toEqual({ title: 'ADDING 3 SERIES', done: 1 });
		expect(lanesLine(items)).toBe('MANGADEX 1 OF 2 · ASURA SCANS 0 OF 1');
	});

	it('ends in one result, all added (Results A)', () => {
		const items: PressItem[] = [
			...Array.from({ length: 9 }, (_, i) => ({ tick: tick(MD), answer: added(i + 1) })),
			...Array.from({ length: 5 }, (_, i) => ({ tick: tick(AS), answer: added(i + 20) }))
		];
		const r = resultLines(items, { reveal: false, which: 'first', shelves: ['Later'] })!;
		expect(r.title).toBe('ADDED 14 SERIES · 140 CHAPTERS QUEUED');
		expect(r.detail).toBe('MANGADEX 9 · ASURA SCANS 5 · ON LATER');
		expect(r.added).toHaveLength(14);
		// ADD TO LIBRARY queues nothing, and says nothing of a queue.
		expect(resultLines(items, { reveal: false, which: 'none', shelves: [] })!.title).toBe(
			'ADDED 14 SERIES'
		);
	});

	it('says what failed in a word each, and what was stale (Results B, C)', () => {
		const kagura = tick(MD, { title: 'Kagurabachi' });
		const items: PressItem[] = [
			{ tick: tick(MD), answer: added(1) },
			{ tick: tick(AS), answer: { status: 'failed', reason: 'refused' } },
			{ tick: tick(AS), answer: { status: 'failed', reason: 'refused' } },
			{ tick: kagura, answer: { status: 'failed', reason: 'no-answer' } },
			{ tick: tick(MD), answer: { status: 'skipped', reason: 'in-library' } },
			{ tick: tick(MD), answer: { status: 'skipped', reason: 'adding' } }
		];
		const r = resultLines(items, { reveal: false, which: 'first', shelves: [] })!;
		expect(r.title).toBe('ADDED 1 OF 6 · 10 CHAPTERS QUEUED');
		expect(r.detail).toBe(
			'3 NOT ADDED · ASURA SCANS REFUSED 2 · KAGURABACHI DID NOT ANSWER · 2 SKIPPED · 1 WAS IN THE LIBRARY BY THEN · 1 WAS ALREADY BEING ADDED'
		);
		expect(r.failed).toHaveLength(3);
	});

	it("says c505's words for many, outside reveal and in (Results D)", () => {
		const items: PressItem[] = [
			{ tick: tick(MD), answer: added(1) },
			{ tick: tick(WC), answer: added(2, { hidden: true }) },
			{ tick: tick(WC), answer: added(3, { hidden: true }) }
		];
		const off = resultLines(items, { reveal: false, which: 'first', shelves: [] })!;
		expect(off.title).toBe('ADDED 3 SERIES · 2 OF THEM HIDDEN');
		expect(off.detail).toBe(
			'WEEB CENTRAL ADDS ITS SERIES HIDDEN · 30 CHAPTERS QUEUED · REVEAL SHOWS THEM'
		);
		const on = resultLines(items, { reveal: true, which: 'first', shelves: [] })!;
		expect(on.detail).toBe('WEEB CENTRAL ADDS ITS SERIES HIDDEN · 30 CHAPTERS QUEUED');
		// The press left the source mostly hidden: it is not named outside reveal.
		items[2] = { tick: items[2].tick, answer: added(3, { hidden: true, sourceHidden: true }) };
		expect(resultLines(items, { reveal: false, which: 'none', shelves: [] })!.detail).toBe(
			'2 OF THEM HIDDEN BY THEIR SOURCE · THE SOURCE IS HIDDEN WITH THEM · REVEAL SHOWS BOTH'
		);
	});

	it('counts episodes apart, and says a queue that did not answer', () => {
		const items: PressItem[] = [
			{ tick: tick(MD), answer: added(1, { queued: 1 }) },
			{ tick: tick(KA), answer: added(2, { queued: 1 }) },
			{ tick: tick(KA), answer: added(3, { queued: 'down' }) }
		];
		const r = resultLines(items, { reveal: false, which: 'all', shelves: [] })!;
		expect(r.title).toBe('ADDED 3 SERIES · 1 CHAPTER · 1 EPISODE QUEUED');
		expect(r.detail).toBe(
			'SOME NOT QUEUED · DOWNLOADING ISN’T ANSWERING · MANGADEX 1 · KICKASSANIME 2'
		);
	});

	it('draws nothing of a hidden source outside reveal (Rules)', () => {
		const items: PressItem[] = [
			{ tick: tick(TOON), answer: added(1) },
			{ tick: tick(MD), answer: added(2) }
		];
		expect(visibleItems(items, false)).toHaveLength(1);
		expect(visibleItems(items, true)).toHaveLength(2);
		expect(resultLines([items[0]], { reveal: false, which: 'none', shelves: [] })).toBeNull();
		expect(resultLines(items, { reveal: false, which: 'none', shelves: [] })!.title).toBe(
			'ADDED 1 SERIES'
		);
	});

	it('says what UNDO leaves, before and after (Results E)', () => {
		const list = Array.from({ length: 14 }, (_, i) => ({ seriesId: i + 1 }));
		expect(undoBefore(list, [])).toEqual({ cell: 'UNDO', detail: '', out: 14 });
		expect(undoBefore(list, [1, 2])).toEqual({
			cell: 'UNDO 12',
			detail: '2 HAVE A CHAPTER DOWNLOADED NOW · UNDO LEAVES THOSE 2',
			out: 12
		});
		expect(undoBefore(list.slice(0, 2), [1])).toMatchObject({
			cell: 'UNDO 1',
			detail: '1 HAS A CHAPTER DOWNLOADED NOW · UNDO LEAVES IT'
		});
		expect(undoBefore(list.slice(0, 1), [1]).cell).toBe('');
		const manga: PressItem[] = [{ tick: tick(MD), answer: added(1) }];
		expect(undoneLines({ out: 12, stayed: 2, gone: 0, queuedOut: 120 }, manga)).toEqual({
			title: 'UNDONE · 12 TAKEN OUT, WITH THEIR 120 QUEUED CHAPTERS',
			detail:
				"2 STAY: SOMETHING OF THEM IS DOWNLOADED OR READ · THE LIBRARY'S DELETE TAKES THEM OUT"
		});
		expect(undoneLines({ out: 1, stayed: 0, gone: 0, queuedOut: 0 })).toEqual({
			title: 'UNDONE · 1 TAKEN OUT',
			detail: ''
		});
		const both: PressItem[] = [...manga, { tick: tick(KA), answer: added(2) }];
		expect(undoneLines({ out: 2, stayed: 1, gone: 0, queuedOut: 3 }, both).title).toBe(
			'UNDONE · 2 TAKEN OUT, WITH THEIR 3 QUEUED'
		);
	});
});

describe('the selection in this tab', () => {
	afterEach(() => {
		vi.unstubAllGlobals();
		vi.resetModules();
	});

	it('is written only in a browser', async () => {
		const { browseSelection } = await import('$lib/library/browse-selection.svelte');
		browseSelection.start(false);
		expect(browseSelection.selecting).toBe(false);
	});

	it('ticks, ends on leaving the browse world and on reveal changing', async () => {
		vi.stubGlobal('window', {});
		const { browseSelection: s } = await import('$lib/library/browse-selection.svelte');
		s.start(false);
		const a = tick(MD);
		const b = tick(AS);
		s.toggle(a);
		s.toggle(b);
		s.toggle(a);
		s.toggle(a);
		// A map keeps the order they were ticked: b, then a again.
		expect(s.list.map((t) => t.id)).toEqual([b.id, a.id]);
		s.follow('/browse/[source]');
		s.follow('/downloads/source/[id]');
		expect(s.selecting).toBe(true);
		s.follow('/series/[id]');
		expect(s.selecting).toBe(false);
		expect(s.list).toEqual([]);
		s.start(false);
		s.toggle(a);
		s.checkReveal(false);
		expect(s.has(a.id)).toBe(true);
		s.checkReveal(true);
		expect(s.selecting).toBe(false);
		// Not selecting, a tap ticks nothing.
		s.toggle(a);
		expect(s.list).toEqual([]);
	});

	it('presses one run: SELECT ends, answers land, the band says the result, UNDO the rest', async () => {
		vi.stubGlobal('window', {});
		const calls: { path: string; body: unknown }[] = [];
		vi.stubGlobal('fetch', async (path: string, init: { body: string }) => {
			const body = JSON.parse(init.body);
			calls.push({ path, body });
			const reply = (v: unknown) => ({ ok: true, status: 200, json: async () => v });
			if (path === '/api/browse/press') {
				if (body.id.endsWith('gone')) return { ok: false, status: 404 };
				if (body.id.endsWith('down')) return { ok: false, status: 503 };
				return reply(added(Number(body.id.split('~m')[1])));
			}
			if (path === '/api/browse/press/touched') return reply({ touched: [] });
			if (path === '/api/browse/press/shelve') return reply({ shelved: 1 });
			if (path === '/api/browse/press/undo')
				return reply({ out: 1, stayed: 0, gone: 0, queuedOut: 10 });
			throw new Error(path);
		});
		const { browseSelection: s } = await import('$lib/library/browse-selection.svelte');
		s.start(false);
		const a = tick(MD);
		const gone = tick(AS, { id: `${AS.id}~gone` });
		s.toggle(a);
		s.toggle(gone);
		let ended = 0;
		s.press('first', () => ended++);
		expect(s.selecting).toBe(false);
		const run = s.run!;
		// One press at a time: a second while this one runs starts nothing.
		expect(s.running).toBe(true);
		s.start(false);
		s.toggle(tick(MD));
		s.press('none', () => {});
		expect(s.run).toBe(run);
		s.end();
		expect(s.addingIds().size).toBe(2);
		expect(run.lines(false)?.kind).toBe('running');
		await vi.waitFor(() => expect(run.finished).toBe(true));
		expect(ended).toBe(1);
		const r = run.lines(false);
		expect(r?.kind === 'result' && r.title).toBe('ADDED 1 OF 2 · 10 CHAPTERS QUEUED');
		expect(r?.kind === 'result' && r.detail).toBe(
			`1 NOT ADDED · ${gone.title.toUpperCase()} IS NOT AT ITS SOURCE`
		);
		expect(s.addingIds().size).toBe(0);
		await run.shelve({ id: 7, name: 'Later' }, true);
		expect(calls.at(-1)).toEqual({
			path: '/api/browse/press/shelve',
			body: {
				items: [{ series: Number(a.id.split('~m')[1]), preview: a.id }],
				collection: 7,
				on: true
			}
		});
		await run.undo(false);
		expect(run.lines(false)).toMatchObject({
			kind: 'undone',
			title: 'UNDONE · 1 TAKEN OUT, WITH THEIR 10 QUEUED CHAPTERS'
		});
		s.closeRun();
		expect(s.run).toBeNull();
	});

	it('retries the failed ones, and a shelf chosen while it runs reaches later adds', async () => {
		vi.stubGlobal('window', {});
		let failOnce = true;
		const shelved: unknown[] = [];
		vi.stubGlobal('fetch', async (path: string, init: { body: string }) => {
			const body = JSON.parse(init.body);
			const reply = (v: unknown) => ({ ok: true, status: 200, json: async () => v });
			if (path === '/api/browse/press') {
				if (body.id.endsWith('flaky') && failOnce) {
					return reply({ status: 'failed', reason: 'deleted' });
				}
				return reply(added(5));
			}
			if (path === '/api/browse/press/shelve') shelved.push(body);
			return reply({ touched: [5], shelved: 1 });
		});
		const { PressRun } = await import('$lib/library/browse-selection.svelte');
		const flaky = tick(MD, { id: `${MD.id}~flaky` });
		const run = new PressRun([flaky], 'none');
		run.shelves = [{ id: 3, name: 'Tonight' }];
		await run.go();
		expect(run.items[0].answer).toEqual({ status: 'failed', reason: 'deleted' });
		failOnce = false;
		run.retry();
		await vi.waitFor(() => expect(run.items[0].answer?.status).toBe('added'));
		await vi.waitFor(() => expect(shelved).toHaveLength(1));
		await vi.waitFor(() => expect(run.finished).toBe(true));
		const lines = run.lines(false);
		expect(lines?.kind === 'result' && lines.undo.cell).toBe('');
	});
});

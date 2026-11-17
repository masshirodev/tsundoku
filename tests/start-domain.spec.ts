import { describe, expect, it } from 'vitest';
import {
	countLine,
	firstOpen,
	importDoneLine,
	parseSkipped,
	readLeads,
	readTrail,
	startView,
	TRAIL,
	trailDone,
	trailHere,
	trailLasts,
	withSkip,
	type StartFacts,
	type StepId
} from '../src/lib/library/start';

/**
 * GET STARTED's steps (doc/ONBOARDING.md): what ticks them,
 * skips and what they take with them, the two parts, the way back, and the words.
 */

const none: StartFacts = {
	repositories: 0,
	installed: 0,
	series: 0,
	phones: 0,
	records: 0,
	added: 0,
	queued: 0,
	downloaded: 0
};
const setUp: StartFacts = { ...none, repositories: 1, installed: 2, series: 1, phones: 1 };
const states = (f: StartFacts, skipped: StepId[] = []) =>
	startView(f, skipped).steps.map((s) => s.state);

describe('the steps tick by what is there', () => {
	it('a new library: 01, 03 and 04 to do; 02 waits on 01, FIRST READ on 02', () => {
		const v = startView(none, []);
		expect(states(none)).toEqual([
			'todo',
			'blocked',
			'todo',
			'todo',
			'blocked',
			'blocked',
			'blocked'
		]);
		expect(v.steps[1].meta).toBe('After 01 · no repository, so nothing to install');
		expect(v.steps[4].meta).toBe('After 02 · no source to search yet');
		expect(v.parts[1].line).toBe('AFTER 02');
		expect(v.finished).toBe(false);
		expect(firstOpen(v)).toBe('repo');
	});
	it('each fact ticks its step, and says what it found', () => {
		const f = { ...setUp, repositories: 2, installed: 3, records: 1, added: 1, queued: 10 };
		const v = startView(f, []);
		expect(v.steps.map((s) => s.meta)).toEqual([
			'Done · 2 repositories',
			'Done · 3 installed',
			'Done · 1 series',
			'Done · a phone or tablet reads here',
			'Done · 1 series read online',
			'Done · 1 series added',
			'Done · 10 queued'
		]);
		expect(v.done).toBe(7);
		expect(v.finished).toBe(true);
		expect(firstOpen(v)).toBeNull();
	});
	it('07 says queued while the queue holds some, then downloaded', () => {
		const meta = (f: Partial<StartFacts>) => startView({ ...setUp, ...f }, []).steps[6].meta;
		expect(meta({ queued: 3, downloaded: 2 })).toBe('Done · 3 queued');
		expect(meta({ downloaded: 10 })).toBe('Done · 10 downloaded');
	});
	it('a repository opens 02; an extension opens FIRST READ, which opens first', () => {
		expect(states({ ...none, repositories: 1 }).slice(0, 2)).toEqual(['done', 'todo']);
		const v = startView({ ...none, repositories: 1, installed: 1 }, []);
		expect(v.steps.slice(4).map((s) => s.state)).toEqual(['todo', 'todo', 'todo']);
		expect(firstOpen(v)).toBe('find');
	});
	it('done wins: a later FIRST READ step ticks the ones before it', () => {
		const add = startView({ ...setUp, added: 1 }, []);
		expect(add.steps.slice(4).map((s) => s.state)).toEqual(['done', 'done', 'todo']);
		expect(add.steps[4].meta).toBe('Done · with 06');
		const dl = startView({ ...setUp, downloaded: 4 }, []);
		expect(dl.steps.slice(4).map((s) => s.meta)).toEqual([
			'Done · with 07',
			'Done · with 07',
			'Done · 4 downloaded'
		]);
	});
	it('the phone has shorter metas for FIRST READ', () => {
		const v = startView(setUp, []);
		expect(v.steps.slice(4).map((s) => s.short)).toEqual([
			'Search your sources',
			'+ Add to library keeps it',
			'They read offline'
		]);
	});
});

describe('SKIP and UNDO', () => {
	it('skipping 01 takes 02 and FIRST READ with it, and UNDO on 01 brings them back', () => {
		const skipped = withSkip([], 'repo', true);
		const v = startView(none, skipped);
		expect(v.steps.map((s) => s.state)).toEqual([
			'skipped',
			'skipped',
			'todo',
			'todo',
			'skipped',
			'skipped',
			'skipped'
		]);
		expect(v.steps[1]).toMatchObject({ meta: 'Skipped with 01', with: 'repo' });
		expect(v.steps[5]).toMatchObject({ meta: 'Skipped with 01', with: 'repo' });
		expect(v.parts[1].line).toBe('3 SKIPPED WITH 01');
		// Gone with 01, FIRST READ keeps its rows to say why.
		expect(v.parts[1]).toMatchObject({ finished: true, folds: false });
		expect(v.skipped).toBe(5);
		expect(states(none, withSkip(skipped, 'repo', false))[1]).toBe('blocked');
	});
	it('skipping 02 takes FIRST READ with it', () => {
		const v = startView({ ...none, repositories: 1 }, ['ext']);
		expect(v.steps.slice(4).map((s) => s.meta)).toEqual([
			'Skipped with 02',
			'Skipped with 02',
			'Skipped with 02'
		]);
		expect(v.parts[1].line).toBe('3 SKIPPED WITH 02');
	});
	it('a FIRST READ step skipped on its own takes nothing with it', () => {
		const v = startView({ ...setUp, records: 1, added: 1 }, ['download']);
		expect(v.steps[6]).toMatchObject({ state: 'skipped', meta: 'Skipped', with: null });
		expect(v.parts[1].line).toBe('2 OF 3 DONE · 1 SKIPPED');
		expect(v.parts[1].finished).toBe(true);
	});
	it('every step done or skipped finishes the list', () => {
		const v = startView({ ...none, repositories: 1, installed: 1 }, [
			'library',
			'phone',
			'find',
			'add',
			'download'
		]);
		expect(v.finished).toBe(true);
		expect(countLine(v)).toBe('2 OF 7 DONE · 5 SKIPPED');
		expect(countLine(v, true)).toBe('2 OF 7 · 5 SKIPPED');
	});
	it('done wins over a skip kept from before', () => {
		expect(states({ ...none, series: 4 }, ['library'])[2]).toBe('done');
		expect(states({ ...setUp, records: 1 }, ['find'])[4]).toBe('done');
	});
	it('reads what it kept, and nothing broken', () => {
		expect(parseSkipped('["phone","nope","repo","download"]')).toEqual([
			'repo',
			'phone',
			'download'
		]);
		for (const bad of ['', '{', '{"a":1}', '"repo"']) expect(parseSkipped(bad)).toEqual([]);
	});
});

describe('the two parts', () => {
	it('count apart, and say their order', () => {
		const v = startView({ ...none, repositories: 1, installed: 1 }, []);
		expect(v.parts.map((p) => [p.name, p.line])).toEqual([
			['SET UP', '2 OF 4 DONE · ANY ORDER'],
			['FIRST READ', '0 OF 3 · IN ORDER']
		]);
	});
	it('a finished part folds to one row that says what it did', () => {
		const v = startView({ ...none, repositories: 1, installed: 1, phones: 1 }, ['library']);
		expect(v.parts[0]).toMatchObject({
			finished: true,
			title: 'Set up',
			fold: '3 done · 1 skipped · repository, extension, phone',
			foldShort: '3 done · 1 skipped'
		});
		expect(readLeads(v)).toBe(true);
		expect(readLeads(startView(none, []))).toBe(false);
	});
	it('the head counts both parts', () => {
		expect(countLine(startView(none, []))).toBe('0 OF 7 DONE');
	});
});

describe('the way back', () => {
	it('SET UP steps, once ticked', () => {
		const v = startView({ ...none, repositories: 1 }, []);
		expect(trailDone(v, 'repo')).toEqual({
			a: '✓ 01 DONE · A REPOSITORY ADDED',
			b: 'STILL OPEN · 02 INSTALL AN EXTENSION'
		});
		const all = startView({ ...setUp, added: 1, queued: 1 }, []);
		expect(trailDone(all, 'phone').b).toBe('EVERY STEP DONE OR SKIPPED');
	});
	it("FIRST READ's band lasts across its screens, through the reader, not EXTENSIONS", () => {
		for (const p of [
			'/downloads/search',
			'/browse',
			'/browse/mihon:1',
			'/downloads/source/12',
			'/series/4',
			'/downloads'
		])
			expect(trailHere('find', p), p).toBe(true);
		expect(trailHere('find', '/read/9')).toBe(false);
		expect(trailLasts('find', '/read/9')).toBe(true);
		expect(trailLasts('find', '/browse/extensions')).toBe(false);
		expect(trailLasts('find', '/settings')).toBe(false);
		expect(trailLasts('find', '/')).toBe(false);
		expect(trailHere('repo', '/browse/extensions')).toBe(true);
		expect(trailHere('repo', '/browse')).toBe(false);
	});
	it('03’s IMPORT A BACKUP → starts a trip on the import pages, not the log', () => {
		expect(TRAIL.library?.href).toBe('/import');
		for (const p of ['/import', '/import/12', '/import/upload'])
			expect(trailHere('library', p), p).toBe(true);
		// The log draws no band, and a look at it from the result keeps the trip.
		expect(trailHere('library', '/import/log')).toBe(false);
		expect(trailLasts('library', '/import/log')).toBe(true);
		for (const p of ['/', '/importer', '/settings', '/start', '/series/4'])
			expect(trailLasts('library', p), p).toBe(false);
		expect(TRAIL.library?.doing()).toBe('TICKS ITSELF WHEN AN IMPORT OR A SCAN BRINGS IN A SERIES');
		// Every step with a trail ends its trip off its screens: none lasts on the library.
		for (const id of Object.keys(TRAIL) as StepId[]) expect(trailLasts(id, '/'), id).toBe(false);
	});
	it('03 done by an import names it and its count; a scan alone keeps the step’s line', () => {
		expect(importDoneLine({ id: 4, app: 'mihon', series: 382 })).toBe(
			'Done · Mihon backup · 382 series'
		);
		expect(importDoneLine({ id: 4, app: 'mihon', series: 1 })).toBe(
			'Done · Mihon backup · 1 series'
		);
		expect(importDoneLine({ id: 4, app: 'mihon', series: 1234 })).toBe(
			'Done · Mihon backup · 1,234 series'
		);
		// An import that brought nothing the viewer sees did not tick it.
		expect(importDoneLine({ id: 4, app: 'mihon', series: 0 })).toBeNull();
		expect(importDoneLine(null)).toBeNull();
		expect(importDoneLine({ id: 4, app: 'aniyomi', series: 2 })).toBe(
			'Done · Aniyomi backup · 2 series'
		);
	});
	it('arrives on 05, moves on as each step ticks, and rings the next control', () => {
		const f = { ...setUp };
		const before: StepId[] = [];
		const arrive = readTrail(startView(f, []), before);
		expect(arrive).toMatchObject({
			mode: 'arrive',
			a: 'FIRST READ · 05 OF 07 · FIND SOMETHING TO READ',
			b: 'OPEN A RESULT, THEN ▶ READ · TICKS ITSELF WHEN A CHAPTER IS OPENED',
			short: '05 OF 07',
			ring: null
		});
		const read = readTrail(startView({ ...f, records: 1 }, []), before);
		expect(read).toMatchObject({
			mode: 'ticked',
			a: '✓ 05 DONE · READ ONLINE',
			b: "NOW 06 OF 07 · + ADD TO LIBRARY, BELOW · TICKS ITSELF WHEN IT'S ADDED",
			ring: 'add'
		});
		const added = readTrail(
			startView({ ...f, records: 1, added: 1 }, []),
			['find'],
			'140 CHAPTERS · NONE DOWNLOADED'
		);
		expect(added).toMatchObject({
			a: '✓ 06 DONE · ADDED TO THE LIBRARY',
			b: '140 CHAPTERS · NONE DOWNLOADED · NOW 07 OF 07 · THE DOWNLOAD ROW',
			ring: 'download'
		});
		const g = { ...f, records: 1, added: 1, queued: 10, series: 0 };
		const done = readTrail(startView(g, []), ['find', 'add']);
		expect(done).toMatchObject({
			mode: 'done',
			a: '✓ 07 DONE · 10 CHAPTERS QUEUED · FIRST READ DONE',
			b: 'STILL OPEN · 03 BRING A LIBRARY YOU ALREADY HAVE',
			ring: null
		});
	});
	it('a step done before the trip is not news', () => {
		const f = { ...setUp, records: 1 };
		expect(readTrail(startView(f, []), ['find'])).toMatchObject({
			mode: 'arrive',
			a: 'FIRST READ · 06 OF 07 · ADD IT TO YOUR LIBRARY',
			ring: 'add'
		});
	});
});

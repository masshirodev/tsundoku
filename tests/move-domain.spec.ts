import { describe, expect, it } from 'vitest';
import {
	atOf,
	buildMoveMap,
	guessOffset,
	moveSummary,
	movedDetail,
	queueCounts,
	titleKey,
	type MoveCandidateEntry,
	type MoveEntry
} from '$lib/library/move';

/**
 * MOVE's rules (doc/MOVE.md; card c139): the by-number map, every odd case
 * the handoff draws, and the counts "WHAT THE MOVE DOES" promises. Pure, so
 * every case is a list in and rows out.
 */

const entry = (n: number, o: Partial<MoveEntry> = {}): MoveEntry => ({
	id: o.id ?? n,
	number: n,
	season: o.season ?? null,
	title: o.title ?? '',
	label: o.label ?? `Ch. ${n}`,
	readAt: o.readAt ?? null,
	lastPosition: o.lastPosition ?? null,
	lastOpenedAt: o.lastOpenedAt ?? null,
	available: o.available ?? false,
	queued: o.queued ?? false
});

const candidate = (n: number, o: Partial<MoveCandidateEntry> = {}): MoveCandidateEntry => ({
	number: n,
	season: o.season ?? null,
	title: o.title ?? '',
	url: o.url ?? `/c${n}`,
	name: o.name ?? `Chapter ${n}`,
	uploaded: o.uploaded ?? 0,
	order: o.order ?? n
});

const opts = { kind: 'manga' as const, from: 'Asura Scans', to: 'Weeb Central' };

describe('the by-number map', () => {
	it('matches exact numbers, folds a run, and keeps the odd ones apart', () => {
		const yours = [1, 2, 3, 4, 5].map((n) => entry(n));
		const theirs = [0, 1, 2, 3, 4, 5, 6, 7].map((n) => candidate(n));
		const plan = buildMoveMap(yours, theirs, opts);
		expect(plan.matches).toHaveLength(5);
		expect(plan.kept).toHaveLength(0);
		expect(plan.added.map((a) => a.number)).toEqual([0, 6, 7]);
		// 1–5 folds into one row; 0 before it and 6–7 after are their own.
		expect(plan.rows.map((r) => [r.variant, r.yours, r.theirs, r.status])).toEqual([
			['added', '—', '0', 'ADDED · UNREAD'],
			['match', '1 – 5', '1 – 5', '5 MATCH'],
			['added', '—', '6 – 7', '2 ADDED · NOT DOWNLOADED']
		]);
	});

	it('a match that was read says so, and a single match is not called "1 MATCH"', () => {
		const plan = buildMoveMap(
			[entry(1, { readAt: 5 }), entry(2, { readAt: 6 })],
			[candidate(1), candidate(2)],
			opts
		);
		expect(plan.rows[0]).toMatchObject({
			variant: 'match',
			status: '2 MATCH · READ',
			yours: '1 – 2',
			theirs: '1 – 2'
		});
		const single = buildMoveMap([entry(1, { readAt: 5 })], [candidate(1)], opts);
		expect(single.rows[0].status).toBe('MATCH · READ');
	});

	it('keeps a chapter the new source lacks, with its own file, and never folds it into a run', () => {
		const plan = buildMoveMap(
			[entry(1, { available: true }), entry(2, { title: 'Afterword', available: true })],
			[candidate(1), candidate(3)],
			opts
		);
		expect(plan.kept.map((k) => k.number)).toEqual([2]);
		const kept = plan.rows.find((r) => r.variant === 'kept')!;
		expect(kept).toMatchObject({
			yours: 'Afterword',
			theirs: '—',
			status: 'KEPT FROM ASURA SCANS',
			downloaded: true
		});
		expect(plan.rows.some((r) => r.variant === 'added' && r.theirs === '3')).toBe(true);
	});

	it('draws a split as its own row: 10 kept with its file, 10.1 and 10.2 added', () => {
		const plan = buildMoveMap(
			[entry(10, { available: true })],
			[candidate(10.1), candidate(10.2)],
			opts
		);
		expect(plan.kept).toEqual([]);
		expect(plan.added).toEqual([]);
		expect(plan.rows).toHaveLength(1);
		expect(plan.rows[0]).toMatchObject({
			variant: 'split',
			yours: '10',
			theirs: '10.1 · 10.2',
			status: 'SPLIT · 10 KEPT WITH ITS FILE',
			detail: '10.1 and 10.2 added, unread',
			downloaded: true
		});
	});

	it('a read mark on 10 carries to 10.1 and 10.2, so they arrive read', () => {
		const plan = buildMoveMap(
			[entry(10, { readAt: 100 })],
			[candidate(10.1), candidate(10.2)],
			opts
		);
		expect(plan.readAdded.map((r) => r.number)).toEqual([10.1, 10.2]);
		expect(plan.rows[0]).toMatchObject({
			detail: '10.1 and 10.2 added, read',
			read: true
		});
		const summary = moveSummary(plan, {
			kind: 'manga',
			from: 'Asura Scans',
			to: 'Weeb Central',
			follow: false,
			yours: [entry(10, { readAt: 100 })]
		});
		expect(summary.find((r) => r.key === 'reading')!.b).toBe(
			"CARRIES BY NUMBER · 10'S READ MARK GOES TO 10.1 AND 10.2"
		);
	});

	it('takes an unnumbered extra as only yours, and a 0 on their side as added unread', () => {
		const plan = buildMoveMap(
			[entry(1), entry(1.001, { title: 'Afterword', label: 'Afterword' })],
			[candidate(0, { name: 'Prologue' }), candidate(1)],
			opts
		);
		expect(plan.kept.map((k) => k.title)).toEqual(['Afterword']);
		expect(plan.added.map((a) => a.number)).toEqual([0]);
		const added = plan.rows.find((r) => r.variant === 'added')!;
		expect(added.status).toBe('ADDED · UNREAD');
		// An unnumbered candidate (a source that gave -1) has no number to sort by.
		const unnumbered = buildMoveMap(
			[entry(1)],
			[candidate(1), candidate(-1, { name: 'Bonus' })],
			opts
		);
		expect(unnumbered.added.map((a) => a.name)).toEqual(['Bonus']);
		expect(unnumbered.rows.some((r) => r.variant === 'added' && r.theirs === 'Bonus')).toBe(true);
	});

	it('does not call a fractional extra and a whole chapter a split', () => {
		// Our afterword at 10.5 is not their chapter 11: the numbers differ.
		const plan = buildMoveMap(
			[entry(10), entry(10.5, { title: 'Afterword' })],
			[candidate(10), candidate(11)],
			opts
		);
		expect(plan.kept.map((k) => k.number)).toEqual([10.5]);
		expect(plan.added.map((a) => a.number)).toEqual([11]);
		expect(plan.splits).toEqual([]);
	});

	it('marks where reading is, and says where it opens', () => {
		const plan = buildMoveMap(
			[entry(40, { readAt: 1 }), entry(41, { lastPosition: 11, lastOpenedAt: 2 })],
			[candidate(40), candidate(41)],
			opts
		);
		const here = plan.rows.find((r) => r.here)!;
		expect(here).toMatchObject({
			variant: 'match',
			yours: '41',
			theirs: '41',
			status: 'MATCH · READING CARRIES',
			detail: "Opens at p. 12 on Weeb Central's 41"
		});
	});

	it('a queued match says QUEUED, and is counted by the queue rules', () => {
		const yours = [entry(1, { queued: true }), entry(2, { queued: true })];
		const plan = buildMoveMap(yours, [candidate(1), candidate(2), candidate(3)], opts);
		expect(plan.rows[0].status).toBe('2 MATCH · 2 QUEUED');
		expect(queueCounts(yours, plan)).toEqual({ queued: 2, moving: 2, dropping: 0 });
		// A queued chapter with no partner leaves the queue.
		const dropped = buildMoveMap(yours, [candidate(1)], opts);
		expect(queueCounts(yours, dropped)).toEqual({ queued: 2, moving: 1, dropping: 1 });
	});
});

describe('anime', () => {
	it('matches season to season, and does not take another season or an episode past the series’ own', () => {
		const yours = [1, 2, 3].map((n) => entry(n, { season: 3 }));
		const theirs = [
			candidate(1, { season: 1 }),
			candidate(10, { season: 3 }),
			candidate(24, { season: 3 }),
			candidate(25, { season: 3 }),
			candidate(1, { season: 4 })
		];
		const plan = buildMoveMap(yours, theirs, { ...opts, kind: 'anime' });
		expect(plan.seasoned).toBe(true);
		expect(plan.matches).toHaveLength(0);
		// The series is S3 1–3; their S3 10 and 24 are after it, 25 too, and S1/S4 another season.
		expect(plan.added).toEqual([]);
		expect(plan.notTaken.map((t) => [t.season, t.number])).toEqual([
			[1, 1],
			[3, 10],
			[3, 24],
			[3, 25],
			[4, 1]
		]);
		expect(plan.rows[0].status).toBe('NOT TAKEN · ANOTHER SEASON');
		expect(plan.rows.some((r) => r.status === 'NOT TAKEN · AFTER YOURS')).toBe(true);
	});

	it('matches S3 EP. 8 to their S3 EP. 8 and reads the season on every row', () => {
		const plan = buildMoveMap(
			[1, 2, 3, 4, 5, 6, 7, 8].map((n) =>
				entry(n, {
					season: 3,
					readAt: n < 8 ? 1 : null,
					lastPosition: n === 8 ? 568 : null,
					lastOpenedAt: n === 8 ? 2 : null
				})
			),
			[1, 2, 3, 4, 5, 6, 7, 8].map((n) => candidate(n, { season: 3 })),
			{ ...opts, kind: 'anime' }
		);
		expect(plan.matches).toHaveLength(8);
		expect(plan.rows[0]).toMatchObject({
			yours: 'S3 · 1 – 7',
			theirs: 'S3 · 1 – 7',
			status: '7 MATCH · READ'
		});
		const here = plan.rows.find((r) => r.here)!;
		expect(here).toMatchObject({ yours: 'S3 · 8', status: 'MATCH · READING CARRIES' });
		expect(here.detail).toMatch(/^Resumes at 9:28 there$/);
	});

	it('a flat candidate takes an offset, guessed from episode titles, and the map redraws with it', () => {
		const yours = [
			entry(1, { season: 3, title: 'The First Snow' }),
			entry(2, { season: 3, title: 'A Door Without a Key' }),
			entry(3, { season: 3, title: 'Thaw' })
		];
		const theirs = [
			...[1, 2, 3, 4].map((n) => candidate(n, { title: `Season 1 thing ${n}` })),
			candidate(50, { title: 'The First Snow' }),
			candidate(51, { title: 'A Door Without a Key' }),
			candidate(52, { title: 'Something Else' }),
			...[53, 60].map((n) => candidate(n, { title: `Season 4 thing ${n}` }))
		];
		const guess = guessOffset(yours, theirs);
		expect(guess).toEqual({ offset: 50, agree: 2, of: 3 });
		const plan = buildMoveMap(yours, theirs, { ...opts, kind: 'anime', offset: guess.offset });
		expect(plan.offset).toBe(50);
		expect(plan.matches.map((m) => m.candidate.number)).toEqual([50, 51, 52]);
		// Their 52 is your 3: the offset aligns them, and matching is by number.
		// Their 53 and 60 come after the series' S3 1–3, and 1–4 before it: not taken.
		expect(plan.added).toEqual([]);
		expect(plan.notTaken.every((t) => t.number < 50 || t.number > 52)).toBe(true);
		const after = plan.rows.filter(
			(r) => r.variant === 'untaken' && r.status === 'NOT TAKEN · AFTER YOURS'
		);
		expect(after.map((r) => r.theirs)).toEqual(['53 – 60']);
	});

	it('an editable offset moves the map: their 51 is your 1 when it is 51', () => {
		const plan = buildMoveMap(
			[entry(1, { season: 3 }), entry(2, { season: 3 })],
			[candidate(50), candidate(51), candidate(52)],
			{ ...opts, kind: 'anime', offset: 51 }
		);
		expect(plan.matches.map((m) => m.candidate.number)).toEqual([51, 52]);
		expect(plan.notTaken.map((t) => [t.number, t.season])).toEqual([[50, null]]);
	});

	it('guesses 1 when no titles agree, rather than inventing an offset', () => {
		expect(
			guessOffset(
				[entry(1, { season: 2, title: 'One' }), entry(2, { season: 2, title: 'Two' })],
				[candidate(1, { title: 'Ichi' }), candidate(2, { title: 'Ni' })]
			)
		).toEqual({ offset: 1, agree: 0, of: 2 });
	});
});

describe('the summary', () => {
	const yours = [
		entry(1, { available: true, readAt: 1 }),
		entry(2, { available: true, readAt: 2 }),
		entry(3, { lastPosition: 11, lastOpenedAt: 3 }),
		entry(4, { queued: true }),
		entry(5, { queued: true }),
		entry(9, { title: 'Afterword', available: true })
	];
	const theirs = [1, 2, 3, 4, 6, 7, 8].map((n) => candidate(n));
	const plan = buildMoveMap(yours, theirs, opts);
	const summary = moveSummary(plan, {
		kind: 'manga',
		from: 'Asura Scans',
		to: 'Weeb Central',
		follow: true,
		yours
	});
	const row = (key: string) => summary.find((r) => r.key === key)!;

	it('counts what matches, what is kept and what appears', () => {
		expect(row('chapters')).toEqual({
			key: 'chapters',
			label: 'CHAPTERS',
			a: '4 match by number · 2 kept from Asura Scans · 3 added',
			b: "9 IN ALL AFTER THE MOVE · THE 3 ADDED AREN'T DOWNLOADED",
			status: 'MOVES'
		});
	});

	it('says where reading is and that it carries', () => {
		expect(row('reading').a).toBe('Read through ch. 2, on p. 12 of ch. 3');
		expect(row('reading').b).toBe('CARRIES BY NUMBER');
	});

	it('counts files and promises nothing downloads', () => {
		expect(row('files').a).toBe('3 downloaded, ch. 1 – 9');
		expect(row('files').b).toBe('KEPT AS THEY ARE · MOVE DOWNLOADS NOTHING');
		expect(row('files').status).toBe('KEPT');
	});

	it('moves FOLLOW and says where it downloads from', () => {
		expect(row('follow')).toMatchObject({
			a: 'Following',
			b: 'NEW CHAPTERS COME FROM WEEB CENTRAL',
			status: 'MOVES'
		});
		const off = moveSummary(plan, { kind: 'manga', from: 'A', to: 'B', follow: false, yours });
		expect(off.find((r) => r.key === 'follow')!.status).toBe('UNCHANGED');
	});

	it('counts a queue chapter with no partner as leaving the queue', () => {
		expect(row('queue')).toMatchObject({
			a: '2 queued, ch. 4 and 5',
			b: '1 HAS NO PARTNER · LEAVES THE QUEUE',
			status: 'MOVES'
		});
	});

	it('leaves the rest alone', () => {
		expect(row('rest')).toMatchObject({
			a: 'Title, cover, rating, FAV, shelves, tags, link, notes',
			b: 'THE SAME SERIES',
			status: 'UNCHANGED'
		});
	});

	it('draws the band’s line from what changed', () => {
		expect(movedDetail(plan, 'Asura Scans', 'manga')).toBe(
			'3 CHAPTERS ADDED, NOT DOWNLOADED · 2 KEPT FROM ASURA SCANS'
		);
	});
});

describe('titles and numbers', () => {
	it('compares titles without case, punctuation or spacing', () => {
		expect(titleKey('  The First Snow! ')).toBe('the first snow');
		expect(titleKey('the first  snow')).toBe('the first snow');
	});

	it('turns their episode number into the series’ own with the offset', () => {
		expect(atOf(50, 50)).toBe(1);
		expect(atOf(57, 50)).toBe(8);
	});
});

describe('the words MOVE prints for a kind (K4, c304)', () => {
	/**
	 * The route's three words used to be spelled from the kind's name. Each
	 * now asks the registry (series/[id]/move-words.ts), and must print what
	 * the old comparison printed for every kind there is, not the two that
	 * move: a novel's own unit is VOLUME, and the band said CHAPTER.
	 */
	it('says what the old comparisons said, for all five kinds', async () => {
		const { KINDS, moveKindOf } = await import('$lib/library/kinds');
		const { comparedKind, movedUnit, searchedSources } =
			await import('../src/routes/series/[id]/move-words');
		expect([...KINDS].sort()).toEqual(['anime', 'doujin', 'manga', 'manhwa', 'novel']);
		for (const kind of KINDS) {
			expect(searchedSources(kind), kind).toBe(kind === 'anime' ? 'anime' : 'manga');
			expect(movedUnit(kind), kind).toBe(kind === 'anime' ? 'EPISODE' : 'CHAPTER');
			for (const move of ['manga', 'anime'] as const)
				expect(comparedKind(move, kind), `${move} ${kind}`).toBe(
					move === 'anime' ? 'ANIME' : kind.toUpperCase()
				);
			// What the comparison is handed on the route: the series' own map kind.
			expect(comparedKind(moveKindOf(kind), kind), kind).toBe(
				kind === 'anime' ? 'ANIME' : kind.toUpperCase()
			);
		}
	});
});

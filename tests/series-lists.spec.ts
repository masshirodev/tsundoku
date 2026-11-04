import { describe, expect, it } from 'vitest';
import {
	entryStates,
	foldTag,
	listsRow,
	listState,
	mainList,
	OFFLINE_NOTE,
	seasonCellTag,
	seasonWords,
	type Cell,
	type Line,
	type ListsInput
} from '../src/routes/series/[id]/lists';
import type { SeasonRow } from '$lib/library/catalogue';
import type { TrackFacts } from '$lib/library/tracking';
import type { LinkState } from '$lib/server/catalogue';
import type { SeasonTrack, Tracking } from '$lib/server/tracking';
import type { RanobeSeries } from '$lib/server/ranobe-review';

/**
 * The LISTS row's words and cells (card c424; doc/SERIES.md "LISTS"), for
 * every state the brief names. The e2e files reach the states through the
 * app's doors; this pins the rules over their whole domain, which a screen
 * can't enumerate.
 */

const NOW = Date.UTC(2026, 10, 4, 12, 0);
const MIN = 60_000;

function fact(service: 'anilist' | 'mal', o: Partial<TrackFacts> = {}): TrackFacts {
	return {
		service,
		signedIn: true,
		linked: true,
		state: null,
		waiting: null,
		sentAt: null,
		...o
	};
}

function linked(o: Partial<NonNullable<LinkState['linked']>> = {}): LinkState {
	return {
		linked: {
			anilistId: 119257,
			malId: 132214,
			title: 'Omniscient Reader’s Viewpoint',
			via: 'list',
			ids: 'ANILIST 119257 · MAL 132214',
			resolving: false,
			coverOnly: false,
			wrongKind: false,
			kind: 'manhwa',
			format: 'MANGA',
			...o
		},
		decision: null,
		candidates: 0,
		searched: true,
		queued: false,
		hidden: false,
		cover: { a: 'FROM THE LINK', b: '' }
	};
}

function unlinked(o: Partial<LinkState> = {}): LinkState {
	return {
		linked: null,
		decision: null,
		candidates: 0,
		searched: false,
		queued: false,
		hidden: false,
		cover: { a: 'NONE', b: '' },
		...o
	};
}

function tracking(facts: TrackFacts[], o: Partial<Tracking> = {}): Tracking {
	return {
		facts,
		hidden: false,
		coverOnly: false,
		catalogueTracks: true,
		status: null,
		score: null,
		links: [],
		...o
	};
}

function input(o: Partial<ListsInput>): ListsInput {
	return {
		seriesId: 7,
		kind: 'manhwa',
		link: null,
		tracking: null,
		ranobe: null,
		seasons: null,
		expanded: false,
		offline: false,
		now: NOW,
		linksHref: '/links',
		settingsHref: '/settings',
		...o
	};
}

const lines = (i: ListsInput): Line[] =>
	(listsRow(i)?.items ?? []).flatMap((x) => (x.type === 'line' ? [x.line] : []));
const labels = (cells: Cell[]) => cells.map((c) => c.label);

function ranobe(o: Partial<RanobeSeries> = {}, facts: Partial<RanobeSeries['facts']> = {}) {
	return {
		configured: true,
		hidden: false,
		link: {
			work: 'W1204',
			title: 'Omniscient Reader’s Viewpoint',
			href: 'https://ranobe.example/works/1204',
			meta: 'RANOBE W1204 · BY CHAPTER'
		},
		unlinkedMeta: 'NOT SEARCHED ON RANOBE YET',
		facts: {
			configured: true,
			hidden: false,
			linked: true,
			suggested: false,
			edition: true,
			comic: true,
			counted: true,
			suggestionRefused: false,
			lang: 'en',
			remote: {
				status: 'reading',
				progress: { type: 'chapter', number: '214', of: 243 },
				rating: null,
				favourite: false
			},
			sentAt: NOW - 12 * MIN,
			failed: null,
			half: null,
			...facts
		},
		...o
	} satisfies RanobeSeries;
}

function seasonRow(season: number, o: Partial<SeasonRow> = {}): SeasonRow {
	return {
		season,
		from: 1,
		to: 12,
		count: 12,
		aired: 12,
		watched: 0,
		link: {
			anilistId: 1000 + season,
			malId: 2000 + season,
			title: `Show S${season}`,
			via: 'review',
			format: 'TV',
			episodes: 12,
			year: 2024,
			resolvedAt: NOW
		},
		parts: [],
		candidates: 0,
		searched: true,
		queued: false,
		decision: null,
		searchTitle: 'Show',
		...o
	};
}

function seasonTrack(season: number, facts: TrackFacts[], o: Partial<SeasonTrack> = {}) {
	return {
		season,
		from: 1,
		to: 12,
		count: 12,
		aired: 12,
		watched: 0,
		part: 1,
		parts: [{ part: 1, from: 1, to: 12 }],
		link: null,
		facts: facts.map((f) => ({ ...f, part: 1, of: 12 })),
		other: null,
		waits: null,
		hidden: false,
		coverOnly: false,
		wrongKind: false,
		...o
	} as SeasonTrack;
}

describe('a line not linked (1B, 1; c337)', () => {
	it('says what the last search did, and never credits a cover pass with it', () => {
		const said = (l: Partial<LinkState>) =>
			lines(input({ link: unlinked(l), tracking: tracking([]) }))[0].meta;
		const all = [
			said({}),
			said({ searched: true }),
			said({ searched: true, candidates: 1 }),
			said({ searched: true, candidates: 4 }),
			said({ queued: true }),
			said({ decision: 'none', searched: true, candidates: 4 }),
			said({ decision: 'unlinked' }),
			said({ hidden: true })
		];
		expect(all).toEqual([
			'NOT SEARCHED YET · THE NEXT PASS SEARCHES IT',
			'NOTHING FOUND ON ANILIST',
			'1 FOUND ON ANILIST · NOT FOR CERTAIN',
			'4 FOUND ON ANILIST · NOT FOR CERTAIN',
			// A queued search does wait for the next pass: the one sentence that may say so.
			'A SEARCH WAITS FOR THE NEXT COVER PASS',
			'NONE OF THESE · NO PASS ASKS AGAIN',
			'UNLINKED · NO PASS ASKS AGAIN',
			'HIDDEN SERIES ARE NEVER SEARCHED'
		]);
		for (const s of all.filter((s) => !s.startsWith('A SEARCH WAITS')))
			expect(s).not.toMatch(/COVER PASS|LAST PASS|LAST SEARCH/);
	});

	it('offers FIND as its accent and PASTE A LINK; a settled one’s FIND is plain', () => {
		const [l] = lines(
			input({ link: unlinked({ searched: true, candidates: 3 }), tracking: tracking([]) })
		);
		expect(l.title).toBe('Not linked');
		expect(l.muted).toBe(true);
		expect(labels(l.cells)).toEqual(['FIND', 'PASTE A LINK']);
		expect(l.cells[0]).toMatchObject({ accent: true, href: '/links?series=7' });
		expect(l.cells[1]).toMatchObject({ accent: false, href: '/links?series=7&paste' });
		const [settled] = lines(
			input({ link: unlinked({ decision: 'none' }), tracking: tracking([]) })
		);
		expect(settled.cells[0]).toMatchObject({ key: 'find', accent: false });
	});

	it('hidden: PASTE A LINK alone, as the accent (1B, 7)', () => {
		const [l] = lines(
			input({ link: unlinked({ hidden: true }), tracking: tracking([], { hidden: true }) })
		);
		expect(l.cells).toEqual([
			{
				key: 'paste',
				label: 'PASTE A LINK',
				accent: true,
				dim: false,
				href: '/links?series=7&paste'
			}
		]);
	});
});

describe('a comic’s AniList line (1B, 2–6)', () => {
	const sent = NOW - 12 * MIN;
	const reading = { status: 'reading' as const, progress: 214, score: 9 };

	it('folds MAL in when it says the same, and names both as sent (2)', () => {
		const [l] = lines(
			input({
				link: linked(),
				tracking: tracking([
					fact('anilist', { state: reading, sentAt: sent }),
					fact('mal', { state: reading, sentAt: sent })
				])
			})
		);
		expect(l.tag).toBe('ANILIST');
		expect(l.meta).toBe('MANGA · MAL 132214');
		expect(l.states).toEqual([
			{
				l: 'READING · CH. 214 · 9',
				r: 'ANILIST AND MAL · SENT 12 MIN AGO',
				quiet: false,
				alert: false
			}
		]);
		expect(labels(l.cells)).toEqual(['EDIT']);
		expect(l.cells[0].edit).toEqual({ list: 'anilist', season: null });
	});

	it('gives MAL a quiet line of its own when it differs, and SIGN IN joins the cells (3)', () => {
		const [l] = lines(
			input({
				link: linked(),
				tracking: tracking([
					fact('anilist', { state: reading, sentAt: sent }),
					fact('mal', { signedIn: false, state: { status: 'reading', progress: 198, score: null } })
				])
			})
		);
		expect(l.states).toEqual([
			{ l: 'READING · CH. 214 · 9', r: 'SENT 12 MIN AGO', quiet: false, alert: false },
			{ l: 'MAL AT CH. 198', r: 'NOT SIGNED IN · NOTHING SENT', quiet: true, alert: false }
		]);
		expect(labels(l.cells)).toEqual(['SIGN IN →', 'EDIT']);
		expect(l.cells[0].href).toBe('/settings');
	});

	it('nothing signed in, nothing read: one line for both, SIGN IN → and EDIT', () => {
		const [l] = lines(
			input({
				link: linked(),
				tracking: tracking([fact('anilist', { signedIn: false }), fact('mal', { signedIn: false })])
			})
		);
		expect(l.states).toEqual([
			{ l: 'ANILIST AND MAL · NOT SIGNED IN', r: 'NOTHING SENT', quiet: true, alert: false }
		]);
		// EDIT stays, signed out: ENTRY's CHANGE and UNLINK live in the sheet now.
		expect(labels(l.cells)).toEqual(['SIGN IN →', 'EDIT']);
	});

	it('a send that failed is in ink, with TRY AGAIN for that line (4)', () => {
		const failedAt = Date.UTC(2026, 10, 4, 9, 14);
		const [l] = lines(
			input({
				link: linked(),
				tracking: tracking([
					fact('anilist', {
						state: reading,
						waiting: { progress: 215, failedAt, error: 'ANILIST DID NOT ANSWER' }
					}),
					fact('mal', { state: { ...reading, progress: 215 }, sentAt: failedAt })
				])
			})
		);
		expect(l.states[0]).toMatchObject({ l: 'CH. 215 NOT SENT', alert: true });
		expect(l.states[0].r).toMatch(/^ANILIST DID NOT ANSWER · \d\d:\d\d$/);
		expect(l.states[1]).toMatchObject({ l: 'MAL AT CH. 215', quiet: true });
		expect(labels(l.cells)).toEqual(['TRY AGAIN', 'EDIT']);
		expect(l.cells[0].post).toEqual({ action: '?/retryTracking', fields: {} });
	});

	it('an expired sign-in offers SIGN IN → in TRY AGAIN’s place', () => {
		const [l] = lines(
			input({
				link: linked(),
				tracking: tracking([
					fact('anilist', {
						state: reading,
						waiting: { progress: 215, failedAt: NOW, error: 'ANILIST SIGN-IN EXPIRED' }
					}),
					fact('mal', { linked: false })
				])
			})
		);
		expect(labels(l.cells)).toEqual(['SIGN IN →', 'EDIT']);
	});

	it('cover-only: linked, never tracked, the entry named (5)', () => {
		const [l] = lines(
			input({
				kind: 'novel',
				link: linked({ coverOnly: true, malId: null, anilistId: 108428, format: 'MANGA' }),
				tracking: tracking([fact('anilist')], { coverOnly: true, catalogueTracks: false })
			})
		);
		expect(l.meta).toBe('THE COMIC’S ENTRY · MANGA · ANILIST 108428');
		expect(l.states).toEqual([
			{ l: 'COVER AND DETAILS ONLY · NEVER TRACKED', r: '', quiet: true, alert: false }
		]);
		expect(labels(l.cells)).toEqual(['EDIT']);
	});

	it('the wrong kind: flagged in ink, CHANGE its accent, EDIT kept (6)', () => {
		const [l] = lines(
			input({
				kind: 'anime',
				seasons: [seasonRow(1, { link: { ...seasonRow(1).link!, format: 'MANGA' } })],
				link: linked({ wrongKind: true, format: 'MANGA', kind: 'manga' }),
				tracking: tracking([fact('anilist')], {
					seasons: [seasonTrack(1, [fact('anilist')], { wrongKind: true })],
					openSeason: 1
				})
			})
		);
		expect(l.states.map((s) => s.l)).toEqual([
			'LINKED TO THE WRONG KIND · NOTHING SENT',
			'CHANGE SEARCHES ANILIST’S ANIME'
		]);
		expect(labels(l.cells)).toEqual(['CHANGE', 'EDIT']);
		expect(l.cells[0]).toMatchObject({ accent: true, href: '/links?series=7' });
	});

	it('hidden and linked by a paste: nothing sent, said once (7)', () => {
		const [l] = lines(
			input({
				link: { ...linked({ via: 'pasted' }), hidden: true },
				tracking: tracking([fact('anilist'), fact('mal')], { hidden: true })
			})
		);
		expect(l.states).toEqual([
			{ l: 'NOTHING SENT · HIDDEN SERIES STAY OFF EVERY LIST', r: '', quiet: true, alert: false }
		]);
	});
});

describe('offline (1B, 8)', () => {
	it('EDIT turns into OPEN ↗, everything else dims, and the strip says why', () => {
		const row = listsRow(
			input({
				offline: true,
				link: linked(),
				tracking: tracking([
					fact('anilist', {
						state: { status: 'reading', progress: 214, score: 9 },
						sentAt: Date.UTC(2026, 10, 4, 14, 20),
						waiting: { progress: 215, failedAt: NOW, error: 'ANILIST DID NOT ANSWER' }
					}),
					fact('mal', { linked: false })
				]),
				ranobe: ranobe({ link: null }, { linked: false })
			})
		)!;
		expect(row.note).toBe(OFFLINE_NOTE);
		const [a, r] = row.items.map((x) => (x.type === 'line' ? x.line : null))!;
		expect(a!.cells.map((c) => [c.label, c.dim])).toEqual([
			['TRY AGAIN', true],
			['OPEN ↗', false]
		]);
		expect(a!.cells[1]).toMatchObject({
			href: 'https://anilist.co/manga/119257',
			external: true
		});
		// The reason stays when its TRY AGAIN dims.
		expect(a!.states[0].alert).toBe(true);
		expect(r!.cells.map((c) => [c.label, c.dim])).toEqual([
			['FIND', true],
			['PASTE A LINK', true]
		]);
	});
});

describe('Ranobe’s line (1B, 9; 1C, 10)', () => {
	it('on a comic, under AniList’s; on a novel, first, with AniList’s for the cover', () => {
		const comic = lines(
			input({ link: linked(), tracking: tracking([fact('anilist')]), ranobe: ranobe() })
		);
		expect(comic.map((l) => l.tag)).toEqual(['ANILIST', 'RNB']);
		const novel = lines(
			input({
				kind: 'novel',
				link: linked({ malId: null, anilistId: 108428, format: 'NOVEL', kind: 'novel' }),
				tracking: tracking([fact('anilist')], { catalogueTracks: false }),
				ranobe: ranobe()
			})
		);
		expect(novel.map((l) => l.tag)).toEqual(['RNB', 'ANILIST']);
		expect(novel[1].states).toEqual([
			{ l: 'COVER AND DETAILS · TRACKED ON RANOBE', r: '', quiet: true, alert: false }
		]);
		expect(novel[0].states[0]).toMatchObject({
			l: 'READING · CH. 214 OF 243',
			r: 'SENT 12 MIN AGO'
		});
		expect(labels(novel[0].cells)).toEqual(['EDIT']);
		expect(novel[0].cells[0].edit).toEqual({ list: 'ranobe' });
	});

	it('a failed send is Ranobe’s own, with its own TRY AGAIN', () => {
		const [, r] = lines(
			input({
				link: linked(),
				tracking: tracking([fact('anilist')]),
				ranobe: ranobe(
					{},
					{ failed: { unit: 'w:chapter:215', error: 'RANOBE REFUSED IT', at: NOW } }
				)
			})
		);
		expect(r.states[0]).toMatchObject({ l: 'CH. 215 NOT SENT', alert: true });
		expect(labels(r.cells)).toEqual(['TRY AGAIN', 'EDIT']);
		expect(r.cells[0].post).toEqual({ action: '?/retryRanobe', fields: {} });
	});

	it('not linked: FIND and PASTE A LINK; hidden, PASTE A LINK alone', () => {
		const [, r] = lines(
			input({
				link: linked(),
				tracking: tracking([fact('anilist')]),
				ranobe: ranobe({ link: null }, { linked: false })
			})
		);
		expect(r.title).toBe('Not on Ranobe');
		expect(labels(r.cells)).toEqual(['FIND', 'PASTE A LINK']);
		expect(r.cells[0].href).toBe('/links?series=7&service=ranobe');
		const [, h] = lines(
			input({
				link: linked(),
				tracking: tracking([fact('anilist')]),
				ranobe: ranobe({ link: null, hidden: true }, { linked: false, hidden: true })
			})
		);
		expect(h.title).toBe('Not linked');
		expect(labels(h.cells)).toEqual(['PASTE A LINK']);
	});
});

describe('an anime’s seasons (1C, 11, 12; c423)', () => {
	const watching = { status: 'reading' as const, progress: 8, score: 8 };
	const done = { status: 'completed' as const, progress: 12, score: 7 };

	function show(n: number, open: number, o: Partial<ListsInput> = {}) {
		const numbers = Array.from({ length: n }, (_, k) => k + 1);
		return input({
			kind: 'anime',
			link: linked({ kind: 'anime', format: 'TV' }),
			seasons: numbers.map((s) => seasonRow(s)),
			tracking: tracking([], {
				openSeason: open,
				seasons: numbers.map((s) =>
					seasonTrack(s, [
						fact('anilist', {
							state: s < open ? done : s === open ? watching : null,
							sentAt: NOW - 12 * MIN
						}),
						fact('mal', {
							state: s < open ? done : s === open ? watching : null,
							sentAt: NOW - 12 * MIN
						})
					])
				)
			}),
			...o
		});
	}

	it('more than three fold round the one being watched; each line carries its word', () => {
		const row = listsRow(show(4, 3))!;
		expect(row.items.map((x) => (x.type === 'line' ? x.line.tag : x.type))).toEqual([
			'fold',
			'S3',
			'S4'
		]);
		expect(row.items[0]).toMatchObject({
			type: 'fold',
			tag: 'S1 – S2',
			word: 'COMPLETED',
			above: true
		});
		const s3 = (row.items[1] as { line: Line }).line;
		expect(s3.on).toBe(true);
		expect(s3.meta).toBe('TV · 12 EP. · 2024 · MAL 2003');
		expect(s3.states[0]).toEqual({
			l: 'WATCHING · EP. 8 OF 12 · 8',
			r: 'ANILIST AND MAL · SENT 12 MIN AGO',
			quiet: false,
			alert: false
		});
		expect(s3.cells.map((c) => c.edit)).toEqual([{ list: 'anilist', season: 3 }]);
		// A season not being watched: its word only, no meta, nothing about sends.
		const open = listsRow(show(4, 3, { expanded: true }))!;
		const s1 = open.items.flatMap((x) =>
			x.type === 'line' && x.line.tag === 'S1' ? [x.line] : []
		)[0];
		expect(s1.meta).toBe('');
		expect(s1.states).toEqual([
			{ l: 'COMPLETED · EP. 12 OF 12 · 7', r: '', quiet: false, alert: false }
		]);
		expect(open.items[0]).toEqual({ type: 'toggle', count: 4, expanded: true });
	});

	it('three or fewer: a line each, no fold', () => {
		expect(listsRow(show(3, 2))!.items.every((x) => x.type === 'line')).toBe(true);
	});

	it('a season’s FIND keeps one cell and names its season; a hidden one’s is PASTE', () => {
		const i = show(2, 1);
		i.seasons![1] = seasonRow(2, { link: null, candidates: 2 });
		const [, s2] = lines(i);
		expect(s2.meta).toBe('2 FOUND ON ANILIST · NOT FOR CERTAIN');
		expect(s2.cells).toEqual([
			{ key: 'find', label: 'FIND', accent: true, dim: false, href: '/links?series=7&season=2' }
		]);
		const h = show(2, 1);
		h.seasons![1] = seasonRow(2, { link: null });
		h.tracking = { ...h.tracking!, hidden: true };
		const row = listsRow(h)!;
		expect(row.note).toBe('NOTHING SENT · HIDDEN');
		const hs2 = lines(h)[1];
		expect(hs2.cells).toEqual([
			{
				key: 'paste',
				label: 'PASTE',
				accent: true,
				dim: false,
				href: '/links?series=7&season=2&paste'
			}
		]);
	});

	it('TRY AGAIN on a season names that season', () => {
		const i = show(2, 2);
		i.tracking!.seasons![1] = seasonTrack(2, [
			fact('anilist', {
				state: watching,
				waiting: { progress: 9, failedAt: NOW, error: 'ANILIST DID NOT ANSWER' }
			}),
			fact('mal', { linked: false })
		]);
		const s2 = lines(i)[1];
		expect(s2.cells[0]).toMatchObject({
			label: 'TRY AGAIN',
			post: { action: '?/retryTracking', fields: { season: '2' } }
		});
	});

	it('a flat list is one ANILIST line, and never says SEASON 0 or S0 (12)', () => {
		const flat = input({
			kind: 'anime',
			link: linked({
				kind: 'anime',
				format: 'TV',
				malId: 59145,
				anilistId: 178533,
				title: 'Ranma1/2 (2024)'
			}),
			seasons: [seasonRow(0, { link: { ...seasonRow(0).link!, anilistId: 178533, malId: 59145 } })],
			tracking: tracking([fact('anilist'), fact('mal')], {
				openSeason: 0,
				seasons: [seasonTrack(0, [fact('anilist'), fact('mal')])]
			}),
			ranobe: ranobe({ link: null }, { linked: false, anime: true })
		});
		const row = listsRow(flat)!;
		expect(row.items.map((x) => (x.type === 'line' ? x.line.tag : x.type))).toEqual([
			'ANILIST',
			'RNB'
		]);
		const [a, r] = lines(flat);
		expect(a.meta).toBe('TV · 12 EP. · 2024 · MAL 59145');
		expect(a.states[0]).toEqual({
			l: 'NOT ON YOUR LIST',
			r: 'ADDED ON THE NEXT EPISODE WATCHED',
			quiet: true,
			alert: false
		});
		// EDIT opens the sheet on season 0, which the sheet never names.
		expect(a.cells.map((c) => c.edit)).toEqual([{ list: 'anilist', season: 0 }]);
		// FIND on the flat list's line names no season (the review's own rule, c423).
		const unl = { ...flat, link: unlinked(), seasons: [seasonRow(0, { link: null })] };
		expect(lines(unl)[0].cells[0].href).toBe('/links?series=7');
		// RNB on an anime keeps one cell (1C, 12).
		expect(labels(r.cells)).toEqual(['FIND']);
		expect(JSON.stringify([row, listsRow(unl)])).not.toMatch(/SEASON 0|\bS0\b/);
	});

	it('names season 0 beside numbered seasons OTHER, never S0', () => {
		expect([0, 1, 2, 10].map(seasonCellTag)).toEqual(['OTHER', 'S1', 'S2', 'S10']);
		expect(foldTag([0, 1, 2])).toBe('OTHER + S1 – S2');
		expect(foldTag([1, 2, 3])).toBe('S1 – S3');
		expect(foldTag([0])).toBe('OTHER');
		expect(foldTag([4])).toBe('S4');
	});

	it('the sheet names a season only on a show with several (c423)', () => {
		expect(seasonWords(0, false)).toEqual({
			subject: '',
			scope: 'THE SHOW’S ENTRY ON BOTH CATALOGUES'
		});
		expect(seasonWords(1, false)).toEqual({
			subject: '',
			scope: 'THE SHOW’S ENTRY ON BOTH CATALOGUES'
		});
		expect(seasonWords(3, true)).toEqual({
			subject: 'SEASON 3',
			scope: 'SEASON 3’S ENTRY ON BOTH CATALOGUES'
		});
		expect(seasonWords(0, true)).toEqual({
			subject: 'THE OTHER EPISODES',
			scope: 'THE OTHER EPISODES’ ENTRY ON BOTH CATALOGUES'
		});
		expect(seasonWords(null, false).scope).toBe('BOTH CATALOGUES');
		for (const n of [0, 1, 2])
			for (const t of [true, false])
				expect(JSON.stringify(seasonWords(n, t))).not.toMatch(/SEASON 0/);
	});

	it('Ranobe’s one line under the seasons, a rule above it (10)', () => {
		const i = show(4, 3, { ranobe: ranobe({}, { anime: true }) });
		const r = lines(i).at(-1)!;
		expect(r).toMatchObject({
			tag: 'RNB',
			under: true,
			meta: 'RANOBE W1204 · ONE ENTRY FOR ALL 4 SEASONS'
		});
	});
});

describe('cells, in the handoff’s order', () => {
	it('TRY AGAIN, SIGN IN →, FIND or CHANGE, PASTE A LINK, EDIT', () => {
		const [l] = lines(
			input({
				link: linked({ wrongKind: true }),
				tracking: tracking([
					fact('anilist', {
						waiting: { progress: 3, failedAt: NOW, error: 'ANILIST DID NOT ANSWER' }
					}),
					fact('mal', { signedIn: false })
				])
			})
		);
		// The wrong kind sends nothing, so it is flagged rather than retried.
		expect(labels(l.cells)).toEqual(['CHANGE', 'EDIT']);
	});
});

describe('entryStates', () => {
	it('MAL alone (AniList not asked yet) leads with its name', () => {
		expect(
			entryStates(
				[
					fact('anilist', { linked: false }),
					fact('mal', { state: { status: 'reading', progress: 3, score: null } })
				],
				{
					kind: 'manga',
					offline: false,
					now: NOW,
					full: true
				}
			)
		).toEqual([
			{ l: 'MAL · READING · CH. 3', r: 'SHOWN · ANILIST HAS NOTHING', quiet: false, alert: false }
		]);
	});

	it('a season in two parts: PART 2 leads, part 1’s word on the right, the send under it', () => {
		expect(
			entryStates(
				[
					{
						...fact('anilist', {
							state: { status: 'reading', progress: 3, score: null },
							sentAt: NOW - 12 * MIN
						}),
						of: 11
					},
					{
						...fact('mal', {
							signedIn: false,
							state: { status: 'reading', progress: 6, score: null }
						}),
						of: 11
					}
				],
				{
					kind: 'anime',
					offline: false,
					now: NOW,
					full: true,
					lead: 'PART 2 · ',
					other: 'PART 1 COMPLETED'
				}
			)
		).toEqual([
			{ l: 'PART 2 · WATCHING · EP. 3 OF 11', r: 'PART 1 COMPLETED', quiet: false, alert: false },
			{ l: 'ANILIST · SENT 12 MIN AGO', r: '', quiet: true, alert: false },
			{ l: 'MAL AT EP. 6', r: 'NOT SIGNED IN · NOTHING SENT', quiet: true, alert: false }
		]);
	});
});

describe('AniList signed out, MAL signed in: MAL’s word leads (round 2)', () => {
	const watching = { status: 'reading' as const, progress: 8, score: null };
	const done = { status: 'completed' as const, progress: 12, score: null };
	const anilistOut = (o: Partial<TrackFacts> = {}) => fact('anilist', { signedIn: false, ...o });
	const malIn = (state: TrackFacts['state']) => fact('mal', { state, sentAt: NOW - MIN });

	it('an anime season not being watched draws MAL’s word, and SIGN IN → is among its cells', () => {
		const numbers = [1, 2];
		const row = listsRow(
			input({
				kind: 'anime',
				link: linked({ kind: 'anime', format: 'TV' }),
				seasons: numbers.map((s) => seasonRow(s)),
				tracking: tracking([], {
					openSeason: 2,
					seasons: numbers.map((s) => seasonTrack(s, [anilistOut(), malIn(watching)]))
				})
			})
		)!;
		const s1 = row.items.flatMap((x) =>
			x.type === 'line' && x.line.tag === 'S1' ? [x.line] : []
		)[0];
		expect(s1.on).toBe(false);
		expect(s1.states[0]).toEqual({
			l: 'MAL · WATCHING · EP. 8 OF 12',
			r: '',
			quiet: false,
			alert: false
		});
		expect(labels(s1.cells)).toContain('SIGN IN →');
	});

	it('on a comic MAL’s state and SENT lead, and AniList’s NOT SIGNED IN is the quiet line', () => {
		const [l] = lines(
			input({
				link: linked(),
				tracking: tracking([anilistOut(), malIn({ status: 'reading', progress: 198, score: null })])
			})
		);
		expect(l.states).toEqual([
			{ l: 'MAL · READING · CH. 198', r: 'SENT 1 MIN AGO', quiet: false, alert: false },
			{ l: 'ANILIST', r: 'NOT SIGNED IN · NOTHING SENT', quiet: true, alert: false }
		]);
		expect(labels(l.cells)).toEqual(['SIGN IN →', 'EDIT']);
	});

	it('a fold and the sheet’s STATUS say MAL’s word over a stale signed-out AniList', () => {
		const stale = anilistOut({ state: watching });
		const facts = [stale, malIn(done)];
		expect(mainList(facts)?.service).toBe('mal');
		expect(listState(facts)?.status).toBe('completed');
		const numbers = [1, 2, 3, 4];
		const row = listsRow(
			input({
				kind: 'anime',
				link: linked({ kind: 'anime', format: 'TV' }),
				seasons: numbers.map((s) => seasonRow(s)),
				tracking: tracking([], {
					openSeason: 4,
					seasons: numbers.map((s) => seasonTrack(s, facts))
				})
			})
		)!;
		expect(row.items[0]).toMatchObject({ type: 'fold', word: 'COMPLETED' });
	});

	it('AniList is main when it is signed in, and when neither is', () => {
		expect(mainList([fact('anilist'), fact('mal')])?.service).toBe('anilist');
		expect(mainList([anilistOut(), fact('mal', { signedIn: false })])?.service).toBe('anilist');
		expect(mainList([fact('anilist', { linked: false }), fact('mal')])?.service).toBe('mal');
		expect(mainList([fact('anilist', { linked: false })])).toBeNull();
	});
});

describe('TRY AGAIN beside an expired sign-in (round 2, low)', () => {
	it('offers both when one list’s sign-in expired and another’s send did not answer', () => {
		const [l] = lines(
			input({
				link: linked(),
				tracking: tracking([
					fact('anilist', {
						state: { status: 'reading', progress: 3, score: null },
						waiting: { progress: 3, failedAt: NOW, error: 'ANILIST SIGN-IN EXPIRED' }
					}),
					fact('mal', {
						state: { status: 'reading', progress: 2, score: null },
						waiting: { progress: 3, failedAt: NOW, error: 'MAL DID NOT ANSWER' }
					})
				])
			})
		);
		expect(labels(l.cells)).toEqual(['TRY AGAIN', 'SIGN IN →', 'EDIT']);
	});
});

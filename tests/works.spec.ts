import { describe, expect, it } from 'vitest';
import {
	continuePart,
	defaultWorkName,
	directionWord,
	facePart,
	inOrder,
	isFinished,
	nextPart,
	partPlace,
	partState,
	workEndMode,
	workFavourite,
	workFoot,
	workHeld,
	workPartMeta,
	kindVerb,
	runStatus,
	workKinds,
	workRating,
	workVerb,
	partDone,
	workRowLine,
	type WorkPart
} from '$lib/library/works';
import { groupAnswers } from '$lib/library/books';

/** A part with sane defaults; each test overrides only what it argues about. */
function part(patch: Partial<WorkPart> & { seriesId: number; position: number }): WorkPart {
	return {
		title: `Part ${patch.position}`,
		kind: 'manhwa',
		rating: 0,
		favourite: false,
		cover: null,
		addedAt: 0,
		entries: 100,
		read: 0,
		lastOpenedAt: null,
		status: 'completed',
		hidden: false,
		...patch
	};
}

/** Read through: every entry read on a series the source calls finished. */
const read = (p: WorkPart): WorkPart => ({ ...p, read: p.entries, status: 'completed' });

describe('CONTINUE’s part', () => {
	it('opens the first part when nothing has been started', () => {
		const parts = [part({ seriesId: 1, position: 1 }), part({ seriesId: 2, position: 2 })];
		expect(continuePart(parts)!.seriesId).toBe(1);
		expect(workFoot(parts)).toMatchObject({ label: 'UP NEXT · PART 1', upNext: true });
	});

	it('keeps the part opened most recently while it is unfinished, not the next in order', () => {
		// A finished middle part does not pull CONTINUE back to it: part 1 was
		// opened later and is still in progress.
		const parts = [
			part({ seriesId: 1, position: 1, read: 40, lastOpenedAt: 900 }),
			read(part({ seriesId: 2, position: 2, lastOpenedAt: 500 })),
			part({ seriesId: 3, position: 3 })
		];
		expect(continuePart(parts)!.seriesId).toBe(1);
		expect(workFoot(parts)).toMatchObject({ label: 'PART 1 OF 3', upNext: false });
	});

	it('crosses to the next unfinished part when the most recently opened one is finished', () => {
		const parts = [
			read(part({ seriesId: 1, position: 1, lastOpenedAt: 100 })),
			read(part({ seriesId: 2, position: 2, lastOpenedAt: 900 })),
			part({ seriesId: 3, position: 3 })
		];
		expect(continuePart(parts)!.seriesId).toBe(3);
		expect(workFoot(parts)).toEqual({
			segments: ['done', 'done', 'now'],
			label: 'UP NEXT · PART 3',
			upNext: true
		});
	});

	it('does not call the run read while an earlier part is unfinished', () => {
		// Part 2 was finished most recently; part 1 still has pages in it. The
		// run is not read, so CONTINUE goes back to the part that is not.
		const parts = [
			part({ seriesId: 1, position: 1, read: 20 }),
			read(part({ seriesId: 2, position: 2, lastOpenedAt: 900 }))
		];
		expect(continuePart(parts)!.seriesId).toBe(1);
	});

	it('is null once the run is read, and the face is where it ended', () => {
		const parts = [
			read(part({ seriesId: 1, position: 1, lastOpenedAt: 100, cover: 3 })),
			read(part({ seriesId: 2, position: 2, lastOpenedAt: 400, cover: 9 }))
		];
		expect(continuePart(parts)).toBeNull();
		expect(facePart(parts)!.cover).toBe(9);
		expect(workFoot(parts)).toEqual({
			segments: ['done', 'done'],
			label: 'PART 2 OF 2',
			upNext: false
		});
	});

	it('is null for no parts, and a Work of one states no place', () => {
		expect(continuePart([])).toBeNull();
		expect(facePart([])).toBeNull();
		const one = [part({ seriesId: 1, position: 1 })];
		expect(workFoot(one)).toEqual({ segments: [], label: null, upNext: false });
	});
});

describe('a part’s state', () => {
	it('tells caught up from read through, and not started from in progress', () => {
		expect(partState(part({ seriesId: 1, position: 1 }))).toBe('not-started');
		expect(partState(part({ seriesId: 1, position: 1, read: 3, lastOpenedAt: 5 }))).toBe(
			'in-progress'
		);
		// An ongoing series with everything available read is caught up, not done.
		expect(
			partState(part({ seriesId: 1, position: 1, read: 100, lastOpenedAt: 5, status: 'ongoing' }))
		).toBe('caught-up');
		expect(partState(read(part({ seriesId: 1, position: 1 })))).toBe('read-through');
		// A part with no entered chapters is not finished merely because 0 >= 0.
		expect(isFinished(part({ seriesId: 1, position: 1, entries: 0, read: 0 }))).toBe(false);
	});
});

describe('the rating and FAV rule', () => {
	it('shows the average of the rated parts, and refuses a mixed Work', () => {
		const mixed = [
			part({ seriesId: 1, position: 1, rating: 8 }),
			part({ seriesId: 2, position: 2, rating: 0 })
		];
		expect(workRating(mixed, mixed.length)).toEqual({ shown: 8, settable: false, value: null });
		const two = [
			part({ seriesId: 1, position: 1, rating: 7 }),
			part({ seriesId: 2, position: 2, rating: 8 })
		];
		// 7.5 rounds up, as the screen's whole number does.
		expect(workRating(two, two.length)).toMatchObject({ shown: 8, settable: false });
	});

	it('lets all-unrated parts be rated at once, from nothing', () => {
		const unrated = [part({ seriesId: 1, position: 1 }), part({ seriesId: 2, position: 2 })];
		expect(workRating(unrated, unrated.length)).toEqual({ shown: 0, settable: true, value: 0 });
	});

	it('lets parts that share one rating be set, and writes it to all of them', () => {
		const same = [
			part({ seriesId: 1, position: 1, rating: 6 }),
			part({ seriesId: 2, position: 2, rating: 6 })
		];
		expect(workRating(same, same.length)).toEqual({ shown: 6, settable: true, value: 6 });
	});

	it('refuses a set from a partial view, because it cannot know the parts agree', () => {
		// A reveal-off page sees only the visible part. It still shows the
		// rating it can see, but the Work-wide control is not settable: the
		// server's rule runs over every member, hidden ones included.
		const visible = [part({ seriesId: 1, position: 1, rating: 8 })];
		expect(workRating(visible, 2)).toEqual({ shown: 8, settable: false, value: null });
		expect(workFavourite(visible, 2)).toEqual({ value: null, settable: false, count: 0 });
	});

	it('sets FAV only while every part agrees, and counts the ones that are', () => {
		const all = [
			part({ seriesId: 1, position: 1, favourite: true }),
			part({ seriesId: 2, position: 2, favourite: true })
		];
		expect(workFavourite(all, all.length)).toEqual({ value: true, settable: true, count: 2 });
		const none = [part({ seriesId: 1, position: 1 }), part({ seriesId: 2, position: 2 })];
		expect(workFavourite(none, none.length)).toEqual({ value: false, settable: true, count: 0 });
		const mixed = [
			part({ seriesId: 1, position: 1, favourite: true }),
			part({ seriesId: 2, position: 2 })
		];
		expect(workFavourite(mixed, mixed.length)).toEqual({ value: null, settable: false, count: 1 });
	});
});

describe('the default name', () => {
	it('keeps the words every title starts with', () => {
		expect(
			defaultWorkName(['The Breaker', 'The Breaker: New Waves', 'The Breaker: Eternal Force'])
		).toBe('The Breaker');
		expect(defaultWorkName(['Onsen Ryokan no Yoru 3', 'Onsen Ryokan no Yoru 4'])).toBe(
			'Onsen Ryokan no Yoru'
		);
	});

	it('is empty when the titles share nothing, rather than the first title', () => {
		expect(defaultWorkName(['Naruto', 'Boruto'])).toBe('');
		expect(defaultWorkName(['Kaguya-sama: Love Is War', 'Oshi no Ko'])).toBe('');
		expect(defaultWorkName([])).toBe('');
	});
});

describe('kinds and the verb', () => {
	it('names a Work’s kinds once each, in the parts’ own order', () => {
		const parts = [
			part({ seriesId: 1, position: 1, kind: 'manga' }),
			part({ seriesId: 2, position: 2, kind: 'anime' }),
			part({ seriesId: 3, position: 3, kind: 'manga' })
		];
		expect(workKinds(parts)).toBe('WORK · MANGA + ANIME');
		expect(workKinds([part({ seriesId: 1, position: 1, kind: 'manhwa' })])).toBe('WORK · MANHWA');
	});

	it('says WATCH when CONTINUE opens an anime, READ for anything else, and nothing once read', () => {
		// A manga beside its anime: the part the owner was in sets the verb.
		const manga = part({ seriesId: 1, position: 1, kind: 'manga', read: 10, lastOpenedAt: 900 });
		const anime = part({ seriesId: 2, position: 2, kind: 'anime' });
		expect(workVerb([manga, anime])).toBe('READ');
		// The manga finished most recently: CONTINUE crosses to the anime.
		expect(workVerb([{ ...manga, read: manga.entries }, anime])).toBe('WATCH');
		expect(
			workVerb([
				{ ...manga, read: manga.entries },
				{ ...anime, read: anime.entries }
			])
		).toBeNull();
		expect(kindVerb('novel')).toBe('READ');
		expect(kindVerb('doujin')).toBe('READ');
	});
});

describe('THE RUN’s status column', () => {
	const month = () => '12 MAR';
	const now = 1_000_000_000;

	it('says EP. and WATCH on an anime part, never CH. and READ', () => {
		// The designed manga-plus-anime Work: the row's own meta line says
		// ANIME · EP., so its status column must not say CH.
		const anime = part({
			seriesId: 2,
			position: 2,
			kind: 'anime',
			entries: 12,
			read: 4,
			lastOpenedAt: now - 2 * 60 * 60_000
		});
		expect(runStatus(anime, { now })).toEqual({ ink: 'EP. 5 OF 12', sub: 'OPENED 2 H AGO' });
		const watched = { ...anime, read: 12, finishedAt: now };
		expect(runStatus(watched, { month })).toEqual({ ink: 'WATCH ✓', sub: 'FINISHED 12 MAR' });
		// A manga keeps the chapter word and the read mark.
		const manga = part({ seriesId: 1, position: 1, read: 4, lastOpenedAt: now - 60_000 });
		expect(runStatus(manga, { now })).toEqual({ ink: 'CH. 5 OF 100', sub: 'OPENED 1 MIN AGO' });
		expect(runStatus({ ...manga, read: 100, finishedAt: now }, { month })).toEqual({
			ink: 'READ ✓',
			sub: 'FINISHED 12 MAR'
		});
	});

	it('names the entry ▶ opens on the part CONTINUE opens, and says what has not started', () => {
		const p = part({ seriesId: 1, position: 1, read: 40, lastOpenedAt: now - 60_000 });
		expect(runStatus(p, { now, current: true, resumeLabel: 'Ch. 41' }).ink).toBe('CH. 41 OF 100');
		// The count is fed here; tests/works-db.spec.ts proves the production
		// path reaches it, through workPage's own read of a never-opened part.
		const fresh = { ...part({ seriesId: 2, position: 2 }), newCount: 4 };
		expect(runStatus(fresh)).toEqual({
			ink: '',
			sub: 'NOT STARTED · +4 NEW'
		});
	});
});

describe('the next part, at the end of one', () => {
	const three = () => [
		part({ seriesId: 1, position: 1 }),
		part({ seriesId: 2, position: 2 }),
		part({ seriesId: 3, position: 3 })
	];

	it('is the part after this one in the owner’s order, mid-run', () => {
		expect(nextPart(three(), 2)!.seriesId).toBe(3);
		expect(partPlace(three(), 2)).toEqual({ part: 2, of: 3 });
	});

	it('is the second part from the first, and nothing from the last', () => {
		expect(nextPart(three(), 1)!.seriesId).toBe(2);
		expect(nextPart(three(), 3)).toBeNull();
		expect(partPlace(three(), 3)).toEqual({ part: 3, of: 3 });
	});

	it('is nothing for a Work of one, and nothing for a series in no Work', () => {
		const one = [part({ seriesId: 7, position: 1 })];
		expect(nextPart(one, 7)).toBeNull();
		expect(nextPart(three(), 99)).toBeNull();
		expect(partPlace(three(), 99)).toBeNull();
	});

	it('follows inOrder when two parts tie on position, never the array’s accident', () => {
		// Positions are the owner's, and a tie is broken by the id (inOrder), so
		// "the next part" is the same answer whichever order the rows arrive in.
		const tied = [part({ seriesId: 9, position: 2 }), part({ seriesId: 4, position: 2 })];
		expect(inOrder(tied).map((p) => p.seriesId)).toEqual([4, 9]);
		expect(nextPart(tied, 4)!.seriesId).toBe(9);
		expect(nextPart([...tied].reverse(), 4)!.seriesId).toBe(9);
		expect(nextPart(tied, 9)).toBeNull();
		expect(partPlace(tied, 9)).toEqual({ part: 2, of: 2 });
	});

	it('offers the next part as a block, unless this one is caught up', () => {
		const parts = three();
		expect(workEndMode(parts, 1)).toBe('next');
		// Caught up: all of it read on a source that may still add (Work-EndStates 1).
		const caught = [{ ...read(parts[0]), status: 'ongoing' }, parts[1]];
		expect(partState(caught[0])).toBe('caught-up');
		expect(workEndMode(caught, 1)).toBe('meanwhile');
		// Read through, with a next part: still the block.
		expect(workEndMode([read(parts[0]), parts[1]], 1)).toBe('next');
	});

	it('says the run is read only when every part is', () => {
		const parts = three();
		expect(workEndMode(parts, 3)).toBeNull(); // part 3 is last, parts 1-2 are not read
		const allRead = parts.map(read);
		expect(workEndMode(allRead, 3)).toBe('read');
		expect(workEndMode(allRead, 1)).toBe('read');
		// A caught-up last part is not read through, so it claims nothing.
		const caughtLast = [read(parts[0]), read(parts[1]), { ...read(parts[2]), status: 'ongoing' }];
		expect(partState(caughtLast[2])).toBe('caught-up');
		expect(workEndMode(caughtLast, 3)).toBeNull();
	});

	it('counts what the run held, ratings and all', () => {
		const parts = [
			{ ...read(part({ seriesId: 1, position: 1, title: 'Monster', rating: 10, entries: 162 })) },
			{ ...read(part({ seriesId: 2, position: 2, title: 'Pluto', rating: 0, entries: 65 })) }
		];
		expect(workHeld(parts)).toBe('2 SERIES · 227 CHAPTERS · MONSTER 10, PLUTO UNRATED');
	});

	it('says how a part reads, and its own kind’s word for its entries', () => {
		expect(directionWord('vertical')).toBe('SCROLLS');
		expect(directionWord('rtl')).toBe('R→L');
		expect(directionWord('paged')).toBe('PAGED');
		expect(workPartMeta({ kind: 'manhwa', entries: 205, downloaded: 205 }, 'vertical')).toBe(
			'MANHWA · 205 CHAPTERS · ALL DOWNLOADED · SCROLLS'
		);
		// A mixed Work speaks for the part it offers: an anime says EPISODES, a
		// novel VOLUMES -- the same word its accent says (unitLabel).
		expect(workPartMeta({ kind: 'anime', entries: 12, downloaded: 0 }, 'rtl')).toBe(
			'ANIME · 12 EPISODES · NOT DOWNLOADED · R→L'
		);
		expect(workPartMeta({ kind: 'novel', entries: 12, downloaded: 0 }, 'paged')).toBe(
			'NOVEL · 12 VOLUMES · NOT DOWNLOADED · PAGED'
		);
		expect(workPartMeta({ kind: 'manga', entries: 10, downloaded: 4 }, 'rtl')).toBe(
			'MANGA · 10 CHAPTERS · 4 OF 10 DOWNLOADED · R→L'
		);
	});
});

describe('the series screen’s WORK row (W5)', () => {
	/** Three parts in order: 1 read through, 2 in progress, 3 not started. */
	const run = () => {
		const parts = [
			{ ...part({ seriesId: 1, position: 1, title: 'The Breaker', entries: 72 }), read: 72 },
			{
				...part({ seriesId: 2, position: 2, title: 'New Waves', entries: 205 }),
				read: 14,
				lastOpenedAt: 9
			},
			part({ seriesId: 3, position: 3, title: 'Eternal Force', entries: 98 })
		];
		return parts;
	};

	it('says a part is done when it is read through, or caught up on a going source', () => {
		expect(partDone('read-through')).toBe(true);
		expect(partDone('caught-up')).toBe(true);
		expect(partDone('in-progress')).toBe(false);
		expect(partDone('not-started')).toBe(false);
	});

	it('names the neighbour while the run is here, and where the run is when it is not', () => {
		const parts = run();
		// Part 2 is where CONTINUE is: the line names part 3.
		expect(workRowLine(parts, 2)).toEqual({
			nextTitle: 'Eternal Force',
			youAreIn: null,
			accent: false
		});
		// Part 1 is read through and the owner is already in part 2: the row says
		// where the run is, rather than offering an accent into a part begun.
		expect(workRowLine(parts, 1)).toEqual({
			nextTitle: 'New Waves',
			youAreIn: 'New Waves',
			accent: false
		});
		// A part the owner has not started names nothing about where they are.
		expect(workRowLine(parts, 3)).toEqual({
			nextTitle: null,
			youAreIn: null,
			accent: false
		});
		// A series in no Work has no line at all.
		expect(workRowLine(parts, 99)).toBeNull();
	});

	it('the accent leads into a next part that has not been started', () => {
		// Part 2 read through, part 3 never started: the row is the run's accent.
		const parts = run().map((p, i) => (i === 1 ? { ...p, read: p.entries } : p));
		expect(workRowLine(parts, 2)).toEqual({
			nextTitle: 'Eternal Force',
			youAreIn: null,
			accent: true
		});
		// A part that is caught up on a going source leads the same way.
		const caught = run().map((p, i) =>
			i === 1 ? { ...p, read: p.entries, status: 'ongoing' } : p
		);
		expect(workRowLine(caught, 2)?.accent).toBe(true);
	});

	it('the last part of a run read through names no neighbour', () => {
		const parts = run().map((p) => ({ ...p, read: p.entries }));
		expect(workRowLine(parts, 3)).toEqual({
			nextTitle: null,
			youAreIn: null,
			accent: false
		});
	});
});

describe('what GROUP can make (W4)', () => {
	it('offers books for doujin singletons, volumes for novels, and a Work always', () => {
		expect(groupAnswers([{ kind: 'doujin', entryCount: 1 }])).toEqual(['books', 'work']);
		expect(
			groupAnswers([
				{ kind: 'doujin', entryCount: 1 },
				{ kind: 'doujin', entryCount: 1 }
			])
		).toEqual(['books', 'work']);
		expect(groupAnswers([{ kind: 'novel', entryCount: 1 }])).toEqual(['volumes', 'work']);
		// A Work takes anything that is a series, so a mixed selection has one answer.
		expect(
			groupAnswers([
				{ kind: 'doujin', entryCount: 1 },
				{ kind: 'novel', entryCount: 1 }
			])
		).toEqual(['work']);
		// A doujin series of books and a manga are not one series of anything.
		expect(groupAnswers([{ kind: 'doujin', entryCount: 5 }])).toEqual(['work']);
		expect(groupAnswers([{ kind: 'manga', entryCount: 60 }])).toEqual(['work']);
		expect(groupAnswers([])).toEqual(['work']);
	});
});

import { describe, expect, it } from 'vitest';
import { ago } from '$lib/library/tracking';
import {
	chapterOf,
	coverNote,
	epubLang,
	halfRead,
	parseRanobeUrl,
	ranobeLines,
	ranobeRows,
	ranobeWhy,
	scriptLang,
	suggestedPeople,
	unitsLabel,
	workBundle,
	type RanobeCandidate,
	type RanobeFacts,
	chooseEdition,
	mapUnits,
	ratingOut,
	suggestedUnits,
	unitNumber,
	unitWants,
	unitsRead,
	volumeOf,
	type EditionSummary,
	type MappedEntry,
	byWork,
	comicChapterOf,
	mapAnimeUnits,
	mapWorkUnits,
	searchKinds,
	workLists,
	RANOBE_KINDS
} from '$lib/library/ranobe';

const NOW = Date.UTC(2026, 8, 27, 14, 20);

describe('volumeOf', () => {
	it('reads the volume a one-volume EPUB is, from its title or file', () => {
		expect(volumeOf('Alya Sometimes Hides Her Feelings in Russian, Vol. 1')).toBe('1');
		expect(volumeOf('Eminence in Shadow: Volume 5')).toBe('5');
		expect(volumeOf('The Beginning After the End: Book 10: Retribution')).toBe('10');
		expect(volumeOf('The Beginning After The End 08')).toBe('8');
		expect(volumeOf('Kino no Tabi - Volume 1')).toBe('1');
		expect(volumeOf('No number', 'The Beginning After the End - Book 8 - Ascension.epub')).toBe(
			'8'
		);
	});

	it('takes no span of chapters, and no title without a number, for a volume', () => {
		expect(volumeOf('Lord of the Mysteries: 1-1429')).toBeNull();
		expect(volumeOf('Pick Me Up! c1-591')).toBeNull();
		expect(volumeOf("Omniscient Reader's Viewpoint")).toBeNull();
	});
});

describe('chapterOf', () => {
	it('reads a label that leads with a chapter number', () => {
		expect(chapterOf('254 Hello Darkness')).toBe('254');
		expect(chapterOf('Chapter 12: The Return')).toBe('12');
		expect(chapterOf('Chapter 1.1')).toBe('1.1');
		expect(chapterOf('Ch. 3')).toBe('3');
		expect(chapterOf('Prologue: The Darkness')).toBeNull();
	});

	it('compares numbers as numbers', () => {
		expect(unitNumber('05')).toBe('5');
		expect(unitNumber('12.50')).toBe('12.5');
		expect(unitNumber('Extra')).toBe('Extra');
	});
});

const entry = (
	id: number,
	label: string,
	readAt: number | null = null,
	matter = ''
): MappedEntry => ({
	id,
	label,
	matter,
	readAt
});
const vol = (n: number) => ({ ref: `e9:volume:${n}`, type: 'volume', number: String(n) });
const ch = (n: number) => ({ ref: `e9:chapter:${n}`, type: 'chapter', number: String(n) });

describe('mapUnits', () => {
	it('maps a one-volume EPUB onto its volume, leaving the matter out', () => {
		const m = mapUnits([vol(4), vol(5)], {
			volume: '5',
			entries: [
				entry(1, 'Illustrations', null, 'front'),
				entry(2, 'Prologue'),
				entry(3, 'Chapter 1'),
				entry(4, 'Credits', null, 'back')
			]
		});
		expect([...m]).toEqual([
			[2, 'e9:volume:5'],
			[3, 'e9:volume:5']
		]);
	});

	it('maps a volume per entry, and a chapter per entry', () => {
		expect([
			...mapUnits([vol(1), vol(2)], {
				volume: null,
				entries: [entry(1, 'Vol. 1'), entry(2, 'Vol. 2'), entry(3, 'Vol. 3')]
			})
		]).toEqual([
			[1, 'e9:volume:1'],
			[2, 'e9:volume:2']
		]);
		expect([
			...mapUnits([ch(254), ch(255)], {
				volume: null,
				entries: [
					entry(1, '254 Hello Darkness'),
					entry(2, 'Afterword'),
					entry(3, '255 The Next Message')
				]
			})
		]).toEqual([
			[1, 'e9:chapter:254'],
			[3, 'e9:chapter:255']
		]);
	});

	it('maps nothing the edition does not list', () => {
		expect(mapUnits([], { volume: '5', entries: [entry(1, 'Chapter 1')] }).size).toBe(0);
		// A volume the edition lacks: nothing, never its chapters by accident.
		expect(mapUnits([vol(1)], { volume: '5', entries: [entry(1, 'Chapter 1')] }).size).toBe(0);
	});
});

describe('unitsRead', () => {
	it('reads a unit once every entry on it is, at the last of them', () => {
		const r = unitsRead([
			{ unit: 'v5', readAt: 10 },
			{ unit: 'v5', readAt: 30 },
			{ unit: 'v6', readAt: 10 },
			{ unit: 'v6', readAt: null }
		]);
		expect(r.get('v5')).toBe(30);
		expect(r.get('v6')).toBeNull();
	});

	it('sends a read, takes back only what it sent, and leaves the rest', () => {
		expect(unitWants({ unit: 'u', readAt: 1, sentAt: null })).toBe('read');
		expect(unitWants({ unit: 'u', readAt: null, sentAt: 1 })).toBe('unread');
		expect(unitWants({ unit: 'u', readAt: 1, sentAt: 1 })).toBeNull();
		expect(unitWants({ unit: 'u', readAt: null, sentAt: null })).toBeNull();
	});
});

describe('editions', () => {
	const ed = (ref: string, lang: string, origin: string, format: string): EditionSummary => ({
		ref,
		lang,
		origin,
		format,
		units: {}
	});

	it('picks the series language, licensed before fan, ebook before print', () => {
		const all = [
			ed('e1', 'ja', 'original', 'bunkobon'),
			ed('e2', 'en', 'fan', 'web'),
			ed('e3', 'en', 'licensed', 'paperback'),
			ed('e4', 'en', 'licensed', 'ebook')
		];
		expect(chooseEdition(all, 'en')?.ref).toBe('e4');
		expect(chooseEdition(all, 'pt')).toBeNull();
		expect(chooseEdition([ed('e5', 'pt-BR', 'licensed', 'ebook')], 'pt')?.ref).toBe('e5');
	});

	it('suggests volumes 1 to the highest held', () => {
		expect(suggestedUnits(['5', '6'])).toEqual(
			[1, 2, 3, 4, 5, 6].map((n) => ({ type: 'volume', number: String(n) }))
		);
		expect(suggestedUnits([])).toEqual([]);
	});
});

describe('ratingOut', () => {
	it('sends 1 to 10 as it is, and unrated as null', () => {
		expect(ratingOut(7)).toBe(7);
		expect(ratingOut(0)).toBeNull();
	});
});

describe('the review', () => {
	const cand = (over: Partial<RanobeCandidate> = {}): RanobeCandidate => ({
		work: 'w388',
		kind: 'web_novel',
		title: 'The Beginning After the End',
		matched: 'The Beginning After the End',
		status: 'ongoing',
		years: '2017–',
		units: { chapter: 470, volume: 9 },
		cover: { url: 'https://ranobe.ink/img/1.jpg', sensitive: false },
		...over
	});
	const norm = (t: string) =>
		t
			.toLowerCase()
			.replace(/[^\p{L}\p{N}]+/gu, ' ')
			.trim();

	it('says why a candidate is there', () => {
		const series = {
			title: 'The Beginning After the End, Vol. 2',
			base: 'The Beginning After the End'
		};
		expect(ranobeWhy(series, cand(), norm)).toBe('TITLE EQUAL WITHOUT “VOL. 2”');
		expect(ranobeWhy(series, cand({ prior: 'VOL. 2' }), norm)).toBe('CHOSEN FOR VOL. 2 JUST NOW');
		expect(
			ranobeWhy(
				{ title: 'Honzuki', base: 'Honzuki' },
				cand({ title: 'Ascendance of a Bookworm', matched: '本好きの下剋上' }),
				norm
			)
		).toBe('MATCHED “本好きの下剋上”');
	});

	it('lists units volumes first, and kinds in words', () => {
		expect(unitsLabel({ chapter: 470, volume: 9 })).toBe('9 VOLUMES · 470 CHAPTERS');
		expect(unitsLabel({ volume: 1 })).toBe('1 VOLUME');
		expect(unitsLabel({ chapter: 1432 })).toBe('1,432 CHAPTERS');
		expect(ranobeRows(cand()).map((r) => r.value)).toEqual([
			'The Beginning After the End',
			'WEB NOVEL',
			'2017–',
			'ONGOING',
			'9 VOLUMES · 470 CHAPTERS'
		]);
	});

	it('never draws a sensitive cover, and says there is none', () => {
		expect(coverNote(cand({ cover: null }))).toBe('NO COVER');
		expect(coverNote(cand({ cover: { url: 'x', sensitive: true } }))).toBe('SENSITIVE · NOT SHOWN');
		expect(coverNote(cand())).toBeNull();
	});

	it('reads a pasted Ranobe link for its work only', () => {
		expect(parseRanobeUrl('https://ranobe.ink/w2')).toBe('w2');
		expect(parseRanobeUrl('ranobe.ink/W388?tab=editions')).toBe('w388');
		expect(parseRanobeUrl('/w7')).toBe('w7');
		expect(parseRanobeUrl('https://ranobe.ink/e3')).toBeNull();
		expect(parseRanobeUrl('https://anilist.co/manga/2')).toBeNull();
	});
});

describe('the TRACKING line', () => {
	const base: RanobeFacts = {
		configured: true,
		hidden: false,
		linked: true,
		edition: true,
		comic: false,
		counted: false,
		suggested: false,
		suggestionRefused: false,
		lang: 'en',
		remote: {
			status: 'reading',
			progress: { type: 'volume', number: '5', of: 6 },
			rating: 8,
			favourite: false
		},
		sentAt: NOW - 12 * 60_000,
		failed: null,
		half: null
	};
	const o = { now: NOW, offline: false, ago, clock: () => '09:14' };
	const lines = (f: Partial<RanobeFacts>, more: Partial<typeof o> = {}) =>
		ranobeLines({ ...base, ...f }, { ...o, ...more });

	it('says what Ranobe says, and what was done (2a, 2c)', () => {
		expect(lines({})?.lines[0]).toMatchObject({
			l: 'RANOBE · READING · VOL. 5 OF 6 · 8',
			r: 'SENT 12 MIN AGO'
		});
		expect(
			lines({
				remote: {
					status: 'reading',
					progress: { type: 'chapter', number: '254', of: 1432 },
					rating: 9,
					favourite: true
				}
			})?.lines[0].l
		).toBe('RANOBE · READING · CH. 254 OF 1,432 · 9 · FAV');
	});

	it('adds a quiet line for half a volume (2b), never offline', () => {
		const r = lines({ half: { unit: 'e1:volume:6', read: 6, of: 9 } });
		expect(r?.lines[1]).toMatchObject({
			l: 'VOL. 6 · 6 OF 9 CHAPTERS READ HERE',
			r: 'SENT ONCE ALL 9 ARE',
			strong: false
		});
		expect(
			lines({ half: { unit: 'e1:volume:6', read: 6, of: 9 } }, { offline: true })?.lines
		).toHaveLength(1);
	});

	it('says why a send failed, with TRY AGAIN (2d–2f)', () => {
		const f = (error: string) => lines({ failed: { unit: 'e1:volume:5', error, at: NOW } });
		expect(f('RANOBE DID NOT ANSWER')?.lines[0]).toMatchObject({
			l: 'RANOBE · VOL. 5 NOT SENT',
			r: 'RANOBE DID NOT ANSWER · 09:14',
			rStrong: true
		});
		expect(f('RANOBE DID NOT ANSWER')?.retry).toBe(true);
		expect(f('RANOBE REFUSED THE TOKEN')?.lines[1].l).toBe(
			'A NEW RANOBE_TOKEN IN .ENV, THEN TRY AGAIN'
		);
		expect(f('RANOBE REFUSED IT')?.lines[1].l).toBe(
			'THE EDITION HAS NO VOL. 5 · TRIED AGAIN WITH THE NEXT SEND'
		);
	});

	it('covers the states without a send (2g–2j)', () => {
		expect(lines({ edition: false, suggestionRefused: true })?.lines.map((l) => l.l)).toEqual([
			'RANOBE · WAITING ON AN EDITION',
			'NO ENGLISH EDITION ON RANOBE · THE ONE SUGGESTED WAS REFUSED'
		]);
		expect(lines({ linked: false })?.lines[0]).toMatchObject({
			l: 'NOT ON RANOBE',
			r: 'NOTHING SENT · READS STAY HERE'
		});
		expect(lines({}, { offline: true })?.lines[0].r).toBe('AS OF 09:14');
		expect(lines({ hidden: true })?.lines[0].l).toBe(
			'NOTHING SENT · HIDDEN SERIES STAY OFF RANOBE'
		);
		expect(lines({ configured: false })).toBeNull();
	});

	it('says a comic waits on its chapter count, and what a refusal was (c98)', () => {
		expect(lines({ comic: true, edition: false, counted: false })?.lines.map((l) => l.l)).toEqual([
			'RANOBE · WAITING ON ITS CHAPTER COUNT',
			'RANOBE DOESN’T COUNT THIS WORK’S CHAPTERS YET · READS GO ONCE IT DOES'
		]);
		// Counted, a comic has no edition and needs none.
		expect(
			lines({
				comic: true,
				edition: false,
				counted: true,
				remote: {
					status: 'reading',
					progress: { type: 'chapter', number: '154', of: 179 },
					rating: null,
					favourite: false
				}
			})?.lines[0].l
		).toBe('RANOBE · READING · CH. 154 OF 179');
		expect(
			lines({
				comic: true,
				counted: true,
				failed: { unit: 'w9:chapter:12', error: 'RANOBE REFUSED IT', at: NOW }
			})?.lines[1].l
		).toBe('THE WORK HAS NO CH. 12 · TRIED AGAIN WITH THE NEXT SEND');
	});

	it('finds the unit read partway, in order', () => {
		expect(
			halfRead([
				{ unit: 'v5', readAt: 1 },
				{ unit: 'v5', readAt: 1 },
				{ unit: 'v6', readAt: 1 },
				{ unit: 'v6', readAt: null },
				{ unit: 'v6', readAt: null }
			])
		).toEqual({ unit: 'v6', read: 1, of: 3 });
		// A web novel's chapter is one entry: never half.
		expect(halfRead([{ unit: 'c1', readAt: null }])).toBeNull();
	});
});

describe('suggesting a novel (c72)', () => {
	it('reads a language from a script, and from an EPUB’s tag', () => {
		expect(scriptLang('백덕수')).toBe('ko');
		expect(scriptLang('香月美夜')).toBe('zh');
		expect(scriptLang('かづき みや')).toBe('ja');
		expect(scriptLang('TurtleMe')).toBeNull();
		expect(epubLang('en_US')).toBe('en-US');
		expect(epubLang('eng')).toBe('en');
		expect(epubLang('en')).toBe('en');
		expect(epubLang('')).toBeNull();
	});

	it('keeps authors, and drops what isn’t one (the files’ own creators)', () => {
		// The Beginning After The End 08: a ripper's credit beside the author.
		expect(
			suggestedPeople([
				{ name: 'Goldengato https://jnovels.com', role: '' },
				{ name: 'Turtle Me', role: '' }
			])
		).toEqual([{ name: 'Turtle Me', latin: null, lang: null }]);
		// SSS-Class Suicide Hunter: a placeholder, nobody.
		expect(suggestedPeople([{ name: 'To be implemented', role: '' }])).toEqual([]);
		// Omniscient Reader's Viewpoint: the native name leads, the romanisation beside it.
		expect(suggestedPeople([{ name: 'Sing-shong (싱숑)', role: '' }])).toEqual([
			{ name: '싱숑', latin: 'Sing-shong', lang: 'ko' }
		]);
		// One name spelt twice, and an illustrator when roles are given.
		expect(
			suggestedPeople([
				{ name: 'TurtleMe', role: 'aut' },
				{ name: 'Turtle Me', role: 'aut' },
				{ name: 'Someone Draws', role: 'ill' }
			])
		).toEqual([{ name: 'TurtleMe', latin: null, lang: null }]);
	});

	it('builds the bundle: the people first, the work crediting them', () => {
		const b = workBundle({
			title: 'The Beginning After the End',
			volume: '5',
			people: [{ name: 'TurtleMe', latin: null, lang: null }],
			lang: 'en',
			file: 'TBATE - Book 5.epub'
		});
		expect(b.source).toBe('epub:TBATE - Book 5.epub');
		expect(b.items.map((i) => [i.key, i.type])).toEqual([
			['author1', 'person'],
			['work', 'work']
		]);
		expect(b.items[1].snapshot).toMatchObject({
			kind: 'light_novel',
			// Ranobe needs a title in the original language: the file's is the only one.
			originalLang: 'en',
			titles: [{ lang: 'en', title: 'The Beginning After the End', latin: null, official: false }],
			credits: [{ personId: '@author1', orgId: null, role: 'author', note: null }]
		});
		expect(b.reason).toContain('the file doesn’t say what it is');
		// The author's script says the original language; chapters say a web novel.
		const ko = workBundle({
			title: 'Omniscient Reader’s Viewpoint',
			volume: null,
			people: [{ name: '싱숑', latin: 'Sing-shong', lang: 'ko' }],
			lang: 'en',
			file: 'orv.epub'
		});
		expect(ko.items[1].snapshot).toMatchObject({ kind: 'web_novel', originalLang: 'en' });
		// The Korean guess goes where the owner reads it before approving.
		expect(ko.reason).toContain('probably ko');
		// A second title in brackets goes along as an alias (Second Life Ranker's file).
		const slr = workBundle({
			title: 'Second Life Ranker',
			aliases: ['Ranker Who Lives Twice', 'Second Life Ranker'],
			volume: null,
			people: [],
			lang: 'en',
			file: 'slr.epub'
		});
		expect(slr.items[0].snapshot.aliases).toEqual(['Ranker Who Lives Twice']);
	});

	it('says a suggestion waits, on the TRACKING row', () => {
		const r = ranobeLines(
			{
				configured: true,
				hidden: false,
				linked: false,
				suggested: true,
				edition: false,
				comic: false,
				counted: false,
				suggestionRefused: false,
				lang: 'en',
				remote: null,
				sentAt: null,
				failed: null,
				half: null
			},
			{ now: NOW, offline: false, ago, clock: () => '09:14' }
		);
		expect(r?.lines[0]).toMatchObject({
			l: 'RANOBE · SUGGESTED, WAITING FOR YOUR REVIEW',
			r: 'NOTHING SENT YET'
		});
	});
});

describe('comics, against the work (c98)', () => {
	const entry = (id: number, label: string, matter = ''): MappedEntry => ({
		id,
		label,
		matter,
		readAt: null
	});

	it('tracks manga and manhwa, never doujinshi, and searches comics as comics', () => {
		expect(RANOBE_KINDS).toEqual(['novel', 'manga', 'manhwa', 'anime']);
		expect(byWork('manhwa')).toBe(true);
		expect(byWork('novel')).toBe(false);
		expect(searchKinds('manga')).toBe('manga,manhwa,manhua');
		expect(searchKinds('novel')).toBe('light_novel,web_novel');
		// An anime is one work for the whole show, its episodes counted straight
		// through the seasons (c240).
		expect(byWork('anime')).toBe(true);
		expect(searchKinds('anime')).toBe('anime,donghua');
	});

	it('maps an anime’s episodes onto the one work, across its seasons', () => {
		const work = { type: 'episode', count: 5, extra: [] };
		const rows = [entry(1, 'Episode 1'), entry(2, 'Episode 2'), entry(3, 'Episode 1')];
		expect([...mapAnimeUnits('w900', work, rows)]).toEqual([
			[1, 'w900:episode:1'],
			[2, 'w900:episode:2'],
			[3, 'w900:episode:3']
		]);
		// A recap and a half number take no number, and are never sent.
		const withRecap = [
			entry(1, 'Episode 1'),
			entry(2, '14.5 Recollection', ''),
			{ ...entry(3, 'Episode 15'), recap: true },
			entry(4, 'Episode 2')
		];
		expect([...mapAnimeUnits('w900', work, withRecap)]).toEqual([
			[1, 'w900:episode:1'],
			[4, 'w900:episode:2']
		]);
		// Past the count: the next pass that reads a higher count maps it.
		expect(mapAnimeUnits('w900', { ...work, count: 1 }, rows).size).toBe(1);
		expect(mapAnimeUnits('w900', null, rows).size).toBe(0);
	});

	it('reads a chapter number from the labels comics have', () => {
		expect(comicChapterOf('Ch. 154')).toBe('154');
		expect(comicChapterOf('Chapter 12.5: The Rain')).toBe('12.5');
		expect(comicChapterOf('Episode 3')).toBe('3');
		expect(comicChapterOf('Vol.2 Ch.15 - One shot - Pilot')).toBe('15');
		expect(comicChapterOf('Prologue - Promise')).toBeNull();
	});

	it('lists 1..count and the extras, never a fraction folded into its chapter', () => {
		const u = { type: 'chapter', count: 179, extra: ['12.5'] };
		expect(workLists(u, '1')).toBe(true);
		expect(workLists(u, '179')).toBe(true);
		expect(workLists(u, '180')).toBe(false);
		expect(workLists(u, '0')).toBe(false);
		expect(workLists(u, '12.50')).toBe(true);
		expect(workLists(u, '13.5')).toBe(false);
	});

	it('takes any number 1 to 10,000 on a running work, counted or not', () => {
		const open = { type: 'chapter', count: null, extra: [], open: true };
		expect(workLists(open, '1')).toBe(true);
		expect(workLists(open, '162')).toBe(true);
		expect(workLists(open, '13.5')).toBe(true);
		expect(workLists(open, '0')).toBe(false);
		expect(workLists(open, '10001')).toBe(false);
		expect(workLists({ ...open, count: 155 }, '162')).toBe(true);
		// Finished with no count: Ranobe refuses every chapter, so none maps.
		expect(workLists({ ...open, open: false }, '1')).toBe(false);
	});

	it("maps each chapter the work lists onto the work's own unit", () => {
		const units = { type: 'chapter', count: 3, extra: ['2.5'] };
		const got = mapWorkUnits('w9', units, [
			entry(1, 'Ch. 1'),
			entry(2, 'Ch. 2.5'),
			entry(3, 'Ch. 3.5'),
			entry(4, 'Ch. 4'),
			entry(5, 'Afterword'),
			entry(6, 'Ch. 3', 'back')
		]);
		expect([...got]).toEqual([
			[1, 'w9:chapter:1'],
			[2, 'w9:chapter:2.5']
		]);
		// A work that counts nothing yet maps nothing: no read goes on a guess.
		expect(mapWorkUnits('w9', null, [entry(1, 'Ch. 1')]).size).toBe(0);
	});
});

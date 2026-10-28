/**
 * Chapter and volume numbers read from chapter names: a port of Mihon's
 * ChapterRecognition (mihonapp/mihon, domain/.../chapter/service/
 * ChapterRecognition.kt, Apache-2.0), kept rule for rule so that a chapter
 * gets the number Mihon would give it. The 1.6 extensions leave numbering to
 * the host and return -1 for every chapter but Webtoons' (doc/DOWNLOADER.md).
 *
 * Each name is read on its own first: the volume or season is taken out, a
 * part becomes the letter of a sub-chapter, and the chapter number is the one
 * after "ch." or else the first one left. Reading the whole list then fills in
 * what single names don't tell ([chapterNumbers]).
 *
 * Two places where JavaScript differs from Kotlin and the port follows Kotlin:
 * `round` rounds ties to even (`roundHalfEven`), and a Kotlin `Regex.replace`
 * replaces every match (the `g` flag here).
 */

const NUMBER_PATTERN = String.raw`([0-9]+)(\.[0-9]+)?(\.?[a-z]+)?`;

/** Mokushiroku Alice Vol.1 Ch. 4: Misrepresentation -> 4 */
const basic = new RegExp(String.raw`(?<=ch\.) *${NUMBER_PATTERN}`);
/** Bleach 567: Down With Snowwhite -> 567 */
const number = new RegExp(NUMBER_PATTERN);
const numberAll = new RegExp(NUMBER_PATTERN, 'g');
/** Onepunch-Man Punch Ver002 028 -> Onepunch-Man Punch 028 */
const unwanted = /\b(?:ver|version)[^a-z]?[0-9]+/g;
/** One Piece 12 special -> One Piece 12special */
const unwantedWhiteSpace = /\s(?=extra|special|omake)/g;
/** A volume or season, the short forms only right before the number, since "s" also ends words. */
const volumeSource = String.raw`\b(?:(?:vol(?:ume)?|season)[^a-z0-9]? *|[vs]\.?)([0-9]+(?:\.[0-9]+)?)\b`;
const volume = new RegExp(volumeSource);
const volumeAll = new RegExp(volumeSource, 'g');
/** Chapter 1.5 Part II -> b */
const part = /\bpart\.? *([0-9]+|i{1,3}|iv|vi{0,3}|ix|x)\b/;
const romanNumerals = ['i', 'ii', 'iii', 'iv', 'v', 'vi', 'vii', 'viii', 'ix', 'x'];
/** Group 2 Chapter 386 -> Group # Chapter # */
const anyNumber = /[0-9]+(?:\.[0-9]+)?/g;
/** A number after this is the chapter number, even when every similar name has the same one. */
const chapterPrefix = /(?:\b(?:ch|chap|chapter|ep|episode)\.? *|#)$/;
const bonus = /\b(?:extra|bonus|omake|special|side ?story|afterword|interlude)/;
const prologue = /\b(?:prologue|one.?shot|pilot)\b/;

export type ChapterNumbering = { volume: string | null; chapter: string | null };

/** A recognized number, with the letter of a sub-chapter like the a in 19a. */
type Recognized = { value: number; letter: string | null };
const recognized = (value: number, letter: string | null = null): Recognized => ({ value, letter });

/** Kotlin's kotlin.math.round: ties to the even neighbour. */
function roundHalfEven(x: number): number {
	const r = Math.round(x);
	return Math.abs(x % 1) === 0.5 && r % 2 !== 0 ? r - 1 : r;
}

/** DecimalFormat("#.###", Locale.ROOT): no trailing zeros, a dot, half-even. */
function format(v: number): string {
	const scaled = roundHalfEven(v * 1000) / 1000;
	return String(Object.is(scaled, -0) ? 0 : scaled);
}

const show = (n: Recognized) => format(n.value) + (n.letter ?? '');

/** Whether the source gave a number: -1 and below mean it didn't, except -2, which some sources use on purpose. */
const isKnown = (n: number) => n === -2 || n > -1;

/**
 * A number of a [ChapterNumbering] as a number. A letter counts only without
 * decimals, from .1 for a to .9 for i: 19a -> 19.1, 1.5a -> 1.5.
 */
export function toNumber(s: string): number {
	const last = s.at(-1) ?? '';
	const letter = /\p{L}/u.test(last) ? last : null;
	const value = Number(letter ? s.slice(0, -1) : s);
	const tenths = letter ? letter.charCodeAt(0) - 'a'.charCodeAt(0) + 1 : null;
	return tenths !== null && tenths < 10 && !s.includes('.') ? value + tenths / 10 : value;
}

const cleanName = (mangaTitle: string, name: string) =>
	name.toLowerCase().split(mangaTitle.toLowerCase()).join('');

type Range = [start: number, end: number];

/** Replaces [ranges] with a space each, from the last, so the earlier ones stay where they are. */
function removeRanges(s: string, ranges: Range[]): string {
	return [...ranges]
		.sort((a, b) => b[0] - a[0])
		.reduce((acc, [start, end]) => acc.slice(0, start) + ' ' + acc.slice(end), s);
}

function toRecognized(m: RegExpMatchArray): Recognized {
	const [, whole, decimal = '', alpha = ''] = m;
	const value = Number(whole) + (decimal === '' ? 0 : Number(decimal));
	if (decimal === '' && alpha.includes('extra')) return recognized(value + 0.99);
	if (decimal === '' && alpha.includes('omake')) return recognized(value + 0.98);
	if (decimal === '' && alpha.includes('special')) return recognized(value + 0.97);
	// Only up to i, like the decimals they used to stand for: others are words, like 5v2.
	const single = alpha.replace(/^\.+/, '');
	return recognized(value, single.length === 1 && single >= 'a' && single <= 'i' ? single : null);
}

/** The number after "ch." or else the first one, leaving out version tags when there are several. */
function parseNumber(name: string): Recognized | null {
	// Some sources write decimals and letters with these: 300,a and 122-a.
	const clean = name
		.trim()
		.replaceAll(',', '.')
		.replaceAll('-', '.')
		.replace(unwantedWhiteSpace, '');
	const numbers = [...clean.matchAll(numberAll)];
	if (numbers.length > 1) {
		const withoutTags = clean.replace(unwanted, '');
		const m = withoutTags.match(basic) ?? withoutTags.match(number);
		if (m) return toRecognized(m);
	}
	return numbers[0] ? toRecognized(numbers[0]) : null;
}

const parsePart = (p: string) => (/^[0-9]+$/.test(p) ? Number(p) : romanNumerals.indexOf(p) + 1);

/** The chapter number in a name without the manga title; a part after it becomes its letter: Chapter 1.5 Part I -> 1.5a. */
function parseName(name: string): Recognized | null {
	// The volume can't also be the chapter number.
	const withoutVolume = name.replace(volumeAll, ' ');
	const partMatch = withoutVolume.match(part);
	if (partMatch && partMatch.index !== undefined) {
		const n = parsePart(partMatch[1]);
		if (n >= 1 && n <= 26) {
			const letter = String.fromCharCode('a'.charCodeAt(0) + n - 1);
			const rest =
				withoutVolume.slice(0, partMatch.index) +
				withoutVolume.slice(partMatch.index + partMatch[0].length);
			const num = parseNumber(rest);
			// A letter written in the number is what the source numbers the chapter by.
			if (num) return num.letter === null ? { ...num, letter } : num;
		}
	}
	// Without another number ("Part 3"), the part is the chapter number.
	return parseNumber(withoutVolume);
}

/** The chapter number of one chapter, keeping [sourceNumber] when the source gave one. */
export function chapterNumberOf(mangaTitle: string, name: string, sourceNumber?: number): number {
	if (sourceNumber !== undefined && isKnown(sourceNumber)) return sourceNumber;
	const n = parseName(cleanName(mangaTitle, name));
	return n ? toNumber(show(n)) : (sourceNumber ?? -1);
}

/**
 * The numbers every name of a group shares, in a group of at least three
 * names that differ only in their numbers: the 2 in "Group 2 Chapter 385".
 * Chapters the source numbered are left out.
 */
function sharedNumbers(names: string[], known: boolean[]): Range[][] {
	const matches = names.map((n) => [...n.matchAll(anyNumber)]);
	const shared: Range[][] = names.map(() => []);
	const groups = new Map<string, number[]>();
	names.forEach((n, i) => {
		if (known[i]) return;
		// Grouped by all but their numbers, so the nth number of each means the same thing.
		const key = n.replace(anyNumber, '#');
		groups.set(key, [...(groups.get(key) ?? []), i]);
	});
	for (const group of groups.values()) {
		// Fewer names could share a number by chance.
		if (group.length < 3) continue;
		const first = matches[group[0]];
		const slots = first.map((_, i) => i);
		const sharedSlots = slots.filter((s) => group.every((i) => matches[i][s][0] === first[s][0]));
		// Something has to be left to tell the chapters apart.
		if (sharedSlots.length === slots.length) continue;
		// Parts of a chapter share its number: the 5 of "Chapter 5 Part 1" and "Chapter 5 Part 2".
		const removable = sharedSlots.filter(
			(s) => !chapterPrefix.test(names[group[0]].slice(0, first[s].index))
		);
		for (const i of group)
			shared[i] = removable.map((s) => {
				const m = matches[i][s];
				return [m.index!, m.index! + m[0].length];
			});
	}
	return shared;
}

/** The runs of consecutive chapters without a number, as [first, last] inclusive. */
function nullRuns(numbers: (Recognized | null)[]): [number, number][] {
	const runs: [number, number][] = [];
	let start = 0;
	while (start < numbers.length) {
		if (numbers[start] !== null) {
			start++;
			continue;
		}
		let end = start;
		while (end < numbers.length && numbers[end] === null) end++;
		runs.push([start, end - 1]);
		start = end;
	}
	return runs;
}

const indices = ([first, last]: [number, number]) =>
	Array.from({ length: last - first + 1 }, (_, i) => first + i);

/** Whether the chapters of [run] are in no volume or in [volume], the one of the chapters their numbers come from. */
const withinVolume = (volumes: (number | null)[], run: [number, number], v: number | null) =>
	indices(run).every((i) => volumes[i] === null || volumes[i] === v);

/** Numbers [run] between [lower] and [upper], the least recent lowest: .5, .6 after the whole number, or evenly spread. */
function fillBetween(
	numbers: (Recognized | null)[],
	run: [number, number],
	lower: number,
	upper: number
) {
	const count = run[1] - run[0] + 1;
	const tenths = [5, 6, 7, 8, 9]
		.map((t) => Math.floor(lower) + t / 10)
		.filter((t) => t > lower && t < upper);
	if (tenths.length >= count) {
		// Rounded since tenths can't be exact doubles, e.g. 10 + 0.6.
		indices(run)
			.reverse()
			.forEach((chapter, i) => (numbers[chapter] = recognized(roundHalfEven(tenths[i] * 10) / 10)));
		return;
	}
	// Tenths run out after a 2.9 or past five chapters, and the chapters still have to fit below upper.
	const step = (upper - lower) / (count + 1);
	for (const i of indices(run))
		numbers[i] = recognized(roundHalfEven((lower + step * (run[1] + 1 - i)) * 1000) / 1000);
}

/**
 * Numbers runs of chapters without a number after the chapters around them,
 * only within a volume, since numbers may start over in the next one:
 * between two chapters the missing whole numbers when they fit (2, ?, 4 -> 3)
 * or else between them (10, ?, 11 -> 10.5); after the newest, only bonus
 * chapters (100, Afterword -> 100.5); before the oldest, only a prologue,
 * which gets 0, and volume 0 when the chapter after it has a volume.
 */
function fillNumbers(names: string[], numbers: (Recognized | null)[], volumes: (number | null)[]) {
	for (const run of nullRuns(numbers)) {
		const [first, last] = run;
		const count = last - first + 1;
		// A -2 from the source says nothing about where a chapter is.
		const newer =
			first > 0 && numbers[first - 1] && numbers[first - 1]!.value >= 0 ? numbers[first - 1] : null;
		const older =
			last + 1 < numbers.length && numbers[last + 1] && numbers[last + 1]!.value >= 0
				? numbers[last + 1]
				: null;
		const olderVolume = last + 1 < volumes.length ? volumes[last + 1] : null;
		const bonuses = indices(run).filter((i) => bonus.test(names[i])).length;
		if (newer && older) {
			const sameVolume =
				volumes[first - 1] === olderVolume && withinVolume(volumes, run, olderVolume);
			// Out of order chapters tell nothing about the ones between them.
			if (newer.value <= older.value || !sameVolume) continue;
			const whole = [newer, older].every((n) => n.letter === null && n.value % 1 === 0);
			// Bonus chapters aren't missing chapters even when they would fit: 2, Bonus, 4 -> 2.5.
			if (bonuses === 0 && whole && newer.value - older.value - 1 === count) {
				for (const i of indices(run)) numbers[i] = recognized(older.value + (last + 1 - i));
			} else {
				// Never past the next whole number, which may still be a chapter to come.
				fillBetween(numbers, run, older.value, Math.min(newer.value, Math.floor(older.value) + 1));
			}
		} else if (older) {
			// Newer chapters without a number may as well be announcements.
			if (bonuses < count || !withinVolume(volumes, run, olderVolume)) continue;
			fillBetween(numbers, run, older.value, Math.floor(older.value) + 1);
		} else if (newer && newer.value > 0) {
			// When the first chapter is already 0, that's the prologue.
			for (const i of indices(run).filter((i) => prologue.test(names[i]))) {
				numbers[i] = recognized(0);
				if (volumes[i] === null && volumes[first - 1] !== null) volumes[i] = 0;
			}
		}
	}
}

/**
 * The numbers of [chapters], given from the most to the least recent, read
 * with the whole list: numbers every similar name shares aren't the chapter
 * number, and chapters without one are numbered after the chapters around
 * them. Numbers the source gave are kept.
 */
export function chapterNumbers(
	mangaTitle: string,
	chapters: { name: string; number: number }[]
): ChapterNumbering[] {
	const names = chapters.map((c) => cleanName(mangaTitle, c.name));
	const known = chapters.map((c) => isKnown(c.number));
	// Taken out before reading the names, so the 2 in "Group 2 Chapter 386" can't be picked.
	const shared = sharedNumbers(names, known);
	const numbers: (Recognized | null)[] = chapters.map((c, i) =>
		known[i] ? recognized(c.number) : parseName(removeRanges(names[i], shared[i]))
	);
	// Only from the name: newer chapters may not be in a volume yet, so neighbours don't tell.
	const volumes: (number | null)[] = names.map((n) => {
		const m = n.match(volume);
		return m ? Number(m[1]) : null;
	});
	fillNumbers(names, numbers, volumes);
	return chapters.map((_, i) => ({
		volume: volumes[i] === null ? null : format(volumes[i]!),
		chapter: numbers[i] ? show(numbers[i]!) : null
	}));
}

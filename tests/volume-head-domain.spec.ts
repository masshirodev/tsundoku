import { describe, expect, it } from 'vitest';
import {
	currentEntry,
	listRows,
	rowsUnderHead,
	volumeCached,
	volumeHead,
	volumeMeta,
	volumeOf,
	volumeTicks,
	type SeriesEntry,
	type VolumeState
} from '$lib/library/series';

/**
 * A volume's head (c835): its number, its state, its chapters and how far
 * through them it is. The rules are checked over their whole finite domain --
 * every chapter count of 0 to 3, every number of them read, the current entry
 * inside and outside -- rather than on the handful the handoff happens to draw,
 * so a shape one over cannot regress unseen (wave 35's lesson).
 */

function entry(n: number, opts: Partial<SeriesEntry> = {}): SeriesEntry {
	return {
		id: 1000 + n,
		number: n,
		label: `Ch. ${n}`,
		title: '',
		readAt: null,
		lastPosition: null,
		lastOpenedAt: null,
		pageCount: 20,
		file: 'Vol 1.epub',
		bytes: 1,
		rating: 0,
		favourite: false,
		addedAt: 0,
		coverPage: null,
		available: true,
		locator: `doc.xhtml#${n}`,
		matter: '',
		lastOffset: null,
		volume: 'A Volume',
		originSource: '',
		tags: [],
		...opts
	};
}

/** A volume of `chapters` chapters, the first `read` read, `matter` on each side. */
function volume(chapters: number, read: number, matter = false): SeriesEntry[] {
	const out: SeriesEntry[] = [];
	let n = 1;
	if (matter) out.push(entry(n++, { matter: 'front', readAt: 1, title: 'Cover' }));
	for (let i = 0; i < chapters; i++) out.push(entry(n++, { readAt: i < read ? 1 : null }));
	if (matter) out.push(entry(n, { matter: 'back', readAt: 1, title: 'Afterword' }));
	return out;
}

const stateOf = (chapters: number, read: number, here: boolean): VolumeState =>
	chapters > 0 && read === chapters ? 'read' : here ? 'reading' : 'unread';

describe("a volume's head", () => {
	it('says its state over every count of chapters and of them read', () => {
		for (let chapters = 0; chapters <= 3; chapters++) {
			for (let read = 0; read <= chapters; read++) {
				for (const here of [false, true]) {
					const vol = volume(chapters, read);
					// The current entry is one of the volume's, so it can only matter when it has one.
					const current = here && vol.length > 0 ? vol[Math.min(read, vol.length - 1)] : null;
					const inVolume = current !== null;
					const head = volumeHead(vol, 1, current);
					expect({ chapters, read, here, state: head.state }).toEqual({
						chapters,
						read,
						here,
						state: stateOf(chapters, read, inVolume)
					});
					expect(head.chapters).toBe(chapters);
					expect(head.read).toBe(read);
					// The bar is the one being read's, and only its own: read of chapters.
					expect(head.progress).toBe(
						stateOf(chapters, read, inVolume) === 'reading' ? read / chapters : null
					);
				}
			}
		}
	});

	it('counts chapters, not the front and back matter around them', () => {
		for (let chapters = 0; chapters <= 3; chapters++) {
			for (let read = 0; read <= chapters; read++) {
				const plain = volumeHead(volume(chapters, read), 1, null);
				const withMatter = volumeHead(volume(chapters, read, true), 1, null);
				// The matter is read on both sides, and is never a chapter.
				expect({ matter: withMatter.chapters, read: withMatter.read }).toEqual({
					matter: chapters,
					read
				});
				expect(withMatter.state).toBe(plain.state);
				expect(withMatter.progress).toBe(plain.progress);
			}
		}
	});

	it('writes "n CHAPTERS · m READ", and the chapter count alone when none is read', () => {
		for (let chapters = 0; chapters <= 3; chapters++) {
			for (let read = 0; read <= chapters; read++) {
				const meta = volumeMeta(volumeHead(volume(chapters, read), 1, null));
				const noun = chapters === 1 ? 'CHAPTER' : 'CHAPTERS';
				expect(meta).toBe(read > 0 ? `${chapters} ${noun} · ${read} READ` : `${chapters} ${noun}`);
			}
		}
		expect(volumeMeta({ chapters: 1, read: 0 })).toBe('1 CHAPTER');
	});

	it('names the volume by its own title, verbatim, and UNTITLED when it has none', () => {
		const [vol] = [volume(2, 0)];
		expect(volumeHead(vol, 1, null).title).toBe('A Volume');
		expect(
			volumeHead(
				vol.map((e) => ({ ...e, volume: '' })),
				1,
				null
			).title
		).toBe('UNTITLED');
		// Never uppercased: the title is the book's, not a label.
		expect(
			volumeHead(
				vol.map((e) => ({ ...e, volume: 'Spice and Wolf, Vol. 3' })),
				1,
				null
			).title
		).toBe('Spice and Wolf, Vol. 3');
	});

	it('numbers six volumes 1 to 6, either way round, each head above its own chapters', () => {
		const entries = Array.from({ length: 6 }, (_, v) =>
			Array.from({ length: 2 }, (_, c) => {
				const n = v * 10 + c + 1;
				return entry(n, {
					file: `Vol ${v + 1}.epub`,
					volume: `Book ${v + 1}`,
					readAt: v < 2 ? 1 : null
				});
			})
		).flat();
		for (const descending of [false, true]) {
			const rows = listRows(entries, { descending });
			const heads = rows.flatMap((r, i) => (r.type === 'volume' ? [{ r, i }] : []));
			expect(heads.map((h) => h.r.number)).toEqual(
				[1, 2, 3, 4, 5, 6]
					.reverse()
					.slice(0, 0)
					.concat(descending ? [6, 5, 4, 3, 2, 1] : [1, 2, 3, 4, 5, 6])
			);
			for (const { r, i } of heads) {
				// The rows after this head, up to the next, are its own volume's.
				const next = rows.findIndex((x, j) => j > i && x.type === 'volume');
				const body = rows.slice(i + 1, next < 0 ? rows.length : next);
				const numbers = body.flatMap((x) => (x.type === 'entry' ? [x.entry.number] : []));
				expect(numbers.every((n) => Math.floor((n - 1) / 10) === r.number - 1)).toBe(true);
				expect(r.title).toBe(`Book ${r.number}`);
			}
		}
	});

	it('keeps a key that is the volume, not the row’s place', () => {
		const entries = Array.from({ length: 4 }, (_, v) =>
			entry(v + 1, { file: `Vol ${v + 1}.epub`, volume: `Book ${v + 1}` })
		);
		const up = listRows(entries).flatMap((r) => (r.type === 'volume' ? [r.key] : []));
		const down = listRows(entries, { descending: true }).flatMap((r) =>
			r.type === 'volume' ? [r.key] : []
		);
		expect(up).toEqual(['v1', 'v2', 'v3', 'v4']);
		expect(down).toEqual(['v4', 'v3', 'v2', 'v1']);
	});

	it('reads the current entry, never the matter, as where a volume is', () => {
		const vol = volume(3, 1, true);
		// The unread chapter is what the reader opens; the read front matter is not.
		const cur = currentEntry(vol);
		expect(cur?.matter).toBe('');
		const head = volumeHead(vol, 1, cur);
		expect(head.state).toBe('reading');
		expect(head.progress).toBeCloseTo(1 / 3);
		// A volume no current entry is in, part read and moved past, is not "being read".
		expect(volumeHead(vol, 1, entry(9)).state).toBe('unread');
	});
});

describe("the rows under a volume's head", () => {
	const two = () => [
		entry(1, { file: 'Vol 1.epub', volume: 'Book 1' }),
		entry(2, { file: 'Vol 1.epub', volume: 'Book 1' }),
		entry(3, { file: 'Vol 2.epub', volume: 'Book 2' }),
		entry(4, { file: 'Vol 2.epub', volume: 'Book 2' })
	];

	it('marks the first row after every head, V1 included, either way round', () => {
		// V1's head is above a row like any other's; descending, the row under a
		// head is the volume's last chapter, because the list itself is flipped.
		expect([...rowsUnderHead(listRows(two()))]).toEqual(['1001', '1003']);
		expect([...rowsUnderHead(listRows(two(), { descending: true }))]).toEqual(['1004', '1002']);
	});

	it('skips a FRONT MATTER section to the entry under it, the real EPUB shape', () => {
		const entries = [
			entry(1, { file: 'Vol 1.epub', volume: 'Book 1' }),
			entry(2, { file: 'Vol 2.epub', volume: 'Book 2', matter: 'front', title: 'Cover' }),
			entry(3, { file: 'Vol 2.epub', volume: 'Book 2' }),
			entry(4, { file: 'Vol 2.epub', volume: 'Book 2' })
		];
		const rows = listRows(entries);
		// The shape a real import has: v1, its chapter, v2, v2:front, the front
		// matter, v2:chapters, the chapters (measured, round 2).
		const at = rows.findIndex((r) => r.type === 'volume' && r.number === 2);
		expect(rows[at + 1]).toMatchObject({ type: 'section', key: 'v2:front' });
		expect(rows[at + 2]).toMatchObject({ type: 'entry' });
		expect([...rowsUnderHead(rows)]).toEqual(['1001', '1002']);
	});

	it('marks a fold when the fold is what sits under the head', () => {
		const vol2 = Array.from({ length: 7 }, (_, i) =>
			entry(i + 3, {
				file: 'Vol 2.epub',
				volume: 'Book 2',
				// The seventh is where the reader is; the first six are read.
				readAt: i < 6 ? 1 : null
			})
		);
		const entries = [entry(1, { file: 'Vol 1.epub', volume: 'Book 1', readAt: 1 }), ...vol2];
		const rows = listRows(entries);
		const at = rows.findIndex((r) => r.type === 'volume' && r.number === 2);
		expect(rows[at + 1]).toMatchObject({ type: 'fold' });
		const under = rowsUnderHead(rows);
		expect(under.has('fold')).toBe(true);
		// V1's own row is still the chapter after its head.
		expect(under.has('1001')).toBe(true);
	});

	it('marks nothing when only a section follows a head', () => {
		const head = volumeHead([entry(1, { matter: 'front' })], 1, null);
		const rows = [
			head,
			{ type: 'section' as const, key: 'front', label: 'FRONT MATTER', detail: '1' }
		];
		expect(rowsUnderHead(rows).size).toBe(0);
		// A head with no row after it at all is the same.
		expect(rowsUnderHead([head]).size).toBe(0);
	});
});

describe("the rail's volume ticks", () => {
	const six = () =>
		Array.from({ length: 6 }, (_, v) =>
			Array.from({ length: 2 }, (_, c) => {
				const n = v * 2 + c + 1;
				return entry(n, { file: `Vol ${v + 1}.epub`, volume: `Book ${v + 1}` });
			})
		).flat();

	it('puts one tick at each volume’s first entry, labelled V1 to V6', () => {
		const entries = six();
		const ticks = volumeTicks(entries, 400);
		expect(ticks.map((t) => t.label)).toEqual(['V1', 'V2', 'V3', 'V4', 'V5', 'V6']);
		// Numbers 1 to 12: a volume starts at 1, 3, 5, …
		expect(ticks.map((t) => t.fraction)).toEqual([0, 2 / 11, 4 / 11, 6 / 11, 8 / 11, 10 / 11]);
		expect(
			ticks.every((t) => t.labelShown),
			'far enough apart at 400px'
		).toBe(true);
		expect(volumeTicks([entry(1)], 400)).toEqual([]);
	});

	it('drops every other label under 28px of track, and keeps every hairline', () => {
		const entries = six();
		const ticks = volumeTicks(entries, 100);
		expect(ticks.map((t) => t.labelShown)).toEqual([true, false, true, false, true, false]);
		// The first is always drawn: there is nothing above it to crowd.
		expect(volumeTicks(entries, 0).map((t) => t.labelShown)).toEqual([
			true,
			false,
			false,
			false,
			false,
			false
		]);
		expect(
			volumeTicks(entries, 100, 0).every((t) => t.labelShown),
			'no floor, every label'
		).toBe(true);
	});

	it('names the volume an entry is in, and null when the series has one volume', () => {
		const entries = six();
		for (let v = 0; v < 6; v++)
			for (const e of entries.slice(v * 2, v * 2 + 2)) expect(volumeOf(entries, e)).toBe(v + 1);
		expect(volumeOf([entry(1), entry(2)], entry(1))).toBeNull();
	});
});

describe("a volume's ↓", () => {
	it('is true only when every entry of the volume is cached', () => {
		for (let n = 0; n <= 3; n++) {
			const ids = Array.from({ length: n }, (_, i) => 100 + i);
			for (let mask = 0; mask < 1 << n; mask++) {
				const cached = new Set(ids.filter((_, i) => mask & (1 << i)));
				expect({ n, mask, cached: volumeCached(ids, cached) }).toEqual({
					n,
					mask,
					cached: n > 0 && mask === (1 << n) - 1
				});
			}
		}
	});
});

import { describe, expect, it } from 'vitest';
import {
	DEVICE_KEYS,
	LIBRARY_KEYS,
	SECTIONS,
	VALUES,
	deviceKind,
	deviceLabel,
	deviceName,
	isChanged,
	movesLine,
	resetMoves,
	rowValues,
	scopeLabel,
	sectionChanged,
	sectionFor,
	valueLabel,
	type ValueId
} from '$lib/settings/catalog';
import {
	deviceValues,
	mergeStamped,
	newerIn,
	plain,
	readValue,
	writeValue
} from '$lib/settings/stamped';
import { audioLine, differ, inUse, overrideLine, subsLine, when } from '$lib/settings/lines';
import { DEFAULT_SETTINGS, TEXT_FONTS } from '$lib/reader/text';
import { modeLine } from '../src/routes/settings/mode-line';

const section = (id: string) => SECTIONS.find((s) => s.id === id)!;

describe('TYPEFACE (c442)', () => {
	it('allows exactly the text reader’s fonts, in its order, and defaults to its default', () => {
		const row = section('novels').rows.find((r) => r.id === 'typeface')!;
		const control = row.control as {
			type: 'seg';
			groups: { value: string; opts: { value: unknown }[] }[];
		};
		expect(control.groups[0].value).toBe('text.font');
		expect(control.groups[0].opts.map((o) => o.value)).toEqual(TEXT_FONTS.map((f) => f.id));
		expect(VALUES['text.font'].def).toBe(DEFAULT_SETTINGS.font);
	});
});

describe('the catalogue (card c171)', () => {
	it('has the eight sections in the handoff’s order, numbered', () => {
		expect(SECTIONS.map((s) => `${s.n} ${s.id}`)).toEqual([
			'01 images',
			'02 novels',
			'03 watching',
			'04 downloading',
			'05 library',
			'06 catalogues',
			'07 browse',
			'08 devices'
		]);
	});

	it('names every value a row sets, and every value is some row’s', () => {
		const used = new Set(SECTIONS.flatMap((s) => s.rows.flatMap(rowValues)));
		// Shown with no control: each is some info row's value, not a hand-kept list.
		const shown = new Set<string>(
			SECTIONS.flatMap((s) =>
				s.rows.flatMap((r) => (r.control.type === 'info' ? [r.control.value] : []))
			)
		);
		expect([...shown].filter((id) => id in VALUES).sort()).toEqual([
			'anime.dim',
			'anime.volume',
			'reader.dim'
		]);
		for (const id of Object.keys(VALUES))
			expect(used.has(id as ValueId) || shown.has(id)).toBe(true);
	});

	it('keeps the library’s keys apart from the device’s', () => {
		expect(LIBRARY_KEYS).toContain('anime_download_audio');
		expect(LIBRARY_KEYS).not.toContain('tsundoku.reader.fit');
		expect(DEVICE_KEYS).toContain('tsundoku.reader.fit');
		// The text reader's fields share one stored object.
		expect(DEVICE_KEYS.filter((k) => k === 'tsundoku.text.settings')).toHaveLength(1);
	});

	it('counts a value as changed only off its default, and unset as the default', () => {
		expect(isChanged('reader.fit', undefined)).toBe(false);
		expect(isChanged('reader.fit', 'screen')).toBe(false);
		expect(isChanged('reader.fit', 'height')).toBe(true);
		expect(isChanged('anime.quality', null)).toBe(false);
		expect(isChanged('anime.quality', 720)).toBe(true);
	});

	it('counts a section’s changed rows, a row once however many values it holds', () => {
		const v = { 'zoom.paged.wide': 1.25, 'zoom.vertical.wide': 1.5, 'reader.crop': true };
		expect(sectionChanged(section('images'), v)).toBe(2);
		expect(sectionChanged(section('novels'), v)).toBe(0);
	});

	it('says what RESET SECTION moved, in the band’s words', () => {
		const v = { 'zoom.paged.wide': 1.25, 'reader.crop': true, 'reader.sides': 20 };
		const moves = resetMoves(section('images').rows, v);
		expect(movesLine(moves)).toBe('ZOOM 125% → 100% · CROP BORDERS ON → OFF · SIDES 20% → NONE');
		// MODE's kinds are told apart.
		expect(movesLine(resetMoves(section('images').rows, { 'mode.manhwa': 'rtl' }))).toBe(
			'MODE MANHWA R→L → VERT.'
		);
	});

	it('labels values by their option, else by the value’s own way', () => {
		expect(valueLabel('anime.audio', '')).toBe('FOLLOW THE PLAYER');
		expect(valueLabel('text.size', 21)).toBe('21 PX');
		expect(valueLabel('text.size', undefined)).toBe("THE DEVICE'S");
		expect(valueLabel('reader.dim', 0.3)).toBe('30%');
	});

	it('finds the section /settings <word> names', () => {
		expect(sectionFor('watching')).toBe('watching');
		expect(sectionFor('Anime')).toBe('watching');
		expect(sectionFor('down')).toBe('downloading');
		expect(sectionFor('')).toBeNull();
		expect(sectionFor('nothing')).toBeNull();
	});

	it('says where a row applies, as the scope cell does', () => {
		const rows = Object.fromEntries(SECTIONS.flatMap((s) => s.rows).map((r) => [r.id, r]));
		expect(scopeLabel(rows['fit'], 'THIS TABLET')).toBe('THIS TABLET');
		expect(scopeLabel(rows['zoom'], 'THE DESKTOP')).toBe('THE DESKTOP · PER SCREEN');
		expect(scopeLabel(rows['mode'], 'THIS TABLET')).toBe('DEFAULT · EVERY DEVICE');
		expect(scopeLabel(rows['episodes-at'], 'THIS TABLET')).toBe('ALL DEVICES');
		expect(scopeLabel(rows['speed'], 'THIS TABLET')).toBe('EACH EPISODE');
	});

	it('names a device from its browser, and a TV from its user agent only', () => {
		expect(deviceKind({ width: 360, coarse: true })).toBe('phone');
		expect(deviceKind({ width: 800, coarse: true })).toBe('tablet');
		expect(deviceKind({ width: 1440, coarse: false })).toBe('desktop');
		// A wide page with no pointer is still a desktop: an unplugged mouse reads
		// the same. What makes a TV is the app's own user agent (doc/TV-APP.md).
		expect(deviceKind({ width: 960, coarse: false })).toBe('desktop');
		expect(
			deviceKind({
				width: 960,
				coarse: false,
				ua: 'Mozilla/5.0 (Linux; Android 9; BRAVIA 4K GB) Chrome/94.0 Safari/537.36 TsundokuTV/1.0.0'
			})
		).toBe('tv');
		expect(deviceName('tv', true)).toBe('THIS TV');
		expect(deviceName('tv', false)).toBe('THE TV');
		expect(
			deviceLabel(
				'Mozilla/5.0 (Linux; Android 14; SM-X710) AppleWebKit/537.36 Chrome/130.0 Safari/537.36',
				'tablet'
			)
		).toBe('Android tablet · Chrome');
		expect(deviceLabel('Mozilla/5.0 (X11; Linux x86_64; rv:131.0) Firefox/131.0', 'desktop')).toBe(
			'Linux desktop · Firefox'
		);
	});
});

describe('a device’s stamped settings', () => {
	it('takes the newer value key by key, and a tie keeps what was there', () => {
		const a = { x: { v: 1, at: 10 }, y: { v: 'a', at: 30 } };
		const b = { x: { v: 2, at: 20 }, y: { v: 'b', at: 30 }, z: { v: null, at: 5 } };
		expect(mergeStamped(a, b)).toEqual({
			x: { v: 2, at: 20 },
			y: { v: 'a', at: 30 },
			z: { v: null, at: 5 }
		});
		expect(newerIn(a, b)).toEqual({ x: { v: 2, at: 20 }, z: { v: null, at: 5 } });
		expect(plain(mergeStamped(a, b))).toEqual({ x: 2, y: 'a' });
	});

	it('reads and writes a field of the text reader’s one object, leaving the rest', () => {
		const store = { 'tsundoku.text.settings': { font: 'sans', size: 21 } };
		expect(readValue('text.size', store)).toBe(21);
		expect(readValue('text.justify', store)).toBeUndefined();
		expect(writeValue('text.size', store, 23)).toEqual({ font: 'sans', size: 23 });
		expect(writeValue('text.size', store, undefined)).toEqual({ font: 'sans' });
		expect(
			writeValue('text.font', { 'tsundoku.text.settings': { font: 'sans' } }, undefined)
		).toBeNull();
		expect(writeValue('reader.fit', {}, 'width')).toBe('width');
		expect(writeValue('reader.fit', {}, undefined)).toBeNull();
		expect(deviceValues(['text.size', 'reader.fit'], store)).toEqual({ 'text.size': 21 });
	});
});

describe('the page’s lines', () => {
	const NOW = new Date('2026-10-29T15:00:00').getTime();
	const H = 3600_000;

	it('says when a choice was made', () => {
		expect(when(NOW - 30_000, NOW)).toBe('JUST NOW');
		expect(when(NOW - 2 * H, NOW)).toBe('2 H AGO');
		expect(when(NOW - 20 * H, NOW)).toBe('YESTERDAY');
		expect(when(new Date('2026-10-12T10:00:00').getTime(), NOW)).toBe('12 OCT');
	});

	it('says what AUDIO starts in: the default, else what stands in, else the original', () => {
		expect(audioLine('JA', null, NOW)).toBe(
			'EVERY ANIME STARTS IN JAPANESE, UNLESS A SERIES DIFFERS'
		);
		expect(audioLine(undefined, { v: 'JA', title: "Hollin's Ferry", at: NOW - 20 * H }, NOW)).toBe(
			"NONE SET · THE PLAYER'S LAST CHOICE STANDS IN: JA, ON HOLLIN'S FERRY YESTERDAY · BEFORE ANY CHOICE, THE SOURCE'S ORIGINAL"
		);
		// A hidden series isn't named.
		expect(audioLine(undefined, { v: 'JA', title: null, at: NOW - 2 * H }, NOW)).toContain(
			'STANDS IN: JA 2 H AGO'
		);
		expect(audioLine(undefined, null, NOW)).toBe("NONE SET · THE SOURCE'S ORIGINAL PLAYS FIRST");
		// Named from the player's one table (c419), variants and all, not
		// from a list of ten that left PT-BR and HU as their codes.
		expect(audioLine('PT-BR', null, NOW)).toBe(
			'EVERY ANIME STARTS IN PORTUGUESE (BRAZIL), UNLESS A SERIES DIFFERS'
		);
		expect(audioLine('HU', null, NOW)).toBe(
			'EVERY ANIME STARTS IN HUNGARIAN, UNLESS A SERIES DIFFERS'
		);
	});

	it('says what SUBTITLES start in, with the size', () => {
		const last = { subs: { v: 'EN', title: null, at: 0 }, size: { v: 'M', title: null, at: 0 } };
		expect(subsLine({ subs: 'EN' }, last)).toBe('ENGLISH, AT M, UNLESS A SERIES DIFFERS');
		expect(subsLine({ subs: null }, last)).toBe('NO SUBTITLES, UNLESS A SERIES DIFFERS');
		expect(subsLine({ subs: 'ZH-HANT' }, last)).toBe(
			'CHINESE (TRADITIONAL), AT M, UNLESS A SERIES DIFFERS'
		);
		expect(subsLine({}, last)).toBe("NONE SET · THE PLAYER'S LAST CHOICE STANDS IN: EN, M");
		expect(subsLine({}, { subs: null, size: null })).toBe(
			"NONE SET · THE DEVICE'S LANGUAGE, WHERE THE SOURCE HAS IT"
		);
	});

	it('says what an override keeps, and counts them', () => {
		const at = new Date('2026-10-12T10:00:00').getTime();
		expect(overrideLine('audio', 'EN', at, NOW)).toBe('EN AUDIO · CHOSEN IN THE PLAYER, 12 OCT');
		expect(overrideLine('subs', null, at, NOW)).toBe(
			'SUBTITLES OFF · CHOSEN IN THE PLAYER, 12 OCT'
		);
		expect(differ(0)).toBe('');
		expect(differ(1)).toBe('1 SERIES DIFFERS →');
		expect(differ(14)).toBe('14 SERIES DIFFER →');
		expect(differ(3, 'BOOK')).toBe('3 BOOKS DIFFER →');
	});

	it('marks the zoom cells this screen uses', () => {
		expect(inUse('PAGED · WIDER', false)).toBe(true);
		expect(inUse('PAGED · PHONE', false)).toBe(false);
		expect(inUse('VERTICAL · PHONE', true)).toBe(true);
	});
});

describe('MODE’s and LAYOUT’s N SERIES DIFFER → list (2A)', () => {
	it('says what the series reads by, a novel kept R→L included, beside or without its layout (c552)', () => {
		// Every combination of the two things a series can differ by.
		expect(modeLine({ kind: 'manga', direction: 'ltr', rtl: false })).toBe(
			'L→R · MANGA · CHOSEN IN THE READER'
		);
		expect(modeLine({ kind: 'novel', direction: 'scroll', rtl: false })).toBe(
			'SCROLL · NOVEL · CHOSEN IN THE READER'
		);
		expect(modeLine({ kind: 'novel', direction: null, rtl: true })).toBe(
			'R→L · NOVEL · CHOSEN IN THE READER'
		);
		expect(modeLine({ kind: 'novel', direction: 'paged', rtl: true })).toBe(
			'PAGED · R→L · NOVEL · CHOSEN IN THE READER'
		);
		// A word the table lacks is said as it is stored.
		expect(modeLine({ kind: 'manhwa', direction: 'sideways', rtl: false })).toBe(
			'SIDEWAYS · MANHWA · CHOSEN IN THE READER'
		);
	});
});

import { describe, expect, it } from 'vitest';
import {
	DEVICE_KEYS,
	LIBRARY_KEYS,
	SECTIONS,
	VALUES,
	deviceKind,
	deviceLabel,
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

const section = (id: string) => SECTIONS.find((s) => s.id === id)!;

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
		const shown = new Set<string>(['reader.dim', 'anime.dim']);
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

	it('names a device from its screen and its browser', () => {
		expect(deviceKind({ width: 360, coarse: true })).toBe('phone');
		expect(deviceKind({ width: 800, coarse: true })).toBe('tablet');
		expect(deviceKind({ width: 1440, coarse: false })).toBe('desktop');
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

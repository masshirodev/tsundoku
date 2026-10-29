import { beforeEach, describe, expect, it } from 'vitest';

// Before anything imports db.ts: getDb() reads this once and memoises.
process.env.DATABASE_PATH = ':memory:';

const { getDb } = await import('$lib/server/db');
const { seedSample } = await import('$lib/server/fixtures');
const devices = await import('$lib/server/devices');
const choices = await import('$lib/server/anime/choices');
const page = await import('$lib/server/settings-page');
const { getSetting } = await import('$lib/server/settings');
const { kindDirection } = await import('$lib/server/series');

/**
 * The SETTINGS page's server side (doc/SETTINGS.md; card c171): devices'
 * settings kept here, the player's choices, the library's values and their
 * overrides.
 */

const db = getDb();
seedSample(db);

const A = '0f1e2d3c-4b5a-6978-8796-a5b4c3d2e1f0';
const B = '1a2b3c4d-5e6f-7081-92a3-b4c5d6e7f809';

const anime = (title: string) => {
	const root = (db.prepare(`SELECT id FROM roots WHERE hidden = 0 LIMIT 1`).get() as { id: number })
		.id;
	return Number(
		db
			.prepare(
				`INSERT INTO series (root_id, title, kind, added_at, origin_key) VALUES (?, ?, 'anime', 0, ?)`
			)
			.run(root, title, `aniyomi:1:/${title}`).lastInsertRowid
	);
};

describe('a device’s settings', () => {
	beforeEach(() => db.prepare(`DELETE FROM devices`).run());

	it('is written as it is the first time, and takes nothing back', () => {
		const r = devices.syncDevice(
			{
				id: A,
				kind: 'tablet',
				label: 'Android tablet · Chrome',
				settings: { 'tsundoku.reader.fit': { v: 'width', at: 10 } }
			},
			100
		);
		expect(r).toEqual({ newer: {}, created: true });
		expect(devices.device(A)).toMatchObject({ kind: 'tablet', seenAt: 100 });
	});

	it('keeps the newer of each key, and sends back what is newer here', () => {
		devices.syncDevice({ id: A, kind: 'tablet', label: 't', settings: {} }, 100);
		// Another device's page set FIT on this one (2C).
		expect(devices.setDeviceKey(A, 'tsundoku.reader.fit', 'height', 200)).toBe(true);
		const r = devices.syncDevice(
			{
				id: A,
				kind: 'tablet',
				label: 't',
				settings: {
					'tsundoku.reader.fit': { v: 'width', at: 150 },
					'tsundoku.reader.crop': { v: true, at: 300 }
				}
			},
			400
		);
		expect(r.newer).toEqual({ 'tsundoku.reader.fit': { v: 'height', at: 200 } });
		expect(devices.device(A)?.settings).toEqual({
			'tsundoku.reader.fit': { v: 'height', at: 200 },
			'tsundoku.reader.crop': { v: true, at: 300 }
		});
	});

	it('refuses keys no device keeps, an id that isn’t one, and a setting the size of a book', () => {
		expect(
			devices.cleanStamped({
				'tsundoku.reader.fit': { v: 'width', at: 1 },
				'tsundoku.session': { v: 'x', at: 1 },
				'tsundoku.reader.dim': { v: 'x'.repeat(5000), at: 1 },
				'tsundoku.reader.crop': { v: true }
			})
		).toEqual({ 'tsundoku.reader.fit': { v: 'width', at: 1 } });
		expect(() =>
			devices.syncDevice({ id: 'me', kind: 'tablet', label: '', settings: {} })
		).toThrow();
		expect(devices.setDeviceKey(A, 'tsundoku.reader.fit', 'width')).toBe(false);
	});

	it('starts a new device from another’s, stamped now so the browser takes it', () => {
		devices.syncDevice(
			{
				id: A,
				kind: 'desktop',
				label: 'd',
				settings: { 'tsundoku.reader.sides': { v: 20, at: 5 } }
			},
			10
		);
		devices.syncDevice({ id: B, kind: 'tablet', label: 't', settings: {} }, 20);
		expect(devices.startFrom(B, A, 30)).toBe(true);
		const r = devices.syncDevice({ id: B, kind: 'tablet', label: 't', settings: {} }, 40);
		expect(r.newer).toEqual({ 'tsundoku.reader.sides': { v: 20, at: 30 } });
		expect(devices.listDevices().map((d) => d.id)).toEqual([B, A]);
	});
});

describe('what the player starts an anime in', () => {
	const ferry = anime("Hollin's Ferry");
	const salt = anime('Salt and Lanterns');

	it('keeps a choice for the series and as the last on any anime', () => {
		choices.choose(ferry, 'audio', 'EN', 1000);
		choices.choose(ferry, 'subs', null, 1001);
		expect(choices.playerStart(ferry)).toEqual({
			series: { audio: 'EN', subs: null },
			defaults: {},
			last: { audio: 'EN', subs: null }
		});
		expect(choices.playerStart(salt).series).toEqual({});
		expect(choices.lastChoice('audio', false)).toEqual({
			v: 'EN',
			title: "Hollin's Ferry",
			at: 1000
		});
	});

	it('lists the series that differ: any with a choice while none is set, else those off it', () => {
		choices.choose(salt, 'audio', 'JA', 2000);
		expect(choices.overrides('audio', false).map((o) => [o.title, o.value])).toEqual([
			['Salt and Lanterns', 'JA'],
			["Hollin's Ferry", 'EN']
		]);
		choices.setDefault('audio', 'JA');
		expect(choices.overrides('audio', false).map((o) => o.title)).toEqual(["Hollin's Ferry"]);
		expect(choices.defaults()).toEqual({ audio: 'JA' });
		choices.setDefault('subs', null);
		expect(choices.defaults()).toEqual({ audio: 'JA', subs: null });
		choices.setDefault('audio', undefined);
		choices.setDefault('subs', undefined);
		expect(choices.defaults()).toEqual({});
	});

	it('puts a series back on the default, its subtitle size with its track', () => {
		choices.choose(ferry, 'subsize', 'L', 3000);
		choices.clearOverride('subs', [ferry]);
		expect(choices.playerStart(ferry).series).toEqual({ audio: 'EN' });
		choices.clearOverride('audio', [ferry, salt]);
		expect(db.prepare(`SELECT COUNT(*) AS n FROM series_player`).get()).toEqual({ n: 0 });
	});

	it('never names a hidden series while reveal is off, nor lists it', () => {
		db.prepare(`UPDATE series SET hidden = 1 WHERE id = ?`).run(ferry);
		choices.choose(ferry, 'audio', 'ES', 4000);
		expect(choices.lastChoice('audio', false)).toEqual({ v: 'ES', title: null, at: 4000 });
		expect(choices.overrides('audio', false)).toEqual([]);
		expect(choices.overrides('audio', true)).toHaveLength(1);
		db.prepare(`UPDATE series SET hidden = 0 WHERE id = ?`).run(ferry);
		choices.clearOverride('audio', [ferry]);
	});

	it('takes what a browser kept before, once, and never over a choice made here', () => {
		db.prepare(`DELETE FROM settings WHERE key = 'anime_last'`).run();
		choices.choose(salt, 'audio', 'JA', 5000);
		db.prepare(`DELETE FROM settings WHERE key = 'anime_last'`).run();
		const n = choices.adoptLegacy(
			{
				[`tsundoku:anime:${ferry}:audio`]: 'EN',
				[`tsundoku:anime:${ferry}:subs`]: null,
				[`tsundoku:anime:${salt}:audio`]: 'EN',
				'tsundoku:anime:audio': 'EN',
				'tsundoku:anime:dim': 0.2,
				[`tsundoku:anime:${ferry}:subsize`]: 'XL'
			},
			6000
		);
		expect(n).toBe(1);
		expect(choices.playerStart(ferry).series).toEqual({ audio: 'EN', subs: null });
		expect(choices.playerStart(salt).series).toEqual({ audio: 'JA' });
		expect(choices.playerStart(salt).last).toEqual({ audio: 'EN' });
	});
});

describe('the library’s values', () => {
	it('stores only what a row offers, and the default as a reset', () => {
		expect(page.setLibraryValue('mode.manhwa', 'sideways')).toBe(false);
		expect(page.setLibraryValue('mode.manhwa', 'rtl')).toBeUndefined();
		expect(page.libraryValues()['mode.manhwa']).toBe('rtl');
		expect(kindDirection('manhwa')).toBe('rtl');
		expect(page.setLibraryValue('mode.manhwa', 'vertical')).toBe('rtl');
		expect(page.libraryValues()['mode.manhwa']).toBeUndefined();
		expect(kindDirection('manhwa')).toBe('vertical');
	});

	it('keeps AUDIO KEPT as the languages beside the original, known ones only', () => {
		expect(page.setLibraryValue('dl.audio', 'EN,ES')).toBeUndefined();
		expect(getSetting('anime_download_audio')).toBe('EN,ES');
		expect(page.setLibraryValue('dl.audio', 'EN,XX')).toBe(false);
		expect(page.setLibraryValue('dl.audio', undefined)).toBe('EN,ES');
		expect(getSetting('anime_download_audio')).toBe('');
		expect(page.parseKept('en, ja,zz')).toEqual(['EN', 'JA']);
	});

	it('counts and lists the series reading against their kind, and puts them back', () => {
		const ids = (
			db.prepare(`SELECT id FROM series WHERE kind = 'manga' LIMIT 2`).all() as { id: number }[]
		).map((r) => r.id);
		db.prepare(`UPDATE series SET direction = 'ltr' WHERE id = ?`).run(ids[0]);
		// Its own direction, the same as the default: it doesn't differ.
		db.prepare(`UPDATE series SET direction = 'rtl' WHERE id = ?`).run(ids[1]);
		expect(page.overrideCounts(false).mode.manga).toBe(1);
		expect(page.modeOverrides(false).map((o) => o.seriesId)).toEqual([ids[0]]);
		page.clearModes([ids[0]]);
		expect(page.overrideCounts(false).mode.manga).toBe(0);
	});
});

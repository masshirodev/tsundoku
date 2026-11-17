import { beforeEach, describe, expect, it } from 'vitest';
import type { Kind } from '$lib/library/types';

// Before anything imports db.ts: getDb() reads this once and memoises.
process.env.DATABASE_PATH = ':memory:';

const { getDb } = await import('$lib/server/db');
const { seedSample } = await import('$lib/server/fixtures');
const devices = await import('$lib/server/devices');
const choices = await import('$lib/server/anime/choices');
const page = await import('$lib/server/settings-page');
const { clearSetting, getSetting, setSetting } = await import('$lib/server/settings');
const { kindDirection } = await import('$lib/server/series');
const textDir = await import('../src/routes/read/[entry]/text-direction.server');

/**
 * The SETTINGS page's server side (doc/SETTINGS.md): devices'
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
		devices.syncDevice({ id: A, kind: 'tablet', label: 't', settings: {}, register: true }, 100);
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
		devices.syncDevice({ id: B, kind: 'tablet', label: 't', settings: {}, register: true }, 20);
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
		// Every language unticked is the original alone, never '' (which keeps every track).
		expect(page.setLibraryValue('dl.audio', 'ORIGINAL')).toBe('EN,ES');
		expect(getSetting('anime_download_audio')).toBe('ORIGINAL');
		expect(page.setLibraryValue('dl.audio', 'EN,ES')).toBe('ORIGINAL');
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

	it('counts and lists a novel kept R→L, once beside its layout, and ✕ puts both back', () => {
		const novels = (
			db
				.prepare(
					`SELECT s.id FROM series s JOIN roots r ON r.id = s.root_id
					WHERE s.kind = 'novel' AND r.hidden = 0 ORDER BY s.id LIMIT 4`
				)
				.all() as { id: number }[]
		).map((r) => r.id);
		expect(novels).toHaveLength(4);
		const [rtl, both, ltr, storedLtr] = novels;
		const layoutDef = kindDirection('novel');
		const otherLayout = layoutDef === 'scroll' ? 'paged' : 'scroll';
		const before = page.overrideCounts(false).mode.novel ?? 0;
		expect(before).toBe(0);

		// The text reader's REMEMBER, as its DIRECTION row writes it.
		textDir.setTextDirection(rtl, 'rtl');
		textDir.setTextDirection(both, 'rtl');
		db.prepare(`UPDATE series SET direction = ? WHERE id = ?`).run(otherLayout, both);
		// REMEMBER on L→R stores 'ltr', which reads as the default does: nothing differs.
		textDir.setTextDirection(ltr, 'rtl');
		textDir.setTextDirection(ltr, 'ltr');
		// A stored 'ltr' (GROUP, TAKE OUT and the import's fold copy the column as
		// it is) reads as NULL does: not differing either.
		db.prepare(`UPDATE series SET text_direction = 'ltr' WHERE id = ?`).run(storedLtr);
		expect(textDir.textDirectionOf(storedLtr)).toBe('ltr');

		// Counted once each, the novel that differs twice included.
		expect(page.overrideCounts(false).mode.novel).toBe(2);
		const listed = page.modeOverrides(false).filter((o) => o.kind === 'novel');
		expect(listed.map((o) => [o.seriesId, o.direction, o.rtl]).sort()).toEqual(
			[
				[rtl, null, true],
				[both, otherLayout, true]
			].sort()
		);

		// ✕ on the one kept R→L alone: L→R again, and it differs no more.
		page.clearModes([rtl]);
		expect(textDir.textDirectionOf(rtl)).toBe('ltr');
		expect(page.overrideCounts(false).mode.novel).toBe(1);
		// CLEAR ALL: the other's layout and direction, both.
		page.clearModes(listed.map((o) => o.seriesId));
		expect(textDir.textDirectionOf(both)).toBe('ltr');
		expect(
			(db.prepare(`SELECT direction FROM series WHERE id = ?`).get(both) as { direction: unknown })
				.direction
		).toBeNull();
		expect(page.overrideCounts(false).mode.novel).toBe(0);
		expect(page.modeOverrides(false).filter((o) => o.kind === 'novel')).toEqual([]);
		db.prepare(`UPDATE series SET text_direction = NULL WHERE id = ?`).run(storedLtr);
	});

	it('leaves a comic’s text_direction alone: it is not what makes a comic differ, and not its ✕’s', () => {
		const id = (
			db
				.prepare(
					`SELECT s.id FROM series s JOIN roots r ON r.id = s.root_id
					WHERE s.kind = 'manga' AND r.hidden = 0 LIMIT 1`
				)
				.get() as { id: number }
		).id;
		// Left from a time it was a novel (EDIT's KIND keeps the column).
		db.prepare(`UPDATE series SET text_direction = 'rtl' WHERE id = ?`).run(id);
		expect(page.overrideCounts(false).mode.manga).toBe(0);
		expect(page.modeOverrides(false).map((o) => o.seriesId)).not.toContain(id);
		db.prepare(`UPDATE series SET direction = 'ltr' WHERE id = ?`).run(id);
		expect(page.modeOverrides(false).find((o) => o.seriesId === id)).toMatchObject({
			direction: 'ltr',
			rtl: false
		});
		page.clearModes([id]);
		expect(db.prepare(`SELECT direction, text_direction FROM series WHERE id = ?`).get(id)).toEqual(
			{ direction: null, text_direction: 'rtl' }
		);
		db.prepare(`UPDATE series SET text_direction = NULL WHERE id = ?`).run(id);
	});

	describe('✕ clears what the line names, and a novel’s page direction whichever way it was chosen', () => {
		const KIND_ROWS = ['manga', 'manhwa', 'doujin', 'novel'] as const;
		const visible = (kind: string) =>
			(
				db
					.prepare(
						`SELECT s.id FROM series s JOIN roots r ON r.id = s.root_id
						WHERE s.kind = ? AND r.hidden = 0 AND s.hidden = 0 ORDER BY s.id LIMIT 1`
					)
					.get(kind) as { id: number }
			).id;
		const put = db.prepare(`UPDATE series SET direction = ?, text_direction = ? WHERE id = ?`);
		const stored = (id: number) =>
			db.prepare(`SELECT direction, text_direction FROM series WHERE id = ?`).get(id);
		/** A direction of [kind]'s that is not its default, whatever the default is. */
		const other = (kind: Kind) => {
			const def = kindDirection(kind);
			if (kind === 'novel') return def === 'scroll' ? 'paged' : 'scroll';
			return def === 'rtl' ? 'ltr' : 'rtl';
		};

		// The whole domain, not a hand-picked row: each kind by each stored
		// direction by each stored text direction, read as the list reads them.
		for (const kind of KIND_ROWS)
			for (const layout of ['NULL', 'equal', 'different'] as const)
				for (const text of [null, 'rtl', 'ltr'] as const)
					it(`${kind}: direction ${layout}, text_direction ${text}`, () => {
						const id = visible(kind);
						const direction =
							layout === 'NULL' ? null : layout === 'equal' ? kindDirection(kind)! : other(kind);
						put.run(direction, text, id);
						try {
							const layoutDiffers = layout === 'different';
							const rtlDiffers = kind === 'novel' && text === 'rtl';
							const listed = layoutDiffers || rtlDiffers;
							const row = page.modeOverrides(false).find((o) => o.seriesId === id);
							expect(page.overrideCounts(false).mode[kind]).toBe(listed ? 1 : 0);
							if (listed) {
								expect(row).toMatchObject({
									direction: layoutDiffers ? direction : null,
									rtl: rtlDiffers
								});
							} else expect(row).toBeUndefined();

							page.clearModes([id]);
							expect(stored(id)).toEqual({
								direction: layoutDiffers ? null : direction,
								text_direction: kind === 'novel' ? null : text
							});
							// Whatever it held, it is off the list and out of the count now.
							expect(page.overrideCounts(false).mode[kind]).toBe(0);
							expect(page.modeOverrides(false).map((o) => o.seriesId)).not.toContain(id);
						} finally {
							put.run(null, null, id);
						}
					});

		it('a stored layout equal to the default survives ✕, and differs after a later default change', () => {
			const id = visible('novel');
			const def = kindDirection('novel')!;
			const next = other('novel');
			put.run(def, 'rtl', id);
			try {
				expect(page.modeOverrides(false).find((o) => o.seriesId === id)).toMatchObject({
					direction: null,
					rtl: true
				});
				page.clearModes([id]);
				expect(stored(id)).toEqual({ direction: def, text_direction: null });
				// The second ✕, from a page drawn before the first: nothing more to take.
				page.clearModes([id]);
				expect(stored(id)).toEqual({ direction: def, text_direction: null });

				// That was a choice, so it does not follow the default anywhere.
				setSetting('mode_novel', next);
				expect(page.overrideCounts(false).mode.novel).toBe(1);
				expect(page.modeOverrides(false).find((o) => o.seriesId === id)).toMatchObject({
					direction: def,
					rtl: false
				});
				page.clearModes([id]);
				expect(stored(id)).toEqual({ direction: null, text_direction: null });
			} finally {
				clearSetting('mode_novel');
				put.run(null, null, id);
			}
		});

		it('takes the default as it is when ✕ lands, not as the page drew it', () => {
			const id = visible('manga');
			put.run('ltr', null, id);
			try {
				expect(page.modeOverrides(false).map((o) => o.seriesId)).toContain(id);
				// Another tab made L→R the default after this page drew the line.
				setSetting('mode_manga', 'ltr');
				page.clearModes([id]);
				expect(stored(id)).toEqual({ direction: 'ltr', text_direction: null });
			} finally {
				clearSetting('mode_manga');
				put.run(null, null, id);
			}
		});

		it('leaves a kind with no MODE of its own alone, and an id that is gone', () => {
			const id = anime('A kind with no default');
			put.run('scroll', 'rtl', id);
			page.clearModes([id, 987654321]);
			expect(stored(id)).toEqual({ direction: 'scroll', text_direction: 'rtl' });
		});
	});

	it('counts a hidden novel kept R→L only while revealed', () => {
		const id = (
			db
				.prepare(
					`SELECT s.id FROM series s JOIN roots r ON r.id = s.root_id
					WHERE s.kind = 'novel' AND r.hidden = 0 AND s.hidden = 0 ORDER BY s.id DESC LIMIT 1`
				)
				.get() as { id: number }
		).id;
		// HIDE's own column: hidden means hidden, in SQL.
		db.prepare(`UPDATE series SET hidden = 1 WHERE id = ?`).run(id);
		textDir.setTextDirection(id, 'rtl');
		expect(page.overrideCounts(false).mode.novel).toBe(0);
		expect(page.modeOverrides(false).map((o) => o.seriesId)).not.toContain(id);
		expect(page.overrideCounts(true).mode.novel).toBe(1);
		expect(page.modeOverrides(true).map((o) => o.seriesId)).toContain(id);
		page.clearModes([id]);
		db.prepare(`UPDATE series SET hidden = 0 WHERE id = ?`).run(id);
		expect(page.overrideCounts(true).mode.novel).toBe(0);
	});
});

describe('which devices are kept', () => {
	const C = '2b3c4d5e-6f70-8192-a3b4-c5d6e7f80912';
	beforeEach(() => db.prepare(`DELETE FROM devices`).run());

	it('records nothing for a browser with nothing to keep, until it opens SETTINGS', () => {
		expect(devices.syncDevice({ id: C, kind: 'phone', label: 'p', settings: {} }, 100)).toEqual({
			newer: {},
			created: false
		});
		expect(devices.device(C)).toBeNull();
		expect(
			devices.syncDevice({ id: C, kind: 'phone', label: 'p', settings: {}, register: true }, 200)
				.created
		).toBe(true);
	});

	it('forgets a device not seen for 180 days', () => {
		devices.syncDevice({ id: C, kind: 'phone', label: 'p', settings: {}, register: true }, 1000);
		devices.syncDevice(
			{ id: A, kind: 'tablet', label: 't', settings: {}, register: true },
			1000 + devices.FORGET_MS + 1
		);
		expect(devices.device(C)).toBeNull();
		expect(devices.device(A)).not.toBeNull();
	});
});

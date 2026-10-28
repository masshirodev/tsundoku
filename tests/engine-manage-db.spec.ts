import { afterAll, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import type { PlannedSeries } from '$lib/import/plan';

// Before anything imports db.ts: getDb() reads this once and memoises.
process.env.DATABASE_PATH = ':memory:';
const store = mkdtempSync(join(tmpdir(), 'tsundoku-manage-store-'));
process.env.ENGINE_STORE = store;

const { getDb } = await import('$lib/server/db');
const { ensureRoot, writeSeries } = await import('$lib/server/import/write');
const { forgetSourceUse } = await import('$lib/server/library-sources');
const { setSetting } = await import('$lib/server/settings');
const manage = await import('$lib/server/engine/manage');

// EXTENSIONS on the engine (doc/BROWSE.md; card c144).

afterAll(() => rmSync(store, { recursive: true, force: true }));

const db = getDb();
const now = 1_800_000_000_000;
const root = ensureRoot(db, 'Mihon', '/nowhere/Mihon', false);
const series = (sourceId: string, url: string, hidden = false, followed = false): number => {
	const p: PlannedSeries = {
		originKey: `mihon:${sourceId}:${url}`,
		source: 'mihon',
		title: url,
		kind: 'manga',
		rating: 0,
		favourite: false,
		hidden,
		shelves: [],
		tags: [],
		description: '',
		status: '',
		direction: null,
		addedAt: now,
		sourceUrl: url,
		path: '',
		entries: [
			{
				position: 1,
				label: 'Ch. 1',
				title: '',
				sourceUrl: `${url}/1`,
				scanlator: '',
				available: false,
				file: '',
				bytes: 0,
				pageCount: 0,
				addedAt: now,
				readAt: null,
				lastPosition: null,
				lastOpenedAt: null,
				history: null
			}
		]
	};
	writeSeries(p, { rootId: root, jobId: null, now, markMissing: false }, db);
	const id = (
		db.prepare(`SELECT id FROM series WHERE origin_key = ?`).get(p.originKey) as { id: number }
	).id;
	if (followed) db.prepare(`UPDATE series SET followed_at = ? WHERE id = ?`).run(now, id);
	return id;
};

const ext = (
	pkg: string,
	name: string,
	o: { failed?: string; previous?: string; until?: number; code?: number } = {}
) =>
	db
		.prepare(
			`INSERT INTO engine_extensions (pkg, repo_id, name, kind, version_code, version_name, lib, handle, previous_handle, previous_version, previous_until, installed_at, updated_at, failed)
			VALUES (?, 1, ?, 'manga', ?, '1.0', '1.4', ?, ?, ?, ?, 0, 0, ?)`
		)
		.run(
			pkg,
			name,
			o.code ?? 1,
			pkg.padEnd(64, '0'),
			o.previous ? 'p'.repeat(64) : null,
			o.previous ?? null,
			o.until ?? null,
			o.failed ?? ''
		);
const src = (id: string, pkg: string, name: string, lang = 'en') =>
	db
		.prepare(`INSERT INTO engine_sources (id, pkg, name, lang, base_url) VALUES (?, ?, ?, ?, '')`)
		.run(id, pkg, name, lang);
const listing = (
	pkg: string,
	name: string,
	code: number,
	o: { adult?: boolean; langs?: string[] } = {}
) =>
	db.prepare(`INSERT INTO engine_listings (repo_id, pkg, listing) VALUES (1, ?, ?)`).run(
		pkg,
		JSON.stringify({
			pkg,
			name,
			kind: 'manga',
			versionCode: code,
			versionName: `${code}.0`,
			lib: '1.4',
			adult: o.adult ?? false,
			apkUrl: '',
			jarUrl: null,
			iconUrl: null,
			sources: (o.langs ?? ['en']).map((lang, i) => ({
				id: `${pkg}-${i}`,
				name,
				lang,
				baseUrl: ''
			}))
		})
	);

db.prepare(
	`INSERT INTO engine_repos (id, base, name, fingerprint, added_at) VALUES (1, 'https://r/', 'Repo', 'f', 0)`
).run();
// Up to date; an update waiting; one that failed to load; one gone from its repository;
// one whose every source is mostly hidden here; one updated today, with BACK TO.
ext('a.current', 'Current');
src('10', 'a.current', 'Current');
listing('a.current', 'Current', 1);
ext('b.update', 'Updatable');
src('20', 'b.update', 'Updatable');
listing('b.update', 'Updatable', 2);
ext('c.failed', 'Broken', { failed: 'protobuf' });
listing('c.failed', 'Broken', 1);
ext('d.gone', 'Gone');
src('40', 'd.gone', 'Gone');
ext('e.hidden', 'Hidden', { code: 1 });
src('50', 'e.hidden', 'Hidden');
listing('e.hidden', 'Hidden', 2, { adult: true });
ext('f.recent', 'Recent', { previous: '0.9', until: now + 1000 });
src('60', 'f.recent', 'Recent');
listing('f.recent', 'Recent', 1);
// Available, not installed: English, Japanese, French only, adult.
listing('g.en', 'English One', 1);
listing('h.ja', 'Japanese One', 1, { langs: ['ja'] });
listing('i.fr', 'French One', 1, { langs: ['fr'] });
listing('j.adult', 'Adult One', 1, { adult: true });
listing('k.multi', 'Many Languages', 1, { langs: ['en', 'fr', 'de'] });

const s20 = series('20', '/u1', false, true);
series('20', '/u2', true);
series('50', '/h1', true);
series('50', '/h2', true);
db.prepare(
	`INSERT INTO download_queue (entry_id, series_id, position, queued_at) SELECT id, series_id, 1, 0 FROM entries WHERE series_id = ?`
).run(s20);
forgetSourceUse();

describe('the installed list', () => {
	it('puts what needs a hand first, then updates, then the rest; BACK TO only within its week', () => {
		const v = manage.installedView(false, now);
		expect(v.needsHand.map((r) => [r.name, r.failed, r.obsolete])).toEqual([
			['Broken', 'protobuf', false],
			['Gone', '', true]
		]);
		expect(v.updates.map((r) => [r.name, r.update, r.series])).toEqual([['Updatable', '2.0', 1]]);
		expect(v.current.map((r) => [r.name, r.backTo])).toEqual([
			['Current', null],
			['Recent', '0.9']
		]);
		expect(
			manage.installedView(false, now + 2000).current.find((r) => r.name === 'Recent')!.backTo
		).toBeNull();
	});

	it('lists an extension whose every source is mostly hidden only inside reveal', () => {
		expect(manage.installedView(false, now).updates.map((r) => r.name)).not.toContain('Hidden');
		const inReveal = manage.installedView(true, now).updates.find((r) => r.name === 'Hidden')!;
		expect([inReveal.mostlyHidden, inReveal.series, inReveal.hidden]).toEqual([true, 2, 2]);
	});
});

describe('the available list', () => {
	it('opens in the owner’s languages, says how many are in others, and ALL widens it', () => {
		setSetting('browse_languages', 'en,ja');
		const v = manage.availableView({ kind: 'manga', reveal: false });
		expect(v.rows.map((r) => r.name)).toEqual([
			'Broken',
			'Current',
			'English One',
			'Japanese One',
			'Many Languages',
			'Recent',
			'Updatable'
		]);
		expect(v.otherLanguages).toBe(1);
		// A multi-language extension counts only the sources in those languages.
		expect(v.rows.find((r) => r.name === 'Many Languages')!.sourcesShown).toBe(1);
		const all = manage.availableView({ kind: 'manga', all: true, reveal: false });
		expect(all.rows.map((r) => r.name)).toContain('French One');
		expect(all.otherLanguages).toBe(0);
	});

	it('leaves adult extensions out of the list and the counts with reveal off', () => {
		const off = manage.availableView({ kind: 'manga', all: true, reveal: false });
		expect(off.rows.map((r) => r.name)).not.toContain('Adult One');
		expect(off.counts.manga).toBe(off.rows.length);
		const on = manage.availableView({ kind: 'manga', all: true, reveal: true, adult: 'only' });
		expect(on.rows.map((r) => r.name)).toEqual(['Adult One', 'Hidden']);
	});

	it('searches by name and marks what’s installed', () => {
		const v = manage.availableView({ kind: 'manga', q: 'one', reveal: false });
		expect(v.rows.map((r) => [r.name, r.installed])).toEqual([
			['English One', false],
			['Japanese One', false]
		]);
	});
});

describe('removing an extension', () => {
	it('says what stays and what stops, counting only what may be seen', () => {
		expect(manage.removal('b.update', false)).toEqual({
			name: 'Updatable',
			version: '1.0',
			sources: 1,
			series: 1,
			queued: 1,
			followed: 1
		});
		expect(manage.removal('b.update', true)!.series).toBe(2);
		expect(manage.removal('nope', false)).toBeNull();
	});

	it('takes its chapters out of the queue and leaves the series', () => {
		manage.removeExtension('b.update');
		expect(db.prepare(`SELECT COUNT(*) AS n FROM download_queue`).get()).toEqual({ n: 0 });
		expect(db.prepare(`SELECT COUNT(*) AS n FROM series WHERE id = ?`).get(s20)).toEqual({ n: 1 });
		expect(
			db.prepare(`SELECT COUNT(*) AS n FROM engine_extensions WHERE pkg = 'b.update'`).get()
		).toEqual({ n: 0 });
	});
});

describe('TRY AGAIN', () => {
	it('loads the kept APK again, clearing the failure and naming its sources', async () => {
		mkdirSync(store, { recursive: true });
		writeFileSync(join(store, `${'c.failed'.padEnd(64, '0')}.apk`), Buffer.from('apk'));
		const ok = await manage.loadAgain('c.failed', async () => ({
			info: {
				name: 'Broken',
				versionName: '1.0',
				versionCode: 1,
				sources: [{ id: 70, name: 'Broken', lang: 'en' }]
			}
		}));
		expect(ok).toBe(true);
		expect(db.prepare(`SELECT failed FROM engine_extensions WHERE pkg = 'c.failed'`).get()).toEqual(
			{ failed: '' }
		);
		expect(db.prepare(`SELECT id FROM engine_sources WHERE pkg = 'c.failed'`).all()).toEqual([
			{ id: '70' }
		]);
	});

	it('keeps the new reason when it fails again, and is false without an APK', async () => {
		expect(
			await manage.loadAgain('c.failed', async () => {
				throw new Error('still protobuf');
			})
		).toBe(false);
		expect(db.prepare(`SELECT failed FROM engine_extensions WHERE pkg = 'c.failed'`).get()).toEqual(
			{
				failed: 'still protobuf'
			}
		);
		expect(
			await manage.loadAgain('a.current', async () => ({
				info: { name: '', versionName: '', versionCode: 0, sources: [] }
			}))
		).toBe(false);
	});
});

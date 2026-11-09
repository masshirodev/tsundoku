import { beforeEach, describe, expect, it, vi } from 'vitest';
import type Database from 'better-sqlite3';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

// Before anything imports db.ts: getDb() reads this once and memoises.
process.env.DATABASE_PATH = ':memory:';
process.env.ENGINE_URL = 'http://127.0.0.1:1';
process.env.ENGINE_TOKEN = 'extensions-select';
// BACK TO keeps the previous APK under this store; keep it in the worktree's
// scratch, never the owner's data folder.
process.env.ENGINE_STORE = join(process.cwd(), 'temp', 'extensions-select-store');
mkdirSync(process.env.ENGINE_STORE, { recursive: true });

/**
 * UPDATE's installs, controlled: the real one fetches an APK, which no unit
 * test can do. It answers the shapes the real one does — return when installed,
 * throw `UntrustedError` for a key that does not match, throw otherwise when
 * the repository does not answer.
 */
const installs = vi.hoisted(() => ({
	fail: new Set<string>(),
	untrusted: new Set<string>(),
	calls: [] as string[]
}));
vi.mock('$lib/server/engine/extensions', async (original) => {
	const mod = await original<typeof import('../src/lib/server/engine/extensions')>();
	return {
		...mod,
		install: async (pkg: string) => {
			installs.calls.push(pkg);
			if (installs.untrusted.has(pkg)) throw new mod.UntrustedError('signed by another key');
			if (installs.fail.has(pkg)) throw new Error('its repository did not answer');
		}
	};
});

const { getDb } = await import('$lib/server/db');
const flags = await import('$lib/server/engine/source-flags');
const band = await import('../src/routes/browse/extensions/select.server');

/**
 * EXTENSIONS' SELECT (card c696): setting one of tsundoku's switches on every
 * source of the ticked extensions, in one transaction, with the facts UNDO
 * needs. The press's rule is the owner's decision of 2026-11-08: a row is a
 * package, the switch is per source id, so a press changes every source of the
 * extension, including a language BROWSE does not list.
 */

const db = getDb();

/** Three sources with a mixed past: only the middle one has the switch on. */
const IDS = ['100', '200', '300'] as const;

db.exec(`INSERT INTO engine_repos (id, base, name, fingerprint, added_at) VALUES (1, 'https://r/', 'Repo', 'f', 0);
	INSERT INTO novel_repos (id, url, name, added_at) VALUES (1, 'https://n/plugins.min.json', 'Plugins', 0);`);

const extension = (pkg: string, sources: { id: string; lang: string }[], failed = '') => {
	db.prepare(
		`INSERT INTO engine_extensions (pkg, repo_id, name, kind, version_code, version_name, lib, handle, installed_at, updated_at, failed)
		VALUES (?, 1, ?, 'manga', 1, '1.0', '1.4', ?, 0, 0, ?)`
	).run(pkg, pkg, pkg.padEnd(64, '0'), failed);
	for (const s of sources)
		db.prepare(
			`INSERT INTO engine_sources (id, pkg, name, lang, base_url) VALUES (?, ?, ?, ?, 'https://example.org')`
		).run(s.id, pkg, pkg, s.lang);
};
const plugin = (id: string, failed = '') =>
	db
		.prepare(
			`INSERT INTO novel_plugins (id, repo_id, name, site, lang, version, hash, installed_at, updated_at, failed)
			VALUES (?, 1, ?, 'https://novel.example/', 'en', '1.0.0', 'h', 0, 0, ?)`
		)
		.run(id, id, failed);

// A two-language extension, a plugin, and one extension whose sources are not
// known: the states the band must count and must not call a success.
extension('en.multi', [
	{ id: '500', lang: 'en' },
	{ id: '501', lang: 'fr' }
]);
extension('en.none', []);
plugin('good');

const extras = ['500', '501', 'ln:good'] as const;

beforeEach(() => {
	for (const id of [...IDS, ...extras])
		for (const f of flags.SOURCE_FLAGS) flags.setSourceFlag(id, f, false);
	flags.setSourceFlag('200', 'offHistory', true);
	flags.setSourceFlag('500', 'offHistory', true);
	installs.fail.clear();
	installs.untrusted.clear();
	installs.calls.length = 0;
});

const extensionsPage = await import('../src/routes/browse/extensions/+page.server');

/** The page's own load, at a band's Location: what a user meets after its redirect. */
async function loadAt(location: string, reveal = false) {
	const url = new URL(location, 'http://localhost');
	return (await extensionsPage.load({
		url,
		cookies: { get: (n: string) => (reveal && n === 'tsundoku_reveal' ? '1' : undefined) }
	} as never)) as unknown as {
		removeBand: { done: string[]; stayed: string[] };
		updateBand: { done: string[]; failed: string[]; untrusted: string[]; of: number };
		backBand: { done: string[] };
		band: {
			miss: string[];
			gone: string[];
			facts: { sourceId: string; previous: boolean }[];
		};
		drawn: string[];
		packageFlags: Record<string, { total: number; on: Record<string, number> }>;
	};
}

/** Run one of the page's actions with a form, and answer its redirect (or its failure). */
async function act(
	name: 'flags' | 'undoFlags' | 'updateSome' | 'undoUpdate' | 'removeSome',
	fields: Record<string, string | string[]>,
	reveal = false
): Promise<{ status: number; location?: string; data?: Record<string, unknown> }> {
	const form = new FormData();
	for (const [key, value] of Object.entries(fields))
		for (const v of Array.isArray(value) ? value : [value]) form.append(key, v);
	try {
		const answer = (await extensionsPage.actions[name]({
			request: new Request('http://localhost/browse/extensions', { method: 'POST', body: form }),
			cookies: { get: (n: string) => (reveal && n === 'tsundoku_reveal' ? '1' : undefined) }
		} as never)) as { status?: number; data?: Record<string, unknown> };
		return { status: answer.status ?? 200, data: answer.data };
	} catch (e) {
		const redirect = e as { status?: number; location?: string };
		if (redirect.status === 303) return { status: 303, location: redirect.location };
		return { status: redirect.status ?? 500, data: e as never };
	}
}

describe('one switch on many sources (card c696)', () => {
	it('sets them all in one press and answers what each was before it', () => {
		const facts = flags.setSourceFlags(IDS, 'offHistory', true);
		expect(facts).toEqual([
			{ sourceId: '100', previous: false },
			{ sourceId: '200', previous: true },
			{ sourceId: '300', previous: false }
		]);
		expect(IDS.map((id) => flags.sourceFlags(id).offHistory)).toEqual([true, true, true]);
		// Every other switch is untouched.
		expect(IDS.map((id) => flags.sourceFlags(id).neverTracked)).toEqual([false, false, false]);
	});

	it('undo puts each source back as it was: a mixed press comes back mixed', () => {
		const facts = flags.setSourceFlags(IDS, 'offHistory', true);
		flags.setSourceFlagValues(
			'offHistory',
			facts.map((f) => ({ sourceId: f.sourceId, on: f.previous }))
		);
		// The source already on stays on; the others go back off.
		expect(IDS.map((id) => flags.sourceFlags(id).offHistory)).toEqual([false, true, false]);
	});

	it('turns them all off, and an undo restores the one that was on', () => {
		const facts = flags.setSourceFlags(IDS, 'offHistory', false);
		expect(IDS.map((id) => flags.sourceFlags(id).offHistory)).toEqual([false, false, false]);
		expect(facts.find((f) => f.sourceId === '200')?.previous).toBe(true);
		flags.setSourceFlagValues(
			'offHistory',
			facts.filter((f) => f.previous).map((f) => ({ sourceId: f.sourceId, on: true }))
		);
		expect(IDS.map((id) => flags.sourceFlags(id).offHistory)).toEqual([false, true, false]);
	});

	it('is one write: a failure part-way leaves nothing changed', () => {
		let writes = 0;
		// A database that fails its second write, inside the transaction.
		const failing = new Proxy(db, {
			get(target, prop) {
				if (prop === 'prepare') {
					return (sql: string) => {
						const stmt = target.prepare(sql);
						if (!/^(INSERT|DELETE)/i.test(sql)) return stmt;
						return new Proxy(stmt, {
							get(s, p) {
								if (p === 'run')
									return (...args: unknown[]) => {
										if (++writes === 2) throw new Error('the second write failed');
										return (s.run as (...a: unknown[]) => unknown)(...args);
									};
								const v = (s as unknown as Record<string | symbol, unknown>)[p];
								return typeof v === 'function' ? (v as (...a: unknown[]) => unknown).bind(s) : v;
							}
						});
					};
				}
				const v = (target as unknown as Record<string | symbol, unknown>)[prop];
				return typeof v === 'function' ? (v as (...a: unknown[]) => unknown).bind(target) : v;
			}
		}) as Database.Database;
		expect(() => flags.setSourceFlags(IDS, 'neverTracked', true, failing)).toThrow(
			'the second write failed'
		);
		// Rolled back with the transaction: the first source was not left on.
		expect(IDS.map((id) => flags.sourceFlags(id).neverTracked)).toEqual([false, false, false]);
	});

	it('reads many sources’ switches in a map, all off for an id nothing was set on', () => {
		const all = flags.sourceFlagsOf([...IDS, '999']);
		expect(all.get('200')?.offHistory).toBe(true);
		expect(all.get('100')?.offHistory).toBe(false);
		expect(all.get('999')).toEqual({
			hidden: false,
			addedHidden: false,
			offHistory: false,
			neverTracked: false
		});
		expect(all.size).toBe(4);
	});

	it('sets a plugin’s own source, which is its one id', () => {
		const facts = flags.setSourceFlags(['ln:plugin'], 'hidden', true);
		expect(facts).toEqual([{ sourceId: 'ln:plugin', previous: false }]);
		expect(flags.sourceFlags('ln:plugin').hidden).toBe(true);
	});
});

describe('SELECT’s press (card c696)', () => {
	it('changes every source of the extension, including a language BROWSE does not list', async () => {
		const r = await act('flags', { pkg: 'en.multi', flag: 'offHistory', value: 'true' });
		expect(r.status).toBe(303);
		const u = new URL(r.location!, 'http://localhost');
		// The fr source is not in the owner's languages (en, ja), so BROWSE never
		// draws it; the press follows the extension, not the list.
		expect(flags.sourceFlags('500').offHistory).toBe(true);
		expect(flags.sourceFlags('501').offHistory).toBe(true);
		// The band keeps the selection, and its facts hold each source's value before it.
		expect(u.searchParams.get('select')).toBe('1');
		expect(u.searchParams.getAll('pkg')).toEqual(['en.multi']);
		expect(u.searchParams.get('band')).toBe('flags');
		expect(u.searchParams.get('flag')).toBe('offHistory');
		expect(u.searchParams.get('to')).toBe('1');
		expect(u.searchParams.get('from')).toBe('500|1,501|0');
		expect(u.searchParams.get('of')).toBe('1');
		expect(u.searchParams.get('chg')).toBe('1');
	});

	it('undo puts every source back as it was: the one already on stays on', async () => {
		const press = await act('flags', { pkg: 'en.multi', flag: 'offHistory', value: 'true' });
		const from = new URL(press.location!, 'http://localhost').searchParams.get('from')!;
		expect(flags.sourceFlags('501').offHistory).toBe(true);
		const undo = await act('undoFlags', { pkg: 'en.multi', flag: 'offHistory', to: '1', from });
		expect(undo.status).toBe(303);
		expect(flags.sourceFlags('500').offHistory).toBe(true);
		expect(flags.sourceFlags('501').offHistory).toBe(false);
		// The selection comes back, so SELECT stays on with the rows it had.
		expect(new URL(undo.location!, 'http://localhost').searchParams.getAll('pkg')).toEqual([
			'en.multi'
		]);
	});

	it('refuses an undo whole when a source was changed since on its own page', async () => {
		await act('flags', { pkg: 'en.multi', flag: 'offHistory', value: 'true' });
		// The settings page wrote one source between the press and UNDO.
		flags.setSourceFlag('501', 'offHistory', false);
		const undo = await act('undoFlags', {
			pkg: 'en.multi',
			flag: 'offHistory',
			to: '1',
			from: '500|1,501|0'
		});
		expect(undo.status).toBe(409);
		// Whole or not at all: the source that still matched was not taken back either.
		expect(flags.sourceFlags('500').offHistory).toBe(true);
		expect(flags.sourceFlags('501').offHistory).toBe(false);
	});

	it('acts on a plugin’s one source, which is its own id', async () => {
		const r = await act('flags', { pkg: 'ln:good', flag: 'neverTracked', value: 'true' });
		expect(r.status).toBe(303);
		expect(flags.sourceFlags('ln:good').neverTracked).toBe(true);
		expect(flags.sourceFlags('ln:good').offHistory).toBe(false);
		const u = new URL(r.location!, 'http://localhost');
		expect(u.searchParams.get('from')).toBe('ln:good|0');
		expect(u.searchParams.get('of')).toBe('1');
	});

	it('does not call a failed extension a success: its sources are not known', async () => {
		const r = await act('flags', { pkg: 'en.none', flag: 'addedHidden', value: 'true' });
		expect(r.status).toBe(303);
		const u = new URL(r.location!, 'http://localhost');
		expect(u.searchParams.get('miss')).toBe('en.none');
		expect(u.searchParams.get('chg')).toBe('0');
		expect(u.searchParams.get('of')).toBe('1');
	});

	it('does not call a package removed elsewhere a success, and drops it from the selection', async () => {
		const r = await act('flags', { pkg: 'gone.pkg', flag: 'hidden', value: 'true' });
		const u = new URL(r.location!, 'http://localhost');
		expect(u.searchParams.get('gone')).toBe('gone.pkg');
		expect(u.searchParams.get('chg')).toBe('0');
		expect(u.searchParams.getAll('pkg')).toEqual([]);
	});

	it('hides a source outside reveal, and its package leaves the selection', async () => {
		const r = await act('flags', { pkg: 'en.multi', flag: 'hidden', value: 'true' });
		const u = new URL(r.location!, 'http://localhost');
		expect(flags.sourceFlags('500').hidden).toBe(true);
		expect(flags.sourceFlags('501').hidden).toBe(true);
		// Hidden means hidden: outside reveal the package is no longer drawn.
		expect(u.searchParams.getAll('pkg')).toEqual([]);
	});

	it('turns a switch off, and its facts hold the one source that was on', async () => {
		const r = await act('flags', { pkg: 'en.multi', flag: 'offHistory', value: 'false' });
		expect(r.status).toBe(303);
		expect(flags.sourceFlags('500').offHistory).toBe(false);
		expect(flags.sourceFlags('501').offHistory).toBe(false);
		expect(new URL(r.location!, 'http://localhost').searchParams.get('from')).toBe('500|1,501|0');
	});
});

describe('SELECT’s UPDATE and REMOVE (card c696)', () => {
	it('refuses UPDATE when nothing ticked has one', async () => {
		const r = await act('updateSome', { pkg: ['en.multi', 'en.none'] });
		expect(r.status).toBe(409);
		expect(r.data?.message).toBe('NOTHING TICKED HAS AN UPDATE');
	});

	it('refuses a bulk BACK TO when the version before is no longer kept', async () => {
		const r = await act('undoUpdate', { pkg: 'en.multi' });
		expect(r.status).toBe(409);
	});

	it('removes the listed extensions and leaves an OBSOLETE one installed, with no undo', async () => {
		// What a repository lists: en.multi is not obsolete; en.none has no listing.
		db.prepare(`INSERT INTO engine_listings (repo_id, pkg, listing) VALUES (1, ?, ?)`).run(
			'en.multi',
			JSON.stringify({
				pkg: 'en.multi',
				name: 'en.multi',
				kind: 'manga',
				versionCode: 1,
				versionName: '1.0',
				lib: '1.4',
				adult: false,
				apkUrl: '',
				jarUrl: null,
				iconUrl: null,
				sources: [{ id: '500', name: 'en.multi', lang: 'en', baseUrl: '' }]
			})
		);
		const r = await act('removeSome', { pkg: ['en.multi', 'en.none'] });
		expect(r.status).toBe(303);
		const u = new URL(r.location!, 'http://localhost');
		expect(u.searchParams.get('band')).toBe('remove');
		expect(u.searchParams.get('done')).toBe('en.multi');
		// The obsolete one stays: no repository lists it any more, so it could not
		// be installed again, and REMOVE has no UNDO to bring it back.
		expect(u.searchParams.get('stayed')).toBe('en.none');
		const installed = db.prepare(`SELECT pkg FROM engine_extensions ORDER BY pkg`).all() as {
			pkg: string;
		}[];
		expect(installed.map((x) => x.pkg)).toEqual(['en.none']);
		// Its settings outlive it, as REMOVE's sheet says (c569): the switch this
		// file's beforeEach set on source 500 is still there.
		expect(
			db.prepare(`SELECT COUNT(*) AS n FROM settings WHERE key LIKE 'source.%:500'`).get()
		).toEqual({ n: 1 });
	});
});

/** The rows a new case adds, taken out again so the file's shared database holds what it did. */
const dropPackages = (...pkgs: string[]) => {
	for (const pkg of pkgs) {
		db.prepare(`DELETE FROM engine_extensions WHERE pkg = ?`).run(pkg);
		db.prepare(`DELETE FROM engine_sources WHERE pkg = ?`).run(pkg);
		db.prepare(`DELETE FROM engine_listings WHERE pkg = ?`).run(pkg);
		db.prepare(`DELETE FROM novel_plugins WHERE id = ?`).run(pkg.replace(/^ln:/, ''));
	}
};

/** A repository's listing for [pkg] at [versionCode]: what makes it installed, and updatable. */
const listAt = (pkg: string, versionCode: number) =>
	db.prepare(`INSERT INTO engine_listings (repo_id, pkg, listing) VALUES (1, ?, ?)`).run(
		pkg,
		JSON.stringify({
			pkg,
			name: pkg,
			kind: 'manga',
			versionCode,
			versionName: `${versionCode}.0`,
			lib: '1.4',
			adult: false,
			apkUrl: '',
			jarUrl: null,
			iconUrl: null,
			sources: [{ id: `s-${pkg}`, name: pkg, lang: 'en', baseUrl: '' }]
		})
	);

/**
 * Round 2: a band keeps every row of every list. `bandQuery` writes `done=a&
 * done=b` (a repeated parameter), so a reader taking `.get()` kept the first
 * and dropped the rest: `UPDATED · 1 OF 3` on three, an UNDO that put one back.
 * Every case here takes at least two rows through the action and then the real
 * load, which is what a user meets after the 303.
 */
describe('a band keeps every row of its lists (card c696, round 2)', () => {
	it('REMOVE reports two removed and two that stayed, through the real load', async () => {
		for (const [pkg, id] of [
			['x.listed1', '611'],
			['x.listed2', '612']
		] as const) {
			extension(pkg, [{ id, lang: 'en' }]);
			listAt(pkg, 1);
		}
		for (const [pkg, id] of [
			['x.old1', '613'],
			['x.old2', '614']
		] as const)
			extension(pkg, [{ id, lang: 'en' }]);
		const r = await act('removeSome', { pkg: ['x.listed1', 'x.listed2', 'x.old1', 'x.old2'] });
		expect(r.status).toBe(303);
		const out = await loadAt(r.location!);
		expect(out.removeBand.done).toEqual(['x.listed1', 'x.listed2']);
		expect(out.removeBand.stayed).toEqual(['x.old1', 'x.old2']);
		dropPackages('x.listed1', 'x.listed2', 'x.old1', 'x.old2');
	});

	it('the flags band reads two miss and two gone', async () => {
		const q = band.bandQuery('flags', {
			flag: 'offHistory',
			to: '1',
			of: 4,
			chg: 0,
			miss: ['x.m1', 'x.m2'],
			gone: ['x.g1', 'x.g2']
		});
		const out = await loadAt(`/browse/extensions?select=1&${q}`);
		expect(out.band.miss).toEqual(['x.m1', 'x.m2']);
		expect(out.band.gone).toEqual(['x.g1', 'x.g2']);
		// Sizes 0 and 1 read the same way.
		const none = await loadAt(
			`/browse/extensions?select=1&${band.bandQuery('flags', {
				flag: 'offHistory',
				to: '0',
				of: 0,
				chg: 0
			})}`
		);
		expect(none.band.miss).toEqual([]);
		expect(none.band.gone).toEqual([]);
		const one = await loadAt(
			`/browse/extensions?select=1&${band.bandQuery('flags', {
				flag: 'offHistory',
				to: '0',
				of: 2,
				chg: 0,
				miss: ['x.only'],
				gone: ['x.oneGone']
			})}`
		);
		expect(one.band.miss).toEqual(['x.only']);
		expect(one.band.gone).toEqual(['x.oneGone']);
	});

	it('a reload of the band’s URL says the same, and a second UNDO refuses whole', async () => {
		// A package of this case's own: the describe above removes en.multi.
		extension('x.mixedflags', [
			{ id: '641', lang: 'en' },
			{ id: '642', lang: 'fr' }
		]);
		flags.setSourceFlag('641', 'offHistory', true);
		const press = await act('flags', { pkg: 'x.mixedflags', flag: 'offHistory', value: 'true' });
		const from = new URL(press.location!, 'http://localhost').searchParams.get('from')!;
		expect(from).toBe('641|1,642|0');
		const reloaded = await loadAt(press.location!);
		expect(reloaded.band.facts.map((f) => f.sourceId)).toEqual(['641', '642']);
		expect(
			(await act('undoFlags', { pkg: 'x.mixedflags', flag: 'offHistory', to: '1', from })).status
		).toBe(303);
		expect(flags.sourceFlags('641').offHistory).toBe(true);
		expect(flags.sourceFlags('642').offHistory).toBe(false);
		// The band is gone from the screen after UNDO; its remembered URL pressed
		// again must not take the press back twice.
		const twice = await act('undoFlags', {
			pkg: 'x.mixedflags',
			flag: 'offHistory',
			to: '1',
			from
		});
		expect(twice.status).toBe(409);
		expect(flags.sourceFlags('641').offHistory).toBe(true);
		expect(flags.sourceFlags('642').offHistory).toBe(false);
		dropPackages('x.mixedflags');
		for (const id of ['641', '642']) flags.setSourceFlag(id, 'offHistory', false);
	});

	it('the update band reads two done and two failed, and BACK TO two done', async () => {
		const up = band.bandQuery('update', {
			done: ['x.u1', 'x.u2'],
			miss: ['x.f1', 'x.f2'],
			of: 4,
			no: 0
		});
		const out = await loadAt(`/browse/extensions?${up}`);
		expect(out.updateBand.done).toEqual(['x.u1', 'x.u2']);
		expect(out.updateBand.failed).toEqual(['x.f1', 'x.f2']);
		const back = band.bandQuery('back', { done: ['x.b1', 'x.b2'] });
		const outBack = await loadAt(`/browse/extensions?${back}`);
		expect(outBack.backBand.done).toEqual(['x.b1', 'x.b2']);
	});

	it('BACK TO puts every row it counted back on its old version', async () => {
		const until = Date.now() + 86_400_000;
		for (const [pkg, handle, id] of [
			['x.b1', 'prev-one', '621'],
			['x.b2', 'prev-two', '622']
		] as const) {
			extension(pkg, [{ id, lang: 'en' }]);
			db.prepare(
				`UPDATE engine_extensions SET previous_handle = ?, previous_version = '0.9',
					previous_until = ?, version_name = '1.9' WHERE pkg = ?`
			).run(handle, until, pkg);
			writeFileSync(join(process.env.ENGINE_STORE!, `${handle}.apk`), 'x');
		}
		const r = await act('undoUpdate', { pkg: ['x.b1', 'x.b2'] });
		expect(r.status).toBe(303);
		const out = await loadAt(r.location!);
		expect(out.backBand.done).toEqual(['x.b1', 'x.b2']);
		expect(
			db
				.prepare(
					`SELECT pkg, version_name FROM engine_extensions WHERE pkg IN ('x.b1','x.b2') ORDER BY pkg`
				)
				.all()
		).toEqual([
			{ pkg: 'x.b1', version_name: '0.9' },
			{ pkg: 'x.b2', version_name: '0.9' }
		]);
		dropPackages('x.b1', 'x.b2');
		rmSync(join(process.env.ENGINE_STORE!, 'prev-one.apk'), { force: true });
		rmSync(join(process.env.ENGINE_STORE!, 'prev-two.apk'), { force: true });
	});
});

/**
 * Round 2: hidden means hidden in the data too. `packageFlags` used to group
 * every installed package, hidden ones included, and count hidden sources on
 * every load; SvelteKit serialises that into the HTML and `__data.json`.
 */
describe('packageFlags names only what the viewer is drawn (card c696, round 2)', () => {
	it('sends no hidden package id and no hidden count outside reveal, and both inside it', async () => {
		extension('x.secret', [{ id: '701', lang: 'en' }]);
		plugin('secretplugin');
		// A drawn package with one hidden source of two: total counts every source
		// (the owner's rule), but outside reveal its hidden count is not sent.
		extension('x.mixed', [
			{ id: '702', lang: 'en' },
			{ id: '703', lang: 'fr' }
		]);
		flags.setSourceFlag('701', 'hidden', true);
		flags.setSourceFlag('ln:secretplugin', 'hidden', true);
		flags.setSourceFlag('703', 'hidden', true);

		const out = await loadAt('/browse/extensions');
		const json = JSON.stringify(out);
		expect(json).not.toContain('x.secret');
		expect(json).not.toContain('secretplugin');
		expect(out.packageFlags['x.secret']).toBeUndefined();
		expect(out.packageFlags['x.mixed'].total).toBe(2);
		expect(out.packageFlags['x.mixed'].on.hidden).toBe(0);

		const inside = await loadAt('/browse/extensions', true);
		const insideJson = JSON.stringify(inside);
		expect(insideJson).toContain('x.secret');
		expect(insideJson).toContain('secretplugin');
		expect(inside.packageFlags['x.secret'].on.hidden).toBe(1);
		expect(inside.packageFlags['x.mixed'].on.hidden).toBe(1);

		dropPackages('x.secret', 'x.mixed', 'ln:secretplugin');
		for (const id of ['701', '702', '703']) flags.setSourceFlag(id, 'hidden', false);
		flags.setSourceFlag('ln:secretplugin', 'hidden', false);
	});
});

/**
 * Round 2: the URL is bounded before the write. A fact costs about 26 bytes
 * once encoded (`|` and `,`), so 600 sources are already past Node's 16 KB
 * request head; the redirect's GET would answer 431 after the press was done.
 */
describe('a press too large for its URL is refused before it writes (card c696, round 2)', () => {
	const idsFrom = (n: number, start: bigint) =>
		Array.from({ length: n }, (_, i) => String(start + BigInt(i)));

	it('refuses over the budget with nothing written, and takes one just under it', async () => {
		const under = idsFrom(400, 10n ** 18n + 1_000n);
		const over = idsFrom(600, 2n * 10n ** 18n + 1_000n);
		extension(
			'x.under',
			under.map((id) => ({ id, lang: 'en' }))
		);
		extension(
			'x.over',
			over.map((id) => ({ id, lang: 'en' }))
		);

		const tooBig = await act('flags', { pkg: 'x.over', flag: 'neverTracked', value: 'true' });
		expect(tooBig.status).toBe(409);
		expect(tooBig.data?.message).toBe('TOO MANY SOURCES TO CHANGE AT ONCE');
		// Nothing was written: the press was refused before `setSourceFlags`.
		expect(
			db.prepare(`SELECT COUNT(*) AS n FROM settings WHERE key LIKE 'source.never-tracked:%'`).get()
		).toEqual({ n: 0 });

		const justUnder = await act('flags', {
			pkg: 'x.under',
			flag: 'neverTracked',
			value: 'true'
		});
		expect(justUnder.status).toBe(303);
		// The whole Location — path, `pkg` and the band's facts — fits the budget.
		expect(justUnder.location!.length).toBeLessThanOrEqual(band.LOCATION_BUDGET);
		expect(flags.sourceFlags(under[0]).neverTracked).toBe(true);

		dropPackages('x.under', 'x.over');
		for (const id of under) flags.setSourceFlag(id, 'neverTracked', false);
	});
});

/**
 * Round 2: a bulk UPDATE where nothing took is not a success with a smaller
 * count. UPDATE ALL answers `fail(502, '... did not update')`; so does this,
 * and a refused signature is not reported as a repository that did not answer.
 */
describe('a bulk UPDATE where nothing took is not UPDATED (card c696, round 2)', () => {
	const prep = () => {
		for (const [pkg, id] of [
			['x.upok', '801'],
			['x.upf', '802']
		] as const) {
			extension(pkg, [{ id, lang: 'en' }]);
			listAt(pkg, 9);
		}
	};

	it('keeps the board’s UPDATED · 1 OF 2 when one of two took', async () => {
		prep();
		installs.fail.add('x.upf');
		const r = await act('updateSome', { pkg: ['x.upok', 'x.upf'] });
		expect(r.status).toBe(303);
		const out = await loadAt(r.location!);
		expect(out.updateBand.done).toEqual(['x.upok']);
		expect(out.updateBand.failed).toEqual(['x.upf']);
		expect(out.updateBand.of).toBe(2);
		dropPackages('x.upok', 'x.upf');
	});

	it('answers did not update when every install failed, and keeps the reason', async () => {
		prep();
		installs.fail.add('x.upok');
		installs.fail.add('x.upf');
		const r = await act('updateSome', { pkg: ['x.upok', 'x.upf'] });
		expect(r.status).toBe(502);
		expect(String(r.data?.message)).toContain('did not update');
		expect(String(r.data?.message)).not.toContain('UPDATED');

		// A refused signature is its own reason, not "its repository didn't answer".
		installs.fail.clear();
		installs.untrusted.add('x.upok');
		installs.untrusted.add('x.upf');
		const untrusted = await act('updateSome', { pkg: ['x.upok', 'x.upf'] });
		expect(untrusted.status).toBe(502);
		expect(String(untrusted.data?.message)).toContain('signed with another key');
		expect(String(untrusted.data?.message)).not.toContain('did not answer');
		dropPackages('x.upok', 'x.upf');
	});
});

/** Round 2's lows: the bulk doors are as guarded as the single one. */
describe('a hidden source outside reveal (card c696, round 2)', () => {
	it('cannot be changed by a hand-made bulk post, and UNDO names no source it may not see', async () => {
		extension('x.hid', [{ id: '631', lang: 'en' }]);
		flags.setSourceFlag('631', 'hidden', true);
		const r = await act('flags', { pkg: 'x.hid', flag: 'neverTracked', value: 'true' }, false);
		expect(r.status).toBe(303);
		expect(flags.sourceFlags('631').neverTracked).toBe(false);
		// Inside reveal the same press reaches it, as the row is drawn there.
		const shown = await act('flags', { pkg: 'x.hid', flag: 'neverTracked', value: 'true' }, true);
		expect(shown.status).toBe(303);
		expect(flags.sourceFlags('631').neverTracked).toBe(true);

		extension('x.vis', [{ id: '632', lang: 'en' }]);
		expect((await act('flags', { pkg: 'x.vis', flag: 'offHistory', value: 'true' })).status).toBe(
			303
		);
		// Changed since, and hidden since: the refusal outside reveal names no source.
		flags.setSourceFlag('632', 'offHistory', false);
		flags.setSourceFlag('632', 'hidden', true);
		const hiddenNow = await act(
			'undoFlags',
			{ pkg: 'x.vis', flag: 'offHistory', to: '1', from: '632|0' },
			false
		);
		expect(hiddenNow.status).toBe(409);
		expect(String(hiddenNow.data?.message)).toBe('UNDO REFUSED · A SOURCE WAS CHANGED SINCE');
		// Inside reveal the source may be named.
		const seen = await act(
			'undoFlags',
			{ pkg: 'x.vis', flag: 'offHistory', to: '1', from: '632|0' },
			true
		);
		expect(String(seen.data?.message)).toBe('UNDO REFUSED · X.VIS WAS CHANGED SINCE');

		dropPackages('x.hid', 'x.vis');
		for (const id of ['631', '632'])
			for (const f of flags.SOURCE_FLAGS) flags.setSourceFlag(id, f, false);
	});
});

/**
 * Round 2 of wave 42 measured the budget on the band's query alone, and wave
 * 43's review found the rest of the redirect outside it: `selectQuery` adds one
 * `pkg` per ticked package, and `?/updateSome` and `?/removeSome` had no check
 * at all. A press of many real-length package names was written, then the
 * redirect's GET answered 431 with no band and no UNDO. These cases use the
 * packages' own names at about 52 bytes each, as an extension's name is.
 */
describe('the whole redirect is budgeted, for every press (card c696, wave 43)', () => {
	const real = (i: number) =>
		`eu.kanade.tachiyomi.extension.en.source${String(i).padStart(4, '0')}`;
	/** [n] installed single-source extensions, from [start] on, in the test's own id range. */
	const many = (n: number, start: number) =>
		Array.from({ length: n }, (_, i) => {
			const pkg = real(start + i);
			extension(pkg, [{ id: String(900_000 + start + i), lang: 'en' }]);
			return pkg;
		});
	const idsOf = (n: number, start: number) =>
		Array.from({ length: n }, (_, i) => String(900_000 + start + i));

	it('?/flags: 250 real-length packages refuse with nothing written, 190 fit the whole Location', async () => {
		const over = many(250, 0);
		const refused = await act('flags', { pkg: over, flag: 'neverTracked', value: 'true' });
		expect(refused.status).toBe(409);
		expect(refused.data?.message).toBe('TOO MANY SOURCES TO CHANGE AT ONCE');
		expect(
			db.prepare(`SELECT COUNT(*) AS n FROM settings WHERE key LIKE 'source.never-tracked:%'`).get()
		).toEqual({ n: 0 });

		const under = many(190, 1_000);
		const taken = await act('flags', { pkg: under, flag: 'neverTracked', value: 'true' });
		expect(taken.status).toBe(303);
		expect(taken.location!.length).toBeLessThanOrEqual(band.LOCATION_BUDGET);
		expect(new URL(taken.location!, 'http://localhost').searchParams.getAll('pkg')).toEqual(under);
		expect(flags.sourceFlags(idsOf(190, 1_000)[0]).neverTracked).toBe(true);

		dropPackages(...over, ...under);
		for (const id of [...idsOf(250, 0), ...idsOf(190, 1_000)])
			flags.setSourceFlag(id, 'neverTracked', false);
	});

	it('?/removeSome refuses before removing, and every row stays installed', async () => {
		const pkgs = many(260, 3_000);
		for (const pkg of pkgs) listAt(pkg, 1);
		const refused = await act('removeSome', { pkg: pkgs });
		expect(refused.status).toBe(409);
		expect(
			db
				.prepare(
					`SELECT COUNT(*) AS n FROM engine_extensions WHERE pkg IN (${pkgs.map(() => '?').join(',')})`
				)
				.get(...pkgs)
		).toEqual({ n: 260 });
		dropPackages(...pkgs);
	});

	it('?/updateSome refuses before the first install', async () => {
		const pkgs = many(260, 5_000);
		for (const pkg of pkgs) listAt(pkg, 9);
		const refused = await act('updateSome', { pkg: pkgs });
		expect(refused.status).toBe(409);
		// The guard runs before the loop, so no repository was asked.
		expect(installs.calls).toEqual([]);
		expect(
			db
				.prepare(
					`SELECT COUNT(*) AS n FROM engine_extensions WHERE pkg IN (${pkgs.map(() => '?').join(',')}) AND version_name = '1.0'`
				)
				.get(...pkgs)
		).toEqual({ n: 260 });
		dropPackages(...pkgs);
	});
});

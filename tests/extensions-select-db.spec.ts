import { beforeEach, describe, expect, it, vi } from 'vitest';
import type Database from 'better-sqlite3';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

// Before anything imports db.ts: getDb() reads this once and memoises.
process.env.DATABASE_PATH = ':memory:';
process.env.ENGINE_URL = 'http://127.0.0.1:1';
process.env.ENGINE_TOKEN = 'extensions-select';
// BACK TO keeps the previous APK under this store; keep it in the checkout's
// scratch, never the user's data folder.
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
// Reveal is a value only the server makes (prefs.ts), never a bare '1'.
const { revealValue } = await import('$lib/server/prefs');

/**
 * EXTENSIONS' SELECT: setting one of tsundoku's switches on every
 * source of the ticked extensions, in one transaction, with the facts UNDO
 * needs. The press's rule: a row is a
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
		cookies: {
			get: (n: string) => (reveal && n === 'tsundoku_reveal' ? revealValue(undefined) : undefined)
		}
	} as never)) as unknown as {
		removeBand: { done: string[]; stayed: string[] };
		updateBand: {
			done: string[];
			ver: string[];
			failed: string[];
			untrusted: string[];
			of: number;
		};
		backBand: { done: string[] };
		band: {
			miss: string[];
			gone: string[];
			facts: { sourceId: string; previous: boolean }[];
		};
		drawn: string[];
		packageFlags: Record<string, { total: number; on: Record<string, number> }>;
		removeRefusal: string | null;
	};
}

/** Run one of the page's actions with a form, and answer its redirect (or its failure). */
async function act(
	name: 'flags' | 'undoFlags' | 'updateSome' | 'undoUpdate' | 'removeSome' | 'back',
	fields: Record<string, string | string[]>,
	reveal = false
): Promise<{ status: number; location?: string; data?: Record<string, unknown> }> {
	const form = new FormData();
	for (const [key, value] of Object.entries(fields))
		for (const v of Array.isArray(value) ? value : [value]) form.append(key, v);
	try {
		const answer = (await extensionsPage.actions[name]({
			request: new Request('http://localhost/browse/extensions', { method: 'POST', body: form }),
			cookies: {
				get: (n: string) => (reveal && n === 'tsundoku_reveal' ? revealValue(undefined) : undefined)
			}
		} as never)) as { status?: number; data?: Record<string, unknown> };
		return { status: answer.status ?? 200, data: answer.data };
	} catch (e) {
		const redirect = e as { status?: number; location?: string };
		if (redirect.status === 303) return { status: 303, location: redirect.location };
		return { status: redirect.status ?? 500, data: e as never };
	}
}

describe('one switch on many sources', () => {
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

describe('SELECT’s press', () => {
	it('changes every source of the extension, including a language BROWSE does not list', async () => {
		const r = await act('flags', { pkg: 'en.multi', flag: 'offHistory', value: 'true' });
		expect(r.status).toBe(303);
		const u = new URL(r.location!, 'http://localhost');
		// The fr source is not in the user's languages (en, ja), so BROWSE never
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
		const undo = await act('undoFlags', {
			select: '1',
			pkg: 'en.multi',
			flag: 'offHistory',
			to: '1',
			from
		});
		expect(undo.status).toBe(303);
		expect(flags.sourceFlags('500').offHistory).toBe(true);
		expect(flags.sourceFlags('501').offHistory).toBe(false);
		// Pressed while selecting: the selection comes back, so SELECT stays on
		// with the rows it had.
		const at = new URL(undo.location!, 'http://localhost').searchParams;
		expect(at.get('select')).toBe('1');
		expect(at.getAll('pkg')).toEqual(['en.multi']);
	});

	it('an undo pressed after SELECT ended lands on the plain list', async () => {
		const press = await act('flags', { pkg: 'en.multi', flag: 'offHistory', value: 'true' });
		const from = new URL(press.location!, 'http://localhost').searchParams.get('from')!;
		const undo = await act('undoFlags', { flag: 'offHistory', to: '1', from });
		expect(undo.status).toBe(303);
		expect(flags.sourceFlags('501').offHistory).toBe(false);
		const at = new URL(undo.location!, 'http://localhost');
		expect(at.searchParams.has('select')).toBe(false);
		expect(at.searchParams.getAll('pkg')).toEqual([]);
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
		// Hidden means hidden: outside reveal the package is not drawn.
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

describe('SELECT’s UPDATE and REMOVE', () => {
	it('refuses UPDATE when nothing ticked has one', async () => {
		const r = await act('updateSome', { pkg: ['en.multi', 'en.none'] });
		expect(r.status).toBe(409);
		expect(r.data?.message).toBe('NOTHING TICKED HAS AN UPDATE');
	});

	it('refuses a bulk BACK TO when the version before is no longer kept', async () => {
		const r = await act('undoUpdate', { pkg: 'en.multi', ver: '1.0' });
		expect(r.status).toBe(409);
		expect(String(r.data?.message)).toContain('NO LONGER KEPT');
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
		// Its settings outlive it, as REMOVE's sheet says: the switch this
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
 * A band keeps every row of every list. `bandQuery` writes `done=a&
 * done=b` (a repeated parameter), so a reader taking `.get()` kept the first
 * and dropped the rest: `UPDATED · 1 OF 3` on three, an UNDO that put one back.
 * Every case here takes at least two rows through the action and then the real
 * load, which is what a user meets after the 303.
 */
describe('a band keeps every row of its lists', () => {
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
			ver: ['9.0', '9.1'],
			miss: ['x.f1', 'x.f2'],
			of: 4,
			no: 0
		});
		const out = await loadAt(`/browse/extensions?${up}`);
		expect(out.updateBand.done).toEqual(['x.u1', 'x.u2']);
		expect(out.updateBand.ver).toEqual(['9.0', '9.1']);
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
		const r = await act('undoUpdate', { pkg: ['x.b1', 'x.b2'], ver: ['1.9', '1.9'] });
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
 * Hidden means hidden in the data too. Whatever `packageFlags` groups and
 * counts on a load, SvelteKit serialises into the HTML and `__data.json`.
 */
describe('packageFlags names only what the viewer is drawn', () => {
	it('sends no hidden package id and no hidden count outside reveal, and both inside it', async () => {
		extension('x.secret', [{ id: '701', lang: 'en' }]);
		plugin('secretplugin');
		// A drawn package with one hidden source of two: total counts every source,
		// but outside reveal its hidden count is not sent.
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
 * The URL is bounded before the write. A fact costs about 26 bytes
 * once encoded (`|` and `,`), so 600 sources are already past Node's 16 KB
 * request head; the redirect's GET would answer 431 after the press was done.
 */
describe('a press too large for its URL is refused before it writes', () => {
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
 * A bulk UPDATE where nothing took is not a success with a smaller
 * count. UPDATE ALL answers `fail(502, '... did not update')`; so does this,
 * and a refused signature is not reported as a repository that did not answer.
 */
describe('a bulk UPDATE where nothing took is not UPDATED', () => {
	const prep = () => {
		for (const [pkg, id] of [
			['x.upok', '801'],
			['x.upf', '802']
		] as const) {
			extension(pkg, [{ id, lang: 'en' }]);
			listAt(pkg, 9);
		}
	};

	it('keeps the band’s UPDATED · 1 OF 2 when one of two took', async () => {
		prep();
		installs.fail.add('x.upf');
		const r = await act('updateSome', { pkg: ['x.upok', 'x.upf'] });
		expect(r.status).toBe(303);
		const out = await loadAt(r.location!);
		expect(out.updateBand.done).toEqual(['x.upok']);
		expect(out.updateBand.failed).toEqual(['x.upf']);
		expect(out.updateBand.of).toBe(2);
		// The band carries one version per updated row, in `done`'s order: the
		// mock install leaves the row where it was, so its version is still 1.0.
		expect(out.updateBand.ver).toEqual(['1.0']);
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
		// With one of each, each group is named with its own reason: one suffix
		// for every name reported a repository that did not answer as a signature.
		installs.fail.clear();
		installs.untrusted.clear();
		installs.fail.add('x.upok');
		installs.untrusted.add('x.upf');
		const mixed = await act('updateSome', { pkg: ['x.upok', 'x.upf'] });
		expect(mixed.status).toBe(502);
		expect(String(mixed.data?.message)).toContain('x.upok did not update');
		expect(String(mixed.data?.message)).toContain(
			'x.upf (signed with another key than its repository)'
		);
		dropPackages('x.upok', 'x.upf');
	});
});

/** The bulk actions are as guarded as the single one. */
describe('a hidden source outside reveal', () => {
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
 * The budget covers the whole redirect, not the band's query alone:
 * `selectQuery` adds one `pkg` per ticked package, and `?/updateSome` and
 * `?/removeSome` are checked too. Otherwise a press of many real-length package
 * names is written, then the redirect's GET answers 431 with no band and no
 * UNDO. These cases use the packages' own names at about 52 bytes each, as an
 * extension's name is.
 */
describe('the whole redirect is budgeted, for every press', () => {
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
		// The refusal answers with the ticks it read, so a no-script page comes
		// back still selecting them.
		expect(refused.data?.selected).toEqual(over);
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
		expect(refused.data?.selected).toEqual(pkgs);
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
		expect(refused.data?.selected).toEqual(pkgs);
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

/**
 * `back()`/`backPlugin()` swap versions and keep `previous_until`, so a row
 * that has already gone back still looks "backable"; a band with package names
 * and no version would let UNDO swap it forward again and report it restored.
 * The band carries each updated row's new version (`ver=…`, one per `done`, in
 * order) and UNDO refuses whole when any row's version is not the one the press
 * installed.
 */
describe('UPDATE’s UNDO checks the version the press installed', () => {
	const until = Date.now() + 86_400_000;
	/** [pkg] as a row a bulk UPDATE has just left on 1.9, its 0.9 still kept. */
	const updated = (pkg: string, handle: string, id: string) => {
		extension(pkg, [{ id, lang: 'en' }]);
		db.prepare(
			`UPDATE engine_extensions SET previous_handle = ?, previous_version = '0.9',
				previous_until = ?, version_name = '1.9' WHERE pkg = ?`
		).run(handle, until, pkg);
		writeFileSync(join(process.env.ENGINE_STORE!, `${handle}.apk`), 'x');
	};
	const versions = (pkgs: string[]) =>
		Object.fromEntries(
			(
				db
					.prepare(
						`SELECT pkg, version_name FROM engine_extensions WHERE pkg IN (${pkgs.map(() => '?').join(',')}) ORDER BY pkg`
					)
					.all(...pkgs) as { pkg: string; version_name: string }[]
			).map((r) => [r.pkg, r.version_name])
		);

	it('refuses whole when a row went back on its own since, a plugin included', async () => {
		updated('x.ua', 'prev-a', '651');
		updated('x.ub', 'prev-b', '652');
		plugin('x.p');
		db.prepare(
			`UPDATE novel_plugins SET previous_hash = 'prev-p', previous_version = '0.9',
				previous_until = ?, version = '1.9' WHERE id = 'x.p'`
		).run(until);
		mkdirSync(join(process.env.ENGINE_STORE!, 'novels'), { recursive: true });
		writeFileSync(join(process.env.ENGINE_STORE!, 'novels', 'prev-p.js'), 'x');

		// The row's own BACK TO: x.ua is 0.9 again, its kept "previous" now 1.9,
		// so the backable check alone would still let the bulk UNDO through.
		expect((await act('back', { pkg: 'x.ua' })).status).toBe(200);
		const undo = await act('undoUpdate', {
			pkg: ['x.ua', 'x.ub', 'ln:x.p'],
			ver: ['1.9', '1.9', '1.9']
		});
		expect(undo.status).toBe(409);
		// Whole: the two rows that still matched were not swapped either.
		expect(versions(['x.ua', 'x.ub'])).toEqual({ 'x.ua': '0.9', 'x.ub': '1.9' });
		expect(db.prepare(`SELECT version FROM novel_plugins WHERE id = 'x.p'`).get()).toEqual({
			version: '1.9'
		});

		dropPackages('x.ua', 'x.ub', 'ln:x.p');
		rmSync(join(process.env.ENGINE_STORE!, 'prev-a.apk'), { force: true });
		rmSync(join(process.env.ENGINE_STORE!, 'prev-b.apk'), { force: true });
		rmSync(join(process.env.ENGINE_STORE!, 'novels', 'prev-p.js'), { force: true });
	});

	it('a second UNDO after a successful one refuses with the versions unchanged', async () => {
		updated('x.va', 'prev-va', '661');
		updated('x.vb', 'prev-vb', '662');
		const once = await act('undoUpdate', { pkg: ['x.va', 'x.vb'], ver: ['1.9', '1.9'] });
		expect(once.status).toBe(303);
		expect(versions(['x.va', 'x.vb'])).toEqual({ 'x.va': '0.9', 'x.vb': '0.9' });
		expect((await loadAt(once.location!)).backBand.done).toEqual(['x.va', 'x.vb']);

		// Browser Back to the band's URL, or a double press: the rows are 0.9,
		// not the 1.9 the press installed, so nothing is swapped a second time.
		const twice = await act('undoUpdate', { pkg: ['x.va', 'x.vb'], ver: ['1.9', '1.9'] });
		expect(twice.status).toBe(409);
		expect(versions(['x.va', 'x.vb'])).toEqual({ 'x.va': '0.9', 'x.vb': '0.9' });

		dropPackages('x.va', 'x.vb');
		rmSync(join(process.env.ENGINE_STORE!, 'prev-va.apk'), { force: true });
		rmSync(join(process.env.ENGINE_STORE!, 'prev-vb.apk'), { force: true });
	});
});

/**
 * Outside reveal a HIDE press on a package with an already-hidden source must
 * not write that source's id and one bit into the band, which is otherwise kept
 * from the client; the source is not changed by the press, so it leaves the
 * facts and UNDO does not touch it.
 */
describe('a HIDE press leaves already-hidden sources out of its facts', () => {
	it('carries only the sources it changes outside reveal, and every one inside', async () => {
		extension('x.hide2', [
			{ id: '671', lang: 'en' },
			{ id: '672', lang: 'en' }
		]);
		flags.setSourceFlag('672', 'hidden', true);
		const outside = await act('flags', { pkg: 'x.hide2', flag: 'hidden', value: 'true' });
		expect(outside.status).toBe(303);
		const from = new URL(outside.location!, 'http://localhost').searchParams.get('from')!;
		expect(from).toBe('671|0');
		// Both are hidden by the press, but the band does not name the one it did
		// not change, and UNDO leaves it hidden.
		expect(flags.sourceFlags('671').hidden).toBe(true);
		const undo = await act('undoFlags', {
			pkg: 'x.hide2',
			flag: 'hidden',
			to: '1',
			from
		});
		expect(undo.status).toBe(303);
		expect(flags.sourceFlags('671').hidden).toBe(false);
		expect(flags.sourceFlags('672').hidden).toBe(true);

		// Inside reveal the same press carries both, each with its own value:
		// the count is revealed there, and UNDO puts a mixed pair back mixed.
		flags.setSourceFlag('672', 'hidden', true);
		const inside = await act('flags', { pkg: 'x.hide2', flag: 'hidden', value: 'true' }, true);
		const seen = new URL(inside.location!, 'http://localhost').searchParams.get('from')!;
		expect(seen.split(',').sort()).toEqual(['671|0', '672|1']);

		dropPackages('x.hide2');
		for (const id of ['671', '672'])
			for (const f of flags.SOURCE_FLAGS) flags.setSourceFlag(id, f, false);
	});
});

/**
 * The update band carries one `ver` per updated row beside its `done`, so a
 * press just under a bound that counted `done` alone could still send a
 * Location over the budget. The versions here are what the mocked install
 * leaves (1.0); the bound must cost `done` and `ver` together.
 */
describe('UPDATE’s redirect counts the version it carries', () => {
	const real = (i: number) =>
		`eu.kanade.tachiyomi.extension.en.source${String(i).padStart(4, '0')}`;
	const many = (n: number, start: number) =>
		Array.from({ length: n }, (_, i) => {
			const pkg = real(start + i);
			extension(pkg, [{ id: String(900_000 + start + i), lang: 'en' }]);
			listAt(pkg, 9);
			return pkg;
		});

	it('refuses before the first install when `done` and `ver` together pass the budget', async () => {
		const over = many(220, 7_000);
		const refused = await act('updateSome', { pkg: over });
		expect(refused.status).toBe(409);
		expect(installs.calls).toEqual([]);
		dropPackages(...over);
	});

	it('takes a press whose whole Location, versions included, fits the budget', async () => {
		const under = many(180, 9_000);
		const taken = await act('updateSome', { pkg: under });
		expect(taken.status).toBe(303);
		expect(taken.location!.length).toBeLessThanOrEqual(band.LOCATION_BUDGET);
		expect(new URL(taken.location!, 'http://localhost').searchParams.getAll('ver')).toHaveLength(
			180
		);
		dropPackages(...under);
	});
});

/**
 * Without script a tick must still be pressable: `selected` lives only in the
 * URL, so the server draws every bar cell pressable (they are disabled
 * only after hydration), so an empty press can arrive and must be refused with
 * the band and write nothing; a refusal answers with the ticks it read, so the
 * fresh page a no-script press lands on comes back still selecting them.
 */
describe('an empty press, and the ticks a refusal answers with', () => {
	it('?/flags refuses an empty press with the band and writes nothing', async () => {
		const r = await act('flags', { flag: 'neverTracked', value: 'true' });
		expect(r.status).toBe(409);
		expect(r.data?.message).toBe('NOTHING TICKED');
		expect(r.data?.selected).toEqual([]);
		expect(
			db.prepare(`SELECT COUNT(*) AS n FROM settings WHERE key LIKE 'source.never-tracked:%'`).get()
		).toEqual({ n: 0 });
	});

	it('?/updateSome and ?/removeSome refuse an empty press too', async () => {
		const update = await act('updateSome', {});
		expect(update.status).toBe(409);
		expect(update.data?.message).toBe('NOTHING TICKED HAS AN UPDATE');
		expect(update.data?.selected).toEqual([]);
		const remove = await act('removeSome', {});
		expect(remove.status).toBe(409);
		expect(remove.data?.message).toBe('NOTHING TICKED');
		expect(remove.data?.selected).toEqual([]);
	});

	it('a refused UPDATE answers with the ticks it read', async () => {
		extension('x.notupd', [{ id: '641', lang: 'en' }]);
		const r = await act('updateSome', { pkg: 'x.notupd' });
		expect(r.status).toBe(409);
		expect(r.data?.selected).toEqual(['x.notupd']);
		dropPackages('x.notupd');
	});

	it('REMOVE’s question with no ticks answers the page’s refusal band', async () => {
		const out = await loadAt('/browse/extensions?select=1&removeSel=1');
		expect(out.removeRefusal).toBe('NOTHING TICKED');
	});
});

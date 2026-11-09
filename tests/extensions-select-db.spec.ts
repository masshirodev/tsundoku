import { beforeEach, describe, expect, it } from 'vitest';
import type Database from 'better-sqlite3';

// Before anything imports db.ts: getDb() reads this once and memoises.
process.env.DATABASE_PATH = ':memory:';
process.env.ENGINE_URL = 'http://127.0.0.1:1';
process.env.ENGINE_TOKEN = 'extensions-select';

const { getDb } = await import('$lib/server/db');
const flags = await import('$lib/server/engine/source-flags');

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
});

const extensionsPage = await import('../src/routes/browse/extensions/+page.server');

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

import { beforeEach, describe, expect, it } from 'vitest';
import type Database from 'better-sqlite3';

// Before anything imports db.ts: getDb() reads this once and memoises.
process.env.DATABASE_PATH = ':memory:';
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

beforeEach(() => {
	for (const id of [...IDS, 'ln:plugin'])
		for (const f of flags.SOURCE_FLAGS) flags.setSourceFlag(id, f, false);
	flags.setSourceFlag('200', 'offHistory', true);
});

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

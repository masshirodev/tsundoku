import { describe, expect, it } from 'vitest';

process.env.DATABASE_PATH = ':memory:';

const { getDb } = await import('$lib/server/db');
const prefs = await import('$lib/server/prefs');
const { REVEAL_COOKIE, REVEAL_TTL_MS, isRevealed, revealValid, revealValue, runCommand } = prefs;

/**
 * Reveal decides which rows are queried at all (doc/PRIVACY.md), so its cookie
 * has to be one only the server can make: a session holder who sets it by
 * hand, a paired TV or a browser's devtools, must see nothing hidden.
 */

/** A request's cookies, writable as SvelteKit's are, with what it set kept. */
function jar(start: Record<string, string> = {}) {
	const values = new Map(Object.entries(start));
	return {
		values,
		get: (n: string) => values.get(n),
		set: (n: string, v: string) => void values.set(n, v),
		delete: (n: string) => void values.delete(n)
	};
}

const SESSION = 'a-session-value';
const NOW = 1_800_000_000_000;

describe('the reveal cookie', () => {
	it('reads an old bare 1, or anything typed, as not revealed', () => {
		for (const v of ['1', 'true', 'v1', `v1.${NOW + 1000}.`, `v1.${NOW + 1000}.${'A'.repeat(43)}`])
			expect(isRevealed(jar({ [REVEAL_COOKIE]: v, tsundoku_session: SESSION }) as never)).toBe(
				false
			);
	});

	it('is revealed by a value the server made for this session', () => {
		const v = revealValue(SESSION, NOW);
		expect(revealValid(v, SESSION, NOW)).toBe(true);
		expect(revealValid(v, SESSION, NOW + REVEAL_TTL_MS - 1)).toBe(true);
	});

	it('runs out, and an expiry later than the server would give is not its own', () => {
		const v = revealValue(SESSION, NOW);
		expect(revealValid(v, SESSION, NOW + REVEAL_TTL_MS)).toBe(false);
		// A value made "in the future" carries an expiry no fresh one has now.
		expect(revealValid(revealValue(SESSION, NOW + 60_000), SESSION, NOW)).toBe(false);
	});

	it('belongs to the session it was made beside', () => {
		const v = revealValue(SESSION, NOW);
		expect(revealValid(v, 'another-session', NOW)).toBe(false);
		expect(revealValid(v, undefined, NOW)).toBe(false);
		expect(revealValid(revealValue(undefined, NOW), undefined, NOW)).toBe(true);
	});

	it('refuses a value whose expiry was changed, or whose mac was', () => {
		const [, exp, mac] = revealValue(SESSION, NOW).split('.');
		expect(revealValid(`v1.${Number(exp) - 1}.${mac}`, SESSION, NOW)).toBe(false);
		const flipped = (mac[0] === 'A' ? 'B' : 'A') + mac.slice(1);
		expect(revealValid(`v1.${exp}.${flipped}`, SESSION, NOW)).toBe(false);
	});

	it('keeps its key in the database, made once and kept', () => {
		const v = revealValue(SESSION);
		const key = () =>
			getDb().prepare(`SELECT value FROM settings WHERE key = 'reveal_key'`).pluck().get();
		const first = key();
		expect(typeof first).toBe('string');
		expect(revealValid(v, SESSION)).toBe(true);
		expect(key()).toBe(first);
	});

	it('is set by /reveal and cleared by /hide, through runCommand', () => {
		const url = new URL('http://localhost/');
		const c = jar({ tsundoku_session: SESSION });
		expect(runCommand(c as never, 'reveal', url)).toBe(true);
		expect(c.values.get(REVEAL_COOKIE)).toMatch(/^v1\.\d+\.[\w-]{43}$/);
		expect(isRevealed(c as never)).toBe(true);
		expect(runCommand(c as never, 'hide', url)).toBe(true);
		expect(isRevealed(c as never)).toBe(false);
	});

	it('is not set by /reveal behind the fingerprint gate', () => {
		const c = jar({ tsundoku_session: SESSION });
		expect(runCommand(c as never, 'reveal', new URL('http://localhost/'), { gated: true })).toBe(
			false
		);
		expect(c.values.has(REVEAL_COOKIE)).toBe(false);
	});
});

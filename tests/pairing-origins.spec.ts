import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
	PAIRED_COOKIE,
	PAIRED_COOKIE_NAME,
	PAIRED_COOKIE_OPTIONS,
	addPaired,
	pairedBy,
	pairedCookie,
	pairedToken,
	readPaired
} from '../src/lib/server/pairing.ts';
import { scrub } from '../src/lib/server/report-scrub.ts';

// Read by getDb() the first time a case reaches the database: a fresh one in memory.
process.env.DATABASE_PATH = ':memory:';

/**
 * One paired cookie per origin (c530; doc/WIFI.md, doc/TV-APP.md). A cookie
 * jar scopes by host, not port or scheme, so two tsundoku on one computer
 * shared `tsundoku_paired` and each pairing undid the other's. The name now
 * says the origin's port and scheme; one paired before keeps signing in and
 * is moved to the new name by its first request.
 */

/** The table the TV app's ForgetTest reads too, so the two derivations agree. */
const TABLE = readFileSync(
	join(process.cwd(), 'android/tv/app/src/test/resources/paired-cookies.tsv'),
	'utf8'
)
	.split('\n')
	.filter((l) => l.trim() && !l.startsWith('#'))
	.map((l) => l.split('\t') as [string, string]);

/** RFC 6265's cookie-name: an RFC 2616 token, so no `:` of a port and no `[` of IPv6. */
const TOKEN = /^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/;

describe('pairedCookie: the name for an origin', () => {
	it('is the shared table, row for row, for every kind of host', () => {
		expect(TABLE.length).toBeGreaterThanOrEqual(15);
		const hosts = TABLE.map(([o]) => new URL(o).hostname);
		// The kinds the brief names: localhost, an IPv4, an IPv6 literal, a tailnet name.
		expect(hosts).toContain('localhost');
		expect(hosts).toContain('192.168.1.23');
		expect(hosts).toContain('[::1]');
		expect(hosts).toContain('zen.tailnet.ts.net');
		for (const [origin, name] of TABLE) {
			expect(pairedCookie(origin), origin).toBe(name);
			expect(pairedCookie(new URL(origin)), origin).toBe(name);
		}
	});

	it('is a legal cookie name, and a paired one, for every row', () => {
		for (const [origin] of TABLE) {
			const name = pairedCookie(origin);
			expect(name, origin).toMatch(TOKEN);
			expect(name, origin).toMatch(PAIRED_COOKIE_NAME);
			expect(name, origin).not.toBe(PAIRED_COOKIE);
		}
		expect(PAIRED_COOKIE).toMatch(PAIRED_COOKIE_NAME);
		expect('tsundoku_paired_x').not.toMatch(PAIRED_COOKIE_NAME);
		expect('tsundoku_session').not.toMatch(PAIRED_COOKIE_NAME);
	});

	it('holds on its own output: an origin rebuilt from a URL names the same cookie', () => {
		for (const [origin] of TABLE) {
			const u = new URL(origin);
			// The origin the URL normalises to, and that again, and with a path on.
			expect(pairedCookie(u.origin), origin).toBe(pairedCookie(u));
			expect(pairedCookie(new URL(u.origin).origin), origin).toBe(pairedCookie(u));
			expect(pairedCookie(new URL('/pair/tv?r=x', u)), origin).toBe(pairedCookie(u));
		}
	});

	it('tells apart the same host on two ports, and on two schemes', () => {
		const names = new Set(
			[
				'http://127.0.0.1:42143',
				'http://127.0.0.1:42144',
				'https://127.0.0.1:42143',
				'https://127.0.0.1:42144'
			].map((o) => pairedCookie(o))
		);
		expect(names.size).toBe(4);
		// The host itself is not in the name: the jar already keeps one per host.
		expect(pairedCookie('http://zen.tailnet.ts.net:42143')).toBe(
			pairedCookie('http://192.168.1.23:42143')
		);
	});
});

/** SvelteKit's `cookies`, as far as the guard uses it: a request's jar and what it set. */
function jar(start: Record<string, string>) {
	const now: Record<string, string> = { ...start };
	const set: [string, string, typeof PAIRED_COOKIE_OPTIONS][] = [];
	const deleted: [string, object][] = [];
	return {
		now,
		set,
		deleted,
		get: (n: string) => now[n],
		get api() {
			return {
				get: (n: string) => now[n],
				set: (n: string, v: string, o: typeof PAIRED_COOKIE_OPTIONS) => {
					set.push([n, v, o]);
					now[n] = v;
				},
				delete: (n: string, o: object) => {
					deleted.push([n, o]);
					delete now[n];
				}
			};
		}
	};
}

describe('readPaired: the guard’s read, and the move from the old name', () => {
	const A = new URL('http://tsundoku.test:42143/');
	const B = new URL('http://tsundoku.test:42144/');
	const here = (t: string | undefined) => pairedBy(t);

	it('signs in by this origin’s name and writes nothing', () => {
		const token = addPaired({ label: 'Android TV · Chrome', address: A.host });
		const j = jar({ [pairedCookie(A)]: token });
		expect(readPaired(j.api, A, here)?.label).toBe('Android TV · Chrome');
		expect(j.set).toEqual([]);
		expect(j.deleted).toEqual([]);
	});

	it('moves a device paired before c530 to the new name, once', () => {
		const token = addPaired({ label: 'Android TV · Chrome', address: A.host });
		// A jar holding only the old name: a TV paired before this release.
		const j = jar({ [PAIRED_COOKIE]: token });
		expect(readPaired(j.api, A, here)).not.toBeNull();
		expect(j.set).toEqual([[pairedCookie(A), token, PAIRED_COOKIE_OPTIONS]]);
		// Expired as it was set: not Secure, or plain http never takes the write.
		// Every option it was set with but its age: a drift between the two is red here.
		const { maxAge, ...asSet } = PAIRED_COOKIE_OPTIONS;
		expect(maxAge).toBeGreaterThan(0);
		expect(j.deleted).toEqual([[PAIRED_COOKIE, asSet]]);
		expect(asSet.secure).toBe(false);
		expect(j.now).toEqual({ [pairedCookie(A)]: token });
		// The next request finds the new name, and moves nothing.
		const next = jar(j.now);
		expect(readPaired(next.api, A, here)).not.toBeNull();
		expect(next.set).toEqual([]);
		expect(next.deleted).toEqual([]);
	});

	it('leaves an old name it does not know alone: another server’s pairing', () => {
		// B's database has never seen this token, so it is A's (or nobody's).
		const j = jar({ [PAIRED_COOKIE]: 'a-token-this-server-never-made' });
		expect(readPaired(j.api, B, here)).toBeNull();
		expect(j.set).toEqual([]);
		expect(j.deleted).toEqual([]);
	});

	it('never moves a token the door refused', () => {
		const token = addPaired({ label: 'Android TV · Chrome', address: A.host });
		const j = jar({ [PAIRED_COOKIE]: token });
		// friendPaired off Wi-Fi, or no tailnet door: the check says null.
		expect(readPaired(j.api, A, () => null)).toBeNull();
		expect(j.set).toEqual([]);
		expect(j.deleted).toEqual([]);
	});

	it('keeps each origin’s own pairing beside the other’s', () => {
		const a = addPaired({ label: 'TV', address: A.host });
		const b = addPaired({ label: 'TV', address: B.host });
		// Both in one jar, as the WebView keeps them for one host.
		const both = { [pairedCookie(A)]: a, [pairedCookie(B)]: b };
		expect(pairedToken(A, (n) => both[n])).toBe(a);
		expect(pairedToken(B, (n) => both[n])).toBe(b);
		const j = jar(both);
		expect(readPaired(j.api, A, here)).not.toBeNull();
		expect(readPaired(j.api, B, here)).not.toBeNull();
		expect(j.now).toEqual(both);
	});

	it('falls back to the old name when this origin’s has gone stale', () => {
		// The new name names no pairing here (signed out); an old one that does
		// is still this server's, so it is moved over the stale one.
		const token = addPaired({ label: 'TV', address: A.host });
		const j = jar({ [pairedCookie(A)]: 'stale', [PAIRED_COOKIE]: token });
		expect(readPaired(j.api, A, here)).not.toBeNull();
		expect(j.now).toEqual({ [pairedCookie(A)]: token });
	});

	it('reads nothing from an empty jar', () => {
		const j = jar({});
		expect(readPaired(j.api, A, here)).toBeNull();
		expect(pairedToken(A, j.get)).toBeUndefined();
	});
});

describe('a report never carries a paired token, under any name (report-scrub)', () => {
	const none = { secrets: [], hidden: [], paths: [] as [string, string][] };
	it('scrubs every paired name in the table, and the old one', () => {
		for (const name of [PAIRED_COOKIE, ...TABLE.map(([, n]) => n)]) {
			const out = scrub(`cookie: tsundoku_session=abc; ${name}=TOKENVALUE123; theme=dark`, none);
			expect(out, name).toBe(`cookie: tsundoku_session=[secret]; ${name}=[secret]; theme=dark`);
		}
	});
});

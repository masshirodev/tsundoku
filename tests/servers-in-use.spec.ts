import { describe, expect, it } from 'vitest';
import { inUseOf, withInUse, type HasOrigin } from '../src/routes/servers-in-use';

/**
 * The page's own server wins over the bridge's flag (c261's S1 and S2).
 *
 * The bridge's `inUse` is the server with the newest OPENED, written only once
 * a page has finished loading, so the first library after a switch reads a
 * list whose flag still names the server just left. `inUseOf` compares the
 * page's own origin against each entry, through `new URL(…).origin`, so a
 * stored entry that is the same server written another way still matches: a
 * mixed-case host, an explicit default port, a trailing slash or a path.
 *
 * Every e2e case passes its base URL verbatim, so the e2e suite stays green
 * with the normalisation gone. These cases are the only ones that hold
 * it: replace `clean(s.origin) === at` with `s.origin === here` and the
 * `SAME` table goes red.
 */

const HOME = 'http://192.168.1.23:42143';
const ZEN = 'https://zen.tailnet.ts.net:8443';
const STUDIO = 'http://studio.local:42143';

const server = (origin: string, inUse = false): HasOrigin => ({ origin, inUse });

/** One entry, and the page origin that is the same server written another way. */
const SAME: [string, string, string][] = [
	['the same string', HOME, HOME],
	['a host typed in capitals', 'http://Zen.Local:42143', 'http://zen.local:42143'],
	['a scheme typed in capitals', 'HTTP://zen.local:42143', 'http://zen.local:42143'],
	['http on its explicit default port', 'http://zen.local:80', 'http://zen.local'],
	['https on its explicit default port', 'https://zen.local:443', 'https://zen.local'],
	['a trailing slash', 'http://zen.local:42143/', 'http://zen.local:42143'],
	['a path and a query', 'http://zen.local:42143/a?b=1', 'http://zen.local:42143'],
	['an IPv6 host', 'http://[::1]:42143', 'http://[::1]:42143'],
	['an IPv6 host in capitals', 'http://[::FFFF:7F00:1]:42143', 'http://[::ffff:7f00:1]:42143'],
	['a page origin with a path', HOME, 'http://192.168.1.23:42143/library']
];

/** Origins that are another server, even though they start alike. */
const DIFFERENT: [string, string, string][] = [
	['the other scheme', 'http://zen.local:42143', 'https://zen.local:42143'],
	['another port', 'http://zen.local:42143', 'http://zen.local:42144'],
	['another host', 'http://zen.local:42143', 'http://studio.local:42143'],
	['a host that only starts alike', 'http://192.168.1.23:42143', 'http://192.168.1.230:42143'],
	['443 over http is not https', 'http://zen.local:443', 'https://zen.local']
];

describe('inUseOf picks the page’s own server', () => {
	it.each(SAME)('matches %s', (_label, stored, here) => {
		const list = [server(stored)];
		expect(inUseOf(list, here)).toBe(list[0]);
		// The normaliser holds on its own output: a page origin that is already
		// normalised picks the same entry as the messy one.
		expect(inUseOf(list, new URL(here).origin)).toBe(list[0]);
	});

	it.each(DIFFERENT)('is not the same server: %s', (_label, stored, here) => {
		const list = [server(stored, true)];
		// No match, so the bridge's own flag is all that is left.
		expect(inUseOf(list, here)).toBe(list[0]);
		// With no flag it is nothing, not the stored entry by accident.
		expect(inUseOf([server(stored)], here)).toBeNull();
	});

	it('wins over the bridge’s flag, whichever entry carries it', () => {
		// Right after a switch the app has not marked the new server opened: the
		// list's flag is on the server just left, and every reader must agree
		// with the page instead.
		const left = server(HOME, true);
		const here = server(ZEN, false);
		expect(inUseOf([left, here], ZEN)).toBe(here);
		expect(withInUse([left, here], ZEN)).toEqual([
			{ origin: HOME, inUse: false },
			{ origin: ZEN, inUse: true }
		]);
		// A stored copy written another way is the same entry, flag included.
		const messy = server('HTTPS://Zen.Tailnet.ts.net:8443', false);
		expect(inUseOf([left, messy], ZEN)).toBe(messy);
	});

	it('falls back to the bridge’s flag when the page’s origin is no entry', () => {
		const flag = server(ZEN, true);
		const list = [server(HOME), flag];
		for (const here of [
			STUDIO,
			'http://localhost:4383',
			'http://zen.local:42144',
			'not an origin',
			'',
			null
		]) {
			expect(inUseOf(list, here)).toBe(flag);
		}
		// Nothing flagged either: no server in use, rather than the first one.
		expect(inUseOf([server(HOME), server(ZEN)], STUDIO)).toBeNull();
		expect(inUseOf([], HOME)).toBeNull();
	});

	it('an unreadable origin is no match, not a crash', () => {
		// `new URL` throws on the first two and answers the opaque `"null"` for
		// the others; `clean` turns either into no match, so the bridge's flag
		// stands exactly as it does for a page outside every stored server.
		for (const bad of [':::', 'http://', 'file:///tmp/x', 'data:text/html,x', 'null', '']) {
			expect(() => inUseOf([server(HOME, true)], bad)).not.toThrow();
			expect(inUseOf([server(HOME, true)], bad)).toEqual(server(HOME, true));
		}
		// A page with no origin at all (outside a browser) is the same case.
		expect(inUseOf([server(HOME, true)], null)).toEqual(server(HOME, true));
	});
});

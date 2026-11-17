import { afterEach, describe, expect, it, vi } from 'vitest';

/**
 * With no TSUNDOKU_TOKEN, the app lets every request in under `vite dev` and
 * refuses everything otherwise (src/lib/server/auth.ts). Which of the two is
 * decided when the app is compiled, never by NODE_ENV at run time: only
 * scripts/serve.ts sets that, and a bundle started any other way must not
 * open the library. `tests/auth.e2e.ts` starts a real bundle bare.
 */

afterEach(() => {
	vi.resetModules();
	vi.doUnmock('$app/environment');
	vi.doUnmock('$env/dynamic/private');
});

async function authWith(o: { dev: boolean; env: Record<string, string | undefined> }) {
	vi.doMock('$app/environment', () => ({ dev: o.dev, browser: false, building: false }));
	vi.doMock('$env/dynamic/private', () => ({ env: o.env }));
	return import('$lib/server/auth');
}

describe('the no-token bypass', () => {
	it.each([undefined, 'development', 'test', ''])(
		'is off in a built bundle, whatever NODE_ENV says (%j)',
		async (NODE_ENV) => {
			const auth = await authWith({ dev: false, env: { NODE_ENV } });
			expect(auth.authMode()).toEqual({ configured: false, devBypass: false });
			expect(auth.isValidSession(undefined)).toBe(false);
			expect(auth.isValidSession('anything')).toBe(false);
		}
	);

	it('is on under vite dev with no token', async () => {
		const auth = await authWith({ dev: true, env: {} });
		expect(auth.authMode()).toEqual({ configured: false, devBypass: true });
		expect(auth.isValidSession(undefined)).toBe(true);
	});

	it('is never in play once a token is set, even under vite dev', async () => {
		const auth = await authWith({ dev: true, env: { TSUNDOKU_TOKEN: 'tok' } });
		expect(auth.authMode()).toEqual({ configured: true });
		expect(auth.isValidSession(undefined)).toBe(false);
		expect(auth.isValidSession(auth.sessionValueFor('tok'))).toBe(true);
	});
});

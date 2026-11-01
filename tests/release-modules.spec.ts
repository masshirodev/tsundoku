import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { serverModules, spawnedPackages } from '../ops/release/modules.ts';

const root = fileURLToPath(new URL('../', import.meta.url));

describe('the server modules a bundle carries (doc/RELEASE.md)', () => {
	it('are what serve.ts and the launcher import, followed through, from the tree being built', () => {
		const found = serverModules(root);
		// The launcher's and serve.ts's own, and what those import in turn (fspath).
		for (const f of ['bind.ts', 'data-dirs.ts', 'first-run.ts', 'fspath.ts', 'login.ts'])
			expect(found).toContain(f);
		// Nothing the app alone uses: the app is the built server, not these sources.
		expect(found).not.toContain('db.ts');
		expect(found).not.toContain('auth.ts');
	});

	it('include what the server forks by path, and the packages it requires', () => {
		// 2026.10.31.3 left the plugin host out: every novel source said THE PLUGIN HOST STOPPED.
		expect(serverModules(root)).toContain('novels/plugin-host.cjs');
		expect(spawnedPackages(root)).toEqual(
			expect.arrayContaining(['@noble/ciphers', 'cheerio', 'dayjs', 'htmlparser2', 'protobufjs'])
		);
	});
});

import { execFileSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';

/**
 * `yarn run import`, `links`, `ranobe` and the timers run these modules with
 * Node's own type stripping, not through Vite. It refuses TypeScript that
 * needs compiling (parameter properties, enums), which Vitest compiles
 * happily, so only a real import under Node shows it: `node --check` passes
 * them. `ranobe.ts` shipped a parameter property once.
 */
const MODULES = [
	'src/lib/server/ranobe.ts',
	'src/lib/server/tracking.ts',
	'src/lib/server/catalogue.ts',
	'src/lib/server/import/index.ts'
];

describe('modules the scripts load', () => {
	it('load under Node type stripping', () => {
		const code = MODULES.map((m) => `await import(${JSON.stringify(`./${m}`)});`).join('\n');
		const run = () =>
			execFileSync(
				process.execPath,
				['--experimental-strip-types', '--input-type=module', '-e', code],
				{
					env: { ...process.env, DATABASE_PATH: ':memory:', NODE_NO_WARNINGS: '1' },
					stdio: 'pipe'
				}
			);
		expect(run).not.toThrow();
	});
});

import { execFileSync } from 'node:child_process';
import { readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { serverModules } from '../ops/release/modules.ts';

/**
 * Every TypeScript file a release runs without a build step, loaded the way a
 * friend's computer loads it: by Node itself, with its built-in type
 * stripping, which refuses some TypeScript (parameter properties, enums,
 * namespaces). Vitest compiles TypeScript fully and the typecheck only asks
 * whether it's valid TypeScript, so neither saw 2026.10.30.8's launcher die
 * on `constructor(readonly file: string)` before it started anything.
 */
const root = fileURLToPath(new URL('../', import.meta.url));
const launcher = readdirSync(`${root}ops/release/launcher`)
	.filter((f) => f.endsWith('.ts'))
	.map((f) => `ops/release/launcher/${f}`);
const server = serverModules(root).map((f) => `src/lib/server/${f}`);

describe('what a release runs, as Node runs it (strip-only types)', () => {
	it.each([...launcher, ...server, 'scripts/serve.ts', 'ops/release/smoke/fake-update.ts'])(
		'%s parses',
		(file) => {
			// Parsing is the question, not running: --check would skip types, so strip
			// and compile it without executing its top level.
			const out = execFileSync(
				process.execPath,
				[
					'--input-type=module',
					'-e',
					`import { stripTypeScriptTypes } from 'node:module';
					import { readFileSync } from 'node:fs';
					import vm from 'node:vm';
					const js = stripTypeScriptTypes(readFileSync(${JSON.stringify(root + file)}, 'utf8'));
					new vm.SourceTextModule(js);
					console.log('ok');`,
					'--experimental-vm-modules'
				].filter(Boolean),
				{ encoding: 'utf8', stdio: 'pipe' }
			);
			expect(out.trim()).toBe('ok');
		}
	);
});

import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

export /**
 * src/lib/server's modules that the bundle's two scripts reach: serve.ts
 * (from scripts/) and the launcher (whose `../app/src/lib/server/` is this
 * source's `src/lib/server/` once bundled), following relative imports. Names
 * relative to src/lib/server.
 */
function serverModules(root: string): string[] {
	const lib = join(root, 'src/lib/server');
	const seen = new Set<string>();
	const walk = (file: string) => {
		if (seen.has(file)) return;
		seen.add(file);
		const text = readFileSync(file, 'utf8');
		for (const m of text.matchAll(
			/^\s*(?:import|export)\b[^'"]*?\bfrom\s+['"](\.{1,2}\/[^'"]+)['"]/gm
		)) {
			const target = m[1].startsWith('../app/src/lib/server/')
				? join(lib, m[1].slice('../app/src/lib/server/'.length))
				: resolve(dirname(file), m[1]);
			if (target.startsWith(lib) && existsSync(target)) walk(target);
		}
	};
	walk(join(root, 'scripts/serve.ts'));
	walk(join(root, 'ops/release/launcher/launch.ts'));
	return [...seen]
		.filter((f) => f.startsWith(lib + '/'))
		.map((f) => f.slice(lib.length + 1))
		.sort();
}

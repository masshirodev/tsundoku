import { existsSync, readdirSync, readFileSync } from 'node:fs';
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
	for (const f of spawnedFiles(root)) walk(join(lib, f));
	return [...seen]
		.filter((f) => f.startsWith(lib + '/'))
		.map((f) => f.slice(lib.length + 1))
		.sort();
}

/**
 * src/lib/server files the built server opens by path at run time instead of
 * importing (the novels plugin host, which it forks), so no import leads to
 * them and the build doesn't carry them: names relative to src/lib/server,
 * found as a quoted 'src/lib/server/...' anywhere in src/. 2026.10.31.3
 * shipped without plugin-host.cjs, and every novel source said THE PLUGIN
 * HOST STOPPED on every desktop install.
 */
export function spawnedFiles(root: string): string[] {
	const lib = join(root, 'src/lib/server');
	const found = new Set<string>();
	for (const f of readdirSync(join(root, 'src'), { recursive: true, encoding: 'utf8' })) {
		if (!/\.(?:ts|js|cjs|mjs|svelte)$/.test(f)) continue;
		const text = readFileSync(join(root, 'src', f), 'utf8');
		for (const m of text.matchAll(/['"]src\/lib\/server\/([^'"\s]+)['"]/g))
			if (existsSync(join(lib, m[1]))) found.add(m[1]);
	}
	return [...found].sort();
}

/**
 * The npm packages those files `require`: the build's imports don't name
 * them, so without this the bundle leaves them out (cheerio, dayjs,
 * @noble/ciphers and protobufjs, which the plugin host lends to plugins).
 */
export function spawnedPackages(root: string): string[] {
	const names = new Set<string>();
	for (const f of spawnedFiles(root)) {
		const text = readFileSync(join(root, 'src/lib/server', f), 'utf8');
		for (const m of text.matchAll(/\brequire\(\s*['"]([^'".][^'"]*)['"]\s*\)/g)) {
			const spec = m[1];
			if (spec.startsWith('node:')) continue;
			names.add(spec.startsWith('@') ? spec.split('/').slice(0, 2).join('/') : spec.split('/')[0]);
		}
	}
	return [...names].sort();
}

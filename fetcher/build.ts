// Builds the fetcher extension into build-fetcher/, one folder that loads in
// Chromium and Firefox alike: `yarn run build:fetcher`. Each script is bundled
// whole into one classic file, since a content script cannot be a module, and
// left unminified, so the extension a store reviews reads as written.
import { copyFileSync, mkdirSync, rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { build } from 'vite';

const here = fileURLToPath(new URL('.', import.meta.url));
const outDir = fileURLToPath(new URL('../build-fetcher/', import.meta.url));

rmSync(outDir, { recursive: true, force: true });
mkdirSync(outDir, { recursive: true });

for (const name of ['background', 'content']) {
	await build({
		configFile: false,
		logLevel: 'warn',
		build: {
			outDir,
			emptyOutDir: false,
			minify: false,
			// The manifest's floor in Firefox, and a Chromium of the same age.
			target: ['firefox140', 'chrome138'],
			lib: {
				entry: `${here}${name}.ts`,
				formats: ['iife'],
				name: `tsundokuFetcher_${name}`,
				fileName: () => `${name}.js`
			}
		}
	});
}
copyFileSync(`${here}manifest.json`, `${outDir}manifest.json`);
console.log(`fetcher built into ${outDir}`);

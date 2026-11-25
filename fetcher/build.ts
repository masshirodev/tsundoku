// Builds the fetcher extension, one folder that loads in Chromium and
// Firefox alike. Each script is bundled whole into one classic file, since a
// content script cannot be a module, and left unminified, so the extension a
// store reviews reads as written.
//
//   yarn run build:fetcher          the store build, build-fetcher/store/:
//                                   answers https://tsundoku.lt only
//   yarn run build:fetcher --dev    the development build, build-fetcher/development/:
//                                   also loopback http, never to be published
//
// The edition reaches the code as __FETCHER_EDITION__ and the manifest through
// manifestFor(); which origins each answers is decided in
// src/lib/fetcher/protocol.ts alone.
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { build } from 'vite';
import { manifestFor, type FetcherEdition } from '../src/lib/fetcher/protocol.ts';

const edition: FetcherEdition = process.argv.includes('--dev') ? 'development' : 'store';
const here = fileURLToPath(new URL('.', import.meta.url));
const outDir = fileURLToPath(new URL(`../build-fetcher/${edition}/`, import.meta.url));

rmSync(outDir, { recursive: true, force: true });
mkdirSync(outDir, { recursive: true });

for (const name of ['background', 'content']) {
	await build({
		configFile: false,
		logLevel: 'warn',
		define: { __FETCHER_EDITION__: JSON.stringify(edition) },
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
const template = JSON.parse(readFileSync(`${here}manifest.json`, 'utf8'));
writeFileSync(
	`${outDir}manifest.json`,
	`${JSON.stringify(manifestFor(template, edition), null, '\t')}\n`
);
console.log(`fetcher (${edition}) built into ${outDir}`);

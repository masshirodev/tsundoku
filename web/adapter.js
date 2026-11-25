// The web edition's SvelteKit adapter (doc/WEB-EDITION.md). An adapter is
// SvelteKit's public way to package an app for a runtime; this one packages
// it for a browser tab:
//
//   build-web/                   static files, served as they are
//     index.html                 the app's shell (SvelteKit's SPA fallback), started by boot.js
//     _app/...                   the client, exactly as the Node build has it
//     service-worker.js          the app's own service worker, built with __WEB_EDITION__
//     boot.js                    starts the tab: the service worker, the lead, the server
//     server/worker.js           SvelteKit's Server and every route's server code, for a Worker
//     server/files.json          the files above that the service worker keeps for offline use
//
// The self-hosted build never sees this file: vite.config.ts picks it only
// when TSUNDOKU_WEB=1.
import { cpSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'vite';
import { nodeStubs } from './node-stubs.js';

const here = (/** @type {string} */ f) => fileURLToPath(new URL(f, import.meta.url));

/** @param {string} dir @param {string} [root] @returns {string[]} */
function files(dir, root = dir) {
	return readdirSync(dir).flatMap((name) => {
		const p = join(dir, name);
		return statSync(p).isDirectory() ? files(p, root) : [`/${relative(root, p)}`];
	});
}

/** SvelteKit's shell starts the client from an inline script; the shell must
 * wait for boot.js, so that script becomes a function boot.js calls. */
/** @param {string} html */
export function holdTheStart(html) {
	const start = /<script>(\s*\{[\s\S]*?kit\.start\([\s\S]*?)<\/script>/;
	if (!start.test(html)) throw new Error('tsundoku-web: no kit.start script in the fallback page');
	return (
		html
			// The start finds its place through document.currentScript, which is
			// only set while the script first runs: it is kept for the later call.
			.replace(
				start,
				(/** @type {string} */ _, /** @type {string} */ body) =>
					`<script>window.__tsundokuStart = ((__script) => () => ${body.replaceAll('document.currentScript', '__script')})(document.currentScript);</script>`
			)
			.replace('</head>', '<script type="module" src="/boot.js"></script></head>')
	);
}

export default function webAdapter({ out = 'build-web' } = {}) {
	return {
		name: 'tsundoku-web',
		/** @param {import('@sveltejs/kit').Builder} builder */
		async adapt(builder) {
			builder.rimraf(out);
			mkdirSync(out, { recursive: true });
			builder.writeClient(out);
			builder.writePrerendered(out);

			const server = builder.getBuildDirectory('tsundoku-web');
			builder.rimraf(server);
			mkdirSync(server, { recursive: true });
			builder.writeServer(server);
			writeFileSync(
				join(server, 'manifest.js'),
				`export const manifest = ${builder.generateManifest({ relativePath: './' })};\n`
			);

			await builder.generateFallback(join(out, 'index.html'));
			writeFileSync(
				join(out, 'index.html'),
				holdTheStart(readFileSync(join(out, 'index.html'), 'utf8'))
			);

			cpSync(here('./boot.js'), join(out, 'boot.js'));

			await build({
				configFile: false,
				logLevel: 'warn',
				plugins: [
					nodeStubs(),
					{
						name: 'tsundoku-web-server',
						// Before Vite's own resolver, or it finds the real packages.
						enforce: 'pre',
						resolveId(id) {
							if (id === 'tsundoku-web:server') return join(server, 'index.js');
							if (id === 'tsundoku-web:manifest') return join(server, 'manifest.js');
							if (id === 'better-sqlite3') return here('./sqlite.js');
							if (id === 'undici') return here('./undici.js');
							if (id === 'sharp') return here('./sharp.js');
							return null;
						}
					}
				],
				resolve: { conditions: ['worker', 'browser', 'import', 'module', 'default'] },
				define: { 'process.env.NODE_ENV': '"production"' },
				build: {
					outDir: out,
					emptyOutDir: false,
					target: 'es2022',
					minify: true,
					lib: { entry: here('./worker.js'), formats: ['es'], fileName: () => 'server/worker.js' },
					rollupOptions: {
						output: {
							chunkFileNames: 'server/[name]-[hash].js',
							assetFileNames: 'server/[name]-[hash][extname]'
						}
					}
				}
			});
			// What the service worker keeps beside the client's own files (which
			// `$service-worker` lists for it): the shell, boot.js and the server.
			const own = ['/index.html', '/boot.js', ...files(join(out, 'server'), out)];
			writeFileSync(join(out, 'server', 'files.json'), JSON.stringify(own));
			builder.log.minor(`tsundoku-web: ${out}/ (server/worker.js and ${own.length - 3} chunks)`);
		}
	};
}

import adapter from '@sveltejs/adapter-node';
import webAdapter from './web/adapter.js';
import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig } from 'vite';
import { paraglideVitePlugin } from '@inlang/paraglide-js';
import { paraglide } from './paraglide.config.js';

// The web edition is a second build of the same app (doc/WEB-EDITION.md).
const web = process.env.TSUNDOKU_WEB === '1';

export default defineConfig({
	// A constant, never an environment variable: in the self-hosted build it is
	// the literal false, so no setting on a server can turn the web edition's
	// rules (no sign-in) on there.
	define: { __WEB_EDITION__: JSON.stringify(web) },
	plugins: [
		paraglideVitePlugin(paraglide),
		sveltekit({
			compilerOptions: {
				// Force runes mode for the project, except for libraries. Can be removed in svelte 6.
				runes: ({ filename }) =>
					filename.split(/[/\\]/).includes('node_modules') ? undefined : true
			},
			adapter: web ? webAdapter() : adapter(),
			// The web edition registers the app's service worker itself, from
			// web/boot.js: the tab must wait for it before the app starts, since
			// every request for data goes through it (doc/WEB-EDITION.md).
			serviceWorker: { register: !web },
			// SvelteKit refuses a cross-site form post by its Origin header. The
			// web edition's server has no network address: only this origin's
			// own pages reach it, through its service worker, and a Request made
			// in a browser cannot carry an Origin header at all. The self-hosted
			// build keeps the check.
			...(web ? { csrf: { trustedOrigins: ['*'] } } : {}),
			// A deploy reaches the installed app (doc/SERVING.md, "A deploy reaches the
			// tablet"): it asks for the build's version every five minutes.
			// A release names the build after itself (doc/RELEASE.md); otherwise
			// kit's own default, the build's time.
			version: {
				pollInterval: 5 * 60_000,
				...(process.env.TSUNDOKU_VERSION ? { name: process.env.TSUNDOKU_VERSION } : {})
			}
		})
	]
});

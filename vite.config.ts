import adapter from '@sveltejs/adapter-node';
import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig } from 'vite';
import { paraglideVitePlugin } from '@inlang/paraglide-js';
import { paraglide } from './paraglide.config.js';

export default defineConfig({
	plugins: [
		paraglideVitePlugin(paraglide),
		sveltekit({
			compilerOptions: {
				// Force runes mode for the project, except for libraries. Can be removed in svelte 6.
				runes: ({ filename }) =>
					filename.split(/[/\\]/).includes('node_modules') ? undefined : true
			},
			adapter: adapter(),
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

import adapter from '@sveltejs/adapter-node';
import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig } from 'vite';

export default defineConfig({
	plugins: [
		sveltekit({
			compilerOptions: {
				// Force runes mode for the project, except for libraries. Can be removed in svelte 6.
				runes: ({ filename }) =>
					filename.split(/[/\\]/).includes('node_modules') ? undefined : true
			},
			adapter: adapter(),
			// A deploy reaches the installed app (doc/SERVING.md, "A deploy reaches the
			// tablet"): it asks for the build's version every five minutes.
			version: { pollInterval: 5 * 60_000 }
		})
	]
});

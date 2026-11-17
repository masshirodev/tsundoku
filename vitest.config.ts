import { svelte } from '@sveltejs/vite-plugin-svelte';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';
import { paraglideVitePlugin } from '@inlang/paraglide-js';
import { paraglide } from './paraglide.config.js';

// Separate from vite.config.ts, and without `sveltekit()`, for the reasons
// Kumiko gives in its own vitest.config.ts: specs import plain TypeScript and
// `.svelte.ts` rune modules, never components, so the Kit plugin would only
// contribute the $lib alias below while making `svelte-kit sync` a
// prerequisite of every unit test. `vite.config.ts` is also what the Playwright
// webServer builds, so test-only settings there would reach production.
export default defineConfig({
	// `svelte()` for the `.svelte.ts` transform only. configFile: false because
	// there is no svelte.config.js; the compiler options live in vite.config.ts.
	// Paraglide so the specs find src/lib/paraglide compiled (doc/I18N.md).
	plugins: [paraglideVitePlugin(paraglide), svelte({ configFile: false })],
	resolve: {
		alias: {
			$lib: fileURLToPath(new URL('./src/lib', import.meta.url)),
			'$app/paths': fileURLToPath(new URL('./tests/stubs/app-paths.ts', import.meta.url)),
			'$app/environment': fileURLToPath(
				new URL('./tests/stubs/app-environment.ts', import.meta.url)
			)
		}
	},
	test: {
		// The mirror of `testMatch` in playwright.config.ts. The two globs must
		// stay mutually exclusive.
		include: ['tests/**/*.spec.ts'],
		exclude: ['node_modules/**', 'build/**', '.svelte-kit/**', '.claude/**'],
		environment: 'node',
		globals: false,
		// Each spec file in its own process, asserted by tests/vitest.setup.ts.
		// Once the library database exists every spec will open its own SQLite
		// file, and a shared process would quietly share it. Never `threads`:
		// better-sqlite3 is a native addon.
		pool: 'forks',
		isolate: true,
		// The workstation is not throttled; the VPS never runs this suite.
		maxWorkers: 6,
		server: { deps: { external: [/better-sqlite3/] } },
		setupFiles: ['./tests/vitest.setup.ts'],
		globalSetup: ['./tests/vitest.global-setup.ts'],
		coverage: {
			provider: 'v8',
			reporter: ['text-summary', 'html', 'lcov'],
			reportsDirectory: './coverage',
			include: ['src/lib/**/*.ts'],
			exclude: ['src/lib/**/*.d.ts']
		}
	}
});

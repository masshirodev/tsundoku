// The web edition's browser test (doc/WEB-EDITION.md, "Testing";
// doc/TESTING.md, "The web edition"): `yarn run test:web`.
//
// Its own config, not a project of playwright.config.ts: it builds and serves
// another build (`build-web/`, static files whose server runs in the tab),
// needs Firefox beside Chromium, and none of the main suite's seeded
// database, token or engine. Its specs are web/tests/*.e2e.ts, outside the
// main suite's `tests/`, so neither runner collects the other's.
import { defineConfig, devices } from '@playwright/test';

const port = Number.parseInt(process.env.PLAYWRIGHT_WEB_PORT ?? '4185', 10);

export default defineConfig({
	testDir: 'web/tests',
	testMatch: '**/*.e2e.ts',
	// Each test is its own browser context, so its own OPFS and service
	// worker: they can run side by side.
	fullyParallel: true,
	workers: '50%',
	// Every test is a first visit (a service worker installed, one reload,
	// every migration climbed), about 5 s alone and several times that beside
	// the other workers; the takeover test opens three. Measured: 27 s for it
	// alone, past the default 30 s once four ran side by side.
	timeout: 120_000,
	forbidOnly: !!process.env.CI,
	retries: process.env.CI ? 1 : 0,
	reporter: [['list']],
	use: {
		baseURL: `http://localhost:${port}`,
		trace: 'retain-on-failure'
	},
	projects: [
		{
			name: 'chromium',
			use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 } }
		},
		{
			name: 'firefox',
			use: {
				...devices['Desktop Firefox'],
				viewport: { width: 1440, height: 900 },
				launchOptions: {
					// Firefox asks the visitor before it keeps a site's storage
					// (navigator.storage.persist()), and a headless run has nobody to
					// answer it. Firefox's own testing switches answer yes.
					firefoxUserPrefs: {
						'dom.storageManager.prompt.testing': true,
						'dom.storageManager.prompt.testing.allow': true
					}
				}
			}
		}
	],
	webServer: process.env.PLAYWRIGHT_NO_SERVER
		? undefined
		: {
				// The web build writes `.svelte-kit/output` on its way to
				// `build-web/`, like the self-hosted one, so it takes the same
				// lock: never two builds at once, never one under a running preview
				// (scripts/build-lock.mjs).
				command:
					`node scripts/build-lock.mjs --port ${port} ` +
					`--build "yarn run build:web" ` +
					`--serve "PORT=${port} yarn run serve:web"`,
				port,
				reuseExistingServer: !process.env.CI,
				timeout: 300_000
			}
});

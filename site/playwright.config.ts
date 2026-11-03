import { defineConfig } from '@playwright/test';

/**
 * The website in a browser (`yarn run site:test`, after the unit tests). It
 * builds from site/test/fixtures/latest.json, a real latest.json saved from
 * the download host: signed by the release key, so the build opens it exactly
 * as it opens the live one, and the run needs no network.
 */
const port = Number(process.env.SITE_TEST_PORT ?? 42151);

export default defineConfig({
	testDir: 'test',
	testMatch: 'site.e2e.ts',
	fullyParallel: true,
	reporter: process.env.CI ? 'github' : 'list',
	use: { baseURL: `http://localhost:${port}` },
	webServer: {
		command:
			`node --experimental-strip-types build.ts --manifest test/fixtures/latest.json --offline && ` +
			`node --experimental-strip-types serve.ts ${port}`,
		port,
		reuseExistingServer: false,
		timeout: 60_000
	},
	projects: [
		{ name: 'desktop', use: { viewport: { width: 1440, height: 900 } } },
		{
			name: 'phone',
			use: { viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true }
		}
	]
});

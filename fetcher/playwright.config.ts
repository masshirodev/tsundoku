import { defineConfig } from '@playwright/test';

/**
 * The fetcher extension in Chromium and Firefox (`yarn run test:fetcher`,
 * which builds it first). Each test starts its own server and browser, so the
 * two run at once. doc/TESTING.md, "The fetcher extension".
 */
export default defineConfig({
	testDir: 'test',
	testMatch: 'browsers.e2e.ts',
	outputDir: '../test-results/fetcher',
	fullyParallel: true,
	workers: 2,
	timeout: 120_000,
	reporter: process.env.CI ? 'github' : 'list'
});

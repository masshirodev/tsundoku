import { defineConfig, devices } from '@playwright/test';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const previewPort = Number.parseInt(process.env.PLAYWRIGHT_PORT ?? '4183', 10);

// The preview is a production build, so it refuses to serve without a token.
// A throwaway one for the suite, and the session cookie it derives -- the same
// derivation as sessionValueFor() in src/lib/server/auth.ts, which
// tests/auth.e2e.ts checks by actually logging in with the token.
export const E2E_TOKEN = 'e2e-token-not-a-secret';
const session = createHash('sha256').update(`tsundoku/v1:${E2E_TOKEN}`).digest('hex');

// Browser tests must never open the development database. The preview server
// gets a fresh one, seeded with the same sample library `yarn run dev` shows,
// pinned into the environment on first resolution so the runner and every
// worker agree on it (the same reasoning as Kumiko's playwright.config.ts).
const databasePath = (process.env.PLAYWRIGHT_DATABASE_PATH ??= join(
	tmpdir(),
	`tsundoku-e2e-${process.pid}.sqlite`
));

// Shaped after Kumiko's: a production build plus `vite preview`, never the dev
// server, and a test glob that is the exact complement of vitest's
// (`*.e2e.ts` here, `*.spec.ts` there) so no file is collected by both runners.
//
const DEVICE_IGNORE = ['**/build/**', '**/*-flow.e2e.ts', '**/library-frame.e2e.ts'];

// The projects are the devices the design system names: the tablet the library
// is read on, in both orientations, and a phone. A frame assertion that holds
// on one and not another is exactly what these exist to catch.
export default defineConfig({
	testDir: 'tests',
	testMatch: '**/*.e2e.{ts,js}',
	testIgnore: ['**/build/**'],
	fullyParallel: true,
	reporter: process.env.CI ? 'github' : 'list',
	use: {
		baseURL: `http://localhost:${previewPort}`,
		storageState: {
			cookies: [
				{
					name: 'tsundoku_session',
					value: session,
					domain: 'localhost',
					path: '/',
					expires: -1,
					httpOnly: true,
					secure: false,
					sameSite: 'Lax'
				}
			],
			origins: []
		}
	},
	webServer: process.env.PLAYWRIGHT_NO_SERVER
		? undefined
		: {
				command:
					`rm -f ${databasePath}* && yarn run seed && yarn run build && ` +
					`yarn run preview --port ${previewPort} --strictPort`,
				// An empty library folder: START SCAN must never import real files
				// into the seeded database the suite asserts against.
				env: {
					DATABASE_PATH: databasePath,
					TSUNDOKU_TOKEN: E2E_TOKEN,
					LIBRARY_ROOT: join(tmpdir(), 'tsundoku-e2e-empty-library')
				},
				port: previewPort,
				reuseExistingServer: !process.env.CI,
				timeout: 180_000
			},
	projects: [
		{
			name: 'tablet-portrait',
			use: { ...devices['Galaxy Tab S4'], viewport: { width: 800, height: 1280 } }
		},
		// Flow specs write to the shared seeded database, so they run once, above.
		// The generated frame spec pins the tablet-portrait frame the handoff was
		// extracted at; the other devices are covered by library-layout.e2e.ts.
		{
			name: 'tablet-landscape',
			testIgnore: DEVICE_IGNORE,
			use: { ...devices['Galaxy Tab S4 landscape'], viewport: { width: 1280, height: 800 } }
		},
		{ name: 'phone', testIgnore: DEVICE_IGNORE, use: { ...devices['Pixel 7'] } },
		{
			name: 'desktop',
			testIgnore: DEVICE_IGNORE,
			use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 } }
		}
	]
});

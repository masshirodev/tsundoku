import { defineConfig, devices } from '@playwright/test';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { BROWSE_PORT } from './tests/browse-world';

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
const DEVICE_IGNORE = [
	'**/build/**',
	'**/browse-*.e2e.ts',
	'**/*-flow.e2e.ts',
	'**/library-frame.e2e.ts',
	// SETTINGS' frame is its tablet-portrait screen; the other devices are in settings-flow.
	'**/settings-frame.e2e.ts',
	'**/unlock-gate.e2e.ts'
];

// The projects are the devices the design system names: the tablet the library
// is read on, in both orientations, and a phone. A frame assertion that holds
// on one and not another is exactly what these exist to catch.
export default defineConfig({
	testDir: 'tests',
	testMatch: '**/*.e2e.{ts,js}',
	testIgnore: ['**/build/**'],
	fullyParallel: true,
	// BROWSE's own server and fake engine, started after the shared server has
	// built (tests/browse-setup.ts): the browse project below runs against it.
	globalSetup: './tests/browse-setup.ts',
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
					// Covers, trash and the engine's store too: never the user's data folder.
					TSUNDOKU_HOME: join(tmpdir(), 'tsundoku-e2e-home'),
					LIBRARY_ROOT: join(tmpdir(), 'tsundoku-e2e-empty-library'),
					// Nor may a snapshot of the test database land beside the real ones.
					BACKUP_DIR: join(tmpdir(), 'tsundoku-e2e-backups'),
					// Nor may it reach AniList: a paste reads as unreachable (doc/LINKS.md).
					TSUNDOKU_ANILIST: 'off'
				},
				port: previewPort,
				reuseExistingServer: !process.env.CI,
				timeout: 180_000
			},
	projects: [
		{
			name: 'tablet-portrait',
			// The gate changes /reveal for everyone; it runs last, in its own project.
			// The duplicates flow runs alone before it (see its project, below).
			testIgnore: [
				'**/build/**',
				'**/unlock-gate.e2e.ts',
				'**/duplicates-flow.e2e.ts',
				'**/browse-*.e2e.ts'
			],
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
		},
		{
			// BROWSE (doc/BROWSE.md) against its own server and fake engine, which
			// specs steer, so one worker at a time.
			name: 'browse',
			testMatch: '**/browse-*.e2e.ts',
			fullyParallel: false,
			workers: 1,
			use: {
				...devices['Galaxy Tab S4'],
				viewport: { width: 800, height: 1280 },
				baseURL: `http://localhost:${BROWSE_PORT}`
			}
		},
		{
			// Any load of the library carries out a duplicate decision left
			// waiting (src/routes/+page.server.ts), so beside the other workers
			// KEEP B was carried out in milliseconds and UNDO had nothing to take
			// back: Rakugaki was deleted and the next test lost its pair. Alone,
			// after every device, nothing else loads the library meanwhile.
			name: 'duplicates',
			testMatch: '**/duplicates-flow.e2e.ts',
			dependencies: ['tablet-portrait', 'tablet-landscape', 'phone', 'desktop'],
			use: { ...devices['Galaxy Tab S4'], viewport: { width: 800, height: 1280 } }
		},
		{
			name: 'gate',
			testMatch: '**/unlock-gate.e2e.ts',
			dependencies: ['tablet-portrait', 'tablet-landscape', 'phone', 'desktop', 'duplicates'],
			use: { ...devices['Galaxy Tab S4'], viewport: { width: 800, height: 1280 } }
		}
	]
});

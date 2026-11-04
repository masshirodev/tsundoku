// First, for its side effect: this run's own temporary directory, which
// every tmpdir() below and in the suite resolves to (tests/helpers/run-dir.ts).
import './tests/helpers/run-dir';
import { defineConfig, devices } from '@playwright/test';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { BROWSE_PORT } from './tests/browse-world';
import { FRIEND_PORT } from './tests/friend-world';

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
	'**/friend-*.e2e.ts',
	'**/*-flow.e2e.ts',
	'**/library-frame.e2e.ts',
	// The TV's own specs run in the `tv` project, whose Chromium has no pointer.
	'**/tv-*.e2e.ts',
	// SETTINGS' frame is its tablet-portrait screen; the other devices are in settings-flow.
	'**/settings-frame.e2e.ts',
	// GET STARTED's and HELP's frames are pinned at tablet-portrait too (doc/ONBOARDING.md, doc/HELP.md).
	'**/start-frame.e2e.ts',
	'**/first-read-frame.e2e.ts',
	'**/help-frame.e2e.ts',
	'**/unlock-gate.e2e.ts',
	// Works' two frames make the Work they measure, and end it again: they run
	// in their own project, after the devices, so no reader sees it (doc/WORKS.md).
	'**/works-library-frame.e2e.ts',
	'**/work-screen-frame.e2e.ts',
	'**/work-end-frame.e2e.ts',
	'**/work-group-frame.e2e.ts',
	'**/work-row-frame.e2e.ts',
	// The Works flow groups series into Works, so it seeds and serves a database
	// of its own (tests/works-flow.e2e.ts) and runs in its own project.
	'**/works-flow.e2e.ts'
];

// The projects are the devices the design system names: the tablet the library
// is read on, in both orientations, and a phone. A frame assertion that holds
// on one and not another is exactly what these exist to catch.
export default defineConfig({
	testDir: 'tests',
	testMatch: '**/*.e2e.{ts,js}',
	testIgnore: ['**/build/**'],
	fullyParallel: true,
	// Half the logical cores, whatever else the box is doing (doc/TESTING.md,
	// "Load"). Measured in wave 19 with the box loaded: three workers instead of
	// six took 17.7 minutes instead of 14.7 and failed no fewer tests. A test
	// that fails under load waits on time instead of the page's own state, and
	// fewer workers only hides that. `--workers` still overrides it.
	workers: '50%',
	// Tests left out of every project by title, as a regular expression
	// (doc/TESTING.md, "Load"). The CLI's `--grep-invert` cannot do this:
	// Playwright never applies a command-line filter to a dependency project, so
	// a known red in a device project still runs and still keeps `duplicates`
	// and `gate`, which depend on all of them, from running at all. A filter in
	// the config is the projects' own, dependencies included.
	grepInvert: process.env.PLAYWRIGHT_SKIP ? new RegExp(process.env.PLAYWRIGHT_SKIP) : undefined,
	// BROWSE's own server and fake engine, started after the shared server has
	// built (tests/browse-setup.ts): the browse project below runs against it.
	// And a friend's install (tests/friend-setup.ts), for the friend project.
	// The run's directory first, so its teardown -- removing it -- runs last.
	globalSetup: ['./tests/helpers/run-dir.ts', './tests/browse-setup.ts', './tests/friend-setup.ts'],
	// The second names the tests that did not run and the reds that kept them
	// out (tests/helpers/not-run-reporter.ts, c439): a bare "12 did not run" was
	// read as a green `duplicates` and `gate` in wave 19's gate.
	reporter: [[process.env.CI ? 'github' : 'list'], ['./tests/helpers/not-run-reporter.ts']],
	use: {
		baseURL: `http://localhost:${previewPort}`,
		// The specs read English (doc/I18N.md): AUTO follows the browser, so the
		// browser is told what to say rather than inheriting the machine's.
		locale: 'en-US',
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
				// kuromoji's dictionary is `yarn prepare`'s copy, untracked, so a
				// worktree that never ran it builds an app whose lookup has no
				// words (c249): copied here, before the build takes static/.
				command:
					`rm -f ${databasePath}* && yarn run seed && ` +
					`node node_modules/kotoba/scripts/sync-dict.js static/dict > /dev/null && ` +
					`yarn run build && yarn run preview --port ${previewPort} --strictPort`,
				// An empty library folder: START SCAN must never import real files
				// into the seeded database the suite asserts against.
				env: {
					DATABASE_PATH: databasePath,
					TSUNDOKU_TOKEN: E2E_TOKEN,
					// The instance's public origin, as scripts/serve.ts sets it for a
					// tailnet install (c245): a TV's paired cookie is a door only on
					// this host, never localhost, so a spec can name it with a Host
					// header. `vite preview` never reads it for a URL; the hook does.
					ORIGIN: `http://tsundoku.test:${previewPort}`,
					// Vite refuses a Host it hasn't been told about; the e2e's
					// tailnet name is the one the origin above uses.
					__VITE_ADDITIONAL_SERVER_ALLOWED_HOSTS: 'tsundoku.test',
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
				'**/browse-*.e2e.ts',
				'**/friend-*.e2e.ts',
				// The TV's own specs run in the `tv` project, whose Chromium has no pointer.
				'**/tv-*.e2e.ts',
				// Works' frames make the Work they measure; they run in `works-frame`.
				'**/works-library-frame.e2e.ts',
				'**/work-screen-frame.e2e.ts',
				'**/work-end-frame.e2e.ts',
				'**/work-group-frame.e2e.ts',
				'**/work-row-frame.e2e.ts',
				// The Works flow seeds and serves its own database: `works-flow`.
				'**/works-flow.e2e.ts'
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
			// A TV (c238, doc/TV.md): 960x540 CSS px, no pointer and no hover. A
			// context cannot set the pointer type, so Chromium is told through
			// Blink's media-feature settings at launch. `availablePointerTypes`
			// and `availableHoverTypes` are the pair that makes
			// matchMedia('(pointer: none)') true; setting the primary ones as
			// well turns it false again (tests/tv-layout.e2e.ts proves both the
			// query and the TV variables, so this cannot rot silently).
			name: 'tv',
			testMatch: ['**/tv-*.e2e.ts', '**/library-layout.e2e.ts', '**/series-layout.e2e.ts'],
			use: {
				...devices['Desktop Chrome'],
				viewport: { width: 960, height: 540 },
				deviceScaleFactor: 1,
				launchOptions: {
					args: ['--blink-settings=availablePointerTypes=none,availableHoverTypes=none']
				}
			}
		},
		{
			// Works' frames (c276, c277): each seeds a database of its own and
			// serves the build on its own port, so they need not queue behind
			// anything. The viewport is the board's own 1280, where the Work
			// screen draws its 440 panel beside the run.
			name: 'works-frame',
			testMatch: [
				'**/works-library-frame.e2e.ts',
				'**/work-screen-frame.e2e.ts',
				'**/work-end-frame.e2e.ts',
				'**/work-group-frame.e2e.ts',
				'**/work-row-frame.e2e.ts'
			],
			fullyParallel: false,
			workers: 1,
			use: { ...devices['Galaxy Tab S4 landscape'], viewport: { width: 1280, height: 800 } }
		},
		{
			// The Works flow (c276, c277): every case groups series into a Work,
			// and a Work takes its parts' own grid tiles away while it exists.
			// It seeds a database of its own and serves the build on one of its
			// own ports, like `works-frame`, so no other spec's grid lookups can
			// see a Work and a case that fails halfway cannot leave one behind.
			name: 'works-flow',
			testMatch: ['**/works-flow.e2e.ts'],
			fullyParallel: false,
			workers: 1,
			use: { ...devices['Galaxy Tab S4'], viewport: { width: 800, height: 1280 } }
		},
		{
			// A friend's install (doc/SIGN-IN.md): SET UP, a password, none. One
			// login.json for the whole server, so one worker, in order, signed out.
			name: 'friend',
			testMatch: '**/friend-*.e2e.ts',
			fullyParallel: false,
			workers: 1,
			use: {
				...devices['Desktop Chrome'],
				viewport: { width: 1440, height: 900 },
				baseURL: `http://localhost:${FRIEND_PORT}`,
				storageState: { cookies: [], origins: [] }
			}
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
			dependencies: ['tablet-portrait', 'tablet-landscape', 'phone', 'desktop', 'tv'],
			use: { ...devices['Galaxy Tab S4'], viewport: { width: 800, height: 1280 } }
		},
		{
			name: 'gate',
			testMatch: '**/unlock-gate.e2e.ts',
			dependencies: ['tablet-portrait', 'tablet-landscape', 'phone', 'desktop', 'tv', 'duplicates'],
			use: { ...devices['Galaxy Tab S4'], viewport: { width: 800, height: 1280 } }
		}
	]
});

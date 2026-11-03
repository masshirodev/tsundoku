import { defineConfig } from '@playwright/test';
import { existsSync, mkdirSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/**
 * `yarn run site:captures` (doc/WEBSITE.md, "Captures"): the app built and
 * served on the seed library, the way playwright.config.ts serves it for the
 * e2e suite, in a scratch folder of its own that globalTeardown removes. The
 * scratch goes on /mnt/hdd2 when it exists: /tmp is RAM on the workstation.
 */
export const CAPTURE_PORT = Number(process.env.SITE_CAPTURE_PORT ?? 4193);
export const CAPTURE_TOKEN = 'site-captures-token-not-a-secret';

const base = existsSync('/mnt/hdd2') ? '/mnt/hdd2/tmp' : tmpdir();
mkdirSync(base, { recursive: true });
const scratch = (process.env.SITE_CAPTURE_SCRATCH ??= mkdtempSync(
	join(base, 'tsundoku-site-captures-')
));

export default defineConfig({
	testDir: 'test',
	testMatch: 'captures.e2e.ts',
	fullyParallel: false,
	workers: 1,
	reporter: 'list',
	timeout: 120_000,
	globalTeardown: './captures-teardown.ts',
	webServer: {
		command:
			`cd .. && yarn run seed && node --experimental-strip-types site/captures-db.ts && yarn run build && ` +
			`yarn run preview --port ${CAPTURE_PORT} --strictPort`,
		env: {
			DATABASE_PATH: join(scratch, 'tsundoku.sqlite'),
			TSUNDOKU_TOKEN: CAPTURE_TOKEN,
			TSUNDOKU_HOME: join(scratch, 'home'),
			LIBRARY_ROOT: join(scratch, 'empty-library'),
			BACKUP_DIR: join(scratch, 'backups'),
			TSUNDOKU_ANILIST: 'off'
		},
		port: CAPTURE_PORT,
		reuseExistingServer: false,
		timeout: 300_000
	}
});

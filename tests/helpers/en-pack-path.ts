import { tmpdir } from 'node:os';
import { join } from 'node:path';

/**
 * Where the e2e run's English pack lives (c198): the same file the preview
 * server is told about (`playwright.config.ts`) and the one globalSetup writes
 * (`en-pack-setup.ts`).
 *
 * It sits under the suite's own home, never the user's: a fixture dictionary in
 * a real pack folder would answer real lookups with five words.
 */
export const EN_PACK_PATH = join(tmpdir(), 'tsundoku-e2e-home', 'packs', 'en-wiktionary.db');

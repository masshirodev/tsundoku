import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/**
 * Once for the whole run, in vitest's main process, before any spec process
 * is forked (they inherit what's set here). No spec writes into the live
 * library by accident: every data folder defaults to TSUNDOKU_HOME
 * (data-dirs.ts), and until 2026-10-29 the duplicate-books spec kept its page
 * thumbnails in the live covers folder, under entry ids the real library also
 * has. A spec that wants its own sets its own; these are the defaults.
 *
 * Removed at teardown, which runs even when a spec process is killed: /tmp is
 * RAM on the workstation (doc/TESTING.md).
 */
export default function setup() {
	// A git hook runs with GIT_DIR (and GIT_INDEX_FILE, GIT_WORK_TREE...) set to
	// the repository being pushed, and pre-push runs these specs. A spec that
	// spawns `git` in a scratch folder then inherits them and acts on the real
	// repository instead: on 2026-11-07, build-lock.spec's `git init` in its
	// temp dir re-initialised the main checkout's .git as `core.bare = true`
	// (and its `git commit` could as well have committed there). Clearing them
	// here, before any spec process is forked, covers every spec and every
	// script a spec runs; no spec has a reason to inherit them.
	for (const name of Object.keys(process.env))
		if (name.startsWith('GIT_')) delete process.env[name];

	const base = mkdtempSync(join(tmpdir(), 'tsundoku-specs-'));
	for (const [name, dir] of [
		['TSUNDOKU_HOME', 'home'],
		['COVER_DIR', 'covers'],
		['ENGINE_STORE', 'engine-store']
	] as const) {
		if (process.env[name]) continue;
		mkdirSync(join(base, dir));
		process.env[name] = join(base, dir);
	}
	return () => rmSync(base, { recursive: true, force: true });
}

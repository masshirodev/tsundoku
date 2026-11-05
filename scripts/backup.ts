/**
 * Snapshot the library database and prune old snapshots (doc/BACKUPS.md):
 *
 *   yarn run backup                  # DATABASE_PATH from .env, into BACKUP_DIR
 *   yarn run backup --verify <f>     # check an existing snapshot opens and is whole
 *
 * Safe while the server is running. The nightly timer in ops/systemd/ runs it.
 * After the snapshot it sweeps covers/episodes/ of the pictures and sprites
 * of entries that are gone (src/lib/server/anime/episode-files.ts, c454).
 */
import Database from 'better-sqlite3';
import { fileURLToPath } from 'node:url';
import { databasePath } from '../src/lib/server/db.ts';
import { backupDir, takeSnapshot, verify } from '../src/lib/server/backup.ts';
import { sweepEpisodeFiles } from '../src/lib/server/anime/episode-files.ts';

try {
	process.loadEnvFile(fileURLToPath(new URL('../.env', import.meta.url)));
} catch {
	// No .env: the defaults, or whatever the shell set.
}

const flag = process.argv.indexOf('--verify');
try {
	if (flag >= 0) {
		const file = process.argv[flag + 1];
		const v = verify(file);
		console.log(`${file}: ok, v${v.userVersion}, ${v.series} series, ${v.entries} entries`);
	} else {
		const s = takeSnapshot(databasePath(), { dir: backupDir() });
		const mb = (s.bytes / 1024 / 1024).toFixed(1);
		console.log(
			`saved ${s.path} (${mb} MB, v${s.userVersion}, ${s.series} series, ${s.entries} entries)`
		);
		for (const p of s.pruned) console.log(`pruned ${p}`);
		sweep();
	}
} catch (e) {
	console.error(`backup failed: ${e instanceof Error ? e.message : String(e)}`);
	process.exit(1);
}

/** The episode files' sweep: a failure is said, and never fails the backup that ran. */
function sweep(): void {
	try {
		// Read-only: this script never writes the live database (TSUNDOKU_MIGRATE=off).
		const db = new Database(databasePath(), { readonly: true, fileMustExist: true });
		try {
			const gone = sweepEpisodeFiles(db);
			if (gone.length) console.log(`swept ${gone.length} episode files of entries that are gone`);
		} finally {
			db.close();
		}
	} catch (e) {
		console.error(`episode files' sweep failed: ${e instanceof Error ? e.message : String(e)}`);
	}
}

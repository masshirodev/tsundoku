/**
 * Snapshot the library database and prune old snapshots (doc/BACKUPS.md):
 *
 *   yarn run backup                  # DATABASE_PATH from .env, into BACKUP_DIR
 *   yarn run backup --verify <f>     # check an existing snapshot opens and is whole
 *
 * Safe while the server is running. The nightly timer in ops/systemd/ runs it.
 */
import { fileURLToPath } from 'node:url';
import { databasePath } from '../src/lib/server/db.ts';
import { backupDir, takeSnapshot, verify } from '../src/lib/server/backup.ts';

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
	}
} catch (e) {
	console.error(`backup failed: ${e instanceof Error ? e.message : String(e)}`);
	process.exit(1);
}

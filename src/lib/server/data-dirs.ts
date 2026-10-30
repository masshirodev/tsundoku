import { homedir } from 'node:os';
import { pathsFor } from './fspath.ts';

/**
 * Where tsundoku keeps what isn't the code: the library, covers, trash, the
 * engine's store, OCR scratch and database snapshots (doc/DISTRIBUTION.md,
 * "One data directory").
 *
 * Everything derives from one folder, TSUNDOKU_HOME, so a friend's install
 * needs one setting and the workstation one line. Each folder's own variable
 * (LIBRARY_ROOT, COVER_DIR, ...) still wins over the derived default.
 *
 * Unset, TSUNDOKU_HOME is the platform's place for app data. It used to be
 * /mnt/hdd2/tsundoku for everything, which only exists on the workstation;
 * the workstation now says so itself (TSUNDOKU_HOME in .env and every unit,
 * doc/SERVING.md).
 */

type Env = Record<string, string | undefined>;
type Platform = NodeJS.Platform;

/** The platform's app-data folder for tsundoku, when TSUNDOKU_HOME is unset. */
export function defaultHome(
	platform: Platform = process.platform,
	env: Env = process.env,
	home: string = homedir()
): string {
	const p = pathsFor(platform);
	if (platform === 'win32')
		return p.join(env.LOCALAPPDATA || p.join(home, 'AppData', 'Local'), 'tsundoku');
	if (platform === 'darwin') return p.join(home, 'Library', 'Application Support', 'tsundoku');
	return p.join(env.XDG_DATA_HOME || p.join(home, '.local', 'share'), 'tsundoku');
}

/** Every folder tsundoku keeps, as this environment says. */
export function dataPaths(
	env: Env = process.env,
	platform: Platform = process.platform,
	home: string = homedir()
) {
	const p = pathsFor(platform);
	// A folder given by its own variable is written the same way as a derived one.
	const given = (value: string | undefined) => (value ? p.join(value) : undefined);
	const root = given(env.TSUNDOKU_HOME) ?? defaultHome(platform, env, home);
	const engineStore = given(env.ENGINE_STORE) ?? p.join(root, 'engine', 'store');
	return {
		home: root,
		library: given(env.LIBRARY_ROOT) ?? p.join(root, 'library'),
		covers: given(env.COVER_DIR) ?? p.join(root, 'covers'),
		trash: given(env.TRASH_DIR) ?? p.join(root, 'trash'),
		backups: given(env.BACKUP_DIR) ?? p.join(root, 'backups'),
		engineStore,
		novelStore: given(env.NOVEL_STORE) ?? p.join(engineStore, 'novels'),
		ocrScratch: given(env.OCR_SCRATCH) ?? p.join(root, 'ocr-scratch'),
		// A Python venv keeps its programs in Scripts\ on Windows, bin/ elsewhere.
		mokuro:
			given(env.MOKURO_BIN) ??
			(platform === 'win32'
				? p.join(root, 'mokuro', 'venv', 'Scripts', 'mokuro.exe')
				: p.join(root, 'mokuro', 'venv', 'bin', 'mokuro'))
	};
}

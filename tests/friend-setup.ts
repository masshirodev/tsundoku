import { spawn, execFileSync, type ChildProcess } from 'node:child_process';
import { mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { FRIEND_HOME, FRIEND_PORT } from './friend-world';

/**
 * A friend's install, for tests/friend-*.e2e.ts: the shared build served the
 * way a release serves it, through scripts/serve.ts in local mode with a
 * friend's sign-in (doc/SIGN-IN.md), so its Wi-Fi listeners are the real ones
 * (doc/WIFI.md) -- `vite preview` has none. A global setup, so it starts after
 * the shared server has built, as BROWSE's does (tests/browse-setup.ts).
 */
export default async function setup() {
	const dbPath = join(tmpdir(), `tsundoku-e2e-friend-${process.pid}.sqlite`);
	rmSync(dbPath, { force: true });
	rmSync(FRIEND_HOME, { recursive: true, force: true });
	mkdirSync(join(FRIEND_HOME, 'library'), { recursive: true });
	execFileSync(process.execPath, ['--experimental-strip-types', 'scripts/seed.ts'], {
		env: { ...process.env, DATABASE_PATH: dbPath, NODE_NO_WARNINGS: '1' },
		stdio: 'pipe'
	});
	const origin = `http://localhost:${FRIEND_PORT}`;
	// A server already there is an earlier run's, and testing it would test
	// stale code and state: say so instead (it happened once, 2026-10-30).
	const busy = await fetch(`${origin}/manifest.webmanifest`).then(
		() => true,
		() => false
	);
	if (busy)
		throw new Error(
			`port ${FRIEND_PORT} is taken, probably by an earlier run's friend server: stop it first`
		);
	const preview: ChildProcess = spawn(
		process.execPath,
		['--experimental-strip-types', '--disable-warning=ExperimentalWarning', 'scripts/serve.ts'],
		{
			env: {
				...process.env,
				// What the launcher sets (ops/release/launcher/plan.ts): no token at all.
				TSUNDOKU_LOGIN: 'password',
				TSUNDOKU_SERVE: 'local',
				TSUNDOKU_SNAPSHOT: 'off',
				// Never the owner's tokens from the project's .env (scripts/serve.ts).
				TSUNDOKU_PROJECT_ENV: 'off',
				PORT: String(FRIEND_PORT),
				TSUNDOKU_TOKEN: '',
				TSUNDOKU_UPDATES: 'off',
				DATABASE_PATH: dbPath,
				TSUNDOKU_HOME: FRIEND_HOME,
				LIBRARY_ROOT: join(FRIEND_HOME, 'library'),
				BACKUP_DIR: join(FRIEND_HOME, 'backups'),
				// Nothing real: no engine, no AniList.
				ENGINE_URL: 'http://127.0.0.1:1',
				TSUNDOKU_ANILIST: 'off'
			},
			stdio: 'ignore'
		}
	);
	let up = false;
	for (let i = 0; i < 120 && !up; i++) {
		try {
			// tsundoku's own manifest, not just anything on the port (BROWSE's
			// fake engine has its own, from the OS unless assigned, c625).
			const r = await fetch(`${origin}/manifest.webmanifest`);
			up = r.ok && ((await r.json()) as { short_name?: string }).short_name === 'tsundoku';
			if (!up) throw new Error(`port ${FRIEND_PORT} answers, but not as tsundoku`);
		} catch (e) {
			if (e instanceof Error && e.message.includes('but not as tsundoku')) throw e;
			await new Promise((r) => setTimeout(r, 500));
		}
	}
	if (!up) throw new Error('the friend preview never answered');
	return async () => {
		preview.kill();
		// Its Wi-Fi listeners went with it; the switch is the data folder's, gone below.
		rmSync(dbPath, { force: true });
		rmSync(FRIEND_HOME, { recursive: true, force: true });
	};
}

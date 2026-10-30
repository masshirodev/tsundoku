import { spawn, execFileSync, type ChildProcess } from 'node:child_process';
import { mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { FRIEND_HOME, FRIEND_PORT } from './friend-world';

/**
 * A friend's install, for tests/friend-*.e2e.ts: a preview of the shared build
 * with a friend's sign-in (doc/SIGN-IN.md). A global setup, so it starts after
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
	const preview: ChildProcess = spawn(
		'npx',
		['vite', 'preview', '--port', String(FRIEND_PORT), '--strictPort'],
		{
			env: {
				...process.env,
				// What the launcher sets (ops/release/launcher/plan.ts): no token at all.
				TSUNDOKU_LOGIN: 'password',
				TSUNDOKU_SERVE: 'local',
				ORIGIN: origin,
				TSUNDOKU_TOKEN: '',
				DATABASE_PATH: dbPath,
				TSUNDOKU_HOME: FRIEND_HOME,
				LIBRARY_ROOT: join(FRIEND_HOME, 'library'),
				BACKUP_DIR: join(FRIEND_HOME, 'backups'),
				// Nothing real: no engine, no AniList.
				ENGINE_URL: 'http://127.0.0.1:1',
				SUWAYOMI_URL: '',
				TSUNDOKU_ANILIST: 'off'
			},
			stdio: 'ignore'
		}
	);
	let up = false;
	for (let i = 0; i < 120 && !up; i++) {
		try {
			// tsundoku's own manifest, not just anything on the port (4195 is BROWSE's
			// fake engine, which once passed for this server).
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
		rmSync(dbPath, { force: true });
		rmSync(FRIEND_HOME, { recursive: true, force: true });
	};
}

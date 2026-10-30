import { tmpdir } from 'node:os';
import { join } from 'node:path';

/**
 * A friend's install for the browser suite (doc/SIGN-IN.md; card c189): the
 * same build, served as a release's launcher serves it (TSUNDOKU_LOGIN=password,
 * local mode), on its own port, database and data folder. tests/friend-setup.ts
 * starts it; tests/friend-*.e2e.ts drive it.
 */
export const FRIEND_PORT = Number(process.env.PLAYWRIGHT_FRIEND_PORT ?? 4197);
/** Its data folder, where login.json lives: the specs reset it as the launcher would. */
export const FRIEND_HOME = join(tmpdir(), `tsundoku-e2e-friend-home-${FRIEND_PORT}`);

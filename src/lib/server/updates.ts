import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createWriteStream, mkdirSync, readdirSync, renameSync, rmSync } from 'node:fs';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { version } from '$app/environment';
import { env } from '$env/dynamic/private';
import { withoutServerEnv } from './bind.ts';
import { dataPaths } from './data-dirs.ts';
import { join } from './fspath.ts';
import {
	VERSION_RE,
	fileUrl,
	newer,
	openManifest,
	type Manifest,
	type ReleaseFile
} from './update-manifest.ts';

/**
 * Updates for a friend's install (doc/UPDATES.md; card c182). Never automatic:
 * tsundoku looks for a new release once a day and says so; the friend
 * presses UPDATE. On Windows, installed, that downloads the installer,
 * checks it against the signed manifest, and runs it silently: it stops
 * tsundoku, replaces the program and starts it again (`/RELAUNCH`). Elsewhere
 * (Linux, the zip) it's a download link and the steps.
 *
 * On only where the launcher says where releases are (TSUNDOKU_UPDATES) and
 * the build is a release's (a dated version): the workstation is neither.
 * TSUNDOKU_UPDATES=off in the data folder's .env turns the check off.
 */

export type Install =
	| { phase: 'downloading'; bytes: number; total: number }
	| { phase: 'installing' }
	| { phase: 'failed'; error: string };

export type UpdateView = {
	current: string;
	checkedAt: number | null;
	/** The newest release, when it's newer than this one. */
	available: Pick<Manifest, 'version' | 'date' | 'notes'> | null;
	/** UPDATE runs the installer (Windows, installed); otherwise a DOWNLOAD link. */
	how: 'install' | 'download';
	download: string | null;
	error: string | null;
	install: Install | null;
};

const DAY = 24 * 60 * 60 * 1000;

let checkedAt: number | null = null;
let latest: Manifest | null = null;
let error: string | null = null;
let checking: Promise<void> | null = null;
let install: Install | null = null;

const base = () => (env.TSUNDOKU_UPDATES ?? '').trim();

export function updatesOn(): boolean {
	const b = base();
	return /^https?:\/\//.test(b) && VERSION_RE.test(version);
}

/** Installed by the installer (the launcher says so), and on Windows: UPDATE can run the next one. */
const installs = () => process.platform === 'win32' && env.TSUNDOKU_INSTALLED === '1';

function fileFor(m: Manifest): ReleaseFile | undefined {
	if (process.platform === 'win32')
		return installs() ? m.files['win-x64']?.installer : m.files['win-x64']?.zip;
	if (process.platform === 'linux') return m.files['linux-x64']?.archive;
	return undefined;
}

/** Installers already run: every version folder that isn't newer than this one (~230 MB each). */
function clearInstalled() {
	const dir = join(dataPaths().home, 'updates');
	try {
		for (const v of readdirSync(dir))
			if (!VERSION_RE.test(v) || !newer(v, version))
				rmSync(join(dir, v), { recursive: true, force: true });
	} catch {
		// No updates folder yet.
	}
}

/** Ask the release host, now. Never throws: a failure is kept as `error`. */
export function check(): Promise<void> {
	if (!updatesOn()) return Promise.resolve();
	checking ??= (async () => {
		clearInstalled();
		try {
			const r = await fetch(`${base().replace(/\/+$/, '')}/latest.json`, {
				signal: AbortSignal.timeout(15_000),
				cache: 'no-store'
			});
			if (!r.ok) throw new Error(`the release host answered ${r.status}`);
			const opened = openManifest(await r.text());
			if (!opened.ok) throw new Error(`refused latest.json: ${opened.reason}`);
			latest = opened.manifest;
			error = null;
		} catch (e) {
			error = e instanceof Error ? e.message : String(e);
		} finally {
			checkedAt = Date.now();
			checking = null;
		}
	})();
	return checking;
}

/** Check if the last one is older than `maxAge`, without waiting for it. */
export function checkIfStale(maxAge = DAY): void {
	if (updatesOn() && (checkedAt === null || Date.now() - checkedAt > maxAge)) void check();
}

export function updateView(): UpdateView | null {
	if (!updatesOn()) return null;
	const avail = latest && newer(latest.version, version) ? latest : null;
	const file = avail ? fileFor(avail) : undefined;
	return {
		current: version,
		checkedAt,
		available: avail ? { version: avail.version, date: avail.date, notes: avail.notes } : null,
		how: installs() ? 'install' : 'download',
		download: avail && file ? fileUrl(base(), avail, file) : null,
		error,
		install
	};
}

/**
 * Download the new installer, check it against the signed manifest, and run
 * it. Returns at once; `install` says how it's going. The installer stops
 * this server, so the last thing anyone hears from it is `installing`.
 */
export function startInstall(): { ok: true } | { ok: false; error: string } {
	if (!installs()) return { ok: false, error: 'this copy updates by download' };
	const m = latest && newer(latest.version, version) ? latest : null;
	const file = m?.files['win-x64']?.installer;
	if (!m || !file) return { ok: false, error: 'no newer version to install' };
	if (install && install.phase !== 'failed') return { ok: true };
	install = { phase: 'downloading', bytes: 0, total: file.size };
	void (async () => {
		const dir = join(dataPaths().home, 'updates', m.version);
		const part = join(dir, `${file.name}.part`);
		const exe = join(dir, file.name);
		try {
			mkdirSync(dir, { recursive: true });
			const r = await fetch(fileUrl(base(), m, file), { signal: AbortSignal.timeout(30 * 60_000) });
			if (!r.ok || !r.body) throw new Error(`the download answered ${r.status}`);
			const hash = createHash('sha256');
			let bytes = 0;
			const body = Readable.fromWeb(r.body as import('node:stream/web').ReadableStream);
			body.on('data', (chunk: Buffer) => {
				hash.update(chunk);
				bytes += chunk.length;
				install = { phase: 'downloading', bytes, total: file.size };
			});
			await pipeline(body, createWriteStream(part));
			if (bytes !== file.size) throw new Error(`downloaded ${bytes} bytes, expected ${file.size}`);
			if (hash.digest('hex') !== file.sha256)
				throw new Error('the download is not the file the release signed');
			renameSync(part, exe);
			install = { phase: 'installing' };
			// Its own process, not this server's child: the installer stops this
			// server, then starts the new version itself (/RELAUNCH). Without this
			// server's own variables, which the new one would otherwise inherit
			// (bind.ts, SERVER_ENV).
			spawn(exe, ['/S', '/RELAUNCH'], {
				detached: true,
				stdio: 'ignore',
				env: withoutServerEnv(process.env)
			}).unref();
		} catch (e) {
			rmSync(part, { force: true });
			install = { phase: 'failed', error: e instanceof Error ? e.message : String(e) };
		}
	})();
	return { ok: true };
}

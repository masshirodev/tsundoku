import { generateKeyPairSync, sign } from 'node:crypto';
import {
	existsSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	readdirSync,
	rmSync,
	writeFileSync
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Manifest } from '../src/lib/server/update-manifest.ts';

/**
 * What a start of tsundoku knows about the last look for a new version (c818;
 * doc/UPDATES.md, "Looking"). A friend who starts it, reads and closes it never
 * had a second page load in the same run, and the run was all `updates.ts`
 * remembered.
 *
 * A restart here is `vi.resetModules()` and a fresh import: the module's own
 * variables are gone, as they are when the process ends, and only the data
 * folder is left. The release key's private half never leaves the workstation,
 * so `openManifest` is pointed at a key of this file's own and nothing else
 * about it changes.
 */

const { publicKey, privateKey } = generateKeyPairSync('ed25519');
const testKey = publicKey.export({ format: 'der', type: 'spki' }).subarray(-32).toString('base64');
const otherKey = generateKeyPairSync('ed25519').privateKey;

// Read by the mocks below on every call, and changed by what a case installs.
const world = vi.hoisted(() => ({ running: '2026.11.01' }));
vi.mock('$app/environment', () => ({
	get version() {
		return world.running;
	}
}));
vi.mock('$env/dynamic/private', () => ({ env: process.env }));
vi.mock('../src/lib/server/update-manifest.ts', async (original) => {
	const real = await original<typeof import('../src/lib/server/update-manifest.ts')>();
	return { ...real, openManifest: (text: string) => real.openManifest(text, testKey) };
});
// The layout's other work, which starts timers and children a spec has no use for.
vi.mock('$lib/server/downloads-watch', () => ({ ensureWatcher: () => {} }));
vi.mock('$lib/server/engine/run', async (original) => ({
	...(await original<typeof import('../src/lib/server/engine/run')>()),
	ensureEngineWorker: () => {}
}));

const DAY = 24 * 60 * 60 * 1000;
const HOUR = 60 * 60 * 1000;
const NEXT = '2026.11.02';

const file = (name: string) => ({ name, size: 1234, sha256: 'a'.repeat(64) });
const manifest = (version = NEXT): Manifest => ({
	version,
	date: '2026-11-02',
	notes: 'A line for a friend.',
	files: {
		'win-x64': { installer: file('tsundoku-win-x64.exe'), zip: file('tsundoku-win-x64.zip') },
		'linux-x64': { archive: file('tsundoku-linux-x64.tar.xz') }
	}
});
const signed = (m: Manifest, key = privateKey) => {
	const text = JSON.stringify(m);
	return JSON.stringify({
		manifest: text,
		signature: sign(null, Buffer.from(text), key).toString('base64')
	});
};

const scratch = mkdtempSync(join(process.env.TMPDIR ?? tmpdir(), 'updates-restart-'));
let home: string;
let storeFile: string;

/** The release host: says `answer` until told otherwise, and counts who asked. */
let answer: () => Response;
const fetched = vi.fn<(url: string) => Promise<Response>>();
const say = (m: Manifest) => () => new Response(signed(m), { status: 200 });

/** A new process on the same data folder. */
async function start() {
	vi.resetModules();
	return import('../src/lib/server/updates.ts');
}

/** What the layout's own `load` tells the first page of a start. */
async function firstLoad(via: 'local' | 'lan' = 'local') {
	vi.resetModules();
	const { load } = await import('../src/routes/+layout.server.ts');
	const data = (await load({
		cookies: { get: () => undefined },
		locals: { authed: true, via },
		depends: () => {},
		request: new Request('http://127.0.0.1/')
	} as never)) as {
		update: { version: string } | null;
		updateOffer: { available: { version: string } | null } | null;
	};
	return data;
}

const settle = () => new Promise((r) => setTimeout(r, 0));

/** UPDATE runs the installer only on Windows, from the installer's own copy. */
async function asInstalledWindows(body: () => Promise<void>) {
	const platform = process.platform;
	Object.defineProperty(process, 'platform', { value: 'win32', configurable: true });
	process.env.TSUNDOKU_INSTALLED = '1';
	try {
		await body();
	} finally {
		Object.defineProperty(process, 'platform', { value: platform, configurable: true });
	}
}

beforeEach(() => {
	world.running = '2026.11.01';
	home = mkdtempSync(join(scratch, 'home-'));
	storeFile = join(home, 'update-latest.json');
	process.env.TSUNDOKU_HOME = home;
	process.env.DATABASE_PATH = ':memory:';
	process.env.TSUNDOKU_UPDATES = 'https://dl.example.test';
	answer = say(manifest());
	fetched.mockReset();
	fetched.mockImplementation(async () => answer());
	vi.stubGlobal('fetch', fetched);
});

afterEach(() => {
	vi.useRealTimers();
	vi.unstubAllGlobals();
	delete process.env.TSUNDOKU_INSTALLED;
});

afterAll(() => {
	rmSync(scratch, { recursive: true, force: true });
});

describe('a start knows what the last look found', () => {
	it('the first page after a start offers the version the last run found, asking nobody', async () => {
		await (await start()).check();
		fetched.mockClear();
		const data = await firstLoad();
		expect(data.update).toEqual({ version: NEXT });
		expect(data.updateOffer?.available?.version).toBe(NEXT);
		await settle();
		expect(fetched).not.toHaveBeenCalled();
	});

	it('a phone over Wi-Fi gets the band after a start and never the modal', async () => {
		await (await start()).check();
		const data = await firstLoad('lan');
		expect(data.update).toEqual({ version: NEXT });
		expect(data.updateOffer).toBeNull();
	});

	it('the very first start, with nothing kept, says nothing on its first page', async () => {
		const data = await firstLoad();
		expect(data.update).toBeNull();
		expect(data.updateOffer).toBeNull();
		await settle();
		expect(fetched).toHaveBeenCalledTimes(1);
	});

	it('a start offers what was kept, with when it looked', async () => {
		vi.useFakeTimers({ toFake: ['Date'], now: 1_800_000_000_000 });
		await (await start()).check();
		const view = (await start()).updateView()!;
		expect(view.checkedAt).toBe(1_800_000_000_000);
		expect(view.error).toBeNull();
		expect(view.available).toEqual({
			version: NEXT,
			date: '2026-11-02',
			notes: 'A line for a friend.',
			size: 1234
		});
		expect(view.download).toBe(`https://dl.example.test/${NEXT}/tsundoku-linux-x64.tar.xz`);
	});

	it('a later answer replaces what was kept', async () => {
		await (await start()).check();
		answer = say(manifest('2026.11.03'));
		await (await start()).check();
		expect((await start()).updateView()!.available?.version).toBe('2026.11.03');
	});

	it('UPDATE after a start installs the version kept, and only from its signed entry', async () => {
		await (await start()).check();
		await asInstalledWindows(async () => {
			const updates = await start();
			fetched.mockClear();
			fetched.mockImplementation(async () => new Response('', { status: 500 }));
			expect(updates.startInstall()).toEqual({ ok: true });
			await vi.waitFor(() => expect(updates.updateView()!.install?.phase).toBe('failed'));
			expect(fetched.mock.calls[0][0]).toBe(`https://dl.example.test/${NEXT}/tsundoku-win-x64.exe`);
		});
	});
});

describe('what is kept is never offered past its welcome', () => {
	it('after the update happened, the version kept is the one running, and nothing is offered', async () => {
		await (await start()).check();
		world.running = NEXT;
		const updates = await start();
		expect(updates.updateView()!.available).toBeNull();
		expect(updates.updateView()!.download).toBeNull();
		const data = await firstLoad();
		expect(data.update).toBeNull();
		expect(data.updateOffer).toBeNull();
	});

	it('UPDATE has nothing to install once the version kept is the one running', async () => {
		await (await start()).check();
		world.running = NEXT;
		await asInstalledWindows(async () => {
			expect((await start()).startInstall()).toEqual({
				ok: false,
				error: 'no newer version to install'
			});
		});
	});

	it('a version older than the running one is not offered either', async () => {
		answer = say(manifest('2026.10.30'));
		await (await start()).check();
		expect((await start()).updateView()!.available).toBeNull();
	});

	const wrong: [string, () => string][] = [
		['cut short', () => good().slice(0, 40)],
		['empty', () => ''],
		['not an object', () => 'null'],
		[
			'edited after signing',
			() => {
				const k = JSON.parse(good());
				const s = JSON.parse(k.text);
				s.manifest = s.manifest.replace('2026.11.02', '2026.11.09');
				return JSON.stringify({ ...k, text: JSON.stringify(s) });
			}
		],
		[
			'signed by a key that no longer verifies',
			() => JSON.stringify({ text: signed(manifest(), otherKey), checkedAt: Date.now() })
		],
		['the signed text missing', () => JSON.stringify({ checkedAt: Date.now() })],
		['the text not a string', () => JSON.stringify({ text: 7, checkedAt: Date.now() })],
		['no time', () => JSON.stringify({ text: signed(manifest()) })],
		[
			'a time that is no number',
			() => JSON.stringify({ text: signed(manifest()), checkedAt: 'x' })
		],
		['a time of zero', () => JSON.stringify({ text: signed(manifest()), checkedAt: 0 })]
	];
	const good = () => JSON.stringify({ text: signed(manifest()), checkedAt: Date.now() });

	it.each(wrong)('a file %s is as if nothing were kept', async (_name, content) => {
		writeFileSync(storeFile, content());
		const updates = await start();
		expect(updates.updateView()).toMatchObject({
			available: null,
			checkedAt: null,
			error: null,
			download: null
		});
		// And it doesn't hold the next look back.
		updates.checkIfStale();
		await vi.waitFor(() => expect(fetched).toHaveBeenCalledTimes(1));
	});

	it('the good shape those cases change does open, so each is refused for its own reason', async () => {
		writeFileSync(storeFile, good());
		expect((await start()).updateView()).toMatchObject({ available: { version: NEXT } });
	});

	it('a time ahead of the clock keeps the version and does not hold the next look shut', async () => {
		writeFileSync(
			storeFile,
			JSON.stringify({ text: signed(manifest()), checkedAt: Date.now() + DAY * 400 })
		);
		const updates = await start();
		expect(updates.updateView()).toMatchObject({ available: { version: NEXT }, checkedAt: null });
		updates.checkIfStale();
		await vi.waitFor(() => expect(fetched).toHaveBeenCalledTimes(1));
	});
});

describe('a failed look', () => {
	const failures: [string, () => Response | never][] = [
		['the host refusing', () => new Response('', { status: 503 })],
		[
			'the network being down',
			() => {
				throw new TypeError('fetch failed');
			}
		],
		['an unsigned answer', () => new Response('{}', { status: 200 })],
		['another key’s answer', () => new Response(signed(manifest('2026.12.01'), otherKey))]
	];

	it.each(failures)('%s keeps the last good answer, here and after a start', async (_n, fail) => {
		await (await start()).check();
		const before = readFileSync(storeFile, 'utf8');
		answer = fail;
		const updates = await start();
		await updates.check();
		expect(updates.updateView()!.available?.version).toBe(NEXT);
		expect(updates.updateView()!.error).toBeTruthy();
		expect(readFileSync(storeFile, 'utf8')).toBe(before);
		// The error was this run's: the next start knows only the last answer.
		expect((await start()).updateView()).toMatchObject({
			available: { version: NEXT },
			error: null
		});
	});

	it('leaves nothing kept when nothing was, so the next start looks at once', async () => {
		answer = () => new Response('', { status: 503 });
		await (await start()).check();
		expect(existsSync(storeFile)).toBe(false);
		fetched.mockClear();
		(await start()).checkIfStale();
		await vi.waitFor(() => expect(fetched).toHaveBeenCalledTimes(1));
	});

	it('as a start’s very first question, it says when it looked, not when the last answer came', async () => {
		vi.useFakeTimers({ toFake: ['Date'], now: 1_800_000_000_000 });
		await (await start()).check();
		answer = () => new Response('', { status: 503 });
		vi.setSystemTime(1_800_000_000_000 + HOUR);
		const updates = await start();
		await updates.check();
		expect(updates.updateView()).toMatchObject({
			checkedAt: 1_800_000_000_000 + HOUR,
			available: { version: NEXT }
		});
	});

	it('a good answer after one clears the error', async () => {
		answer = () => new Response('', { status: 503 });
		const updates = await start();
		await updates.check();
		expect(updates.updateView()!.error).toBeTruthy();
		answer = say(manifest());
		await updates.check();
		expect(updates.updateView()).toMatchObject({ error: null, available: { version: NEXT } });
	});
});

describe('the limits outlive a start', () => {
	const T0 = 1_800_000_000_000;

	async function lookedAt(at: number) {
		vi.useFakeTimers({ toFake: ['Date'], now: at });
		await (await start()).check();
		fetched.mockClear();
	}

	it('a day: a start 23 hours on stays quiet, one 25 hours on looks', async () => {
		await lookedAt(T0);
		vi.setSystemTime(T0 + 23 * HOUR);
		(await start()).checkIfStale();
		await settle();
		expect(fetched).not.toHaveBeenCalled();

		vi.setSystemTime(T0 + 25 * HOUR);
		(await start()).checkIfStale();
		await vi.waitFor(() => expect(fetched).toHaveBeenCalledTimes(1));
	});

	it('SETTINGS’ hour: half an hour on stays quiet, two hours on looks', async () => {
		await lookedAt(T0);
		vi.setSystemTime(T0 + HOUR / 2);
		(await start()).checkIfStale(HOUR);
		await settle();
		expect(fetched).not.toHaveBeenCalled();

		vi.setSystemTime(T0 + 2 * HOUR);
		(await start()).checkIfStale(HOUR);
		await vi.waitFor(() => expect(fetched).toHaveBeenCalledTimes(1));
	});

	it('CHECK looks now, whatever was kept', async () => {
		await lookedAt(T0);
		const updates = await start();
		await updates.check();
		expect(fetched).toHaveBeenCalledTimes(1);
	});

	it('a look finished in this run counts as well', async () => {
		await lookedAt(T0);
		const updates = await start();
		await updates.check();
		fetched.mockClear();
		vi.setSystemTime(T0 + 23 * HOUR);
		updates.checkIfStale();
		await settle();
		expect(fetched).not.toHaveBeenCalled();
	});
});

describe('the sweep of installers already run', () => {
	const updatesDir = () => join(home, 'updates');
	const made = (name: string) => {
		mkdirSync(join(updatesDir(), name), { recursive: true });
		writeFileSync(join(updatesDir(), name, 'setup.exe'), 'x');
	};

	it('still deletes what was installed, keeps what is newer, and leaves the kept answer alone', async () => {
		await (await start()).check();
		const kept = readFileSync(storeFile, 'utf8');
		made('2026.10.30');
		made('2026.11.01'); // The one running.
		made('2026.11.02');
		made('not-a-version');
		writeFileSync(join(updatesDir(), 'latest.json'), 'an earlier file in the wrong place');
		// A failed look: the sweep runs first, and nothing writes the answer back after it.
		answer = () => new Response('', { status: 503 });

		await (await start()).check();

		expect(readdirSync(updatesDir()).sort()).toEqual(['2026.11.02']);
		expect(readFileSync(storeFile, 'utf8')).toBe(kept);
		expect((await start()).updateView()!.available?.version).toBe(NEXT);
	});

	it('the kept answer is not in the folder the sweep empties', async () => {
		await (await start()).check();
		expect(existsSync(storeFile)).toBe(true);
		expect(existsSync(join(updatesDir(), 'update-latest.json'))).toBe(false);
	});
});

describe('the write', () => {
	it('goes through a temp file, and only a whole file ever has the name', async () => {
		await (await start()).check();
		const before = readFileSync(storeFile, 'utf8');
		const fs = await import('node:fs');
		const seen: { old: string; temp: string; from: string }[] = [];
		vi.resetModules();
		vi.doMock('node:fs', async () => ({
			...fs,
			renameSync: (from: string, to: string) => {
				if (to === storeFile)
					seen.push({
						old: fs.readFileSync(to, 'utf8'),
						temp: fs.readFileSync(from, 'utf8'),
						from
					});
				fs.renameSync(from, to);
			}
		}));
		try {
			answer = say(manifest('2026.11.03'));
			const updates = await import('../src/lib/server/updates.ts');
			await updates.check();
		} finally {
			vi.doUnmock('node:fs');
		}
		expect(seen).toHaveLength(1);
		expect(seen[0].old).toBe(before);
		expect(seen[0].from).not.toBe(storeFile);
		expect(JSON.parse(seen[0].temp).text).toContain('2026.11.03');
		expect(readdirSync(home).filter((f) => f.includes('tmp'))).toEqual([]);
	});

	it('a write that fails is not the check’s failure, and leaves no temp behind', async () => {
		mkdirSync(storeFile); // Rename over a directory is refused on every platform.
		const updates = await start();
		await expect(updates.check()).resolves.toBeUndefined();
		expect(updates.updateView()).toMatchObject({ error: null, available: { version: NEXT } });
		expect(readdirSync(home).filter((f) => f.includes('tmp'))).toEqual([]);
	});
});

describe('where updates are off', () => {
	it('with TSUNDOKU_UPDATES off, nothing is read, looked for or written', async () => {
		writeFileSync(storeFile, JSON.stringify({ text: signed(manifest()), checkedAt: Date.now() }));
		const before = readFileSync(storeFile, 'utf8');
		process.env.TSUNDOKU_UPDATES = 'off';
		const updates = await start();
		updates.checkIfStale();
		await updates.check();
		expect(updates.updateView()).toBeNull();
		expect(fetched).not.toHaveBeenCalled();
		expect(readFileSync(storeFile, 'utf8')).toBe(before);
	});

	it('on a build whose version is no release, the same', async () => {
		world.running = '0.0.1';
		const updates = await start();
		updates.checkIfStale();
		await updates.check();
		expect(updates.updateView()).toBeNull();
		expect(fetched).not.toHaveBeenCalled();
		expect(existsSync(storeFile)).toBe(false);
	});
});

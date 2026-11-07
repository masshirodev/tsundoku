#!/usr/bin/env node
/**
 * One build at a time per worktree, and never a build under a running preview
 * (c625).
 *
 * `playwright.config.ts`'s webServer builds the app into `.svelte-kit/output`
 * before it serves, and a second `playwright test` in the same worktree builds
 * into the same folder: wave 25 saw one run die with `ENOENT … .svelte-kit/
 * output/server/manifest-full.js` while the other's preview served pages that
 * never hydrated. The ports are safe since waves 28-30 (the worlds take them
 * from the OS when nothing assigns them); the build is not.
 *
 * Two things can collide, and this wraps the webServer command to keep both
 * apart:
 *
 * - **Two builds.** `.svelte-kit/.build-lock` (a file naming its holder's pid,
 *   created with `wx` so two runners cannot both win) is held for the prepare
 *   and build steps. A second invocation waits for it.
 * - **A build under a preview.** `vite build` empties `.svelte-kit/output`
 *   first, and a preview is serving out of that folder for as long as its run
 *   lasts, long after the lock is released. So every invocation that serves
 *   registers itself in `.svelte-kit/.build-users/<pid>`, with the fingerprint
 *   of the source tree the output was built from, and a build never starts
 *   while a live user is registered. Instead, an invocation that finds the
 *   output in use either serves that output (when it was built from the tree
 *   as it is now: same HEAD, same changes, same untracked files) or waits for
 *   the users to finish (when the tree has changed since, because serving a
 *   stale build would test code that is not there any more). The fingerprint
 *   is taken only to decide that: with nobody serving, an invocation builds,
 *   as every run did before this wrapper.
 *
 * Every invocation runs its own prepare step (its own seeded database and
 * folders), under the lock, so the dictionary copy never runs beside a build
 * that reads it.
 *
 * A holder or user that died leaves a file naming a pid that is gone: it is
 * removed the next time anyone looks. A waiter that runs out of time says who
 * it was waiting for and exits non-zero inside Playwright's own 180 s.
 *
 * When the preview port already answers, a server is up that the run will use
 * (Playwright's `reuseExistingServer`), so this serves nothing and waits for
 * Playwright's teardown.
 *
 * Node built-ins only: `scripts/` may not add a dependency (the wave's rules).
 * Its cases are `tests/helpers/build-lock.spec.ts`; `doc/TESTING.md`
 * ("Ports") has the measured pair.
 */

import { execFileSync, spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
	existsSync,
	mkdirSync,
	readdirSync,
	readFileSync,
	rmSync,
	statSync,
	writeFileSync
} from 'node:fs';
import { connect } from 'node:net';
import { join } from 'node:path';

const LOCK_DIR = '.svelte-kit';
const LOCK = join(LOCK_DIR, '.build-lock');
const STAMP = join(LOCK_DIR, '.build-stamp');
const USERS = join(LOCK_DIR, '.build-users');
const OUTPUT = join(LOCK_DIR, 'output');
/** Inside the webServer's own 180_000 ms (`playwright.config.ts`), with room to say why. */
const WAIT_MS = Number(process.env.BUILD_LOCK_WAIT_MS ?? 150_000);
const POLL_MS = 200;

const log = (line) => process.stderr.write(`[build-lock] ${line}\n`);

function usage(why) {
	log(why);
	log('usage: node scripts/build-lock.mjs --port <n> [--prepare <sh>] --build <sh> --serve <sh>');
	process.exit(2);
}

function arg(name) {
	const at = process.argv.indexOf(`--${name}`);
	return at === -1 ? undefined : process.argv[at + 1];
}

const port = Number(arg('port'));
if (!Number.isInteger(port) || port <= 0) usage('--port is required');
const prepare = arg('prepare');
const build = arg('build');
const serve = arg('serve');
if (!build || !serve) usage('--build and --serve are required');

const alive = (pid) => {
	try {
		process.kill(pid, 0);
		return true;
	} catch (e) {
		// A pid this user may not signal is still a live process.
		return e.code === 'EPERM';
	}
};

/**
 * When the process with this pid started, in clock ticks since boot (Linux's
 * `/proc/<pid>/stat`, field 22), or undefined where there is no `/proc`. A
 * pid alone can name a new process once the old one is gone: Playwright's
 * teardown kills this wrapper without letting it remove its own files, so they
 * stay behind until the next run, and the start time tells their process from
 * a newer one that happens to have the same pid.
 */
function startedAt(pid) {
	try {
		const stat = readFileSync(`/proc/${pid}/stat`, 'utf8');
		// The command name, field 2, is in parentheses and may hold spaces.
		return stat.slice(stat.lastIndexOf(')') + 2).split(' ')[19];
	} catch {
		return undefined;
	}
}

/** The process that wrote this record is still running. */
const running = (record) =>
	alive(record.pid) && (record.started === undefined || record.started === startedAt(record.pid));

function readJson(path) {
	try {
		return JSON.parse(readFileSync(path, 'utf8'));
	} catch {
		// Half written by a killed run, or none.
		return undefined;
	}
}

function holder() {
	const held = readJson(LOCK);
	return Number.isInteger(held?.pid) && held.pid > 0 ? held : undefined;
}

/** The lock is ours, or the file that was there is stale and has been removed. */
function acquire() {
	mkdirSync(LOCK_DIR, { recursive: true });
	for (let attempt = 0; attempt < 2; attempt++) {
		try {
			writeFileSync(
				LOCK,
				JSON.stringify({ pid: process.pid, started: startedAt(process.pid), at: Date.now(), port }),
				{ flag: 'wx' }
			);
			return true;
		} catch (e) {
			if (e.code !== 'EEXIST') throw e;
			const held = holder();
			if (held && held.pid !== process.pid && running(held)) return false;
			// A file with no pid yet may be a holder between its create and its
			// write: only call it stale once it has had a moment to finish.
			if (!held && Date.now() - mtime(LOCK) < 1000) return false;
			log(
				`removing a stale lock from pid ${held?.pid ?? 'unknown'}` +
					(held ? ` (held since ${new Date(held.at).toISOString()})` : '')
			);
			rmSync(LOCK, { force: true });
		}
	}
	return false;
}

function mtime(path) {
	try {
		return statSync(path).mtimeMs;
	} catch {
		return 0;
	}
}

function release() {
	if (holder()?.pid === process.pid) rmSync(LOCK, { force: true });
}

/** The live invocations serving `.svelte-kit/output`, the dead ones' files removed. */
function users() {
	let names;
	try {
		names = readdirSync(USERS);
	} catch {
		return [];
	}
	const live = [];
	for (const name of names) {
		const pid = Number(name);
		if (pid === process.pid) continue;
		const record = { ...readJson(join(USERS, name)), pid };
		if (Number.isInteger(pid) && pid > 0 && running(record)) {
			live.push(record);
		} else {
			log(`removing a stale user ${name}`);
			rmSync(join(USERS, name), { force: true });
		}
	}
	return live;
}

let registered = false;
function register(fingerprint) {
	mkdirSync(USERS, { recursive: true });
	writeFileSync(
		join(USERS, String(process.pid)),
		JSON.stringify({ started: startedAt(process.pid), at: Date.now(), port, fingerprint })
	);
	registered = true;
}
function unregister() {
	if (registered) rmSync(join(USERS, String(process.pid)), { force: true });
	registered = false;
}
process.on('exit', () => {
	unregister();
	release();
});

/**
 * What the build would be built from: HEAD, the tracked changes and the
 * untracked files that are not ignored, hashed. Undefined outside a git
 * checkout, which never matches, so such a tree never reuses an output.
 */
function fingerprint() {
	try {
		const git = (...args) => execFileSync('git', args, { maxBuffer: 1 << 30 });
		const hash = createHash('sha256');
		hash.update(git('rev-parse', 'HEAD'));
		hash.update(git('diff', 'HEAD', '--binary'));
		const untracked = git('ls-files', '--others', '--exclude-standard', '-z')
			.toString()
			.split('\0')
			.filter(Boolean)
			.sort();
		for (const file of untracked) {
			hash.update(`\0${file}\0`);
			try {
				hash.update(readFileSync(file));
			} catch {
				// Removed between the listing and the read: its name is enough.
			}
		}
		return hash.digest('hex');
	} catch {
		return undefined;
	}
}

function portAnswers(ms = 500) {
	return new Promise((resolve) => {
		const socket = connect({ port, host: '127.0.0.1' });
		const done = (answer) => {
			socket.destroy();
			resolve(answer);
		};
		const timer = setTimeout(() => done(false), ms);
		socket.once('connect', () => {
			clearTimeout(timer);
			done(true);
		});
		socket.once('error', () => {
			clearTimeout(timer);
			done(false);
		});
	});
}

/** The command running now, which a signal is handed to. */
let current;
/** Serving nothing on purpose: a stop is then a clean exit. */
let idling = false;

// One handler for the whole life of the process, installed before anything
// runs: a signal that lands between two commands (after the build, before the
// serve) would otherwise find no handler, and its default action kills this
// process without the exit handler that removes its lock and user files.
for (const signal of ['SIGTERM', 'SIGINT', 'SIGHUP'])
	process.on(signal, () => {
		if (current) current.kill(signal);
		else process.exit(idling ? 0 : 1);
	});

function run(command) {
	return new Promise((resolve, reject) => {
		const child = spawn(command, { shell: true, stdio: 'inherit', env: process.env });
		current = child;
		child.once('error', reject);
		child.once('exit', (code, signal) => {
			if (current === child) current = undefined;
			if (code === 0) resolve();
			else reject(new Error(`${command} ${signal ? `died on ${signal}` : `exited ${code}`}`));
		});
	});
}

/** Serve nothing: another invocation's server is the run's. Stop on Playwright's teardown. */
function idle(why) {
	log(why);
	idling = true;
	// A signal listener alone does not hold the event loop open, and Playwright
	// kills this process at teardown rather than waiting for it to exit.
	setInterval(() => {}, 1 << 30);
	return new Promise(() => {});
}

/**
 * One attempt, under the lock: build, reuse, or say who to wait for. The lock
 * is released before serving or waiting, whatever happens.
 */
async function attempt() {
	try {
		const serving = users();
		const tree = fingerprint();
		if (serving.length === 0) {
			log(`acquired ${LOCK} (pid ${process.pid}, port ${port}); building`);
			if (prepare) await run(prepare);
			await run(build);
			writeFileSync(STAMP, JSON.stringify({ at: Date.now(), pid: process.pid, fingerprint: tree }));
			register(tree);
			// Released before it is said, so a reader of the log never finds it held.
			release();
			log(`built; released ${LOCK} (pid ${process.pid})`);
			return 'serve';
		}
		const stamp = readJson(STAMP);
		const current = tree !== undefined && stamp?.fingerprint === tree && existsSync(OUTPUT);
		const who = serving.map((u) => `pid ${u.pid} (port ${u.port})`).join(', ');
		if (current) {
			if (prepare) await run(prepare);
			register(tree);
			release();
			log(
				`acquired ${LOCK} (pid ${process.pid}, port ${port}); ${who} serving ` +
					`the output pid ${stamp.pid} built from this tree: skipping the build`
			);
			return 'serve';
		}
		return { wait: who };
	} finally {
		release();
	}
}

async function main() {
	if (await portAnswers()) return idle(`port ${port} already answers; serving nothing`);

	const startedWaiting = Date.now();
	let said = '';
	let last;
	while (Date.now() - startedWaiting < WAIT_MS) {
		if (await portAnswers(200))
			return idle(
				`port ${port} answered after waiting ${Date.now() - startedWaiting} ms; ` +
					`reusing that server, serving nothing`
			);
		if (acquire()) {
			const outcome = await attempt();
			if (outcome === 'serve') return run(serve);
			last = `the tree changed since the output was built, and ${outcome.wait} still serves it`;
		} else {
			const held = holder();
			last = `${LOCK} is held by pid ${held?.pid ?? 'unknown'}`;
		}
		if (last !== said) log(`waiting: ${last}`);
		said = last;
		await new Promise((r) => setTimeout(r, POLL_MS));
	}
	log(
		`gave up after waiting ${Date.now() - startedWaiting} ms ` +
			`(the webServer allows 180000): ${last}`
	);
	process.exit(1);
}

main().catch((error) => {
	release();
	log(error.message);
	process.exit(1);
});

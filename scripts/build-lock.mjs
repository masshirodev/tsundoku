#!/usr/bin/env node
/**
 * One build at a time per worktree (c625).
 *
 * `playwright.config.ts`'s webServer builds the app into `.svelte-kit/output`
 * before it serves, and a second `playwright test` in the same worktree builds
 * into the same folder: wave 25 saw one run die with `ENOENT … .svelte-kit/
 * output/server/manifest-full.js` while the other's preview served pages that
 * never hydrated. The ports are safe since waves 28-30 (the worlds take them
 * from the OS when nothing assigns them), the build is not.
 *
 * This wraps the webServer command. The first invocation takes the lock, runs
 * the prepare and build steps, stamps the output, releases the lock, and
 * serves. A second invocation that starts during that build waits for the
 * lock; the stamp says a build finished after it started waiting, so it runs
 * its own prepare (its own seeded database) and serves, but skips the build —
 * rebuilding would empty the folder the first invocation's preview is serving
 * from. If its own preview port already answers (a slot that assigns one port
 * to both invocations), it waits for the port instead and serves nothing: the
 * first invocation's server is the run's.
 *
 * The lock is `.svelte-kit/.build-lock`, a JSON file naming the holder's pid.
 * A holder that died leaves a stale lock: the waiter notices the pid is gone,
 * removes the file and takes it (proved by killing a holder by its pid, below
 * in `doc/TESTING.md`). A waiter that runs out of time says who held the lock
 * and for how long, and exits non-zero inside Playwright's own 180 s.
 *
 * Node built-ins only: `scripts/` may not add a dependency (the wave's rules).
 */

import { spawn } from 'node:child_process';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { connect } from 'node:net';
import { join } from 'node:path';

const LOCK_DIR = '.svelte-kit';
const LOCK = join(LOCK_DIR, '.build-lock');
const STAMP = join(LOCK_DIR, '.build-stamp');
/** Inside the webServer's own 180_000 ms (`playwright.config.ts`), with room to say why. */
const WAIT_MS = 150_000;
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
		// A pid this user may not signal is still a live holder.
		return e.code === 'EPERM';
	}
};

function holder() {
	try {
		const held = JSON.parse(readFileSync(LOCK, 'utf8'));
		if (Number.isInteger(held.pid) && held.pid > 0) return held;
	} catch {
		// A lock half written by a killed run, or none.
	}
	return undefined;
}

/** The lock is ours, or the file that was there is stale and has been removed. */
function acquire() {
	mkdirSync(LOCK_DIR, { recursive: true });
	for (let attempt = 0; attempt < 2; attempt++) {
		try {
			// `wx`: the file's own creation is the lock, so two runners cannot both win.
			writeFileSync(LOCK, JSON.stringify({ pid: process.pid, at: Date.now(), port }), {
				flag: 'wx'
			});
			return true;
		} catch (e) {
			if (e.code !== 'EEXIST') throw e;
			const held = holder();
			if (held && held.pid !== process.pid && alive(held.pid)) return false;
			log(
				`removing a stale lock from pid ${held?.pid ?? 'unknown'}` +
					(held ? ` (waited since ${new Date(held.at).toISOString()})` : '')
			);
			rmSync(LOCK, { force: true });
		}
	}
	return false;
}

function release() {
	const held = holder();
	if (held?.pid === process.pid) rmSync(LOCK, { force: true });
}

function stampAt() {
	try {
		const stamp = JSON.parse(readFileSync(STAMP, 'utf8'));
		return Number.isFinite(stamp.at) ? stamp.at : undefined;
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

function run(command) {
	return new Promise((resolve, reject) => {
		const child = spawn(command, { shell: true, stdio: 'inherit', env: process.env });
		for (const signal of ['SIGTERM', 'SIGINT', 'SIGHUP'])
			process.on(signal, () => child.kill(signal));
		child.once('error', reject);
		child.once('exit', (code, signal) =>
			code === 0
				? resolve()
				: reject(new Error(`${command} ${signal ? `died on ${signal}` : `exited ${code}`}`))
		);
	});
}

/** Serve nothing: another invocation's server is the run's. Stop on Playwright's teardown. */
function idle(why) {
	log(why);
	return new Promise((resolve) => {
		// A signal listener alone does not hold the event loop open, and Playwright
		// kills this process at teardown rather than waiting for it to exit.
		const keepAlive = setInterval(() => {}, 1 << 30);
		for (const signal of ['SIGTERM', 'SIGINT', 'SIGHUP'])
			process.on(signal, () => {
				clearInterval(keepAlive);
				resolve();
			});
	});
}

async function buildUnderLock() {
	log(`acquired ${LOCK} (pid ${process.pid}, port ${port})`);
	try {
		if (prepare) await run(prepare);
		await run(build);
		writeFileSync(STAMP, JSON.stringify({ at: Date.now(), pid: process.pid }));
	} finally {
		// A build that dies must not wedge the next invocation.
		release();
		log(`released ${LOCK} (pid ${process.pid})`);
	}
}

async function main() {
	if (await portAnswers()) return idle(`port ${port} already answers; serving nothing`);

	if (acquire()) {
		await buildUnderLock();
		return run(serve);
	}

	const held = holder();
	const startedWaiting = Date.now();
	log(
		`waiting for ${LOCK} held by pid ${held?.pid ?? 'unknown'}` +
			(held ? ` since ${new Date(held.at).toISOString()} (${Date.now() - held.at} ms)` : '')
	);
	while (Date.now() - startedWaiting < WAIT_MS) {
		await new Promise((r) => setTimeout(r, POLL_MS));
		if (await portAnswers(200))
			return idle(
				`port ${port} answered after waiting ${Date.now() - startedWaiting} ms; ` +
					`reusing the first invocation's server, serving nothing`
			);
		if (acquire()) {
			// A build finishing under the lock while we waited makes the output fresh:
			// rebuilding would empty the folder the first invocation is serving from.
			// The prepare step still runs: its database and folders are this run's.
			const finished = stampAt();
			if (finished && finished >= startedWaiting) {
				log(
					`build finished ${finished - startedWaiting} ms into the wait; ` +
						`skipping the build and serving the output the first invocation wrote`
				);
				if (prepare) await run(prepare);
				release();
				return run(serve);
			}
			await buildUnderLock();
			return run(serve);
		}
	}
	const waiting = holder();
	log(
		`gave up after waiting ${Date.now() - startedWaiting} ms (the webServer allows 180000): ` +
			`${LOCK} is still held by pid ${waiting?.pid ?? 'unknown'}` +
			(waiting ? ` since ${new Date(waiting.at).toISOString()}` : '')
	);
	process.exit(1);
}

main().catch((error) => {
	release();
	log(error.message);
	process.exit(1);
});

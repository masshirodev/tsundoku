#!/usr/bin/env node
/**
 * One build at a time per worktree, and never a build under a running preview.
 *
 * `playwright.config.ts`'s webServer builds the app into `.svelte-kit/output`
 * before it serves, and a second `playwright test` in the same worktree builds
 * into the same folder: one run died with `ENOENT … .svelte-kit/output/server/
 * manifest-full.js` while the other's preview served pages that never
 * hydrated. The ports are safe (the worlds take them from the OS when nothing
 * assigns them); the build is not.
 *
 * Two things can collide, and this wraps the webServer command to keep both
 * apart:
 *
 * - **Two builds.** `.svelte-kit/.build-lock` (a file naming its holder's pid,
 *   created with `wx` so two runners cannot both win, and taken over from a
 *   dead holder by exactly one waiter, `acquire()`) is held for the prepare
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
 *   is taken only to decide that: with nobody serving, an invocation builds.
 *
 * Every invocation runs its own prepare step (its own seeded database and
 * folders), under the lock, so the dictionary copy never runs beside a build
 * that reads it.
 *
 * A user that died leaves a file naming a pid that is gone: it is removed the
 * next time anyone looks. A holder that died leaves the lock naming it, and
 * the next waiter takes it over (`acquire()` says how only one can). A waiter that runs out of time says who
 * it was waiting for and exits non-zero inside Playwright's own 180 s.
 *
 * When the preview port already answers, a server is up that the run will use
 * (Playwright's `reuseExistingServer`), so this serves nothing and waits for
 * Playwright's teardown.
 *
 * It never outlives the runner that started it. Playwright stops it by
 * SIGKILLing its process group, so its commands stay in that group (never
 * `detached`) for the kill to reach them. A runner that is itself killed
 * outright (an agent's session ending) never sends that kill, and the wrapper
 * would be reparented and serve on for hours, registered as a live user that
 * every later run on a changed tree waited 150 s for. So it watches
 * its parent: once the parent is gone it kills its command's whole tree,
 * removes its files and exits 1.
 *
 * Node built-ins only: `scripts/` may not add a dependency.
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
	renameSync,
	rmSync,
	statSync,
	writeFileSync
} from 'node:fs';
import { connect } from 'node:net';
import { join } from 'node:path';

const LOCK_DIR = '.svelte-kit';
const LOCK = join(LOCK_DIR, '.build-lock');
/** A stale lock's takeover tickets (`acquire()`): `<name><hash>.<n>`. */
const TICKET_NAME = '.build-lock.takeover.';
const TICKET = join(LOCK_DIR, TICKET_NAME);
const STAMP = join(LOCK_DIR, '.build-stamp');
const USERS = join(LOCK_DIR, '.build-users');
const OUTPUT = join(LOCK_DIR, 'output');
/** Inside the webServer's own 180_000 ms (`playwright.config.ts`), with room to say why. */
const WAIT_MS = Number(process.env.BUILD_LOCK_WAIT_MS ?? 150_000);
const POLL_MS = 200;
/** How often the parent is looked at; the review asked for about a second. */
const PARENT_POLL_MS = Number(process.env.BUILD_LOCK_PARENT_POLL_MS ?? 1000);
/** The runner that started this wrapper: when it goes, so does the wrapper. */
const PARENT = process.ppid;

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

/** The record in these bytes, when it names a pid. */
function parseHolder(text) {
	let held;
	try {
		held = JSON.parse(text);
	} catch {
		// Half written by a killed run, or none.
		return undefined;
	}
	return Number.isInteger(held?.pid) && held.pid > 0 ? held : undefined;
}

const holder = () => parseHolder(readText(LOCK));

function readText(path) {
	try {
		return readFileSync(path, 'utf8');
	} catch {
		return undefined;
	}
}

/**
 * Stops at a named point until a test lets it go (`BUILD_LOCK_PAUSE=<dir>`):
 * writes `<dir>/<point>.<pid>` and waits for `<dir>/<point>.go`. The race
 * between two waiters is a matter of microseconds, so its case cannot wait for
 * the box to lose it; it holds both waiters here and releases them together
 * (`tests/helpers/build-lock.spec.ts`). Unset, as in every real run, it does
 * nothing.
 */
function pause(point) {
	const dir = process.env.BUILD_LOCK_PAUSE;
	if (!dir) return;
	writeFileSync(join(dir, `${point}.${process.pid}`), '');
	const sleep = new Int32Array(new SharedArrayBuffer(4));
	while (!existsSync(join(dir, `${point}.go`))) Atomics.wait(sleep, 0, 0, 20);
}

/** The exact bytes of the lock this process holds, or undefined. */
let mine;

/** A file whose bytes are still being written by a live process, or one that died. */
const settling = (path) => Date.now() - mtime(path) < 1000;

/**
 * The lock is ours, or it is not yet (try again later).
 *
 * A free lock is taken by creating it (`wx`). A stale one, whose holder is
 * gone, is the hard part. Renaming a file of one's own onto the lock and
 * reading it back loses: two waiters that both read the dead bytes before
 * either renamed both read their own name back and both built. Removing it
 * first and then creating loses the same way, and so does renaming the
 * dead lock aside and linking a new one: a waiter that read the dead bytes
 * late renames the winner's fresh lock aside instead.
 *
 * So the right to replace one stale lock is a **ticket named after its
 * bytes**, `.build-lock.takeover.<hash of those bytes>.<n>`, created with
 * `wx`: of the waiters that read the same dead holder, exactly one creates
 * it. The others find it, see its writer alive, and wait like anyone waiting
 * for a holder. The winner checks the lock still holds those bytes and only
 * then renames its own record onto it. Nothing else can change the lock while
 * it holds those bytes: its holder is dead, a create needs it gone, and a
 * release removes only the bytes its own process wrote. A winner killed
 * between its ticket and its rename would leave the ticket forever, so a
 * ticket whose writer is gone is passed by creating the next one, `<n + 1>`
 * (again with `wx`, again one winner), never by removing it; the winner of a
 * later ticket finds the lock unchanged and takes it, and a ticket taken
 * after the lock has moved on finds it changed and gives up. The winner
 * removes every ticket once the lock is its own, since by then no ticket
 * names the lock as it is; a waiter that was about to read one finds it
 * missing, takes the ticket afresh, and gives up on the changed lock.
 */
function acquire() {
	mkdirSync(LOCK_DIR, { recursive: true });
	const bytes = JSON.stringify({
		pid: process.pid,
		started: startedAt(process.pid),
		at: Date.now(),
		port
	});
	try {
		writeFileSync(LOCK, bytes, { flag: 'wx' });
		mine = bytes;
		return true;
	} catch (e) {
		if (e.code !== 'EEXIST') throw e;
	}
	const found = readText(LOCK);
	// Released between the create and the read: the next poll creates it.
	if (found === undefined) return false;
	const held = parseHolder(found);
	if (held && held.pid !== process.pid && running(held)) return false;
	// A file with no pid yet may be a holder between its create and its
	// write: only call it stale once it has had a moment to finish.
	if (!held && settling(LOCK)) return false;
	pause('stale');
	const chain = `${TICKET}${createHash('sha256').update(found).digest('hex').slice(0, 16)}.`;
	let ticket;
	for (let n = 0; !ticket; n++) {
		try {
			writeFileSync(`${chain}${n}`, bytes, { flag: 'wx' });
			ticket = `${chain}${n}`;
		} catch (e) {
			if (e.code !== 'EEXIST') throw e;
			const taker = parseHolder(readText(`${chain}${n}`));
			// Another waiter is taking this very lock over: it is theirs.
			if (taker ? running(taker) : settling(`${chain}${n}`)) return false;
		}
	}
	pause('ticket');
	if (readText(LOCK) !== found) {
		// Taken over already (by the winner of an earlier ticket, who then
		// died after its rename), or released: not this ticket's to replace.
		rmSync(ticket, { force: true });
		return false;
	}
	log(
		`taking over a stale lock from pid ${held?.pid ?? 'unknown'}` +
			(held ? ` (held since ${new Date(held.at).toISOString()})` : '')
	);
	const draft = `${LOCK}.${process.pid}`;
	writeFileSync(draft, bytes);
	renameSync(draft, LOCK);
	mine = bytes;
	// Every ticket, and every draft (only a ticket's winner writes one, so any
	// other is a winner's that was killed before its rename).
	for (const name of readdirSync(LOCK_DIR))
		if (name.startsWith(TICKET_NAME) || /^\.build-lock\.\d+$/.test(name))
			rmSync(join(LOCK_DIR, name), { force: true });
	return true;
}

function mtime(path) {
	try {
		return statSync(path).mtimeMs;
	} catch {
		return 0;
	}
}

/**
 * Removes the lock only while it holds the bytes this process wrote: a pid
 * alone could be a dead holder's, reused by a later wrapper, whose exit would
 * then remove a lock that was never its own.
 */
function release() {
	if (mine !== undefined && readText(LOCK) === mine) rmSync(LOCK, { force: true });
	mine = undefined;
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

/**
 * This pid and every process under it, by `/proc`'s parent links (Linux; just
 * the pid elsewhere). Each one found is stopped before its children are looked
 * for, so none of them can start another that the walk would miss.
 */
function freezeTree(root) {
	const tree = [root];
	try {
		process.kill(root, 'SIGSTOP');
	} catch {
		return tree;
	}
	for (let grew = true; grew;) {
		grew = false;
		let names;
		try {
			// Read again on every pass: a child forked before its parent stopped
			// may be newer than the last listing.
			names = readdirSync('/proc').filter((name) => /^\d+$/.test(name));
		} catch {
			return tree;
		}
		for (const name of names) {
			const pid = Number(name);
			if (tree.includes(pid)) continue;
			const stat = readText(`/proc/${pid}/stat`);
			if (!stat) continue;
			// Field 4, the parent, follows the parenthesised command name.
			const parent = Number(stat.slice(stat.lastIndexOf(')') + 2).split(' ')[1]);
			if (!tree.includes(parent)) continue;
			try {
				process.kill(pid, 'SIGSTOP');
			} catch {
				continue;
			}
			tree.push(pid);
			grew = true;
		}
	}
	return tree;
}

/** The runner is gone: stop what this started, remove its files, and go. */
function orphaned() {
	log(`the runner that started this (pid ${PARENT}) is gone; stopping`);
	if (current?.pid) for (const pid of freezeTree(current.pid)) kill(pid, 'SIGKILL');
	// The exit handler unregisters and releases.
	process.exit(1);
}

function kill(pid, signal) {
	try {
		process.kill(pid, signal);
	} catch {
		// Gone already.
	}
}

// Unref'd, so it never holds the process open on its own.
setInterval(() => {
	if (process.ppid !== PARENT || !alive(PARENT)) orphaned();
}, PARENT_POLL_MS).unref();

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
		const fresh = tree !== undefined && stamp?.fingerprint === tree && existsSync(OUTPUT);
		const who = serving.map((u) => `pid ${u.pid} (port ${u.port})`).join(', ');
		if (fresh) {
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

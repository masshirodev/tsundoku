import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import {
	existsSync,
	mkdirSync,
	mkdtempSync,
	readdirSync,
	readFileSync,
	rmSync,
	writeFileSync
} from 'node:fs';
import { createServer, type AddressInfo, type Server } from 'node:net';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

/**
 * `scripts/build-lock.mjs` (c625), run as the webServer runs it, in a git
 * checkout of its own with stand-in commands: the build appends to `builds`
 * and makes `.svelte-kit/output`, and the server is a `sleep`. Each case is a
 * door into the output folder: two builds at once, a build under a running
 * preview (the same tree, or a changed one), a holder or a user that died, a
 * port that already answers, a build that fails, a wait that runs out, a
 * runner that dies without stopping it, and two or three waiters on one dead
 * holder (c729), held at the moment of their race by `BUILD_LOCK_PAUSE` and
 * let go together, so the interleaving that lost is the one run every time.
 *
 * Each wrapper is started as Playwright starts its webServer, the leader of a
 * process group of its own, and stopped as Playwright stops it, by SIGKILLing
 * that group: killing the wrapper alone orphaned its `sleep` (round 1's review
 * counted 9 per run).
 */
const SCRIPT = resolve('scripts/build-lock.mjs');

let dir: string;
/** Process groups this file started, each SIGKILLed after its case. */
const groups: number[] = [];

beforeEach(() => {
	dir = mkdtempSync(join(tmpdir(), 'build-lock-'));
	const git = (...args: string[]) => spawnSync('git', args, { cwd: dir });
	git('init', '-q');
	git('-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-q', '--allow-empty', '-m', 'base');
	writeFileSync(join(dir, '.gitignore'), '.svelte-kit/\nbuilds\nprepared\n*.log\npause-*/\n');
});

afterEach(() => {
	for (const group of groups) {
		try {
			process.kill(-group, 'SIGKILL');
		} catch {
			// The whole group is gone already.
		}
	}
	groups.length = 0;
	rmSync(dir, { recursive: true, force: true });
});

type Run = { child: ChildProcess; log: () => string; exited: Promise<number | null> };

function lock(
	name: string,
	{
		port = 1,
		build = 'sleep 0.5',
		env = {}
	}: { port?: number; build?: string; env?: Record<string, string> } = {}
): Run {
	let out = '';
	const child = spawn(
		process.execPath,
		[
			SCRIPT,
			'--port',
			String(port),
			'--prepare',
			`echo ${name} >> prepared`,
			'--build',
			`${build} && mkdir -p .svelte-kit/output && echo ${name} >> builds`,
			'--serve',
			'sleep 60'
		],
		{ cwd: dir, env: { ...process.env, ...env }, detached: true }
	);
	groups.push(child.pid!);
	child.stderr!.on('data', (d) => (out += d));
	const exited = new Promise<number | null>((r) => child.once('exit', (code) => r(code)));
	return { child, log: () => out, exited };
}

const lines = (file: string) =>
	existsSync(join(dir, file)) ? readFileSync(join(dir, file), 'utf8').trim().split('\n') : [];

async function until(what: () => boolean, ms = 4_000) {
	const end = Date.now() + ms;
	while (!what()) {
		if (Date.now() > end) throw new Error('timed out');
		await new Promise((r) => setTimeout(r, 50));
	}
}

const serving = (run: Run) => () => /built;|skipping the build/.test(run.log());

/** No such process, or one that has exited and waits to be reaped. */
function gone(pid: number) {
	try {
		const stat = readFileSync(`/proc/${pid}/stat`, 'utf8');
		return stat.slice(stat.lastIndexOf(')') + 2).startsWith('Z');
	} catch {
		return true;
	}
}

/** A lock left by a holder that is gone: a pid that has exited. */
function deadLock() {
	const dead = spawnSync('true').pid!;
	mkdirSync(join(dir, '.svelte-kit'), { recursive: true });
	writeFileSync(join(dir, '.svelte-kit/.build-lock'), JSON.stringify({ pid: dead, at: 0 }));
	return dead;
}

/** A folder for `BUILD_LOCK_PAUSE`, ignored by the tree's fingerprint. */
function pauseDir(name: string) {
	const path = join(dir, `pause-${name}`);
	mkdirSync(path);
	return path;
}

/** This run is held at that point of `acquire()`. */
const paused = (pause: string, point: string, run: Run) =>
	existsSync(join(pause, `${point}.${run.child.pid}`));

/** Lets every run held at that point go on, and every later one pass it. */
const go = (pause: string, point: string) => writeFileSync(join(pause, `${point}.go`), '');

const tickets = () =>
	readdirSync(join(dir, '.svelte-kit')).filter((name) => name.startsWith('.build-lock.takeover.'));

// Inside every case's waits: `until`'s 4 s default, the 1 s give-up below.
describe('build-lock', { timeout: 15_000 }, () => {
	it('builds and serves alone, and leaves no lock behind', async () => {
		const a = lock('a');
		await until(serving(a));
		expect(lines('builds')).toEqual(['a']);
		expect(existsSync(join(dir, '.svelte-kit/.build-lock'))).toBe(false);
		expect(existsSync(join(dir, `.svelte-kit/.build-users/${a.child.pid}`))).toBe(true);
		a.child.kill('SIGTERM');
		await a.exited;
		// Its user file goes with it, so the next run builds.
		expect(existsSync(join(dir, `.svelte-kit/.build-users/${a.child.pid}`))).toBe(false);
	});

	it('a second run started during the build waits, then serves that build', async () => {
		const a = lock('a', { build: 'sleep 1.5' });
		await until(() => a.log().includes('building'));
		const b = lock('b');
		await until(serving(b), 8_000);
		expect(b.log()).toMatch(/waiting: \.svelte-kit\/\.build-lock is held by pid \d+/);
		expect(b.log()).toMatch(/skipping the build/);
		expect(lines('builds')).toEqual(['a']);
		// Each run seeds its own database.
		expect(lines('prepared').sort()).toEqual(['a', 'b']);
	});

	it('a run started while another serves the same tree never builds under it', async () => {
		const a = lock('a');
		await until(serving(a));
		const b = lock('b');
		await until(serving(b));
		expect(b.log()).not.toMatch(/waiting/);
		expect(lines('builds')).toEqual(['a']);
	});

	it('with the tree changed, it waits for the server to go, then builds', async () => {
		const a = lock('a');
		await until(serving(a));
		writeFileSync(join(dir, 'new.ts'), 'export {};\n');
		const b = lock('b');
		await until(() => b.log().includes('the tree changed since the output was built'));
		expect(lines('builds')).toEqual(['a']);
		a.child.kill('SIGTERM');
		await until(serving(b));
		expect(lines('builds')).toEqual(['a', 'b']);
	});

	it('gives up with who it waited for, inside the time it is given', async () => {
		const a = lock('a');
		await until(serving(a));
		writeFileSync(join(dir, 'new.ts'), 'export {};\n');
		const b = lock('b', { env: { BUILD_LOCK_WAIT_MS: '1000' } });
		expect(await b.exited).toBe(1);
		expect(b.log()).toMatch(
			new RegExp(`gave up after waiting \\d+ ms .*pid ${a.child.pid} \\(port 1\\) still serves it`)
		);
		expect(lines('builds')).toEqual(['a']);
	});

	it('removes a lock and a user whose pids are gone, and builds', async () => {
		const dead = spawnSync('true').pid!;
		mkdirSync(join(dir, '.svelte-kit/.build-users'), { recursive: true });
		writeFileSync(join(dir, '.svelte-kit/.build-lock'), JSON.stringify({ pid: dead, at: 0 }));
		writeFileSync(join(dir, `.svelte-kit/.build-users/${dead}`), '{}');
		const a = lock('a');
		await until(serving(a));
		expect(a.log()).toContain(`taking over a stale lock from pid ${dead}`);
		expect(a.log()).toContain(`removing a stale user ${dead}`);
		expect(lines('builds')).toEqual(['a']);
		// Taken over by a rename: the file it wrote first is the lock, then gone.
		expect(existsSync(join(dir, `.svelte-kit/.build-lock.${a.child.pid}`))).toBe(false);
	});

	it('two waiters on one dead holder, let go together: exactly one takes it over and builds', async () => {
		const dead = deadLock();
		const pause = pauseDir('both');
		const a = lock('a', { build: 'sleep 1', env: { BUILD_LOCK_PAUSE: pause } });
		const b = lock('b', { build: 'sleep 1', env: { BUILD_LOCK_PAUSE: pause } });
		// Both have read the dead holder's bytes and found them stale, and
		// neither has acted on it: wave 32's review's interleaving.
		await until(() => paused(pause, 'stale', a) && paused(pause, 'stale', b));
		go(pause, 'stale');
		go(pause, 'ticket');
		await until(() => serving(a)() && serving(b)(), 8_000);
		const both = a.log() + b.log();
		expect(both.match(/; building/g)).toHaveLength(1);
		expect(both.match(new RegExp(`taking over a stale lock from pid ${dead}`, 'g'))).toHaveLength(
			1
		);
		expect(both.match(/skipping the build/g)).toHaveLength(1);
		expect(lines('builds')).toHaveLength(1);
		expect(tickets()).toEqual([]);
	});

	it('a third waiter, while the takeover is under way, waits for it like any holder', async () => {
		const dead = deadLock();
		const pause = pauseDir('three');
		const runs = ['a', 'b', 'c'].map((name) =>
			lock(name, { build: 'sleep 0.5', env: { BUILD_LOCK_PAUSE: pause } })
		);
		await until(() => runs.every((run) => paused(pause, 'stale', run)));
		go(pause, 'stale');
		// One ticket: the other two found it, its writer alive, and wait.
		await until(() => runs.filter((run) => paused(pause, 'ticket', run)).length === 1);
		const [winner] = runs.filter((run) => paused(pause, 'ticket', run));
		const others = runs.filter((run) => run !== winner);
		await until(() => others.every((run) => run.log().includes(`is held by pid ${dead}`)));
		expect(tickets()).toHaveLength(1);
		expect(runs.map((run) => run.log()).join('')).not.toContain('; building');
		go(pause, 'ticket');
		await until(() => runs.every((run) => serving(run)()), 8_000);
		expect(winner.log()).toContain(`taking over a stale lock from pid ${dead}`);
		for (const other of others) expect(other.log()).not.toContain('taking over');
		expect(lines('builds')).toHaveLength(1);
		expect(tickets()).toEqual([]);
	});

	it('a waiter killed holding the ticket leaves it, and the next takes the one after it', async () => {
		const dead = deadLock();
		const pause = pauseDir('killed');
		const a = lock('a', { env: { BUILD_LOCK_PAUSE: pause } });
		go(pause, 'stale');
		await until(() => paused(pause, 'ticket', a));
		process.kill(-a.child.pid!, 'SIGKILL');
		await a.exited;
		expect(tickets()).toHaveLength(1);
		// And a draft, as a winner killed between its draft and its rename leaves.
		writeFileSync(join(dir, `.svelte-kit/.build-lock.${a.child.pid}`), '{}');
		const b = lock('b');
		await until(serving(b));
		expect(existsSync(join(dir, `.svelte-kit/.build-lock.${a.child.pid}`))).toBe(false);
		expect(b.log()).toContain(`taking over a stale lock from pid ${dead}`);
		expect(lines('builds')).toEqual(['b']);
		expect(tickets()).toEqual([]);
	});

	it('a waiter that read the dead holder before another took it over gives up', async () => {
		deadLock();
		const pause = pauseDir('late');
		const b = lock('b', { env: { BUILD_LOCK_PAUSE: pause } });
		await until(() => paused(pause, 'stale', b));
		// While b sits on the dead bytes it read, a takes the lock and builds.
		const a = lock('a', { build: 'sleep 1.5' });
		await until(() => a.log().includes('; building'));
		go(pause, 'stale');
		go(pause, 'ticket');
		await until(() => b.log().includes(`is held by pid ${a.child.pid}`));
		await until(() => serving(a)() && serving(b)(), 8_000);
		expect(b.log()).not.toContain('taking over');
		expect(b.log()).toContain('skipping the build');
		expect(lines('builds')).toEqual(['a']);
		expect(tickets()).toEqual([]);
	});

	it('a user file whose pid now names another process is stale, and the run builds', async () => {
		// This test's own pid is alive, but not the process that file says
		// started at tick 1: a pid reused after the wrapper that wrote it was killed.
		mkdirSync(join(dir, '.svelte-kit/.build-users'), { recursive: true });
		writeFileSync(
			join(dir, `.svelte-kit/.build-users/${process.pid}`),
			JSON.stringify({ started: '1', port: 9 })
		);
		writeFileSync(join(dir, 'new.ts'), 'export {};\n');
		const a = lock('a');
		await until(serving(a));
		expect(a.log()).toContain(`removing a stale user ${process.pid}`);
		expect(lines('builds')).toEqual(['a']);
	});

	it('serves nothing when its port already answers', async () => {
		const server: Server = createServer().listen(0, '127.0.0.1');
		await new Promise((r) => server.once('listening', r));
		try {
			const a = lock('a', { port: (server.address() as AddressInfo).port });
			await until(() => a.log().includes('already answers; serving nothing'));
			expect(lines('builds')).toEqual([]);
			a.child.kill('SIGTERM');
			expect(await a.exited).toBe(0);
		} finally {
			server.close();
		}
	});

	it('a failed build releases the lock and registers nobody', async () => {
		const a = lock('a', { build: 'false' });
		expect(await a.exited).toBe(1);
		expect(existsSync(join(dir, '.svelte-kit/.build-lock'))).toBe(false);
		expect(existsSync(join(dir, `.svelte-kit/.build-users/${a.child.pid}`))).toBe(false);
		const b = lock('b');
		await until(serving(b));
		expect(lines('builds')).toEqual(['b']);
	});

	it('stops, and stops its server, when the runner that started it dies', async () => {
		// A runner between this file and the wrapper, as Playwright's is: the
		// shell prints the wrapper's pid and waits on it.
		let out = '';
		let err = '';
		const runner = spawn(
			'sh',
			[
				'-c',
				'"$@" & echo $!; wait',
				'sh',
				process.execPath,
				SCRIPT,
				'--port',
				'1',
				'--build',
				'mkdir -p .svelte-kit/output && echo a >> builds',
				'--serve',
				// A tree two deep, as yarn under a shell under vite preview is.
				'echo $$ > serve.pid; sleep 60 & echo $! > sleep.pid; wait'
			],
			{ cwd: dir, detached: true }
		);
		groups.push(runner.pid!);
		runner.stdout!.on('data', (d) => (out += d));
		runner.stderr!.on('data', (d) => (err += d));
		await until(
			() =>
				err.includes('built;') &&
				existsSync(join(dir, 'serve.pid')) &&
				existsSync(join(dir, 'sleep.pid'))
		);
		const wrapper = Number(out.trim());
		const serve = Number(readFileSync(join(dir, 'serve.pid'), 'utf8'));
		const sleep = Number(readFileSync(join(dir, 'sleep.pid'), 'utf8'));
		expect(existsSync(join(dir, `.svelte-kit/.build-users/${wrapper}`))).toBe(true);

		// Only the runner: nothing tells the wrapper, as nothing did in wave 31.
		process.kill(runner.pid!, 'SIGKILL');
		await until(() => gone(wrapper) && gone(serve) && gone(sleep), 4_000);
		expect(err).toContain(`the runner that started this (pid ${runner.pid}) is gone; stopping`);
		expect(existsSync(join(dir, `.svelte-kit/.build-users/${wrapper}`))).toBe(false);

		// And the next run on a changed tree builds at once, waiting for nobody.
		writeFileSync(join(dir, 'new.ts'), 'export {};\n');
		const b = lock('b');
		await until(serving(b));
		expect(b.log()).not.toMatch(/waiting:/);
		expect(lines('builds')).toEqual(['a', 'b']);
	});
});

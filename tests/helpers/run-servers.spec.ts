import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { recordServer, RUN_PREFIX, startedAt, sweepRuns } from './run-servers';

/**
 * The sweep of a killed run's servers (c689), on a folder of this file's own
 * standing in for `TMPDIR`: run directories named after a runner that is gone
 * (an exited pid) or alive (another worktree's run, still going: a process
 * this file started), each with the server records `friend-setup` writes.
 * The servers are `node` processes that only wait, started here and stopped
 * after each case by the pid this file saved.
 */
let base: string;
const started: ChildProcess[] = [];

beforeEach(() => {
	base = mkdtempSync(join(tmpdir(), 'run-servers-'));
});

afterEach(() => {
	for (const child of started) {
		try {
			process.kill(child.pid!, 'SIGKILL');
		} catch {
			// Gone already.
		}
	}
	started.length = 0;
	rmSync(base, { recursive: true, force: true });
});

/** A process that waits, as a server does; with `stubborn`, SIGTERM does nothing. */
async function server({ stubborn = false } = {}) {
	const code = `${stubborn ? "process.on('SIGTERM', () => {});" : ''} setInterval(() => {}, 1000); process.stdout.write('up');`;
	const child = spawn(process.execPath, ['-e', code], { stdio: ['ignore', 'pipe', 'ignore'] });
	started.push(child);
	// Up once it has said so: its SIGTERM handler is installed by then.
	await new Promise((r) => child.stdout!.once('data', r));
	return child;
}

const dead = () => spawnSync('true').pid!;

function runDir(runner: number) {
	const dir = join(base, `${RUN_PREFIX}${runner}`);
	mkdirSync(join(dir, `tsundoku-e2e-friend-home-4197`, 'library'), { recursive: true });
	return dir;
}

/** Gone, or exited and waiting for this file to reap it. */
function gone(pid: number) {
	try {
		const stat = readFileSync(`/proc/${pid}/stat`, 'utf8');
		return stat.slice(stat.lastIndexOf(')') + 2).startsWith('Z');
	} catch {
		return true;
	}
}

const quiet = { log: () => {} };

describe('run-servers', { timeout: 15_000 }, () => {
	it("stops a killed run's server and removes its directory, home included", async () => {
		const runner = dead();
		const dir = runDir(runner);
		const friend = await server();
		recordServer(dir, 'friend', friend.pid!, 4197);
		const said = sweepRuns(base, quiet);
		expect(said).toEqual([
			`stopped the friend server (pid ${friend.pid}, port 4197) left by run ${runner}, whose runner is gone`
		]);
		expect(gone(friend.pid!)).toBe(true);
		expect(existsSync(dir)).toBe(false);
	});

	it("never opens a live run's directory: its server and home stay", async () => {
		// Another worktree's run, still going: its runner is a live process.
		const runner = await server();
		const dir = runDir(runner.pid!);
		const friend = await server();
		recordServer(dir, 'friend', friend.pid!, 4197);
		expect(sweepRuns(base, quiet)).toEqual([]);
		expect(gone(friend.pid!)).toBe(false);
		expect(existsSync(join(dir, 'tsundoku-e2e-friend-home-4197', 'library'))).toBe(true);
		expect(existsSync(join(dir, 'servers', 'friend.json'))).toBe(true);
	});

	it('a recorded pid that now names another process is not stopped', async () => {
		const runner = dead();
		const dir = runDir(runner);
		const other = await server();
		// The pid is alive, but not the process that started at tick 1: a
		// server that exited, its pid taken by something else since.
		mkdirSync(join(dir, 'servers'));
		writeFileSync(
			join(dir, 'servers', 'friend.json'),
			JSON.stringify({ name: 'friend', pid: other.pid, started: '1', port: 4197 })
		);
		expect(sweepRuns(base, quiet)).toEqual([]);
		expect(gone(other.pid!)).toBe(false);
		expect(existsSync(dir)).toBe(false);
	});

	it('a record with no start time is named, not stopped', async () => {
		const runner = dead();
		const dir = runDir(runner);
		const other = await server();
		mkdirSync(join(dir, 'servers'));
		writeFileSync(
			join(dir, 'servers', 'friend.json'),
			JSON.stringify({ name: 'friend', pid: other.pid })
		);
		expect(sweepRuns(base, quiet)).toEqual([
			`not stopping the friend server (pid ${other.pid}) left by run ${runner}, whose runner is gone: its start time was not recorded, so pid ${other.pid} may be another process now`
		]);
		expect(gone(other.pid!)).toBe(false);
	});

	it('a server that ignores SIGTERM is killed once the grace has passed', async () => {
		const runner = dead();
		const dir = runDir(runner);
		const friend = await server({ stubborn: true });
		recordServer(dir, 'friend', friend.pid!, 4197);
		const at = Date.now();
		expect(sweepRuns(base, { ...quiet, graceMs: 500 })).toEqual([
			`stopped the friend server (pid ${friend.pid}, port 4197) left by run ${runner}, whose runner is gone`
		]);
		expect(Date.now() - at).toBeGreaterThanOrEqual(500);
		expect(gone(friend.pid!)).toBe(true);
	});

	it('a server that already exited, and a half-written record, are passed over', async () => {
		const runner = dead();
		const dir = runDir(runner);
		mkdirSync(join(dir, 'servers'));
		writeFileSync(
			join(dir, 'servers', 'friend.json'),
			JSON.stringify({ name: 'friend', pid: dead(), started: '1' })
		);
		writeFileSync(join(dir, 'servers', 'browse.json'), '{"name":"br');
		expect(sweepRuns(base, quiet)).toEqual([]);
		expect(existsSync(dir)).toBe(false);
	});

	it('records a server by its pid and its start time', async () => {
		const dir = runDir(dead());
		const friend = await server();
		recordServer(dir, 'friend', friend.pid!, 4197);
		expect(JSON.parse(readFileSync(join(dir, 'servers', 'friend.json'), 'utf8'))).toEqual({
			name: 'friend',
			pid: friend.pid,
			started: startedAt(friend.pid!),
			port: 4197
		});
		expect(startedAt(friend.pid!)).toMatch(/^\d+$/);
	});
});

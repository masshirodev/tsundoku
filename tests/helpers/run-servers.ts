import { mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * The servers a run starts outside Playwright's own webServer, recorded in the
 * run's directory so the next run can stop them when this one was killed.
 * No side effects: `run-dir.ts` calls `sweepRuns` as the config loads,
 * and `run-servers.spec.ts` calls it on a folder of its own.
 *
 * A runner killed outright (an agent's session ending, a `kill -9`) runs no
 * global teardown, so a server a global setup started is reparented and goes
 * on serving, as the friend world's `scripts/serve.ts` did. Its port comes from
 * the OS, so the next run takes a new one and its "port is taken" check never
 * meets the old server; that run's sweep would then remove the dead run's
 * directory, home included, under a server that still holds its database open
 * (deleted files that, on a default `TMPDIR`, stay in RAM).
 *
 * So a setup records each server it starts, by pid and the process's start
 * time (`/proc/<pid>/stat`, field 22: a pid alone may name a newer process
 * once the old one is gone), and the sweep, before it removes a dead run's
 * directory, stops each recorded server that is still that same process. A
 * live run's directory is never opened: its runner is alive, and its servers
 * are its own. Nothing is stopped by name or pattern, only by the recorded
 * pid, and only when the start time matches; a record it cannot check
 * (no `/proc`) is named in the log and left running.
 */

export const RUN_PREFIX = 'tsundoku-e2e-run-';
const SERVERS = 'servers';

export type ServerRecord = { name: string; pid: number; started?: string; port?: number };

export function alive(pid: number): boolean {
	try {
		process.kill(pid, 0);
		return true;
	} catch (e) {
		// A pid this user may not signal is still a live process.
		return (e as NodeJS.ErrnoException).code === 'EPERM';
	}
}

/** When the process started, in clock ticks since boot, or undefined (no such process, no `/proc`). */
export function startedAt(pid: number): string | undefined {
	try {
		const stat = readFileSync(`/proc/${pid}/stat`, 'utf8');
		// The command name, field 2, is in parentheses and may hold spaces.
		return stat.slice(stat.lastIndexOf(')') + 2).split(' ')[19];
	} catch {
		return undefined;
	}
}

/** Still the process the record was written for: alive, and started when it was. */
function same(record: ServerRecord): boolean {
	if (!alive(record.pid)) return false;
	const now = startedAt(record.pid);
	// A zombie's stat is still there; it has exited all the same.
	return now !== undefined && now === record.started && !zombie(record.pid);
}

function zombie(pid: number): boolean {
	try {
		const stat = readFileSync(`/proc/${pid}/stat`, 'utf8');
		return stat.slice(stat.lastIndexOf(')') + 2).startsWith('Z');
	} catch {
		return false;
	}
}

/** Records a server this run started, in its directory, for a later sweep. */
export function recordServer(runDir: string, name: string, pid: number, port?: number) {
	mkdirSync(join(runDir, SERVERS), { recursive: true });
	const record: ServerRecord = { name, pid, started: startedAt(pid), port };
	writeFileSync(join(runDir, SERVERS, `${name}.json`), JSON.stringify(record));
}

function records(runDir: string): ServerRecord[] {
	let names: string[];
	try {
		names = readdirSync(join(runDir, SERVERS));
	} catch {
		return [];
	}
	const found: ServerRecord[] = [];
	for (const name of names) {
		try {
			const record = JSON.parse(readFileSync(join(runDir, SERVERS, name), 'utf8'));
			if (Number.isInteger(record?.pid) && record.pid > 0) found.push(record);
		} catch {
			// Half written by the run that was killed: nothing to stop by.
		}
	}
	return found;
}

const pause = (ms: number) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);

/** SIGTERM, then SIGKILL once `graceMs` has passed. True once it has gone. */
function stop(pid: number, graceMs: number, record: ServerRecord): boolean {
	const signal = (sig: NodeJS.Signals) => {
		try {
			process.kill(pid, sig);
		} catch {
			// Gone already.
		}
	};
	signal('SIGTERM');
	for (const end = Date.now() + graceMs; Date.now() < end; pause(50))
		if (!same(record)) return true;
	signal('SIGKILL');
	for (const end = Date.now() + 2_000; Date.now() < end; pause(50)) if (!same(record)) return true;
	return false;
}

/**
 * Removes every run directory under `base` whose runner is gone, first
 * stopping each server it recorded that is still the same process. A
 * directory whose runner is alive is left whole. Returns what it said.
 */
export function sweepRuns(
	base: string,
	{
		graceMs = 5_000,
		log = (line: string): void => void process.stderr.write(`[run-dir] ${line}\n`)
	}: { graceMs?: number; log?: (line: string) => void } = {}
): string[] {
	const said: string[] = [];
	const say = (line: string) => {
		said.push(line);
		log(line);
	};
	let names: string[];
	try {
		names = readdirSync(base);
	} catch {
		return said;
	}
	for (const name of names) {
		const runner = Number(name.slice(RUN_PREFIX.length));
		if (!name.startsWith(RUN_PREFIX) || !Number.isInteger(runner) || runner <= 0) continue;
		if (alive(runner)) continue;
		const dir = join(base, name);
		for (const record of records(dir)) {
			const what = `the ${record.name} server (pid ${record.pid}${record.port ? `, port ${record.port}` : ''}) left by run ${runner}, whose runner is gone`;
			if (record.started === undefined) {
				if (alive(record.pid))
					say(
						`not stopping ${what}: its start time was not recorded, so pid ${record.pid} may be another process now`
					);
				continue;
			}
			if (!same(record)) continue;
			say(stop(record.pid, graceMs, record) ? `stopped ${what}` : `could not stop ${what}`);
		}
		// A run that was killed, or a `--list`, which has no teardown.
		rmSync(dir, { recursive: true, force: true });
	}
	return said;
}

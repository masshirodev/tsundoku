import { spawn } from 'node:child_process';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import { startPreview } from './highlights-preview';

/**
 * The highlights e2e files' preview wait (c701, round 2): a port someone else
 * serves is an error, never a run against their server and database.
 */
let other: Server | null = null;

afterEach(async () => {
	await new Promise<void>((r) => (other ? other.close(() => r()) : r()));
	other = null;
});

/** A server that is not ours, holding a port, as the works frames would. */
async function someoneElse(): Promise<string> {
	other = createServer((_req, res) => res.end('not yours'));
	await new Promise<void>((r) => other!.listen(0, '127.0.0.1', () => r()));
	return `http://127.0.0.1:${(other.address() as AddressInfo).port}`;
}

/** A free port nobody serves. */
async function freeBase(): Promise<string> {
	const probe = createServer();
	await new Promise<void>((r) => probe.listen(0, '127.0.0.1', () => r()));
	const { port } = probe.address() as AddressInfo;
	await new Promise<void>((r) => probe.close(() => r()));
	return `http://127.0.0.1:${port}`;
}

describe('startPreview', () => {
	it('refuses a port another server already answers on, before it starts anything', async () => {
		const base = await someoneElse();
		let started = false;
		await expect(
			startPreview(
				() => {
					started = true;
					return spawn(process.execPath, ['-e', 'setTimeout(() => {}, 5000)']);
				},
				base,
				'the frame',
				{ tries: 3, waitMs: 20 }
			)
		).rejects.toThrow(/something else already answers/);
		expect(started).toBe(false);
	});

	it('fails as soon as its own child exits, instead of polling the port to the end', async () => {
		const base = await freeBase();
		const began = Date.now();
		await expect(
			startPreview(() => spawn(process.execPath, ['-e', 'process.exit(1)']), base, 'the frame', {
				tries: 400,
				waitMs: 50
			})
		).rejects.toThrow(/exited \(1\) before it answered/);
		// 400 tries of 50 ms is 20 s; the exit is seen within the first few.
		expect(Date.now() - began).toBeLessThan(5_000);
	});

	it('returns its child once that child answers', async () => {
		const base = await freeBase();
		const port = new URL(base).port;
		const child = await startPreview(
			() =>
				spawn(process.execPath, [
					'-e',
					`require('node:http').createServer((q, s) => s.end('ok')).listen(${port}, '127.0.0.1')`
				]),
			base,
			'the frame',
			{ tries: 100, waitMs: 50 }
		);
		expect(child.exitCode).toBeNull();
		child.kill();
	});

	it('gives up, and stops its child, when nothing ever answers', async () => {
		const base = await freeBase();
		const child = spawn(process.execPath, ['-e', 'setTimeout(() => {}, 5000)']);
		await expect(
			startPreview(() => child, base, 'the frame', { tries: 3, waitMs: 20 })
		).rejects.toThrow(/never answered/);
		await new Promise((r) => child.once('exit', r));
		expect(child.signalCode).toBe('SIGTERM');
	});
});

import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from './fspath.ts';
import { isPrivateV4, lanReach, type LanReach } from './lan.ts';

/**
 * The listeners of a friend's install (doc/WIFI.md; card c188), run by
 * scripts/serve.ts in local mode in place of adapter-node's own: one on
 * 127.0.0.1, always, and one on each home-network address while WI-FI is on.
 * SETTINGS switches them through `globalThis.__tsundokuLan` (src/lib/server/
 * wifi.ts), in the same process, so ON never restarts the app.
 *
 * Every request is told which door it came in by (`x-tsundoku-via`, which
 * the hook reads: local or lan) and that it's plain http
 * (`x-tsundoku-proto`, adapter-node's PROTOCOL_HEADER), both overwritten
 * whatever a client sent. The origin is then the Host it asked for, so a
 * form posted from the phone's address passes the origin check there and
 * one from localhost passes it here. The hook refuses a Host that isn't one
 * of these addresses (DNS rebinding), and this refuses a client that isn't
 * on a private network at all.
 *
 * Plain node: serve.ts imports it before the app exists.
 */

type Handler = (req: IncomingMessage, res: ServerResponse, next: () => void) => void;

export type LanStatus = {
	on: boolean;
	reach: LanReach;
	/** Where it listens now, ip:port. */
	listening: string[];
	/** The address the router took away, and the new one: the handoff's band (2C). */
	changed: { from: string; to: string } | null;
	error: string | null;
	/** Windows asks, once, the first time: STARTING… names the dialog until then. */
	firstTime: boolean;
};

export type LanControl = {
	status(): LanStatus;
	setOn(on: boolean): Promise<LanStatus>;
	/** Every listener closed, for shutting down (serve.ts). */
	close(): Promise<void>;
	port: number;
};

type Saved = { on: boolean; started: boolean; address: string | null };

const plainV4 = (a: string | undefined) => (a ?? '').replace(/^::ffff:/, '');

export function startListeners(o: {
	handler: Handler;
	port: number;
	home: string;
	/** How often a change of address is looked for while on. */
	every?: number;
	reach?: () => LanReach;
}): Promise<LanControl> {
	const reachNow = o.reach ?? (() => lanReach());
	const file = join(o.home, 'wifi.json');
	const read = (): Saved => {
		try {
			const s = JSON.parse(readFileSync(file, 'utf8')) as Partial<Saved>;
			return { on: s.on === true, started: s.started === true, address: s.address ?? null };
		} catch {
			return { on: false, started: false, address: null };
		}
	};
	const saved = read();
	const save = () => {
		try {
			writeFileSync(file, JSON.stringify(saved) + '\n');
		} catch {
			// A data folder that can't be written: on until the next start.
		}
	};

	const serve = (via: 'local' | 'lan') => (req: IncomingMessage, res: ServerResponse) => {
		req.headers['x-tsundoku-via'] = via;
		req.headers['x-tsundoku-proto'] = 'http';
		o.handler(req, res, () => {
			res.statusCode = 404;
			res.end('not found');
		});
	};

	const lan = new Map<string, Server>();
	let reach: LanReach = { kind: 'none' };
	let changed: LanStatus['changed'] = null;
	let error: string | null = null;
	let timer: ReturnType<typeof setInterval> | null = null;

	const listenOn = (address: string) =>
		new Promise<void>((ok, no) => {
			const lanServe = serve('lan');
			const s = createServer((req, res) => {
				// Only a home network's clients: never the internet, whatever a router forwards.
				if (!isPrivateV4(plainV4(req.socket.remoteAddress))) {
					res.statusCode = 403;
					return res.end('not on this network');
				}
				lanServe(req, res);
			});
			s.once('error', no);
			s.listen(o.port, address, () => {
				s.off('error', no);
				lan.set(address, s);
				ok();
			});
		});

	const closeAll = async () => {
		await Promise.all(
			[...lan.values()].map(
				(s) =>
					new Promise<void>((ok) => {
						s.close(() => ok());
						s.closeAllConnections();
					})
			)
		);
		lan.clear();
	};

	/** Listen where the home network is now; note a moved address. */
	const follow = async () => {
		reach = reachNow();
		const want = reach.kind === 'home' ? reach.all : [];
		const same = want.length === lan.size && want.every((a) => lan.has(a));
		if (!same) {
			await closeAll();
			error = null;
			for (const a of want)
				try {
					await listenOn(a);
				} catch (e) {
					error = e instanceof Error ? e.message : String(e);
				}
		}
		if (reach.kind === 'home') {
			if (saved.address && saved.address !== reach.address)
				changed = { from: saved.address, to: reach.address };
			if (saved.address !== reach.address) {
				saved.address = reach.address;
				save();
			}
		}
	};

	const status = (): LanStatus => ({
		on: saved.on,
		reach: saved.on ? reach : reachNow(),
		listening: [...lan.keys()].map((a) => `${a}:${o.port}`),
		changed,
		error,
		firstTime: !saved.started
	});

	const setOn = async (on: boolean): Promise<LanStatus> => {
		if (on) {
			const r = reachNow();
			// The handoff's 2D: only a public address, and ON can't be pressed.
			if (r.kind === 'public') {
				reach = r;
				return status();
			}
			saved.on = true;
			save();
			await follow();
			if (lan.size) {
				saved.started = true;
				save();
			}
			timer ??= setInterval(() => void follow(), o.every ?? 15_000);
			timer.unref?.();
		} else {
			saved.on = false;
			save();
			if (timer) clearInterval(timer);
			timer = null;
			await closeAll();
		}
		return status();
	};

	return new Promise((ok, no) => {
		const local = createServer(serve('local'));
		local.once('error', no);
		local.listen(o.port, '127.0.0.1', async () => {
			local.off('error', no);
			const close = async () => {
				if (timer) clearInterval(timer);
				timer = null;
				await closeAll();
				await new Promise<void>((done) => {
					local.close(() => done());
					local.closeAllConnections();
				});
			};
			const control: LanControl = { status, setOn, close, port: o.port };
			if (saved.on) await setOn(true);
			ok(control);
		});
	});
}

/** Whether this data folder has WI-FI switched on, for a line at start. */
export const wifiSaved = (home: string) =>
	existsSync(join(home, 'wifi.json')) &&
	readFileSync(join(home, 'wifi.json'), 'utf8').includes('"on":true');

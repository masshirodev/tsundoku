// The `process` and `Buffer` globals the server code expects, set before any
// of it loads (worker.js imports this first). The environment is the web
// edition's: one database in OPFS, no token (there is no one else to keep
// out), no machine to reach.
import { Buffer } from 'buffer';

const env = {
	NODE_ENV: 'production',
	DATABASE_PATH: '/tsundoku.sqlite',
	TSUNDOKU_HOME: '/tsundoku',
	TSUNDOKU_EDITION: 'web'
};

globalThis.Buffer ??= Buffer;
globalThis.process ??= {
	env,
	platform: 'browser',
	version: 'v24.0.0',
	versions: { node: '24.0.0' },
	argv: [],
	pid: 1,
	cwd: () => '/',
	exit: () => {},
	on: () => {},
	once: () => {},
	off: () => {},
	emitWarning: () => {},
	nextTick: (fn, ...a) => queueMicrotask(() => fn(...a)),
	hrtime: Object.assign(() => [0, 0], {
		bigint: () => BigInt(Math.round(performance.now() * 1e6))
	}),
	memoryUsage: () => ({ rss: 0, heapUsed: 0, heapTotal: 0, external: 0 }),
	uptime: () => performance.now() / 1000
};

// Node's timers return a handle with unref() and ref(); the server calls
// unref() so a background job does not keep the process alive. A browser
// timer is a number: it gets the same methods, and clearTimeout still takes it,
// since a Number object converts to its value.
for (const name of ['setTimeout', 'setInterval']) {
	const native = globalThis[name].bind(globalThis);
	globalThis[name] = (...args) =>
		Object.assign(new Number(native(...args)), {
			unref() {
				return this;
			},
			ref() {
				return this;
			},
			hasRef: () => false,
			refresh() {
				return this;
			}
		});
}

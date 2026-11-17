import { afterAll, describe, expect, it } from 'vitest';
import { fork } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { hostExecArgv, NovelHost } from '$lib/server/novels/host';

// The plugin host's two layers (plugin-host.cjs, "the sandbox"; host.ts). The
// vm context is not a security boundary, but the escapes everyone knows must
// fail; and the process itself must hold for whatever gets past the context.

const store = mkdtempSync(join(tmpdir(), 'tsundoku-novel-sandbox-'));
const host = new NovelHost({ store, timeoutMs: 20_000 });

afterAll(() => {
	host.stop();
	rmSync(store, { recursive: true, force: true });
});

/**
 * Each way out, as a function that returns what it reached. `process` with a
 * pid is the host's own: an escape. Anything else, an error included, stayed
 * inside.
 */
const ESCAPES = `
var libFetch = require('@libs/fetch');
var storage = require('@libs/storage');
var cheerio = require('cheerio');
function hostError() {
	try { new URL('not an address'); } catch (e) { return e; }
}
var tries = {
	'a timer': function () { return setTimeout.constructor('return process')(); },
	'a timer\\'s handle': function () {
		return setTimeout(function () {}, 0).constructor.constructor('return process')();
	},
	'the global object': function () { return this.constructor.constructor('return process')(); },
	'require': function () { return require.constructor('return process')(); },
	'module': function () { return module.constructor.constructor('return process')(); },
	'console': function () { return console.log.constructor('return process')(); },
	'fetch': function () { return fetch.constructor('return process')(); },
	'fetch\\'s promise': function () {
		var p = fetch('not an address');
		p.catch(function () {});
		return p.constructor.constructor('return process')();
	},
	'a shim': function () { return libFetch.fetchApi.constructor('return process')(); },
	'an async shim\\'s prototype': function () {
		return Object.getPrototypeOf(libFetch.fetchText).constructor('return process')();
	},
	'a shim\\'s class': function () {
		return storage.storage.constructor.constructor('return process')();
	},
	'cheerio': function () { return cheerio.load.constructor('return process')(); },
	'a cheerio selection': function () {
		return cheerio.load('<p>x</p>')('p').constructor.constructor('return process')();
	},
	'a lent class': function () { return URL.constructor('return process')(); },
	'a lent instance': function () {
		return new URL('https://example.org/').constructor.constructor('return process')();
	},
	'a Buffer': function () { return Buffer.from('x').constructor.constructor('return process')(); },
	'a host error': function () { return hostError().constructor.constructor('return process')(); },
	'a host generator': function () {
		return Object.getPrototypeOf(function* () {}).constructor('return process')();
	}
};
function Escapes() {
	this.id = 'escapes';
	this.name = 'Escapes';
	this.site = 'https://example.org/';
	this.version = '1.0.0';
}
Escapes.prototype.parseChapter = async function (what) {
	if (what === 'stack') {
		// A host error's Error, told to hand over its call sites: it may not.
		var HostError = Object.getPrototypeOf(hostError().constructor);
		try { HostError.prepareStackTrace = function () { return 'mine'; }; } catch (e) {}
		try { Error.prepareStackTrace = function () { return 'mine'; }; } catch (e) {}
		return JSON.stringify([typeof HostError.prepareStackTrace, typeof Error.prepareStackTrace]);
	}
	var out = {};
	for (var name in tries) {
		try {
			var got = tries[name]();
			out[name] = got && typeof got.pid === 'number' ? 'escaped' : 'stayed';
		} catch (e) {
			out[name] = 'stayed';
		}
	}
	return JSON.stringify(out);
};
exports.default = new Escapes();
`;

describe('a plugin in the vm context', () => {
	const file = join(store, 'escapes.js');
	writeFileSync(file, ESCAPES);

	it('can’t reach the host process by any well-known constructor chain', async () => {
		const out = JSON.parse(await host.call<string>(file, 'parseChapter', ['all']));
		expect(Object.keys(out).length).toBe(18);
		for (const [how, what] of Object.entries(out)) expect(what, how).toBe('stayed');
	});

	it('can’t customise a stack trace to reach the frames under it, in either realm', async () => {
		expect(JSON.parse(await host.call<string>(file, 'parseChapter', ['stack']))).toEqual([
			'undefined',
			'undefined'
		]);
	});
});

describe('the plugin host’s process, for whatever gets out of the context', () => {
	/** Runs [code] as a file under exactly the host's flags, its env empty, and gives what it printed. */
	function under(code: string): Promise<string> {
		const file = join(store, `probe-${Math.random().toString(36).slice(2)}.cjs`);
		writeFileSync(file, code);
		return new Promise((ok, fail) => {
			const child = fork(file, [], {
				execArgv: hostExecArgv(store),
				env: {},
				stdio: ['ignore', 'pipe', 'pipe', 'ipc']
			});
			let out = '';
			child.stdout?.on('data', (d) => (out += d));
			child.on('error', fail);
			child.on('exit', () => ok(out.trim()));
		});
	}
	const attempt = (what: string) => `
		let said;
		try { said = 'did: ' + String(${what}); } catch (e) { said = 'refused: ' + (e.code || e.message); }
		console.log(said);
		process.exit(0);
	`;

	it('has no environment', async () => {
		expect(await under(attempt('JSON.stringify(process.env)'))).toBe('did: {}');
	});

	it('can’t read a file outside what it was given', async () => {
		expect(await under(attempt("require('node:fs').readFileSync('/etc/hostname', 'utf8')"))).toBe(
			'refused: ERR_ACCESS_DENIED'
		);
	});

	it('can’t write, start a process or load an addon', async () => {
		expect(
			await under(
				attempt(`require('node:fs').writeFileSync(${JSON.stringify(join(store, 'x'))}, 'x')`)
			)
		).toBe('refused: ERR_ACCESS_DENIED');
		expect(await under(attempt("require('node:child_process').spawnSync('true').status"))).toBe(
			'refused: ERR_ACCESS_DENIED'
		);
	});
});

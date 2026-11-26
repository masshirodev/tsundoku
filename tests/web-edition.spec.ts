/**
 * The web edition's stand-ins (doc/WEB-EDITION.md): what replaces a Node
 * piece in the browser build must answer as that piece does. Each part is
 * checked against the real thing where Node has it.
 */
import { describe, expect, it } from 'vitest';
import BetterSqlite from 'better-sqlite3';
// web/ is plain JavaScript with JSDoc types, checked by svelte-check through
// these imports.
import nodePath from 'node:path';
import { randomBytes } from 'node:crypto';
import realSharp from 'sharp';
import * as nodeNet from 'node:net';
import * as webNet from '../web/net.js';
import webSharp, { plan } from '../web/sharp.js';

type Resize = import('sharp').ResizeOptions & { fit?: 'cover'; position?: 'top' };
import WebSqlite, { load, ready } from '../web/sqlite.js';
import * as webPath from '../web/node-path.js';
import { nodeStubs } from '../web/node-stubs.js';
import { holdTheStart } from '../web/adapter.js';
import { AsyncLocalStorage } from '../web/async-hooks.js';

/* eslint-disable @typescript-eslint/no-explicit-any -- both databases are driven the same untyped way */
type Db = any;

/** The same statements on both, so every answer can be compared. */
function exercise(db: Db) {
	const out: Record<string, unknown> = {};
	db.exec(
		'CREATE TABLE series (id INTEGER PRIMARY KEY, title TEXT NOT NULL, rating INTEGER NOT NULL DEFAULT 0)'
	);
	const insert = db.prepare('INSERT INTO series (title, rating) VALUES (?, ?)');
	out.first = insert.run('Invented One', 4);
	out.second = insert.run(['Invented Two', 0]);
	out.named = db
		.prepare('INSERT INTO series (title, rating) VALUES (@title, @rating)')
		.run({ title: 'Invented Three', rating: 10 });
	out.get = db.prepare('SELECT id, title FROM series WHERE rating = ?').get(10);
	out.missing = db.prepare('SELECT id FROM series WHERE id = ?').get(99);
	out.all = db.prepare('SELECT title FROM series ORDER BY id').all();
	out.pluck = db.prepare('SELECT title FROM series ORDER BY id').pluck().all();
	out.raw = db.prepare('SELECT id, rating FROM series ORDER BY id').raw().all();
	out.changes = db.prepare('UPDATE series SET rating = rating + 1').run().changes;
	out.version = db.pragma('user_version', { simple: true });
	out.pragmaRows = db.pragma('table_info(series)').map((r: { name: string }) => r.name);

	const add = db.transaction((title: string) => insert.run(title, 1));
	add('Invented Four');
	const fails = db.transaction(() => {
		insert.run('Rolled Back', 1);
		throw new Error('boom');
	});
	expect(() => fails()).toThrow('boom');
	// A transaction inside one is a savepoint: the inner rolls back alone.
	const outer = db.transaction(() => {
		insert.run('Outer Kept', 1);
		try {
			fails();
		} catch {
			// the inner one's failure is the point
		}
	});
	outer();
	out.afterTx = db.prepare('SELECT title FROM series ORDER BY id').pluck().all();
	out.inTx = db.inTransaction;
	expect(() => db.prepare('SELEKT nope')).toThrow();
	expect(() => db.prepare('SELECT ?').get(true)).toThrow();
	return out;
}

describe('the SQLite stand-in', () => {
	it('answers every call tsundoku makes as better-sqlite3 does', async () => {
		await load();
		const real = exercise(new BetterSqlite(':memory:'));
		const web = exercise(new WebSqlite(':memory:'));
		expect(web).toEqual(real);
		expect(web.afterTx).toEqual([
			'Invented One',
			'Invented Two',
			'Invented Three',
			'Invented Four',
			'Outer Kept'
		]);
	});

	it('refuses a file database before the OPFS pool is ready', async () => {
		await load();
		expect(() => new WebSqlite('/tsundoku.sqlite')).toThrow('ready() has not finished');
	});
});

describe('node:path in the browser', () => {
	const cases = [
		['join', ['a', 'b/../c', './d']],
		['join', ['/x/', '', 'y']],
		['join', ['']],
		['normalize', ['/a//b/../c/./']],
		['normalize', ['../a/..']],
		['dirname', ['/a/b/c.txt']],
		['dirname', ['c.txt']],
		['dirname', ['/']],
		['basename', ['/a/b/c.txt', '.txt']],
		['basename', ['/a/b/']],
		['extname', ['archive.tar.gz']],
		['extname', ['.hidden']],
		['relative', ['/a/b/c', '/a/d']],
		['resolve', ['/a', 'b', '../c']],
		['isAbsolute', ['/a']],
		['parse', ['/home/u/file.cbz']]
	] as const;
	for (const [fn, args] of cases) {
		it(`${fn}(${args.map((a) => JSON.stringify(a)).join(', ')})`, () => {
			expect((webPath as any)[fn](...args)).toEqual((nodePath.posix as any)[fn](...args));
		});
	}
});

describe('the Buffer the server worker gets', () => {
	// web/process.js sets the `buffer` package as the global Buffer. Version 5
	// lacked the BigInt reads an APK's signing block needs (readBigUInt64LE),
	// and installing failed in the browser only; package.json pins 6.
	it('has the reads the server code uses', async () => {
		// 'buffer/' is the package; a bare 'buffer' in Node is Node's own.
		const { Buffer: WebBuffer } = await import('buffer/');
		const b = WebBuffer.from([1, 0, 0, 0, 0, 0, 0, 0, 2, 0, 0, 0]);
		expect(b.readBigUInt64LE(0)).toBe(1n);
		expect(b.readUInt32LE(8)).toBe(2);
		expect(typeof WebBuffer.prototype.readBigInt64LE).toBe('function');
	});

	// The package lacks base64url, which the server code uses for ids and
	// tokens; web/buffer.js adds it. Every answer is checked against Node's.
	it('speaks base64url as Node does', async () => {
		const { Buffer: WebBuffer } = await import('../web/buffer.js');
		expect(WebBuffer.isEncoding('base64url')).toBe(true);
		for (let n = 0; n < 40; n++) {
			const raw = randomBytes(n);
			const want = raw.toString('base64url');
			const web = WebBuffer.from(raw);
			expect(web.toString('base64url')).toBe(want);
			expect(web.toString('base64url', 1, n)).toBe(raw.toString('base64url', 1, n));
			expect([...WebBuffer.from(want, 'base64url')]).toEqual([...raw]);
			expect(WebBuffer.byteLength(want, 'base64url')).toBe(Buffer.byteLength(want, 'base64url'));
		}
		const out = WebBuffer.alloc(4);
		out.write('-_8', 'base64url');
		expect([...out]).toEqual([...Buffer.from('-_8', 'base64url'), 0, 0]);
		// Every other encoding is the package's own.
		expect(WebBuffer.from('héllo').toString()).toBe('héllo');
		expect(WebBuffer.from('aGk=', 'base64').toString('hex')).toBe('6869');
	});
});

describe('the node:net stand-in', () => {
	// web/net.js: the pure calls only, net-guard.ts's isIP among them.
	const cases = [
		'1.2.3.4',
		'255.255.255.255',
		'256.1.1.1',
		'01.2.3.4',
		'1.2.3',
		'1.2.3.4.5',
		'0.0.0.0',
		'::',
		'::1',
		'1::',
		'1::2',
		'fe80::1%eth0',
		'fe80::1%',
		'::ffff:1.2.3.4',
		'::ffff:1.2.3.256',
		'1:2:3:4:5:6:7:8',
		'1:2:3:4:5:6:7:8:9',
		'1:2:3:4:5:6:7::',
		'::2:3:4:5:6:7:8',
		'1:2:3:4:5:6::7:8',
		':1:2:3:4:5:6:7',
		' 1.2.3.4',
		'localhost',
		'example.org',
		'[::1]',
		'12345::',
		'g::1',
		'1:::2',
		'1::2::3',
		'1:2:3:4:5:6:1.2.3.4',
		'1:2:3:4:5:6:7:1.2.3.4',
		'::1.2.3.4',
		'1.2.3.4::',
		':',
		'',
		'2001:DB8::A',
		'1:2:3:4:5:6:7:',
		'::%eth0',
		'abcd::12345'
	];
	it.each(cases)('answers %j as Node does', (c) => {
		expect(webNet.isIP(c)).toBe(nodeNet.isIP(c));
		expect(webNet.isIPv4(c)).toBe(nodeNet.isIPv4(c));
		expect(webNet.isIPv6(c)).toBe(nodeNet.isIPv6(c));
	});
});

describe('the sharp stand-in', () => {
	// web/sharp.js draws thumbnails with OffscreenCanvas, which Node lacks; its
	// geometry is a pure function, held to the size real sharp gives.
	const cases: [number, number, Resize][] = [
		[1200, 1800, { width: 400, withoutEnlargement: true }],
		[300, 450, { width: 400, withoutEnlargement: true }],
		[800, 12000, { width: 400, height: 580, fit: 'cover', position: 'top' }],
		[1920, 1080, { width: 400, height: 225, fit: 'cover' }],
		[1000, 1000, { width: 320, height: 180, fit: 'cover' }],
		[333, 777, { width: 320, withoutEnlargement: true }],
		[640, 480, { height: 120 }]
	];
	it.each(cases)('cuts %ix%i as sharp does for %o', async (w, h, r) => {
		const real = await realSharp({
			create: { width: w, height: h, channels: 3, background: '#808080' }
		})
			.resize(r)
			.webp()
			.toBuffer({ resolveWithObject: true });
		const p = plan(w, h, r);
		expect([p.dw, p.dh]).toEqual([real.info.width, real.info.height]);
		expect(p.sx + p.sw).toBeLessThanOrEqual(w);
		expect(p.sy + p.sh).toBeLessThanOrEqual(h);
		// The source piece has the output's aspect, to a pixel's rounding.
		expect(Math.abs(p.sw / p.sh - p.dw / p.dh)).toBeLessThan(0.01 + 1 / Math.min(p.sw, p.sh));
		if (r.position === 'top') expect(p.sy).toBe(0);
	});

	it('says which call is not in the web edition', () => {
		expect(() => webSharp(new Uint8Array()).stats()).toThrow(
			/sharp\.stats .*not in the web edition/
		);
	});
});

describe('the Node built-in stand-ins', () => {
	const plugin = nodeStubs();

	it('takes over every built-in, with or without node:, and nothing else', () => {
		expect(plugin.resolveId('node:fs')).toBe('\0node-stub:fs');
		expect(plugin.resolveId('child_process')).toBe('\0node-stub:child_process');
		expect(plugin.resolveId('node:sqlite')).toBe('\0node-stub:sqlite');
		expect(plugin.resolveId('node:path')).toMatch(/web\/node-path\.js$/);
		expect(plugin.resolveId('cheerio')).toBeNull();
	});

	it('loads without throwing, and throws only when called', async () => {
		const code = (await plugin.load('\0node-stub:child_process')) as string;
		const mod = await import(`data:text/javascript,${encodeURIComponent(code)}`);
		expect(() => mod.spawn('ffmpeg')).toThrow('node:child_process.spawn is not in the web edition');
		expect(() => mod.default.someFutureCall()).toThrow('node:child_process.someFutureCall');
		expect(await plugin.load('cheerio')).toBeNull();
	});

	it('takes fs’s implemented calls from web/fs.js, and stubs the rest of it', async () => {
		const fs = (await plugin.load('\0node-stub:fs')) as string;
		expect(fs).toMatch(/import \* as impl from ".*web\/fs\.js";/);
		for (const call of ['readFileSync', 'writeFileSync', 'renameSync', 'promises'])
			expect(fs).toContain(`export const ${call} = impl.${call};`);
		// Streams serve downloaded files, which the web edition does not keep yet.
		expect(fs).toContain('export const createReadStream = missing("createReadStream");');
		const promises = (await plugin.load('\0node-stub:fs/promises')) as string;
		expect(promises).toMatch(/web\/fs-promises\.js/);
		expect(promises).toContain('export const readFile = impl.readFile;');
		expect(promises).toContain('export const open = missing("open");');
	});
});

describe('the shell held for boot.js', () => {
	const shell = `<html><head></head><body><div><script>
				{
					const element = document.currentScript.parentElement;
					Promise.all([import("/a.js"), import("/b.js")]).then(([kit, app]) => { kit.start(app, element); });
				}
			</script></div></body></html>`;

	it('turns the start into a function that keeps its script element', () => {
		const html = holdTheStart(shell);
		expect(html).toContain('window.__tsundokuStart = ((__script) => () =>');
		expect(html).toContain('__script.parentElement');
		expect(html).not.toContain('document.currentScript.parentElement');
		expect(html).toContain('<script type="module" src="/boot.js"></script></head>');
	});

	it('refuses a shell it does not recognise, rather than ship one that never starts', () => {
		expect(() => holdTheStart('<html><head></head></html>')).toThrow('no kit.start script');
	});
});

describe('AsyncLocalStorage in the browser', () => {
	it('holds the store run() was given', () => {
		const als = new AsyncLocalStorage();
		expect(als.run({ locale: 'ja' }, () => als.getStore())).toEqual({ locale: 'ja' });
	});
});

// Last in the file: a ready() that succeeds keeps its pool for the module's life.
describe('opening the OPFS pool', () => {
	const refused = () =>
		Object.assign(new Error('Access Handles cannot be created'), {
			name: 'NoModificationAllowedError'
		});

	it('gives up once its wait is over, with the browser’s own error', async () => {
		const calls: unknown[] = [];
		const install = async (o: object) => {
			calls.push(o);
			throw refused();
		};
		await expect(ready({ install, waitMs: 120 })).rejects.toThrow('Access Handles');
		expect(calls.length).toBeGreaterThan(1);
	});

	it('tries again while the tab it took over lets go, telling SQLite to forget the failure', async () => {
		const flags: unknown[] = [];
		const pool = { name: 'pool' };
		const install = async (o: { forceReinitIfPreviouslyFailed?: boolean }) => {
			flags.push(o.forceReinitIfPreviouslyFailed);
			if (flags.length < 3) throw refused();
			return pool;
		};
		expect(await ready({ install })).toBe(pool);
		expect(flags).toEqual([false, true, true]);
		// Opened once: a second call is the same pool, without installing again.
		expect(await ready({ install })).toBe(pool);
		expect(flags).toHaveLength(3);
	});
});

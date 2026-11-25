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
import WebSqlite, { load } from '../web/sqlite.js';
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
		const code = (await plugin.load('\0node-stub:fs')) as string;
		const mod = await import(`data:text/javascript,${encodeURIComponent(code)}`);
		expect(() => mod.readFileSync('/x')).toThrow('node:fs.readFileSync is not in the web edition');
		expect(mod.existsSync('/x')).toBe(false);
		expect(() => mod.default.someFutureCall()).toThrow('node:fs.someFutureCall');
		expect(await plugin.load('cheerio')).toBeNull();
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

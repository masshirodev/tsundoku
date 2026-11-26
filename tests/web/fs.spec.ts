/**
 * The web edition's `node:fs` (web/fs-store.js, doc/WEB-EDITION.md, "Files"),
 * held to Node's own fs call by call: each case runs the same calls on a real
 * folder and on the stand-in (better-sqlite3 in memory, the browser's SQLite
 * in the web edition), and the answers, the files left and the error codes
 * must be the same. A case reads as a story the server code could tell.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import * as nodeFs from 'node:fs';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import BetterSqlite from 'better-sqlite3';
import { createFs } from '../../web/fs-store.js';

let root = '';
beforeAll(() => {
	root = mkdtempSync(join(tmpdir(), 'tsundoku-webfs-'));
});
afterAll(() => rmSync(root, { recursive: true, force: true }));

/* eslint-disable @typescript-eslint/no-explicit-any -- both file systems are driven the same untyped way */
type Fs = any;

/** What a call came to, comparable across the two: its value made plain, or its error's code. */
function outcome(run: () => unknown, strip: (p: string) => string): unknown {
	try {
		return { ok: plain(run(), strip) };
	} catch (e) {
		return { code: (e as NodeJS.ErrnoException).code };
	}
}

function plain(v: unknown, strip: (p: string) => string): unknown {
	if (v === undefined || v === null) return v;
	if (typeof v === 'string') return strip(v);
	if (v instanceof Uint8Array) return `bytes:${Buffer.from(v).toString('base64')}`;
	if (Array.isArray(v))
		return v
			.map((x) =>
				typeof x === 'object' && x && 'isDirectory' in x
					? `${x.name}${x.isDirectory() ? '/' : ''}`
					: x
			)
			.sort();
	if (typeof v === 'object' && 'isDirectory' in (v as object)) {
		const s = v as nodeFs.Stats;
		return { file: s.isFile(), dir: s.isDirectory(), size: s.isFile() ? s.size : 'dir' };
	}
	return v;
}

/**
 * Runs `story` on a fresh real folder and a fresh stand-in, and expects the
 * same outcome of every step.
 */
function same(name: string, story: (fs: Fs, at: (p: string) => string) => (() => unknown)[]) {
	it(name, () => {
		const real = mkdtempSync(join(root, 'case-'));
		const web = createFs(() => new BetterSqlite(':memory:'));
		const realSteps = story(nodeFs, (p) => join(real, p));
		const webSteps = story(web, (p) => join('/', p));
		const stripReal = (s: string) => (s.startsWith(real) ? s.slice(real.length) || '/' : s);
		const realOut = realSteps.map((step) => outcome(step, stripReal));
		const webOut = webSteps.map((step) => outcome(step, (s) => s));
		expect(webOut).toEqual(realOut);
	});
}

describe('node:fs in the web edition, against Node’s own', () => {
	same('write, read back as bytes and as text, overwrite', (fs, at) => [
		() => fs.writeFileSync(at('a.txt'), 'first'),
		() => fs.readFileSync(at('a.txt'), 'utf8'),
		() => fs.writeFileSync(at('a.txt'), new Uint8Array([1, 2, 3])),
		() => fs.readFileSync(at('a.txt')),
		() => fs.readFileSync(at('a.txt'), { encoding: 'base64' }),
		() => fs.existsSync(at('a.txt')),
		() => fs.existsSync(at('nope'))
	]);

	same('append, to a new file and an old one', (fs, at) => [
		() => fs.appendFileSync(at('log'), 'one\n'),
		() => fs.appendFileSync(at('log'), 'two\n'),
		() => fs.writeFileSync(at('log'), 'three\n', { flag: 'a' }),
		() => fs.readFileSync(at('log'), 'utf8')
	]);

	same('mkdir: plain, recursive, existing, under a file, with no parent', (fs, at) => [
		() => fs.mkdirSync(at('d')),
		() => fs.mkdirSync(at('d')),
		() => fs.mkdirSync(at('d'), { recursive: true }),
		() => fs.mkdirSync(at('x/y/z'), { recursive: true }),
		() => fs.mkdirSync(at('p/q')),
		() => fs.writeFileSync(at('f'), ''),
		() => fs.mkdirSync(at('f/g'), { recursive: true }),
		() => fs.statSync(at('x/y')).isDirectory()
	]);

	same('a missing file, a file under a missing folder, a folder read as a file', (fs, at) => [
		() => fs.readFileSync(at('missing')),
		() => fs.writeFileSync(at('no/such/dir/file'), 'x'),
		() => fs.mkdirSync(at('dir')),
		() => fs.readFileSync(at('dir')),
		() => fs.writeFileSync(at('dir'), 'x'),
		() => fs.statSync(at('missing')),
		() => fs.statSync(at('missing'), { throwIfNoEntry: false })
	]);

	same('the APK dance: write .partial, rename into place, read, remove', (fs, at) => [
		() => fs.mkdirSync(at('store/apks'), { recursive: true }),
		() => fs.writeFileSync(at('store/apks/h1.apk.partial'), new Uint8Array([80, 75, 3, 4])),
		() => fs.renameSync(at('store/apks/h1.apk.partial'), at('store/apks/h1.apk')),
		() => fs.existsSync(at('store/apks/h1.apk.partial')),
		() => fs.readFileSync(at('store/apks/h1.apk')),
		() => fs.statSync(at('store/apks/h1.apk')),
		() => fs.rmSync(at('store/apks/h1.apk'), { force: true }),
		() => fs.rmSync(at('store/apks/h1.apk'), { force: true }),
		() => fs.rmSync(at('store/apks/h1.apk')),
		() => fs.readdirSync(at('store/apks'))
	]);

	same('rename onto a file, onto a folder, a folder onto an empty and a full one', (fs, at) => [
		() => fs.writeFileSync(at('a'), 'A'),
		() => fs.writeFileSync(at('b'), 'B'),
		() => fs.renameSync(at('a'), at('b')),
		() => fs.readFileSync(at('b'), 'utf8'),
		() => fs.mkdirSync(at('d1/sub'), { recursive: true }),
		() => fs.writeFileSync(at('d1/sub/x'), 'x'),
		() => fs.mkdirSync(at('empty')),
		() => fs.renameSync(at('d1'), at('empty')),
		() => fs.readFileSync(at('empty/sub/x'), 'utf8'),
		() => fs.existsSync(at('d1')),
		() => fs.mkdirSync(at('full/child'), { recursive: true }),
		() => fs.renameSync(at('empty'), at('full')),
		() => fs.renameSync(at('b'), at('full')),
		() => fs.renameSync(at('missing'), at('elsewhere'))
	]);

	same('readdir: names and file types, of a folder, of a file, of nothing', (fs, at) => [
		() => fs.mkdirSync(at('lib/series'), { recursive: true }),
		() => fs.writeFileSync(at('lib/a.cbz'), ''),
		() => fs.writeFileSync(at('lib/series/b.cbz'), ''),
		() => fs.readdirSync(at('lib')),
		() => fs.readdirSync(at('lib'), { withFileTypes: true }),
		() => fs.readdirSync(at('lib/a.cbz')),
		() => fs.readdirSync(at('none'))
	]);

	same('rm and rmdir: a folder needs recursive, a full one is not empty', (fs, at) => [
		() => fs.mkdirSync(at('t/u'), { recursive: true }),
		() => fs.writeFileSync(at('t/u/f'), ''),
		() => fs.rmSync(at('t')),
		() => fs.rmdirSync(at('t')),
		() => fs.unlinkSync(at('t')),
		() => fs.rmSync(at('t'), { recursive: true }),
		() => fs.existsSync(at('t/u/f')),
		() => fs.mkdirSync(at('e')),
		() => fs.rmdirSync(at('e')),
		() => fs.unlinkSync(at('missing'))
	]);

	same('copy a file, and a folder only with recursive', (fs, at) => [
		() => fs.writeFileSync(at('src'), 'S'),
		() => fs.copyFileSync(at('src'), at('dst')),
		() => fs.readFileSync(at('dst'), 'utf8'),
		() => fs.mkdirSync(at('tree/leaf'), { recursive: true }),
		() => fs.writeFileSync(at('tree/leaf/f'), 'F'),
		() => fs.cpSync(at('tree'), at('copy'), { recursive: true }),
		() => fs.readFileSync(at('copy/leaf/f'), 'utf8'),
		() => fs.copyFileSync(at('missing'), at('x'))
	]);
});

describe('what only the stand-in says', () => {
	it('the promises answer as the calls do', async () => {
		const web = createFs(() => new BetterSqlite(':memory:'));
		await web.promises.mkdir('/p', { recursive: true });
		await web.promises.writeFile('/p/f', 'hi');
		expect(await web.promises.readFile('/p/f', 'utf8')).toBe('hi');
		expect(await web.promises.readdir('/p')).toEqual(['f']);
		expect((await web.promises.stat('/p/f'))?.size).toBe(2);
		await expect(web.promises.access('/p/none')).rejects.toMatchObject({ code: 'ENOENT' });
		await web.promises.rm('/p', { recursive: true });
		expect(web.existsSync('/p')).toBe(false);
	});

	it('errors read as Node’s, path and all', () => {
		const web = createFs(() => new BetterSqlite(':memory:'));
		expect(() => web.readFileSync('/gone')).toThrow(
			"ENOENT: no such file or directory, open '/gone'"
		);
		expect(() => web.readFileSync('/gone')).toThrow(
			expect.objectContaining({ code: 'ENOENT', errno: -2, syscall: 'open', path: '/gone' })
		);
	});

	it('a path may be a URL or bytes, and is made absolute and normal', () => {
		const web = createFs(() => new BetterSqlite(':memory:'));
		web.writeFileSync('rel.txt', 'r');
		expect(web.readFileSync(new URL('file:///rel.txt'), 'utf8')).toBe('r');
		expect(web.readFileSync(Buffer.from('/a/../rel.txt'), 'utf8')).toBe('r');
	});

	it('the root is always there, and says so', () => {
		const web = createFs(() => new BetterSqlite(':memory:'));
		expect(web.existsSync('/')).toBe(true);
		expect(web.statSync('/')?.isDirectory()).toBe(true);
		web.writeFileSync('/f', '');
		expect(web.readdirSync('/')).toEqual(['f']);
	});

	it('room on the disk is the browser’s to refuse, at the write', () => {
		const web = createFs(() => new BetterSqlite(':memory:'));
		expect(web.statfsSync().bavail).toBeGreaterThan(0);
	});

	it('the database is asked for once, on first use', () => {
		let opened = 0;
		const web = createFs(() => {
			opened++;
			return new BetterSqlite(':memory:');
		});
		expect(opened).toBe(0);
		web.existsSync('/x');
		web.writeFileSync('/x', '');
		expect(opened).toBe(1);
	});
});

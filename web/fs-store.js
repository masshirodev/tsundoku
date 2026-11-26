// A file system on a SQLite table, for the web edition's `node:fs` stand-in
// (web/fs.js, doc/WEB-EDITION.md, "Files"). The server code writes files as it
// does on a computer (an installed extension's APK, a backup), and mostly with
// the `*Sync` calls, so this has to be synchronous: in the server worker the
// table lives in a second database on the same `opfs-sahpool` VFS as the
// library, which is synchronous in a dedicated worker.
//
// Files and directories are rows. Node's semantics and error codes are kept
// call by call (`tests/web/fs.spec.ts` compares each with Node's own fs), so
// server code that handles ENOENT or EEXIST keeps working unchanged.
//
// `createFs(db)` takes any database with better-sqlite3's shape: the web
// edition's stand-in in the browser, better-sqlite3 itself in the spec.
import { Buffer } from 'buffer';
import * as path from './node-path.js';

/** @typedef {{ path: string, dir: number, data: Uint8Array | null, mtime: number }} Row */

const MESSAGES = {
	ENOENT: 'no such file or directory',
	EEXIST: 'file already exists',
	ENOTDIR: 'not a directory',
	EISDIR: 'illegal operation on a directory',
	ENOTEMPTY: 'directory not empty'
};
const ERRNO = { ENOENT: -2, EEXIST: -17, ENOTDIR: -20, EISDIR: -21, ENOTEMPTY: -39 };

/**
 * An error as Node's fs throws it.
 * @param {keyof typeof MESSAGES} code
 * @param {string} syscall
 * @param {string} p
 * @param {string} [dest]
 */
function fsError(code, syscall, p, dest) {
	const e = /** @type {NodeJS.ErrnoException & { dest?: string }} */ (
		new Error(`${code}: ${MESSAGES[code]}, ${syscall} '${p}'${dest ? ` -> '${dest}'` : ''}`)
	);
	Object.assign(e, { errno: ERRNO[code], code, syscall, path: p });
	if (dest) e.dest = dest;
	return e;
}

/** @param {unknown} p */
function toPath(p) {
	if (p instanceof URL) return decodeURIComponent(p.pathname);
	if (p instanceof Uint8Array) return Buffer.from(p).toString('utf8');
	return String(p);
}

/** Absolute and normal, with no trailing slash but the root's. @param {unknown} p */
const norm = (p) => path.resolve('/', toPath(p));

/** @param {unknown} data @param {string | null | undefined} encoding */
function toBytes(data, encoding) {
	if (typeof data === 'string')
		return new Uint8Array(Buffer.from(data, /** @type {BufferEncoding} */ (encoding ?? 'utf8')));
	if (ArrayBuffer.isView(data))
		return new Uint8Array(data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength));
	throw new TypeError(
		'The "data" argument must be of type string or an instance of Buffer, TypedArray, or DataView'
	);
}

/** @param {unknown} opts @returns {string | null} */
function encodingOf(opts) {
	if (typeof opts === 'string') return opts;
	const o = /** @type {{ encoding?: string | null } | null | undefined} */ (opts);
	return o?.encoding ?? null;
}

/** @param {Row} row */
function stats(row) {
	const dir = row.dir === 1;
	const mtime = new Date(row.mtime);
	return {
		size: dir ? 4096 : (row.data?.length ?? 0),
		mode: dir ? 0o40755 : 0o100644,
		mtimeMs: row.mtime,
		ctimeMs: row.mtime,
		atimeMs: row.mtime,
		birthtimeMs: row.mtime,
		mtime,
		ctime: mtime,
		atime: mtime,
		birthtime: mtime,
		isFile: () => !dir,
		isDirectory: () => dir,
		isSymbolicLink: () => false
	};
}

/**
 * @param {() => any} getDb a database with better-sqlite3's shape, asked for on first use
 * @param {{ now?: () => number }} [options]
 */
export function createFs(getDb, { now = Date.now } = {}) {
	/** @type {any} */
	let db = null;
	/** @type {Record<string, any>} */
	let q = {};

	function store() {
		if (db) return q;
		db = getDb();
		db.exec(
			'CREATE TABLE IF NOT EXISTS files (path TEXT PRIMARY KEY, dir INTEGER NOT NULL, data BLOB, mtime REAL NOT NULL)'
		);
		q = {
			get: db.prepare('SELECT path, dir, data, mtime FROM files WHERE path = ?'),
			put: db.prepare('INSERT OR REPLACE INTO files (path, dir, data, mtime) VALUES (?, ?, ?, ?)'),
			del: db.prepare('DELETE FROM files WHERE path = ?'),
			// Everything under a directory: "p/" up to "p0" ('0' is the code after '/').
			under: db.prepare(
				'SELECT path, dir, data, mtime FROM files WHERE path >= ? AND path < ? ORDER BY path'
			),
			delUnder: db.prepare('DELETE FROM files WHERE path >= ? AND path < ?')
		};
		return q;
	}

	/** @param {string} p @returns {Row | null} */
	function entry(p) {
		if (p === '/') return { path: '/', dir: 1, data: null, mtime: 0 };
		return store().get.get(p) ?? null;
	}

	/** The range of paths under a directory. @param {string} p */
	const range = (p) => (p === '/' ? ['/', '0'] : [`${p}/`, `${p}0`]);

	/** @param {string} p @returns {Row[]} */
	const under = (p) => store().under.all(...range(p));

	/** @param {string} p @param {string} syscall */
	function parentDir(p, syscall) {
		const parent = entry(path.dirname(p));
		if (!parent) throw fsError('ENOENT', syscall, p);
		if (parent.dir !== 1) throw fsError('ENOTDIR', syscall, p);
	}

	/** @param {string} p @param {number} dir @param {Uint8Array | null} data */
	const put = (p, dir, data) => store().put.run(p, dir, data, now());

	const fs = {
		/** @param {unknown} p */
		existsSync(p) {
			try {
				return entry(norm(p)) !== null;
			} catch {
				return false;
			}
		},

		/** @param {unknown} p @param {{ recursive?: boolean } | number} [opts] */
		mkdirSync(p, opts) {
			const target = norm(p);
			const recursive = typeof opts === 'object' && opts?.recursive === true;
			if (!recursive) {
				if (entry(target)) throw fsError('EEXIST', 'mkdir', target);
				parentDir(target, 'mkdir');
				put(target, 1, null);
				return undefined;
			}
			/** @type {string | undefined} */
			let first;
			let at = '';
			for (const part of target.split('/').filter(Boolean)) {
				at += `/${part}`;
				const e = entry(at);
				if (e && e.dir !== 1) throw fsError('ENOTDIR', 'mkdir', target);
				if (!e) {
					put(at, 1, null);
					first ??= at;
				}
			}
			return first;
		},

		/** @param {unknown} p @param {unknown} data @param {unknown} [opts] */
		writeFileSync(p, data, opts) {
			const target = norm(p);
			const flag =
				typeof opts === 'object' && opts ? /** @type {{ flag?: string }} */ (opts).flag : undefined;
			if (flag?.startsWith('a')) return fs.appendFileSync(p, data, opts);
			const e = entry(target);
			if (e?.dir === 1) throw fsError('EISDIR', 'open', target);
			parentDir(target, 'open');
			put(target, 0, toBytes(data, encodingOf(opts)));
		},

		/** @param {unknown} p @param {unknown} data @param {unknown} [opts] */
		appendFileSync(p, data, opts) {
			const target = norm(p);
			const e = entry(target);
			if (e?.dir === 1) throw fsError('EISDIR', 'open', target);
			if (!e) parentDir(target, 'open');
			const before = e?.data ?? new Uint8Array(0);
			const more = toBytes(data, encodingOf(opts));
			const both = new Uint8Array(before.length + more.length);
			both.set(before);
			both.set(more, before.length);
			put(target, 0, both);
		},

		/** @param {unknown} p @param {unknown} [opts] */
		readFileSync(p, opts) {
			const target = norm(p);
			const e = entry(target);
			if (!e) throw fsError('ENOENT', 'open', target);
			if (e.dir === 1) throw fsError('EISDIR', 'read', target);
			const buf = Buffer.from(e.data ?? new Uint8Array(0));
			const enc = encodingOf(opts);
			return enc ? buf.toString(/** @type {BufferEncoding} */ (enc)) : buf;
		},

		/** @param {unknown} from @param {unknown} to */
		renameSync(from, to) {
			const a = norm(from);
			const b = norm(to);
			const src = entry(a);
			if (!src) throw fsError('ENOENT', 'rename', a, b);
			if (a === b) return;
			const parent = entry(path.dirname(b));
			if (!parent) throw fsError('ENOENT', 'rename', a, b);
			if (parent.dir !== 1) throw fsError('ENOTDIR', 'rename', a, b);
			const dest = entry(b);
			store();
			db.transaction(() => {
				if (src.dir !== 1) {
					if (dest?.dir === 1) throw fsError('EISDIR', 'rename', a, b);
					q.del.run(a);
					q.put.run(b, 0, src.data, src.mtime);
					return;
				}
				if (dest && dest.dir !== 1) throw fsError('ENOTDIR', 'rename', a, b);
				if (dest && under(b).length > 0) throw fsError('ENOTEMPTY', 'rename', a, b);
				if (b.startsWith(`${a}/`))
					throw Object.assign(new Error(`EINVAL: invalid argument, rename '${a}' -> '${b}'`), {
						code: 'EINVAL',
						errno: -22,
						syscall: 'rename',
						path: a,
						dest: b
					});
				const moved = under(a);
				q.delUnder.run(...range(a));
				q.del.run(a);
				if (dest) q.del.run(b);
				q.put.run(b, 1, null, src.mtime);
				for (const r of moved) q.put.run(b + r.path.slice(a.length), r.dir, r.data, r.mtime);
			})();
		},

		/** @param {unknown} p @param {{ recursive?: boolean, force?: boolean }} [opts] */
		rmSync(p, opts = {}) {
			const target = norm(p);
			const e = entry(target);
			if (!e) {
				if (opts.force) return;
				throw fsError('ENOENT', 'lstat', target);
			}
			if (e.dir === 1) {
				if (!opts.recursive)
					throw Object.assign(
						new Error(`Path is a directory: rm returned EISDIR (is a directory) ${target}`),
						{
							code: 'ERR_FS_EISDIR',
							errno: 21,
							syscall: 'rm',
							path: target
						}
					);
				store();
				db.transaction(() => {
					q.delUnder.run(...range(target));
					if (target !== '/') q.del.run(target);
				})();
				return;
			}
			store().del.run(target);
		},

		/** @param {unknown} p */
		rmdirSync(p) {
			const target = norm(p);
			const e = entry(target);
			if (!e) throw fsError('ENOENT', 'rmdir', target);
			if (e.dir !== 1) throw fsError('ENOTDIR', 'rmdir', target);
			if (under(target).length > 0) throw fsError('ENOTEMPTY', 'rmdir', target);
			store().del.run(target);
		},

		/** @param {unknown} p */
		unlinkSync(p) {
			const target = norm(p);
			const e = entry(target);
			if (!e) throw fsError('ENOENT', 'unlink', target);
			if (e.dir === 1) throw fsError('EISDIR', 'unlink', target);
			store().del.run(target);
		},

		/** @param {unknown} p @param {{ withFileTypes?: boolean } | string} [opts] */
		readdirSync(p, opts) {
			const target = norm(p);
			const e = entry(target);
			if (!e) throw fsError('ENOENT', 'scandir', target);
			if (e.dir !== 1) throw fsError('ENOTDIR', 'scandir', target);
			const children = under(target).filter((r) => path.dirname(r.path) === target);
			if (typeof opts === 'object' && opts?.withFileTypes)
				return children.map((r) => ({
					name: path.basename(r.path),
					parentPath: target,
					path: target,
					isFile: () => r.dir !== 1,
					isDirectory: () => r.dir === 1,
					isSymbolicLink: () => false
				}));
			return children.map((r) => path.basename(r.path));
		},

		/** @param {unknown} p @param {{ throwIfNoEntry?: boolean }} [opts] */
		statSync(p, opts) {
			const target = norm(p);
			const e = entry(target);
			if (!e) {
				if (opts?.throwIfNoEntry === false) return undefined;
				throw fsError('ENOENT', 'stat', target);
			}
			return stats(e);
		},

		/** @param {unknown} from @param {unknown} to */
		copyFileSync(from, to) {
			const a = norm(from);
			const b = norm(to);
			const src = entry(a);
			if (!src) throw fsError('ENOENT', 'copyfile', a, b);
			if (src.dir === 1) throw fsError('EISDIR', 'copyfile', a, b);
			if (entry(b)?.dir === 1) throw fsError('EISDIR', 'copyfile', a, b);
			parentDir(b, 'copyfile');
			put(b, 0, src.data);
		},

		/**
		 * The space left. A browser says how much a site may store only
		 * asynchronously (navigator.storage.estimate), and its quota is large
		 * (Chrome: usage plus 10 GiB), so a check for room always passes here;
		 * a write past the quota fails at the write.
		 */
		statfsSync() {
			const blocks = 2 ** 31;
			return { type: 0, bsize: 4096, blocks, bfree: blocks, bavail: blocks, files: 0, ffree: 0 };
		}
	};

	/** @param {unknown} from @param {unknown} to @param {{ recursive?: boolean }} [opts] */
	function cpSync(from, to, opts = {}) {
		const a = norm(from);
		const b = norm(to);
		const src = entry(a);
		if (!src) throw fsError('ENOENT', 'lstat', a);
		if (src.dir !== 1) return fs.copyFileSync(a, b);
		if (!opts.recursive)
			throw Object.assign(new Error(`Recursive option is required to copy a directory: ${a}`), {
				code: 'ERR_FS_EISDIR'
			});
		fs.mkdirSync(b, { recursive: true });
		for (const r of under(a)) {
			const there = b + r.path.slice(a.length);
			if (r.dir === 1) fs.mkdirSync(there, { recursive: true });
			else put(there, 0, r.data);
		}
	}

	/** @template {(...args: any[]) => any} F @param {F} fn @returns {(...args: Parameters<F>) => Promise<ReturnType<F>>} */
	const later =
		(fn) =>
		async (...args) =>
			fn(...args);

	const promises = {
		stat: later(fs.statSync),
		lstat: later(fs.statSync),
		readFile: later(fs.readFileSync),
		readdir: later(fs.readdirSync),
		mkdir: later(fs.mkdirSync),
		writeFile: later(fs.writeFileSync),
		appendFile: later(fs.appendFileSync),
		rm: later(fs.rmSync),
		rmdir: later(fs.rmdirSync),
		rename: later(fs.renameSync),
		unlink: later(fs.unlinkSync),
		copyFile: later(fs.copyFileSync),
		cp: later(cpSync),
		/** @param {unknown} p */
		access: async (p) => {
			if (!fs.existsSync(p)) throw fsError('ENOENT', 'access', norm(p));
		}
	};

	return { ...fs, lstatSync: fs.statSync, cpSync, promises };
}

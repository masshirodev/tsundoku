// better-sqlite3's API, the part tsundoku uses, over SQLite's own WebAssembly
// build, for the web edition's server worker (doc/WEB-EDITION.md). The web
// build aliases `better-sqlite3` to this file, so src/lib/server/db.ts and
// every query run unchanged.
//
// It is synchronous, like better-sqlite3, because the opfs-sahpool VFS is: it
// works only in a dedicated Worker, holds its files open, and allows one
// connection per pool at a time (one tab).
import sqlite3InitModule from '@sqlite.org/sqlite-wasm';

// SQLite's WebAssembly module and its OPFS pool. Typed as any on purpose:
// this file is the boundary where better-sqlite3's shape is made from them,
// and every value crossing it is checked by the spec against better-sqlite3.
/** @type {any} */
let sqlite3;
/** @type {any} */
let pool;

/** Loads SQLite's WebAssembly build. Enough for a ':memory:' database, which
 * is how the specs run this file in Node, where there is no OPFS. */
export async function load() {
	sqlite3 ??= await sqlite3InitModule();
	return sqlite3;
}

/** Loads SQLite and opens the OPFS pool. Must finish before any file Database. */
export async function ready({ directory = '/tsundoku' } = {}) {
	if (pool) return pool;
	await load();
	pool = await sqlite3.installOpfsSAHPoolVfs({ name: 'tsundoku', directory });
	return pool;
}

class SqliteError extends Error {
	/** @param {string} message @param {string | undefined} code */
	constructor(message, code) {
		super(message);
		this.name = 'SqliteError';
		this.code = code;
	}
}

/** @param {any} e */
function wrapError(e) {
	if (e instanceof SqliteError) return e;
	const code = e?.resultCode != null ? sqlite3.capi.sqlite3_js_rc_str(e.resultCode) : undefined;
	return new SqliteError(e?.message ?? String(e), code);
}

/**
 * better-sqlite3 names a parameter without its prefix (a dollar, colon or at sign).
 * @param {any} stmt
 * @param {unknown[]} args
 */
function bindArgs(stmt, args) {
	if (args.length === 0) return;
	if (
		args.length === 1 &&
		args[0] &&
		typeof args[0] === 'object' &&
		!Array.isArray(args[0]) &&
		!ArrayBuffer.isView(args[0])
	) {
		const named = /** @type {Record<string, unknown>} */ (args[0]);
		const n = sqlite3.capi.sqlite3_bind_parameter_count(stmt.pointer);
		for (let i = 1; i <= n; i++) {
			const full = sqlite3.capi.sqlite3_bind_parameter_name(stmt.pointer, i);
			if (!full) continue;
			const key = full.slice(1);
			if (!(key in named)) throw new RangeError(`Missing named parameter "${key}"`);
			stmt.bind(i, toSql(named[key]));
		}
		return;
	}
	const flat = args.flat();
	flat.forEach((/** @type {unknown} */ v, /** @type {number} */ i) => stmt.bind(i + 1, toSql(v)));
}

/** @param {unknown} v */
function toSql(v) {
	if (typeof v === 'boolean')
		throw new TypeError('SQLite3 can only bind numbers, strings, bigints, buffers, and null');
	return v === undefined ? null : v;
}

class Statement {
	/** @type {Database} */
	#db;
	/** @type {string} */
	#sql;
	#pluck = false;
	#raw = false;

	/** @param {Database} db @param {string} sql */
	constructor(db, sql) {
		this.#db = db;
		this.#sql = sql;
		this.source = sql;
		// Prepared now, as better-sqlite3 does: a bad statement throws here.
		const s = db.cached(sql);
		this.reader = s.columnCount > 0;
	}

	pluck(on = true) {
		this.#pluck = on;
		if (on) this.#raw = false;
		return this;
	}

	raw(on = true) {
		this.#raw = on;
		if (on) this.#pluck = false;
		return this;
	}

	/** @param {any} s */
	#row(s) {
		if (this.#pluck) return s.get(0);
		if (this.#raw) return s.get([]);
		return s.get({});
	}

	/**
	 * @template T
	 * @param {unknown[]} args
	 * @param {(s: any) => T} fn
	 * @returns {T}
	 */
	#with(args, fn) {
		const s = this.#db.cached(this.#sql);
		try {
			bindArgs(s, args);
			return fn(s);
		} catch (e) {
			throw wrapError(e);
		} finally {
			s.reset(true);
		}
	}

	/** @param {...unknown} args */
	get(...args) {
		return this.#with(args, (s) => (s.step() ? this.#row(s) : undefined));
	}

	/** @param {...unknown} args */
	all(...args) {
		return this.#with(args, (s) => {
			/** @type {unknown[]} */
			const rows = [];
			while (s.step()) rows.push(this.#row(s));
			return rows;
		});
	}

	/** @param {...unknown} args */
	run(...args) {
		return this.#with(args, (s) => {
			while (s.step());
			const ptr = this.#db.handle.pointer;
			return {
				changes: sqlite3.capi.sqlite3_changes(ptr),
				lastInsertRowid: Number(sqlite3.capi.sqlite3_last_insert_rowid(ptr))
			};
		});
	}

	/** @param {...unknown} args */
	*iterate(...args) {
		yield* this.all(...args);
	}
}

export default class Database {
	/** @type {Map<string, any>} */
	#stmts = new Map();
	#depth = 0;
	static SqliteError = SqliteError;

	/** @param {string} [path] */
	constructor(path = ':memory:') {
		this.name = path;
		this.memory = path === ':memory:';
		if (!sqlite3 || (!this.memory && !pool))
			throw new Error('web sqlite: ready() has not finished');
		this.handle = this.memory
			? new sqlite3.oo1.DB(':memory:')
			: new pool.OpfsSAHPoolDb(path.startsWith('/') ? path : `/${path}`);
		this.open = true;
		this.readonly = false;
	}

	/** One compiled statement per SQL text: tsundoku prepares freely, and a
	 * WebAssembly statement is never collected, so they are reused. */
	/** @param {string} sql */
	cached(sql) {
		let s = this.#stmts.get(sql);
		if (!s) {
			try {
				s = this.handle.prepare(sql);
			} catch (e) {
				throw wrapError(e);
			}
			this.#stmts.set(sql, s);
		}
		return s;
	}

	/** @param {string} sql */
	prepare(sql) {
		return new Statement(this, sql);
	}

	/** @param {string} sql */
	exec(sql) {
		try {
			this.handle.exec(sql);
		} catch (e) {
			throw wrapError(e);
		}
		return this;
	}

	/** @param {string} source @param {{ simple?: boolean }} [options] */
	pragma(source, { simple = false } = {}) {
		const rows = this.prepare(`PRAGMA ${source}`).all();
		if (!simple) return rows;
		const first = rows[0];
		return first ? Object.values(/** @type {object} */ (first))[0] : undefined;
	}

	get inTransaction() {
		return sqlite3.capi.sqlite3_get_autocommit(this.handle.pointer) === 0;
	}

	/**
	 * better-sqlite3's transaction(): BEGIN outside one, a savepoint inside.
	 * @template {(...args: any[]) => any} F
	 * @param {F} fn
	 */
	transaction(fn) {
		/** @param {string} begin */
		const run =
			(begin) =>
			/** @param {Parameters<F>} args @returns {ReturnType<F>} */
			(...args) => {
				const nested = this.inTransaction;
				const name = `tsundoku_sp_${this.#depth}`;
				this.exec(nested ? `SAVEPOINT ${name}` : begin);
				this.#depth++;
				try {
					const out = fn(...args);
					this.exec(nested ? `RELEASE ${name}` : 'COMMIT');
					return out;
				} catch (e) {
					if (nested) this.exec(`ROLLBACK TO ${name}; RELEASE ${name}`);
					else if (this.inTransaction) this.exec('ROLLBACK');
					throw e;
				} finally {
					this.#depth--;
				}
			};
		return Object.assign(run('BEGIN'), {
			deferred: run('BEGIN DEFERRED'),
			immediate: run('BEGIN IMMEDIATE'),
			exclusive: run('BEGIN EXCLUSIVE')
		});
	}

	unsafeMode() {
		return this;
	}

	close() {
		for (const s of this.#stmts.values()) s.finalize();
		this.#stmts.clear();
		this.handle.close();
		this.open = false;
		return this;
	}
}

export { SqliteError };

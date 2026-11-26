// Counting SQLite commits around a piece of server code (c1148).
//
// In the web edition every commit is a write to the tab's OPFS storage, about
// 30 ms each (doc/WEB-EDITION.md, "Measuring"), so a loop that writes a row
// per commit costs seconds there while costing nothing on the self-hosted
// server. better-sqlite3 has no commit hook, so this watches statements run:
// a write run outside a transaction is a commit of its own, and a BEGIN is
// one more. `db.exec` is not seen; the server code writes through prepared
// statements.
import Database from 'better-sqlite3';

type Stmt = { reader: boolean; source: string; database: { inTransaction: boolean } };

const CONTROL = /^\s*(BEGIN|COMMIT|END|ROLLBACK|SAVEPOINT|RELEASE)\b/i;

/** How many commits `fn` made, awaited. Not reentrant: one count at a time. */
export async function countCommits(fn: () => unknown): Promise<number> {
	const proto = Object.getPrototypeOf(new Database(':memory:').prepare('SELECT 1')) as {
		run: (this: Stmt, ...args: unknown[]) => unknown;
	};
	const real = proto.run;
	let commits = 0;
	proto.run = function (this: Stmt, ...args: unknown[]) {
		if (/^\s*BEGIN\b/i.test(this.source)) commits++;
		else if (!this.reader && !this.database.inTransaction && !CONTROL.test(this.source)) commits++;
		return real.apply(this, args);
	};
	try {
		await fn();
	} finally {
		proto.run = real;
	}
	return commits;
}

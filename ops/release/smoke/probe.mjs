// tsundoku's release smoke test, the part that runs on the target machine
// with the bundle's own Node (doc/RELEASE.md, "Smoke test"). The launcher is
// already running; this signs in, checks the screens and the engine, scans
// the synthesised Mihon library the runner put in the data folder, and reads
// a page. Exits non-zero on the first thing that's wrong.
//
//   node probe.mjs <bundle folder>
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { basename, join } from 'node:path';

const bundle = process.argv[2];
const home =
	process.env.TSUNDOKU_HOME ??
	(process.platform === 'win32'
		? join(process.env.LOCALAPPDATA, 'tsundoku')
		: join(process.env.HOME, '.local', 'share', 'tsundoku'));
const env = Object.fromEntries(
	readFileSync(join(home, '.env'), 'utf8')
		.trim()
		.split(/\r?\n/)
		.map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1)])
);
const base = 'http://localhost:42143';
let failed = 0;
const check = (what, ok, detail = '') => {
	console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}${detail ? `: ${detail}` : ''}`);
	if (!ok) failed++;
};

// 127.0.0.1 is sent to localhost, whose origin every save is checked against.
let r = await fetch('http://127.0.0.1:42143/', { redirect: 'manual' });
check(
	'127.0.0.1 is sent to localhost',
	r.status === 308,
	`${r.status} ${r.headers.get('location')}`
);
r = await fetch(`${base}/`, { redirect: 'manual' });
check(
	'signed out, / asks to sign in',
	r.status === 303,
	`${r.status} ${r.headers.get('location')}`
);
r = await fetch(`${base}/login`, {
	method: 'POST',
	redirect: 'manual',
	headers: { origin: base, 'content-type': 'application/x-www-form-urlencoded' },
	body: `token=${env.TSUNDOKU_TOKEN}`
});
const cookie = (r.headers.get('set-cookie') ?? '').split(';')[0];
check('the first-run token signs in', cookie.startsWith('tsundoku_session='));
for (const path of ['/', '/settings', '/browse', '/history', '/search']) {
	r = await fetch(base + path, { headers: { cookie }, redirect: 'manual' });
	check(`GET ${path}`, r.status === 200, String(r.status));
}

r = await fetch('http://127.0.0.1:4590/capabilities', {
	headers: { authorization: `Bearer ${env.ENGINE_TOKEN}` }
});
check('the engine answers with its token', r.status === 200, String(r.status));
r = await fetch('http://127.0.0.1:4590/capabilities');
check('and refuses without it', r.status === 401, String(r.status));

r = await fetch(`${base}/api/scan`, { method: 'POST', headers: { cookie, origin: base } });
check('a scan starts', r.status === 202, `${r.status} ${await r.text()}`);
const Database = createRequire(join(bundle, 'app', 'package.json'))('better-sqlite3');
const db = new Database(join(home, 'tsundoku.sqlite'), { readonly: true });
let job;
for (let i = 0; i < 60 && !job?.finished_at; i++) {
	job = db.prepare(`SELECT * FROM scan_jobs ORDER BY id DESC LIMIT 1`).get();
	if (!job?.finished_at) await new Promise((ok) => setTimeout(ok, 1000));
}
check('the scan finishes', !!job?.finished_at);
// The fixture's known shape (tests/helpers/mihon-fixture.ts, tests/import-db.spec.ts):
// seven series, one deliberately broken file.
const series = db.prepare(`SELECT title, path FROM series ORDER BY id`).all();
check('seven series imported', series.length === 7, series.map((s) => s.title).join(', '));
check(
	'one file refused (the fixture’s broken one)',
	job?.failed_files === 1,
	String(job?.failed_files)
);
// Visible as the app decides it (src/lib/server/visibility.ts): the local books
// land in their own hidden root, and hidden means hidden, pages included.
const entries = db
	.prepare(
		`SELECT e.id, e.label, s.title, (s.hidden = 0 AND (r.hidden = 0 OR s.public = 1)) AS visible
		FROM entries e JOIN series s ON s.id = e.series_id LEFT JOIN roots r ON r.id = s.root_id
		WHERE e.available = 1 AND e.file != '' ORDER BY e.id`
	)
	.all();
check('six chapters on disk', entries.length === 6, String(entries.length));
for (const e of entries) {
	r = await fetch(`${base}/api/entries/${e.id}/pages`, { headers: { cookie } });
	const m = r.ok ? await r.json() : null;
	if (!e.visible) {
		check(`${e.title}, hidden: its pages stay hidden`, r.status === 404, String(r.status));
		continue;
	}
	const p = await fetch(
		`${base}/api/entries/${e.id}/pages/0?v=${encodeURIComponent(m?.version ?? '')}`,
		{ headers: { cookie } }
	);
	const type = p.headers.get('content-type') ?? '';
	const bytes = (await p.arrayBuffer()).byteLength;
	check(
		`${e.title} ${e.label}: page 1 reads`,
		p.ok && type.startsWith('image/') && bytes > 0,
		`${type}, ${bytes} B`
	);
}
// Paths, the way the library compares them (card c183): written with '/' on
// every platform, so "is this file in the library?" and "the folder two books
// share" hold on Windows too. A delete moves files only from inside the
// library, and grouping takes the folder the books share as the series' path.
const backslashed = db
	.prepare(`SELECT count(*) AS n FROM series WHERE instr(path, char(92)) > 0`)
	.get().n;
check('no series path is written with a backslash', backslashed === 0, String(backslashed));
const action = (path, form) =>
	fetch(base + path, {
		method: 'POST',
		headers: {
			cookie,
			origin: base,
			'x-sveltekit-action': 'true',
			'content-type': 'application/x-www-form-urlencoded'
		},
		body: new URLSearchParams(form)
	});
const fileOf = (s, e) => join(s.path, e.file);
const gone = db.prepare(`SELECT id, path FROM series WHERE title = 'Not In The Backup'`).get();
const goneFiles = db
	.prepare(`SELECT file FROM entries WHERE series_id = ? AND file != ''`)
	.all(gone.id)
	.map((e) => fileOf(gone, e));
r = await action(`/series/${gone.id}?/delete`, {});
const stillThere = goneFiles.filter((f) => existsSync(f));
const trashed = existsSync(join(home, 'trash'))
	? readdirSync(join(home, 'trash'), { recursive: true }).map(String)
	: [];
check(
	'DELETE moves the series’ files into the trash',
	r.ok &&
		stillThere.length === 0 &&
		goneFiles.every((f) => trashed.some((t) => t.endsWith(basename(f)))),
	`${r.status}; left in the library: ${stillThere.length}; in the trash: ${trashed.filter((t) => /\.cbz$/.test(t)).length}`
);
check('and the series is gone', !db.prepare(`SELECT 1 FROM series WHERE id = ?`).get(gone.id));
const books = db
	.prepare(
		`SELECT id, path FROM series WHERE title IN ('Local Book', 'No Artist Here') ORDER BY id`
	)
	.all();
r = await action('/?/group', [
	...books.map((b) => ['series', String(b.id)]),
	['name', 'Smoke Group']
]);
const group = db.prepare(`SELECT id, path FROM series WHERE title = 'Smoke Group'`).get();
const grouped = group
	? db.prepare(`SELECT file FROM entries WHERE series_id = ? AND file != ''`).all(group.id)
	: [];
check(
	'GROUP makes one series of two books, its path the folder they share',
	!!group && grouped.length === 2 && grouped.every((e) => existsSync(fileOf(group, e))),
	group
		? `${group.path}; ${grouped.map((e) => e.file).join(', ')}`
		: `${r.status} ${await r.text()}`
);

r = await fetch(`${base}/`, { headers: { cookie } });
check('the library names its series', (await r.text()).includes(series[0]?.title ?? '\0'));

console.log(failed ? `\n${failed} failed` : '\nall passed');
process.exit(failed ? 1 : 0);

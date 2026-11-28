// tsundoku's release smoke test, the part that runs on the target machine
// with the bundle's own Node (doc/RELEASE.md, "Smoke test"). The launcher is
// already running; this signs in, checks the screens and the engine, scans
// the synthesised Mihon library the runner put in the data folder, and reads
// a page. Exits non-zero on the first thing that's wrong.
//
//   node probe.mjs <bundle folder>
import { fork } from 'node:child_process';
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
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
// A first open is SET UP: a password, chosen here (doc/SIGN-IN.md).
r = await fetch(`${base}/`, { redirect: 'manual' });
check(
	'a first open asks for a password',
	r.status === 303 && r.headers.get('location') === '/setup',
	`${r.status} ${r.headers.get('location')}`
);
const PASSWORD = 'smoke-password';
// As a browser without script posts a form: SvelteKit answers anything that
// accepts JSON (fetch's */* does) with a JSON result and a 200 instead.
const form = {
	origin: base,
	accept: 'text/html',
	'content-type': 'application/x-www-form-urlencoded'
};
r = await fetch(`${base}/setup?/password`, {
	method: 'POST',
	redirect: 'manual',
	headers: form,
	body: `password=${PASSWORD}&again=${PASSWORD}`
});
check(
	'SET UP takes one, and keeps it hashed',
	r.status === 303 &&
		existsSync(join(home, 'login.json')) &&
		!readFileSync(join(home, 'login.json'), 'utf8').includes(PASSWORD),
	String(r.status)
);
check('no token is made', !('TSUNDOKU_TOKEN' in env));
r = await fetch(`${base}/login`, {
	method: 'POST',
	redirect: 'manual',
	headers: form,
	body: 'token=not-the-password'
});
check('a wrong password is refused', r.status === 401, String(r.status));
r = await fetch(`${base}/login`, {
	method: 'POST',
	redirect: 'manual',
	headers: form,
	body: `token=${PASSWORD}`
});
const cookie = (r.headers.get('set-cookie') ?? '').split(';')[0];
check('the password signs in', cookie.startsWith('tsundoku_session='), String(r.status));
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
// The fixtures' known shape, where smoke.sh puts them (tests/helpers/
// mihon-fixture.ts as tsundoku's own device, hentoid-fixture.ts at the root;
// tests/devices-import-db.spec.ts): five series from Mihon's backup and
// downloads, four of Hentoid's books, one deliberately broken file.
const series = db.prepare(`SELECT title, path FROM series ORDER BY id`).all();
check('nine series imported', series.length === 9, series.map((s) => s.title).join(', '));
check(
	'one file refused (the fixture’s broken one)',
	job?.failed_files === 1,
	String(job?.failed_files)
);
// Visible as the app decides it (src/lib/server/visibility.ts): Hentoid's books
// land in their own hidden root, and hidden means hidden, pages included.
const entries = db
	.prepare(
		`SELECT e.id, e.label, s.title, (s.hidden = 0 AND (r.hidden = 0 OR s.public = 1)) AS visible
		FROM entries e JOIN series s ON s.id = e.series_id LEFT JOIN roots r ON r.id = s.root_id
		WHERE e.available = 1 AND e.file != '' ORDER BY e.id`
	)
	.all();
check('ten chapters on disk', entries.length === 10, String(entries.length));
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
// Paths, the way the library compares them: written with '/' on
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
		`SELECT id, path FROM series WHERE title IN ('Summer Days', 'Summer Days 2') ORDER BY id`
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
// A visible one: the first series by id is a hidden Hentoid book.
check(
	'the library names its series',
	(await r.text()).includes(entries.find((e) => e.visible)?.title ?? '\0')
);

// The novels plugin host: a file the server forks by path, and
// the libraries it lends to plugins. 2026.10.31.3 shipped without them all,
// and every novel source said THE PLUGIN HOST STOPPED. Started as host.ts
// starts it, under the permission model with an empty environment, it loads a
// plugin that requires each library; fetchProto loads protobufjs before its
// address (loopback, which the host refuses) is ever tried. No network.
{
	const hostFile = join(bundle, 'app', 'src', 'lib', 'server', 'novels', 'plugin-host.cjs');
	const store = mkdtempSync(join(tmpdir(), 'tsundoku-smoke-plugins-'));
	const plugin = join(store, 'smoke.js');
	writeFileSync(
		plugin,
		`var cheerio = require('cheerio');
var dayjs = require('dayjs');
var htmlparser2 = require('htmlparser2');
var aes = require('@libs/aes');
var fetch = require('@libs/fetch');
exports.default = {
	id: 'smoke', name: 'Smoke', site: 'https://example.invalid/', version: '1.0.0',
	parseChapter: async function () {
		var parts = [
			cheerio.load('<p>x</p>')('p').text(),
			dayjs('2026-11-01').format('YYYY'),
			typeof htmlparser2.parseDocument,
			typeof aes.gcm
		];
		try { await fetch.fetchProto({ proto: 'syntax = "proto3"; message A { string a = 1; }', requestType: 'A', responseType: 'A', requestData: {} }, 'http://127.0.0.1:9/'); }
		catch (e) { parts.push(String(e && e.message)); }
		return parts.join('|');
	}
};
`
	);
	const answers = await new Promise((done) => {
		const got = {};
		const child = fork(hostFile, [], {
			execArgv: [
				'--permission',
				`--allow-fs-read=${hostFile}`,
				// The address guard's files, as host.ts's guardFiles() allows them:
				// net-guard.ts and the public-ip.ts it imports (c1140). Only the
				// first was here, so 2026.11.28's host was refused its import.
				...['net-guard.ts', 'public-ip.ts'].map(
					(f) => `--allow-fs-read=${join(bundle, 'app', 'src', 'lib', 'server', f)}`
				),
				`--allow-fs-read=${join(bundle, 'app', 'node_modules')}`,
				`--allow-fs-read=${store}`
			],
			env: {},
			stdio: ['ignore', 'ignore', 'pipe', 'ipc'],
			serialization: 'json'
		});
		let stderr = '';
		child.stderr.on('data', (d) => (stderr += d));
		const timer = setTimeout(() => child.kill(), 20_000);
		child.on('message', (m) => {
			got[m.id] = m;
			if (got[1] && got[2]) child.kill();
		});
		child.on('exit', () => {
			clearTimeout(timer);
			done({ ...got, stderr });
		});
		child.send({ id: 1, op: 'info', file: plugin });
		child.send({ id: 2, op: 'call', file: plugin, method: 'parseChapter', args: ['/1'] });
	});
	rmSync(store, { recursive: true, force: true });
	check(
		'the novels plugin host starts and loads a plugin',
		answers[1]?.ok === true && answers[1].value?.id === 'smoke',
		JSON.stringify(answers[1] ?? answers.stderr.slice(0, 300))
	);
	const parts = answers[2]?.ok ? String(answers[2].value).split('|') : [];
	check(
		'and lends it cheerio, dayjs, htmlparser2, @libs/aes and protobufjs',
		parts[0] === 'x' &&
			parts[1] === '2026' &&
			parts[2] === 'function' &&
			parts[3] === 'function' &&
			parts.length === 5 &&
			!/Cannot find module/.test(parts[4]),
		JSON.stringify(answers[2] ?? answers.stderr.slice(0, 300))
	);
}

console.log(failed ? `\n${failed} failed` : '\nall passed');
process.exit(failed ? 1 : 0);

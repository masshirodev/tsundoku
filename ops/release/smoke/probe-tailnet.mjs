// tsundoku on Tailscale, the part of the smoke test that runs on the target
// with the bundle's Node (doc/RELEASE.md, "Smoke test"; card c186). The
// launcher is running with TSUNDOKU_SERVE=https; this checks it opened the
// tailnet address, and that the app signs in and saves there.
//
//   node probe-tailnet.mjs <launcher log> <a second start's log>
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const [log, again] = process.argv.slice(2);
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
let failed = 0;
const check = (what, ok, detail = '') => {
	console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}${detail ? `: ${detail}` : ''}`);
	if (!ok) failed++;
};

const serving = JSON.parse(readFileSync(join(home, 'serving.json'), 'utf8'));
const origin = serving.origin;
check('serving.json says https', serving.mode === 'https', serving.mode);
check(
	'its origin is the tailnet name on 8443',
	/^https:\/\/[a-z0-9-]+\.[a-z0-9-]+\.ts\.net:8443$/.test(origin),
	origin
);
check('the app itself listens on loopback', serving.listen === 'http://127.0.0.1:42143');
const printed = readFileSync(log, 'utf8');
check('the launcher opens it, not localhost', printed.includes(`Open ${origin} `));
check('and says the phone opens the same', /phone or tablet/.test(printed));
check(
	'a second start opens it too',
	readFileSync(again, 'utf8').includes(`Already running: opening ${origin}`)
);

// Through tailscale serve, with its certificate: what the phone does. The
// first request can wait on Tailscale fetching that certificate, which once
// outlasted fetch's 10 s connect timeout on Zen (2026-10-30); a minute, then.
const started = Date.now();
let r;
while (!r) {
	try {
		r = await fetch(`${origin}/`, { redirect: 'manual' });
	} catch (e) {
		if (Date.now() - started > 60_000) throw e;
		await new Promise((ok) => setTimeout(ok, 2000));
	}
}
check('the tailnet address answers', true, `after ${Math.round((Date.now() - started) / 1000)} s`);
check('signed out, the tailnet address asks to sign in', r.status === 303, String(r.status));
r = await fetch(`${origin}/login`, {
	method: 'POST',
	redirect: 'manual',
	headers: { origin, 'content-type': 'application/x-www-form-urlencoded' },
	body: `token=${env.TSUNDOKU_TOKEN}`
});
const cookie = (r.headers.get('set-cookie') ?? '').split(';')[0];
check(
	'the token signs in there (a POST, so the origin check passes)',
	cookie.startsWith('tsundoku_session='),
	String(r.status)
);
for (const path of ['/', '/settings', '/browse']) {
	r = await fetch(origin + path, { headers: { cookie }, redirect: 'manual' });
	check(`GET ${path} there`, r.status === 200, String(r.status));
}
// What 2026.10.30 opened: a page on localhost, whose saves the origin check refuses.
r = await fetch('http://127.0.0.1:42143/login', {
	method: 'POST',
	redirect: 'manual',
	headers: {
		origin: 'http://localhost:42143',
		'content-type': 'application/x-www-form-urlencoded'
	},
	body: `token=${env.TSUNDOKU_TOKEN}`
});
check(
	'localhost would have been refused (why it opens the tailnet address)',
	r.status === 403,
	String(r.status)
);

console.log(failed ? `\n${failed} failed` : '\nall passed');
process.exit(failed ? 1 : 0);

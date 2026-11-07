/**
 * Publish a built, smoke-tested release to dl.tsundoku.masshiro.pro
 * (doc/UPDATES.md; card c182), where friends download it and every installed
 * copy looks for it.
 *
 *   yarn run release:publish 2026.11.02             # upload, then announce
 *   yarn run release:publish 2026.11.02 --dry-run   # sign and check, upload nothing
 *
 * It refuses a version `ops/release/smoke.sh` didn't pass whole, one rebuilt
 * since it did (ops/release/smoked.ts), one without notes (ops/release/notes/<version>.txt, what a friend reads in SETTINGS), and
 * one already on the host: a version folder is written once. The files go up
 * under unversioned names into the version's folder, then `latest` points at
 * it, then latest.json is written: until that last step nothing announces a
 * half-uploaded release. latest.json is signed with the release key, which
 * never leaves this workstation (~/.config/tsundoku/release-signing.pem, or
 * TSUNDOKU_SIGNING_KEY); every build checks it against the public half in
 * src/lib/server/update-manifest.ts.
 */
import { execFileSync } from 'node:child_process';
import { createHash, createPrivateKey, sign } from 'node:crypto';
import {
	createReadStream,
	existsSync,
	linkSync,
	mkdirSync,
	readFileSync,
	rmSync,
	statSync,
	writeFileSync
} from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
	VERSION_RE,
	openManifest,
	type Manifest,
	type ReleaseFile
} from '../../src/lib/server/update-manifest.ts';
import { smokedProblem } from './smoked.ts';

const repo = fileURLToPath(new URL('../../', import.meta.url));
const args = process.argv.slice(2);
const version = args.find((a) => !a.startsWith('--'));
const dry = args.includes('--dry-run');
const HOST = process.env.TSUNDOKU_RELEASE_HOST ?? 'vps';
const REMOTE = process.env.TSUNDOKU_RELEASE_DIR ?? 'tsundoku-releases';
const URL_BASE = process.env.TSUNDOKU_RELEASE_URL ?? 'https://dl.tsundoku.masshiro.pro';
const KEY =
	process.env.TSUNDOKU_SIGNING_KEY ?? join(homedir(), '.config/tsundoku/release-signing.pem');

const fail = (m: string): never => {
	console.error(`publish: ${m}`);
	process.exit(1);
};
if (!version || !VERSION_RE.test(version))
	fail('usage: publish.ts <version YYYY.MM.DD[.N]> [--dry-run]');

const out = join(process.env.RELEASE_DIR ?? '/mnt/hdd2/tsundoku/release', 'out', version!);
if (!existsSync(out)) fail(`${out} doesn't exist: build it first (yarn run release ${version}).`);
const unsmoked = smokedProblem(out, version!);
if (unsmoked) fail(unsmoked);
const notesFile = join(repo, 'ops/release/notes', `${version}.txt`);
if (!existsSync(notesFile)) fail(`no notes: write ${notesFile} (what a friend reads in SETTINGS).`);
const notes = readFileSync(notesFile, 'utf8').trim();
if (!notes) fail(`${notesFile} is empty.`);
if (!existsSync(KEY)) fail(`no signing key at ${KEY}.`);

// Built name → published name. Unversioned, so latest/<name> is a lasting link.
const NAMES: [string, string][] = [
	[`tsundoku-${version}-win-x64.exe`, 'tsundoku-win-x64.exe'],
	[`tsundoku-${version}-win-x64.zip`, 'tsundoku-win-x64.zip'],
	[`tsundoku-${version}-linux-x64.tar.xz`, 'tsundoku-linux-x64.tar.xz']
];
const solver = JSON.parse(readFileSync(join(repo, 'ops/release/versions.json'), 'utf8')) as {
	flaresolverr: { version: string };
};
for (const p of ['win-x64.zip', 'linux-x64.tar.gz']) {
	const n = `flaresolverr-${solver.flaresolverr.version}-${p}`;
	NAMES.push([n, n]);
}
// The Android apps (c614): ops/release/android-apk.sh builds them beside the
// bundles. Release-signed only: a -debug APK can't update an installed app,
// whose certificate is the release keystore's, so one is refused below.
NAMES.push([`tsundoku-app-${version}.apk`, 'tsundoku-app.apk']);
NAMES.push([`tsundoku-tv-${version}.apk`, 'tsundoku-tv.apk']);
for (const debug of [`tsundoku-app-${version}-debug.apk`, `tsundoku-tv-${version}-debug.apk`])
	if (existsSync(join(out, debug)) && !existsSync(join(out, debug.replace('-debug', ''))))
		fail(
			`${debug} is debug-signed: build the APKs with the keystore (ops/release/android-apk.sh).`
		);

const sha256 = (file: string) =>
	new Promise<string>((ok, no) => {
		const h = createHash('sha256');
		createReadStream(file)
			.on('data', (c) => h.update(c))
			.on('end', () => ok(h.digest('hex')))
			.on('error', no);
	});

// The folder that goes up: hard links under the published names, same disk.
const stage = join(out, '.publish');
rmSync(stage, { recursive: true, force: true });
mkdirSync(stage);
const files: Record<string, ReleaseFile> = {};
for (const [from, to] of NAMES) {
	const src = join(out, from);
	if (!existsSync(src))
		fail(
			from.endsWith('.apk')
				? `${from} is missing from ${out}: ops/release/android-apk.sh ${version} builds it.`
				: `${from} is missing from ${out}.`
		);
	linkSync(src, join(stage, to));
	files[to] = { name: to, size: statSync(src).size, sha256: await sha256(src) };
}
writeFileSync(
	join(stage, 'SHA256SUMS'),
	Object.values(files)
		.map((f) => `${f.sha256}  ${f.name}\n`)
		.join('')
);
const readme = readFileSync(join(repo, 'ops/release/README.txt'), 'utf8').replaceAll(
	'{{VERSION}}',
	version!
);
writeFileSync(join(stage, 'README.txt'), readme);

const manifest: Manifest = {
	version: version!,
	date: new Date().toISOString().slice(0, 10),
	notes,
	files: {
		'win-x64': { installer: files['tsundoku-win-x64.exe'], zip: files['tsundoku-win-x64.zip'] },
		'linux-x64': { archive: files['tsundoku-linux-x64.tar.xz'] },
		android: { app: files['tsundoku-app.apk'], tv: files['tsundoku-tv.apk'] }
	}
};
const text = JSON.stringify(manifest);
const signature = sign(
	null,
	Buffer.from(text, 'utf8'),
	createPrivateKey(readFileSync(KEY))
).toString('base64');
const latest = JSON.stringify({ manifest: text, signature }, null, '\t') + '\n';
// Checked as every installed copy will check it: a key that isn't the one in
// the builds would publish a release nobody can install.
const opened = openManifest(latest);
if (!opened.ok)
	fail(`the signed manifest doesn't open with the public key in the builds: ${opened.reason}`);
writeFileSync(join(stage, 'latest.json'), latest);
console.log(`signed ${version}: ${Object.keys(files).length} files, notes ${notes.length} chars`);
if (dry) {
	console.log(`dry run: staged in ${stage}, nothing uploaded`);
	process.exit(0);
}

const ssh = (cmd: string) =>
	execFileSync('ssh', ['-o', 'BatchMode=yes', HOST, cmd], { encoding: 'utf8' });
if (ssh(`test -e ${REMOTE}/${version} && echo taken || echo free`).trim() === 'taken')
	fail(`${version} is already on ${HOST}:${REMOTE}: a version folder is written once.`);
const part = `${REMOTE}/.${version}.part`;
console.log(`uploading to ${HOST}:${part}`);
execFileSync(
	'rsync',
	['-a', '--partial', '--info=progress2', '--exclude=latest.json', `${stage}/`, `${HOST}:${part}/`],
	{ stdio: 'inherit' }
);
// Then the folder, the link, and the announcement, in that order.
ssh(
	`set -e; cd ${REMOTE}; mv .${version}.part ${version}; ln -sfn ${version} latest.new; mv -T latest.new latest`
);
execFileSync(
	'ssh',
	[
		'-o',
		'BatchMode=yes',
		HOST,
		`cat > ${REMOTE}/latest.json.new && mv ${REMOTE}/latest.json.new ${REMOTE}/latest.json`
	],
	{
		input: latest
	}
);

// What a friend's copy will see.
const seen = await (await fetch(`${URL_BASE}/latest.json`, { cache: 'no-store' })).text();
const back = openManifest(seen);
if (!back.ok || back.manifest.version !== version)
	fail(`${URL_BASE}/latest.json doesn't announce ${version}`);
for (const f of Object.values(files)) {
	const r = await fetch(`${URL_BASE}/${version}/${f.name}`, { method: 'HEAD' });
	if (!r.ok || Number(r.headers.get('content-length')) !== f.size)
		fail(
			`${URL_BASE}/${version}/${f.name} answers ${r.status}, ${r.headers.get('content-length')} bytes`
		);
}
rmSync(stage, { recursive: true, force: true });
console.log(`published ${version}: ${URL_BASE}/latest/tsundoku-win-x64.exe`);

// The website's download block reads latest.json at build time: rebuild it
// now, so it offers this version (doc/WEBSITE.md, "Deploy"). The release is
// already out, so a failure here only warns: the next push to the site, or
// `gh workflow run site.yml`, catches the page up.
try {
	execFileSync('gh', ['workflow', 'run', 'site.yml', '--ref', 'main'], {
		cwd: repo,
		stdio: 'inherit'
	});
	console.log('website: rebuild dispatched (gh run list --workflow site.yml)');
} catch (e) {
	console.warn(
		`website: couldn't dispatch site.yml (${(e as Error).message.split('\n')[0]}); ` +
			'run `gh workflow run site.yml` so the download block shows this version.'
	);
}

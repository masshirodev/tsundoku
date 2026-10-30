/**
 * Build tsundoku's release bundles for friends' computers (doc/RELEASE.md).
 *
 *   yarn run release 2026.10.29                      # from the tag release/2026.10.29
 *   yarn run release 2026.10.29 --platform win-x64   # one platform
 *   yarn run release 2026.10.29 --ref HEAD           # a trial from a commit, no tag needed
 *
 * The app is built from a clean checkout of the tag (a git worktree), never
 * from the working tree, so what ships is a commit. The engine is built from
 * tsundoku-engine's HEAD, which must be clean and pushed. Everything else
 * comes from ops/release/versions.json, checked against its SHA-256 and kept
 * in a cache. Out come one archive per platform, FlareSolverr's optional
 * archive beside each, and SHA256SUMS, under $RELEASE_DIR/out/<version>.
 */
import { execFileSync, type ExecFileSyncOptions } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
	chmodSync,
	copyFileSync,
	cpSync,
	createReadStream,
	existsSync,
	mkdirSync,
	readdirSync,
	readFileSync,
	rmSync,
	statSync,
	symlinkSync,
	writeFileSync
} from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

type Platform = 'win-x64' | 'linux-x64';
type Pin = { url: string; sha256: string };
type Component = { version: string; licence: string; source?: string } & Record<Platform, Pin>;
const PLATFORMS: Platform[] = ['win-x64', 'linux-x64'];

const repo = fileURLToPath(new URL('../../', import.meta.url));
const engineRepo = resolve(repo, '../tsundoku-engine');
const kotobaRepo = resolve(repo, '../kotoba');
const pins = JSON.parse(readFileSync(join(repo, 'ops/release/versions.json'), 'utf8')) as Record<
	'node' | 'jre' | 'flaresolverr' | 'ffmpeg',
	Component
>;

// ---- arguments ------------------------------------------------------------------------

const args = process.argv.slice(2);
const version = args.find((a) => !a.startsWith('--') && !isFlagValue(a));
function isFlagValue(a: string) {
	const i = args.indexOf(a);
	return i > 0 && ['--platform', '--ref'].includes(args[i - 1]);
}
const flag = (name: string) => {
	const i = args.indexOf(name);
	return i >= 0 ? args[i + 1] : undefined;
};
if (!version || !/^\d{4}\.\d{2}\.\d{2}(\.\d+)?$/.test(version)) {
	console.error(
		'usage: yarn run release <YYYY.MM.DD[.N]> [--platform win-x64|linux-x64] [--ref <commit>]'
	);
	process.exit(2);
}
const platforms = flag('--platform') ? [flag('--platform') as Platform] : PLATFORMS;
for (const p of platforms)
	if (!PLATFORMS.includes(p)) throw new Error(`no such platform: ${p} (${PLATFORMS.join(', ')})`);
const trial = flag('--ref') !== undefined;
const ref = flag('--ref') ?? `release/${version}`;

const base = process.env.RELEASE_DIR ?? '/mnt/hdd2/tsundoku/release';
const cache = join(base, 'cache');
const work = join(base, 'work', version);
const out = join(base, 'out', version);

// ---- helpers ----------------------------------------------------------------------------

const run = (cmd: string, argv: string[], opts: ExecFileSyncOptions = {}) =>
	execFileSync(cmd, argv, { stdio: 'inherit', ...opts });
const capture = (cmd: string, argv: string[], cwd = repo) =>
	execFileSync(cmd, argv, { cwd, encoding: 'utf8' }).trim();
const step = (s: string) => console.log(`\n== ${s}`);

async function sha256(file: string) {
	const h = createHash('sha256');
	for await (const chunk of createReadStream(file)) h.update(chunk as Buffer);
	return h.digest('hex');
}

/** A pinned download, from the cache when it's there, always checked. */
async function fetchPinned(pin: Pin): Promise<string> {
	mkdirSync(cache, { recursive: true });
	const file = join(cache, decodeURIComponent(basename(new URL(pin.url).pathname)));
	if (!existsSync(file)) {
		console.log(`  downloading ${basename(file)}`);
		const r = await fetch(pin.url);
		if (!r.ok) throw new Error(`${pin.url}: ${r.status}`);
		writeFileSync(`${file}.part`, Buffer.from(await r.arrayBuffer()));
		execFileSync('mv', [`${file}.part`, file]);
	}
	const got = await sha256(file);
	if (got !== pin.sha256) {
		rmSync(file);
		throw new Error(`${basename(file)}: SHA-256 ${got}, pinned ${pin.sha256}. Deleted it.`);
	}
	return file;
}

/** Unpack an archive into `dir`, returning its single top folder when it has one. */
function unpack(archive: string, dir: string): string {
	rmSync(dir, { recursive: true, force: true });
	mkdirSync(dir, { recursive: true });
	if (archive.endsWith('.zip')) run('unzip', ['-q', archive, '-d', dir]);
	else run('tar', ['-xf', archive, '-C', dir]);
	const top = readdirSync(dir).filter((n) => n !== '.' && !n.startsWith('._'));
	return top.length === 1 && statSync(join(dir, top[0])).isDirectory() ? join(dir, top[0]) : dir;
}

// ---- 1. the source ------------------------------------------------------------------------

step(`tsundoku ${version} from ${ref}${trial ? ' (a trial: no tag)' : ''}`);
const commit = capture('git', ['rev-parse', '--verify', `${ref}^{commit}`]);
const kotobaCommit = capture('git', ['rev-parse', 'HEAD'], kotobaRepo);
if (capture('git', ['status', '--porcelain'], kotobaRepo))
	throw new Error(`${kotobaRepo} has uncommitted changes: a release builds kotoba as committed.`);
if (capture('git', ['status', '--porcelain'], engineRepo))
	throw new Error(`${engineRepo} has uncommitted changes: commit them first.`);
const engineCommit = capture('git', ['rev-parse', 'HEAD'], engineRepo);
if (capture('git', ['branch', '-r', '--contains', engineCommit], engineRepo) === '')
	throw new Error(
		`tsundoku-engine ${engineCommit.slice(0, 7)} isn't pushed: a friend's source request couldn't be met.`
	);

rmSync(work, { recursive: true, force: true });
mkdirSync(work, { recursive: true });
mkdirSync(out, { recursive: true });
// `kotoba` is `link:../kotoba`: the worktree gets a sibling pointing at the real one.
symlinkSync(kotobaRepo, join(work, 'kotoba'));
const src = join(work, 'tsundoku');
run('git', ['worktree', 'add', '--detach', src, commit], { cwd: repo });
const cleanup = () => {
	try {
		execFileSync('git', ['worktree', 'remove', '--force', src], { cwd: repo, stdio: 'ignore' });
	} catch {
		// Already gone.
	}
};
process.on('exit', cleanup);

// ---- 2. the app ---------------------------------------------------------------------------

step('building the app');
run('yarn', ['install', '--frozen-lockfile', '--non-interactive'], { cwd: src });
run('yarn', ['run', 'build'], { cwd: src, env: { ...process.env, TSUNDOKU_VERSION: version } });
const pkg = JSON.parse(readFileSync(join(src, 'package.json'), 'utf8')) as {
	dependencies: Record<string, string>;
};
const imported = serverImports(join(src, 'build'));
console.log(`  the server loads: ${[...imported].sort().join(', ')}`);
if (imported.has('kotoba'))
	throw new Error(
		'the server build imports kotoba at runtime: it has to be bundled (doc/RELEASE.md).'
	);
const missing = [...imported].filter((n) => !(n in pkg.dependencies));
if (missing.length)
	throw new Error(`the server imports ${missing.join(', ')}, which aren't dependencies: add them.`);
const app = join(work, 'app');
mkdirSync(join(app, 'scripts'), { recursive: true });
mkdirSync(join(app, 'src/lib/server'), { recursive: true });
cpSync(join(src, 'build'), join(app, 'build'), { recursive: true });
copyFileSync(join(src, 'scripts/serve.ts'), join(app, 'scripts/serve.ts'));
for (const f of ['bind.ts', 'data-dirs.ts', 'first-run.ts'])
	copyFileSync(join(src, 'src/lib/server', f), join(app, 'src/lib/server', f));
copyFileSync(join(src, 'yarn.lock'), join(app, 'yarn.lock'));
// Only what the server loads: the rest of `dependencies` (fonts, hls.js, the
// adapter and its rollup, kotoba) is compiled into build/ or used to make it.
const dependencies = Object.fromEntries(
	Object.entries(pkg.dependencies).filter(([name]) => imported.has(name))
);
writeFileSync(
	join(app, 'package.json'),
	JSON.stringify(
		{ name: 'tsundoku', version, private: true, type: 'module', dependencies },
		null,
		2
	)
);

// ---- 3. the engine -------------------------------------------------------------------------

step(`building the engine at ${engineCommit.slice(0, 7)}`);
run(join(engineRepo, 'scripts/test.sh'), [':server:shadowJar'], { cwd: engineRepo });
const jar = readdirSync(join(engineRepo, 'server/build'))
	.filter((f) => f.endsWith('.jar'))
	.map((f) => join(engineRepo, 'server/build', f))
	.sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs)[0];
if (!jar) throw new Error('no engine jar in tsundoku-engine/server/build');

// ---- 4. each platform ----------------------------------------------------------------------

const target = {
	'win-x64': { os: 'win32', img: 'win32-x64', exe: '.exe' },
	'linux-x64': { os: 'linux', img: 'linux-x64', exe: '' }
} as const;

const sums: string[] = [];

for (const platform of platforms) {
	const t = target[platform];
	step(platform);
	const dir = join(work, platform, 'tsundoku');
	const tmp = join(work, platform, 'tmp');
	rmSync(join(work, platform), { recursive: true, force: true });
	mkdirSync(dir, { recursive: true });

	// The app, with the target's native modules.
	cpSync(app, join(dir, 'app'), { recursive: true });
	run(
		'yarn',
		[
			'install',
			'--production',
			'--pure-lockfile',
			'--ignore-scripts',
			'--ignore-platform',
			'--ignore-engines',
			'--non-interactive',
			'--silent'
		],
		{ cwd: join(dir, 'app') }
	);
	rmSync(join(dir, 'app', 'yarn.lock'));
	const imgDir = join(dir, 'app/node_modules/@img');
	for (const n of existsSync(imgDir) ? readdirSync(imgDir) : [])
		if (!n.endsWith(`-${t.img}`) && n !== 'colour') rmSync(join(imgDir, n), { recursive: true });
	run(
		join(process.execPath),
		[
			join(dir, 'app/node_modules/prebuild-install/bin.js'),
			'--platform',
			t.os,
			'--arch',
			'x64',
			'--runtime',
			'node',
			'--target',
			pins.node.version
		],
		{ cwd: join(dir, 'app/node_modules/better-sqlite3') }
	);
	if (!existsSync(join(dir, 'app/node_modules/better-sqlite3/build/Release/better_sqlite3.node')))
		throw new Error(`better-sqlite3 has no ${platform} binary`);

	// Node (the program and its licence: npm, corepack and the headers never run here), the JRE, ffmpeg.
	const nodeDist = unpack(await fetchPinned(pins.node[platform]), join(tmp, 'node'));
	const nodeExe = platform === 'win-x64' ? 'node.exe' : 'bin/node';
	mkdirSync(dirname(join(dir, 'node', nodeExe)), { recursive: true });
	copyFileSync(join(nodeDist, nodeExe), join(dir, 'node', nodeExe));
	chmodSync(join(dir, 'node', nodeExe), 0o755);
	copyFileSync(join(nodeDist, 'LICENSE'), join(dir, 'node', 'LICENSE'));
	cpSync(unpack(await fetchPinned(pins.jre[platform]), join(tmp, 'jre')), join(dir, 'jre'), {
		recursive: true
	});
	const ff = unpack(await fetchPinned(pins.ffmpeg[platform]), join(tmp, 'ffmpeg'));
	mkdirSync(join(dir, 'ffmpeg/bin'), { recursive: true });
	for (const exe of ['ffmpeg', 'ffprobe'])
		copyFileSync(join(ff, 'bin', exe + t.exe), join(dir, 'ffmpeg/bin', exe + t.exe));
	if (platform === 'win-x64') {
		for (const dll of readdirSync(join(ff, 'bin')).filter((f) => f.endsWith('.dll')))
			copyFileSync(join(ff, 'bin', dll), join(dir, 'ffmpeg/bin', dll));
	} else {
		// The shared build finds its libraries in ../lib (its rpath).
		cpSync(join(ff, 'lib'), join(dir, 'ffmpeg/lib'), { recursive: true, verbatimSymlinks: true });
		rmSync(join(dir, 'ffmpeg/lib/pkgconfig'), { recursive: true, force: true });
		for (const f of readdirSync(join(dir, 'ffmpeg/lib')))
			if (f.endsWith('.a')) rmSync(join(dir, 'ffmpeg/lib', f));
	}
	copyFileSync(join(ff, 'LICENSE.txt'), join(dir, 'ffmpeg/LICENSE.txt'));

	// The engine, the launcher, and what a friend reads.
	mkdirSync(join(dir, 'engine'));
	copyFileSync(jar, join(dir, 'engine/engine.jar'));
	mkdirSync(join(dir, 'launcher'));
	for (const f of ['launch.ts', 'plan.ts'])
		copyFileSync(join(src, 'ops/release/launcher', f), join(dir, 'launcher', f));
	if (platform === 'win-x64')
		copyFileSync(join(src, 'ops/release/launcher/tsundoku.cmd'), join(dir, 'tsundoku.cmd'));
	else {
		copyFileSync(join(src, 'ops/release/launcher/tsundoku'), join(dir, 'tsundoku'));
		chmodSync(join(dir, 'tsundoku'), 0o755);
	}
	copyFileSync(join(src, 'LICENSE'), join(dir, 'LICENSE'));
	const readme = readFileSync(join(src, 'ops/release/README.txt'), 'utf8').replace(
		'{{VERSION}}',
		version
	);
	writeFileSync(
		join(dir, 'README.txt'),
		platform === 'win-x64' ? readme.replace(/\n/g, '\r\n') : readme
	);
	writeFileSync(
		join(dir, 'release.json'),
		JSON.stringify(
			{
				version,
				platform,
				trial,
				commit,
				kotoba: kotobaCommit,
				engine: engineCommit,
				builtAt: new Date().toISOString(),
				node: pins.node.version,
				jre: pins.jre.version,
				ffmpeg: pins.ffmpeg.version,
				flaresolverr: pins.flaresolverr.version
			},
			null,
			2
		)
	);
	writeFileSync(join(dir, 'THIRD-PARTY-NOTICES.txt'), notices(dir, platform, src));
	rmSync(tmp, { recursive: true, force: true });

	// The archives.
	const name =
		platform === 'win-x64'
			? `tsundoku-${version}-${platform}.zip`
			: `tsundoku-${version}-${platform}.tar.xz`;
	rmSync(join(out, name), { force: true });
	if (platform === 'win-x64')
		run('zip', ['-qr', '-9', join(out, name), 'tsundoku'], { cwd: dirname(dir) });
	else
		run('tar', ['-cJf', join(out, name), 'tsundoku'], {
			cwd: dirname(dir),
			env: { ...process.env, XZ_OPT: '-T0 -9' }
		});
	const solver = await fetchPinned(pins.flaresolverr[platform]);
	const solverName = `flaresolverr-${pins.flaresolverr.version}-${platform}${solver.endsWith('.zip') ? '.zip' : '.tar.gz'}`;
	copyFileSync(solver, join(out, solverName));
	for (const f of [name, solverName]) sums.push(`${await sha256(join(out, f))}  ${f}`);
	console.log(`  ${name}: ${(statSync(join(out, name)).size / 1e6).toFixed(0)} MB`);
}

writeFileSync(join(out, 'SHA256SUMS'), `${sums.join('\n')}\n`);
rmSync(work, { recursive: true, force: true });
console.log(`\nDone: ${out}`);

// ---- what the server loads -----------------------------------------------------------------

/**
 * The packages the built server imports, read from its chunks: rollup writes
 * every import at the start of a line, `import x from 'name'` or a bare
 * `import 'name'`. `import('...')` elsewhere is JSDoc type text, or kit's
 * optional @opentelemetry/api, and doesn't count.
 */
function serverImports(build: string): Set<string> {
	const names = new Set<string>();
	const re = /^(?:import|export)[^;]*?from ?'([^'.][^']*)'|^import ?'([^'.][^']*)'/gm;
	for (const f of readdirSync(build, { recursive: true, encoding: 'utf8' })) {
		if (!f.endsWith('.js') || f.startsWith('client')) continue;
		for (const m of readFileSync(join(build, f), 'utf8').matchAll(re)) {
			const spec = m[1] ?? m[2];
			if (spec.startsWith('node:')) continue;
			names.add(spec.startsWith('@') ? spec.split('/').slice(0, 2).join('/') : spec.split('/')[0]);
		}
	}
	return names;
}

// ---- THIRD-PARTY-NOTICES ---------------------------------------------------------------------

/**
 * Every component in the bundle, its version and licence, with the licence's
 * text: the npm packages the server loads (node_modules, walked), the ones
 * compiled into the build (named below, from the build checkout), and the
 * programs beside them.
 */
function notices(dir: string, platform: Platform, src: string): string {
	const parts: string[] = [];
	const add = (title: string, licence: string, text: string | null, note = '') =>
		parts.push(
			[
				`${title}`,
				`Licence: ${licence}`,
				note,
				text ? `\n${text.trim()}` : '(no licence file shipped by the project)'
			]
				.filter(Boolean)
				.join('\n')
		);
	const licenceText = (folder: string) => {
		const f = existsSync(folder)
			? readdirSync(folder).find((n) => /^(licen[cs]e|copying|notice)/i.test(n))
			: undefined;
		return f ? readFileSync(join(folder, f), 'utf8') : null;
	};
	const pkgNotice = (folder: string, seen: Set<string>) => {
		const p = JSON.parse(readFileSync(join(folder, 'package.json'), 'utf8')) as {
			name: string;
			version: string;
			license?: string;
		};
		const key = `${p.name}@${p.version}`;
		if (seen.has(key)) return;
		seen.add(key);
		add(key, p.license ?? 'see text', licenceText(folder));
	};
	const walk = (nm: string, seen: Set<string>) => {
		if (!existsSync(nm)) return;
		for (const n of readdirSync(nm)) {
			if (n.startsWith('.')) continue;
			const d = join(nm, n);
			if (n.startsWith('@')) {
				for (const s of readdirSync(d)) {
					pkgNotice(join(d, s), seen);
					walk(join(d, s, 'node_modules'), seen);
				}
			} else if (existsSync(join(d, 'package.json'))) {
				pkgNotice(d, seen);
				walk(join(d, 'node_modules'), seen);
			}
		}
	};

	parts.push(
		`tsundoku ${version}: third-party notices\n\n` +
			'tsundoku itself is under the PolyForm Noncommercial License 1.0.0 (LICENSE).\n' +
			'This folder also carries the programs and packages below, each under its\n' +
			'own licence.'
	);
	add(
		'The LNReader plugin shims in tsundoku (src/lib/server/novels/plugin-host.cjs),\nadapted from lnreader-plugins',
		'MIT',
		readFileSync(join(src, 'src/lib/server/novels/LICENSE-lnreader-plugins.txt'), 'utf8')
	);
	add(
		`tsundoku-engine ${engineCommit.slice(0, 7)} (engine/engine.jar), a fork of M-Extension-Server`,
		'MPL-2.0',
		readFileSync(join(engineRepo, 'LICENSE'), 'utf8'),
		'Its source is available from whoever gave you this copy, on request.'
	);
	add(`Node.js ${pins.node.version} (node/)`, pins.node.licence, licenceText(join(dir, 'node')));
	add(
		`Eclipse Temurin JRE ${pins.jre.version} (jre/)`,
		pins.jre.licence,
		licenceText(join(dir, 'jre')) ?? licenceText(join(dir, 'jre/legal/java.base')),
		'Its own notices are in jre/legal/.'
	);
	add(
		`FFmpeg ${pins.ffmpeg.version} (ffmpeg/)`,
		pins.ffmpeg.licence,
		readFileSync(join(dir, 'ffmpeg/LICENSE.txt'), 'utf8'),
		`Unmodified, from ${pins.ffmpeg[platform].url}. Source: ${pins.ffmpeg.source}`
	);
	const seen = new Set<string>();
	// Compiled into build/ rather than loaded: every dependency the server doesn't
	// load (the fonts, hls.js, ...), the UI framework, and kotoba with its
	// tokenizer and dictionary. A build tool that ships nothing (the adapter)
	// is listed too: erring on the side of naming it.
	const compiled = [
		...Object.keys(pkg.dependencies).filter((n) => n !== 'kotoba' && !imported.has(n)),
		'svelte',
		'@sveltejs/kit',
		'devalue',
		'esm-env'
	];
	for (const n of compiled)
		if (existsSync(join(src, 'node_modules', n))) pkgNotice(join(src, 'node_modules', n), seen);
	pkgNotice(kotobaRepo, seen);
	const kuromoji = join(kotobaRepo, 'node_modules/@patdx/kuromoji');
	if (existsSync(kuromoji)) pkgNotice(kuromoji, seen);
	walk(join(dir, 'app/node_modules'), seen);
	parts.push(
		`FlareSolverr ${pins.flaresolverr.version} (the optional flaresolverr archive)\n` +
			'Licence: MIT. Shipped unmodified as its project releases it, with the\n' +
			"Chrome it runs, under Chrome's own terms."
	);
	return `${parts.join(`\n\n${'='.repeat(78)}\n\n`)}\n`;
}

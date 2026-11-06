import { spawnSync } from 'node:child_process';
import {
	chmodSync,
	copyFileSync,
	existsSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	writeFileSync
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

/**
 * ops/release/android-apk.sh against a throwaway repository holding a copy of
 * the script and a pretend gradlew, which "builds" each APK out of the tree it
 * stands in. So what an APK holds says which tree it was built from, without a
 * JDK or an SDK, and nothing here touches this checkout.
 */
const scripts = fileURLToPath(new URL('../ops/release/', import.meta.url));
const VERSION = '2026.01.02';
const TAGGED = 'the tagged tree';

const GRADLEW = `#!/bin/sh
echo "$*" >> "$FAKE_GRADLE_LOG"
[ "$1" = --stop ] && exit 0
[ -n "\${FAKE_GRADLE_FAIL:-}" ] && exit 7
for a in "$@"; do
	case "$a" in
		:app:assemble*)
			n=\${a#:app:assemble}
			case "$n" in Tv*) f=tv ;; *) f=mobile ;; esac
			case "$n" in *Release) t=release ;; *) t=debug ;; esac
			mkdir -p "app/build/outputs/apk/$f/$t"
			cat source.txt > "app/build/outputs/apk/$f/$t/app-$f-$t.apk"
			;;
	esac
done
`;

let world: string;
let repo: string;
let base: string;
let gradleLog: string;

/** A commit-capable, hook-free git: a pre-push hook's GIT_* must not reach the fixture. */
function cleanEnv(extra: Record<string, string> = {}): NodeJS.ProcessEnv {
	const env: NodeJS.ProcessEnv = { ...process.env };
	for (const k of Object.keys(env))
		if (k.startsWith('GIT_') || k.startsWith('TSUNDOKU_TV_')) delete env[k];
	return {
		...env,
		ANDROID_HOME: join(world, 'sdk'),
		RELEASE_DIR: base,
		FAKE_GRADLE_LOG: gradleLog,
		...extra
	};
}

function git(...args: string[]) {
	const r = spawnSync(
		'git',
		['-c', 'user.name=spec', '-c', 'user.email=spec@example.invalid', ...args],
		{ cwd: repo, env: cleanEnv(), encoding: 'utf8' }
	);
	if (r.status !== 0) throw new Error(`git ${args.join(' ')}: ${r.stderr}`);
	return r.stdout;
}

function apk(args: string[], extra: Record<string, string> = {}, script = 'android-apk.sh') {
	rmSync(gradleLog, { force: true });
	return spawnSync('sh', [join(repo, 'ops/release', script), ...args], {
		cwd: repo,
		env: cleanEnv(extra),
		encoding: 'utf8'
	});
}

const gradleCalls = () => (existsSync(gradleLog) ? readFileSync(gradleLog, 'utf8') : '');

beforeAll(() => {
	world = mkdtempSync(join(tmpdir(), 'tsundoku-release-apk-'));
	repo = join(world, 'repo');
	base = join(world, 'release');
	gradleLog = join(world, 'gradle.log');
	mkdirSync(join(repo, 'ops/release'), { recursive: true });
	mkdirSync(join(repo, 'android'), { recursive: true });
	for (const s of ['android-apk.sh', 'tv-apk.sh'])
		copyFileSync(join(scripts, s), join(repo, 'ops/release', s));
	chmodSync(join(repo, 'ops/release/android-apk.sh'), 0o755);
	writeFileSync(join(repo, 'android/gradlew'), GRADLEW, { mode: 0o755 });
	writeFileSync(join(repo, 'android/source.txt'), TAGGED);
	git('init', '-q');
	git('add', '.');
	git('commit', '-q', '-m', 'tagged');
	git('tag', `release/${VERSION}`);
	// Main has moved on since the tag, and someone is mid-edit besides.
	writeFileSync(join(repo, 'android/source.txt'), 'a later commit');
	git('commit', '-qam', 'later');
	writeFileSync(join(repo, 'android/source.txt'), 'uncommitted work');
});

afterAll(() => rmSync(world, { recursive: true, force: true }));

describe('the Android apps are built from the tag (doc/RELEASE.md)', () => {
	const out = () => join(base, 'out', VERSION);

	it('holds what the tag holds, not the later commit or the working tree', () => {
		const r = apk([VERSION]);
		expect(r.status, r.stderr).toBe(0);
		for (const n of ['tv', 'app'])
			expect(readFileSync(join(out(), `tsundoku-${n}-${VERSION}-debug.apk`), 'utf8')).toBe(TAGGED);
		expect(readFileSync(join(repo, 'android/source.txt'), 'utf8')).toBe('uncommitted work');
	});

	it('lists each APK in the release folder’s SHA256SUMS once, however often it is built', () => {
		apk([VERSION]);
		const lines = readFileSync(join(out(), 'SHA256SUMS'), 'utf8').trim().split('\n');
		expect(lines.map((l) => l.split('  ')[1]).sort()).toEqual([
			`tsundoku-app-${VERSION}-debug.apk`,
			`tsundoku-tv-${VERSION}-debug.apk`
		]);
	});

	it('refuses a version with no tag, before any build', () => {
		const r = apk(['2026.01.03']);
		expect(r.status).not.toBe(0);
		expect(r.stderr).toContain('no tag release/2026.01.03');
		expect(gradleCalls()).toBe('');
		expect(existsSync(join(base, 'out/2026.01.03'))).toBe(false);
	});

	it('keeps a trial out of the release’s folder: --ref needs its own --out', () => {
		const r = apk(['2026.01.04', '--ref', 'HEAD']);
		expect(r.status).toBe(2);
		expect(r.stderr).toContain('needs its own --out');
		expect(gradleCalls()).toBe('');
		expect(existsSync(join(base, 'out/2026.01.04'))).toBe(false);
	});

	it('builds a trial from a commit, into an --out named from where it was called', () => {
		const r = apk(['0.0.0-trial', '--ref', 'HEAD', '--out', 'trial-out', '--app', 'phone']);
		expect(r.status, r.stderr).toBe(0);
		expect(readFileSync(join(repo, 'trial-out/tsundoku-app-0.0.0-trial-debug.apk'), 'utf8')).toBe(
			'a later commit'
		);
		rmSync(join(repo, 'trial-out'), { recursive: true });
	});

	it('refuses a --ref that is no commit', () => {
		const r = apk(['0.0.0-trial', '--ref', 'no-such-ref', '--out', 'trial-out']);
		expect(r.status).toBe(1);
		expect(r.stderr).toContain('no commit');
	});

	it('signs when the keystore is there, and tv-apk.sh is the same build for the TV alone', () => {
		const keystore = join(world, 'key.jks');
		writeFileSync(keystore, 'key');
		const r = apk(
			[VERSION],
			{
				TSUNDOKU_TV_KEYSTORE: keystore,
				TSUNDOKU_TV_KEYSTORE_PASSWORD: 'p',
				TSUNDOKU_TV_KEY_ALIAS: 'a',
				TSUNDOKU_TV_KEY_PASSWORD: 'p'
			},
			'tv-apk.sh'
		);
		expect(r.status, r.stderr).toBe(0);
		expect(gradleCalls()).toContain(':app:assembleTvRelease');
		expect(gradleCalls()).not.toContain('Mobile');
		expect(gradleCalls()).toContain(`-PversionName=${VERSION}`);
		expect(readFileSync(join(out(), `tsundoku-tv-${VERSION}.apk`), 'utf8')).toBe(TAGGED);
	});

	it('leaves no worktree or Gradle daemon behind, even when the build fails', () => {
		for (const failing of [false, true]) {
			const r = apk([VERSION], failing ? { FAKE_GRADLE_FAIL: '1' } : {});
			expect(r.status).toBe(failing ? 7 : 0);
			expect(gradleCalls()).toContain('--stop');
			expect(existsSync(join(base, `work/android-${VERSION}`))).toBe(false);
			expect(git('worktree', 'list', '--porcelain').match(/^worktree /gm)).toHaveLength(1);
		}
	});
});

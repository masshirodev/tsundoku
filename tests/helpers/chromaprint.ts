import { execFileSync, spawnSync } from 'node:child_process';

/**
 * Why this machine cannot fingerprint, or null when it can.
 *
 * The app has two routes to chromaprint (`src/lib/server/anime/fingerprint.ts`):
 * ffmpeg's own muxer, or `fpcalc` (FPCALC, else on PATH). A box with neither
 * (the WSL `work` box: Ubuntu's ffmpeg has no muxer and nothing installs
 * fpcalc) can only fail the specs that fingerprint, which buried a real break
 * among thirteen reds that were the machine's. Those specs skip there instead,
 * and say why once. The release's own smoke (`ops/release/smoke/fingerprint.sh`)
 * still proves the shipped ffmpeg fingerprints, so a skip here hides nothing
 * that ships.
 */
export function chromaprintMissing(ffmpeg = process.env.FFMPEG ?? 'ffmpeg'): string | null {
	let muxers: string;
	try {
		muxers = execFileSync(ffmpeg, ['-hide_banner', '-muxers'], { encoding: 'utf8' });
	} catch {
		// No ffmpeg at all: the fixtures could not be encoded either.
		return `${ffmpeg} cannot be run`;
	}
	if (muxers.includes('chromaprint')) return null;
	const fpcalc = process.env.FPCALC ?? 'fpcalc';
	if (!spawnSync(fpcalc, ['-version'], { stdio: 'ignore' }).error) return null;
	return `${ffmpeg} has no chromaprint muxer and ${fpcalc} cannot be run (install chromaprint's fpcalc, or set FPCALC)`;
}

/** Skip-guard for a spec file: the reason, printed once, or null. */
export function chromaprintSkip(file: string, ffmpeg?: string): string | null {
	const why = chromaprintMissing(ffmpeg);
	if (why) console.warn(`[${file}] skipping the cases that fingerprint: ${why}`);
	return why;
}

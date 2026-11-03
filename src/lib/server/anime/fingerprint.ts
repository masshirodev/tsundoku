import { spawn, type ChildProcess } from 'node:child_process';
import { pipeline } from 'node:stream';
import {
	regions as regionsOf,
	INTRO_MIN_S,
	ENDING_MIN_S,
	type Fingerprint
} from '../../library/fingerprint.ts';

/**
 * Fingerprints of an episode (doc/ANIME.md, "Openings and endings"; card
 * c239). ffmpeg decodes the audio, chromaprint turns it into points; the
 * comparison is the pure module's. Only the minutes a decision needs are
 * read: a seek before the input, and a length after it.
 *
 * The brief names ffmpeg's own chromaprint muxer (`-f chromaprint -fp_format
 * raw`). This machine's ffmpeg is built without it, so a build that doesn't
 * know the muxer falls back to `fpcalc`, chromaprint's own program, fed the
 * same audio through the same ffmpeg. Both produce the same points; `fpcalc`
 * is only the route to them on a build whose ffmpeg lacks the muxer (see
 * doc/ANIME.md).
 */

const FFMPEG = () => process.env.FFMPEG ?? 'ffmpeg';
const FFPROBE = () => process.env.FFPROBE ?? 'ffprobe';
const FPCALC = () => process.env.FPCALC ?? 'fpcalc';

type Span = { start: number; seconds: number };
export type Prints = { intro: Fingerprint | null; ending: Fingerprint | null };
type Stream = { header: string; hls: boolean };

/** ffmpeg without the muxer: the fallback is the only way on this build. */
let muxerMissing = false;
/** fpcalc's absence is said once, not on every episode (c297). */
let warnedFpcalc = false;
/** For specs: try the muxer again (another ffmpeg may be the one under test). */
export function forgetFingerprint(): void {
	muxerMissing = false;
	warnedFpcalc = false;
}

type Ran = { code: number | null; stdout: Buffer; stderr: string };

/** The ffmpeg and fpcalc processes in flight, so SIGTERM can end them. */
const children = new Set<ChildProcess>();

function track<T extends ChildProcess>(p: T): T {
	children.add(p);
	p.once('close', () => children.delete(p));
	return p;
}

/** Ends every fingerprint in flight: a stopping server shouldn't wait for one. */
export function stopFingerprint(): void {
	for (const p of children) {
		try {
			p.kill('SIGKILL');
		} catch {
			// Already gone.
		}
	}
	children.clear();
}

function run(command: string, args: string[], collect = true): Promise<Ran> {
	return new Promise((ok, no) => {
		const p = track(
			spawn(command, args, { stdio: ['ignore', collect ? 'pipe' : 'ignore', 'pipe'] })
		);
		const out: Buffer[] = [];
		let err = '';
		p.stdout?.on('data', (b: Buffer) => out.push(b));
		p.stderr?.on('data', (b: Buffer) => (err += b.toString()));
		p.on('error', no);
		p.on('close', (code) => ok({ code, stdout: Buffer.concat(out), stderr: err }));
	});
}

/** The arguments that seek to [region] and read only it, from a file or a stream. */
function inputArgs(input: string, region: Span, stream?: Stream): string[] {
	return [
		'-hide_banner',
		'-loglevel',
		'error',
		// As a download's and a picture's: the proxy's segments have no extension.
		...(stream ? ['-headers', `${stream.header}\r\n`] : []),
		...(stream?.hls ? ['-extension_picky', '0'] : []),
		// Before -i: ffmpeg seeks, so a stream fetches only the segments it lands in.
		'-ss',
		String(region.start),
		'-t',
		String(region.seconds),
		'-i',
		input
	];
}

const fromRaw = (body: Buffer, seconds: number): Fingerprint | null => {
	if (body.length < 4) return null;
	const points = new Uint32Array(Math.floor(body.length / 4));
	for (let i = 0; i < points.length; i++) points[i] = body.readUInt32LE(i * 4);
	return { points, seconds };
};

/** ffmpeg's chromaprint muxer, where the build has it. */
async function muxerPrint(
	input: string,
	region: Span,
	stream?: Stream
): Promise<Fingerprint | null> {
	if (muxerMissing) return null;
	const ran = await run(FFMPEG(), [
		...inputArgs(input, region, stream),
		'-vn',
		'-f',
		'chromaprint',
		'-fp_format',
		'raw',
		'pipe:1'
	]);
	if (ran.code === 0 && ran.stdout.length >= 4) return fromRaw(ran.stdout, region.seconds);
	if (/chromaprint|unknown output format|requested output format/i.test(ran.stderr))
		muxerMissing = true;
	return null;
}

/** fpcalc, fed the same audio as raw PCM: chromaprint without the muxer. */
function fpcalcPrint(input: string, region: Span, stream?: Stream): Promise<Fingerprint | null> {
	const ff = track(
		spawn(
			FFMPEG(),
			[
				...inputArgs(input, region, stream),
				'-vn',
				'-ac',
				'1',
				'-ar',
				'11025',
				'-f',
				's16le',
				'pipe:1'
			],
			{ stdio: ['ignore', 'pipe', 'pipe'] }
		)
	);
	const fp = track(
		spawn(
			FPCALC(),
			[
				'-format',
				's16le',
				'-rate',
				'11025',
				'-channels',
				'1',
				'-length',
				String(Math.ceil(region.seconds) + 2),
				'-raw',
				'-json',
				'-'
			],
			{ stdio: ['pipe', 'pipe', 'pipe'] }
		)
	);
	const out: Buffer[] = [];
	fp.stdout.on('data', (b: Buffer) => out.push(b));
	// Drained, not read: an undrained pipe would hold each process up.
	fp.stderr.on('data', () => {});
	ff.stderr.on('data', () => {});
	// pipeline, never pipe: a source that fails mid-way must not emit an
	// unhandled 'error' and take the server down (de2334c).
	pipeline(ff.stdout, fp.stdin, () => {});
	return new Promise((ok) => {
		ff.on('error', () => ok(null));
		fp.on('error', () => {
			if (!warnedFpcalc) {
				warnedFpcalc = true;
				console.error(
					`tsundoku: fingerprinting needs fpcalc (chromaprint), and ${FPCALC()} could not be run: set FPCALC, or a bundle carries its own (c297)`
				);
			}
			ok(null);
		});
		fp.on('close', (code) => {
			if (code !== 0) return ok(null);
			try {
				const j = JSON.parse(Buffer.concat(out).toString() || '{}') as {
					duration?: number;
					fingerprint?: number[];
				};
				const points = Uint32Array.from(j.fingerprint ?? []);
				ok(points.length ? { points, seconds: region.seconds } : null);
			} catch {
				ok(null);
			}
		});
	});
}

/** One region's points: the muxer if it is there, else fpcalc. */
async function printAt(input: string, region: Span, stream?: Stream): Promise<Fingerprint | null> {
	const viaMuxer = await muxerPrint(input, region, stream).catch(() => null);
	if (viaMuxer) return { ...viaMuxer, start: region.start };
	const fallback = await fpcalcPrint(input, region, stream).catch(() => null);
	return fallback ? { ...fallback, start: region.start } : null;
}

/** A file's length, for an episode no download recorded one for. */
export function fileSeconds(file: string): Promise<number | null> {
	return new Promise((ok) => {
		const p = spawn(FFPROBE(), [
			'-v',
			'error',
			'-show_entries',
			'format=duration',
			'-of',
			'csv=p=0',
			file
		]);
		let text = '';
		p.stdout.on('data', (b: Buffer) => (text += b.toString()));
		p.on('error', () => ok(null));
		p.on('close', () => {
			const n = Number(text.trim());
			ok(Number.isFinite(n) && n > 0 ? n : null);
		});
	});
}

/**
 * The two prints of [input] (a file, or a loopback stream address) whose
 * length is [durationS]. A region too short to hold a mark isn't fingerprinted.
 */
export async function fingerprintRegions(
	input: string,
	durationS: number,
	stream?: Stream
): Promise<Prints> {
	const r = regionsOf(durationS);
	if (!r) return { intro: null, ending: null };
	const intro =
		r.intro.seconds >= INTRO_MIN_S ? await printAt(input, r.intro, stream).catch(() => null) : null;
	const ending =
		r.ending.seconds >= ENDING_MIN_S
			? await printAt(input, r.ending, stream).catch(() => null)
			: null;
	return { intro, ending };
}

/** A downloaded episode's prints. */
export async function fingerprintFile(file: string, durationS: number | null): Promise<Prints> {
	const d = durationS && durationS > 0 ? durationS : await fileSeconds(file);
	if (!d) return { intro: null, ending: null };
	return fingerprintRegions(file, d);
}

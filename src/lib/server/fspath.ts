import nodePath from 'node:path';

/**
 * `node:path` for server code, writing every path with `/` (doc/DISTRIBUTION.md,
 * "Windows paths").
 *
 * The library's own path logic is POSIX: series paths and entry files are
 * stored with `/`, and paths.ts joins and compares with it ("is this file in
 * the library?"). On Linux that's what `node:path` writes. On Windows it
 * writes `\`, so an imported series would be stored as `C:\Users\...` beside a
 * data folder of `C:/Users/...`, and every comparison between the two would
 * be false.
 * Node takes `C:/Users/...` everywhere it takes `C:\Users\...`, so here every
 * result is written with `/` on Windows, and nothing changes elsewhere: on
 * Linux a backslash is an ordinary character in a file name, never a separator.
 *
 * Import from here, not `node:path`, in anything that makes a path the
 * library keeps or compares. `posix` is passed through for code that means
 * POSIX on purpose.
 */
export function pathsFor(platform: NodeJS.Platform) {
	const native = platform === 'win32' ? nodePath.win32 : nodePath.posix;
	const slash = platform === 'win32' ? (p: string) => p.replaceAll('\\', '/') : (p: string) => p;
	return {
		sep: '/' as const,
		/** A path from elsewhere (an API, the OS) in this module's spelling. */
		slash,
		join: (...parts: string[]) => slash(native.join(...parts)),
		resolve: (...parts: string[]) => slash(native.resolve(...parts)),
		relative: (from: string, to: string) => slash(native.relative(from, to)),
		dirname: (p: string) => slash(native.dirname(p)),
		normalize: (p: string) => slash(native.normalize(p)),
		basename: (p: string, suffix?: string) => native.basename(p, suffix),
		extname: (p: string) => native.extname(p),
		isAbsolute: (p: string) => native.isAbsolute(p)
	};
}

export const {
	sep,
	slash,
	join,
	resolve,
	relative,
	dirname,
	normalize,
	basename,
	extname,
	isAbsolute
} = pathsFor(process.platform);

export { posix } from 'node:path';

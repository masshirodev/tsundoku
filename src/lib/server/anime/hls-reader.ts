import { execFile } from 'node:child_process';

/**
 * The options that let an ffmpeg's HLS reader take the loopback proxy's
 * segments, whose addresses have no extension (and a site's are often dressed
 * as .jpg).
 *
 * ffmpeg 7.1 made the reader picky: it refuses a segment whose extension it
 * does not expect, unless `-extension_picky 0`. Before 7.1 there is no such
 * check for a segment fetched over HTTP, and no such option either, so an
 * older ffmpeg (Ubuntu 24.04's 6.1) refuses the whole command when it is
 * given. The reader's own help says which it is, asked once per binary.
 */
const asked = new Map<string, Promise<string[]>>();

export function hlsReaderArgs(ffmpeg: string): Promise<string[]> {
	let args = asked.get(ffmpeg);
	if (!args) {
		args = new Promise((ok) =>
			execFile(ffmpeg, ['-hide_banner', '-h', 'demuxer=hls'], (err, stdout) =>
				// An ffmpeg that cannot answer fails at the command itself, and says why there.
				ok(!err && stdout.includes('extension_picky') ? ['-extension_picky', '0'] : [])
			)
		);
		asked.set(ffmpeg, args);
	}
	return args;
}

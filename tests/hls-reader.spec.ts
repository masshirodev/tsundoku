import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { hlsReaderArgs } from '../src/lib/server/anime/hls-reader';

// Stand-in ffmpegs that answer `-h demuxer=hls` as each version does, and
// count how often they are asked.
const work = mkdtempSync(join(tmpdir(), 'tsundoku-hls-reader-'));
afterAll(() => rmSync(work, { recursive: true, force: true }));

const fake = (name: string, help: string) => {
	const file = join(work, name);
	writeFileSync(file, `#!/bin/sh\necho asked >> "${file}.log"\nprintf '%s\\n' '${help}'\n`);
	chmodSync(file, 0o755);
	return file;
};

describe('the HLS reader’s options', () => {
	it('are -extension_picky 0 on an ffmpeg whose reader has it (7.1 on)', async () => {
		const ffmpeg = fake('ffmpeg-7', '  -extension_picky   <boolean>    .D......... Be picky');
		expect(await hlsReaderArgs(ffmpeg)).toEqual(['-extension_picky', '0']);
	});

	it('are nothing on an older ffmpeg, which would refuse the option', async () => {
		const ffmpeg = fake(
			'ffmpeg-6',
			'  -allowed_extensions <string>  .D......... List of file extensions'
		);
		expect(await hlsReaderArgs(ffmpeg)).toEqual([]);
	});

	it('are nothing when the ffmpeg cannot be run', async () => {
		expect(await hlsReaderArgs(join(work, 'no-ffmpeg'))).toEqual([]);
	});

	it('are asked once per binary', async () => {
		const ffmpeg = fake('ffmpeg-once', '-extension_picky');
		await Promise.all([hlsReaderArgs(ffmpeg), hlsReaderArgs(ffmpeg)]);
		await hlsReaderArgs(ffmpeg);
		expect(readFileSync(`${ffmpeg}.log`, 'utf8').trim().split('\n')).toHaveLength(1);
	});
});

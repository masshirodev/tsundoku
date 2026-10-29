import { error } from '@sveltejs/kit';
import { spawn } from 'node:child_process';
import type { RequestHandler } from './$types';
import { isRevealed } from '$lib/server/prefs';
import { episodeFile, episodeRow } from '$lib/server/anime/streams';

/**
 * A downloaded episode's subtitle track as WebVTT, read out of its MKV by
 * ffmpeg (doc/ANIME.md, "Downloading"): the player draws subtitles itself, and
 * the file keeps them inside, as Jellyfin reads them.
 */
export const GET: RequestHandler = async ({ params, cookies }) => {
	const id = Number(params.entry);
	const n = Number(params.n);
	if (!Number.isInteger(id) || !Number.isInteger(n) || n < 0 || n > 31) error(404, 'not found');
	if (!episodeRow(id, isRevealed(cookies))) error(404, 'not found');
	const path = episodeFile(id);
	if (!path) error(404, 'not found');
	const vtt = await new Promise<string | null>((ok) => {
		const p = spawn(process.env.FFMPEG ?? 'ffmpeg', [
			'-nostdin',
			'-v',
			'error',
			'-i',
			path,
			'-map',
			`0:s:${n}`,
			'-f',
			'webvtt',
			'pipe:1'
		]);
		let out = '';
		p.stdout.on('data', (b: Buffer) => (out += b.toString()));
		p.on('error', () => ok(null));
		p.on('close', (code) => ok(code === 0 ? out : null));
	});
	if (vtt === null) error(404, 'not found');
	return new Response(vtt, {
		headers: { 'content-type': 'text/vtt; charset=utf-8', 'cache-control': 'private, max-age=3600' }
	});
};

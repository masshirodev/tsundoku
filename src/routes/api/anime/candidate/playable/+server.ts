import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { callSource, isAnimeSource } from '$lib/server/engine/backend';
import { EngineError } from '$lib/server/engine/client';

/**
 * Whether one episode plays at a candidate source (doc/MOVE.md, "PLAYS";
 * Migrate Calls Q2): the comparison asks it for the episode CONTINUE would
 * play, once a candidate is picked. It costs one call per candidate, which is
 * why the candidate list never does. The answer is not kept: a source's
 * servers change by the hour.
 */
export const GET: RequestHandler = async ({ url }) => {
	const source = url.searchParams.get('source') ?? '';
	const episode = url.searchParams.get('url') ?? '';
	const name = url.searchParams.get('name') ?? '';
	if (!/^\d+$/.test(source) || !isAnimeSource(source)) error(404, 'not found');
	// An episode's address at the source, never an arbitrary URL for the engine to fetch.
	if (!episode || episode.length > 2048 || !/^(https?:\/\/|\/)/.test(episode))
		error(400, 'not an episode');
	try {
		const videos = await callSource<{ quality?: string | null }[]>(
			source,
			'getVideoList',
			{ episodeData: { url: episode, name } },
			45_000
		);
		const list = Array.isArray(videos) ? videos : [];
		return json(
			{ plays: list.length > 0, quality: list[0]?.quality ?? null },
			{ headers: { 'cache-control': 'private, no-store' } }
		);
	} catch (e) {
		if (e instanceof EngineError)
			return json(
				{ plays: false, quality: null },
				{ status: 503, headers: { 'cache-control': 'private, no-store' } }
			);
		throw e;
	}
};

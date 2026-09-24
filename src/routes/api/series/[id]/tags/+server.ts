import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { seriesDetail } from '$lib/server/library';
import { suggestTags } from '$lib/server/series';
import { isRevealed } from '$lib/server/prefs';
import { parseTag } from '$lib/library/series';

/** Suggestions for the tag field: `?q=artist:se`, and `&entry=` for one book's. */
export const GET: RequestHandler = ({ params, url, cookies }) => {
	const reveal = isRevealed(cookies);
	const id = Number(params.id);
	if (!Number.isInteger(id) || !seriesDetail(id, reveal)) error(404, 'not found');
	const input = parseTag(url.searchParams.get('q') ?? '');
	const entry = Number(url.searchParams.get('entry')) || undefined;
	return json(input ? suggestTags(id, input, reveal, 6, entry) : []);
};

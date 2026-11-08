import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { seriesOfBooks, seriesOfVolumes } from '$lib/server/books';
import { workChoices } from '$lib/server/works';
import { isRevealed } from '$lib/server/prefs';

/**
 * What the selection's sheets list on `/search` (c838): GROUP's ADD TO
 * EXISTING and ADD TO A WORK, and HIDE's count of a Work's series. The library
 * loads these with its page; the search loads them only while selecting, so a
 * keystroke of an ordinary search does not pay for them.
 */
export const GET: RequestHandler = ({ cookies }) => {
	const reveal = isRevealed(cookies);
	return json({
		existing: seriesOfBooks(reveal),
		existingVolumes: seriesOfVolumes(reveal),
		existingWorks: workChoices()
	});
};

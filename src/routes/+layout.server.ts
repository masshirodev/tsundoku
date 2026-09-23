import type { LayoutServerLoad } from './$types';
import { currentScan, listShelves } from '$lib/server/library';
import { isRevealed, themeOf } from '$lib/server/prefs';

export const load: LayoutServerLoad = ({ cookies, locals }) => {
	const reveal = isRevealed(cookies);
	const theme = themeOf(cookies);
	if (!locals.authed) return { reveal: false, theme, shelves: [], scan: null };
	const scan = currentScan();
	return {
		reveal,
		theme,
		scan,
		shelves: listShelves({ reveal, withNew: scan !== null })
	};
};

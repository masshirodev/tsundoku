import type { LayoutServerLoad } from './$types';
import { currentScan, listShelves } from '$lib/server/library';
import { isIncognito, isRevealed, themeOf } from '$lib/server/prefs';
import { favouritePeople } from '$lib/server/people';

export const load: LayoutServerLoad = ({ cookies, locals }) => {
	const reveal = isRevealed(cookies);
	const theme = themeOf(cookies);
	if (!locals.authed)
		return { reveal: false, incognito: false, theme, shelves: [], scan: null, people: [] };
	const scan = currentScan();
	const shelves = listShelves({ reveal, withNew: scan !== null });
	// Favourite people become a shelf of their own (Index Books). It only
	// exists while one of them has a visible book.
	const people = favouritePeople(reveal);
	if (people.length > 0)
		shelves.push({ key: 'people', name: 'People', kind: 'smart', count: people.length });
	return { reveal, incognito: isIncognito(cookies), theme, scan, shelves, people };
};

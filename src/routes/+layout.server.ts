import type { LayoutServerLoad } from './$types';
import { currentScan, listShelves } from '$lib/server/library';
import { isIncognito, isRevealed, themeOf } from '$lib/server/prefs';
import { favouritePeople } from '$lib/server/people';
import { queueSummary } from '$lib/server/suwayomi';
import { ensureWatcher } from '$lib/server/suwayomi-watch';
import { ensureEngineWorker } from '$lib/server/engine/run';

export const load: LayoutServerLoad = async ({ cookies, locals }) => {
	const reveal = isRevealed(cookies);
	const theme = themeOf(cookies);
	if (!locals.authed)
		return {
			reveal: false,
			incognito: false,
			theme,
			shelves: [],
			scan: null,
			people: [],
			queue: null
		};
	const scan = currentScan();
	const shelves = listShelves({ reveal, withNew: scan !== null });
	// Favourite people become a shelf of their own (Index Books). It only
	// exists while one of them has a visible book.
	const people = favouritePeople(reveal);
	if (people.length > 0)
		shelves.push({ key: 'people', name: 'People', kind: 'smart', count: people.length });
	// The download queue's counts, for the QUEUE cell and DOWNLOADS (doc/DOWNLOADING.md).
	const queue = await queueSummary(reveal);
	// Imports chapters as Suwayomi finishes them, and feeds the screens' live updates.
	ensureWatcher();
	// tsundoku's own downloader, with DOWNLOADS_BACKEND=engine (doc/DOWNLOADER.md).
	ensureEngineWorker();
	return { reveal, incognito: isIncognito(cookies), theme, scan, shelves, people, queue };
};

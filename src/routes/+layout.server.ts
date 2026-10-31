import type { LayoutServerLoad } from './$types';
import { currentScan, listShelves } from '$lib/server/library';
import { isIncognito, isRevealed, themeOf } from '$lib/server/prefs';
import { favouritePeople } from '$lib/server/people';
import { queueSummary } from '$lib/server/downloads';
import { ensureWatcher } from '$lib/server/downloads-watch';
import { downloadsBackend, ensureEngineWorker } from '$lib/server/engine/run';
import { browseList } from '$lib/server/engine/browse';
import { checkIfStale, updateView } from '$lib/server/updates';
import { startNow } from '$lib/server/start';

export const load: LayoutServerLoad = async ({ cookies, locals, depends }) => {
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
			queue: null,
			browse: null,
			update: null,
			updateOffer: null,
			start: null
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
	// Feeds the screens' live updates of the queue.
	ensureWatcher();
	// tsundoku's own downloader and FOLLOW's step (doc/DOWNLOADER.md).
	ensureEngineWorker();
	// BROWSE's way in, and its EXTENSIONS count (doc/BROWSE.md): on the engine only.
	const browse = downloadsBackend() === 'engine' ? { updates: browseList(reveal).updates } : null;
	// A new version, on a friend's install (doc/UPDATES.md): looked for once a
	// day, never waited on here; the library says so once (its band).
	checkIfStale();
	const view = updateView();
	const update = view?.available ? { version: view.available.version } : null;
	// The update modal on entry (doc/UPDATES.md, "Told on entry"; card c208): the
	// whole view, but only on the computer itself. A phone over Wi-Fi gets the
	// band, never the modal: the computer updates, not the phone.
	const updateOffer = view?.available && locals.via !== 'lan' ? view : null;
	// GET STARTED (doc/ONBOARDING.md): the sidebar's row and the way back read it.
	depends('tsundoku:start');
	const start = startNow(reveal);
	return {
		reveal,
		incognito: isIncognito(cookies),
		theme,
		scan,
		shelves,
		people,
		queue,
		browse,
		update,
		updateOffer,
		start
	};
};

import { hostname } from 'node:os';
import type { LayoutServerLoad } from './$types';
import { currentScan, lastScanTook, listShelves } from '$lib/server/library';
import { isIncognito, isRevealed, themeOf } from '$lib/server/prefs';
import { favouritePeople } from '$lib/server/people';
import { queueSummary } from '$lib/server/downloads';
import { ensureWatcher } from '$lib/server/downloads-watch';
import { downloadsBackend, ensureEngineWorker } from '$lib/server/engine/run';
import { browseList } from '$lib/server/engine/browse';
import { checkIfStale, updateView } from '$lib/server/updates';
import { startNow } from '$lib/server/start';
import { chosenLocale, LANG_COOKIE, type LangChoice } from '$lib/i18n/locale';
import { m } from '$lib/paraglide/messages';
import { linkQueueCount } from '$lib/server/catalogue';
import { ranobeQueueCount } from '$lib/server/ranobe-review';
import { isTsundokuApp } from '$lib/settings/catalog';
import { scanWaitsLine } from '$lib/server/import';

export const load: LayoutServerLoad = async ({ cookies, locals, depends, request }) => {
	const reveal = isRevealed(cookies);
	const theme = themeOf(cookies);
	// The device's choice of language, mirrored like the theme (doc/I18N.md).
	const lang: LangChoice = chosenLocale(cookies.get(LANG_COOKIE)) ?? 'auto';
	if (!locals.authed)
		return {
			reveal: false,
			incognito: false,
			theme,
			lang,
			shelves: [],
			scan: null,
			people: [],
			queue: null,
			browse: null,
			update: null,
			updateOffer: null,
			start: null,
			toLink: 0,
			lastScanMs: null,
			computer: null,
			scanWaits: null
		};
	depends('tsundoku:scan');
	const scan = currentScan();
	const shelves = listShelves({ reveal, withNew: scan !== null });
	// Favourite people become a shelf of their own (Index Books). It only
	// exists while one of them has a visible book.
	const people = favouritePeople(reveal);
	if (people.length > 0)
		shelves.push({
			key: 'people',
			name: m.nav_shelf_people(),
			kind: 'smart',
			count: people.length
		});
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
	// SERIES TO LINK (c475; doc/LINKS.md's review): the sidebar's and MORE's
	// way into /links, so putting the library's band away never hides it.
	// The library's own sum, so the row and the band never disagree; about a
	// millisecond on the seed, both catalogues and either reveal (wave 21).
	const toLink = linkQueueCount(reveal) + ranobeQueueCount();
	// The app's name for this computer (c261): what /pair/tv calls it, said
	// to the app's bridge by the layout so a server paired before the list
	// existed gets its name too. Only the app is told, on a TV or a phone
	// (c521); it is the only reader.
	const computer = isTsundokuApp(request.headers.get('user-agent') ?? '')
		? (hostname() || 'computer').toUpperCase()
		: null;
	return {
		reveal,
		incognito: isIncognito(cookies),
		theme,
		lang,
		scan,
		shelves,
		people,
		queue,
		browse,
		update,
		updateOffer,
		start,
		toLink,
		// RESCAN's question says roughly how long the last scan took (c525).
		lastScanMs: lastScanTook(),
		computer,
		// RESCAN's WAITING note (c512): drawn while a scan someone asked for is
		// queued behind a backup's import (`scanQueued`, the server's own queue),
		// never for a backup's import alone, and gone once the scan starts
		// instead of staying until the next press. The sidebar re-asks this
		// load alone ('tsundoku:scan') while it is set.
		scanWaits: scanWaitsLine()
	};
};

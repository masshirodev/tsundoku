// Which download a visitor sees first (doc/WEBSITE.md, "The visitor's system").
// Plain JavaScript with no imports: the build inlines it into site.js for the
// browser, and site/test/order.test.ts imports it as a module. One copy of the
// rules, so the page and the tests can't disagree about them.

/** The three desktop rows of 04 — DOWNLOAD, in the order the HTML is built in. */
export const STATIC_ORDER = ['windows', 'linux', 'mac'];

/**
 * The visitor's system, from what the browser says. `userAgentData.platform`
 * where Chromium offers it, else the user agent. Android reports Linux in its
 * user agent, so phones are checked first: a phone is never told to download a
 * Linux tarball.
 *
 * Android also runs on televisions, and a TV must not be offered the phone's
 * APK first. There is no dependable "is this a TV" bit; these are the names
 * TV browsers use. A tablet without one stays `phone`, which is right: the
 * phone app is the tablet's too.
 *
 * @param {{ userAgentData?: { platform?: string, mobile?: boolean }, userAgent?: string } | undefined} nav
 * @returns {'windows' | 'linux' | 'mac' | 'phone' | 'tv' | 'none'}
 */
export function detectOS(nav) {
	if (!nav) return 'none';
	const platform = (nav.userAgentData && nav.userAgentData.platform) || '';
	const ua = nav.userAgent || '';
	const text = `${platform} ${ua}`;
	const mobile = !!(nav.userAgentData && nav.userAgentData.mobile);
	if (mobile || /Android|iPhone|iPad|iPod/i.test(text)) {
		if (!mobile && /Android TV|Google ?TV|Fire TV|AFT[A-Z0-9]|\bTV\b|BRAVIA|SHIELD/i.test(text))
			return 'tv';
		return 'phone';
	}
	// iPadOS asks for desktop pages and reports itself as a Mac; a touch screen
	// is what gives it away, and the caller checks that (site.js).
	if (/Win/i.test(text)) return 'windows';
	if (/Mac/i.test(text)) return 'mac';
	if (/Linux|X11|CrOS/i.test(text)) return 'linux';
	return 'none';
}

/**
 * What the page does for a visitor on `os`: the order of the download rows,
 * which one is tagged YOUR SYSTEM, whose main button takes the accent, the
 * hero button's label, the line under it, and whether the phone band shows.
 * The `none` case is the HTML as built, with JavaScript off.
 *
 * `apps` says which Android rows the release carries, because a row that does
 * not exist cannot lead and cannot be tagged. A release without them (every
 * one before c614) orders and accents exactly as it did.
 *
 * @param {'windows' | 'linux' | 'mac' | 'phone' | 'tv' | 'none'} os
 * @param {string} version
 * @param {{ app?: boolean, tv?: boolean }} [apps]
 */
export function plan(os, version, apps) {
	const a = apps || {};
	// The app this visitor could install comes first: a phone sees the phone
	// app, a TV the TV app. A desktop visitor sees them in the published order,
	// after the three rows it already knows.
	const appRows = [];
	if (os === 'tv') {
		if (a.tv) appRows.push('android-tv');
		if (a.app) appRows.push('android');
	} else {
		if (a.app) appRows.push('android');
		if (a.tv) appRows.push('android-tv');
	}
	const desktop =
		os === 'linux'
			? ['linux', 'windows', 'mac']
			: os === 'mac'
				? ['mac', 'windows', 'linux']
				: STATIC_ORDER.slice();
	// A phone or a TV leads with the app it can install; a desktop visitor gets
	// the app rows after the three it already knows. A release with no app has
	// appRows empty and falls back to the desktop order untouched.
	const order = os === 'phone' || os === 'tv' ? [...appRows, ...desktop] : [...desktop, ...appRows];
	const mine =
		os === 'windows' || os === 'linux' || os === 'mac'
			? os
			: os === 'phone' && a.app
				? 'android'
				: os === 'tv' && a.tv
					? 'android-tv'
					: null;
	// macOS: nothing in the block is theirs to install, so no accent anywhere.
	// A phone or TV with no app of its own accents the desktop row, as before.
	const accent = os === 'mac' ? null : mine || desktop[0];
	const hero =
		os === 'windows'
			? '↓ DOWNLOAD FOR WINDOWS'
			: os === 'linux'
				? '↓ DOWNLOAD FOR LINUX'
				: '↓ DOWNLOAD';
	const meta =
		os === 'mac'
			? 'WINDOWS AND LINUX · NOT YET FOR MACOS'
			: os === 'phone'
				? 'FOR A COMPUTER · WINDOWS AND LINUX'
				: os === 'tv'
					? a.tv
						? 'ANDROID TV · THE APP'
						: 'FOR A COMPUTER · WINDOWS AND LINUX'
					: `VERSION ${version} · WINDOWS AND LINUX · FREE`;
	return { order, mine, accent, hero, meta, phoneBand: os === 'phone' };
}

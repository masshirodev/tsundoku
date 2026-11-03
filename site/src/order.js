// Which download a visitor sees first (doc/WEBSITE.md, "The visitor's system").
// Plain JavaScript with no imports: the build inlines it into site.js for the
// browser, and site/test/order.test.ts imports it as a module. One copy of the
// rules, so the page and the tests can't disagree about them.

/** The three rows of 04 — DOWNLOAD, in the order the HTML is built in. */
export const STATIC_ORDER = ['windows', 'linux', 'mac'];

/**
 * The visitor's system, from what the browser says. `userAgentData.platform`
 * where Chromium offers it, else the user agent. Android reports Linux in its
 * user agent, so phones are checked first: a phone is never told to download a
 * Linux tarball.
 *
 * @param {{ userAgentData?: { platform?: string, mobile?: boolean }, userAgent?: string } | undefined} nav
 * @returns {'windows' | 'linux' | 'mac' | 'phone' | 'none'}
 */
export function detectOS(nav) {
	if (!nav) return 'none';
	const platform = (nav.userAgentData && nav.userAgentData.platform) || '';
	const ua = nav.userAgent || '';
	const text = `${platform} ${ua}`;
	if ((nav.userAgentData && nav.userAgentData.mobile) || /Android|iPhone|iPad|iPod/i.test(text))
		return 'phone';
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
 * @param {'windows' | 'linux' | 'mac' | 'phone' | 'none'} os
 * @param {string} version
 */
export function plan(os, version) {
	const order =
		os === 'linux'
			? ['linux', 'windows', 'mac']
			: os === 'mac'
				? ['mac', 'windows', 'linux']
				: STATIC_ORDER.slice();
	const mine = os === 'windows' || os === 'linux' || os === 'mac' ? os : null;
	// macOS: nothing in the block is theirs to install, so no accent anywhere.
	const accent = os === 'mac' ? null : order[0];
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
				: `VERSION ${version} · WINDOWS AND LINUX · FREE`;
	return { order, mine, accent, hero, meta, phoneBand: os === 'phone' };
}

/**
 * Keeping the web edition's library (doc/WEB-EDITION.md, "Keeping the
 * library"). The library lives in the browser's own storage, which a browser
 * may clear under disk pressure unless the site has asked it not to
 * (`navigator.storage.persist()`). Chrome and Edge decide silently; Firefox
 * asks the visitor. The answer is the browser's to give, so this only reads
 * it, asks, and says what is true.
 *
 * Asked after the first series is added, never on arrival (the owner's choice,
 * 2026-11-25, from the handoff `web-edition-start`); SETTINGS can ask again.
 * Whether it was ever asked is remembered here, because a browser that said
 * no and one never asked both answer `persisted() === false`.
 */

/** What SETTINGS needs to know about the library's storage. */
export type KeepState = {
	/** The browser has agreed not to clear the site's storage by itself. */
	persisted: boolean;
	/** This browser was asked, here or earlier: a `false` above is then its answer. */
	asked: boolean;
	/** Its name, for "FIREFOX SAID NO"; null when unknown. */
	browser: string | null;
};

/** The browser's name as the screens say it, from its user agent. Edge first: it names Chrome too. */
export function browserName(userAgent: string): string | null {
	if (/\bEdg\//.test(userAgent)) return 'EDGE';
	if (/\bFirefox\//.test(userAgent)) return 'FIREFOX';
	if (/\bChrome\//.test(userAgent)) return 'CHROME';
	if (/\bSafari\//.test(userAgent)) return 'SAFARI';
	return null;
}

/** What SETTINGS says (handoff `web-edition-start`, `Keep-Refused`). */
export type KeepLines = {
	/** The standing band over SETTINGS, or none. */
	band: { title: string; detail: string } | null;
	kept: { name: string; meta: string; ask: string | null };
	cleared: { name: string; meta: string };
};

/**
 * @param device how SETTINGS names this device, `THIS TABLET`
 */
export function keepLines(s: KeepState, device: string): KeepLines {
	const where = `In this browser, on ${device.toLowerCase()}`;
	const who = s.browser ?? 'THE BROWSER';
	const noCopy = 'NOTHING IS UPLOADED · NO OTHER COPY';
	if (s.persisted)
		return {
			band: null,
			kept: { name: where, meta: `KEPT · ${who} WON'T CLEAR IT BY ITSELF`, ask: null },
			cleared: { name: 'Only you, by clearing this site’s data', meta: noCopy }
		};
	const cleared = {
		name: 'The browser, when the disk fills, or when its site data is cleared',
		meta: noCopy
	};
	if (!s.asked)
		return {
			band: null,
			kept: { name: where, meta: 'NOT KEPT FOR SURE · NOT ASKED YET', ask: 'ASK' },
			cleared
		};
	return {
		band: {
			title: '○ THIS BROWSER CAN CLEAR THE LIBRARY',
			detail: `${who === 'THE BROWSER' ? 'IT' : who} WAS ASKED TO KEEP IT AND SAID NO. IT MAY CLEAR IT WHEN THE DISK FILLS, AND CLEARING SITE DATA ALWAYS DOES. UNTIL THERE ARE ACCOUNTS, THIS BROWSER HOLDS THE ONLY COPY.`
		},
		kept: { name: where, meta: `NOT KEPT FOR SURE · ${who} SAID NO`, ask: 'ASK AGAIN' },
		cleared
	};
}

/** Where "it was asked" is remembered: this browser's own storage, like the library. */
export const ASKED_KEY = 'tsundoku-keep-asked';

/** The parts of the browser this reads, so a spec can stand in for them. */
export type KeepEnv = {
	storage?: Pick<StorageManager, 'persist' | 'persisted'>;
	local: Pick<Storage, 'getItem' | 'setItem'>;
	userAgent: string;
};

const browserEnv = (): KeepEnv => ({
	storage: navigator.storage,
	local: localStorage,
	userAgent: navigator.userAgent
});

export async function readKeep(env: KeepEnv = browserEnv()): Promise<KeepState> {
	return {
		persisted: (await env.storage?.persisted?.()) ?? false,
		asked: env.local.getItem(ASKED_KEY) !== null,
		browser: browserName(env.userAgent)
	};
}

/**
 * Asks the browser to keep the library, and remembers that it asked. Firefox
 * shows its own prompt, which needs a tap to reach it: call this from one.
 */
export async function askToKeep(env: KeepEnv = browserEnv()): Promise<KeepState> {
	const granted = (await env.storage?.persist?.()) ?? false;
	env.local.setItem(ASKED_KEY, new Date().toISOString());
	return { ...(await readKeep(env)), persisted: granted };
}

/**
 * What the first ADD does about keeping the library (handoff
 * `web-edition-start`, `Keep-Ask`; c1123), once per browser:
 *
 * - `band`: Firefox asks the visitor itself, and only from a tap, so a band
 *   under ADDED offers it: KEEP THIS LIBRARY IN FIREFOX / ASK FIREFOX →.
 * - `silent`: Chrome and Edge decide without asking anyone: ask at once, and
 *   say nothing unless they say no (SETTINGS' band says that).
 * - `none`: asked already, or already kept.
 *
 * Any other browser is asked silently too: one that prompts will prompt, and
 * one that doesn't decides, as Chrome does.
 */
export function onFirstAdd(s: KeepState): 'band' | 'silent' | 'none' {
	if (s.persisted || s.asked) return 'none';
	return s.browser === 'FIREFOX' ? 'band' : 'silent';
}

/** The band's words, for the browser that asks (Keep-Ask). */
export function keepAskBand(browser: string | null): {
	title: string;
	detail: string;
	action: string;
} {
	const who = browser ?? 'THE BROWSER';
	const short = browser ? browser : 'IT';
	return {
		title: `KEEP THIS LIBRARY IN ${who}`,
		detail: `${who} ASKS ONCE · UNTIL THEN, A FULL DISK COULD CLEAR IT`,
		action: `ASK ${short} →`
	};
}

/**
 * HELP's topics (doc/HELP.md; card c208; the HELP handoff,
 * `doc/design/handoff/Help*.dc.html`): data, not prose files, because each
 * topic has a shape (an In short of three lines, numbered parts, a ruled table
 * where a part explains a screen's words), and a "?" opens the same In short
 * in a sheet: one source for both, so the sheet and the page can't drift.
 *
 * Series kept private, and the way to show them, are never mentioned here
 * (the owner's rule), and a test holds it (tests/help-domain.spec.ts). The
 * words are written for friends, not the owner.
 */

export type HelpPart = {
	/** The anchor a "?" opens the page at. */
	id: string;
	title: string;
	link?: { label: string; href: string };
	/** The label's right side when it isn't a link. */
	right?: string;
	paras?: string[];
	/** A ruled table: a screen's word, then what it does. */
	table?: [string, string][];
};

export type HelpTopic = {
	slug: string;
	n: string;
	title: string;
	/** What the index row and the topic's head name: its parts. */
	meta: string;
	/** IN SHORT: three lines at most, a sentence each. */
	short: string[];
	parts: HelpPart[];
};

/** What an install is, for a topic that can't apply on it (board 1E). */
export type HelpPlace = { updater: boolean; overWifi: boolean };

export const TOPICS: HelpTopic[] = [
	{
		slug: 'start',
		n: '01',
		title: 'Getting started',
		meta: 'THE CHECKLIST',
		short: [
			'Four things to set up, in any order: a repository, an extension, your own files, your phone.',
			'Each one ticks itself when it is done; SKIP any of them.',
			'The list stays on the empty library, and here, until every step is done or skipped.'
		],
		parts: []
	},
	{
		slug: 'reading',
		n: '02',
		title: 'Reading',
		meta: 'TAP, SWIPE, KEYS · THE STRIP · FULL SCREEN · ZOOM',
		short: [
			'Tap an edge or swipe to turn. In R→L, the left edge goes forward.',
			'A tap in the middle shows the controls; a double tap zooms.',
			"SETTINGS ↑ in the controls opens the reading settings. FULL SCREEN hides the browser's bars."
		],
		parts: [
			{
				id: 'turning',
				title: 'TURNING PAGES',
				table: [
					['EDGES', 'A tap on the left or right edge turns the page, the way the book reads.'],
					['SWIPE', 'Drag the page sideways to turn it; let go early and it stays.'],
					['MIDDLE', 'Shows the controls at the top and bottom. Tap again and they go.'],
					[
						'KEYS',
						'On a computer: ← and → turn, ↑ and ↓ move a screen in the strip, Ctrl with ↑ or ↓ nudges a little.'
					]
				]
			},
			{
				id: 'strip',
				title: 'THE STRIP, FOR MANHWA',
				link: { label: 'SETTINGS →', href: '/settings?section=reading' },
				paras: [
					'Manhwa read as one long strip: scroll, and the next chapter follows on. A mouse wheel and the arrow keys glide rather than jump.',
					"In SETTINGS › 01 — READING · IMAGES, CHAPTERS can STOP AT THE END instead, with a button to go on, and TO THE TOP adds a button back to the chapter's first page."
				]
			},
			{
				id: 'screen',
				title: 'FULL SCREEN AND ZOOM',
				paras: [
					"FULL SCREEN, in the controls, hides the browser's bars on Android and computers; an iPhone's browser doesn't allow it.",
					'A double tap zooms into a page, and pinching zooms too; a zoomed page pans under your finger and turns from its edges.'
				]
			}
		]
	},
	{
		slug: 'downloading',
		n: '03',
		title: 'Finding and downloading',
		meta: 'BROWSE · EXTENSIONS · ADD · DOWNLOAD · FOLLOW · QUEUE',
		short: [
			'Extensions add sources, and come from a repository: ask whoever gave you tsundoku for one.',
			'BROWSE searches those sources. A series opens there and reads online, without being added.',
			'+ ADD puts it in your library. Its DOWNLOAD row downloads it, and FOLLOW keeps up.'
		],
		parts: [
			{
				id: 'extensions',
				title: 'EXTENSIONS AND REPOSITORIES',
				link: { label: 'EXTENSIONS →', href: '/browse/extensions?tab=repos' },
				paras: [
					"Sources come from extensions, and extensions come from repositories. tsundoku ships none. Ask whoever gave you tsundoku for a repository's address, or search for one: Mihon, Aniyomi and LNReader repositories all work.",
					'Paste the address in EXTENSIONS › REPOSITORIES. It says what the repository holds before anything is installed; then pick the sources you read from in AVAILABLE.'
				]
			},
			{
				id: 'online',
				title: 'READING ONLINE',
				link: { label: 'BROWSE →', href: '/browse' },
				paras: [
					'Open a series from BROWSE and read: each chapter comes from the source as you turn. Nothing is kept, and HISTORY remembers where you stopped. + ADD adds it whenever you decide.'
				]
			},
			{
				id: 'download',
				title: 'ADD, DOWNLOAD, FOLLOW',
				right: "A SERIES' DOWNLOAD ROW",
				table: [
					['+ ADD', 'Puts the series in your library, its chapters listed. No files yet.'],
					['FIRST 10', "Downloads the next ten you haven't read. After that it says NEXT 10."],
					[
						'ALL',
						"Every chapter you haven't read. It asks first, and says how much room it takes."
					],
					['FOLLOW', 'New chapters download by themselves when the source publishes them.']
				],
				paras: [
					"A series you haven't added has the DOWNLOAD row too: it asks first, since downloading adds it to your library."
				]
			},
			{
				id: 'queue',
				title: 'THE QUEUE',
				link: { label: 'DOWNLOADS →', href: '/downloads' },
				paras: [
					"Downloads run on the computer tsundoku runs on, in the order you asked. DOWNLOADS shows what's under way and what failed, with RETRY. A chapter that's in reads while the rest wait."
				]
			}
		]
	},
	{
		slug: 'phone',
		n: '04',
		title: 'Your phone',
		meta: 'WI-FI WITH A CODE · TAILSCALE',
		short: [
			"At home: WI-FI › ON on the computer, then scan its code with the phone's camera.",
			"Over Wi-Fi the phone reads, browses and downloads, but can't keep chapters offline.",
			'For everything, anywhere: Tailscale, on the computer and the phone.'
		],
		parts: [
			{
				id: 'wifi',
				title: 'WI-FI WITH A CODE',
				link: { label: 'SETTINGS →', href: '/settings#s-devices' },
				paras: [
					"On the computer, SETTINGS › 08 — DEVICES › WI-FI › ON shows a code. Scan it with the phone's camera, on the same Wi-Fi, and the phone opens tsundoku signed in. A code works once, for ten minutes; NEW CODE makes another.",
					"Typing the address works too, with your password. Switch WI-FI off on a café's or a dorm's network: anyone on the same Wi-Fi reaches the sign-in page."
				],
				table: [
					['WORKS', 'Reading, browsing, searching, downloading, every setting.'],
					[
						"DOESN'T",
						'Keeping chapters offline, installing tsundoku as an app, keeping the screen awake.'
					]
				]
			},
			{
				id: 'tailscale',
				title: 'TAILSCALE, FOR EVERYTHING',
				paras: [
					'Tailscale is a free private network between your own devices. Over it the phone gets everything, offline chapters included, from anywhere. tsundoku needs a password first (SETTINGS › 08 — DEVICES).'
				],
				table: [
					['1', 'Install Tailscale on this computer and the phone, signed in to the same account.'],
					[
						'2',
						"In Tailscale's admin console, on the DNS page, turn on MagicDNS and HTTPS Certificates."
					],
					['3', 'Add the line TSUNDOKU_SERVE=https to the .env in your data folder.'],
					['4', 'Start tsundoku again and open the address its window prints, on the phone too.']
				]
			}
		]
	},
	{
		slug: 'updates',
		n: '05',
		title: 'Updates',
		meta: 'HOW A NEW VERSION ARRIVES · THE LIBRARY STAYS',
		short: [
			'When a new version is out, tsundoku says so when you open it, and in SETTINGS › 08 — DEVICES › UPDATES.',
			'UPDATE installs it: tsundoku closes for a minute and opens again.',
			'Your library, your settings and your password stay as they are.'
		],
		parts: [
			{
				id: 'shows',
				title: 'WHERE IT SHOWS',
				link: { label: 'SETTINGS →', href: '/settings#s-devices' },
				paras: [
					"tsundoku asks its releases for a new version once a day. When there is one, the library opens with what's new, UPDATE and LATER; LATER asks again the next day. The UPDATES row keeps it, with CHECK to ask now."
				]
			},
			{
				id: 'unzipped',
				title: 'UNZIPPED, NOT INSTALLED',
				paras: [
					"Where UPDATE isn't offered (Linux, or Windows from the zip), DOWNLOAD fetches the new version. Unpack it beside this one and start tsundoku from the new folder; delete the old folder once the new one runs."
				]
			}
		]
	},
	{
		slug: 'backups',
		n: '06',
		title: 'Backups and importing',
		meta: 'A MIHON BACKUP · THE LIBRARY FOLDER',
		short: [
			'Your own files go in the library folder: a Mihon backup under Mihon/autobackup, EPUBs anywhere.',
			'RESCAN reads the folder again; new series appear as they are found.',
			'Your library and its reading are kept in the data folder, beside tsundoku.'
		],
		parts: [
			{
				id: 'folder',
				title: 'THE LIBRARY FOLDER',
				link: { label: 'GET STARTED →', href: '/start' },
				table: [
					['MIHON', 'A backup (.tachibk) under Mihon/autobackup, with its downloads beside it.'],
					['EPUB', 'Novels, anywhere in the folder.'],
					['NOT YET', 'Aniyomi and LNReader backups.']
				],
				paras: [
					'START SCAN on the empty library, or RESCAN in the sidebar (MORE on a phone), reads the folder again.'
				]
			}
		]
	},
	{
		slug: 'report',
		n: '07',
		title: 'When something breaks',
		meta: "SAVE A REPORT · WHAT'S IN IT · WHO GETS IT",
		short: [
			'SETTINGS › 05 — LIBRARY › REPORT › SAVE writes one text file about what went wrong.',
			'It never holds your password or tokens, and your folders are written as <data> and <user>.',
			'Nothing is sent by itself: send the file to whoever gave you tsundoku.'
		],
		parts: [
			{
				id: 'save',
				title: 'SAVE A REPORT',
				link: { label: 'SETTINGS →', href: '/settings?section=library' },
				paras: [
					"The report holds the version, the system, whether Wi-Fi and updates are on, whether the engine answers, and the last lines of tsundoku's logs. Read it before you send it, if you like: it's plain text."
				]
			}
		]
	}
];

export const topicBySlug = (slug: string) => TOPICS.find((t) => t.slug === slug) ?? null;

/** The topic before and after, for ← and → at a topic's end. */
export function neighbours(slug: string): { prev: HelpTopic | null; next: HelpTopic | null } {
	const i = TOPICS.findIndex((t) => t.slug === slug);
	return { prev: i > 0 ? TOPICS[i - 1] : null, next: i >= 0 ? (TOPICS[i + 1] ?? null) : null };
}

/** A topic that can't apply on this install: its band, or null (board 1E). The topic still opens. */
export function notHere(slug: string, at: HelpPlace): { a: string; b: string } | null {
	if (slug === 'updates' && !at.updater)
		return {
			a: 'NOT ON THIS INSTALL · IT HAS NO UPDATER',
			b: "THIS ONE IS UPDATED WHERE IT'S BUILT · BELOW IS HOW AN INSTALL FROM TSUNDOKU'S RELEASES GETS ONE"
		};
	if (slug === 'phone' && at.overWifi)
		return {
			a: 'ALREADY IN OVER WI-FI',
			b: 'THIS PHONE CAME IN WITH A CODE · BELOW IS THE WAY, AND TAILSCALE FOR EVERYTHING'
		};
	return null;
}

/** A "?"'s sheet: the topic's In short, and where WHOLE TOPIC → lands. */
export function ask(
	slug: string,
	part?: string
): {
	topic: HelpTopic;
	part: HelpPart | null;
	href: string;
	at: string;
} {
	const topic = topicBySlug(slug)!;
	const p = part ? (topic.parts.find((x) => x.id === part) ?? null) : null;
	const i = p ? topic.parts.indexOf(p) : -1;
	return {
		topic,
		part: p,
		href: `/help/${topic.slug}${p ? `#${p.id}` : ''}`,
		at: p
			? `OPENS AT ${String(i + 1).padStart(2, '0')} — ${p.title}`
			: `OPENS ${topic.n} — ${topic.title.toUpperCase()}`
	};
}

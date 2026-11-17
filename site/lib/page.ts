// The page itself, as one static HTML document. Where it departs from the
// design, doc/WEBSITE.md says why. Every value that comes from outside this
// file goes through esc().

import { plan } from '../src/order.js';
import { appsOf, chromeDate, DL, esc, megabytes, type Release } from './data.ts';

/** One captured figure: a file per palette (the reader is dark only). */
export type Capture = { file: string; width: number; height: number };
export type Figure = { dark: Capture; light?: Capture };
export type Captures = Record<FigureId, Figure>;
export type FigureId =
	| 'library-desktop'
	| 'series-tablet'
	| 'library-phone'
	| 'reader-phone'
	| 'strip-phone'
	| 'history-phone';

export type PageInput = {
	release: Release;
	solver: { windows: { name: string; size: number }; linux: { name: string; size: number } };
	captures: Captures;
	/** The footer's and IF SOMETHING GOES WRONG's help line (doc/WEBSITE.md). */
	help: string;
	/** Fingerprints for the CSS and script names, so a deploy is never half-cached. */
	assets: { css: string; js: string; favicon: string; touchIcon: string };
	fonts: string;
};

/** The help line until one is set: README.txt's own answer. */
export const DEFAULT_HELP = 'Ask whoever gave you tsundoku.';

const img = (c: Capture, alt: string, cls: string, eager: boolean) =>
	`<img class="${cls}" src="captures/${esc(c.file)}" width="${c.width}" height="${c.height}" alt="${esc(alt)}"${eager ? ' fetchpriority="high"' : ' loading="lazy"'} decoding="async">`;

/** A figure's picture: both palettes where it has both, CSS showing the one in force. */
function picture(f: Figure, alt: string, eager = false): string {
	if (!f.light) return img(f.dark, alt, 'cap', eager);
	return img(f.dark, alt, 'cap cap-dark', eager) + img(f.light, alt, 'cap cap-light', eager);
}

const wordmark = (tag: 'span' | 'a', attrs = '') =>
	`<${tag} class="wordmark"${attrs}><span class="wm-latin">TSUNDOKU</span><span class="wm-ja" lang="ja">積ん読</span></${tag}>`;

const head = (left: string, right: string) =>
	`<div class="sec-head"><span>${left}</span><span>${right}</span></div>`;

const FEATURES: [string, string][] = [
	[
		'IMPORT',
		'Bring your Mihon backup: series, chapters, read state and history come with it. Or put your Mihon downloads and EPUBs in the library folder.'
	],
	[
		'READ',
		'Pages right to left, left to right, or one long strip for manhwa. Novels get a text reader of their own, vertical Japanese included.'
	],
	[
		'DOWNLOAD',
		'Browse sources and download through extensions from Mihon, Aniyomi and LNReader repositories. tsundoku names none: you add the repository.'
	],
	[
		'WATCH',
		'Anime beside what you read: episodes streamed or downloaded, openings and endings skipped.'
	],
	[
		'PROGRESS',
		'Where you stopped, on every device you read on. History by day, ratings out of 10, favourites.'
	],
	[
		'PHONE',
		'Read on a phone or tablet over home Wi-Fi, or anywhere over Tailscale, which also keeps chapters on the phone for offline.'
	],
	[
		'STAYS HOME',
		'Your library stays on your computer. tsundoku asks dl.tsundoku.masshiro.pro once a day whether there’s a new version, and sends nothing else.'
	]
];

const btn = (href: string, label: string, size: number, main: boolean, os: string) =>
	`<a class="btn${main ? ' btn-main' : ''}" data-main="${main ? os : ''}" href="${esc(href)}" download>${label}<span class="btn-size">${esc(megabytes(size))}</span></a>`;

/**
 * The two Android rows, only for a release whose manifest carries
 * them. They use the desktop rows' own name/body/note markup, so
 * 04 keeps its shape. Size and SHA-256 are the manifest's, never typed: the
 * hash is what a friend checks a sideloaded APK against.
 */
function androidRows(r: Release): Record<string, string> {
	const rows: Record<string, string> = {};
	const app = r.android?.app;
	if (app)
		rows.android = `<div class="dl-row" data-os="android">
<div class="dl-name"><div class="dl-name-top"><span class="dl-os">ANDROID</span><span class="tag" hidden>YOUR SYSTEM</span></div><span class="dl-req">PHONE OR TABLET · .APK</span></div>
<div class="dl-body">
<div class="btns">${btn(app.href, '↓ ANDROID APP · .APK', app.size, true, 'android')}</div>
<p class="dl-note">tsundoku’s own app for a phone or tablet. It pairs with tsundoku on your computer, so the computer has to be running to read.</p>
<p class="dl-note">To install: open the APK on the phone. Android asks once to allow installs from your browser; allow it, then install.</p>
<p class="dl-warn">SHA-256 ${esc(app.sha256)}</p>
</div>
</div>`;
	const tv = r.android?.tv;
	if (tv)
		rows['android-tv'] = `<div class="dl-row" data-os="android-tv">
<div class="dl-name"><div class="dl-name-top"><span class="dl-os">ANDROID TV</span><span class="tag" hidden>YOUR SYSTEM</span></div><span class="dl-req">TELEVISION · .APK</span></div>
<div class="dl-body">
<div class="btns">${btn(tv.href, '↓ TV APP · .APK', tv.size, true, 'android-tv')}</div>
<p class="dl-note">tsundoku’s app for an Android TV. It pairs with tsundoku on your computer, so the computer has to be running to watch.</p>
<p class="dl-note">To install: copy the APK to a USB stick and open it with the TV’s file manager, or use a downloader app. The TV asks once to allow installs from it.</p>
<p class="dl-warn">SHA-256 ${esc(tv.sha256)}</p>
</div>
</div>`;
	return rows;
}

function downloadRows(input: PageInput): string {
	const r = input.release;
	const p = plan('none', r.version, appsOf(r));
	const rows: Record<string, string> = {
		windows: `<div class="dl-row" data-os="windows">
<div class="dl-name"><div class="dl-name-top"><span class="dl-os">WINDOWS</span><span class="tag" hidden>YOUR SYSTEM</span></div><span class="dl-req">10 OR 11 · 64-BIT</span></div>
<div class="dl-body">
<div class="btns">${btn(r.installer.href, '↓ INSTALLER · .EXE', r.installer.size, true, 'windows')}${btn(r.zip.href, '↓ ZIP', r.zip.size, false, 'windows')}</div>
<p class="dl-note">The installer puts tsundoku in your user folder without asking for an administrator, and can start it when you sign in. The zip runs from any folder you unpack it to.</p>
<p class="dl-warn">WINDOWS MAY WARN THAT THE APP IS FROM AN UNKNOWN PUBLISHER: IT ISN’T SIGNED. CHOOSE MORE INFO, THEN RUN ANYWAY.</p>
</div>
</div>`,
		linux: `<div class="dl-row" data-os="linux">
<div class="dl-name"><div class="dl-name-top"><span class="dl-os">LINUX</span><span class="tag" hidden>YOUR SYSTEM</span></div><span class="dl-req">X86-64</span></div>
<div class="dl-body">
<div class="btns">${btn(r.archive.href, '↓ TAR.XZ', r.archive.size, true, 'linux')}</div>
<p class="dl-note">Unpack it anywhere and run ./tsundoku. Updates download the same way: start the new folder.</p>
</div>
</div>`,
		mac: `<div class="dl-row dl-off" data-os="mac">
<div class="dl-name"><div class="dl-name-top"><span class="dl-os">MACOS</span><span class="tag" hidden>YOUR SYSTEM</span></div><span class="dl-req">NOT BUILT</span></div>
<div class="dl-body">
<p class="dl-note">Not built. There is no Mac to test it on yet.</p>
</div>
</div>`
	};
	Object.assign(rows, androidRows(r));
	// The HTML as built is the no-JavaScript state: the static order, no tag,
	// the Windows installer on the accent (most friends are on Windows).
	const html = p.order.map((os) => rows[os]).join('\n');
	return html.replace(
		`class="btn btn-main" data-main="${p.accent}"`,
		`class="btn btn-main btn-accent" data-main="${p.accent}"`
	);
}

/** The band above 04's rows, for a phone visitor who has just met the page. */
function phoneBandText(r: Release): string {
	if (r.android?.app)
		return 'tsundoku runs on a computer, Windows or Linux, and the Android app is on this page. Install tsundoku on the computer first: the app pairs with it over Wi-Fi.';
	return 'tsundoku runs on a computer, Windows or Linux. Install it there, then read on this phone over Wi-Fi.';
}

/** 06's opening line, naming the app only when the release carries one. */
function phoneLead(r: Release): string {
	if (r.android?.app)
		return 'tsundoku stays on the computer; the phone opens it in its browser, or, on Android, in <a href="#download">the tsundoku app</a>, which pairs with the computer and needs it running. Two ways in.';
	return 'tsundoku stays on the computer; the phone opens it in its browser. Two ways in.';
}

function download(input: PageInput): string {
	const r = input.release;
	const s = input.solver;
	const notes = r.notes.map((l) => `<p>${esc(l)}</p>`).join('');
	return `<div class="dl">
<div class="dl-band" hidden>
<span class="dl-band-label">ON A PHONE?</span>
<span class="dl-band-text">${phoneBandText(r)}</span>
<a href="#phone">06 — ON A PHONE →</a>
</div>
<div class="dl-rows" data-version="${esc(r.version)}">
${downloadRows(input)}
</div>
<div class="dl-lower">
<div class="box box-panel">
<div class="box-head"><span>WHAT’S NEW</span><span>${esc(r.version)} · ${esc(chromeDate(r.date))}</span></div>
<div class="dl-notes">${notes}</div>
</div>
<div class="dl-more">
<a class="dl-older" href="${DL}/"><span>OLDER VERSIONS · SHA-256 CHECKSUMS</span><span class="arrow">→</span></a>
<div class="dl-solver">
<span class="dl-solver-label">OPTIONAL · SOURCES BEHIND A BROWSER CHECK</span>
<span class="dl-solver-text">Some sites show a “checking your browser” page first. Reading those needs FlareSolverr, ${s.windows.size ? `about ${esc(megabytes(s.windows.size))} ` : 'a large download '}since it carries its own Chrome. Unzip it into your data folder and start tsundoku again.</span>
<div class="btns">
<a class="btn btn-small" href="${DL}/latest/${esc(s.windows.name)}" download>↓ FLARESOLVERR · WINDOWS<span class="btn-size">${esc(megabytes(s.windows.size))}</span></a>
<a class="btn btn-small" href="${DL}/latest/${esc(s.linux.name)}" download>↓ LINUX<span class="btn-size">${esc(megabytes(s.linux.size))}</span></a>
</div>
</div>
</div>
</div>
</div>`;
}

export function renderPage(input: PageInput): string {
	const r = input.release;
	const c = input.captures;
	const p = plan('none', r.version, appsOf(r));
	const v = esc(r.version);
	const help = esc(input.help);
	return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>tsundoku · 積ん読</title>
<meta name="description" content="One library for everything you read: manga, manhwa, comics, light and web novels, and the episodes you watch. It runs on your own computer, and you read it in the browser.">
<meta name="color-scheme" content="dark light">
<meta name="robots" content="noindex">
<link rel="icon" href="${esc(input.assets.favicon)}" sizes="32x32">
<link rel="apple-touch-icon" href="${esc(input.assets.touchIcon)}">
${input.fonts}
<link rel="stylesheet" href="${esc(input.assets.css)}">
<script src="${esc(input.assets.js)}"></script>
</head>
<body>
<header class="bar">
${wordmark('a', ' href="#what" aria-label="tsundoku, top of the page"')}
<nav class="bar-nav" aria-label="Sections">
<a href="#what">01 WHAT</a><a href="#look">02 LOOK</a><a href="#does">03 DOES</a><a href="#download">04 DOWNLOAD</a><a href="#start">05 START</a><a href="#phone">06 PHONE</a>
</nav>
<span class="bar-fill"></span>
<button type="button" class="bar-theme" hidden aria-label="Switch theme">/LIGHT</button>
<a class="bar-download" href="#download">DOWNLOAD ↓</a>
</header>
<main>
<section id="what" class="sec sec-first">
${head('01 — WHAT IT IS', v)}
<div class="hero">
<div class="hero-text">
<h1>One library for everything you read.</h1>
<p class="lead">Manga, manhwa, comics, light novels and web novels, and the episodes you watch. tsundoku runs on your own computer, and you read it in the browser: on that computer, or on a phone on the same Wi-Fi.</p>
<div class="card">
<div class="card-top"><div class="card-ja" lang="ja">積ん読</div><div class="card-word"><span>TSUNDOKU</span><span>JAPANESE · NOUN</span></div></div>
<dl class="card-defs">
<dt>1</dt><dd>Buying books and letting them pile up unread.</dd>
<dt>2</dt><dd>A library for the pile: what you’re reading, what you mean to, and what you’ve finished, in one place.</dd>
</dl>
</div>
<div class="btns hero-btns">
<a class="btn btn-hero btn-accent" id="hero-download" href="#download">${esc(p.hero)}</a>
<a class="btn btn-hero" href="#start">HOW IT STARTS →</a>
</div>
<span class="hero-meta" id="hero-meta">${esc(p.meta)}</span>
</div>
<figure class="fig fig-hero">
<div class="frame">${picture(c['library-desktop'], 'The library on a desktop: CONTINUE with two series in progress, the shelves below, the sidebar on LIBRARY.', true)}</div>
<figcaption><span>FIG. 1 — LIBRARY · DESKTOP</span><span>SAMPLE LIBRARY</span></figcaption>
</figure>
</div>
</section>

<section id="look" class="sec">
${head('02 — WHAT IT LOOKS LIKE', 'TABLET · PHONE')}
<div class="look">
<figure class="fig fig-series">
<div class="frame">${picture(c['series-tablet'], 'A series on a tablet: its cover, rating and chapters, newest first, some read.')}</div>
<figcaption>FIG. 2 — SERIES · TABLET</figcaption>
</figure>
<figure class="fig">
<div class="frame">${picture(c['library-phone'], 'The same library on a phone, three columns of covers.')}</div>
<figcaption>FIG. 3 — LIBRARY · PHONE</figcaption>
</figure>
<figure class="fig">
<div class="frame">${picture(c['reader-phone'], 'The reader on a phone, a page of a chapter with its controls showing.')}</div>
<figcaption>FIG. 4 — READER · PHONE</figcaption>
</figure>
</div>
</section>

<section id="does" class="sec">
${head('03 — WHAT IT DOES', String(FEATURES.length))}
<div class="does">
<dl class="features">
${FEATURES.map(([label, text]) => `<div class="feature"><dt>${label}</dt><dd>${text}</dd></div>`).join('\n')}
</dl>
<div class="stills">
<figure class="fig">
<div class="frame">${picture(c['strip-phone'], 'A manhwa in the long strip reader on a phone, mid-chapter.')}</div>
<figcaption>READ · VERTICAL</figcaption>
</figure>
<figure class="fig">
<div class="frame">${picture(c['history-phone'], 'HISTORY on a phone: what was read today and yesterday.')}</div>
<figcaption>PROGRESS · HISTORY</figcaption>
</figure>
</div>
</div>
</section>

<section id="download" class="sec">
${head('04 — DOWNLOAD', v)}
${download(input)}
</section>

<section id="start" class="sec">
${head('05 — STARTING IT', '4 STEPS')}
<div class="start">
<ol class="steps">
<li><div class="step-n">1</div><div class="step-body"><span class="step-title">START IT</span>
<div class="ways">
<div><span>WINDOWS, INSTALLED</span><span>Start menu › tsundoku</span></div>
<div><span>WINDOWS, ZIP</span><span>double-click tsundoku.exe</span></div>
<div><span>LINUX</span><span>./tsundoku</span></div>
</div></div></li>
<li><div class="step-n">2</div><div class="step-body"><span class="step-title">IT RUNS BY THE CLOCK</span><span class="step-text">There’s no window: tsundoku runs in the background, with its icon in the tray by the clock. Click the icon to open it; its menu has the logs and Quit tsundoku. On Windows the icon may hide behind the ^ arrow: drag it out to keep it in sight.</span></div></li>
<li><div class="step-n">3</div><div class="step-body"><span class="step-title">YOUR BROWSER OPENS</span><span class="step-text">At <code class="code-strong">http://localhost:42143</code>, once it’s ready. Use that address, localhost, not 127.0.0.1. Starting tsundoku again while it runs only opens the browser.</span></div></li>
<li><div class="step-n">4</div><div class="step-body"><span class="step-title">A PASSWORD, OR NONE</span><span class="step-text">The first time, tsundoku asks you to choose one. With none, anyone using this computer opens your library; nothing else can reach it. Set, change or remove it later in SETTINGS › DEVICES.</span></div></li>
</ol>
<figure class="fig">
<div class="setup" role="img" aria-label="Replica of the first start’s SET UP screen: choose a password, type it again, then SET PASSWORD or NO PASSWORD.">
${wordmark('span')}
<div class="setup-body">
<span class="setup-label">00 — SET UP</span>
<span class="setup-text">Choose a password for tsundoku. You’ll use it to sign in on this computer and, later, on your phone.</span>
<span class="setup-label setup-field-label">PASSWORD</span>
<div class="setup-field setup-field-on">••••••••<span class="caret"></span></div>
<span class="setup-label">AGAIN</span>
<div class="setup-field"></div>
<div class="setup-btns"><span class="setup-set">SET PASSWORD</span><span class="setup-none">NO PASSWORD</span></div>
</div>
</div>
<figcaption>THE FIRST START · ON THE COMPUTER</figcaption>
</figure>
</div>
<div class="halves">
<div class="box">
<div class="box-head">YOUR DATA</div>
<div class="box-text">Everything tsundoku keeps is in one folder, never in the program’s. Updating or uninstalling doesn’t touch it.</div>
<div class="data-row"><div>WINDOWS</div><div>%LOCALAPPDATA%\\tsundoku</div></div>
<div class="data-row"><div>LINUX</div><div>~/.local/share/tsundoku</div></div>
<div class="box-text box-text-last">Another drive: add <code>TSUNDOKU_HOME=D:\\tsundoku</code> to the .env in that folder and move the rest there.</div>
</div>
<div class="box">
<div class="box-head">IF SOMETHING GOES WRONG</div>
<div class="wrong"><span>FORGOT THE PASSWORD</span><span>Start menu › Reset tsundoku password, or ./tsundoku --reset-password on Linux. Your library isn’t touched.</span></div>
<div class="wrong"><span>IT STOPPED BY ITSELF</span><span>The icon stays, and its menu says why. Everything it wrote is in logs\\tsundoku.log in your data folder.</span></div>
<div class="wrong"><span>SOMETHING BROKE</span><span>SETTINGS › LIBRARY › REPORT › SAVE makes a file with the logs and versions, never your password or tokens.</span></div>
<div class="wrong wrong-ask"><span>ASK</span><span>${help}</span></div>
</div>
</div>
</section>

<section id="phone" class="sec">
${head('06 — ON A PHONE', 'OR A TABLET')}
<p class="phone-lead">${phoneLead(r)}</p>
<div class="halves halves-phone">
<div class="box">
<div class="box-head box-head-strong"><span>AT HOME · WI-FI</span><span>THE EASY ONE</span></div>
<ol class="msteps">
<li><div>1</div><div>On the computer: <code class="code-strong">SETTINGS › DEVICES › WI-FI › ON</code>.</div></li>
<li><div>2</div><div>The first time, Windows asks whether tsundoku may use the network: leave “Private networks” ticked and choose Allow access.</div></li>
<li><div>3</div><div>Scan the code it shows with the phone’s camera. The phone has to be on the same Wi-Fi; the code is good for 10 minutes and one phone.</div></li>
</ol>
<div class="wifi-wrap">
<div class="wifi" role="img" aria-label="Replica of the WI-FI row in SETTINGS: switched ON, with a code to scan, good for 10 minutes.">
<div class="wifi-top"><span class="wifi-label">WI-FI</span><div class="seg"><span>OFF</span><span class="seg-on">ON</span></div></div>
<div class="wifi-code"><div class="qr">CODE</div><div class="wifi-info"><span>SCAN WITH THE PHONE’S CAMERA</span><span>GOOD FOR 10 MIN</span><span>http://192.168.1.23:42143</span></div></div>
</div>
</div>
<div class="cant"><span>OVER WI-FI THE PHONE CAN’T</span><span>Keep chapters offline, install tsundoku as an app, or keep the screen awake. It reads, browses, searches and downloads. Switch Wi-Fi off on a café’s or a dorm’s network: anyone on it reaches the sign-in page.</span></div>
</div>
<div class="box">
<div class="box-head box-head-strong"><span>ANYWHERE · TAILSCALE</span><span>EVERYTHING</span></div>
<p class="box-text">Tailscale is a free private network between your own devices. Over it the phone gets everything, offline chapters included, from wherever it is.</p>
<ol class="msteps">
<li><div>1</div><div>Install <a href="https://tailscale.com">Tailscale</a> on the computer and the phone, signed in to the same account. Set a password in tsundoku first (SETTINGS › DEVICES). On Linux, run once: <code>sudo tailscale set --operator=$USER</code></div></li>
<li><div>2</div><div>In Tailscale’s admin console, on the DNS page, turn on MagicDNS and HTTPS Certificates.</div></li>
<li><div>3</div><div>Add <code>TSUNDOKU_SERVE=https</code> to the .env in your data folder.</div></li>
<li><div>4</div><div>Quit tsundoku from its icon and start it again. The icon’s menu shows the new address, like <code class="wrap">https://your-pc.your-tailnet.ts.net:8443</code>: open it on the phone, and on the computer too from then on.</div></li>
</ol>
</div>
</div>
</section>
</main>

<footer class="foot">
<div class="foot-cell foot-mark">${wordmark('span')}</div>
<div class="foot-cell"><span class="foot-head">POLYFORM NONCOMMERCIAL 1.0.0</span><span class="foot-text">Use it, change it and share it freely; don’t sell it.</span></div>
<div class="foot-cell foot-made">MADE BY MASSHIRODEV</div>
<div class="foot-cell"><span class="foot-head">HELP</span><span class="foot-text">${help}</span></div>
</footer>
</body>
</html>
`;
}

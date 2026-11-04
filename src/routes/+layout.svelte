<script lang="ts">
	import { onLocalChange, readLocal, syncDevice, writeLocal } from '$lib/settings/local';
	const THEME_KEY = 'tsundoku.theme';
	const LANG_KEY = 'tsundoku.lang';
	import { chosenLocale, LANG_COOKIE } from '$lib/i18n/locale';
	import '$lib/styles/index.css';
	import { m } from '$lib/paraglide/messages';
	import { num } from '$lib/i18n/format';
	import { enhance } from '$app/forms';
	import { page, updated } from '$app/state';
	import { resolve } from '$app/paths';
	import Banner from '$lib/components/chrome/Banner.svelte';
	import Band from '$lib/components/chrome/Band.svelte';
	import PrivacyShield from '$lib/components/chrome/PrivacyShield.svelte';
	import Wordmark from '$lib/components/chrome/Wordmark.svelte';
	import ShelfTabs from '$lib/components/controls/ShelfTabs.svelte';
	import { shelfHref, withParam } from '$lib/library/links';
	import { onMount } from 'svelte';
	import { afterNavigate, beforeNavigate, goto, invalidateAll } from '$app/navigation';
	import { installPress } from '$lib/press';
	import { screenMove, type ScreenMove } from '$lib/motion';
	import { saveFocus, restoreFocus, installFocusLayer } from '$lib/focus';
	import { noteVisit } from '$lib/back';
	import { trail } from '$lib/start-trail.svelte';
	import { waiting } from '$lib/waiting.svelte';
	import { saves } from '$lib/saves.svelte';
	import WaitingScreen from '$lib/components/waiting/WaitingScreen.svelte';
	import StalledBand from '$lib/components/waiting/StalledBand.svelte';
	import SaveBand from '$lib/components/waiting/SaveBand.svelte';
	import SeriesOutline from './series/[id]/SeriesOutline.svelte';

	let { data, children } = $props();

	// D-pad focus for the whole app (src/lib/focus, doc/FOCUS.md): one key
	// listener, arrow keys moving by geometry, sheets as scopes.
	onMount(() => installFocusLayer());

	// The TV app keeps a list of servers (c261; doc/TV-APP.md, "Servers"): a
	// server tells it its own name, the one /pair/tv says, so a TV paired
	// before the list existed is named too. Only the app's user agent is sent
	// a name, and only an app whose bridge can take it is told.
	onMount(() => {
		const bridge = (
			window as unknown as { TsundokuTV?: { named?: (origin: string, name: string) => void } }
		).TsundokuTV;
		if (data.computer && typeof bridge?.named === 'function')
			bridge.named(location.origin, data.computer);
	});

	// The scan action's refusal is drawn by the empty library only, so the
	// sidebar's RESCAN says it in its own place rather than nowhere.
	let rescanNote = $state('');

	// ---- waiting (doc/WAITING.md) -------------------------------------------------
	// The element a tap landed on, so it can hold its pressed look until the
	// next screen draws. Captured before any handler runs, so a tile's own
	// goto() finds it.
	let lastTap: { el: Element; at: number } | null = null;
	onMount(() => {
		const tap = (e: Event) => {
			const el = (e.target as Element | null)?.closest('a[href], button, [role="tab"]');
			lastTap = el ? { el, at: Date.now() } : null;
		};
		addEventListener('click', tap, true);
		return () => removeEventListener('click', tap, true);
	});

	// ---- motion (doc/MOTION.md) ----------------------------------------------------
	// Every tap is drawn, held long enough to be seen (src/lib/press.ts).
	onMount(installPress);
	// The next screen slides in from the side it lies on (src/lib/motion.ts,
	// screenMove; motion.css, "Screens"): the move is worked out as the
	// navigation starts, and drawn once the new screen is in the page.

	// ---- this device's settings, kept on the workstation too (doc/SETTINGS.md, "Devices") ----
	// Checked in on load and when the network is back. The theme and the
	// language are cookies the server reads; the device record mirrors it, and a newer one from the
	// workstation (SETTINGS changing this device from another) sets the cookie.
	onMount(() => {
		// Mirrored once it's been set: the default on a fresh browser is nothing to keep.
		const kept = readLocal<string | null>(THEME_KEY, null);
		if (kept !== data.theme && (kept !== null || data.theme !== 'dark'))
			writeLocal(THEME_KEY, data.theme);
		const keptLang = readLocal<string | null>(LANG_KEY, null);
		if (keptLang !== data.lang && (keptLang !== null || data.lang !== 'auto'))
			writeLocal(LANG_KEY, data.lang);
		const stop = onLocalChange((key) => {
			if (key === LANG_KEY) {
				// Every word on the page is the server's, so a new language is a reload (doc/I18N.md).
				const l = chosenLocale(readLocal<string>(LANG_KEY, 'auto'));
				if ((l ?? 'auto') === data.lang) return;
				const secure = location.protocol === 'https:' ? '; secure' : '';
				document.cookie = l
					? `${LANG_COOKIE}=${l}; path=/; max-age=31536000; samesite=lax${secure}`
					: `${LANG_COOKIE}=; path=/; max-age=0; samesite=lax${secure}`;
				// The workstation hears of it first: the reload's check-in must not hand the old choice back.
				void syncDevice().finally(() => location.reload());
				return;
			}
			if (key !== THEME_KEY) return;
			const t = readLocal<string>(THEME_KEY, 'dark') === 'light' ? 'light' : 'dark';
			if (t === data.theme) return;
			document.cookie = `tsundoku_theme=${t}; path=/; max-age=31536000; samesite=lax${location.protocol === 'https:' ? '; secure' : ''}`;
			document.documentElement.dataset.theme = t;
			void invalidateAll();
		});
		void syncDevice();
		const back = () => void syncDevice();
		addEventListener('online', back);
		return () => {
			stop();
			removeEventListener('online', back);
		};
	});

	// Tells the server this browser runs script, so streamed pages may stream
	// (server/prefs.ts, SCRIPT_COOKIE). Not httpOnly: script is what sets it.
	onMount(() => {
		if (!document.cookie.split('; ').includes('tsundoku_js=1'))
			document.cookie = `tsundoku_js=1; path=/; max-age=31536000; samesite=lax${location.protocol === 'https:' ? '; secure' : ''}`;
	});

	// A finger held on an image opens the browser's menu (save, share, open
	// in new tab) over the page being read. Only for touch: a mouse's right
	// click keeps its menu where the screen doesn't claim it (doc/TOUCH.md).
	onMount(() => {
		let touch = false;
		const down = (e: PointerEvent) => (touch = e.pointerType !== 'mouse');
		const menu = (e: MouseEvent) => {
			if (touch && (e.target as Element | null)?.closest('img, .page')) e.preventDefault();
		};
		addEventListener('pointerdown', down, true);
		addEventListener('contextmenu', menu);
		return () => {
			removeEventListener('pointerdown', down, true);
			removeEventListener('contextmenu', menu);
		};
	});
	// ---- a deploy reaches the installed app (doc/SERVING.md) ------------------------
	// The tablet keeps the app open for days, and an open app runs the build it
	// loaded: the server's new screens never draw, and its new data has nowhere
	// to go. So the build's version is asked every five minutes (vite.config.ts)
	// and whenever the app comes back to the front, and the first navigation
	// after a deploy loads the next screen whole, from the new build.
	onMount(() => {
		const back = () => {
			if (document.visibilityState === 'visible' && navigator.onLine) void updated.check();
		};
		document.addEventListener('visibilitychange', back);
		return () => document.removeEventListener('visibilitychange', back);
	});
	beforeNavigate((nav) => {
		// Taps and goto() only: back and forward stay as they are, or history would jump.
		if (updated.current && nav.to && (nav.type === 'link' || nav.type === 'goto')) {
			nav.cancel();
			location.href = nav.to.url.href;
		}
	});

	let navSeq = 0;
	/** Which way the screen on its way moves: its outline, if one shows first, slides in with it. */
	let arriving = $state<ScreenMove | null>(null);
	/** Which way the screen just drawn moved in; null for none. */
	let arrived = $state<ScreenMove | null>(null);
	beforeNavigate((nav) => {
		if (nav.willUnload || !nav.to) return;
		// Which thing on this screen has focus, so a back returns to it
		// (doc/FOCUS.md, "Where focus comes back"). The screen is still the
		// one being left, whatever the URL now says.
		saveFocus(nav.from?.url ?? null);
		const seq = ++navSeq;
		const from = lastTap && Date.now() - lastTap.at < 400 ? lastTap.el : null;
		lastTap = null;
		waiting.start(nav.to.url, nav.to.route.id, from);
		// Which way the next screen comes in. Its outline, if one shows first,
		// slides in at once; the screen itself once it's drawn.
		arrived = null;
		arriving = screenMove({
			type: nav.type,
			delta: nav.delta,
			from: nav.from?.route.id ?? null,
			to: nav.to.route.id,
			covered: false
		});
		// A navigation that fails or is replaced ends its wait too.
		void nav.complete.then(
			() => undefined,
			() => seq === navSeq && waiting.end()
		);
	});
	afterNavigate((navigation) => {
		// The new screen is in the page and not yet painted: it moves in now. A
		// screen whose outline already slid in only fades over it.
		if (navigation.type !== 'enter') arrived = cover !== null && arriving ? 'fade' : arriving;
		// Where this history entry is, so a back link can go back to it (src/lib/back.ts).
		noteVisit();
		// A trip back puts focus on what the screen was left from (src/lib/focus).
		if (navigation.type === 'popstate') restoreFocus(page.url.pathname, page.url.search);
		// A GET STARTED trip ends once its screen is left (src/lib/start-trail.svelte.ts).
		trail.load();
		trail.follow(page.url.pathname);
		waiting.end();
		// Something reached the workstation: a failed save tries again.
		saves.nudge();
	});

	const past = (p: 'line' | 'outline') =>
		waiting.phase === 'stalled' ||
		waiting.phase === 'outline' ||
		(p === 'line' && waiting.phase === 'line');
	/**
	 * What replaces the old screen while the next is on its way. Series and
	 * person pages open with what's known once the line shows; the library
	 * and history in outline from 1 s. Search never outlines: its last answer
	 * stays. A screen going to itself (a shelf tab on the library) outlines
	 * its own content instead.
	 */
	const cover = $derived.by((): 'series' | 'screen' | null => {
		const to = waiting.to;
		if (!past('line')) return null;
		if (to.kind === 'series') {
			if (page.route.id === '/series/[id]' && page.params.id === String(to.id)) return null;
			return waiting.preview || past('outline') ? 'series' : null;
		}
		if (to.kind === 'person') return 'screen';
		if (to.kind === 'library' && !(page.route.id === '/' && !page.url.searchParams.has('tag')))
			return past('outline') ? 'screen' : null;
		if (to.kind === 'history' && page.route.id !== '/history')
			return past('outline') ? 'screen' : null;
		return null;
	});
	const blankPreview = $derived({
		id: waiting.to.kind === 'series' ? waiting.to.id : 0,
		title: '',
		kind: 'manga',
		hue: 0,
		rating: 0 as const,
		favourite: false,
		hidden: false,
		entryCount: 0,
		readCount: 0,
		cover: null
	});
	/** ← BACK while not answering: stay here, which ends the wait. */
	function stay() {
		// eslint-disable-next-line svelte/no-navigation-without-resolve -- the current URL
		void goto(page.url.href, { replaceState: true, noScroll: true, keepFocus: true });
	}

	const activeShelf = $derived(page.url.searchParams.get('shelf') ?? (data.scan ? 'new' : 'all'));
	// The sidebar keeps plain totals: on the desktop a filtered count lives in
	// the section label (Library Filters 3j). PEOPLE comes after + NEW SHELF.
	const shelvesAbove = $derived(data.shelves.filter((s) => s.key !== 'people'));
	const shelvesBelow = $derived(data.shelves.filter((s) => s.key === 'people'));
	/** + NEW SHELF is a field in place while the URL says so, so it works without script. */
	const naming = $derived(page.url.searchParams.get('new') === 'shelf');
	const stopNaming = $derived(withParam(page.url, 'new', null));
</script>

<svelte:head>
	<meta name="theme-color" content={data.theme === 'light' ? '#f5f4ef' : '#0e0f10'} />
</svelte:head>

{#if page.route.id?.startsWith('/read')}
	<!--
		The reader is the page and nothing else (doc/READER.md): no sidebar, no
		banners, and no reveal frame either -- the owner's call, 2026-09-24: it
		crowds the page. Leaving the app still blanks it.
	-->
	{@render children()}
	<PrivacyShield armed={data.reveal || data.incognito} />
{:else}
	<div class="app" class:revealed={data.reveal}>
		{#if !['/login', '/setup', '/welcome', '/pair/tv'].includes(page.url.pathname)}
			<!--
			The desktop sidebar. Rendered on every device and shown only on a
			desktop, so the server can send it without knowing the screen.
		-->
			<aside class="sidebar" aria-label={m.nav_shelves_label()}>
				<!-- The app's name is the way home, from any screen. -->
				<a class="brand" href={resolve('/')} aria-label={m.nav_library_label()}
					><Wordmark size={17} /></a
				>
				<div class="side-label">{m.name_shelves()}</div>
				<!-- The shelves scroll in their own space, so the foot stays put and
				     nothing between them is squeezed (owner, 2026-10-31: eleven shelves
				     pressed + NEW SHELF to its text's height). -->
				<div class="shelf-scroll">
					<ShelfTabs
						vertical
						shelves={shelvesAbove}
						active={activeShelf}
						href={(k) => shelfHref(page.url, k)}
					/>
					{#if naming}
						<form class="new-shelf" method="POST" action="/?/newShelf">
							<!-- The field exists to take this one name. -->
							<!-- svelte-ignore a11y_autofocus -->
							<input
								name="name"
								aria-label={m.nav_new_shelf_label()}
								autocomplete="off"
								required
								autofocus
								onkeydown={(e) => {
									if (e.key !== 'Escape') return;
									// eslint-disable-next-line svelte/no-navigation-without-resolve -- withParam keeps the current, resolved path
									void goto(stopNaming, { noScroll: true, replaceState: true });
								}}
							/>
							<div class="new-hint">{m.nav_new_shelf_hint()}</div>
						</form>
					{:else}
						<!-- eslint-disable-next-line svelte/no-navigation-without-resolve -- withParam keeps the current, resolved path -->
						<a class="new-link" href={withParam(page.url, 'new', 'shelf')} data-sveltekit-noscroll
							>{m.nav_new_shelf()}</a
						>
					{/if}
					{#if shelvesBelow.length}
						<ShelfTabs
							vertical
							shelves={shelvesBelow}
							active={activeShelf}
							href={(k) => shelfHref(page.url, k)}
						/>
					{/if}
				</div>
				<div class="side-foot">
					{#if data.start && !data.start.finished}
						<!-- The quiet way back to GET STARTED, until every step is done or skipped (doc/ONBOARDING.md). -->
						<a
							class="with-n start"
							href={resolve('/start')}
							aria-current={page.url.pathname === '/start' ? 'page' : undefined}
							>{m.name_get_started()}<span class="n"
								>{data.start.done + data.start.skipped} / {data.start.steps.length}</span
							></a
						>
					{/if}
					{#if data.toLink > 0}
						<!-- The links review's own door (c475): the library's band can be put
						     away (c430), and nothing else opened /links. TO LINK, the review's
						     short name, not SERIES TO LINK: links-flow finds the band by those
						     words, first in the page (doc/NAVIGATION.md). -->
						<a
							class="with-n"
							href={resolve('/links')}
							aria-current={page.url.pathname.startsWith('/links') ? 'page' : undefined}
							>{m.name_to_link()}<span class="n">{num(data.toLink)}</span></a
						>
					{/if}
					<a
						href={resolve('/history')}
						aria-current={page.url.pathname === '/history' ? 'page' : undefined}
						>{m.name_history()}</a
					>
					{#if data.browse}
						<!-- BROWSE under HISTORY, counting extension updates (Index-Browse, sidebar). -->
						<a
							class="with-n"
							href={resolve('/browse')}
							aria-current={page.url.pathname.startsWith('/browse') ? 'page' : undefined}
							>{m.name_browse()}<span class="n"
								>{data.browse.updates ? `${num(data.browse.updates)} ↑` : ''}</span
							></a
						>
					{/if}
					{#if data.queue}
						<!-- DOWNLOADS under HISTORY with its count, always there (Index Downloads, sidebar). -->
						<a
							class="with-n"
							href={resolve('/downloads')}
							aria-current={page.url.pathname === '/downloads' ? 'page' : undefined}
							>{m.name_downloads()}<span class="n" class:stale={data.queue.stale}
								>{data.queue.queued ? num(data.queue.queued) : ''}</span
							></a
						>
					{/if}
					<!-- START SCAN for a library that isn't empty. A press while a
					     scan runs joins it (doc/IMPORT-MIHON.md, "Running it"); while a
					     backup's import runs it waits its turn and says so. -->
					<form
						method="POST"
						action="/?/scan"
						use:enhance={() =>
							async ({ result, update }) => {
								rescanNote =
									result.type === 'failure' || result.type === 'success'
										? String(result.data?.scanMessage ?? '')
										: '';
								if (result.type !== 'failure') await update();
							}}
					>
						<button type="submit">{m.nav_rescan()}</button>
						{#if rescanNote}<div class="rescan-note" role="status">{rescanNote}</div>{/if}
					</form>
					<!-- IMPORT LOG (c438; Import-Doors E): live, counting a running
					     import or scan in accent. -->
					<a
						class="with-n run"
						href={resolve('/import/log')}
						aria-current={page.url.pathname === '/import/log' ? 'page' : undefined}
						>{m.name_import_log()}<span class="n"
							>{data.scan && data.scan.finishedAt === null
								? `${data.scan.bytesTotal > 0 ? Math.floor((data.scan.bytesDone / data.scan.bytesTotal) * 100) : 0}%`
								: ''}</span
						></a
					>
					<a
						href={resolve('/settings')}
						aria-current={page.url.pathname === '/settings' ? 'page' : undefined}
						>{m.name_settings()}</a
					>
					<!-- HELP, last, under SETTINGS (doc/HELP.md; the HELP handoff, 1A). -->
					<a
						href={resolve('/help')}
						aria-current={page.url.pathname.startsWith('/help') ? 'page' : undefined}
						>{m.name_help()}</a
					>
				</div>
			</aside>
		{/if}

		<div class="main" data-arriving={arriving} data-arrived={arrived}>
			{#if data.reveal}
				<Banner kind="reveal" title={m.nav_reveal_title()}>
					{#snippet action()}
						<form method="POST" action="/?/command" use:enhance>
							<input type="hidden" name="command" value="hide" />
							<button type="submit">{m.nav_reveal_hide()}</button>
						</form>
					{/snippet}
				</Banner>
			{/if}
			{#if data.incognito}
				<!-- Dashed is Index's "not stored yet"; magenta stays reveal's. -->
				<Band title={m.nav_incognito_title()} dashed>
					{#snippet action()}
						<form method="POST" action="/?/command" use:enhance>
							<input type="hidden" name="command" value="incognito-end" />
							<button type="submit">{m.nav_incognito_end()}</button>
						</form>
					{/snippet}
				</Band>
			{/if}
			<StalledBand onback={stay} />
			{#if cover === 'series'}
				<SeriesOutline preview={waiting.preview ?? blankPreview} />
			{:else if cover === 'screen'}
				<WaitingScreen to={waiting.to} shelves={data.shelves} active={activeShelf} />
			{/if}
			<div class="route-view" class:covered={cover !== null}>
				{@render children()}
			</div>
		</div>

		<SaveBand />
		<PrivacyShield armed={data.reveal || data.incognito} />

		{#if data.reveal}
			<!-- The 4px magenta frame: on every screen but the reader, for as long as reveal is on. -->
			<div class="reveal-frame" aria-hidden="true"></div>
		{/if}
	</div>
{/if}

<style>
	/* The old screen stays mounted under an outline, so coming back to it loses nothing. */
	.route-view {
		display: contents;
	}
	.route-view.covered {
		display: none;
	}
	/* The tapped element holds its pressed inversion until the next screen draws. */
	:global(.nav-pressed) {
		background: var(--surface-inverse) !important;
		color: var(--text-inverse) !important;
	}
	:global(.tile:has(.nav-pressed)) {
		background: var(--surface-inverse);
		color: var(--text-inverse);
	}
	.app {
		display: flex;
		min-height: 100dvh;
	}
	/* The reveal banner's height, for screens that size themselves to the viewport. */
	.app.revealed {
		--banner-h: 52px;
	}
	.main {
		flex: 1;
		min-width: 0;
		display: flex;
		flex-direction: column;
	}
	.sidebar {
		display: none;
	}
	@media (min-width: 1024px) and (pointer: fine) {
		.sidebar {
			position: sticky;
			top: 0;
			height: 100dvh;
			width: var(--sidebar-w);
			flex-shrink: 0;
			border-right: var(--hairline);
			display: flex;
			flex-direction: column;
			overflow-y: auto;
		}
	}
	.brand {
		display: flex;
		align-items: center;
		height: 64px;
		padding: 0 24px;
		color: inherit;
		text-decoration: none;
		border-bottom: var(--hairline);
		flex-shrink: 0;
	}
	.side-label {
		padding: 20px 24px 10px;
		font: 500 12px var(--font-mono);
		color: var(--text-2);
		letter-spacing: var(--tracking-label);
	}
	/* Everything in the sidebar keeps its own height; only the shelves give,
	   by scrolling. On a screen too short even for the foot, the sidebar itself
	   scrolls (its overflow-y), the shelves keeping three rows. */
	.sidebar > * {
		flex-shrink: 0;
	}
	.sidebar > .shelf-scroll {
		flex: 1 1 auto;
		min-height: 140px;
		overflow-y: auto;
		overscroll-behavior: contain;
	}
	/* + NEW SHELF, and the field it turns into (Library Filters 3j). */
	.new-link {
		display: flex;
		align-items: center;
		height: 44px;
		padding: 0 24px;
		font: 500 14px var(--font-mono);
		color: var(--text-2);
	}
	.new-link:hover {
		color: var(--text-1);
	}
	.new-shelf {
		padding: 4px 12px 0;
	}
	.new-shelf input {
		box-sizing: border-box;
		width: 100%;
		height: 40px;
		padding: 0 12px;
		border: 1px solid var(--text-1);
		border-radius: 0;
		background: transparent;
		color: var(--text-1);
		font: 400 15px var(--font-sans);
		caret-color: var(--accent);
		outline: none;
	}
	.new-hint {
		padding: 8px 12px;
		font: 400 12px var(--font-mono);
		color: var(--text-2);
	}
	.side-foot {
		display: flex;
		flex-direction: column;
		border-top: var(--hairline);
	}
	.side-foot a,
	.side-foot span,
	.side-foot button {
		display: flex;
		align-items: center;
		height: 48px;
		padding: 0 24px;
		font: 500 13px var(--font-mono);
		color: var(--text-2);
	}
	.side-foot > * + * {
		border-top: var(--hairline);
	}
	.side-foot a {
		color: var(--text-1);
		text-decoration: none;
	}
	.side-foot a.with-n {
		justify-content: space-between;
	}
	.side-foot a .n {
		height: auto;
		padding: 0;
		color: var(--text-2);
	}
	.side-foot a.start .n {
		color: var(--accent);
		font-weight: 500;
	}
	.side-foot a.start[aria-current='page'] .n {
		color: var(--text-inverse);
	}
	.side-foot a.run .n {
		color: var(--accent);
		font-weight: 500;
	}
	.side-foot a.run[aria-current='page'] .n {
		color: var(--text-inverse);
	}
	.side-foot a .n.stale {
		opacity: 0.35;
	}
	.side-foot button {
		width: 100%;
		border: 0;
		background: none;
		color: var(--text-1);
		text-align: left;
		cursor: pointer;
	}
	.rescan-note {
		padding: 0 24px 12px;
		font: 500 11px var(--font-mono);
		color: var(--text-2);
		overflow-wrap: anywhere;
	}
	.side-foot a[aria-current='page'] {
		background: var(--surface-inverse);
		color: var(--text-inverse);
	}
	.reveal-frame {
		position: fixed;
		inset: 0;
		box-shadow: var(--reveal-frame);
		pointer-events: none;
		z-index: 30;
	}
</style>

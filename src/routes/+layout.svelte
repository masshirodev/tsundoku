<script lang="ts">
	import '$lib/styles/index.css';
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
	import { afterNavigate, beforeNavigate, goto } from '$app/navigation';
	import { noteVisit } from '$lib/back';
	import { waiting } from '$lib/waiting.svelte';
	import { saves } from '$lib/saves.svelte';
	import WaitingScreen from '$lib/components/waiting/WaitingScreen.svelte';
	import StalledBand from '$lib/components/waiting/StalledBand.svelte';
	import SaveBand from '$lib/components/waiting/SaveBand.svelte';
	import SeriesOutline from './series/[id]/SeriesOutline.svelte';

	let { data, children } = $props();

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
	beforeNavigate((nav) => {
		if (nav.willUnload || !nav.to) return;
		const seq = ++navSeq;
		const from = lastTap && Date.now() - lastTap.at < 400 ? lastTap.el : null;
		lastTap = null;
		waiting.start(nav.to.url, nav.to.route.id, from);
		// A navigation that fails or is replaced ends its wait too.
		void nav.complete.then(
			() => undefined,
			() => seq === navSeq && waiting.end()
		);
	});
	afterNavigate(() => {
		// Where this history entry is, so a back link can go back to it (src/lib/back.ts).
		noteVisit();
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
		{#if page.url.pathname !== '/login'}
			<!--
			The desktop sidebar. Rendered on every device and shown only on a
			desktop, so the server can send it without knowing the screen.
		-->
			<aside class="sidebar" aria-label="Shelves">
				<!-- The app's name is the way home, from any screen. -->
				<a class="brand" href={resolve('/')} aria-label="Library"><Wordmark size={17} /></a>
				<div class="side-label">SHELVES</div>
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
							aria-label="New shelf name"
							autocomplete="off"
							required
							autofocus
							onkeydown={(e) => {
								if (e.key !== 'Escape') return;
								// eslint-disable-next-line svelte/no-navigation-without-resolve -- withParam keeps the current, resolved path
								void goto(stopNaming, { noScroll: true, replaceState: true });
							}}
						/>
						<div class="new-hint">↵ CREATE · ESC CANCEL</div>
					</form>
				{:else}
					<!-- eslint-disable-next-line svelte/no-navigation-without-resolve -- withParam keeps the current, resolved path -->
					<a class="new-link" href={withParam(page.url, 'new', 'shelf')} data-sveltekit-noscroll
						>+ NEW SHELF</a
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
				<div class="spacer"></div>
				<div class="side-foot">
					<a
						href={resolve('/history')}
						aria-current={page.url.pathname === '/history' ? 'page' : undefined}>HISTORY</a
					>
					{#if data.browse}
						<!-- BROWSE under HISTORY, counting extension updates (Index-Browse, sidebar). -->
						<a
							class="with-n"
							href={resolve('/browse')}
							aria-current={page.url.pathname.startsWith('/browse') ? 'page' : undefined}
							>BROWSE<span class="n"
								>{data.browse.updates
									? `${data.browse.updates.toLocaleString('en-US')} ↑`
									: ''}</span
							></a
						>
					{/if}
					{#if data.queue}
						<!-- DOWNLOADS under HISTORY with its count, always there (Index Downloads, sidebar). -->
						<a
							class="with-n"
							href={resolve('/downloads')}
							aria-current={page.url.pathname === '/downloads' ? 'page' : undefined}
							>DOWNLOADS<span class="n" class:stale={data.queue.stale}
								>{data.queue.queued ? data.queue.queued.toLocaleString('en-US') : ''}</span
							></a
						>
					{/if}
					<!-- START SCAN for a library that isn't empty. A press while
					     one runs joins it (doc/IMPORT-MIHON.md, "Running it"). -->
					<form
						method="POST"
						action="/?/scan"
						use:enhance={() =>
							async ({ result, update }) => {
								rescanNote =
									result.type === 'failure' ? String(result.data?.scanMessage ?? '') : '';
								if (result.type !== 'failure') await update();
							}}
					>
						<button type="submit">RESCAN</button>
						{#if rescanNote}<div class="rescan-note" role="status">{rescanNote}</div>{/if}
					</form>
					<!-- Not built yet; see doc/LIBRARY.md, "What it does not do yet". -->
					<span aria-disabled="true">IMPORT LOG</span>
					<a
						href={resolve('/settings')}
						aria-current={page.url.pathname === '/settings' ? 'page' : undefined}>SETTINGS</a
					>
				</div>
			</aside>
		{/if}

		<div class="main">
			{#if data.reveal}
				<Banner kind="reveal" title="HIDDEN SHOWN">
					{#snippet action()}
						<form method="POST" action="/?/command" use:enhance>
							<input type="hidden" name="command" value="hide" />
							<button type="submit">HIDE AGAIN</button>
						</form>
					{/snippet}
				</Banner>
			{/if}
			{#if data.incognito}
				<!-- Dashed is Index's "not stored yet"; magenta stays reveal's. -->
				<Band title="INCOGNITO · NOTHING SAVED" dashed>
					{#snippet action()}
						<form method="POST" action="/?/command" use:enhance>
							<input type="hidden" name="command" value="incognito-end" />
							<button type="submit">END</button>
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
	.spacer {
		flex: 1;
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

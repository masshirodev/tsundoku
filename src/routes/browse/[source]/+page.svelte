<script module lang="ts">
	/**
	 * Whether this document has navigated since it loaded. SvelteKit restores a
	 * history entry's snapshot on a popstate **and** while a fresh document boots
	 * (a reload: the entry's snapshot is in sessionStorage, client.js's
	 * `restore_snapshot`). A reload keeps today's behaviour — the URL's pages, and
	 * the browser's own scroll — so the boot's restore is refused.
	 */
	let navigated = false;
</script>

<script lang="ts">
	import StartTrail from '$lib/components/start/StartTrail.svelte';
	import { resolve } from '$app/paths';
	import { afterNavigate, beforeNavigate, goto } from '$app/navigation';
	import { page } from '$app/state';
	import { onMount, tick, untrack } from 'svelte';
	import type { Snapshot } from './$types';
	import TopBar from '$lib/components/chrome/TopBar.svelte';
	import Band from '$lib/components/chrome/Band.svelte';
	import GridOutline from '$lib/components/waiting/GridOutline.svelte';
	import KeptOutline from './KeptOutline.svelte';
	import { count } from '$lib/library/downloads';
	import { restoreFocus } from '$lib/focus';
	import { writeFilters } from '$lib/library/browse-filters';
	import { backOriginLabel, keepOrigin } from '$lib/library/tag-search';
	import { isRefusedCheck } from './refused-check';
	import { isSettled } from '$lib/library/settled';
	import ResultTile from './ResultTile.svelte';
	import AddedBand from '../AddedBand.svelte';
	import { SiteCheck, checkLine } from '$lib/site-check.svelte';
	import { WebViewWatch } from '$lib/webview-watch.svelte';
	import { NEEDS, parseWebViewError } from '$lib/webview';
	import { askedLine } from '$lib/waiting';
	import FilterForm from './FilterForm.svelte';
	import { m } from '$lib/paraglide/messages';
	import { isSearchCommand, runSearchCommand } from '$lib/library/commands';
	import SelectBar from '../SelectBar.svelte';
	import PressBar from '../PressBar.svelte';
	import PressBand from '../PressBand.svelte';
	import TickSheet from '../TickSheet.svelte';
	import { browseSelection } from '$lib/library/browse-selection.svelte';
	import { oneTag, tickable, whereLabel, type Tick } from '$lib/library/browse-select';
	import type { SearchHit } from '$lib/server/download-types';

	/**
	 * A source's page in BROWSE: a shelf that scrolls on, with the URL keeping
	 * the place. POPULAR and LATEST are tabs, FILTERED joins them once
	 * filters are applied, and FILTER sits at their right end. The grid is the
	 * library's. The next page is asked for as the end comes near and added;
	 * MORE ↓ is the same as a link (?pages=N), which is the no-script way on and
	 * what back returns to.
	 */
	let { data, form } = $props();

	/**
	 * The bar's leading `/` runs a command, as the library's does; the
	 * source's own search keeps everything else. A refusal is said above the
	 * grid and the list stays as it was.
	 */
	let commandNote = $state('');
	async function onSearch(e: SubmitEvent) {
		const text = String(new FormData(e.currentTarget as HTMLFormElement).get('q') ?? '');
		if (!isSearchCommand(text)) return;
		e.preventDefault();
		const outcome = await runSearchCommand(text);
		commandNote = outcome.type === 'refused' ? outcome.message : '';
	}

	type Answer = Extract<Awaited<typeof data.answer>, { ok: true }>['value'];
	type Shown = { key: string; ok: true; value: Answer } | { key: string; ok: false; error: string };

	/**
	 * A tile's focus comes back with a plain way back from a preview, and
	 * only then. The preview's ← is a plain link, not a back link: a tag search
	 * and a source's list share the path `/browse/<id>`, so matching by path
	 * would take the tag search the reader came through and the two ←s would
	 * alternate for good. Focus is put back from the id the root layout's
	 * `saveFocus` noted for this URL, as `restoreFocus` does on a popstate. A
	 * forward visit starts at the top with no tile held, and a reload puts no
	 * tile back either: the saved id outlives the visit, and putting it back
	 * would open the list mid-way down, on a tile the source may have reordered
	 * since. A visit left by touch or mouse saved none, so a phone's way back
	 * draws no focus. It waits for the streamed grid, as the layout does.
	 *
	 * The same arrival gets its place back too, from the one record a
	 * departure toward a preview leaves; see `leftFor` below. Every other forward
	 * visit and a reload keep today's behaviour: the top.
	 */
	afterNavigate((n) => {
		if (n.type !== 'enter') navigated = true;
		if (n.type === 'link' && n.from?.route.id === '/downloads/source/[id]') {
			restoreFocus(page.url.pathname, page.url.search);
			void restoreLeft();
		}
	});

	const base = $derived(resolve('/browse/[source]', { source: data.source.id }));
	/** The ADDED band's parameters: said once, and never part of which list this is. */
	const ADDED_BAND = ['added', 'series', 'preview', 'queued'];
	/** The current URL with some parameters changed; null removes one. */
	function link(over: Record<string, string | null>): string {
		// eslint-disable-next-line svelte/prefer-svelte-reactivity -- a throwaway copy, never read reactively
		const p = new URLSearchParams(page.url.searchParams);
		// The ADDED band is said once, not carried onto the next list.
		for (const k of ADDED_BAND) p.delete(k);
		for (const [k, v] of Object.entries(over)) {
			if (v === null) p.delete(k);
			else p.set(k, v);
		}
		const s = p.toString();
		return s ? `${base}?${s}` : base;
	}
	/**
	 * Every way to another list of this source keeps `from`, the preview or
	 * series a tag opened it from, so ← still returns there. The
	 * value kept is the one `backOrigin` accepted, never the raw parameter.
	 */
	const fromPair = $derived<[string, string][]>(data.back ? [['from', data.back]] : []);
	const withFrom = (href: string) => keepOrigin(href, data.back);
	/**
	 * Which list this is, whatever page it's on: what decides appending vs
	 * starting over, and what a kept place is kept for. Reveal and incognito are
	 * part of it: a revealed list may not be drawn to a non-revealed
	 * visit, and an incognito one leaves nothing (doc/PRIVACY.md).
	 */
	const listKey = (u: URL) => {
		// eslint-disable-next-line svelte/prefer-svelte-reactivity -- a throwaway copy, never read reactively
		const p = new URLSearchParams(u.searchParams);
		for (const k of ['pages', 'panel', 'find', 'refused', 'new', ...ADDED_BAND]) p.delete(k);
		return `${u.pathname}?${p}|${data.reveal ? 'reveal' : ''}|${data.incognito ? 'incognito' : ''}`;
	};

	// The answer on screen. Kept while the next page is asked for, so the grid
	// grows rather than flashing back to its outline; a different list (another
	// tab, other filters) starts from the outline.
	// svelte-ignore state_referenced_locally
	let shown = $state<Shown | null>(
		isSettled(data.answer) ? { key: listKey(page.url), ...data.answer } : null
	);
	/**
	 * The kept list's height and its MORE row, drawn as an outline until this
	 * visit's answer is here (see "the place, kept" below). Null when
	 * nothing is kept or the answer has arrived.
	 */
	let held = $state<{ count: number; more: boolean } | null>(null);
	/**
	 * How many answers the load has drawn on this screen. A kept place draws its
	 * outline at once, and a load that has already answered for this list wins
	 * over it: the answer the server sent for this visit is never covered by
	 * anything kept.
	 */
	let answered = 0;
	let asking = $state(false);
	$effect(() => {
		const a = data.answer;
		const key = listKey(page.url);
		// Read without depending on it: this effect is what writes it.
		if (untrack(() => shown && shown.key !== key)) shown = null;
		if (isSettled(a)) {
			shown = { key, ...a };
			answered += 1;
			asking = false;
			held = null;
			return;
		}
		let current = true;
		asking = true;
		void a.then((s) => {
			if (!current) return;
			shown = { key, ...s };
			answered += 1;
			asking = false;
			held = null;
		});
		return () => (current = false);
	});

	// ---- the place, kept ----------------------------------------------------------
	/*
	 * Back to the catalog comes back to the pages loaded and the place in them
	 * (doc/BROWSE.md, doc/NAVIGATION.md). Two records, because the two ways
	 * back differ:
	 *
	 * - a **popstate** (the browser's back, Android's edge swipe, a TV's BACK)
	 *   restores the history entry's own snapshot, kept by SvelteKit for this
	 *   route's instance: `{ key, count, more, y }`, below;
	 * - the preview's **plain ←** is a forward visit, so it has no entry of
	 *   its own to restore. The one departure toward a preview leaves the same
	 *   record in sessionStorage (`takeLeft`), and only that arrival reads it.
	 *
	 * What is kept is a list's own key (reveal and incognito in it), how many
	 * tiles it had drawn and the scroll — never the answer itself. The answer
	 * drawn at the time is the list as it was then, and a result of it may have
	 * become a hidden library series since (ADD with ADDED HIDDEN, HIDE, another
	 * screen): drawing it again, title and cover, until this visit's answer
	 * arrives would break "hidden means hidden" (doc/BROWSE.md, "A result that
	 * is a hidden series isn't sent"). So a restore draws an outline of the kept
	 * list's size — no title and no cover — holds the place on it, and this
	 * visit's own answer, which the server cleared for it, draws in its place.
	 * The covers come from the browser's cache either way, so redrawing them
	 * asks the source for nothing (measured: 0 requests, doc/BROWSE.md). A list
	 * drawn under reveal or incognito is kept by neither record.
	 */
	type Kept = { key: string; count: number; more: boolean; y: number };
	/** One departure toward a preview, for its ←: where it was. */
	type Left = Kept & { href: string };

	const LEFT_KEY = 'tsundoku.browse-left';
	/** Where the grid was when a navigation began: SvelteKit's capture may run after an outline moved it. */
	let leftAt: number | null = null;

	/** What a way back's outline is sized to: the tiles and the MORE row it had. */
	const keptOf = (s: Shown) =>
		s.ok
			? { count: s.value.results.hits.length, more: s.value.results.more }
			: { count: 0, more: false };

	/**
	 * One record, one departure: the next departure toward a preview replaces it,
	 * and a read takes it, so a stale one is never applied twice. A preview
	 * reached another way (a forward or a back through history) leaves none: its
	 * ← then opens the list at the top.
	 */
	beforeNavigate((n) => {
		// SELECT lasts through the browse world, and ends anywhere else.
		sel.follow(n.to?.route.id);
		leftAt = scrollY;
		if (n.type !== 'link' || n.to?.route.id !== '/downloads/source/[id]') return;
		if (data.reveal || data.incognito || !shown) return;
		try {
			sessionStorage.setItem(
				LEFT_KEY,
				JSON.stringify({
					key: shown.key,
					...keptOf(shown),
					y: scrollY,
					href: (n.from?.url ?? page.url).pathname + (n.from?.url ?? page.url).search
				} satisfies Left)
			);
		} catch {
			// No storage, or full: ← opens the list at the top, as it did.
		}
	});

	/**
	 * The record, if it is for this arrival: its address and list key must both
	 * still be the page's. Read, not taken, when they are not — a link arrival
	 * from the preview that lands somewhere else (a genre, an author: the same
	 * `/browse/<source>` route) leaves it for the preview's own ←, which comes
	 * back here.
	 */
	function takeLeft(at: string, key: string): Left | null {
		try {
			const raw = sessionStorage.getItem(LEFT_KEY);
			if (!raw) return null;
			const left = JSON.parse(raw) as Left;
			if (left.href !== at || left.key !== key) return null;
			sessionStorage.removeItem(LEFT_KEY);
			return left;
		} catch {
			return null;
		}
	}

	/**
	 * Scroll to `y` once the grid is drawn: the page can be shorter than the
	 * place for a moment while the answer streams, and a scroll then lands short.
	 * Tried each frame for two seconds, and given up the moment the reader
	 * touches or scrolls themselves.
	 */
	function settleScroll(y: number, drawn: () => boolean = () => true) {
		const until = performance.now() + 2000;
		let stop = false;
		const halt = () => (stop = true);
		const opts = { once: true, passive: true } as const;
		addEventListener('pointerdown', halt, opts);
		addEventListener('wheel', halt, opts);
		addEventListener('keydown', halt, opts);
		const place = () => {
			if (stop) return;
			scrollTo({ top: y, behavior: 'instant' });
			if (Math.abs(scrollY - y) <= 2 && drawn()) return;
			if (performance.now() < until) requestAnimationFrame(place);
		};
		place();
	}

	/**
	 * Hold a kept place, without drawing what is in it: an outline of its own
	 * size, the scroll set on that. This visit's answer draws in its place when
	 * it lands, and the scroll is set again as it does so. A load that has
	 * already answered for this list wins — a fast server on a popstate — and
	 * then only the place comes back.
	 */
	async function keepPlace(v: Kept) {
		if (answered === 0 && !shown) held = { count: v.count, more: v.more };
		await tick();
		settleScroll(v.y, () => shown !== null);
	}

	/** The preview's ←: the one forward visit that gets its place back. */
	async function restoreLeft() {
		// Nothing of a revealed list comes back, and incognito leaves nothing:
		// neither reads the record, nor takes it away from an earlier one.
		if (data.reveal || data.incognito) return;
		const left = takeLeft(page.url.pathname + page.url.search, listKey(page.url));
		if (!left) return;
		await keepPlace(left);
	}

	/**
	 * A snapshot belongs to a history entry: a popstate restores it. A reload does
	 * not (its `restore` runs while the document boots, with `navigated` false),
	 * and a forward visit has no entry of its own.
	 */
	export const snapshot: Snapshot<Kept | undefined> = {
		capture: () => {
			// Nothing of a revealed list outlives reveal's end, and incognito leaves
			// nothing behind (doc/PRIVACY.md): neither keeps a place at all.
			if (data.reveal || data.incognito || !shown) return undefined;
			return { key: shown.key, ...keptOf(shown), y: leftAt ?? scrollY };
		},
		restore: async (v) => {
			if (!navigated || !v || data.reveal || data.incognito) return;
			if (v.key !== listKey(page.url)) return;
			await keepPlace(v);
		}
	};

	// Waiting for the first answer: is the engine passing the site's browser check?
	const check = new SiteCheck();
	$effect(() => {
		if (shown) return;
		check.start(data.source.id);
		return () => check.stop();
	});

	// A WebView source (doc/BROWSE.md, "Extensions that need a WebView"): while
	// it waits, or after a call failed for want of the browser, the engine's
	// first download of it is watched, so the page says how far it is, and
	// offers TRY AGAIN only once it's ready.
	const webviewFailed = $derived(shown && !shown.ok ? parseWebViewError(shown.error) : null);
	const webview = new WebViewWatch();
	$effect(() => {
		if (data.webviewMark !== NEEDS) return;
		if (shown && !(webviewFailed && webviewFailed.state !== 'off')) return;
		webview.start();
		return () => webview.stop();
	});
	/** The browser as the watch last saw it: starting, ready, failed; null before it answers. */
	const browserState = $derived(webview.view?.status?.state ?? null);

	const value = $derived(shown?.ok ? shown.value : null);
	const results = $derived(value?.results ?? null);
	const name = $derived(data.source.name);
	// An LNReader plugin (doc/NOVELS.md): its search takes no filters, and its
	// settings page has only tsundoku's own switches. The family is asked, not the kind.
	const novel = $derived(data.source.family === 'lnreader');
	const tabTitle = $derived(
		data.q
			? `“${data.q.toUpperCase()}”`
			: data.mode === 'filtered'
				? 'FILTERED'
				: data.mode.toUpperCase()
	);

	// ---- it scrolls on ------------------------------------------------------------
	// Without script there's no scrolling on, only MORE ↓: the label says so only with it.
	let js = $state(false);
	let moreEl = $state<HTMLElement | null>(null);
	let io = $state<IntersectionObserver | null>(null);
	onMount(() => {
		js = true;
		io = new IntersectionObserver(
			(seen) => {
				if (!seen.some((e) => e.isIntersecting) || asking || !results?.more) return;
				// eslint-disable-next-line svelte/no-navigation-without-resolve -- link() builds on base, from resolve()
				void goto(link({ pages: String(data.pages + 1) }), {
					noScroll: true,
					keepFocus: true,
					replaceState: true
				});
			},
			// "As the end comes near": a screen ahead of it.
			{ rootMargin: '0px 0px 100% 0px' }
		);
		return () => io?.disconnect();
	});
	$effect(() => {
		const el = moreEl;
		const watcher = io;
		if (!el || !watcher) return;
		watcher.observe(el);
		return () => watcher.unobserve(el);
	});

	/** Where this page is, so the preview and the series it opens can come back to it. */
	const here = $derived(encodeURIComponent(page.url.pathname + page.url.search));
	const tileHref = (h: { mangaId: string; match: { kind: string; seriesId?: number } }) =>
		h.match.kind === 'in-library' && h.match.seriesId
			? `${resolve('/series/[id]', { id: String(h.match.seriesId) })}?from=${here}`
			: `${resolve('/downloads/source/[id]', { id: h.mangaId })}?from=${here}`;
	const hue = (id: string) => [...id].reduce((a, c) => (a * 31 + c.charCodeAt(0)) % 360, 0);

	// ---- SELECT (doc/BROWSE.md, "SELECT in a catalog") ---------------
	/*
	 * Held in this tab's memory (`browseSelection`), never the URL: it outlives
	 * POPULAR, LATEST, FILTER, a search, a tag's arrival, MORE, other sources and
	 * BROWSE, and a reload ends it. A tap on a tile ticks it, a long press opens
	 * its preview (and ← comes back still selecting). SETTINGS goes while
	 * selecting, since its switches change what a press would do.
	 */
	const sel = browseSelection;
	const selecting = $derived(sel.selecting);
	let showing = $state(false);
	// A selection never outlives the reveal it was made in.
	$effect(() => sel.checkReveal(data.reveal));
	/** Where a tick is made, in SHOW's words: the tab, a search, or a tag's arrival. */
	const where = $derived(
		whereLabel(
			data.mode,
			data.q,
			data.mode === 'filtered' && !data.q && value ? oneTag(value.schema, value.applied) : null
		)
	);
	/** The list on screen, as a tick notes it: SHOW and the bulk bar count what it does not draw. */
	const onList = $derived(shown?.key ?? listKey(page.url));
	const addingHere = $derived(sel.addingIds());
	const tickOf = (h: SearchHit): Tick => ({
		id: h.mangaId,
		title: h.title,
		cover: h.cover,
		hue: hue(h.mangaId),
		meta: h.meta,
		source: {
			id: data.source.id,
			name,
			family: data.source.family,
			addsHidden: data.addsHidden,
			hidden: data.source.mostlyHidden
		},
		twin: h.match.kind === 'same-title',
		where,
		list: onList
	});
	/** ✕ is the bar's; Escape ends SELECT too, once no sheet and no FILTER panel is open to close first. */
	function onKey(e: KeyboardEvent) {
		if (!sel.selecting || e.key !== 'Escape' || data.panel || showing) return;
		if (document.querySelector('[role="dialog"]')) return;
		sel.end();
	}

	/** RESET is the source's own choices, on the filtered tab, with the panel open. */
	const resetHref = $derived(
		value
			? `${base}?${new URLSearchParams([['tab', 'filtered'], ['panel', '1'], ...(data.q ? [['q', data.q]] : []), ...writeFilters(value.schema), ...fromPair] as [string, string][])}`
			: withFrom(base)
	);
	/** The search keeps the filters it was asked with. */
	const keptFilters = $derived(
		data.mode === 'filtered' && value ? writeFilters(value.applied) : []
	);
</script>

<svelte:head><title>{name.toLowerCase()} · browse · tsundoku</title></svelte:head>
<svelte:window onkeydown={onKey} />

<!-- eslint-disable svelte/no-navigation-without-resolve -- every href below is built from resolve(), by base, link() or tileHref() -->

<div class="screen" class:selecting>
	{#if !selecting || data.find || data.q}
		<TopBar sticky={!selecting} label="{name} in BROWSE">
			<!-- Every cell in the middle, each with its own left rule, as the design builds the bar. -->
			{#snippet middle()}
				{#if data.back}
					<!-- From a tag on a preview or a series: back to it, whose own ← is unchanged. -->
					<a class="cell back" href={data.back} aria-label={backOriginLabel(data.back)}>←</a>
				{:else}
					<a class="cell back" href={resolve('/browse')} aria-label="Back to BROWSE">←</a>
				{/if}
				<div class="title" class:searching={data.find || !!data.q}>
					<span class="name">{name.toUpperCase()}</span>
					<span class="sub"
						>{data.source.kind.toUpperCase()} · {data.source.lang.toUpperCase()}</span
					>
				</div>
				<form
					method="GET"
					action={base}
					class="find"
					class:open={data.find || !!data.q}
					onsubmit={onSearch}
				>
					{#each keptFilters as [k, v] (k)}<input type="hidden" name={k} value={v} />{/each}
					{#if keptFilters.length}<input type="hidden" name="tab" value="filtered" />{/if}
					{#each fromPair as [k, v] (k)}<input type="hidden" name={k} value={v} />{/each}
					<input
						type="search"
						name="q"
						value={data.q}
						placeholder={novel ? `/ search ${name}` : `/ search ${name}, with its filters`}
						aria-label="Search {name}"
						autocomplete="off"
					/>
				</form>
				<a class="cell slash" href={link({ find: '1' })} aria-label="Search {name}">/</a>
				{#if !selecting}
					<!-- SELECT: before SETTINGS, after / on a phone. It needs script,
				     so it is drawn once the page runs; a TV has no SELECT. -->
					{#if js}
						<button type="button" class="cell select" onclick={() => sel.start(data.reveal)}
							>SELECT</button
						>
					{/if}
					<!-- Every family's, since tsundoku's own switches are every source's. -->
					<a class="cell settings" href={withFrom(`${base}/settings`)} aria-label="SETTINGS"
						><span class="long">SETTINGS</span><span class="short">SET.</span></a
					>
				{/if}
			{/snippet}
		</TopBar>
	{/if}
	{#if selecting}
		<SelectBar
			find={data.find || data.q ? null : link({ find: '1' })}
			findLabel={name}
			onshow={() => (showing = true)}
		/>
	{/if}
	<!-- The way back to GET STARTED, while FIRST READ's trip lasts (doc/ONBOARDING.md). -->
	<StartTrail start={data.start} />
	<!-- A press's band: while it runs and its one result, on every browse screen. -->
	<PressBand reveal={data.reveal} />
	{#if commandNote}<Band title={commandNote} ondismiss={() => (commandNote = '')} />{/if}
	{#if data.addedHidden}
		<!-- What the series page's band would have said: what ADD AND
		     DOWNLOAD queued, and UNDO while nothing of it is downloaded or read.
		     Inside reveal there is nothing to point at, so the tail goes. -->
		<AddedBand
			band={data.addedHidden}
			{name}
			reveal={data.reveal}
			undo="?/undoAdd"
			refusal={form?.message ?? null}
			from={data.back}
			shelves={data.shelves}
			onShelves={data.addedShelves}
			shelve="?/shelve"
			shelfRefusal={form && 'shelf' in form ? (form.shelf ?? null) : null}
		/>
	{/if}

	<nav class="tabs" aria-label="Lists">
		<div class="tab-list">
			{#if selecting}
				<!-- The source's name moves here while the bar holds the selection. -->
				<span class="tab where"
					>IN {name.toUpperCase()}<span class="long"
						>{` · ${data.source.kind.toUpperCase()} · ${data.source.lang.toUpperCase()}`}</span
					></span
				>
			{/if}
			<a class="tab" class:on={data.mode === 'popular'} href={withFrom(base)}>POPULAR</a>
			{#if value?.latest}
				<a class="tab" class:on={data.mode === 'latest'} href={withFrom(`${base}?tab=latest`)}
					>LATEST</a
				>
			{/if}
			{#if data.mode === 'filtered'}
				<span class="tab on">{data.q ? 'SEARCH' : 'FILTERED'}</span>
			{/if}
		</div>
		{#if value && value.schema.length > 0}
			<a
				class="filter"
				class:open={data.panel}
				href={link({ panel: data.panel ? null : '1' })}
				aria-expanded={data.panel}
			>
				<span>FILTER</span>
				{#if data.mode === 'filtered' && value.changed > 0}<span class="badge">{value.changed}</span
					>{/if}
				<span aria-hidden="true">{data.panel ? '▴' : '▾'}</span>
			</a>
		{/if}
	</nav>

	{#if data.panel && value}
		<FilterForm
			action={base}
			title="{name} · {data.source.lang}"
			schema={value.schema}
			applied={value.applied}
			q={data.q}
			keep={fromPair}
			{resetHref}
			cancelHref={link({ panel: null })}
		/>
	{/if}

	{#if shown && !shown.ok}
		{#if webviewFailed}
			{@render webviewBand(webviewFailed)}
		{:else if shown.error === 'down'}
			<Band
				title="○ NOT ANSWERING · THE EXTENSION ENGINE ON THE WORKSTATION"
				detail="THE LIBRARY AND CACHED CHAPTERS STILL OPEN"
			/>
		{:else if shown.error === 'rate-limited'}
			<!-- No TRY AGAIN to hammer it with: asking again is what the source objects to. -->
			<Band
				title="{name.toUpperCase()} ASKED TO SLOW DOWN"
				detail="IT LIMITS HOW OFTEN IT'S ASKED · OPEN IT AGAIN IN A MINUTE"
			/>
		{:else if data.source.failed}
			<Band
				title="FAILED TO LOAD · {data.source.failed.toUpperCase()}"
				detail="TRY AGAIN IN EXTENSIONS"
			/>
		{:else}
			<!-- A check the site refused is remembered for ten minutes (doc/NOVELS.md),
			     so TRY AGAIN forgets it first (`again`) and says it will. -->
			{@const refusedCheck = isRefusedCheck(shown.error)}
			<Band
				title="{name.toUpperCase()} DID NOT ANSWER"
				detail={shown.error.toUpperCase().slice(0, 140) +
					(refusedCheck ? ` · ${m.browse_check_again()}` : '')}
			>
				<!-- A real load, not the client's: a plain TRY AGAIN is this page's own URL, which
				     SvelteKit would not ask for again, and a hovering pointer must not forget a
				     refused check's memos by preloading `again=1`. -->
				{#snippet action()}<a
						class="again"
						data-sveltekit-reload
						href={link(refusedCheck ? { again: '1' } : {})}>TRY AGAIN</a
					>{/snippet}
			</Band>
		{/if}
	{:else}
		{#if !results && webview.view?.firstUse}
			<!-- Non-blocking: the source answers once its browser is there. -->
			{#if browserState === 'failed'}
				<Band title="THE BROWSER THIS SOURCE NEEDS DIDN'T START" detail={webview.view.firstUse} />
			{:else}
				<Band
					title={webview.view.firstUse}
					detail="ONCE, THE FIRST TIME · THEN THE SOURCE ANSWERS"
				/>
			{/if}
		{:else if !results && check.since !== null}
			<Band
				title="{name.toUpperCase()} · PASSING THE SITE'S BROWSER CHECK"
				detail={checkLine(check.elapsed)}
			/>
		{:else if !results && check.elapsed >= 10_000}
			<Band title="STILL ASKING {name.toUpperCase()}" detail={askedLine(check.elapsed)} />
		{/if}
		<div class="label">
			<div>01 — {tabTitle}</div>
			<div class="r">
				{#if !results && check.since !== null}WAITING FOR THE SITE{:else if !results}ASKING {name.toUpperCase()}{:else if results.more}<span
						>{count(results.hits.length)} SO FAR</span
					>{#if js}<span class="long">&nbsp;· MORE AS YOU SCROLL</span>{/if}{:else}{count(
						results.hits.length
					)} IN ALL{/if}
			</div>
		</div>

		{#if !results}
			{#if held}
				<!-- The kept list's size, no title and no cover: the place a
				     way back holds while this visit's answer is on its way. -->
				<KeptOutline count={held.count} more={held.more} />
			{:else}
				<GridOutline />
			{/if}
		{:else if results.hits.length === 0}
			<div class="none">NOTHING HERE{data.mode === 'filtered' ? ' · TRY FEWER FILTERS' : ''}</div>
		{:else}
			<div class="grid" class:dim={data.panel}>
				{#each results.hits as h (h.mangaId)}
					<ResultTile
						hit={h}
						href={tileHref(h)}
						hue={hue(h.mangaId)}
						{selecting}
						ticked={sel.has(h.mangaId)}
						tickable={tickable(h, addingHere.has(h.mangaId))}
						adding={!!h.adding || addingHere.has(h.mangaId)}
						ontick={() => sel.toggle(tickOf(h))}
						onlong={() => void goto(tileHref(h))}
					/>
				{/each}
			</div>
			{#if results.more}
				<div class="more" bind:this={moreEl}>
					<span class="pg"
						>{asking ? `ASKING FOR PAGE ${data.pages + 1}` : `PAGE ${data.pages + 1}`}</span
					>
					<!-- One page at a time: a click while one is asked for would only queue
					     more calls at the source. -->
					<a
						class="go"
						href={link({ pages: String(data.pages + 1) })}
						data-sveltekit-noscroll
						data-sveltekit-preload-data="tap"
						aria-disabled={asking}
						onclick={(e) => asking && e.preventDefault()}>MORE ↓</a
					>
				</div>
			{/if}
		{/if}
	{/if}
</div>

{#if selecting}
	<PressBar here={onList} />
	<TickSheet open={showing} here={onList} onclose={() => (showing = false)} />
{/if}

{#snippet webviewBand(f: { state: 'starting' | 'failed' | 'off'; line: string })}
	{#if f.state === 'off'}
		<!-- Said in words, not as an error: this install has it off. -->
		<Band title={f.line} detail="SETTINGS › BROWSE › WEBVIEW" />
	{:else if f.state === 'starting' && browserState !== 'ready' && browserState !== 'failed'}
		<!-- No TRY AGAIN while the browser comes: asking now would only wait again. -->
		<Band
			title={webview.view?.firstUse ?? f.line}
			detail="ONCE, THE FIRST TIME · TRY AGAIN COMES WHEN IT'S READY"
		/>
	{:else}
		{@const failed =
			browserState === 'failed' || (f.state === 'failed' && browserState !== 'ready')}
		<Band
			title={failed
				? "THE BROWSER THIS SOURCE NEEDS DIDN'T START"
				: 'THE BROWSER THIS SOURCE NEEDS IS READY'}
			detail={failed ? (webview.view?.firstUse ?? f.line) : `ASK ${name.toUpperCase()} AGAIN`}
		>
			{#snippet action()}<a class="again" data-sveltekit-reload href={link({})}>TRY AGAIN</a
				>{/snippet}
		</Band>
	{/if}
{/snippet}

<!-- eslint-enable svelte/no-navigation-without-resolve -->

<style>
	/* Transcribed from the design: its literals; colours are tokens. */
	.screen {
		display: flex;
		flex-direction: column;
		min-height: 100dvh;
	}
	/* The mock's cells: a column, centred, 4px between a cell's lines. */
	.cell {
		display: flex;
		flex-direction: column;
		justify-content: center;
		/* TopBar centres what it holds; the design's cells stretch, their text at the left. */
		align-items: stretch;
		gap: 4px;
		height: 100%;
		padding: 0 var(--pad);
		font: 500 14px/1.2 var(--font-mono);
		color: var(--text-1);
		text-decoration: none;
		white-space: nowrap;
	}
	.cell + .cell,
	.cell + .title,
	.title + .find,
	.find + .cell {
		border-left: var(--hairline);
	}
	.back {
		font: 500 16px/1 var(--font-mono);
	}
	.title {
		display: flex;
		flex-direction: column;
		justify-content: center;
		gap: 4px;
		flex-shrink: 0;
		min-width: 0;
		padding: 0 var(--pad);
	}
	.name {
		font: 500 16px/1.2 var(--font-mono);
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.sub {
		font: 400 12px/1 var(--font-mono);
		letter-spacing: 0.04em;
		color: var(--text-2);
		white-space: nowrap;
	}
	.find {
		display: flex;
		flex-direction: column;
		justify-content: center;
		align-items: stretch;
		gap: 4px;
		flex: 1 1 auto;
		min-width: 0;
		padding: 0 18px;
	}
	.find input {
		min-width: 0;
		padding: 0;
		border: 0;
		border-radius: 0;
		background: transparent;
		color: var(--text-1);
		font: 400 16px/1.2 var(--font-mono);
		outline: none;
	}
	.find input::placeholder {
		color: var(--text-2);
	}
	.slash {
		display: none;
		font: 500 16px/1 var(--font-mono);
	}
	/* SELECT: a cell like SETTINGS, a button. */
	button.cell {
		border: 0;
		border-radius: 0;
		background: transparent;
		cursor: pointer;
	}
	button.cell + .cell {
		border-left: var(--hairline);
	}
	.settings .short {
		display: none;
	}
	/* Selecting: the bulk bar is pinned under the grid, so the grid ends above it. */
	.screen.selecting {
		padding-bottom: 120px;
	}
	/* The source's name at the head of the tabs while selecting: drawn as the
	   design draws a tab, its own weight and ink. */
	.tab.where {
		display: flex;
		align-items: center;
		gap: 8px;
		font: 400 14px/1.2 var(--font-mono);
		color: var(--text-2);
	}
	.tabs {
		flex-shrink: 0;
		display: flex;
		border-top: var(--hairline);
		border-bottom: var(--hairline);
	}
	.tab-list {
		flex: 1;
		min-width: 0;
		display: flex;
		overflow: hidden;
	}
	.tab {
		padding: 14px 16px;
		border-right: var(--hairline);
		font: 500 14px var(--font-mono);
		white-space: nowrap;
		color: var(--text-1);
		text-decoration: none;
	}
	.tab.on {
		background: var(--surface-inverse);
		color: var(--text-inverse);
	}
	.filter {
		display: flex;
		align-items: center;
		gap: 8px;
		flex-shrink: 0;
		padding: 0 16px;
		border-left: var(--hairline);
		font: 500 14px var(--font-mono);
		color: var(--text-1);
		text-decoration: none;
	}
	.filter.open {
		background: var(--surface-inverse);
		color: var(--text-inverse);
	}
	.badge {
		padding: 1px 6px;
		background: var(--accent);
		color: var(--on-accent);
		font: 500 12px var(--font-mono);
	}
	.label {
		flex-shrink: 0;
		display: flex;
		justify-content: space-between;
		gap: 12px;
		padding: 22px var(--pad) 12px;
		font: 500 13px/1.2 var(--font-mono);
		letter-spacing: 0.06em;
		color: var(--text-2);
	}
	.label .r {
		white-space: nowrap;
	}
	.grid {
		position: relative;
		flex-shrink: 0;
		display: grid;
		grid-template-columns: repeat(var(--grid-cols), minmax(0, 1fr));
		gap: 1px;
		/* Each tile draws its rules into the gap (ResultTile), not the grid's
		   background, so a short last row ends in page, not a grey block: the
		   library counts filler cells in script, and this page draws without it.
		   The last row's own rule lands on the border, so it reads as one. */
		background: var(--surface-page);
		border-bottom: var(--hairline);
	}
	.grid.dim::after {
		content: '';
		position: absolute;
		inset: 0;
		background: var(--scrim);
	}
	.more {
		flex-shrink: 0;
		display: flex;
		align-items: stretch;
		min-height: 56px;
		border-bottom: var(--hairline);
	}
	.pg {
		flex: 1;
		min-width: 0;
		display: flex;
		align-items: center;
		padding: 0 var(--pad);
		font: 500 13px var(--font-mono);
		letter-spacing: 0.04em;
		color: var(--text-2);
	}
	.go {
		display: flex;
		align-items: center;
		padding: 0 var(--pad);
		border-left: var(--hairline);
		font: 500 14px var(--font-mono);
		letter-spacing: 0.04em;
		white-space: nowrap;
		color: var(--text-1);
		text-decoration: none;
	}
	.go[aria-disabled='true'] {
		color: var(--text-2);
		cursor: default;
	}
	.none {
		padding: 24px var(--pad);
		font: 500 13px var(--font-mono);
		letter-spacing: 0.06em;
		color: var(--text-2);
	}
	.again {
		color: inherit;
		font: 500 14px var(--font-mono);
	}

	/* The TV has no SELECT: every tap there is a remote's OK. */
	@media (pointer: none) and (min-width: 900px) {
		.select {
			display: none;
		}
	}

	/* The phone: no room for the field, so / opens it in the title's place. */
	@media (max-width: 599px) {
		/* SETTINGS says SET. beside SELECT on a phone's bar. */
		.settings .long,
		.where .long {
			display: none;
		}
		.settings .short {
			display: inline;
		}
		.title {
			flex: 1 1 auto;
		}
		.sub,
		.long {
			display: none;
		}
		.find {
			display: none;
		}
		.find.open {
			display: flex;
		}
		.title.searching {
			display: none;
		}
		.slash {
			display: flex;
		}
		.find.open ~ .slash {
			display: none;
		}
		.label {
			padding-top: 18px;
		}
	}
</style>

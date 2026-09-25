<script lang="ts">
	import { langCode } from '$lib/library/editions';
	import ConfirmSheet from '$lib/components/chrome/ConfirmSheet.svelte';
	import { backLink } from '$lib/back';
	import { enhance } from '$app/forms';
	import { beforeNavigate, goto, invalidateAll } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { tick, untrack } from 'svelte';
	import { SvelteMap, SvelteSet } from 'svelte/reactivity';
	import { page } from '$app/state';
	import Banner from '$lib/components/chrome/Banner.svelte';
	import BulkBar from '$lib/components/chrome/BulkBar.svelte';
	import SectionLabel from '$lib/components/chrome/SectionLabel.svelte';
	import TopBar from '$lib/components/chrome/TopBar.svelte';
	import Wordmark from '$lib/components/chrome/Wordmark.svelte';
	import ContinueRow from '$lib/components/content/ContinueRow.svelte';
	import CoverTile from '$lib/components/content/CoverTile.svelte';
	import GridOutline from '$lib/components/waiting/GridOutline.svelte';
	import { waiting } from '$lib/waiting.svelte';
	import { postAction, saves } from '$lib/saves.svelte';
	import Button from '$lib/components/controls/Button.svelte';
	import ShelfTabs from '$lib/components/controls/ShelfTabs.svelte';
	import SeriesSheet from './SeriesSheet.svelte';
	import ShelfPicker from './ShelfPicker.svelte';
	import PersonView from './PersonView.svelte';
	import GroupSheet from './GroupSheet.svelte';
	import TagChip from '$lib/components/controls/TagChip.svelte';
	import { tagHref } from '$lib/library/links';
	import { hueFor } from '$lib/library/cover';
	import { desktop, phone, wide } from '$lib/device.svelte';
	import { offline } from '$lib/offline.svelte';
	import { continueSub, count, newSeed, nextSort, progress, SORT_LABEL } from '$lib/library/labels';
	import { coverSrc, readHref, seriesHref, shelfHref, withParam } from '$lib/library/links';
	import type { Rating, SeriesCard, Shelf } from '$lib/library/types';
	import { pageQuery } from '$lib/library/paging';
	import type { Snapshot } from './$types';

	let { data, form } = $props();

	const scanning = $derived(data.scan !== null && data.scan.finishedAt === null);

	// While an import runs on the workstation, follow it: the band's bytes and
	// the arriving grid come from the job row, re-read every two seconds.
	$effect(() => {
		if (!scanning) return;
		const timer = setInterval(() => void invalidateAll(), 2000);
		return () => clearInterval(timer);
	});
	const justImported = $derived(data.scan !== null && data.scan.finishedAt !== null);
	const isOffline = $derived(!offline.online);

	// ---- pages ------------------------------------------------------------
	// The grid arrives a page at a time (doc/LIBRARY.md, "Pages"): the server
	// sends the first, and the rest are asked for as the end of the grid comes
	// near. `more` is every page after the first.
	let more = $state<SeriesCard[]>([]);
	let loadingMore = $state(false);
	let moreFailed = $state(false);
	/** Bumped whenever the list changes under a request, so a late answer is dropped. */
	let generation = 0;
	const series = $derived(data.series.length ? [...data.series, ...more] : more);
	/**
	 * A page shorter than asked for is the end, whatever `total` said: the shelf
	 * can shrink after the first page (a series hidden, volumes grouped).
	 */
	let ended = $state(false);
	const hasMore = $derived(!ended && data.shelf !== 'cached' && series.length < data.total);
	const listKey = $derived(
		`${data.shelf}|${data.tag ?? ''}|${data.sort}|${data.seed}|${data.reveal}`
	);
	let shownKey = '';

	async function fetchPage(offset: number, limit: number): Promise<SeriesCard[] | null> {
		try {
			const res = await fetch(
				`/api/library?${pageQuery({ shelf: data.shelf, tag: data.tag, sort: data.sort, seed: data.seed, offset, limit })}`
			);
			if (!res.ok) return null;
			return ((await res.json()) as { series: SeriesCard[] }).series;
		} catch {
			return null;
		}
	}

	async function loadMore() {
		if (loadingMore || !hasMore || isOffline) return;
		loadingMore = true;
		moreFailed = false;
		const gen = generation;
		const next = await fetchPage(series.length, data.pageSize);
		if (gen === generation) {
			if (next) {
				// Pages are by position, and the shelf can move under them (a series
				// hidden or grouped since): one already shown is not shown twice.
				const have = new Set(series.map((c) => c.id));
				more = [...more, ...next.filter((c) => !have.has(c.id))];
				if (next.length < data.pageSize) ended = true;
			} else moreFailed = true;
		}
		if (gen === generation) loadingMore = false;
		void keepGoing();
	}

	/**
	 * The observer only speaks when the end comes near. Whenever the list
	 * settles -- a page in, a refresh, a page dropped because the list changed
	 * under it -- the end may still be near without having moved, so ask again
	 * rather than leave the grid stalled.
	 */
	async function keepGoing() {
		await tick();
		if (loadingMore || moreFailed || !endNode) return;
		if (endNode.getBoundingClientRect().top < innerHeight * 2.5) void loadMore();
	}

	// A new shelf, tag or sort starts again from its first page. The same one
	// re-read (a rating saved, a scan's progress) reads the pages after the
	// first again too, so a tile deep in the grid shows what the server says.
	$effect(() => {
		const key = listKey;
		const first = data.series;
		untrack(() => {
			generation += 1;
			loadingMore = false;
			moreFailed = false;
			ended = false;
			if (key !== shownKey) {
				shownKey = key;
				more = [];
				void keepGoing();
				return;
			}
			if (more.length === 0) return void keepGoing();
			const gen = generation;
			void fetchPage(first.length, more.length).then((pageAgain) => {
				if (gen !== generation) return;
				if (pageAgain) {
					const have = new Set(data.series.map((c) => c.id));
					more = pageAgain.filter((c) => !have.has(c.id));
				}
				void keepGoing();
			});
		});
	});

	/**
	 * Back to the library (the back gesture) comes back to the same place: the
	 * pages loaded and the scroll. SvelteKit scrolls before it restores, when
	 * only the first page is there to scroll through, so the scroll is set
	 * again once the pages are back. Capped, since it's kept in sessionStorage.
	 */
	/**
	 * Scroll to `y` once the page is tall enough to: on a slow return the
	 * waiting outline covers the grid for a moment, and a scroll then lands
	 * short. Tried each frame for two seconds, and given up the moment the
	 * reader touches or scrolls themselves.
	 */
	function settleScroll(y: number) {
		const until = performance.now() + 2000;
		let stop = false;
		const halt = () => (stop = true);
		const opts = { once: true, passive: true } as const;
		addEventListener('pointerdown', halt, opts);
		addEventListener('wheel', halt, opts);
		addEventListener('keydown', halt, opts);
		const place = () => {
			if (stop) return;
			scrollTo(0, y);
			if (Math.abs(scrollY - y) > 2 && performance.now() < until) requestAnimationFrame(place);
		};
		place();
	}

	/**
	 * Where the grid was when a navigation began. By the time SvelteKit takes
	 * the snapshot, the waiting outline may have covered the library and its
	 * scroll gone to 0 (doc/WAITING.md), so the place is noted first.
	 */
	let leftAt: number | null = null;
	beforeNavigate(() => {
		leftAt = scrollY;
	});

	export const snapshot: Snapshot<{ key: string; more: SeriesCard[]; y: number }> = {
		capture: () => ({ key: listKey, more: more.slice(0, 4000), y: leftAt ?? scrollY }),
		restore: async (v) => {
			if (!v || v.key !== listKey || v.more.length === 0) return;
			generation += 1;
			shownKey = v.key;
			const have = new Set(data.series.map((c) => c.id));
			more = v.more.filter((c) => !have.has(c.id));
			await tick();
			settleScroll(v.y);
			// What they say now: a rating may have changed on the series screen.
			const gen = generation;
			const again = await fetchPage(data.series.length, v.more.length);
			if (again && gen === generation) more = again.filter((c) => !have.has(c.id));
		}
	};

	/** Asks for the next page while the end of the grid is still a screen or two away. */
	let endNode: HTMLElement | null = null;
	function nearEnd(node: HTMLElement) {
		endNode = node;
		const io = new IntersectionObserver(
			(seen) => {
				if (seen.some((e) => e.isIntersecting)) void loadMore();
			},
			{ rootMargin: '0px 0px 150% 0px' }
		);
		io.observe(node);
		return {
			destroy: () => {
				io.disconnect();
				if (endNode === node) endNode = null;
			}
		};
	}

	// ---- selection -------------------------------------------------------
	let selecting = $state(false);
	const selected = new SvelteSet<number>();

	function toggle(id: number) {
		if (selected.has(id)) selected.delete(id);
		else selected.add(id);
	}

	function stopSelecting() {
		selecting = false;
		selected.clear();
	}

	// ---- sheets ------------------------------------------------------------
	let deleting = $state(false);
	/** The first few titles, so the question names what it's about. */
	const deletingTitles = $derived.by(() => {
		const names = series.filter((c) => selected.has(c.id)).map((c) => c.title);
		if (names.length === 0) return '';
		const shown = names.slice(0, 3).join(', ').toUpperCase();
		return names.length > 3 ? `${shown} AND ${selected.size - 3} MORE` : shown;
	});
	let sheetId = $state<number | null>(null);
	let pickerOpen = $state(false);
	let grouping = $state(false);

	/**
	 * What GROUP would take: selected doujin singletons, or selected novels
	 * (volumes, doc/BOOKS.md), from the library grid or a person page. GROUP is
	 * offered only when every selected item is one, all of one kind -- a manga,
	 * or books mixed with novels, can't be grouped.
	 */
	const groupPick = $derived.by(() => {
		const out: {
			seriesId: number;
			title: string;
			hue: number;
			addedAt: number;
			kind: string;
			cover: number | null;
		}[] = [];
		const pool = data.person
			? data.person.items
					.filter((i) => i.groupable || (i.kind === 'novel' && i.entryId === null))
					.map((i) => ({
						id: i.seriesId,
						title: i.title,
						hue: hueFor(i.title),
						addedAt: i.addedAt,
						kind: i.kind,
						cover: i.cover
					}))
			: series
					.filter((c) => (c.kind === 'doujin' && c.entryCount === 1) || c.kind === 'novel')
					.map((c) => ({
						id: c.id,
						title: c.title,
						hue: c.hue,
						addedAt: c.addedAt,
						kind: c.kind,
						cover: c.cover
					}));
		for (const b of pool) if (selected.has(b.id)) out.push({ seriesId: b.id, ...b });
		return out;
	});
	const groupKinds = $derived(new Set(groupPick.map((b) => b.kind)));
	const groupBooks = $derived(groupKinds.size === 1 ? groupPick : []);
	const volumes = $derived(groupKinds.has('novel'));
	const canGroup = $derived(selected.size > 0 && groupBooks.length === selected.size);
	/**
	 * FOLD AS LANGUAGES (doc/EDITIONS.md): two or three single books, each in
	 * a language of its own, none folded already. Their codes, or null.
	 */
	const foldCodes = $derived.by(() => {
		if (selected.size < 2 || selected.size > 3) return null;
		const picked = series.filter((s) => selected.has(s.id));
		if (picked.length !== selected.size) return null;
		if (picked.some((s) => s.kind !== 'doujin' || s.entryCount !== 1 || !s.language || s.languages))
			return null;
		const langs = picked.map((s) => s.language!);
		return new Set(langs).size === langs.length ? langs.map(langCode) : null;
	});
	const foldMessage = $derived(form && 'foldMessage' in form ? String(form.foldMessage) : '');
	const allHidden = $derived(
		selected.size > 0 && series.filter((s) => selected.has(s.id)).every((s) => s.hidden)
	);

	/** A tap opens the series; a long press opens the sheet (see CoverTile). */
	function press(id: number) {
		if (selecting) return toggle(id);
		// The series screen opens with what this tile already knows (doc/WAITING.md).
		const s = series.find((x) => x.id === id);
		if (s)
			waiting.preview = {
				id: s.id,
				title: s.title,
				kind: s.kind,
				hue: s.hue,
				rating: ratingNow.get(s.id) ?? s.rating,
				favourite: favNow.get(s.id) ?? s.favourite,
				hidden: s.hidden,
				entryCount: s.entryCount,
				readCount: s.readCount,
				cover: s.cover
			};
		// eslint-disable-next-line svelte/no-navigation-without-resolve -- seriesHref() resolves
		void goto(seriesHref(id, data.tag ? null : data.shelf));
	}

	// A shelf tab on its way past 1 s: the grid in outline, CONTINUE and the
	// tabs kept as they are (Loading States 1c).
	const outlined = $derived(
		(waiting.phase === 'outline' || waiting.phase === 'stalled') && waiting.to.kind === 'library'
	);

	// ---- on the tile ------------------------------------------------------
	// FAV and the rating are edited on the cover itself (see CoverTile). The
	// tile shows the change at once and saves behind it. A write that fails
	// keeps the new value, and the layout's band offers RETRY and PUT BACK
	// (doc/WAITING.md).
	const favNow = new SvelteMap<number, boolean>();
	const ratingNow = new SvelteMap<number, Rating>();

	async function write(
		action: 'favourite' | 'rate',
		key: string,
		fields: Record<string, string>,
		failure: { what: string; putBackLabel: string; putBack: () => void },
		settle: () => void
	) {
		const save = async () => {
			const ok = await postAction(`/?/${action}`, fields);
			if (ok) {
				await invalidateAll();
				settle();
			}
			return ok;
		};
		saves.clear(key);
		if (!(await save())) saves.fail({ ...failure, key, retry: save });
	}

	function favourite(id: number, on: boolean) {
		favNow.set(id, on);
		void write(
			'favourite',
			`fav:${id}`,
			{ id: String(id), on: on ? '1' : '0' },
			{
				what: on ? 'FAV NOT SAVED' : 'UNFAV NOT SAVED',
				putBackLabel: on ? 'PUT BACK · NOT FAV' : 'PUT BACK · FAV',
				putBack: () => favNow.delete(id)
			},
			() => favNow.delete(id)
		);
	}

	function rate(id: number, rating: Rating) {
		const was = series.find((s) => s.id === id)?.rating ?? 0;
		ratingNow.set(id, rating);
		void write(
			'rate',
			`rating:${id}`,
			{ id: String(id), rating: String(rating) },
			{
				what: `RATING ${rating} NOT SAVED`,
				putBackLabel: `PUT BACK ${was}`,
				putBack: () => ratingNow.delete(id)
			},
			() => ratingNow.delete(id)
		);
	}

	// ---- derived view ------------------------------------------------------
	// Layout is decided by CSS (src/lib/styles/layout.css), so the server's
	// first paint is already right for the device. Script only needs the column
	// count to pad the last row, which is cosmetic and can wait for hydration.
	const columns = $derived(phone.current ? 3 : desktop.current ? 8 : wide.current ? 9 : 6);
	const contShown = $derived(data.cont.items.slice(0, 4));
	const showContinue = $derived(contShown.length > 0 && !scanning && !justImported);

	const cachedCount = (id: number) => offline.cached[id] ?? 0;

	const tabs = $derived.by((): Shelf[] => {
		if (!isOffline) return data.shelves;
		const cached: Shelf = {
			key: 'cached',
			name: 'Cached',
			kind: 'smart',
			count: Object.keys(offline.cached).length
		};
		return [cached, ...data.shelves.filter((s) => s.key !== 'new')];
	});

	const activeShelf = $derived(data.tag ? '' : data.shelf);

	const sectionText = $derived.by(() => {
		if (data.tag) {
			const [ns, value] = data.tag.includes(':') ? data.tag.split(':', 2) : ['', data.tag];
			return ns ? `${ns} · ${value}` : value;
		}
		if (scanning) return 'Arriving';
		if (isOffline) return 'On this device';
		if (justImported && data.shelf === 'new') return 'Just imported';
		return 'Shelves';
	});

	/**
	 * CACHED is a device shelf: only the tablet knows what it holds, so the
	 * server lists everything and this narrows it.
	 */
	const shown = $derived(
		data.shelf === 'cached' ? series.filter((s) => cachedCount(s.id) > 0) : series
	);

	/**
	 * Fill the last grid row, so the hairline ground never shows as a block.
	 * Not while pages remain: the next one carries on the row.
	 */
	const fillers = $derived(hasMore ? 0 : (columns - (shown.length % columns)) % columns);

	/**
	 * SELECT ALL means the whole shelf, pages not yet loaded included: their
	 * ids come without their cards.
	 */
	async function selectAll() {
		shown.forEach((s) => selected.add(s.id));
		if (!hasMore) return;
		try {
			const q = pageQuery({
				shelf: data.shelf,
				tag: data.tag,
				sort: data.sort,
				offset: 0,
				limit: 0
			});
			const res = await fetch(`/api/library?${q}&ids=1`);
			if (res.ok) for (const id of ((await res.json()) as { ids: number[] }).ids) selected.add(id);
		} catch {
			// Offline: the loaded pages stay selected, which is what's on screen.
		}
	}

	const gb = (bytes: number) => (bytes / 1e9).toFixed(1).replace(/\.0$/, '');

	function sortNext() {
		const next = nextSort(data.sort);
		const url = new URL(page.url);
		url.searchParams.set('sort', next);
		// RANDOM shuffles anew each time it's chosen; the other orders need no seed.
		if (next === 'random') url.searchParams.set('seed', String(newSeed()));
		else url.searchParams.delete('seed');
		// eslint-disable-next-line svelte/no-navigation-without-resolve -- withParam() keeps the current, resolved path
		void goto(withParam(url, 'sort', next), {
			noScroll: true,
			keepFocus: true
		});
	}
</script>

<svelte:head><title>tsundoku</title></svelte:head>

<div class="library" class:selecting>
	{#if selecting}
		<TopBar inverse sticky label="Selection">
			{#snippet left()}
				<button type="button" class="cell-btn x" aria-label="Stop selecting" onclick={stopSelecting}
					>✕</button
				>
			{/snippet}
			{#snippet middle()}
				<div class="selected-count" aria-live="polite">{selected.size} SELECTED</div>
			{/snippet}
			{#snippet right()}
				<button type="button" class="cell-btn" onclick={() => void selectAll()}>SELECT ALL</button>
			{/snippet}
		</TopBar>
	{:else if data.person}
		<TopBar sticky label="Library">
			{#snippet left()}
				<a class="cell-btn back" href={resolve('/')} aria-label="Back to library" use:backLink>←</a>
			{/snippet}
			{#snippet middle()}
				<div class="tag-title">
					<span class="ns">{data.person?.namespace || 'tag'}</span><span>{data.person?.value}</span>
				</div>
			{/snippet}
			{#snippet right()}
				<button type="button" class="cell-btn" onclick={() => (selecting = true)}>SELECT</button>
			{/snippet}
		</TopBar>
	{:else}
		<TopBar sticky label="Library">
			{#snippet left()}
				<!-- The app's name goes home: the library as it opens. -->
				<a class="brand" href={resolve('/')} aria-label="Library"><Wordmark /></a>
			{/snippet}
			{#snippet middle()}
				<a class="search-hint" href={resolve('/search')}
					><span class="short">/ search</span><span class="long">/ search title, tag, artist</span
					></a
				>
			{/snippet}
			{#snippet right()}
				<button
					type="button"
					class="cell-btn"
					onclick={() => (selecting = true)}
					disabled={data.empty}>SELECT</button
				>
			{/snippet}
		</TopBar>
	{/if}

	{#if data.scan && scanning}
		<Banner
			kind="progress"
			title="SCANNING ON WORKSTATION"
			detail="{gb(data.scan.bytesDone)} / {gb(data.scan.bytesTotal)} GB"
			progress={data.scan.bytesTotal > 0 ? data.scan.bytesDone / data.scan.bytesTotal : 0}
			meta="{count(data.scan.seriesFound)} SERIES SO FAR"
			metaRight={data.scan.sourceLabel
				? `${data.scan.sourceLabel.toUpperCase()} · ${data.scan.step} OF ${data.scan.steps}`
				: undefined}
		/>
	{:else if data.scan && justImported}
		<Banner
			kind="action"
			title="IMPORT FINISHED · {count(data.scan.seriesFound)} SERIES"
			detail={data.scan.failedFiles > 0
				? `${count(data.scan.failedFiles)} FILES FAILED · SEE LOG`
				: undefined}
		>
			{#snippet action()}
				<form method="POST" action="?/dismissScan" use:enhance>
					<input type="hidden" name="scan" value={data.scan?.id} />
					<button type="submit">TIDY NEW →</button>
				</form>
			{/snippet}
		</Banner>
	{/if}

	{#if isOffline}
		<Banner kind="info" title="○ OFFLINE" detail="CACHED STILL OPENS" />
	{/if}

	{#if data.dupes > 0 && !data.empty}
		<!-- Only while there are pairs the viewer can see (doc/DUPLICATE-BOOKS.md). -->
		<Banner
			kind="action"
			title="{String(data.dupes).padStart(2, '0')} POSSIBLE DUPLICATE{data.dupes === 1 ? '' : 'S'}"
			detail="SAME COVER, DOWNLOADED TWICE"
		>
			{#snippet action()}
				<a href={resolve('/duplicates')}>REVIEW →</a>
			{/snippet}
		</Banner>
	{/if}

	{#if data.toLink > 0 && !data.empty}
		<!-- Below duplicates, which are older and fewer (Catalogue Links 1a; doc/LINKS.md). -->
		<Banner
			kind="action"
			title="{String(data.toLink).padStart(2, '0')} SERIES TO LINK"
			detail={isOffline ? 'THE REVIEW NEEDS THE WORKSTATION' : 'FOUND ON ANILIST, NOT FOR CERTAIN'}
		>
			{#snippet action()}
				{#if isOffline}
					<span class="dimmed" aria-disabled="true">REVIEW →</span>
				{:else}
					<a href={resolve('/links')} aria-label="Review the series to link">REVIEW →</a>
				{/if}
			{/snippet}
		</Banner>
	{/if}

	{#if data.empty}
		<section class="empty">
			<div class="empty-label">00 — LIBRARY EMPTY</div>
			<h1>Nothing imported yet.</h1>
			<p>
				Imports run on the workstation. Put files in the library folder, then start a scan. Series
				appear here as they are found.
			</p>
			<div class="sources">
				<div><span>Mihon backup (.tachibk)</span><span class="dim">manga, manhwa</span></div>
				<div><span>Hentoid folder</span><span class="dim">doujin → hidden</span></div>
				<div><span>EPUB</span><span class="dim">novels</span></div>
			</div>
			<div class="folder">
				<div class="folder-label">LIBRARY FOLDER</div>
				<div class="folder-path">{data.libraryRoot}</div>
			</div>
			<form method="POST" action="?/scan" use:enhance class="scan-form">
				<Button variant="primary" size="lg" type="submit">START SCAN</Button>
				{#if form && 'scanMessage' in form}<div class="scan-message">{form.scanMessage}</div>{/if}
			</form>
		</section>
	{:else if data.person}
		<PersonView
			page={data.person}
			{selecting}
			{selected}
			onselect={(i) =>
				selected.has(i.seriesId) ? selected.delete(i.seriesId) : selected.add(i.seriesId)}
		/>
	{:else}
		{#if showContinue}
			<div class="cont-section">
				<SectionLabel index={1} text="Continue" top={18}>
					{#snippet right()}
						{#if isOffline}
							{contShown.filter((c) => cachedCount(c.id) > 0).length} OF {contShown.length} CACHED
						{:else}
							<!-- History is CONTINUE going further back (Index Addendum). -->
							<a class="to-history" href={resolve('/history')}
								>{count(data.cont.total)} OPEN · HISTORY →</a
							>
						{/if}
					{/snippet}
				</SectionLabel>
				<div class="cont">
					{#each contShown as item (item.id)}
						{@const cached = cachedCount(item.id) > 0}
						<ContinueRow
							title={item.title}
							meta={continueSub(item, isOffline ? { cached } : undefined)}
							progress={progress(item)}
							src={coverSrc(item.id, item.cover)}
							hue={item.hue}
							unavailable={isOffline && !cached}
							onresume={item.resumeId !== null
								? // eslint-disable-next-line svelte/no-navigation-without-resolve -- readHref() resolves
									() => goto(readHref(item.resumeId!))
								: undefined}
						/>
					{/each}
				</div>
			</div>
		{/if}

		<SectionLabel index={2} text={sectionText}>
			{#snippet right()}
				{#if selecting}
					TAP TO ADD
				{:else if outlined}
					LOADING
				{:else if scanning}
					NEWEST FIRST
				{:else}
					<button type="button" onclick={sortNext} aria-label="Change sort"
						>{SORT_LABEL[data.sort]}</button
					>
				{/if}
			{/snippet}
		</SectionLabel>

		<div class="tabs">
			<ShelfTabs shelves={tabs} active={activeShelf} href={(k) => shelfHref(page.url, k)} />
		</div>

		{#if outlined}
			<GridOutline />
		{:else if data.shelf !== 'people'}
			<div class="grid">
				{#each shown as s (s.id)}
					{@const cached = cachedCount(s.id)}
					<CoverTile
						src={coverSrc(s.id, s.cover)}
						title={s.title}
						hue={s.hue}
						rating={ratingNow.get(s.id) ?? s.rating}
						favourite={favNow.get(s.id) ?? s.favourite}
						newCount={s.newCount}
						hidden={s.hidden}
						indexing={!s.indexed}
						languages={s.languages}
						cached={isOffline && cached > 0 ? cached : null}
						dimmed={isOffline && cached === 0}
						selectable={selecting}
						selected={selected.has(s.id)}
						onpress={() => press(s.id)}
						onlongpress={() => (selecting ? toggle(s.id) : (sheetId = s.id))}
						onfavourite={isOffline ? undefined : (on) => favourite(s.id, on)}
						onrate={isOffline ? undefined : (r) => rate(s.id, r)}
					/>
				{/each}
				{#each { length: fillers }, i (i)}
					<div class="filler" aria-hidden="true"></div>
				{/each}
			</div>
			{#if hasMore}
				<!-- The end of what's loaded: coming near it asks for the next page. -->
				<div class="more" use:nearEnd>
					{#if moreFailed}
						<span
							>{series.length.toLocaleString('en-US')} OF {data.total.toLocaleString('en-US')} · THE REST
							DID NOT LOAD</span
						>
						<button type="button" onclick={() => void loadMore()}>RETRY</button>
					{:else if isOffline}
						<span
							>{series.length.toLocaleString('en-US')} OF {data.total.toLocaleString('en-US')} · THE REST
							NEEDS THE WORKSTATION</span
						>
					{:else}
						<span
							>{series.length.toLocaleString('en-US')} OF {data.total.toLocaleString('en-US')}</span
						>
						<span>{loadingMore ? 'LOADING' : ''}</span>
					{/if}
				</div>
			{/if}
		{/if}

		{#if data.shelf === 'people'}
			<!-- The PEOPLE shelf: favourite people, each opening their page. -->
			<div class="people">
				{#each data.people as p (p.namespace + ':' + p.value)}
					<TagChip
						namespace={p.namespace}
						value={p.value}
						count={p.count}
						href={tagHref(`${p.namespace}:${p.value}`)}
					/>
				{/each}
			</div>
			{#if data.people.length === 0}
				<p class="none">NO FAVOURITE PEOPLE · FAV ONE FROM THEIR PAGE</p>
			{/if}
		{:else if shown.length === 0}
			<p class="none">NOTHING ON THIS SHELF</p>
		{/if}
	{/if}
</div>

{#if selecting}
	<form
		method="POST"
		action="?/bulk"
		use:enhance={() =>
			async ({ update }) => {
				await update({ reset: false });
			}}
	>
		{#each [...selected] as id (id)}<input type="hidden" name="id" value={id} />{/each}
		{#if foldMessage}
			<div class="fold-refused" role="status">{foldMessage}</div>
		{/if}
		<BulkBar columns={6}>
			{#snippet actions()}
				<button type="submit" name="do" value="fav" disabled={selected.size === 0}>FAV</button>
				<button type="button" disabled={selected.size === 0} onclick={() => (pickerOpen = true)}
					>+ SHELF</button
				>
				<!-- No tag editor is designed yet; see doc/LIBRARY.md. -->
				<button type="button" disabled>TAG</button>
				{#if foldCodes}
					<!-- Editions 1f: books in different languages fold, rather than group. -->
					<button type="submit" class="fold" formaction="?/fold"
						><span class="long">FOLD AS LANGUAGES</span><span class="short">FOLD</span><span
							class="sub">{foldCodes.join(' · ')}</span
						></button
					>
				{:else}
					<!-- Index Books: GROUP, for singles only. -->
					<button type="button" class="group" disabled={!canGroup} onclick={() => (grouping = true)}
						>GROUP</button
					>
				{/if}
				<!-- With reveal on and only hidden tiles selected, the same cell unhides them. -->
				<button
					type="submit"
					name="do"
					value={allHidden ? 'unhide' : 'hide'}
					disabled={selected.size === 0}>{allHidden ? 'UNHIDE' : 'HIDE'}</button
				>
				<!-- Asks first (doc/DELETING.md): duplicates are cleared in bulk. -->
				<button type="button" disabled={selected.size === 0} onclick={() => (deleting = true)}
					>DELETE</button
				>
			{/snippet}
		</BulkBar>
	</form>
{/if}

<SeriesSheet
	id={sheetId}
	shelves={data.shelves}
	onclose={() => (sheetId = null)}
	onchange={() => invalidateAll()}
/>

<GroupSheet
	open={grouping}
	books={groupBooks}
	existing={(volumes ? data.existingVolumes : data.existing).filter((s) => !selected.has(s.id))}
	noun={volumes ? 'VOLUMES' : 'BOOKS'}
	onclose={() => (grouping = false)}
/>

<ConfirmSheet
	open={deleting}
	title="DELETE {selected.size} SERIES?"
	lines={[
		`${selected.size} SELECTED${deletingTitles ? ` · ${deletingTitles}` : ''}`,
		'THEIR FILES MOVE TO THE TRASH FOLDER ON THE WORKSTATION.',
		'THEIR READING HISTORY GOES WITH THEM.',
		'A SCAN OR A SYNC WON’T BRING THEM BACK.'
	]}
	confirm="DELETE {selected.size}"
	action="?/delete"
	fields={{ id: [...selected].map(String) }}
	onclose={() => (deleting = false)}
	ondone={async () => {
		deleting = false;
		stopSelecting();
		await invalidateAll();
	}}
/>

<ShelfPicker
	open={pickerOpen}
	ids={[...selected]}
	shelves={data.shelves}
	onclose={() => (pickerOpen = false)}
/>

<style>
	.tag-title {
		flex: 1;
		gap: 10px;
		padding: 0 18px;
		font: 500 16px var(--font-mono);
		white-space: nowrap;
		overflow: hidden;
	}
	.tag-title .ns {
		color: var(--text-2);
	}
	.back {
		font: 500 16px var(--font-mono);
	}
	.people {
		display: flex;
		flex-wrap: wrap;
		gap: 8px;
		padding: 18px var(--pad);
	}
	.library {
		display: flex;
		flex-direction: column;
		flex: 1;
	}
	/* Room for the pinned bulk bar: two 60px rows and the rule above them. */
	.library.selecting {
		padding-bottom: 122px;
	}
	.brand {
		padding: 0 var(--pad);
		color: inherit;
		text-decoration: none;
	}
	.search-hint .long,
	.search-hint .short {
		display: none;
	}
	.cont-section {
		display: contents;
	}
	.to-history {
		color: inherit;
		text-decoration: none;
	}
	.to-history:active {
		color: var(--text-1);
	}
	/* Phone: the Japanese wordmark, four continue rows and the long search hint
	   do not fit, and multi-select needs the room the continue shelf takes. */
	@media (max-width: 599px) {
		.brand :global(.jp) {
			display: none;
		}
		.search-hint .short {
			display: inline;
		}
		.cont > :global(:nth-child(n + 3)) {
			display: none;
		}
		.selecting .cont-section {
			display: none;
		}
	}
	@media (min-width: 600px) {
		.search-hint .long {
			display: inline;
		}
	}
	/* Desktop: the wordmark and the shelves move into the sidebar. */
	@media (min-width: 1024px) and (pointer: fine) {
		.library :global(header .left:has(.brand)),
		.tabs {
			display: none;
		}
	}
	.search-hint {
		flex: 1;
		padding: 0 18px;
		font: 400 16px var(--font-mono);
		color: var(--text-2);
		white-space: nowrap;
		overflow: hidden;
	}
	.search-hint:hover {
		color: var(--text-1);
	}
	.cell-btn {
		padding: 0 var(--pad);
		border: 0;
		border-radius: 0;
		background: transparent;
		color: inherit;
		font: var(--type-control);
		cursor: pointer;
		white-space: nowrap;
	}
	.cell-btn:active:not(:disabled) {
		background: var(--surface-inverse);
		color: var(--text-inverse);
	}
	.cell-btn:disabled {
		opacity: 0.4;
		cursor: default;
	}
	.x {
		font: 500 18px var(--font-mono);
	}
	.selected-count {
		padding: 0 18px;
		font: 500 17px var(--font-mono);
	}
	.cont {
		flex-shrink: 0;
		display: grid;
		grid-template-columns: repeat(var(--cont-cols), minmax(0, 1fr));
		border-top: var(--hairline);
	}
	/* Two columns: the left one of each pair draws the divider. */
	@media (min-width: 1024px) {
		.cont > :global(:nth-child(odd)) {
			border-right-color: var(--line-1);
		}
	}
	.grid {
		display: grid;
		grid-template-columns: repeat(var(--grid-cols), minmax(0, 1fr));
		gap: 1px;
		background: var(--line-1);
		/* Both rules, as the mock draws them: under the tabs this doubles the
		   tabs' own bottom hairline, which is how Index Library.dc.html has it. */
		border-top: var(--hairline);
		border-bottom: var(--hairline);
	}
	.filler {
		background: var(--surface-page);
	}
	/* The end of the loaded pages: a label row, like the section labels. */
	.more {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 16px;
		min-height: 44px;
		padding: 0 var(--pad);
		font: var(--type-label);
		letter-spacing: var(--tracking-label);
		color: var(--text-2);
		border-top: var(--hairline);
	}
	.more button {
		min-height: 44px;
		padding: 0 12px;
		font: inherit;
		letter-spacing: inherit;
		color: var(--text-1);
		background: none;
		border: 0;
		cursor: pointer;
	}
	.none {
		margin: 0;
		padding: 24px var(--pad);
		font: var(--type-label);
		letter-spacing: var(--tracking-label);
		color: var(--text-2);
	}

	/* ---- empty ---- */
	.empty {
		flex: 1;
		display: flex;
		flex-direction: column;
		justify-content: center;
		gap: 28px;
		padding: 0 64px;
		max-width: 720px;
	}
	@media (max-width: 599px) {
		.empty {
			padding: 0 24px;
		}
	}
	.empty-label {
		font: var(--type-label);
		color: var(--text-2);
		letter-spacing: var(--tracking-label);
	}
	.empty h1 {
		margin: 0;
		font: var(--type-title-lg);
		text-wrap: pretty;
	}
	.empty p {
		margin: 0;
		font: var(--type-body);
		color: var(--text-2);
		text-wrap: pretty;
	}
	.sources {
		display: flex;
		flex-direction: column;
		border-top: var(--hairline);
	}
	.sources > div {
		display: flex;
		justify-content: space-between;
		gap: 12px;
		padding: 14px 0;
		border-bottom: var(--hairline);
		font: 400 15px var(--font-mono);
	}
	.dim {
		color: var(--text-2);
	}
	.folder {
		display: flex;
		flex-direction: column;
		gap: 6px;
	}
	.folder-label {
		font: 500 12px var(--font-mono);
		color: var(--text-2);
		letter-spacing: var(--tracking-label);
	}
	.folder-path {
		font: 500 15px var(--font-mono);
		padding: 14px 16px;
		border: 1px solid var(--line-2);
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.scan-form {
		display: flex;
		flex-direction: column;
		align-items: flex-start;
		gap: 12px;
	}
	.scan-message {
		font: var(--type-meta);
		color: var(--text-2);
	}
	/* FOLD AS LANGUAGES: the accent cell, its languages under it (Editions 1f). */
	.fold {
		flex-direction: column;
		gap: 2px;
		background: var(--accent) !important;
		color: var(--on-accent) !important;
	}
	.fold .sub {
		font: 400 12px var(--font-mono);
	}
	.fold .short {
		display: none;
	}
	@media (max-width: 599px) {
		.fold .long {
			display: none;
		}
		.fold .short {
			display: inline;
		}
	}
	.fold-refused {
		position: fixed;
		left: var(--sheet-left, 0);
		right: 0;
		bottom: calc(121px + env(safe-area-inset-bottom));
		z-index: 10;
		padding: 14px var(--pad, 24px);
		background: var(--surface-panel);
		border-top: var(--hairline);
		font: 500 13px var(--font-mono);
		color: var(--accent);
	}
</style>

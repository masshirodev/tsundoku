<script lang="ts">
	import { onMount } from 'svelte';
	import { MediaQuery } from 'svelte/reactivity';
	import { beforeNavigate, goto, replaceState } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { page as appPage } from '$app/state';
	import { offline } from '$lib/offline.svelte';
	import {
		ProgressClock,
		metaLine,
		pageLabel,
		settingsLabel,
		spreadOf,
		spreads,
		swipeAction,
		tapAction,
		type Fit,
		type Mode,
		type Page
	} from '$lib/reader/reader';
	import PageImage from './PageImage.svelte';
	import Chrome from './Chrome.svelte';
	import ReadingSheet from './ReadingSheet.svelte';
	import EndPage from './EndPage.svelte';
	import Strip from './Strip.svelte';

	/**
	 * The image reader (Index Reader; doc/READER.md). The page is the
	 * interface: nothing is on screen but the art until a tap in the middle
	 * asks for the controls.
	 */
	let { data } = $props();

	// ---- settings -------------------------------------------------------------------
	// Mode is the session's, starting from the series; fit, spreads and dim are
	// the device's, kept in this browser only (they're about the screen).
	const KEY = 'tsundoku.reader.';
	function stored<T>(name: string, fallback: T): T {
		try {
			const v = localStorage.getItem(KEY + name);
			return v === null ? fallback : (JSON.parse(v) as T);
		} catch {
			return fallback;
		}
	}
	function store(name: string, value: unknown) {
		try {
			localStorage.setItem(KEY + name, JSON.stringify(value));
		} catch {
			// Private windows and blocked storage: the setting lasts this session.
		}
	}

	// The series' mode is where a session starts, not a binding to it.
	// svelte-ignore state_referenced_locally
	let mode = $state<Mode>(data.series.mode);
	// svelte-ignore state_referenced_locally
	let seriesMode = $state<Mode>(data.series.mode);
	let fit = $state<Fit>('screen');
	let spreadsOn = $state(false);
	let dim = $state(0);
	let shift = $state(false);
	onMount(() => {
		fit = stored<Fit>('fit', 'screen');
		spreadsOn = stored('spreads', false);
		dim = stored('dim', 0);
	});

	const landscape = new MediaQuery('(orientation: landscape)', false);
	const useSpreads = $derived(mode !== 'vertical' && spreadsOn && landscape.current);

	// ---- the series' own fields, optimistic ------------------------------------------
	// svelte-ignore state_referenced_locally
	let rating = $state<number>(data.series.books ? data.entry.rating : data.series.rating);
	// svelte-ignore state_referenced_locally
	let favourite = $state(data.series.books ? data.entry.favourite : data.series.favourite);

	async function action(name: string, form: Record<string, string>) {
		const body = new FormData();
		for (const [k, v] of Object.entries(form)) body.set(k, v);
		await fetch(`${resolve('/series/[id]', { id: String(data.series.id) })}?/${name}`, {
			method: 'POST',
			body,
			headers: { 'x-sveltekit-action': 'true' }
		}).catch(() => undefined);
	}
	function rate(n: number) {
		rating = n;
		// A book in a series of books keeps its own rating (doc/BOOKS.md).
		if (data.series.books)
			void action('bookRate', { entry: String(data.entry.id), rating: String(n) });
		else void action('rate', { rating: String(n) });
	}
	function toggleFav() {
		favourite = !favourite;
		const on = favourite ? '1' : '0';
		if (data.series.books) void action('bookFavourite', { entry: String(data.entry.id), on });
		else void action('favourite', { on });
	}
	function remember() {
		seriesMode = mode;
		void action('direction', { direction: mode });
	}

	// ---- pages and position ------------------------------------------------------------
	const pages = $derived<Page[]>(data.pages);
	const groups = $derived(spreads(pages, useSpreads, shift));
	const pageSrc = (entryId: number, version: string, i: number) =>
		`${resolve('/api/entries/[id]/pages/[n]', { id: String(entryId), n: String(i) })}?v=${encodeURIComponent(version)}`;
	const src = $derived((i: number) => pageSrc(data.entry.id, data.manifest?.version ?? '', i));

	/** The page the reader is on (0-based); the end page is `pages.length`. */
	let at = $state(0);
	let atEnd = $state(false);
	let chrome = $state(false);
	let sheet = $state(false);
	/** Vertical: where the next chapter's first page sat when the reader crossed into it. */
	let crossOffset = $state(0);

	// A new entry (or the first): start where the server says.
	let shown = 0;
	$effect(() => {
		const id = data.entry.id;
		if (id === shown) return;
		shown = id;
		at = data.start;
		atEnd = false;
		shift = false;
		sheet = false;
		finished = false;
		// A book in a series of books shows its own rating and FAV.
		rating = data.series.books ? data.entry.rating : data.series.rating;
		favourite = data.series.books ? data.entry.favourite : data.series.favourite;
		clock.resume(Date.now());
		void send('open', data.start);
	});

	const group = $derived(groups[spreadOf(groups, at)] ?? [at]);

	function go(to: number) {
		if (pages.length === 0) return;
		atEnd = false;
		at = Math.max(0, Math.min(pages.length - 1, to));
	}

	function next() {
		if (atEnd) return continueOn();
		const g = spreadOf(groups, at);
		if (g >= groups.length - 1) {
			atEnd = true;
			markFinished();
			return;
		}
		at = groups[g + 1][0];
	}

	function prev() {
		if (atEnd) {
			atEnd = false;
			return;
		}
		const g = spreadOf(groups, at);
		if (g > 0) at = groups[g - 1][0];
		else if (data.prev?.available)
			// eslint-disable-next-line svelte/no-navigation-without-resolve -- built from resolve()
			void goto(`${resolve('/read/[entry]', { entry: String(data.prev.id) })}?p=last`, {
				replaceState: true
			});
	}

	const endVariant = $derived(
		!data.next
			? 'series'
			: !offline.online
				? 'offline'
				: !data.next.available
					? 'missing'
					: 'chapter'
	);

	function continueOn(offset = 0) {
		if (endVariant !== 'chapter' || !data.next) return;
		markFinished();
		crossOffset = offset;
		void goto(resolve('/read/[entry]', { entry: String(data.next.id) }), {
			replaceState: true,
			noScroll: true
		});
	}

	function chapter(to: 'prev' | 'next') {
		const target = to === 'next' ? data.next : data.prev;
		if (!target) return;
		void goto(resolve('/read/[entry]', { entry: String(target.id) }), { replaceState: true });
	}

	// ---- progress ------------------------------------------------------------------------
	// Everything goes through /api/reading, which refuses to write while
	// incognito (doc/PRIVACY.md). Nothing here decides that.
	const clock = new ProgressClock(Date.now());
	let finished = false;
	let saved = $state(true);

	async function send(kind: 'open' | 'page' | 'finish' | 'close', page: number) {
		if (!data.manifest) return;
		const body = JSON.stringify({
			seriesId: data.series.id,
			entryId: data.entry.id,
			kind,
			page,
			durationMs: kind === 'open' ? 0 : clock.lap(Date.now())
		});
		if (kind === 'close') {
			navigator.sendBeacon?.(
				resolve('/api/reading'),
				new Blob([body], { type: 'application/json' })
			);
			return;
		}
		try {
			const res = await fetch(resolve('/api/reading'), {
				method: 'POST',
				body,
				headers: { 'content-type': 'application/json' },
				keepalive: true
			});
			if (res.ok) saved = ((await res.json()) as { saved: boolean }).saved;
		} catch {
			// Offline: progress catches up with the next event that gets through.
		}
	}

	function markFinished() {
		if (finished || pages.length === 0) return;
		finished = true;
		void send('finish', pages.length - 1);
	}

	// A page event once the reader has settled on a page, not on every flick.
	let settle: ReturnType<typeof setTimeout> | undefined;
	$effect(() => {
		const page = group[group.length - 1];
		if (data.entry.id !== shown || atEnd) return;
		clearTimeout(settle);
		settle = setTimeout(() => {
			void send('page', page);
			// Keep the URL on the page, so a reload resumes here.
			const url = new URL(appPage.url);
			url.searchParams.set('p', String(group[0] + 1));
			// eslint-disable-next-line svelte/no-navigation-without-resolve -- the current URL, with ?p
			replaceState(url, {});
			if (page >= pages.length - 1 && mode !== 'vertical') markFinished();
		}, 800);
		return () => clearTimeout(settle);
	});

	beforeNavigate(({ to }) => {
		// Moving between chapters is not leaving: the next one sends its own open.
		if (to?.route.id !== '/read/[entry]') void send('close', group[0]);
	});

	// ---- the vertical strip's next chapter ----------------------------------------------
	let nextPages = $state<Page[] | null>(null);
	let nextVersion = $state('');
	$effect(() => {
		nextPages = null;
		const n = data.next;
		if (mode !== 'vertical' || !n?.available || !offline.online) return;
		let cancelled = false;
		void fetch(resolve('/api/entries/[id]/pages', { id: String(n.id) }))
			.then((r) => (r.ok ? r.json() : null))
			.then((m: { pages: Page[]; version: string } | null) => {
				if (cancelled || !m) return;
				nextPages = m.pages;
				nextVersion = m.version;
			})
			.catch(() => undefined);
		return () => {
			cancelled = true;
		};
	});

	// ---- touch -----------------------------------------------------------------------------
	let down: { x: number; y: number } | null = null;
	function pointerdown(e: PointerEvent) {
		down = { x: e.clientX, y: e.clientY };
	}
	function pointerup(e: PointerEvent) {
		if (!down) return;
		const dx = e.clientX - down.x;
		const dy = e.clientY - down.y;
		down = null;
		const swipe = swipeAction(dx, dy, mode);
		if (swipe) {
			chrome = false;
			return swipe === 'next' ? next() : prev();
		}
		if (Math.hypot(dx, dy) > 10) return;
		// With the controls up, a tap on the page only puts them away.
		if (chrome) {
			chrome = false;
			return;
		}
		const action = tapAction(e.clientX, window.innerWidth, mode);
		if (action === 'chrome') chrome = true;
		else if (action === 'next') next();
		else prev();
	}

	function keydown(e: KeyboardEvent) {
		if (sheet) {
			if (e.key === 'Escape') sheet = false;
			return;
		}
		if (e.key === 'Escape') chrome = !chrome;
		if (mode === 'vertical') return;
		const left = e.key === 'ArrowLeft';
		const right = e.key === 'ArrowRight';
		if (left || right) {
			e.preventDefault();
			// Arrows are spatial: in R->L, left is forward.
			if (left === (mode === 'rtl')) next();
			else prev();
		} else if (e.key === ' ' || e.key === 'PageDown') {
			e.preventDefault();
			next();
		} else if (e.key === 'PageUp') {
			e.preventDefault();
			prev();
		}
	}

	// ---- the screen stays awake while a page is showing -------------------------------
	onMount(() => {
		let lock: { release(): Promise<void> } | null = null;
		const wake = async () => {
			try {
				lock =
					(await (
						navigator as Navigator & {
							wakeLock?: { request(t: 'screen'): Promise<{ release(): Promise<void> }> };
						}
					).wakeLock?.request('screen')) ?? null;
			} catch {
				// Not allowed (no secure context, battery saver): the screen may sleep.
			}
		};
		const visible = () => {
			if (document.visibilityState === 'visible') {
				clock.resume(Date.now());
				void wake();
			}
		};
		void wake();
		document.addEventListener('visibilitychange', visible);
		const leave = () => send('close', group[0]);
		addEventListener('pagehide', leave);
		return () => {
			document.removeEventListener('visibilitychange', visible);
			removeEventListener('pagehide', leave);
			void lock?.release().catch(() => undefined);
		};
	});

	// Preload the next screen's pages so a turn is instant.
	$effect(() => {
		const g = spreadOf(groups, at);
		for (const i of groups[g + 1] ?? []) {
			const img = new Image();
			img.src = src(i);
		}
	});

	// ---- what the chrome says -----------------------------------------------------------
	const seriesHref = $derived(resolve('/series/[id]', { id: String(data.series.id) }));
	const libraryHref = resolve('/');
	const meta = $derived(
		metaLine({
			kind: data.series.kind,
			entry: data.entry.name,
			count: data.series.count,
			page: atEnd ? 'END' : pageLabel(group, pages.length),
			incognito: data.incognito || !saved,
			single: data.series.single
		})
	);
	const position = $derived(`${data.entry.index + 1} OF ${data.series.count}`);
	const title = $derived(
		data.series.books
			? `${data.series.title} · ${data.entry.title || data.entry.name}`
			: data.series.title
	);
	// In R->L the first page sits on the right of a spread.
	const ordered = $derived(mode === 'rtl' ? [...group].reverse() : group);
</script>

<svelte:head><title>{data.series.title} · {data.entry.name}</title></svelte:head>
<svelte:window onkeydown={keydown} />

<div class="reader" class:vertical={mode === 'vertical'} class:incognito={data.incognito}>
	{#if !data.manifest}
		<div class="missing">
			<div class="mt">{data.entry.name} IS NOT DOWNLOADED</div>
			<div class="md">IT WAS READ ONLINE, OR ISN'T COPIED OVER YET</div>
			<!-- eslint-disable-next-line svelte/no-navigation-without-resolve -- resolved above -->
			<a href={seriesHref}>← SERIES</a>
		</div>
	{:else if mode === 'vertical'}
		{#key data.entry.id}
			<Strip
				{pages}
				{src}
				start={data.start}
				offset={crossOffset}
				ended="END · {data.entry.name}"
				{position}
				next={data.next?.available ? data.next : null}
				{nextPages}
				nextSrc={(i) => (data.next ? pageSrc(data.next.id, nextVersion, i) : '')}
				onpage={(i) => {
					at = i;
					// A fast scroll can skip the end marker; the last page is enough.
					if (i >= pages.length - 1) markFinished();
				}}
				onend={markFinished}
				oncross={(top) => continueOn(top)}
				ontap={() => (chrome = !chrome)}
			/>
		{/key}
		{#if !data.next?.available}
			<EndPage
				variant={endVariant}
				entryName={data.entry.name}
				{position}
				kind={data.series.kind}
				seriesTitle={data.series.title}
				next={data.next}
				{rating}
				{favourite}
				incognito={data.incognito}
				mode="ltr"
				lastPage={pageLabel([pages.length - 1], pages.length)}
				{seriesHref}
				{libraryHref}
				onrate={rate}
				onfav={toggleFav}
				onback={() => undefined}
			/>
		{/if}
	{:else if atEnd}
		<!-- svelte-ignore a11y_no_static_element_interactions -->
		<div class="stage" onpointerdown={pointerdown} onpointerup={pointerup}>
			<EndPage
				variant={endVariant}
				entryName={data.entry.name}
				{position}
				kind={data.series.kind}
				seriesTitle={data.series.title}
				next={data.next}
				{rating}
				{favourite}
				incognito={data.incognito}
				{mode}
				lastPage={pageLabel([pages.length - 1], pages.length)}
				{seriesHref}
				{libraryHref}
				onrate={rate}
				onfav={toggleFav}
				onback={() => (atEnd = false)}
			/>
		</div>
	{:else}
		<!-- Taps and swipes are read here; the keyboard has its own path above. -->
		<!-- svelte-ignore a11y_no_static_element_interactions -->
		<div class="stage fit-{fit}" onpointerdown={pointerdown} onpointerup={pointerup}>
			{#each ordered as i, k (src(i))}
				<PageImage
					src={src(i)}
					number={i + 1}
					w={pages[i].w}
					h={pages[i].h}
					{fit}
					share={ordered.length}
					side={ordered.length === 1 ? 'center' : k === 0 ? 'left' : 'right'}
				/>
			{/each}
		</div>
	{/if}

	{#if data.incognito}<div class="dashed" aria-hidden="true"></div>{/if}
	{#if dim > 0}<div class="dim" style:opacity={dim} aria-hidden="true"></div>{/if}

	{#if chrome && data.manifest}
		<Chrome
			{title}
			{meta}
			backHref={seriesHref}
			incognito={data.incognito}
			{rating}
			{favourite}
			mode={mode === 'vertical' ? 'ltr' : mode}
			page={group[0]}
			total={pages.length}
			prev={data.prev?.name ?? null}
			next={data.next?.name ?? null}
			settings={settingsLabel(mode, fit, useSpreads)}
			shift={useSpreads}
			onfav={toggleFav}
			onsheet={() => (sheet = true)}
			onscrub={(p) =>
				mode === 'vertical'
					? document.querySelector(`[data-index="${p}"]`)?.scrollIntoView({ block: 'start' })
					: go(p)}
			onchapter={chapter}
			onshift={() => (shift = !shift)}
		/>
	{/if}

	{#if sheet}
		<ReadingSheet
			{mode}
			{seriesMode}
			{fit}
			spreads={spreadsOn}
			landscape={landscape.current}
			{dim}
			{rating}
			onmode={(m) => (mode = m)}
			onremember={remember}
			onfit={(f) => {
				fit = f;
				store('fit', f);
			}}
			onspreads={(on) => {
				spreadsOn = on;
				store('spreads', on);
			}}
			ondim={(d) => {
				dim = d;
				store('dim', d);
			}}
			onrate={rate}
			onclose={() => (sheet = false)}
		/>
	{/if}
</div>

<style>
	/*
	 * The reader is always dark, whatever the library's theme: its ground is
	 * true black so letterboxing disappears on OLED, and light chrome over a
	 * black page would glare. The tokens are pinned here to the dark set.
	 */
	.reader {
		--surface-page: var(--graphite-950);
		--surface-panel: var(--graphite-900);
		--surface-inverse: var(--graphite-100);
		--line-1: var(--graphite-700);
		--line-2: var(--graphite-600);
		--text-1: var(--graphite-100);
		--text-2: var(--graphite-400);
		--text-inverse: var(--graphite-950);
		--on-accent: var(--graphite-950);
		--hairline: 1px solid var(--graphite-700);
		--rule-strong: 1px solid var(--graphite-100);
		--rating-off: var(--graphite-600);
		position: relative;
		min-height: 100dvh;
		background: #000;
		color: var(--text-1);
		user-select: none;
		-webkit-user-select: none;
		-webkit-touch-callout: none;
	}
	.stage {
		width: 100vw;
		height: 100dvh;
		display: flex;
		align-items: center;
		justify-content: center;
		overflow: hidden;
		touch-action: none;
	}
	/* Fit width and fit height let the page overflow and scroll the other way. */
	.stage.fit-width {
		align-items: flex-start;
		overflow-y: auto;
		touch-action: pan-y;
	}
	.stage.fit-height {
		overflow-x: auto;
		justify-content: safe center;
		touch-action: pan-x;
	}
	.dashed {
		position: fixed;
		top: 0;
		left: 0;
		right: 0;
		z-index: 25;
		border-top: 2px dashed var(--text-2);
		pointer-events: none;
	}
	.dim {
		position: fixed;
		inset: 0;
		z-index: 15;
		background: #000;
		pointer-events: none;
	}
	.missing {
		width: 100vw;
		height: 100dvh;
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		gap: 12px;
		padding: 24px;
		text-align: center;
	}
	.mt {
		font: 500 16px var(--font-mono);
	}
	.md {
		font: 400 13px var(--font-mono);
		color: var(--text-2);
	}
	.missing a {
		margin-top: 18px;
		display: flex;
		align-items: center;
		height: 56px;
		padding: 0 32px;
		border: 1px solid var(--line-2);
		color: var(--text-1);
		font: 500 15px var(--font-mono);
		text-decoration: none;
	}
</style>

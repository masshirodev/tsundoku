<script lang="ts">
	import { ocrLines, type OcrPlace } from '$lib/japanese/ocr';
	import { enhance } from '$app/forms';
	import { replacing } from '$lib/back';
	import Badge from '$lib/components/content/Badge.svelte';
	import { coverPlaceholder } from '$lib/library/cover';
	import RatingSlider from '$lib/components/controls/RatingSlider.svelte';
	import {
		continueAction,
		directionOptions,
		directionRowLabel,
		effectiveDirection,
		fileMeta,
		seriesMeta,
		tagGroups,
		type SeriesPage
	} from '$lib/library/series';
	import type { Shelf } from '$lib/library/types';
	import { isBookSeries, isVolumeSeries } from '$lib/library/series';
	import { isPersonNamespace, suggestionLabel, type Suggestion } from '$lib/library/books';
	import { coverSrc, tagHref, readHref, withParam } from '$lib/library/links';
	import Band from '$lib/components/chrome/Band.svelte';
	import { invalidateAll } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { postAction, saves } from '$lib/saves.svelte';
	import type { Rating } from '$lib/library/types';
	import type { BookEditions } from '$lib/server/editions';
	import { baseToEdition, langName } from '$lib/library/editions';
	import UnfoldSheet from './UnfoldSheet.svelte';
	import type { LinkState } from '$lib/server/catalogue';
	import { anilistUrl, malUrl, viaLabel } from '$lib/library/catalogue';
	import { offline } from '$lib/offline.svelte';
	import TrackingSheet from './TrackingSheet.svelte';
	import type { Tracking } from '$lib/server/tracking';
	import { ago, clock, trackLine } from '$lib/library/tracking';
	import { ranobeLines } from '$lib/library/ranobe';
	import type { RanobeSeries } from '$lib/server/ranobe-review';
	import type { SeriesDownloads } from '$lib/server/downloads';
	import {
		downloadCounts,
		downloadRow,
		fileQueueMeta,
		type DownloadState
	} from '$lib/library/downloads';
	import { page } from '$app/state';

	/**
	 * The series' metadata: a header that scrolls away in portrait, a 440px
	 * panel with its own scroll in landscape (the CSS decides which). Order is
	 * the handoff's: identity, then rating and FAV, then CONTINUE -- all within
	 * thumb reach -- then direction, shelves, tags, about, and the file row with
	 * HIDE at the very end, away from CONTINUE.
	 */
	let {
		series,
		shelves,
		cached,
		onedit,
		ondelete,
		suggestion = null,
		dismissedKey = null,
		onreview,
		cta = $bindable<HTMLElement | null>(null),
		outline = false,
		ocr = null,
		words = null,
		twin = null,
		editions = null,
		link = null,
		tracking = null,
		ranobe = null,
		downloads = null
	}: {
		series: SeriesPage;
		shelves: Shelf[];
		/** Entries of this series cached on the device. */
		cached: number;
		onedit: () => void;
		/** DELETE: the page asks first (doc/DELETING.md). */
		ondelete?: () => void;
		/** "Might be one series": only on a single book, only visible books. */
		suggestion?: Suggestion | null;
		/** Set just after NOT A SERIES, so the band can offer UNDO. */
		dismissedKey?: string | null;
		onreview?: () => void;
		/** The CONTINUE bar, observed by the page to know when it scrolled away. */
		cta?: HTMLElement | null;
		/**
		 * Waiting (Loading States 1g, 1h): only what the tapped tile knew is
		 * real -- cover, title, kind, rating, FAV, counts. The rest is drawn in
		 * outline, and CONTINUE doesn't open until its chapter is known.
		 */
		outline?: boolean;
		/** OCR's progress on the workstation (Index Japanese 4a); null for novels. */
		ocr?: OcrPlace | null;
		/** Words looked up in it: waiting for review, and sent to Kumiko. */
		words?: { toReview: number; sent: number } | null;
		/** A likely twin of a book here (doc/DUPLICATE-BOOKS.md): the SAME BOOK AS band. */
		twin?: { key: string; title: string; conf: string; pages: string } | null;
		/** One book in several languages (doc/EDITIONS.md): LANGUAGE, EDITIONS and FOLDED. */
		editions?: BookEditions | null;
		/** Its catalogue link (doc/LINKS.md): the LINK and COVER rows. Null for a doujin. */
		link?: LinkState | null;
		/** What the catalogues' lists say of it, and what was sent (doc/TRACKING.md). */
		tracking?: Tracking | null;
		/**
		 * A novel's Ranobe link and line (doc/RANOBE.md). With a token, they
		 * stand in for AniList's LINK and TRACKING rows: Ranobe is where a
		 * novel's reads go. Null for a comic.
		 */
		ranobe?: RanobeSeries | null;
		/** Downloading through Suwayomi (doc/DOWNLOADING.md): the DOWNLOAD row and the FILE line's queue. */
		downloads?: SeriesDownloads | null;
	} = $props();

	// ---- DOWNLOAD (Index Series Download) ------------------------------------------------
	const dlStates = $derived(
		downloads?.kind === 'ok'
			? new Map(Object.entries(downloads.states).map(([k, v]) => [Number(k), v as DownloadState]))
			: null
	);
	const dlRow = $derived(
		dlStates
			? downloadRow(
					series.entries,
					{ kind: 'ok', states: dlStates },
					offline.online,
					clock,
					downloads?.kind === 'ok' ? downloads.follow : null,
					(at) => ago(at, Date.now())
				)
			: downloads?.kind === 'down'
				? downloadRow(series.entries, downloads, offline.online, clock)
				: null
	);
	const dlFile = $derived(dlStates ? fileQueueMeta(downloadCounts(series.entries, dlStates)) : []);
	// No extension for its source (Bato.to, Hitomi): said once, on the FILE line (state 4).
	const elsewhere = $derived(
		downloads?.kind === 'elsewhere'
			? ` · ${downloads.source.toUpperCase()} DOWNLOADS ON THE TABLET`
			: ''
	);

	// ---- Ranobe's LINK and TRACKING rows (Ranobe Series 2a–2k) --------------------------------
	const onRanobe = $derived(!!ranobe?.configured);
	const ranobeFindHref = $derived(`${resolve('/links')}?series=${series.id}&service=ranobe`);
	const ranobeTrack = $derived(
		ranobe
			? ranobeLines(ranobe.facts, {
					now: Date.now(),
					offline: !offline.online,
					ago,
					clock
				})
			: null
	);

	// ---- the TRACKING row (Series Link 1k–1s) ------------------------------------------------
	let trackingOpen = $state(false);
	const trackLines = $derived.by(() => {
		if (!tracking) return [];
		if (tracking.hidden)
			return [
				{
					left: 'NOTHING SENT · HIDDEN SERIES STAY OFF BOTH LISTS',
					right: '',
					strong: false,
					alert: false
				}
			];
		if (tracking.coverOnly)
			return [
				{ left: 'NEVER TRACKED · COVER AND DETAILS ONLY', right: '', strong: false, alert: false }
			];
		const mainIsEmpty = !tracking.facts.find((f) => f.service === 'anilist')?.state;
		return tracking.facts
			.filter((f) => f.linked)
			.map((f) => trackLine(f, { now: Date.now(), offline: linkOff, mainIsEmpty }));
	});
	const trackFailed = $derived(!!tracking?.facts.some((f) => f.waiting?.failedAt));
	const trackSignIn = $derived(
		!!tracking &&
			!tracking.hidden &&
			!tracking.coverOnly &&
			tracking.facts.some((f) => f.linked && !f.signedIn)
	);
	const trackEditable = $derived(
		!!tracking &&
			!tracking.hidden &&
			!tracking.coverOnly &&
			tracking.facts.some((f) => f.linked && f.signedIn)
	);

	// ---- the LINK and COVER rows (Series Link 1k–1t) ---------------------------------------
	const linkOff = $derived(!offline.online);
	const linkPrimary = $derived(
		!link?.linked ? 'Not linked' : link.linked.title || link.linked.ids || 'Linked'
	);
	const linkMeta = $derived.by(() => {
		if (!link) return '';
		const l = link.linked;
		if (l) {
			if (linkOff) return '○ OFFLINE · CHANGES NEED THE WORKSTATION';
			return [
				l.ids,
				viaLabel(l.via),
				l.coverOnly
					? series.kind === 'novel'
						? 'THE COMIC’S ENTRY · COVER AND DETAILS ONLY, NEVER TRACKED'
						: 'THE NOVEL’S ENTRY · COVER AND DETAILS ONLY, NEVER TRACKED'
					: '',
				l.resolving ? 'ANILIST ASKED IN THE NEXT COVER PASS' : '',
				link.hidden ? 'HIDDEN SERIES ARE NEVER SEARCHED' : ''
			]
				.filter(Boolean)
				.join(' · ');
		}
		if (linkOff) return '○ OFFLINE · FINDING NEEDS THE WORKSTATION';
		if (link.hidden) return 'HIDDEN SERIES ARE NEVER SEARCHED · PASTE A LINK';
		if (link.queued) return 'A SEARCH WAITS FOR THE NEXT COVER PASS';
		if (link.candidates)
			return `${link.candidates} CANDIDATE${link.candidates === 1 ? '' : 'S'} FROM THE LAST COVER PASS · NONE EXACT`;
		return link.searched ? 'NOTHING FOUND IN THE LAST COVER PASS' : 'NOT SEARCHED YET';
	});
	const findHref = $derived(`${resolve('/links')}?series=${series.id}`);
	const openHref = $derived(
		link?.linked
			? link.linked.anilistId
				? anilistUrl(link.linked.anilistId)
				: link.linked.malId
					? malUrl(link.linked.malId)
					: null
			: null
	);

	// ---- a folded book (Editions 1b, 1c) ---------------------------------------------------
	/** The edition it opens in: its title leads, READ opens it, its pages are the grid. */
	const opening = $derived(
		editions ? (editions.editions.find((e) => e.entryId === editions.opens) ?? null) : null
	);
	/** Where the book is, in the opening edition's pages (0-based). */
	const openingAt = $derived(
		editions && opening && editions.at !== null
			? opening.base
				? editions.at
				: baseToEdition(opening.rows, editions.at).page
			: null
	);
	const sameSize = $derived(
		!!editions &&
			editions.editions[0].size !== '' &&
			editions.editions.every((e) => e.size === editions.editions[0].size)
	);
	/** The language READ would open in without this book's own choice. */
	const defaultLanguage = $derived(
		editions
			? editions.editions.some((e) => e.language === editions.preferred)
				? editions.preferred
				: (editions.lastRead ?? editions.editions[0].language)
			: ''
	);
	const foldedOn = $derived(
		editions?.folded ? new Date(editions.folded).toLocaleDateString('sv-SE') : null
	);
	let unfolding = $state(false);
	const ocrRow = $derived(ocr ? ocrLines(ocr) : null);

	// Rating and FAV show their new value at once and save behind it. A save
	// that fails keeps the value, drawn dashed, with RETRY and PUT BACK in the
	// layout's band (Loading States 1o).
	const actionBase = $derived(resolve('/series/[id]', { id: String(series.id) }));
	let ratingNow = $state<Rating | null>(null);
	let favNow = $state<boolean | null>(null);
	const rating = $derived(ratingNow ?? series.rating);
	const favourite = $derived(favNow ?? series.favourite);
	$effect(() => {
		// The stored values moved (the save landed, or the page changed): drop the local ones.
		void series.rating;
		void series.favourite;
		void series.id;
		if (!saves.unsaved(`rating:${series.id}`)) ratingNow = null;
		if (!saves.unsaved(`fav:${series.id}`)) favNow = null;
	});
	async function rate(n: Rating) {
		const was = series.rating;
		ratingNow = n;
		const save = () => postAction(`${actionBase}?/rate`, { rating: String(n) });
		saves.clear(`rating:${series.id}`);
		if (await save()) return void invalidateAll();
		saves.fail({
			what: `RATING ${n} NOT SAVED`,
			putBackLabel: `PUT BACK ${was}`,
			key: `rating:${series.id}`,
			retry: async () => {
				const ok = await save();
				if (ok) void invalidateAll();
				return ok;
			},
			putBack: () => (ratingNow = null)
		});
	}
	async function toggleFav() {
		const on = !favourite;
		favNow = on;
		const save = () => postAction(`${actionBase}?/favourite`, { on: on ? '1' : '0' });
		saves.clear(`fav:${series.id}`);
		if (await save()) return void invalidateAll();
		saves.fail({
			what: on ? 'FAV NOT SAVED' : 'UNFAV NOT SAVED',
			putBackLabel: on ? 'PUT BACK · NOT FAV' : 'PUT BACK · FAV',
			key: `fav:${series.id}`,
			retry: async () => {
				const ok = await save();
				if (ok) void invalidateAll();
				return ok;
			},
			putBack: () => (favNow = null)
		});
	}
	const ratingUnsaved = $derived(saves.unsaved(`rating:${series.id}`));
	const favUnsaved = $derived(saves.unsaved(`fav:${series.id}`));

	const action = $derived(continueAction(series));
	const direction = $derived(effectiveDirection(series));
	const tags = $derived(tagGroups(series.tags));
	const onShelves = $derived(
		shelves.filter(
			(s) => s.kind === 'collection' && series.collections.includes(Number(s.key.slice(2)))
		)
	);
	// A novel without a cover image of its own is set in type, not striped.
	const noCover = $derived(series.kind === 'novel' && !series.cover);
	let aboutOpen = $state(false);
	/** Where the cover goes: the same place as ▶ CONTINUE, once it's known. */
	const resumeHref = $derived(
		opening && !outline
			? readHref(opening.entryId)
			: action.entry && !outline && action.entry.available
				? readHref(action.entry.id)
				: undefined
	);
	// The chapter it would open has no file yet (Download States 1e, after adding):
	// START is dimmed until it has one, as a row with no file doesn't open.
	const noFile = $derived(!outline && !opening && !!action.entry && !action.entry.available);
	const ctaLabel = $derived(
		opening && editions && !editions.read && openingAt !== null
			? `READ FROM P. ${openingAt + 1}`
			: action.label
	);
</script>

<section class="panel" aria-label="About this series">
	<div class="identity">
		<!-- The cover resumes, as ▶ CONTINUE does: the biggest thing on the screen is the way in.
		     A second way for the finger only: CONTINUE is the one a screen reader and Tab find. -->
		<!-- eslint-disable-next-line svelte/no-navigation-without-resolve -- readHref() resolves -->
		<svelte:element
			this={resumeHref ? 'a' : 'div'}
			href={resumeHref}
			aria-hidden={resumeHref ? 'true' : undefined}
			tabindex={resumeHref ? -1 : undefined}
			class="cover"
			class:typeset={noCover}
			style:background={noCover
				? undefined
				: series.cover
					? `center / cover no-repeat url(${coverSrc(series.id, series.cover)}), ${coverPlaceholder(series.hue)}`
					: coverPlaceholder(series.hue)}
		>
			{#if noCover}
				<span class="nocover">NO COVER · EPUB</span>
				<span class="nocover-title">{series.title}</span>
			{/if}
			{#if series.hidden}<Badge tone="reveal" corner="top-left">HIDDEN</Badge>{/if}
			{#if favourite}<Badge tone="accent" corner="top-right">FAV</Badge>{/if}
		</svelte:element>
		<div class="names">
			<div class="meta">
				{outline
					? series.kind.toUpperCase()
					: editions
						? `DOUJIN · ${editions.editions.length} LANGUAGES`
						: seriesMeta(series)}
			</div>
			<h1>{opening?.title || series.title}</h1>
			{#if outline}
				<div class="out-lines" aria-hidden="true">
					<i style:width="46%"></i><i style:width="62%"></i>
				</div>
			{:else if editions && opening}
				<!-- The other editions' titles, each with its language. -->
				{#each editions.editions.filter((e) => e !== opening) as e (e.entryId)}
					<div class="alt ed-alt"><span class="ed-code">{e.code}</span><span>{e.title}</span></div>
				{/each}
			{:else}
				{#each series.altTitles as alt (alt)}<div class="alt">{alt}</div>{/each}
			{/if}
		</div>
	</div>

	<!-- RATING (Ratings out of 10 1a, 1b): the blocky slider, FAV at its end. -->
	<RatingSlider
		value={rating}
		unsaved={ratingUnsaved}
		height={64}
		phoneHeight={52}
		onchange={(n) => rate(n as Rating)}
		fav={{ on: favourite, onclick: toggleFav, unsaved: favUnsaved }}
	/>

	<!-- eslint-disable svelte/no-navigation-without-resolve -- readHref() resolves -->
	<a
		class="cta"
		class:nofile={noFile}
		bind:this={cta}
		href={resumeHref}
		aria-disabled={!resumeHref}
	>
		<span>▶ {outline ? 'CONTINUE' : ctaLabel}</span>
		{#if outline}
			<i class="cta-out" aria-hidden="true"></i>
		{:else}
			<span class="cta-meta">
				{#if opening}
					<span class="long">{opening.code} · {opening.pages} PAGES</span>
					<span class="short">{opening.code}</span>
				{:else}
					<span class="long"
						>{action.meta}{noFile ? ' · NOT DOWNLOADED' : ''}{series.kind === 'doujin' && cached > 0
							? ' · ↓ CACHED'
							: ''}</span
					>
					<span class="short">{noFile ? 'NO FILE' : action.short || action.meta}</span>
				{/if}
			</span>
		{/if}
	</a>
	<!-- eslint-enable svelte/no-navigation-without-resolve -->

	{#if !outline && dlRow}
		<!-- DOWNLOAD (Index Series Download): under CONTINUE, as LINK's shape. NEXT never asks; ALL opens its confirmation by URL. -->
		{#snippet dlCells()}
			{#each dlRow?.cells ?? [] as c (c.which)}
				{#if c.dim}
					<span class="lc dim" class:acc={c.acc} aria-disabled="true">{c.label}</span>
				{:else if c.which === 'follow' || c.which === 'unfollow'}
					<form method="POST" action="?/follow" use:enhance class="lc-form">
						<input type="hidden" name="on" value={c.which === 'follow' ? '1' : '0'} />
						<button type="submit" class="lc" class:acc={c.acc}>{c.label}</button>
					</form>
				{:else if c.which === 'all'}
					<!-- eslint-disable-next-line svelte/no-navigation-without-resolve -- withParam() keeps the current, resolved path -->
					<a class="lc" href={withParam(page.url, 'download', 'all')} data-sveltekit-noscroll
						>{c.label}</a
					>
				{:else}
					<form method="POST" action="?/download" use:enhance class="lc-form">
						<input type="hidden" name="which" value="next" />
						<button type="submit" class="lc" class:acc={c.acc}>{c.label}</button>
					</form>
				{/if}
			{/each}
		{/snippet}
		<div class="row link-row dl-row" class:solo={dlRow.cells.length === 0}>
			<div class="label">DOWNLOAD</div>
			<div class="lk">
				<div class="lk-a">{dlRow.a}</div>
				<div class="lk-b">{dlRow.b}</div>
			</div>
			{#if dlRow.cells.length}<div class="lcs inline">{@render dlCells()}</div>{/if}
		</div>
		{#if dlRow.cells.length}<div class="lcs stack">{@render dlCells()}</div>{/if}
	{/if}

	{#if outline}
		{#each [directionRowLabel(series.kind), 'SHELVES', 'TAGS', 'FILE'] as label, i (label)}
			<div class="row out-row" aria-hidden="true">
				<div class="label">{label}</div>
				<div class="out-lines"><i style:width={['34%', '52%', '74%', '60%'][i]}></i></div>
			</div>
		{/each}
	{:else if suggestion}
		<!-- Index Books, state 7: under CONTINUE, on this book's screen only. -->
		<section class="sugg" aria-label="Might be one series">
			<div class="sugg-head">
				<span>MIGHT BE ONE SERIES</span>
				<span class="dim"
					>{suggestion.books.length} BOOKS · {suggestionLabel(suggestion.books)}</span
				>
			</div>
			<div class="sugg-covers">
				{#each suggestion.books as b (b.seriesId)}
					<span
						class="sugg-cover"
						class:this={b.seriesId === series.id}
						style:background={b.cover
							? `center / cover no-repeat url(${coverSrc(b.seriesId, b.cover)}), ${coverPlaceholder(b.hue)}`
							: coverPlaceholder(b.hue)}
						title={b.title}
					></span>
				{/each}
			</div>
			<div class="sugg-actions">
				<button type="button" onclick={() => onreview?.()}>REVIEW →</button>
				<form method="POST" action="?/dismiss" use:enhance>
					{#each suggestion.books as b (b.seriesId)}<input
							type="hidden"
							name="series"
							value={b.seriesId}
						/>{/each}
					<button type="submit" class="dim">NOT A SERIES</button>
				</form>
			</div>
		</section>
	{:else if dismissedKey}
		<Band title="NOT A SERIES · WON'T ASK AGAIN">
			{#snippet action()}
				<form method="POST" action="?/undoDismiss" use:enhance>
					<input type="hidden" name="key" value={dismissedKey} />
					<button type="submit">UNDO</button>
				</form>
			{/snippet}
		</Band>
	{/if}

	{#if !outline && twin}
		<!-- Duplicate Books 1d: the group suggestion's treatment, for a twin. -->
		<div class="twin" role="status">
			<div class="tw-text">
				<div class="tw-title">SAME BOOK AS {twin.title.toUpperCase()}</div>
				<div class="tw-meta">
					{twin.conf === 'likely' ? 'LIKELY' : twin.conf === 'maybe' ? 'MAYBE' : 'OTHER LANGUAGE'} · {twin.pages}
				</div>
			</div>
			<div class="tw-acts">
				<form method="POST" action="?/keepBoth" use:enhance>
					<input type="hidden" name="pair" value={twin.key} />
					<button type="submit">KEEP BOTH</button>
				</form>
				<!-- eslint-disable-next-line svelte/no-navigation-without-resolve -- built from resolve() -->
				<a href="{resolve('/duplicates')}?pair={encodeURIComponent(twin.key)}">REVIEW →</a>
			</div>
		</div>
	{/if}

	{#if !outline && editions && opening}
		<!-- LANGUAGE (Editions 1b): which edition it opens in. The default language clears the book's own choice. -->
		<form method="POST" action="?/language" use:enhance class="row">
			<div class="label">LANGUAGE</div>
			<div class="seg">
				{#each editions.editions as e (e.entryId)}
					<button
						type="submit"
						name="language"
						value={e.language === defaultLanguage ? '' : e.language}
						class:on={e === opening}
						aria-pressed={e === opening}
						><span class="lg-long">{e.code} · {langName(e.language)}</span><span class="lg-short"
							>{e.code}</span
						></button
					>
				{/each}
			</div>
		</form>
		{#if editions.own && editions.own !== defaultLanguage}
			<form method="POST" action="?/language" use:enhance class="row panel-row override">
				<div class="ov">
					THIS BOOK OPENS IN {langName(editions.own)} · OTHERS IN {langName(editions.preferred)}
				</div>
				<button type="submit" name="language" value="" class="edit">RESET</button>
			</form>
		{/if}
	{/if}

	{#if !outline}
		<form method="POST" action="?/direction" use:enhance class="row">
			<div class="label">{directionRowLabel(series.kind)}</div>
			<div class="seg">
				{#each directionOptions(series.kind) as d (d.value)}
					<button
						type="submit"
						name="direction"
						value={d.value}
						class:on={d.value === direction}
						aria-pressed={d.value === direction}>{d.label}</button
					>
				{/each}
			</div>
		</form>

		{#if ocrRow}
			<!-- Japanese (doc/JAPANESE.md): how far OCR has read it, on the panel ground. -->
			<form method="POST" action="?/ocr" use:enhance class="row panel-row ocr-row">
				<div class="label">OCR</div>
				<div class="ocr">
					<div class="oa">{ocrRow.a}</div>
					{#if ocrRow.bar !== null}
						<div class="obar"><div style:width="{ocrRow.bar * 100}%"></div></div>
					{/if}
					{#if ocrRow.b}<div class="ob">{ocrRow.b}</div>{/if}
					{#if ocr && ocr.notText > 0}
						<div class="ob">{ocr.notText} MARKED NOT TEXT</div>
					{/if}
				</div>
				{#if ocrRow.offer}<button type="submit" class="edit">OCR</button>{/if}
				{#if ocr && ocr.notText > 0}
					<!-- NOT TEXT is kept, not deleted: this puts every such block back. -->
					<button type="submit" class="edit" formaction="?/restoreText">RESTORE</button>
				{/if}
			</form>
			{#if ocr?.japanese && words && (words.toReview > 0 || words.sent > 0)}
				<div class="row panel-row">
					<div class="label">WORDS</div>
					<div class="wcount">
						<span>{words.toReview} TO REVIEW</span><span class="ws">{words.sent} SENT</span>
					</div>
					<!-- eslint-disable-next-line svelte/no-navigation-without-resolve -- built from resolve() -->
					<a class="edit" href="{resolve('/words')}?series={series.id}">REVIEW →</a>
				</div>
			{/if}
		{/if}

		{#if series.duplicates > 0 && series.scanlators.length > 1}
			<!-- One chapter, several scanlators (doc/DUPLICATES.md): whose copy the list shows. -->
			<form method="POST" action="?/scanlator" use:enhance class="row top">
				<div class="label">SCANLATOR</div>
				<div class="picks">
					<button
						type="submit"
						name="scanlator"
						value=""
						class:on={series.scanlator === null}
						aria-pressed={series.scanlator === null}>AUTO</button
					>
					{#each series.scanlators as s (s.name)}
						<button
							type="submit"
							name="scanlator"
							value={s.name}
							class:on={series.scanlator === s.name}
							aria-pressed={series.scanlator === s.name}>{s.name} · {s.count}</button
						>
					{/each}
					<span class="none"
						>{series.duplicates} DUPLICATE{series.duplicates === 1 ? '' : 'S'} HIDDEN</span
					>
				</div>
			</form>
		{/if}

		<div class="row">
			<div class="label">SHELVES</div>
			<div class="chips">
				{#each onShelves as s (s.key)}<span class="chip">{s.name}</span>{/each}
				{#if onShelves.length === 0}<span class="none">ON NO SHELF</span>{/if}
			</div>
			<button type="button" class="edit" onclick={onedit}>EDIT</button>
		</div>

		{#if onRanobe && ranobe}
			<!-- Ranobe's LINK and TRACKING (Ranobe Series 2a–2k; doc/RANOBE.md). No EDIT: Ranobe works status out from the reads, and the RATING row is what it gets. -->
			{#snippet ranobeCells()}
				{#if ranobe?.link}
					<a class="lc" href={ranobe.link.href} target="_blank" rel="noopener noreferrer external"
						>RANOBE ↗</a
					>
					{#if linkOff}
						<span class="lc dim" aria-disabled="true">CHANGE</span>
						<span class="lc dim" aria-disabled="true">UNLINK</span>
					{:else}
						<!-- eslint-disable-next-line svelte/no-navigation-without-resolve -- built from resolve() -->
						<a class="lc" href={ranobeFindHref}>CHANGE</a>
						<form method="POST" action="?/unlinkRanobe" use:enhance class="lc-form">
							<button type="submit" class="lc">UNLINK</button>
						</form>
					{/if}
				{:else if linkOff}
					{#if !ranobe?.hidden}<span class="lc acc dim" aria-disabled="true">FIND</span>{/if}
					<span class="lc dim" aria-disabled="true">PASTE A LINK</span>
				{:else}
					<!-- eslint-disable svelte/no-navigation-without-resolve -- built from resolve() -->
					{#if !ranobe?.hidden}<a class="lc acc" href={ranobeFindHref}>FIND</a>{/if}
					<a class="lc" href="{ranobeFindHref}&paste">PASTE A LINK</a>
					<!-- eslint-enable svelte/no-navigation-without-resolve -->
				{/if}
			{/snippet}
			<div class="row link-row">
				<div class="label">LINK</div>
				<div class="lk">
					<div class="lk-a" class:muted={!ranobe.link}>
						{ranobe.link ? ranobe.link.title : ranobe.hidden ? 'Not linked' : 'Not on Ranobe'}
					</div>
					<div class="lk-b">
						{ranobe.link
							? linkOff
								? '○ OFFLINE · CHANGES NEED THE WORKSTATION'
								: ranobe.link.meta
							: linkOff
								? '○ OFFLINE · FINDING NEEDS THE WORKSTATION'
								: ranobe.unlinkedMeta}
					</div>
				</div>
				<div class="lcs inline">{@render ranobeCells()}</div>
			</div>
			<div class="lcs stack">{@render ranobeCells()}</div>
			{#if ranobeTrack}
				{#snippet ranobeTrackCells()}
					{#if ranobeTrack?.retry && !linkOff}
						<form method="POST" action="?/retryRanobe" use:enhance class="lc-form">
							<button type="submit" class="lc">TRY AGAIN</button>
						</form>
					{/if}
				{/snippet}
				<div class="row track-row">
					<div class="label">TRACKING</div>
					<div class="tk">
						{#each ranobeTrack.lines as t, i (i)}
							<div class="tl">
								<div class="tl-l" class:strong={t.strong}>{t.l}</div>
								{#if t.r}<div class="tl-r" class:alert={t.rStrong}>{t.r}</div>{/if}
							</div>
						{/each}
					</div>
					<div class="lcs inline">{@render ranobeTrackCells()}</div>
				</div>
				{#if ranobeTrack.retry && !linkOff}
					<div class="lcs stack">{@render ranobeTrackCells()}</div>
				{/if}
			{/if}
			{#if link}
				<div class="row cover-row">
					<div class="label">COVER</div>
					<div class="cv">
						<div class="cv-a">{link.cover.a}</div>
						{#if link.cover.b}<div>{link.cover.b}</div>{/if}
					</div>
				</div>
			{/if}
		{:else if link}
			<!-- LINK and COVER (Series Link 1k–1t; doc/LINKS.md). The cells drop below the row where it's narrow. -->
			{#snippet linkCells()}
				{#if link?.linked}
					{#if openHref}
						<a class="lc" href={openHref} target="_blank" rel="noopener noreferrer external"
							>OPEN ↗</a
						>
					{/if}
					{#if linkOff}
						<span class="lc dim" aria-disabled="true">CHANGE</span>
						<span class="lc dim" aria-disabled="true">UNLINK</span>
					{:else}
						<!-- eslint-disable-next-line svelte/no-navigation-without-resolve -- built from resolve() -->
						<a class="lc" href={findHref}>CHANGE</a>
						<form method="POST" action="?/unlink" use:enhance class="lc-form">
							<button type="submit" class="lc">UNLINK</button>
						</form>
					{/if}
				{:else if linkOff}
					<span class="lc acc dim" aria-disabled="true">FIND</span>
					<span class="lc dim" aria-disabled="true">PASTE A LINK</span>
				{:else}
					<!-- eslint-disable svelte/no-navigation-without-resolve -- built from resolve() -->
					{#if !link?.hidden}<a class="lc acc" href={findHref}>FIND</a>{/if}
					<a class="lc" class:acc={link?.hidden} href="{findHref}&paste">PASTE A LINK</a>
					<!-- eslint-enable svelte/no-navigation-without-resolve -->
				{/if}
			{/snippet}
			<div class="row link-row">
				<div class="label">LINK</div>
				<div class="lk">
					<div class="lk-a" class:muted={!link.linked}>{linkPrimary}</div>
					<div class="lk-b">{linkMeta}</div>
				</div>
				<div class="lcs inline">{@render linkCells()}</div>
			</div>
			<div class="lcs stack">{@render linkCells()}</div>
			{#if link.linked && tracking}
				{#snippet trackCells()}
					{#if trackFailed && !linkOff}
						<form method="POST" action="?/retryTracking" use:enhance class="lc-form">
							<button type="submit" class="lc">TRY AGAIN</button>
						</form>
					{/if}
					{#if trackSignIn && !linkOff}
						<a class="lc" href={resolve('/settings')}>SIGN IN →</a>
					{/if}
					{#if trackEditable}
						{#if linkOff}
							<span class="lc dim" aria-disabled="true">EDIT</span>
						{:else}
							<button type="button" class="lc" onclick={() => (trackingOpen = true)}>EDIT</button>
						{/if}
					{/if}
				{/snippet}
				<!-- TRACKING (Series Link 1k–1s; doc/TRACKING.md): each catalogue's word, and what was sent. -->
				<div class="row track-row">
					<div class="label">TRACKING</div>
					<div class="tk">
						{#each trackLines as t, i (i)}
							<div class="tl">
								<div class="tl-l" class:strong={t.strong}>{t.left}</div>
								{#if t.right}<div class="tl-r" class:alert={t.alert}>{t.right}</div>{/if}
							</div>
						{/each}
					</div>
					<div class="lcs inline">{@render trackCells()}</div>
				</div>
				{#if trackEditable || trackFailed || trackSignIn}
					<div class="lcs stack">{@render trackCells()}</div>
				{/if}
				<TrackingSheet open={trackingOpen} {tracking} onclose={() => (trackingOpen = false)} />
			{/if}
			<div class="row cover-row">
				<div class="label">COVER</div>
				<div class="cv">
					<div class="cv-a">{link.cover.a}</div>
					{#if link.cover.b}<div>{link.cover.b}</div>{/if}
				</div>
			</div>
		{/if}

		<div class="row top">
			<div class="label">TAGS</div>
			<div class="tags">
				{#each tags.groups as g (g.namespace)}
					<div class="tag-line">
						<span class="ns">{g.namespace}</span>
						<span class="vals">
							{#if isPersonNamespace(g.namespace)}
								<!-- People open their person page (Index Books). -->
								<!-- eslint-disable svelte/no-navigation-without-resolve -- tagHref() resolves -->
								{#each g.values as v, i (v)}{#if i > 0}<span class="sep"> · </span>{/if}<a
										class="person"
										href={tagHref(`${g.namespace}:${v}`)}>{v}</a
									>{/each}
								<!-- eslint-enable svelte/no-navigation-without-resolve -->
							{:else}
								{g.values.join(' · ')}
							{/if}
						</span>
					</div>
				{/each}
				{#if tags.groups.length === 0}<span class="none">NO TAGS</span>{/if}
				{#if tags.more > 0}<div class="more">+ {tags.more} MORE</div>{/if}
				{#if isBookSeries(series)}
					<div class="more">FROM ITS {series.entries.length} BOOKS · EACH KEEPS ITS OWN</div>
				{/if}
			</div>
			<button type="button" class="edit" onclick={onedit}>EDIT</button>
		</div>

		{#if series.description}
			<div class="row top">
				<div class="label">ABOUT</div>
				<div class="about">
					<p class:open={aboutOpen}>{series.description}</p>
					<button type="button" class="more" onclick={() => (aboutOpen = !aboutOpen)}>
						{aboutOpen ? 'LESS ↑' : 'MORE ↓'}
					</button>
				</div>
			</div>
		{/if}

		{#if editions && opening}
			<!-- EDITIONS (Editions 1b): each language's copy, what only it has, and where it is. -->
			<div class="row top">
				<div class="label">EDITIONS</div>
				<div class="eds">
					{#each editions.editions as e (e.entryId)}
						<div class="ed">
							<div class="ed-cell" class:on={e === opening}>{e.code}</div>
							<div class="ed-text">
								<div class="ed-line">
									{[e.site.toUpperCase(), `${e.pages} PAGES`, sameSize ? '' : e.size]
										.filter(Boolean)
										.join(' · ')}
								</div>
								<div class="ed-note" class:only={e.only.length > 0}>
									{e.only.length
										? `P. ${e.only.join(', ')} · ONLY IN ${e.code}`
										: 'EVERY PAGE MATCHED'}
								</div>
								<div class="path">{e.file}</div>
							</div>
						</div>
					{/each}
					{#if sameSize}<div class="ed-shared">
							EVERY EDITION · {editions.editions[0].size}
						</div>{/if}
				</div>
			</div>
			<div class="row file-row">
				<div class="label">FOLDED</div>
				<div class="file">{foldedOn ? `${foldedOn} · ` : ''}FROM THE DUPLICATES REVIEW</div>
				<button type="button" class="edit" onclick={() => (unfolding = true)}>UNFOLD</button>
				<form method="POST" action="?/hide" use:enhance={replacing} class="hide-form">
					<input type="hidden" name="on" value={series.hidden ? '0' : '1'} />
					<button type="submit" class="edit">{series.hidden ? 'UNHIDE' : 'HIDE'}</button>
				</form>
			</div>
		{:else}
			<div class="row file-row">
				<div class="label">FILE</div>
				<div class="file">
					{#if series.path}<div class="path">{series.path}</div>{/if}
					<div class="file-meta">
						{fileMeta(series.entries, dlFile)}{series.kind !== 'doujin' && cached > 0
							? ` · ↓ ${cached} CACHED`
							: ''}{elsewhere}
					</div>
				</div>
				{#if isBookSeries(series) || isVolumeSeries(series)}
					<!-- Every book (or volume) back out on its own; the series goes. -->
					<form method="POST" action="?/ungroup" use:enhance={replacing} class="hide-form">
						<button type="submit" class="edit">UNGROUP</button>
					</form>
				{/if}
				<form method="POST" action="?/hide" use:enhance={replacing} class="hide-form">
					<input type="hidden" name="on" value={series.hidden ? '0' : '1'} />
					<button type="submit" class="edit">{series.hidden ? 'UNHIDE' : 'HIDE'}</button>
				</form>
				<button type="button" class="edit" onclick={ondelete}>DELETE</button>
			</div>
		{/if}
	{/if}
</section>

{#if editions}
	<UnfoldSheet
		open={unfolding}
		lines={editions.editions.map((e) => ({
			code: e.code,
			title: e.title,
			detail: [
				editions.read
					? 'READ'
					: editions.at === null
						? `${e.pages} PAGES`
						: `P. ${(e.base ? editions.at : baseToEdition(e.rows, editions.at).page) + 1} OF ${e.pages}`,
				`RATING ${series.rating}`,
				`${series.collections.length} SHEL${series.collections.length === 1 ? 'F' : 'VES'}`
			].join(' · ')
		}))}
		onclose={() => (unfolding = false)}
	/>
{/if}

<style>
	/* Waiting: what isn't known yet, as flat grey bars (Loading States 1g). */
	.out-lines {
		display: flex;
		flex-direction: column;
		justify-content: center;
		gap: 10px;
		padding-top: 6px;
	}
	.out-row .out-lines {
		flex: 1;
		padding: 10px 14px;
	}
	.out-lines i,
	.cta-out {
		display: block;
		height: 10px;
		background: var(--line-1);
	}
	.cta-out {
		width: 150px;
		background: rgba(14, 15, 16, 0.28);
	}
	.out-row {
		min-height: 58px;
	}
	.panel {
		display: flex;
		flex-direction: column;
		--label-w: 120px;
		--cov-w: 184px;
		--title-size: 28px;
		--cta-h: 64px;
		--ns-w: 72px;
	}
	/* Landscape: a narrower cover and title in the 440px panel. */
	@media (min-width: 1024px) {
		.panel {
			--cov-w: 132px;
			--title-size: 22px;
		}
	}
	@media (max-width: 599px) {
		.panel {
			--label-w: 84px;
			--cov-w: 104px;
			--title-size: 20px;
			--cta-h: 56px;
			--ns-w: 56px;
		}
	}

	.identity {
		display: flex;
		gap: var(--pad);
		padding: var(--pad);
	}
	.cover {
		position: relative;
		flex-shrink: 0;
		width: var(--cov-w);
		aspect-ratio: var(--cover-ratio);
		align-self: flex-start;
	}
	a.cover {
		display: block;
		color: inherit;
		text-decoration: none;
	}
	.cover.typeset {
		background: var(--surface-panel);
		border: 1px solid var(--line-2);
		padding: 14px;
		display: flex;
		flex-direction: column;
		justify-content: space-between;
	}
	.nocover {
		font: 500 12px var(--font-mono);
		color: var(--text-2);
		letter-spacing: var(--tracking-label);
	}
	.nocover-title {
		font: 500 15px/1.3 var(--font-sans);
		text-wrap: pretty;
	}
	.names {
		flex: 1;
		min-width: 0;
		display: flex;
		flex-direction: column;
		gap: 10px;
	}
	.meta {
		font: 500 13px var(--font-mono);
		color: var(--text-2);
		letter-spacing: var(--tracking-label);
	}
	h1 {
		margin: 0;
		font: 500 var(--title-size) / 1.2 var(--font-sans);
		text-wrap: pretty;
	}
	.alt {
		font: 400 15px/1.35 var(--font-sans);
		color: var(--text-2);
	}
	.names .alt + .alt {
		margin-top: -6px;
	}

	.label {
		display: flex;
		align-items: center;
		width: var(--label-w);
		padding-left: var(--pad);
		flex-shrink: 0;
		font: 500 12px var(--font-mono);
		letter-spacing: var(--tracking-label);
		color: var(--text-2);
		border-right: var(--hairline);
	}
	.top .label {
		align-items: flex-start;
		padding-top: 18px;
	}

	.cta {
		flex-shrink: 0;
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 12px;
		height: var(--cta-h);
		padding: 0 var(--pad);
		border: 0;
		border-radius: 0;
		background: var(--accent);
		color: var(--on-accent);
		font: 500 15px var(--font-mono);
		letter-spacing: 0.04em;
		text-align: left;
	}
	.cta {
		text-decoration: none;
	}
	.cta[aria-disabled='true'] {
		pointer-events: none;
	}
	.cta.nofile {
		opacity: 0.4;
	}
	.cta-meta .short {
		display: none;
	}
	@media (max-width: 599px) {
		.cta-meta .long,
		.lg-long {
			display: none;
		}
		.cta-meta .short,
		.lg-short {
			display: inline;
		}
	}

	.row {
		display: flex;
		align-items: stretch;
		border-bottom: var(--hairline);
		min-height: 60px;
	}
	.twin {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 12px;
		height: 60px;
		padding-left: var(--pad);
		border-bottom: 1px solid var(--line-1);
		background: var(--surface-panel);
		font: 500 14px/1.2 var(--font-mono);
	}
	.tw-text {
		display: flex;
		flex-direction: column;
		gap: 3px;
		min-width: 0;
	}
	.tw-title {
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}
	.tw-meta {
		font: 400 13px/1.3 var(--font-mono);
		color: var(--text-2);
	}
	.tw-acts {
		align-self: stretch;
		display: flex;
	}
	.tw-acts form {
		display: flex;
	}
	.tw-acts button,
	.tw-acts a {
		display: flex;
		align-items: center;
		padding: 0 24px;
		border: 0;
		border-left: 1px solid var(--line-1);
		border-radius: 0;
		background: transparent;
		color: var(--text-1);
		font: 500 14px var(--font-mono);
		text-decoration: none;
		cursor: pointer;
	}
	.tw-acts a {
		border-left: 0;
		background: var(--accent);
		color: var(--on-accent);
	}
	/* Index Japanese 4a: OCR and WORDS sit on the panel ground, under DIRECTION. */
	.panel-row {
		background: var(--surface-panel);
		min-height: 56px;
	}
	.ocr-row {
		min-height: 64px;
	}
	.ocr {
		flex: 1;
		min-width: 0;
		display: flex;
		flex-direction: column;
		justify-content: center;
		gap: 8px;
		padding: 10px 14px;
	}
	.oa {
		font: 500 14px var(--font-mono);
	}
	.ob {
		font: 400 13px var(--font-mono);
		color: var(--text-2);
	}
	.obar {
		height: 2px;
		background: var(--line-1);
	}
	.obar div {
		height: 2px;
		background: var(--accent);
	}
	.wcount {
		flex: 1;
		min-width: 0;
		display: flex;
		align-items: center;
		gap: 14px;
		padding: 10px 14px;
		font: 500 14px var(--font-mono);
	}
	.ws {
		font-weight: 400;
		font-size: 13px;
		color: var(--text-2);
	}
	.seg {
		flex: 1;
		display: flex;
		min-height: 56px;
	}
	.seg button {
		flex: 1;
		border: 0;
		border-right: var(--hairline);
		border-radius: 0;
		background: transparent;
		color: var(--text-1);
		font: 500 14px var(--font-mono);
		cursor: pointer;
	}
	.seg button.on {
		background: var(--surface-inverse);
		color: var(--text-inverse);
	}
	.picks {
		flex: 1;
		min-width: 0;
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 8px;
		padding: 10px 14px;
	}
	.picks button {
		min-height: 36px;
		padding: 0 12px;
		border: 1px solid var(--line-2);
		border-radius: 0;
		background: transparent;
		color: var(--text-1);
		font: 500 13px var(--font-mono);
		cursor: pointer;
	}
	.picks button.on {
		border-color: var(--surface-inverse);
		background: var(--surface-inverse);
		color: var(--text-inverse);
	}
	.picks .none {
		flex-basis: 100%;
	}
	.chips {
		flex: 1;
		min-width: 0;
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 8px;
		padding: 10px 14px;
	}
	.chip {
		height: 36px;
		display: flex;
		align-items: center;
		padding: 0 12px;
		border: 1px solid var(--line-2);
		font: 500 14px var(--font-sans);
	}
	.none {
		font: 500 12px var(--font-mono);
		color: var(--text-2);
		letter-spacing: 0.04em;
	}
	.edit {
		display: flex;
		align-items: center;
		padding: 0 var(--pad);
		border: 0;
		border-left: var(--hairline);
		border-radius: 0;
		background: transparent;
		color: var(--text-1);
		font: 500 13px var(--font-mono);
		letter-spacing: 0.04em;
		cursor: pointer;
	}
	a.edit {
		text-decoration: none;
	}
	.hide-form {
		display: flex;
	}
	.seg button:active:not(.on),
	.edit:active {
		background: var(--surface-inverse);
		color: var(--text-inverse);
	}
	.tags {
		flex: 1;
		min-width: 0;
		display: flex;
		flex-direction: column;
		gap: 8px;
		padding: 14px;
	}
	.tag-line {
		display: flex;
		gap: 12px;
		align-items: baseline;
	}
	.ns {
		flex-shrink: 0;
		width: var(--ns-w);
		font: 400 12px var(--font-mono);
		color: var(--text-2);
		letter-spacing: 0.04em;
	}
	.vals {
		flex: 1;
		min-width: 0;
		font: 400 15px/1.35 var(--font-sans);
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}
	.more {
		align-self: flex-start;
		padding: 0;
		border: 0;
		background: none;
		font: 500 12px var(--font-mono);
		color: var(--text-2);
		letter-spacing: 0.04em;
		cursor: pointer;
	}
	.about {
		flex: 1;
		min-width: 0;
		display: flex;
		flex-direction: column;
		gap: 6px;
		padding: 14px;
	}
	.about p {
		margin: 0;
		font: 400 15px/1.45 var(--font-sans);
		color: var(--text-prose);
		display: -webkit-box;
		-webkit-line-clamp: 2;
		line-clamp: 2;
		-webkit-box-orient: vertical;
		overflow: hidden;
		text-wrap: pretty;
	}
	.about p.open {
		display: block;
	}
	.person {
		color: inherit;
		text-decoration: underline;
		text-underline-offset: 4px;
		text-decoration-color: var(--line-2);
	}
	.person:active {
		background: var(--surface-inverse);
		color: var(--text-inverse);
	}
	.sugg {
		display: flex;
		flex-direction: column;
		background: var(--surface-panel);
		border-bottom: var(--hairline);
	}
	.sugg-head {
		display: flex;
		justify-content: space-between;
		gap: 12px;
		padding: 16px var(--pad) 12px;
		font: 500 13px var(--font-mono);
		letter-spacing: var(--tracking-label);
	}
	.dim {
		color: var(--text-2);
	}
	.sugg-covers {
		display: flex;
		gap: 8px;
		padding: 0 var(--pad) 16px;
		overflow-x: auto;
	}
	.sugg-cover {
		width: 64px;
		aspect-ratio: var(--cover-ratio);
		flex-shrink: 0;
	}
	.sugg-cover.this {
		box-shadow: inset 0 0 0 2px var(--accent);
	}
	.sugg-actions {
		display: flex;
		height: 56px;
		border-top: var(--hairline);
	}
	.sugg-actions > button,
	.sugg-actions > form {
		flex: 1;
		display: flex;
	}
	.sugg-actions button {
		flex: 1;
		display: flex;
		align-items: center;
		justify-content: center;
		border: 0;
		border-radius: 0;
		background: transparent;
		color: var(--text-1);
		font: 500 14px var(--font-mono);
		letter-spacing: 0.04em;
		cursor: pointer;
	}
	.sugg-actions > button {
		border-right: var(--hairline);
	}
	.sugg-actions button.dim {
		color: var(--text-2);
	}
	.sugg-actions button:active {
		background: var(--surface-inverse);
		color: var(--text-inverse);
	}
	.file-row {
		min-height: 64px;
	}
	/* LINK and COVER (Series Link): the mock's literals. */
	.link-row {
		min-height: 68px;
	}
	.lk {
		flex: 1;
		min-width: 0;
		display: flex;
		flex-direction: column;
		justify-content: center;
		gap: 5px;
		padding: 10px 14px;
	}
	.lk-a {
		font: 500 15px/1.3 var(--font-sans);
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}
	.lk-a.muted {
		color: var(--text-2);
	}
	.lk-b {
		font: 400 13px/1.35 var(--font-mono);
		color: var(--text-2);
		text-wrap: pretty;
	}
	.lcs {
		display: flex;
		--cell-pad: 20px;
	}
	.lcs.stack {
		display: none;
	}
	.lc-form {
		display: flex;
	}
	.lc {
		display: flex;
		align-items: center;
		padding: 0 var(--cell-pad);
		border: 0;
		border-left: var(--hairline);
		border-radius: 0;
		background: transparent;
		color: var(--text-1);
		font: 500 13px var(--font-mono);
		letter-spacing: 0.04em;
		white-space: nowrap;
		text-decoration: none;
		cursor: pointer;
	}
	.lc.acc {
		background: var(--accent);
		color: var(--on-accent);
	}
	.lc.dim {
		opacity: 0.35;
		cursor: default;
	}
	/* Narrow (the phone, and the 440px landscape panel): the cells drop below, in equal columns (1t). */
	@media (max-width: 599px), (min-width: 1024px) {
		.link-row {
			border-bottom: 0;
		}
		/* A row with no cells to drop keeps its own rule. */
		.link-row.solo {
			border-bottom: var(--hairline);
		}
		.lcs.inline {
			display: none;
		}
		.lcs.stack {
			display: grid;
			grid-auto-flow: column;
			grid-auto-columns: minmax(0, 1fr);
			min-height: 52px;
			border-top: var(--hairline);
			border-bottom: var(--hairline);
			--cell-pad: 14px;
		}
		.lcs.stack .lc {
			justify-content: center;
			border-left: 0;
			border-right: var(--hairline);
		}
		.lcs.stack .lc-form .lc {
			flex: 1;
		}
	}
	.track-row {
		min-height: 72px;
	}
	.tk {
		flex: 1;
		min-width: 0;
		display: flex;
		flex-direction: column;
		justify-content: center;
		gap: 8px;
		padding: 12px 14px;
	}
	.tl {
		display: flex;
		flex-wrap: wrap;
		justify-content: space-between;
		align-items: baseline;
		gap: 2px 12px;
	}
	.tl-l {
		font: 400 14px/1.3 var(--font-mono);
		color: var(--text-2);
	}
	.tl-l.strong {
		font-weight: 500;
		color: var(--text-1);
	}
	.tl-r {
		font: 400 12px/1.3 var(--font-mono);
		color: var(--text-2);
	}
	.tl-r.alert {
		color: var(--text-1);
	}
	@media (max-width: 599px), (min-width: 1024px) {
		.track-row {
			border-bottom: 0;
		}
	}
	.cover-row {
		min-height: 64px;
	}
	.cv {
		flex: 1;
		min-width: 0;
		display: flex;
		flex-direction: column;
		justify-content: center;
		gap: 5px;
		padding: 10px 14px;
		font: 400 13px var(--font-mono);
		color: var(--text-2);
	}
	.cv-a {
		color: var(--text-1);
	}
	.ed-alt {
		display: flex;
		align-items: baseline;
		gap: 10px;
	}
	.ed-code {
		flex-shrink: 0;
		font: 500 12px var(--font-mono);
		letter-spacing: var(--tracking-label);
	}
	.lg-short {
		display: none;
	}
	.override {
		min-height: 48px;
	}
	.ov {
		flex: 1;
		min-width: 0;
		display: flex;
		align-items: center;
		padding: 0 var(--pad);
		font: 400 13px/1.3 var(--font-mono);
		color: var(--text-2);
	}
	.eds {
		flex: 1;
		min-width: 0;
		display: flex;
		flex-direction: column;
	}
	.ed {
		display: flex;
		align-items: stretch;
		border-bottom: 1px solid var(--line-subtle);
	}
	.ed-cell {
		width: 56px;
		flex-shrink: 0;
		display: flex;
		align-items: center;
		justify-content: center;
		border-right: 1px solid var(--line-subtle);
		font: 500 14px var(--font-mono);
	}
	.ed-cell.on {
		background: var(--surface-inverse);
		color: var(--text-inverse);
	}
	.ed-text {
		flex: 1;
		min-width: 0;
		display: flex;
		flex-direction: column;
		gap: 4px;
		padding: 10px 14px;
		font: 400 12px/1.3 var(--font-mono);
		color: var(--text-2);
	}
	.ed-line {
		font-size: 13px;
		font-weight: 500;
		color: var(--text-1);
	}
	.ed-note.only {
		color: var(--accent);
	}
	.ed-shared {
		padding: 12px 14px;
		font: 400 12px var(--font-mono);
		color: var(--text-2);
	}
	.file {
		flex: 1;
		min-width: 0;
		display: flex;
		flex-direction: column;
		justify-content: center;
		gap: 5px;
		padding: 10px 14px;
		font: 400 13px var(--font-mono);
		color: var(--text-2);
	}
	.path {
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}
	.file-meta {
		color: var(--text-1);
	}
</style>

<script lang="ts">
	import { backLink } from '$lib/back';
	import RatingSlider from '$lib/components/controls/RatingSlider.svelte';
	import Cover from '$lib/components/content/Cover.svelte';
	import { coverSrc, readHref } from '$lib/library/links';
	import { count, unitLabel } from '$lib/library/labels';
	import { kindVerb, nextPartWords, workPartMeta, type WorkEnd } from '$lib/library/works';
	import type { Kind } from '$lib/library/types';
	import { offline } from '$lib/offline.svelte';
	import type { Mode } from '$lib/reader/reader';
	import { libraryCell } from '$lib/reader/library-row';
	import { deserialize, enhance } from '$app/forms';
	import { resolve } from '$app/paths';

	/**
	 * The page after the last page (Index Reader, states endch, endseries and
	 * offline; the addendum's incogEnd). In paged modes the chapter boundary
	 * is a full page of its own, so crossing it is noticed; a tap or swipe
	 * forward carries on. At the end of what is available it is where the
	 * series is rated -- the block stays once the rating is set, showing what
	 * was chosen, so rating it does not empty the page the reader is on (c655).
	 *
	 * A series in a Work offers the next part here (doc/WORKS.md, W6): the
	 * block is a tap, never a swipe, because a chapter boundary swipes on while
	 * the next series may read the other way and the rating is asked once.
	 */
	type Next = {
		name: string;
		title: string;
		pageCount: number;
		available: boolean;
		/** Read from its source (doc/BROWSING.md): its pages aren't counted until asked for. */
		online?: boolean;
	};
	let {
		variant,
		entryName,
		position,
		kind,
		seriesTitle,
		next,
		nextCached = false,
		rating,
		favourite,
		incognito,
		mode,
		lastPage,
		seriesHref,
		libraryHref,
		onrate,
		onfav,
		onback,
		words = 0,
		wordsHref = '',
		nextOcr = false,
		stale = null,
		moveHref = '',
		work = null,
		workHref = '',
		unit = '',
		inLibrary,
		seriesHidden,
		addHref = null
	}: {
		/** chapter: next is readable; missing: next has no file; offline: no network; series: nothing next. */
		variant: 'chapter' | 'missing' | 'offline' | 'series';
		entryName: string;
		/** "41 OF 58", "DOUJIN · 1 OF 1". */
		position: string;
		kind: string;
		seriesTitle: string;
		next: Next | null;
		/** The next chapter is cached on the tablet (doc/OFFLINE.md). */
		nextCached?: boolean;
		rating: number;
		favourite: boolean;
		incognito: boolean;
		mode: Mode;
		/** "P. 22 OF 22" */
		lastPage: string;
		seriesHref: string;
		libraryHref: string;
		onrate: (n: number) => void;
		onfav: () => void;
		onback: () => void;
		/**
		 * Japanese: distinct words looked up in this chapter, and where to
		 * review them (Index Japanese 3a, endch). None, or incognito: no row.
		 */
		words?: number;
		wordsHref?: string;
		/** The next chapter has its text read already. */
		nextOcr?: boolean;
		/**
		 * An ongoing series whose source has added nothing for eight weeks
		 * (doc/MOVE.md; Migrate Calls, READER): the quiet source's name and when
		 * it last added something. Null: no line.
		 */
		stale?: { source: string; since: number } | null;
		/** Its MOVE page, for the ANOTHER SOURCE cell. */
		moveHref?: string;
		/** The Work this series is a part of, and what its end offers (doc/WORKS.md, W6). */
		work?: WorkEnd | null;
		/** The Work's own screen, for the block's WORK → and the foot's cell. */
		workHref?: string;
		/** "CH" for pages, "VOL" for a novel's volumes: the kicker adds the dot itself. */
		unit?: string;
		/**
		 * In the library, so the end offers HIDE (the series screen's own HIDE,
		 * which is what takes it off every shelf; it stays in the library and
		 * `/reveal` brings it back). False for a browsing record
		 * (doc/BROWSING.md), whose end offers + ADD through `addHref`. Required,
		 * with no default: a reader that forgets it must fail `yarn run check`
		 * rather than quietly offer the wrong cell (c655, round 2).
		 */
		inLibrary: boolean;
		/**
		 * The series is hidden, read here under `/reveal` (c673): the row then
		 * offers UNHIDE (`?/hide on=0`) rather than hiding it again. Its own
		 * state, never `hidden` above, which is only this page's answer.
		 */
		seriesHidden: boolean;
		/** A browsing record's ADD: the source preview's own `?/add` action. */
		addHref?: string | null;
	} = $props();

	const back = $derived(mode === 'rtl' ? '→' : '←');
	const nextTitle = $derived(next?.title ?? '');
	const staleDay = $derived(
		stale
			? new Date(stale.since)
					.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })
					.toUpperCase()
			: ''
	);
	/**
	 * The run is read at its last part (Work-EndStates 4): the page speaks for
	 * the Work, not the series. An earlier part of a read run falls through to
	 * the series' own end page, because "THE WORK IS READ · 1 OF 2" reads as its
	 * own contradiction; the foot still offers the Work.
	 */
	const runRead = $derived(variant === 'series' && work?.mode === 'read' && work.part === work.of);
	const started = $derived(
		work
			? new Date(work.createdAt)
					.toLocaleDateString('en-GB', { month: 'short', year: 'numeric' })
					.toUpperCase()
			: ''
	);
	/** The part's own chapter word: CH. for pages, VOL. for a novel's volumes. */
	const partUnit = (k: Kind) => unitLabel(k);
	/** The next part's first chapter, if it can open at all. */
	const first = $derived(work?.next?.entry ?? null);
	/** The device keeps it: offline it still opens (doc/OFFLINE.md). */
	const firstCached = $derived(
		!!work?.next && !!first && (offline.entries[work.next.seriesId] ?? []).includes(first.id)
	);
	const offlineState = $derived(!!work?.next && !offline.online && !firstCached);
	const onlineOnly = $derived(!!first && !first.available && first.online && offline.online);
	const unreadable = $derived(!!first && !first.available && !first.online);
	const nextVerb = $derived(work?.next ? kindVerb(work.next.kind) : 'READ');
	/** The words beside the verb that follow the next part's kind too (c343). */
	const nextWords = $derived(work?.next ? nextPartWords(work.next.kind) : null);
	/** Where START goes: the next part's first chapter, or its screen when there is none. */
	const startHref = $derived(
		first
			? readHref(first.id, 1)
			: work?.next
				? resolve('/series/[id]', { id: String(work.next.seriesId) })
				: ''
	);
	const downloads = $derived(work?.next ? downloadWords(work.next) : '');
	/** The meanwhile row's two lines, built once so no template whitespace splits them. */
	const meanwhileLine = $derived(
		work?.next ? `${work.next.title} · ${partUnit(work.next.kind)}. ${first?.number ?? 1}` : ''
	);
	/**
	 * The row says what a tap would do, and whether it can: the same three states
	 * the block has, because it is the same next part (a caught-up part whose
	 * next one has no file is not a download count but a NOT DOWNLOADED).
	 */
	const meanwhileNote = $derived(
		offlineState
			? '○ OFFLINE · NOT CACHED'
			: onlineOnly
				? `○ NOT DOWNLOADED · ${nextWords?.online(work?.next?.source ?? '') ?? ''}`
				: unreadable
					? '○ NOT DOWNLOADED'
					: downloads
	);
	const meanwhileAction = $derived(
		offlineState
			? 'NOT CACHED'
			: unreadable
				? 'NOT DOWNLOADED'
				: onlineOnly
					? `${nextVerb} ONLINE →`
					: 'START →'
	);
	/** The unopenable row's name, which says why it cannot open (c345). */
	const meanwhileLabel = $derived(
		work?.next
			? `NEXT IN ${work.name.toUpperCase()}, ${offlineState ? 'NOT CACHED' : 'NOT DOWNLOADED'}`
			: ''
	);
	const meanwhileSub = $derived(
		work?.next
			? `NEXT IN ${work.name.toUpperCase()} · PART ${work.part + 1} · ${count(
					work.next.entries
				)} ${partUnit(work.next.kind)}. · ${meanwhileNote}`
			: ''
	);
	const note = $derived(
		[
			'SHOWN WHILE UNRATED',
			'RATING SAVES WHEN YOU LET GO',
			...(work?.next ? [`${work.next.title.toUpperCase()} OPENS ON A TAP, NEVER A SWIPE`] : [])
		].join(' · ')
	);
	/**
	 * The kicker names the series that ended when the Work carries on (Work-End:
	 * "END · THE BREAKER"), and keeps END · LAST AVAILABLE when nothing follows
	 * -- caught up on an ongoing part included (Work-EndStates 1).
	 */
	const namesSeries = $derived(
		variant === 'series' && (work?.mode === 'next' || work?.mode === 'read')
	);
	/**
	 * DOWNLOAD FIRST 10's answer: nothing asked yet, asking, queued, already
	 * queued (everything it would ask for is under way, c534), or refused (c344).
	 */
	let queue = $state<'idle' | 'asking' | 'queued' | 'already' | 'failed'>('idle');
	/** Done: a queue that took, or one already there; neither is pressed again. */
	const queueDone = $derived(queue === 'queued' || queue === 'already');
	// ---- the library row (c655) -------------------------------------------------
	// A record's ADD takes it in; a library series' HIDE is the series screen's
	// own, which is what takes it off every shelf. Neither lands elsewhere:
	// ADD's band and HIDE's redirect belong to the screens that asked for them.
	// A series in a Work draws no cell: its HIDE is the Work's own (round 2).
	// A refused form says so in the row rather than leaving a button that
	// looked like it did nothing (c673).
	let adding = $state(false);
	let added = $state(false);
	let removing = $state(false);
	let removed = $state(false);
	let unhidden = $state(false);
	/** A failed row action's own message, or a plain one (c673). */
	let rowError = $state<string | null>(null);
	const cell = $derived(
		libraryCell({
			inLibrary,
			inWork: !!work,
			hasAddHref: !!addHref,
			seriesHidden,
			added,
			hidden: removed,
			unhidden
		})
	);

	/**
	 * What a refused form says. The row says its own words, never the action's:
	 * the one real refusal `?/hide` gives is `A WORK IS HIDDEN WHOLE · HIDE ALL
	 * OR TAKE OUT` (series/[id]/+page.server.ts), and on this page HIDE is the
	 * row's own button while HIDE ALL is a series-screen control, so the
	 * action's line would make a `HIDE` locator find two elements. The sentence
	 * holds none of COMMON's control words and none of this page's own labels
	 * (HIDE, UNHIDE, HIDDEN ✓, UNHIDDEN ✓, + ADD TO LIBRARY, IN LIBRARY ✓,
	 * START, WORK, FAV, DOWNLOAD FIRST 10, FORGET), so no locator for a row
	 * finds this line instead of its control.
	 */
	function rowRefusal(): string {
		return 'COULD NOT SAVE';
	}
	const downloadCell = $derived(
		queue === 'queued'
			? 'QUEUED ✓'
			: queue === 'already'
				? 'ALREADY QUEUED'
				: queue === 'failed'
					? 'NOT QUEUED · TRY THE SERIES'
					: (nextWords?.downloadFirst ?? '')
	);

	function downloadWords(p: NonNullable<WorkEnd['next']>): string {
		if (p.entries > 0 && p.downloaded >= p.entries) return 'ALL DOWNLOADED';
		if (p.downloaded > 0) return `${count(p.downloaded)} OF ${count(p.entries)} DOWNLOADED`;
		return '0 DOWNLOADED';
	}

	/**
	 * DOWNLOAD FIRST 10 of the next part, through its own series screen's
	 * action. An action called this way answers 200 even when it fails: the
	 * outcome is the body's `type`, so `r.ok` alone said QUEUED ✓ over an
	 * engine that was down (c344). A success that queued nothing because
	 * everything it would ask for is already under way (a second press, or a
	 * press after a reload while the first chapter downloads) says ALREADY
	 * QUEUED, from the action's `already` (c534). A success that queued nothing
	 * and found nothing under way (no chapter the source lists is left to
	 * fetch) is no queue: it and any failure say NOT QUEUED and leave the cell
	 * pressable, so a retry is a second press, and the series screen says why.
	 */
	async function downloadFirst() {
		const p = work?.next;
		if (!p || queue === 'asking' || queueDone) return;
		queue = 'asking';
		const body = new FormData();
		// The part's first ten, the same ten on every press: `next` would skip
		// the ones under way and queue ten more after a reload (c534).
		body.set('which', 'first');
		const r = await fetch(`${resolve('/series/[id]', { id: String(p.seriesId) })}?/download`, {
			method: 'POST',
			body,
			headers: { 'x-sveltekit-action': 'true' }
		}).catch(() => null);
		let answer: 'queued' | 'already' | 'failed' = 'failed';
		try {
			const result = r?.ok ? deserialize(await r.text()) : null;
			const done =
				result?.type === 'success'
					? (result.data?.downloaded as { queued?: number; already?: number } | undefined)
					: undefined;
			if (Number(done?.queued) > 0) answer = 'queued';
			else if (Number(done?.already) > 0) answer = 'already';
		} catch {
			// A body that isn't an action's answer (a proxy's page, a cut connection) is no queue.
		}
		queue = answer;
	}
</script>

<div class="end" class:incognito data-end-page>
	{#if variant === 'offline'}
		<div class="offline"><span>○ OFFLINE</span><span class="dim">CACHED STILL OPENS</span></div>
	{/if}

	<div class="body" class:series={variant === 'series'}>
		<div class="kicker">
			<span
				>END · {variant === 'series'
					? namesSeries
						? seriesTitle.toUpperCase()
						: 'LAST AVAILABLE'
					: entryName}</span
			>
			<span
				>{variant === 'series'
					? `${kind.toUpperCase()} · ${unit ? `${unit}. ` : ''}${position}`
					: position}</span
			>
		</div>
		<div class="rule"></div>

		{#if variant === 'series'}
			{#if runRead && work}
				<!-- The run is read (Work-EndStates 4): its name, what it held, and WORK → where START was. -->
				<div class="kicker">
					<span class="ink">THE WORK IS READ · {work.part} OF {work.of}</span>
					<span>STARTED {started}</span>
				</div>
			{/if}
			<div class="big">{runRead && work ? work.name : seriesTitle}</div>
			{#if runRead && work?.held}
				<div class="sub">{work.held}</div>
			{/if}
			{#if stale && moveHref}
				<!-- A quiet source isn't a broken one: one line and a way out, no band. -->
				<div class="stale">
					<span>{stale.source.toUpperCase()} HAS ADDED NOTHING SINCE {staleDay}</span>
					<!-- eslint-disable-next-line svelte/no-navigation-without-resolve -- resolved by the page -->
					<a class="scell" href={moveHref} data-focus-mark="in">ANOTHER SOURCE →</a>
				</div>
			{/if}
			{#if work?.mode === 'next' && work.next}
				<!-- NEXT IN THE WORK (Work-End): a tap, never a swipe, because a chapter
				     boundary swipes on and the next series may read the other way. -->
				<section class="nextw" aria-label="Next in the Work">
					<div class="cvw">
						<span class="cv"
							><Cover
								src={coverSrc(work.next.seriesId, work.next.cover)}
								hue={work.next.hue}
							/></span
						>
					</div>
					<div class="col">
						<div class="info">
							<div class="k">
								NEXT IN {work.name.toUpperCase()} · PART {work.part + 1} OF {work.of}
							</div>
							<div class="big m">{work.next.title}</div>
							{#if offlineState}
								<div class="sub"><span class="ink">○ OFFLINE</span> · NOT CACHED</div>
							{:else if onlineOnly}
								<div class="sub">
									<span class="ink">○ NOT DOWNLOADED</span> · {nextWords?.online(work.next.source)}
								</div>
							{:else if unreadable}
								<div class="sub"><span class="ink">○ NOT DOWNLOADED</span></div>
							{:else}
								<div class="sub">{workPartMeta(work.next, work.next.direction)}</div>
							{/if}
						</div>
						<div class="go">
							{#if offlineState || unreadable}
								<span class="acc dim" aria-disabled="true"
									>▶ {nextVerb} · {partUnit(work.next.kind)}. {first?.number ?? 1}<span class="m"
										>{offlineState ? 'NOT CACHED' : 'NOT DOWNLOADED'}</span
									></span
								>
							{:else}
								<!-- eslint-disable-next-line svelte/no-navigation-without-resolve -- readHref() resolves -->
								<a class="acc" href={startHref} data-focus-mark="in"
									>▶ {nextVerb}{onlineOnly ? ' ONLINE' : ''} · {partUnit(work.next.kind)}. {first?.number ??
										1}<span class="m"
										>{onlineOnly
											? nextWords?.streamed
											: `IT OPENS AT ${partUnit(work.next.kind)}. ${first?.number ?? 1}`}</span
									></a
								>
							{/if}
							{#if unreadable || onlineOnly}
								<button
									type="button"
									class="dl"
									disabled={queueDone || queue === 'asking'}
									onclick={downloadFirst}>{downloadCell}</button
								>
							{/if}
							<!-- eslint-disable-next-line svelte/no-navigation-without-resolve -- resolved by the page -->
							<a href={workHref} data-focus-mark="in">WORK →</a>
						</div>
					</div>
				</section>
			{:else if work?.mode === 'meanwhile' && work.next}
				<!-- Caught up on an ongoing part (Work-EndStates 1): a row, not a block.
				     A next part that cannot open says so rather than offering a cell
				     that lands on the reader's IS NOT DOWNLOADED page. It is a group
				     named for why (c345), so a screen reader hears it as one thing,
				     and its one stop is the block's own DOWNLOAD FIRST 10: offline
				     there is nothing to queue, so offline it has none. -->
				{#if offlineState || unreadable}
					<!-- aria-disabled reaches what a group holds, so only the row with no cell says it. -->
					<div
						class="wrow dim"
						role="group"
						aria-disabled={offlineState ? 'true' : undefined}
						aria-label={meanwhileLabel}
					>
						<span class="wl">MEANWHILE</span>
						<span class="wn">{meanwhileLine}<span class="b">{meanwhileSub}</span></span>
						{#if offlineState}
							<span class="wr">{meanwhileAction}</span>
						{:else}
							<button
								type="button"
								class="wr dl"
								data-focus-mark="in"
								disabled={queueDone || queue === 'asking'}
								onclick={downloadFirst}>{downloadCell}</button
							>
						{/if}
					</div>
				{:else}
					<!-- eslint-disable-next-line svelte/no-navigation-without-resolve -- readHref() resolves -->
					<a class="wrow" href={startHref} data-focus-mark="in">
						<span class="wl">MEANWHILE</span>
						<span class="wn">{meanwhileLine}<span class="b">{meanwhileSub}</span></span>
						<span class="wr">{meanwhileAction}</span>
					</a>
				{/if}
			{:else if runRead && work}
				<!-- The run is read: WORK → in place of START (Work-EndStates 4). -->
				<!-- eslint-disable-next-line svelte/no-navigation-without-resolve -- resolved by the page -->
				<a class="wrow" href={workHref} data-focus-mark="in">
					<span class="wl">WORK</span>
					<span class="wn"
						>The run, from part 1<span class="b">+ ADD A SERIES, IF IT GROWS</span></span
					>
					<span class="wr">WORK →</span>
				</a>
			{/if}
			<div class="rate-block">
				<!-- Ratings out of 10 1d: the blocky slider; it saves when the finger lifts.
				     HIDDEN with reveal off leaves the series unreachable, so the block
				     stops taking input rather than posting to a page that now 404s (c655). -->
				<RatingSlider
					value={rating}
					height={72}
					phoneHeight={72}
					pad={0}
					phonePad={0}
					phoneLabelWidth={72}
					borderTop={false}
					disabled={cell === 'hidden'}
					onchange={onrate}
				/>
				<div class="rrow">
					<div class="rlabel">FAV</div>
					<button
						type="button"
						class="switch"
						role="switch"
						aria-checked={favourite}
						disabled={cell === 'hidden'}
						onclick={onfav}
					>
						<span class="track" class:on={favourite}><span class="knob"></span></span>
						<span>{favourite ? 'ON' : 'OFF'}</span>
					</button>
				</div>
			</div>
			{#if rating === 0}<div class="note">{note}</div>{/if}
			{#if cell === 'hide' || cell === 'hidden'}
				<div class="lib">
					<form
						method="POST"
						action="{seriesHref}?/hide"
						use:enhance={() => {
							removing = true;
							rowError = null;
							return async ({ result }) => {
								removing = false;
								if (result.type === 'success' || result.type === 'redirect') removed = true;
								else if (result.type === 'failure' || result.type === 'error')
									rowError = rowRefusal();
							};
						}}
					>
						<input type="hidden" name="on" value="1" />
						<button type="submit" disabled={removing || cell === 'hidden'} data-focus-mark="in"
							>{cell === 'hidden' ? 'HIDDEN ✓' : removing ? 'HIDING…' : 'HIDE'}</button
						>
					</form>
				</div>
			{:else if cell === 'unhide' || cell === 'unhidden'}
				<div class="lib">
					<form
						method="POST"
						action="{seriesHref}?/hide"
						use:enhance={() => {
							removing = true;
							rowError = null;
							return async ({ result }) => {
								removing = false;
								if (result.type === 'success' || result.type === 'redirect') unhidden = true;
								else if (result.type === 'failure' || result.type === 'error')
									rowError = rowRefusal();
							};
						}}
					>
						<input type="hidden" name="on" value="0" />
						<button type="submit" disabled={removing || cell === 'unhidden'} data-focus-mark="in"
							>{cell === 'unhidden' ? 'UNHIDDEN ✓' : removing ? 'SHOWING…' : 'UNHIDE'}</button
						>
					</form>
				</div>
			{:else if (cell === 'add' || cell === 'added') && addHref}
				<div class="lib">
					<form
						method="POST"
						action={addHref}
						use:enhance={() => {
							adding = true;
							rowError = null;
							return async ({ result }) => {
								adding = false;
								if (result.type === 'redirect' || result.type === 'success') added = true;
								else if (result.type === 'failure' || result.type === 'error')
									rowError = rowRefusal();
							};
						}}
					>
						<button type="submit" disabled={adding || cell === 'added'} data-focus-mark="in"
							>{cell === 'added' ? 'IN LIBRARY ✓' : adding ? 'ADDING…' : '+ ADD TO LIBRARY'}</button
						>
					</form>
				</div>
			{/if}
			{#if rowError}<div class="lib-err" role="alert">{rowError}</div>{/if}
		{:else if next}
			<div class="next">
				<div class="kicker-2">NEXT</div>
				<div class="big" class:faded={variant !== 'chapter'}>{nextTitle}</div>
				<div class="sub">
					{#if variant === 'chapter' && next.online}
						ONLINE · FROM THE SOURCE
					{:else if variant === 'chapter'}
						{next.pageCount} PAGES{nextCached ? ' · ↓ CACHED' : ''}{nextOcr ? ' · OCR ✓' : ''}
					{:else if variant === 'missing'}
						○ NOT DOWNLOADED
					{:else if next.online}
						○ ONLINE ONLY
					{:else}
						○ NOT CACHED
					{/if}
				</div>
			</div>
			{#if words > 0 && !incognito}
				<!-- eslint-disable-next-line svelte/no-navigation-without-resolve -- resolved by the page -->
				<a class="words" href={wordsHref}>
					<span class="wl">WORDS</span>
					<span class="wn">{words} LOOKED UP IN {entryName}</span>
					<span class="wr">REVIEW →</span>
				</a>
			{/if}
			{#if variant === 'chapter'}
				<div class="go">
					{mode === 'rtl' ? '← TAP OR SWIPE TO CONTINUE' : 'TAP OR SWIPE TO CONTINUE →'}
				</div>
			{:else if variant === 'missing'}
				<p class="why">
					{nextTitle} isn't on the workstation: it was read online, or hasn't been copied over yet. A
					scan picks it up once it is.
				</p>
			{:else}
				<p class="why">{nextTitle} opens once the workstation is reachable.</p>
			{/if}
		{/if}

		{#if incognito}
			<div class="incog">
				<div class="it">INCOGNITO · NOTHING SAVED</div>
				<div class="id">
					{entryName.charAt(0)}{entryName.slice(1).toLowerCase()} still reads as it did, and CONTINUE
					and history are unchanged. Rating and FAV still save.
				</div>
			</div>
		{/if}
	</div>

	<div class="foot">
		<!-- eslint-disable svelte/no-navigation-without-resolve -- both hrefs are resolved by the page -->
		<a class="fcell" href={seriesHref} use:backLink data-focus-mark="in">← SERIES</a>
		<span class="spacer"></span>
		{#if variant === 'series' && work}
			<a class="fcell right" href={workHref} use:backLink data-focus-mark="in"
				>{work.name.toUpperCase()} · WORK</a
			>
		{/if}
		{#if variant === 'chapter'}
			<button type="button" class="fcell right dim" data-focus-mark="in" onclick={onback}
				>{mode === 'rtl' ? `${lastPage} · BACK ${back}` : `${back} BACK · ${lastPage}`}</button
			>
		{:else}
			<a class="fcell right" href={libraryHref} use:backLink data-focus-mark="in">LIBRARY</a>
		{/if}
		<!-- eslint-enable svelte/no-navigation-without-resolve -->
	</div>
</div>

<style>
	.end {
		position: relative;
		width: 100vw;
		height: 100dvh;
		display: flex;
		flex-direction: column;
		background: var(--surface-page);
		color: var(--text-1);
	}
	.end.incognito::before {
		content: '';
		position: absolute;
		top: 0;
		left: 0;
		right: 0;
		border-top: 2px dashed var(--text-2);
	}
	.offline {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 12px;
		height: 48px;
		flex-shrink: 0;
		padding: 0 24px;
		border-bottom: var(--hairline);
		background: var(--surface-panel);
		font: 500 14px var(--font-mono);
	}
	.dim {
		color: var(--text-2);
	}
	.body {
		flex: 1;
		display: flex;
		flex-direction: column;
		justify-content: center;
		gap: 40px;
		padding: 0 64px;
		min-height: 0;
	}
	.body.series {
		gap: 36px;
	}
	.kicker,
	.kicker-2 {
		display: flex;
		justify-content: space-between;
		gap: 12px;
		font: 500 13px var(--font-mono);
		letter-spacing: var(--tracking-label);
		color: var(--text-2);
	}
	.rule {
		height: 1px;
		background: var(--line-1);
	}
	.next {
		display: flex;
		flex-direction: column;
		gap: 12px;
	}
	.big {
		font: 500 44px/50.6px var(--font-sans);
		text-wrap: pretty;
	}
	.big.faded {
		opacity: 0.4;
	}
	.sub {
		font: 400 15px var(--font-mono);
		color: var(--text-2);
	}
	/* A row on the boundary page, not a prompt. */
	.words {
		display: flex;
		align-items: stretch;
		height: 72px;
		border-top: var(--hairline);
		border-bottom: var(--hairline);
		color: var(--text-1);
		text-decoration: none;
	}
	.wl {
		display: flex;
		align-items: center;
		width: 120px;
		flex-shrink: 0;
		border-right: var(--hairline);
		font: 500 13px var(--font-mono);
		letter-spacing: 0.06em;
		color: var(--text-2);
	}
	.wn {
		flex: 1;
		min-width: 0;
		display: flex;
		align-items: center;
		padding: 0 18px;
		font: 500 15px var(--font-mono);
	}
	.wr {
		display: flex;
		align-items: center;
		padding: 0 24px;
		border-left: var(--hairline);
		font: 500 14px var(--font-mono);
	}
	.words:active {
		background: var(--surface-inverse);
		color: var(--text-inverse);
	}
	/* A quiet source (doc/MOVE.md): the line and its cell, on the page's own rule. */
	.stale {
		display: flex;
		align-items: stretch;
		min-height: 56px;
		border-top: var(--hairline);
		border-bottom: var(--hairline);
	}
	.stale span {
		flex: 1;
		min-width: 0;
		display: flex;
		align-items: center;
		padding: 0 18px;
		font: 500 13px var(--font-mono);
		letter-spacing: 0.04em;
		color: var(--text-2);
	}
	.scell {
		display: flex;
		align-items: center;
		padding: 0 24px;
		border-left: var(--hairline);
		color: var(--text-1);
		font: 500 14px var(--font-mono);
		letter-spacing: 0.04em;
		text-decoration: none;
		white-space: nowrap;
	}
	.scell:active {
		background: var(--surface-inverse);
		color: var(--text-inverse);
	}
	.go {
		font: 500 16px var(--font-mono);
		color: var(--accent);
	}
	/* NEXT IN THE WORK (Work-End, Work-EndStates 1, 2 and 4) ------------------ */
	.ink {
		color: var(--text-1);
	}
	.big.m {
		font-size: 32px;
		line-height: 38px;
	}
	.nextw {
		display: flex;
		border: var(--hairline);
	}
	.nextw .cvw {
		padding: 20px;
		border-right: var(--hairline);
	}
	.nextw .cv {
		display: block;
		width: 112px;
	}
	.nextw .col {
		flex: 1;
		min-width: 0;
		display: flex;
		flex-direction: column;
	}
	.nextw .info {
		flex: 1;
		display: flex;
		flex-direction: column;
		justify-content: center;
		gap: 12px;
		padding: 20px 24px;
	}
	.nextw .info .k {
		font: 500 12px var(--font-mono);
		letter-spacing: 0.06em;
		color: var(--text-2);
	}
	.nextw .go {
		display: flex;
		align-items: stretch;
		height: 72px;
		border-top: var(--hairline);
		font: inherit;
		color: var(--text-1);
	}
	.nextw .go > * {
		display: flex;
		align-items: center;
		padding: 0 24px;
		font: 500 15px var(--font-mono);
		letter-spacing: 0.04em;
		white-space: nowrap;
		border-left: var(--hairline);
		color: var(--text-1);
		text-decoration: none;
		background: transparent;
		border-top: 0;
		border-right: 0;
		border-bottom: 0;
		cursor: pointer;
	}
	.nextw .go > .acc {
		flex: 1;
		justify-content: space-between;
		background: var(--accent);
		color: var(--on-accent);
		border-left: 0;
	}
	.nextw .go > .acc .m {
		font-weight: 400;
		font-size: 13px;
	}
	.nextw .go > .dim {
		color: var(--text-2);
		background: transparent;
		cursor: default;
	}
	.nextw .go > .dl {
		font-size: 13px;
	}
	.wrow {
		display: flex;
		align-items: stretch;
		min-height: 64px;
		border: var(--hairline);
		color: var(--text-1);
		text-decoration: none;
	}
	.wrow .wl {
		width: 120px;
		flex-shrink: 0;
		display: flex;
		align-items: center;
		padding-left: 20px;
		border-right: var(--hairline);
		font: 500 13px var(--font-mono);
		letter-spacing: 0.06em;
		color: var(--text-2);
	}
	.wrow .wn {
		flex: 1;
		min-width: 0;
		display: flex;
		flex-direction: column;
		justify-content: center;
		gap: 4px;
		padding: 8px 18px;
		font: 500 15px var(--font-mono);
	}
	.wrow .wn .b {
		font: 400 12px var(--font-mono);
		color: var(--text-2);
	}
	.wrow .wr {
		display: flex;
		align-items: center;
		padding: 0 24px;
		border-left: var(--hairline);
		font: 500 14px var(--font-mono);
		white-space: nowrap;
	}
	.wrow:active {
		background: var(--surface-inverse);
		color: var(--text-inverse);
	}
	/* A row that cannot open (no file, or offline and not cached): dimmed, and not a cell. */
	.wrow.dim {
		color: var(--text-2);
	}
	.wrow.dim .wr {
		color: var(--text-2);
	}
	/* The unopenable row's one cell: live ink in a dimmed row, as the block's is. */
	.wrow.dim .wr.dl {
		border: 0;
		border-left: var(--hairline);
		background: transparent;
		color: var(--text-1);
		font-size: 13px;
		letter-spacing: 0.04em;
		cursor: pointer;
	}
	.wrow.dim .wr.dl:disabled {
		cursor: default;
	}
	.why {
		margin: 0;
		max-width: 520px;
		font: var(--type-body);
		color: var(--text-2);
	}
	.rate-block {
		display: flex;
		flex-direction: column;
		border-top: var(--hairline);
	}
	/* The library row (c655): one cell, ADD for a record or HIDE for a series. */
	.lib {
		display: flex;
		border: var(--hairline);
	}
	.lib form {
		flex: 1;
		display: flex;
	}
	.lib button {
		flex: 1;
		min-height: 56px;
		padding: 0 20px;
		font: 500 14px var(--font-mono);
		letter-spacing: 0.04em;
		text-align: left;
		color: var(--text-2);
	}
	.lib button:disabled {
		cursor: default;
	}
	/* A refused row action's own words (c673): under the row, never in place of
	   it, so the cell that was pressed is still there for a second try. */
	.lib-err {
		display: flex;
		align-items: center;
		min-height: 40px;
		padding: 0 20px;
		border: var(--hairline);
		border-top: 0;
		font: 400 12px/1.4 var(--font-mono);
		color: var(--text-2);
	}
	.rrow {
		display: flex;
		align-items: stretch;
		height: 72px;
		border-bottom: var(--hairline);
	}
	.rlabel {
		display: flex;
		align-items: center;
		width: 120px;
		flex-shrink: 0;
		border-right: var(--hairline);
		font: 500 13px var(--font-mono);
		letter-spacing: var(--tracking-label);
		color: var(--text-2);
	}
	button {
		border: 0;
		border-radius: 0;
		background: transparent;
		color: var(--text-1);
		cursor: pointer;
	}
	.switch {
		display: flex;
		align-items: center;
		gap: 12px;
		padding: 0 18px;
		font: 500 15px var(--font-mono);
	}
	.track {
		position: relative;
		width: 44px;
		height: 24px;
		border: 1px solid var(--line-2);
	}
	.knob {
		position: absolute;
		top: 2px;
		left: 2px;
		width: 18px;
		height: 18px;
		background: var(--text-2);
	}
	.track.on {
		border-color: var(--accent);
		background: var(--accent);
	}
	.track.on .knob {
		left: 22px;
		background: var(--on-accent);
	}
	.note {
		font: 400 12px var(--font-mono);
		letter-spacing: 0.04em;
		color: var(--text-2);
	}
	.incog {
		display: flex;
		flex-direction: column;
		gap: 8px;
		padding: 18px 20px;
		border: 1px dashed var(--line-2);
	}
	.it {
		font: 500 14px var(--font-mono);
		letter-spacing: 0.04em;
	}
	.id {
		font: 400 16px/24px var(--font-sans);
		color: var(--text-2);
	}
	.foot {
		display: flex;
		height: 64px;
		flex-shrink: 0;
		border-top: var(--hairline);
	}
	.fcell {
		display: flex;
		align-items: center;
		padding: 0 24px;
		border-right: var(--hairline);
		color: var(--text-1);
		font: 500 14px var(--font-mono);
		letter-spacing: 0.04em;
		text-decoration: none;
	}
	.fcell.right {
		border-right: 0;
		border-left: var(--hairline);
	}
	.fcell.dim {
		color: var(--text-2);
	}
	.spacer {
		flex: 1;
	}
	@media (max-width: 599px) {
		.body {
			padding: 0 24px;
			gap: 28px;
		}
		.big {
			font-size: 32px;
			line-height: 38px;
		}
		.big.m {
			font-size: 20px;
			line-height: 26px;
		}
		.nextw .cvw {
			padding: 14px;
		}
		.nextw .cv {
			width: 64px;
		}
		.nextw .info {
			padding: 14px 16px;
			gap: 8px;
		}
		/* The block's row on a phone (c535): beside a 64px cover the column is
		   about 270px, and its one-line cells (START, DOWNLOAD FIRST 10 EPISODES
		   or NOT QUEUED · TRY THE SERIES, WORK →) are over twice that. So the
		   row leaves the column and spans the block under the cover, as
		   Work-Phone draws the phone's START under it, and wraps: START on a
		   line of its own (its note under it where the line is short), the
		   other cells sharing the next. Every cell stays a 64px stop. */
		.nextw {
			flex-wrap: wrap;
		}
		.nextw .col {
			display: contents;
		}
		.nextw .info {
			flex: 1;
			min-width: 0;
		}
		.nextw .go {
			flex-basis: 100%;
			flex-wrap: wrap;
			height: auto;
		}
		.nextw .go > * {
			min-height: 64px;
			padding: 0 16px;
			font-size: 14px;
			flex: 1;
			justify-content: center;
			border-top: var(--hairline);
		}
		.nextw .go > .acc {
			flex-basis: 100%;
			flex-wrap: wrap;
			justify-content: space-between;
			align-content: center;
			column-gap: 12px;
			border-top: 0;
		}
		.nextw .go > .acc + * {
			border-left: 0;
		}
		/* MEANWHILE, the row's one word, whole: 72px cut it by 12 (c535). */
		.wrow .wl {
			width: 84px;
			padding-left: 12px;
			font-size: 12px;
			letter-spacing: 0.02em;
		}
		/* The row's one cell can say NOT QUEUED · TRY THE SERIES: on a phone it
		   wraps to two lines rather than squeezing the row's words to nothing. */
		.wrow .wr {
			padding: 0 16px;
			font-size: 13px;
			white-space: normal;
			max-width: 132px;
		}
		.fcell {
			padding: 0 16px;
			font-size: 13px;
		}
		.rlabel {
			width: 72px;
		}
	}
</style>

<script lang="ts">
	import { enhance } from '$app/forms';
	import { invalidateAll } from '$app/navigation';
	import { settleReplacing } from '$lib/back';
	import { page } from '$app/state';
	import Sheet from '$lib/components/chrome/Sheet.svelte';
	import Cover from '$lib/components/content/Cover.svelte';
	import {
		moveItem,
		orderBooks,
		sharedStart,
		type GroupAnswer,
		type OrderMode
	} from '$lib/library/books';
	import { untrack } from 'svelte';
	import { defaultWorkName } from '$lib/library/works';
	import { defaultShowName } from '$lib/library/season-name';
	import { count, unitLabel } from '$lib/library/labels';
	import { kindFacts } from '$lib/library/kinds';
	import type { ShowFacts } from '$lib/library/selection';
	import type { Kind } from '$lib/library/types';
	import { addedMonth } from '$lib/library/series';
	import { coverSrc } from '$lib/library/links';
	import { m } from '$lib/paraglide/messages';

	/**
	 * Grouping by hand (Index Books, state 6; Works Calls, "Making and breaking
	 * a Work"): what the selection becomes first, then NEW / ADD TO, a NAME, an
	 * ORDER, and the rows.
	 *
	 * The AS row is W4's (c278, Work-Group B5). It shows only the answers the
	 * selection allows -- one series of books, one series of volumes, and a Work
	 * always -- and the answer names the noun for the rest of the sheet. A Work
	 * keeps every series apart, so its rows are numbered with ↑ ↓ and its name
	 * defaults to the words every title starts with (empty when they share
	 * none).
	 *
	 * Opened from the library's bulk bar with the selection, or from a
	 * suggestion's REVIEW → with `suggested` set: then each row has a tick, and
	 * the books left unticked are recorded as not belonging (the whole set is
	 * stored as dismissed, so the suggestion doesn't return).
	 *
	 * Opened from MIGHT CONTINUE <WORK>'s REVIEW → with `offer` set (W7; Works
	 * Calls, question 6): ADD TO A WORK into that Work, its run numbered above
	 * and the newcomer last and ticked. Nothing joins until ADD 1 TO THE WORK
	 * is tapped; NOT THIS stores the offer as dismissed instead.
	 */
	type Book = {
		seriesId: number;
		title: string;
		hue: number;
		addedAt: number;
		cover?: number | null;
		/** "MANGA · 281 CH. · 41 READ": the row's second line. Absent on a suggestion. */
		meta?: string;
		/** Finished entries, for a show's WATCHED (the card's `readCount`). */
		readCount?: number;
		/** The row's kind and count, as the selection keeps them: the show line's EP. and WATCHED. */
		kind?: Kind;
		entryCount?: number;
		/**
		 * A show's own line's facts (c283; `season-facts.ts`): the season's
		 * source, its AniList year and how many episodes have a file. Null where
		 * the page read none, and the row keeps `meta`.
		 */
		show?: ShowFacts | null;
		/** The Work it is in now: the row says IN <WORK> · MOVES HERE (W4). */
		inWork?: string | null;
	};

	let {
		open,
		books,
		existing,
		existingVolumes = [],
		existingWorks = [],
		answers = ['books'],
		suggested = false,
		offer = null,
		noun = 'BOOKS',
		absolute = false,
		ondone,
		onstale,
		onclose
	}: {
		open: boolean;
		books: Book[];
		existing: { id: number; title: string; books: number }[];
		/** Novels' series, for ADD TO EXISTING once VOLUMES is the answer. */
		existingVolumes?: { id: number; title: string; books: number }[];
		/**
		 * Works a selection can move into: ADD TO A WORK · N (W4). `createdAt`
		 * is posted back with the id, so a Work that ended and whose id a newer
		 * one took since the sheet was drawn refuses rather than take the
		 * selection (c583).
		 */
		existingWorks?: { id: number; name: string; createdAt: number; series: number }[];
		/** What the selection allows, from `groupAnswers()` (doc/BOOKS.md, "The AS row"). */
		answers?: GroupAnswer[];
		suggested?: boolean;
		/**
		 * Post ADD TO A WORK to the library by its full path (c838): a sheet
		 * drawn on `/search` has no `?/addToWork` of its own, where the series
		 * screen's relative one is its own action.
		 */
		absolute?: boolean;
		/**
		 * A Work offer under review: the Work it would join, the place it would
		 * take, its run as it stands, and the key NOT THIS stores. `books` is then
		 * the newcomer alone, and `existingWorks` holds that Work.
		 */
		offer?: { workId: number; name: string; part: number; key: string; parts: Book[] } | null;
		/** VOLUMES when the answer is volumes: the same sheet, the same steps. */
		noun?: 'BOOKS' | 'VOLUMES' | 'SEASONS';
		/**
		 * After a Work is made or added to: the sheet closes and the selection
		 * ends. On a series screen it is handed the action's answer: `?/work` is
		 * the library's action, and SvelteKit applies a form only to the page it
		 * belongs to, so that screen's `form` never sees it (c700).
		 */
		ondone?: (answer?: Record<string, unknown>) => void;
		/**
		 * A refusal the sheet cannot answer (a Work gone, or remade under its id:
		 * c583, c584), handed over before it closes. Only a page the answer does
		 * not belong to needs it: on the library and the series screen `form`
		 * carries it, and `invalidateAll()` re-reads the lists.
		 */
		onstale?: (message: string) => void;
		onclose: () => void;
	} = $props();

	let answer = $state<GroupAnswer>('books');
	let mode = $state<'new' | 'existing'>('new');
	let orderMode = $state<OrderMode>('date');
	let rows = $state<Book[]>([]);
	let ticked = $state<number[]>([]);
	let name = $state('');
	/** What a show's default name lost: `SEASON 2`, for the NAME label (c283). */
	let showWithout = $state<string | null>(null);
	let into = $state<number | null>(null);
	/** Why the last try didn't group, from the server; shown until the next. */
	let refused = $state('');
	let busy = $state(false);

	/** The selection's own order, which BY HAND for a Work keeps. */
	function asSelected(list: Book[]): Book[] {
		const at = new Map(books.map((b, i) => [b.seriesId, i]));
		return [...list].sort(
			(a, b) => (at.get(a.seriesId) ?? 0) - (at.get(b.seriesId) ?? 0) || a.seriesId - b.seriesId
		);
	}

	/** A Work's name is the words every title starts with, or empty (W1's rule). */
	const defaultName = (a: GroupAnswer) =>
		a === 'work'
			? defaultWorkName(books.map((b) => b.title))
			: sharedStart(books.map((b) => b.title));

	/**
	 * A show row's second line (`Seasons-Group.dc.html`, A1): the season's
	 * source, its episodes, the year, WATCHED in ink and how many are on disk.
	 * A fact the server did not answer drops out with its dot -- a source a
	 * series has none of, a year with no AniList entry -- and a row with no
	 * facts at all keeps the library's line.
	 */
	function showLine(b: Book): { text: string; ink?: boolean }[] | null {
		if (!b.show || !b.kind || b.entryCount === undefined) return null;
		const unit = kindFacts(b.kind).unit;
		const parts = [
			b.show.source ? { text: b.show.source.toUpperCase() } : null,
			{ text: `${count(b.entryCount)} ${unitLabel(b.kind)}.` },
			b.show.year ? { text: String(b.show.year) } : null,
			{ text: `${count(b.readCount ?? 0)} ${unit.done}`, ink: true },
			{ text: `${count(b.show.here)} HERE` }
		];
		return parts.filter((p) => p !== null);
	}

	/** A show's name is the shortest title without its trailing season marker (c283). */
	function defaultFor(a: GroupAnswer): { name: string; without: string | null } {
		if (a === 'show') return defaultShowName(books.map((b) => b.title));
		return { name: defaultName(a), without: null };
	}

	// Each time the sheet opens, start from the given books. The reset reads them
	// untracked: only `open` may run it again, or choosing an AS answer would be
	// undone the next time the page handed down a new array (W4's AS row).
	$effect(() => {
		if (!open) return;
		untrack(() => {
			answer = offer ? 'work' : (answers[0] ?? 'work');
			// A Work's ORDER starts BY HAND, in the order the series were selected;
			// books and volumes start BY DATE ADDED, as they always have.
			orderMode = answer === 'work' ? 'hand' : 'date';
			rows = answer === 'work' ? asSelected(books) : orderBooks(books.map(withId), 'date');
			// An offer is an add into one Work, never a new one (question 6).
			mode = offer ? 'existing' : 'new';
			// No target yet: `intoValue` takes the answer's own first, so a Work's
			// id can never be read as a series' (they are both small integers).
			into = offer ? offer.workId : null;
			ticked = books.map((b) => b.seriesId);
			refused = '';
			const def = defaultFor(answer);
			name = def.name;
			showWithout = def.without;
		});
	});

	const withId = (b: Book) => ({ ...b, id: b.seriesId });

	function setAnswer(a: GroupAnswer) {
		if (a === answer) return;
		answer = a;
		// The answer names the noun for the rest of the sheet: ORDER's default
		// and the name's default follow it.
		orderMode = a === 'work' ? 'hand' : 'date';
		rows = a === 'work' ? asSelected(rows) : orderBooks(rows.map(withId), 'date');
		mode = 'new';
		// The answer's own first, chosen by `intoValue`; a target from the old
		// answer's list is not carried over.
		into = null;
		const def = defaultFor(a);
		name = def.name;
		showWithout = def.without;
		refused = '';
	}

	function setOrder(m: OrderMode) {
		orderMode = m;
		if (m !== 'hand') rows = orderBooks(rows.map(withId), m);
	}

	function nudge(i: number, by: number) {
		rows = moveItem(rows, i, i + by);
		orderMode = 'hand';
	}

	function toggle(id: number) {
		ticked = ticked.includes(id) ? ticked.filter((t) => t !== id) : [...ticked, id];
	}

	const work = $derived(answer === 'work');
	const show = $derived(answer === 'show');
	const nouns = $derived(
		show ? 'SEASONS' : work ? 'SERIES' : answer === 'volumes' ? 'VOLUMES' : 'BOOKS'
	);
	const sheetNoun = $derived(show ? 'SEASONS' : work ? 'SERIES' : noun);
	const chosen = $derived(rows.filter((b) => ticked.includes(b.seriesId)));
	/** Reading positions for the ticked rows; an unticked row shows a dash. An
	 * offer's newcomer counts on from the run it would join: it goes last. */
	const numbers = $derived.by(() => {
		let n = offer ? offer.parts.length : 0;
		const out: Record<number, string> = {};
		for (const b of rows)
			out[b.seriesId] = ticked.includes(b.seriesId) ? String(++n).padStart(2, '0') : '—';
		return out;
	});
	const orderLabel = $derived(
		orderMode === 'date' ? 'BY DATE ADDED' : orderMode === 'title' ? 'BY TITLE' : 'BY HAND'
	);
	/** The INTO choice's list: the answer's own, so a Work never offers a series. */
	const intoList = $derived(
		show
			? []
			: work
				? existingWorks.map((w) => ({ id: w.id, title: w.name, books: w.series }))
				: answer === 'volumes'
					? existingVolumes
					: existing
	);
	/**
	 * The INTO target that is actually offered, checked and posted: never an id
	 * the visible list does not hold. A change of answer, or a new selection
	 * arriving, can leave `into` pointing at another answer's list; the sheet
	 * then falls back to the first of the answer's own, and only to none when
	 * that list is empty.
	 */
	const intoValue = $derived(
		into !== null && intoList.some((s) => s.id === into) ? into : (intoList[0]?.id ?? null)
	);
	const canCreate = $derived(
		mode === 'new'
			? chosen.length >= 2 && name.trim() !== ''
			: chosen.length >= 1 && intoValue !== null
	);
	const title = $derived(
		offer
			? m.offer_into_part({ name: offer.name.toUpperCase(), part: offer.part })
			: suggested
				? `SUGGESTED · ${chosen.length} OF ${books.length} TICKED`
				: show
					? `GROUP · ${books.length} SELECTED`
					: `GROUP ${books.length} ${sheetNoun}`
	);
	/** Ticks on the rows: a books suggestion's, and an offer's one newcomer. */
	const ticks = $derived(suggested || offer !== null);

	/** "2 BOOKS, ONE SERIES"; "3 SERIES, KEPT APART": the answer's own line. */
	function answerMeta(a: GroupAnswer): string {
		const n = books.length;
		if (a === 'work') return `${n} SERIES, KEPT APART`;
		if (a === 'show') return `${n} SEASONS, ONE SERIES`;
		if (a === 'volumes') return `${n} VOLUMES, ONE SERIES`;
		return `${n} ${n === 1 ? 'BOOK' : 'BOOKS'}, ONE SERIES`;
	}
</script>

<Sheet {open} {onclose} label="Group into a series">
	<!-- A refusal says why, in the sheet, which stays open (it used to be dropped). -->
	<form
		method="POST"
		action={work ? '/?/work' : '/?/group'}
		class="group"
		use:enhance={() => {
			refused = '';
			busy = true;
			return async ({ result, update }) => {
				busy = false;
				if (result.type === 'failure') {
					const data = result.data as Record<string, unknown> | undefined;
					// The Work the sheet was drawn with is gone, or another Work holds
					// its id now (c583, c584): nothing in the sheet can be answered
					// any more, so it closes, the page says why, and the page is read
					// again -- MIGHT CONTINUE then offers what is true now, or nothing,
					// and ADD TO A WORK lists the Works there are. Every other refusal
					// (a name taken, a mixed hidden set) keeps the sheet open on its
					// reason, since another try from the same sheet can succeed.
					if (data?.stale === true) {
						await update();
						await invalidateAll();
						onstale?.(String(data.workMessage ?? data.groupMessage ?? data.message ?? 'NOT DONE'));
						onclose();
						return;
					}
					refused = String(
						data?.groupMessage ?? data?.workMessage ?? data?.message ?? 'DID NOT GROUP'
					);
					return;
				}
				if (result.type === 'error') {
					refused = 'DID NOT GROUP · THE WORKSTATION DID NOT ANSWER';
					return;
				}
				// From a singleton's own screen, that series is gone once grouped: the
				// new one takes its place in history, or back lands on a 404. From the
				// library, the library stays to go back to.
				if (page.route.id === '/series/[id]') {
					await settleReplacing({ result, update });
					// An offer's add keeps the series: its screen stays, with its band.
					// So does a Work made from OTHER FORMS (c700), which says so with `ondone`.
					if (offer) onclose();
					else if (ondone) ondone(result.type === 'success' ? result.data : undefined);
				} else {
					await update();
					// A Work is made or joined in place: the library stays, with its
					// band, and the selection it came from ends (W4).
					if (work) (ondone ?? onclose)();
				}
			};
		}}
	>
		<div class="head sheet-head">
			<div class="h-title">{title}</div>
			<button type="button" class="cancel" onclick={onclose}>CANCEL</button>
		</div>

		{#if !suggested && !offer}
			<!-- AS: only what the selection allows, and a Work always (Works Calls, Q7). -->
			<div class="sl as"><span>AS</span><span>WHAT THEY BECOME</span></div>
			<div class="seg tall answers" role="radiogroup" aria-label="Group as">
				{#each answers as a (a)}
					<button
						type="button"
						role="radio"
						aria-checked={answer === a}
						class:on={answer === a}
						onclick={() => setAnswer(a)}
					>
						{a === 'books'
							? 'ONE SERIES · BOOKS'
							: a === 'volumes'
								? 'ONE SERIES · VOLUMES'
								: a === 'show'
									? 'ONE SHOW'
									: 'A WORK · SERIES'}<span class="m">{answerMeta(a)}</span>
					</button>
				{/each}
			</div>
		{/if}

		{#if !offer}
			<div class="sl into"><span>INTO</span><span></span></div>
			<div class="seg into" role="radiogroup" aria-label="Group into">
				<button
					type="button"
					role="radio"
					aria-checked={mode === 'new'}
					class:on={mode === 'new'}
					onclick={() => (mode = 'new')}>{work ? 'NEW WORK' : 'NEW SERIES'}</button
				>
				<button
					type="button"
					role="radio"
					aria-checked={mode === 'existing'}
					class:on={mode === 'existing'}
					disabled={intoList.length === 0}
					onclick={() => (mode = 'existing')}
					>{work ? 'ADD TO A WORK' : show ? 'ADD TO A SHOW' : 'ADD TO EXISTING'} · {intoList.length}</button
				>
			</div>
		{/if}

		{#if mode === 'new'}
			<div class="sl name-label">
				<span>NAME</span>
				<span
					>{show
						? showWithout
							? `WITHOUT “${showWithout}”`
							: 'THE SHORTEST TITLE'
						: work && name.trim() === ''
							? 'THE TITLES SHARE NO WORDS'
							: 'WORDS EVERY TITLE STARTS WITH'}</span
				>
			</div>
			<input
				class="name"
				class:show
				name="name"
				bind:value={name}
				aria-label={work ? 'Work name' : show ? 'Show name' : 'Series name'}
				placeholder={work ? 'NAME IT FOR YOURSELF' : ''}
				autocomplete="off"
			/>
		{:else}
			<div class="sl">
				<span>{work ? 'WORK' : 'SERIES'}</span><span
					>{work ? 'IT KEEPS ITS OWN ORDER' : 'SAME LIBRARY ROOT'}</span
				>
			</div>
			<div class="existing">
				{#each intoList as s (s.id)}
					<label class="ex" class:on={intoValue === s.id}>
						<input
							type="radio"
							name="into"
							value={s.id}
							checked={intoValue === s.id}
							onchange={() => (into = s.id)}
						/>
						<span class="ex-title">{s.title}</span>
						<span class="dim">{s.books} {s.books === 1 ? nouns.slice(0, -1) : nouns}</span>
					</label>
				{/each}
			</div>
		{/if}

		{#if !offer}
			<div class="sl order-label">
				<span>{show ? `SEASONS · ${chosen.length}` : 'ORDER'}</span><span
					>{show
						? 'THE ORDER IS THE NUMBERING'
						: work && orderMode === 'hand'
							? 'BY HAND: AS SELECTED'
							: orderLabel}</span
				>
			</div>
			<div class="seg order">
				{#if work}
					<button type="button" class:on={orderMode === 'hand'} onclick={() => setOrder('hand')}
						>BY HAND</button
					>
					<button type="button" class:on={orderMode === 'date'} onclick={() => setOrder('date')}
						>{show ? 'BY DATE ADDED' : 'BY DATE'}</button
					>
					<button type="button" class:on={orderMode === 'title'} onclick={() => setOrder('title')}
						>BY TITLE</button
					>
				{:else}
					<button type="button" class:on={orderMode === 'date'} onclick={() => setOrder('date')}
						>{show ? 'BY DATE ADDED' : 'BY DATE'}</button
					>
					<button type="button" class:on={orderMode === 'title'} onclick={() => setOrder('title')}
						>BY TITLE</button
					>
					<button type="button" class:on={orderMode === 'hand'} onclick={() => setOrder('hand')}
						>BY HAND</button
					>
				{/if}
			</div>
		{/if}

		<ol class="rows" class:grows={work || show}>
			{#if offer}
				<!-- The run it would join, as it stands: numbered, not ticked, not posted. -->
				{#each offer.parts as p, i (p.seriesId)}
					<li class="row gr inrun">
						<span class="tick-gap" aria-hidden="true"></span>
						<span class="num">{String(i + 1).padStart(2, '0')}</span>
						<span class="cov"
							><Cover
								src={coverSrc(p.seriesId, p.cover)}
								hue={p.hue}
								width={34}
								height={49}
							/></span
						>
						<span class="t"><span class="a">{p.title}</span><span class="b">IN THE WORK</span></span
						>
					</li>
				{/each}
			{/if}
			{#each rows as b, i (b.seriesId)}
				{@const on = ticked.includes(b.seriesId)}
				<li class="row" class:off={!on} class:gr={work || show}>
					{#if ticks}
						<button
							type="button"
							class="tick"
							role="checkbox"
							aria-checked={on}
							aria-label="Include {b.title}"
							onclick={() => toggle(b.seriesId)}
							><span class="box" class:on>{on ? '✓' : ''}</span></button
						>
					{/if}
					<span class="num">{show ? `S${i + 1}` : numbers[b.seriesId]}</span>
					<span class="cov"
						><Cover src={coverSrc(b.seriesId, b.cover)} hue={b.hue} width={34} height={49} /></span
					>
					{#if work}
						<span class="t">
							<span class="a">{b.title}</span>
							<span class="b">
								{b.meta ?? ''}{b.inWork
									? `${b.meta ? ' · ' : ''}IN ${b.inWork.toUpperCase()} · MOVES HERE`
									: ''}
							</span>
						</span>
					{:else if show}
						{@const line = showLine(b)}
						<span class="t">
							<span class="a">{b.title}</span>
							<span class="b">
								{#if line}{#each line as p, i (i)}{i > 0 ? ' · ' : ''}{#if p.ink}<span class="ink"
												>{p.text}</span
											>{:else}{p.text}{/if}{/each}{:else}{b.meta ?? addedMonth(b.addedAt)}{/if}
							</span>
						</span>
					{:else}
						<span class="t">{b.title}</span>
						<span class="d">{addedMonth(b.addedAt)}</span>
					{/if}
					{#if !offer}
						<button
							type="button"
							class="nudge"
							aria-label="Move {b.title} up"
							disabled={i === 0}
							onclick={() => nudge(i, -1)}>↑</button
						>
						<button
							type="button"
							class="nudge"
							aria-label="Move {b.title} down"
							disabled={i === rows.length - 1}
							onclick={() => nudge(i, 1)}>↓</button
						>
					{/if}
				</li>
			{/each}
		</ol>

		{#if work}
			<!-- What a Work promises, and what it does not do: every part stays itself. -->
			<div class="keeps">
				EACH KEEPS ITS OWN <span class="ink">RATING, FAV, FOLLOW, LINK AND FOLDER</span>. NOTHING
				MERGES; UNGROUP PUTS {chosen.length === 1 ? 'ONE SERIES' : `${chosen.length} SERIES`} BACK.
			</div>
		{:else if show}
			<!-- What the merge promises: one tile, and every season's own things stay its own. -->
			<div class="keeps">
				S{chosen.length}'S EPISODES BECOME <span class="ink">SEASON {chosen.length}</span> OF ONE
				SERIES: ONE TILE, ONE CONTINUE (S{chosen.length} · EP. 1). EACH SEASON KEEPS ITS SOURCE ENTRY,
				ITS ANILIST LINK, ITS FOLDER AND WHAT'S WATCHED.
			</div>
		{/if}

		{#each chosen as b (b.seriesId)}<input type="hidden" name="series" value={b.seriesId} />{/each}
		{#if offer}<input type="hidden" name="key" value={offer.key} />{/if}
		{#if suggested}
			{#each books as b (b.seriesId)}<input
					type="hidden"
					name="suggested"
					value={b.seriesId}
				/>{/each}
		{/if}
		{#if work}
			<!-- The sheet's own door: it may move a series between Works, which no
			     other caller of ?/work may (see the action). -->
			<input type="hidden" name="sheet" value="1" />
			<input type="hidden" name="answer" value={answer} />
			<input type="hidden" name="mode" value={mode} />
			{#if mode === 'existing'}
				<input type="hidden" name="work" value={intoValue ?? ''} />
				<input
					type="hidden"
					name="made"
					value={existingWorks.find((w) => w.id === intoValue)?.createdAt ?? ''}
				/>
			{/if}
		{:else}
			<input type="hidden" name="order" value={orderLabel} />
			<input type="hidden" name="mode" value={mode} />
			{#if show}<input type="hidden" name="answer" value="show" />{/if}
		{/if}

		{#if refused}
			<div class="refused" role="alert">{refused}</div>
		{/if}
		<div class="foot" class:sfoot={work || show}>
			<button
				type="submit"
				class="create"
				class:acc={work || show}
				disabled={!canCreate || busy}
				formaction={work && mode === 'existing'
					? absolute
						? '/?/addToWork'
						: '?/addToWork'
					: undefined}
			>
				{#if show}
					MERGE · {chosen.length} SEASONS INTO ONE SERIES<span class="m">UNDO AFTER</span>
				{:else if !work}
					{mode === 'new'
						? `CREATE SERIES · ${chosen.length} ${noun}`
						: `ADD ${chosen.length} ${noun}`}
				{:else if mode === 'new'}
					CREATE WORK · {chosen.length} SERIES
				{:else}
					ADD {chosen.length} TO THE WORK
				{/if}
			</button>
			{#if offer}
				<!-- NOT THIS, never "NOT A …": the books' NOT A SERIES is another
				     cell, and a locator by name matches by substring. -->
				<button type="submit" class="not" formaction="?/dismissWorkOffer"
					>{m.offer_not_this()}</button
				>
			{:else if suggested}
				<button type="submit" class="not" formaction="?/dismiss">{m.offer_not_a_series()}</button>
			{/if}
		</div>
	</form>
</Sheet>

<style>
	.group {
		display: flex;
		flex-direction: column;
	}
	.head {
		flex-shrink: 0;
		display: flex;
		align-items: stretch;
		height: 64px;
		border-bottom: var(--hairline);
	}
	.h-title {
		flex: 1;
		display: flex;
		align-items: center;
		padding: 0 24px;
		font: 500 15px var(--font-mono);
		letter-spacing: 0.04em;
	}
	button {
		border: 0;
		border-radius: 0;
		background: transparent;
		color: var(--text-1);
		cursor: pointer;
	}
	button:disabled {
		opacity: 0.4;
		cursor: default;
	}
	.cancel {
		padding: 0 28px;
		border-left: var(--hairline);
		font: 500 14px var(--font-mono);
		letter-spacing: 0.04em;
	}
	/* The label / control pair, as both Boards draw it (Work-Group B5). */
	.sl {
		display: flex;
		justify-content: space-between;
		gap: 12px;
		padding: 20px 24px 10px;
		font: 500 13px var(--font-mono);
		color: var(--text-2);
		letter-spacing: var(--tracking-label);
	}
	.order-label {
		padding-top: 22px;
	}
	/* The first label under the head sits 2px tighter (Work-Group B5). */
	.sl.as {
		padding-top: 18px;
	}
	.seg {
		display: grid;
		grid-auto-flow: column;
		grid-auto-columns: minmax(0, 1fr);
		margin: 0 24px;
		border: var(--hairline);
	}
	.seg > * {
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		gap: 3px;
		min-height: 52px;
		padding: 6px 8px;
		border-right: var(--hairline);
		font: 500 13px var(--font-mono);
		letter-spacing: 0.04em;
		text-align: center;
	}
	.seg > *:last-child {
		border-right: 0;
	}
	.seg > * .m {
		font: 400 11px var(--font-mono);
		color: var(--text-2);
		letter-spacing: 0.02em;
	}
	.seg > .on {
		background: var(--surface-inverse);
		color: var(--text-inverse);
	}
	.seg > .on .m {
		color: var(--text-inverse);
		opacity: 0.7;
	}
	.seg.tall > * {
		min-height: 64px;
	}
	.name {
		margin: 0 24px;
		height: 52px;
		padding: 0 16px;
		border: var(--rule-strong);
		border-radius: 0;
		background: transparent;
		color: var(--text-1);
		caret-color: var(--accent);
		font: 500 17px var(--font-sans);
		outline: none;
	}
	/* The show answer is the board's cell: a 14px inset and 16px type (c283).
	   The books' and the Work's sheets keep the 16/17 they have always had. */
	.name.show {
		padding: 0 14px;
		font: 500 16px var(--font-sans);
	}
	.existing {
		display: flex;
		flex-direction: column;
		border-top: var(--hairline);
	}
	.ex {
		display: flex;
		align-items: center;
		gap: 12px;
		height: 52px;
		padding: 0 24px;
		border-bottom: var(--hairline);
		cursor: pointer;
	}
	.ex input {
		position: absolute;
		opacity: 0;
		pointer-events: none;
	}
	.ex-title {
		flex: 1;
		font: 500 16px var(--font-sans);
	}
	.dim {
		font: 400 13px var(--font-mono);
		color: var(--text-2);
	}
	.ex.on .dim {
		color: inherit;
	}
	.rows {
		list-style: none;
		margin: 0;
		padding: 0;
	}
	/* A Work's rows are the board's .grows: one frame around every row. */
	.rows.grows {
		display: flex;
		flex-direction: column;
		margin: 0 24px;
		border: var(--hairline);
	}
	.row {
		display: flex;
		align-items: stretch;
		height: 64px;
		border-bottom: var(--hairline);
	}
	.rows.grows .row {
		height: auto;
		min-height: 64px;
		border-bottom: 0;
	}
	.rows.grows .row + .row {
		border-top: var(--hairline);
	}
	.row.off {
		opacity: 0.4;
	}
	.tick {
		width: 64px;
		flex-shrink: 0;
		display: flex;
		align-items: center;
		justify-content: center;
	}
	/* An offer's run: the tick column kept empty so its numbers line up with the newcomer's. */
	.tick-gap {
		width: 64px;
		flex-shrink: 0;
	}
	.row.inrun {
		color: var(--text-2);
	}
	.box {
		width: 24px;
		height: 24px;
		border: 1.5px solid var(--line-2);
		display: flex;
		align-items: center;
		justify-content: center;
		font: 500 14px var(--font-mono);
		color: var(--on-accent);
	}
	.box.on {
		border-color: var(--accent);
		background: var(--accent);
	}
	.num {
		width: 64px;
		flex-shrink: 0;
		padding-left: 24px;
		display: flex;
		align-items: center;
		font: 500 14px var(--font-mono);
		color: var(--text-2);
	}
	.tick + .num {
		padding-left: 0;
	}
	.rows.grows .num {
		width: 52px;
		padding-left: 0;
		justify-content: center;
		border-right: var(--hairline);
		color: var(--text-1);
		font: 500 13px var(--font-mono);
	}
	.cov {
		display: flex;
		align-items: center;
		padding-right: 16px;
	}
	.rows.grows .cov {
		padding: 0 0 0 12px;
	}
	.t {
		flex: 1;
		min-width: 0;
		display: flex;
		align-items: center;
		font: 400 16px var(--font-sans);
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}
	.rows.grows .t {
		flex-direction: column;
		align-items: flex-start;
		justify-content: center;
		gap: 4px;
		padding: 8px 12px;
	}
	.rows.grows .t .a {
		font: 500 14px/1.3 var(--font-sans);
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
		max-width: 100%;
	}
	.rows.grows .t .b {
		font: 400 11px/1.35 var(--font-mono);
		color: var(--text-2);
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
		max-width: 100%;
	}
	/* WATCHED is ink, the board's own emphasis (A1). */
	.rows.grows .t .b .ink {
		color: var(--text-1);
	}
	.d {
		display: flex;
		align-items: center;
		padding: 0 16px;
		font: 400 13px var(--font-mono);
		color: var(--text-2);
	}
	.nudge {
		width: 56px;
		flex-shrink: 0;
		border-left: var(--hairline);
		font: 500 15px var(--font-mono);
	}
	.rows.grows .nudge {
		width: 44px;
	}
	.nudge:active:not(:disabled) {
		background: var(--surface-inverse);
		color: var(--text-inverse);
	}
	.keeps {
		padding: 14px 24px 0;
		font: 400 12px/1.5 var(--font-mono);
		color: var(--text-2);
	}
	.keeps .ink {
		color: var(--text-1);
	}
	.refused {
		padding: 14px var(--pad);
		border-top: var(--hairline);
		font: 500 13px var(--font-mono);
		letter-spacing: var(--tracking-label);
		color: var(--text-1);
		background: var(--surface-panel);
	}
	.foot {
		display: flex;
		height: 68px;
		margin-top: 24px;
		border-top: var(--hairline);
	}
	.sfoot {
		height: 64px;
	}
	.create {
		flex: 2;
		background: var(--accent);
		color: var(--on-accent);
		font: 500 15px var(--font-mono);
	}
	.create .m {
		font-weight: 400;
		font-size: 12px;
	}
	.create.acc {
		flex: 1;
		justify-content: space-between;
		padding: 0 24px;
		font: 500 14px var(--font-mono);
		letter-spacing: 0.04em;
	}
	.not {
		flex: 1;
		color: var(--text-2);
		font: 500 15px var(--font-mono);
	}
	@media (max-width: 599px) {
		.d {
			display: none;
		}
		.nudge {
			width: 48px;
		}
	}
</style>

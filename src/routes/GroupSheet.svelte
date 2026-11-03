<script lang="ts">
	import { enhance } from '$app/forms';
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
	import { addedMonth } from '$lib/library/series';
	import { coverSrc } from '$lib/library/links';

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
	 */
	type Book = {
		seriesId: number;
		title: string;
		hue: number;
		addedAt: number;
		cover?: number | null;
		/** "MANGA · 281 CH. · 41 READ": the row's second line. Absent on a suggestion. */
		meta?: string;
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
		noun = 'BOOKS',
		ondone,
		onclose
	}: {
		open: boolean;
		books: Book[];
		existing: { id: number; title: string; books: number }[];
		/** Novels' series, for ADD TO EXISTING once VOLUMES is the answer. */
		existingVolumes?: { id: number; title: string; books: number }[];
		/** Works a selection can move into: ADD TO A WORK · N (W4). */
		existingWorks?: { id: number; name: string; series: number }[];
		/** What the selection allows, from `groupAnswers()` (doc/BOOKS.md, "The AS row"). */
		answers?: GroupAnswer[];
		suggested?: boolean;
		/** VOLUMES when the answer is volumes: the same sheet, the same steps. */
		noun?: 'BOOKS' | 'VOLUMES';
		/** After a Work is made or added to: the sheet closes and the selection ends. */
		ondone?: () => void;
		onclose: () => void;
	} = $props();

	let answer = $state<GroupAnswer>('books');
	let mode = $state<'new' | 'existing'>('new');
	let orderMode = $state<OrderMode>('date');
	let rows = $state<Book[]>([]);
	let ticked = $state<number[]>([]);
	let name = $state('');
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

	// Each time the sheet opens, start from the given books. The reset reads them
	// untracked: only `open` may run it again, or choosing an AS answer would be
	// undone the next time the page handed down a new array (W4's AS row).
	$effect(() => {
		if (!open) return;
		untrack(() => {
			answer = answers[0] ?? 'work';
			// A Work's ORDER starts BY HAND, in the order the series were selected;
			// books and volumes start BY DATE ADDED, as they always have.
			orderMode = answer === 'work' ? 'hand' : 'date';
			rows = answer === 'work' ? asSelected(books) : orderBooks(books.map(withId), 'date');
			mode = 'new';
			// No target yet: `intoValue` takes the answer's own first, so a Work's
			// id can never be read as a series' (they are both small integers).
			into = null;
			ticked = books.map((b) => b.seriesId);
			refused = '';
			name = defaultName(answer);
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
		name = defaultName(a);
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
	const nouns = $derived(work ? 'SERIES' : answer === 'volumes' ? 'VOLUMES' : 'BOOKS');
	const sheetNoun = $derived(work ? 'SERIES' : noun);
	const chosen = $derived(rows.filter((b) => ticked.includes(b.seriesId)));
	/** Reading positions for the ticked rows; an unticked row shows a dash. */
	const numbers = $derived.by(() => {
		let n = 0;
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
		work
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
		suggested
			? `SUGGESTED · ${chosen.length} OF ${books.length} TICKED`
			: `GROUP ${books.length} ${sheetNoun}`
	);

	/** "2 BOOKS, ONE SERIES"; "3 SERIES, KEPT APART": the answer's own line. */
	function answerMeta(a: GroupAnswer): string {
		const n = books.length;
		if (a === 'work') return `${n} SERIES, KEPT APART`;
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
				if (page.route.id === '/series/[id]') await settleReplacing({ result, update });
				else {
					await update();
					// A Work is made or joined in place: the library stays, with its
					// band, and the selection it came from ends (W4).
					if (work) (ondone ?? onclose)();
				}
			};
		}}
	>
		<div class="head">
			<div class="h-title">{title}</div>
			<button type="button" class="cancel" onclick={onclose}>CANCEL</button>
		</div>

		{#if !suggested}
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
								: 'A WORK · SERIES'}<span class="m">{answerMeta(a)}</span>
					</button>
				{/each}
			</div>
		{/if}

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
				>{work ? 'ADD TO A WORK' : 'ADD TO EXISTING'} · {intoList.length}</button
			>
		</div>

		{#if mode === 'new'}
			<div class="sl name-label">
				<span>NAME</span>
				<span
					>{work && name.trim() === ''
						? 'THE TITLES SHARE NO WORDS'
						: 'WORDS EVERY TITLE STARTS WITH'}</span
				>
			</div>
			<input
				class="name"
				name="name"
				bind:value={name}
				aria-label={work ? 'Work name' : 'Series name'}
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

		<div class="sl order-label">
			<span>ORDER</span><span
				>{work && orderMode === 'hand' ? 'BY HAND: AS SELECTED' : orderLabel}</span
			>
		</div>
		<div class="seg order">
			{#if work}
				<button type="button" class:on={orderMode === 'hand'} onclick={() => setOrder('hand')}
					>BY HAND</button
				>
				<button type="button" class:on={orderMode === 'date'} onclick={() => setOrder('date')}
					>BY DATE ADDED</button
				>
				<button type="button" class:on={orderMode === 'title'} onclick={() => setOrder('title')}
					>BY TITLE</button
				>
			{:else}
				<button type="button" class:on={orderMode === 'date'} onclick={() => setOrder('date')}
					>BY DATE</button
				>
				<button type="button" class:on={orderMode === 'title'} onclick={() => setOrder('title')}
					>BY TITLE</button
				>
				<button type="button" class:on={orderMode === 'hand'} onclick={() => setOrder('hand')}
					>BY HAND</button
				>
			{/if}
		</div>

		<ol class="rows" class:grows={work}>
			{#each rows as b, i (b.seriesId)}
				{@const on = ticked.includes(b.seriesId)}
				<li class="row" class:off={!on} class:gr={work}>
					{#if suggested}
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
					<span class="num">{numbers[b.seriesId]}</span>
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
					{:else}
						<span class="t">{b.title}</span>
						<span class="d">{addedMonth(b.addedAt)}</span>
					{/if}
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
				</li>
			{/each}
		</ol>

		{#if work}
			<!-- What a Work promises, and what it does not do: every part stays itself. -->
			<div class="keeps">
				EACH KEEPS ITS OWN <span class="ink">RATING, FAV, FOLLOW, LINK AND FOLDER</span>. NOTHING
				MERGES; UNGROUP PUTS {chosen.length === 1 ? 'ONE SERIES' : `${chosen.length} SERIES`} BACK.
			</div>
		{/if}

		{#each chosen as b (b.seriesId)}<input type="hidden" name="series" value={b.seriesId} />{/each}
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
			{#if mode === 'existing'}<input type="hidden" name="work" value={intoValue ?? ''} />{/if}
		{:else}
			<input type="hidden" name="order" value={orderLabel} />
			<input type="hidden" name="mode" value={mode} />
		{/if}

		{#if refused}
			<div class="refused" role="alert">{refused}</div>
		{/if}
		<div class="foot" class:sfoot={work}>
			<button
				type="submit"
				class="create"
				class:acc={work}
				disabled={!canCreate || busy}
				formaction={work && mode === 'existing' ? '?/addToWork' : undefined}
			>
				{#if !work}
					{mode === 'new'
						? `CREATE SERIES · ${chosen.length} ${noun}`
						: `ADD ${chosen.length} ${noun}`}
				{:else if mode === 'new'}
					CREATE WORK · {chosen.length} SERIES
				{:else}
					ADD {chosen.length} TO THE WORK
				{/if}
			</button>
			{#if suggested}
				<button type="submit" class="not" formaction="?/dismiss">NOT A SERIES</button>
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

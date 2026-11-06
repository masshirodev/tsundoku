<script lang="ts">
	import { beforeNavigate, goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { untrack } from 'svelte';
	import { bookCoverSrc, pageThumbSrc } from '$lib/library/links';
	import { RULES, carryOver, type Copy } from '$lib/library/dupes';
	import { langCode } from '$lib/library/editions';
	import { ratingText } from '$lib/library/rating';
	import type { Rating } from '$lib/library/types';

	/**
	 * Duplicate books (Pair Review; doc/DUPLICATE-BOOKS.md): one pair at a
	 * time. tsundoku's pick comes selected, with its reason; a tap on the other
	 * side selects that one instead. The copies sit side by side where there's
	 * room for both (landscape) and one above the other where there isn't: the
	 * sides wrap, as the mock's do, rather than switching at a breakpoint.
	 *
	 * A decision waits on the workstation until the next one, so UNDO only has
	 * to forget it; leaving the review carries the last one out.
	 */
	let { data } = $props();

	type Pair = (typeof data.pairs)[number];

	// The queue is this visit's: SKIP sends a pair to the back of it.
	// svelte-ignore state_referenced_locally
	const ordered = data.pairs.map((p) => p.key);
	// svelte-ignore state_referenced_locally
	const at = Math.max(0, ordered.indexOf(data.start ?? ''));
	let queue = $state<string[]>([...ordered.slice(at), ...ordered.slice(0, at)]);
	let done = $state(0);
	let busy = $state(false);
	let failed = $state<string | null>(null);
	type Undo = {
		title: string;
		detail: string;
		pair: string | null;
		before: { queue: string[]; done: number } | null;
		/** After a fold: OPEN → the folded book, once the fold is carried out. */
		open?: number;
	};
	let undo = $state<Undo | null>(null);
	/** The side the owner tapped, against or with the pick; null follows the pick. */
	let chosen = $state<'a' | 'b' | null>(null);

	// svelte-ignore state_referenced_locally
	const byKey = new Map(data.pairs.map((p) => [p.key, p]));
	// svelte-ignore state_referenced_locally
	const total = data.pairs.length;
	const pair = $derived<Pair | null>(queue.length ? (byKey.get(queue[0]) ?? null) : null);
	const fold = $derived(pair?.kind === 'fold');
	/** A fold where one side is folded already (Pair Review 3b), or a part of a bigger book (3c). */
	const third = $derived(fold && !!pair?.folded);
	const part = $derived(fold && !!pair?.part && !pair?.folded);
	/** A part: which is the story, which the collection, and where the one sits in the other. */
	const partWhere = $derived.by(() => {
		if (!pair || !part) return null;
		const [s, l] = pair.a.pages <= pair.b.pages ? (['a', 'b'] as const) : (['b', 'a'] as const);
		const inL = pair.rows.filter((r) => r.a !== null && r.b !== null).map((r) => r[l]!);
		return {
			short: s.toUpperCase(),
			long: l.toUpperCase(),
			from: Math.min(...inL),
			to: Math.max(...inL),
			matched: inL.length,
			pages: pair[s].pages
		};
	});
	const sel = $derived<'a' | 'b' | null>(fold || !pair ? null : (chosen ?? pair.pick!.keep));
	const against = $derived(!!pair && !fold && sel !== pair.pick!.keep);
	const other = (k: 'a' | 'b'): 'a' | 'b' => (k === 'a' ? 'b' : 'a');

	const matched = $derived(pair ? pair.rows.filter((r) => r.a !== null && r.b !== null).length : 0);
	const most = $derived(pair ? Math.max(pair.a.pages, pair.b.pages) : 0);
	const carry = $derived(pair && sel ? carryOver(pair[sel], pair[other(sel)]) : []);

	// ---- the fields, and which differ ------------------------------------------------------
	const day = (at: number) => new Date(at).toISOString().slice(0, 10);
	const FIELDS: [string, (c: Copy) => string][] = [
		['SITE', (c) => (c.site || '—').toUpperCase()],
		['LANGUAGE', (c) => (c.language || '—').toUpperCase()],
		['PAGES', (c) => String(c.pages)],
		['PAGE SIZE', (c) => (c.width ? `${c.width} × ${c.height}` : '—')],
		['ADDED', (c) => day(c.addedAt)],
		['RATING', (c) => ratingText(c.rating as Rating)],
		['FAV', (c) => (c.favourite ? 'FAV' : '—')],
		['READ', (c) => (c.read === 'read' ? 'READ' : c.read ? `P ${c.read} OF ${c.pages}` : 'UNREAD')],
		['SHELVES', (c) => (c.shelves.length ? c.shelves.join(', ').toUpperCase() : '—')],
		[
			'SERIES',
			(c) =>
				c.series
					? `${c.series.title.toUpperCase()} · ${String(c.series.position).padStart(2, '0')}`
					: '—'
		]
	];
	const rowsOf = (c: Copy, o: Copy) =>
		FIELDS.map(([label, show]) => ({ label, value: show(c), differ: show(c) !== show(o) }));

	const lang2 = (c: Copy) => (c.language ? langCode(c.language) : '??');
	function tagOf(k: 'a' | 'b'): string {
		if (!pair) return '';
		if (pair.folded?.side === k) return `FOLDED · ${pair.folded.codes.join(' · ')}`;
		if (fold) return `EDITION · ${lang2(pair[k])}`;
		if (sel !== k) return 'TO TRASH';
		return sel === pair.pick!.keep ? 'KEEP · PICK' : 'KEEP · YOURS';
	}
	const L = $derived(sel?.toUpperCase() ?? '');
	const reason = $derived(
		!pair
			? ''
			: third
				? `${pair.folded!.side.toUpperCase()} IS ONE BOOK IN ${pair.folded!.codes.length} LANGUAGES · ${pair.folded!.side === 'a' ? 'B' : 'A'} WOULD BE ITS ${pair.folded!.codes.length === 2 ? 'THIRD' : 'NEXT'} · NOTHING IS DELETED`
				: part && partWhere
					? `${partWhere.short} IS ONE STORY INSIDE ${partWhere.long}’S COLLECTION, AT ${partWhere.long} P ${partWhere.from}–${partWhere.to} · A PART DOESN’T FOLD`
					: fold
						? 'TWO EDITIONS OF ONE BOOK · NOTHING IS OFFERED FOR DELETION'
						: against
							? `YOUR PICK · ${L} · TSUNDOKU PICKED ${pair.pick!.keep.toUpperCase()}: ${pair.pick!.why}`
							: `PICK · ${L} · ${pair.pick!.why}`
	);
	const langs = $derived(
		pair
			? `${(pair.a.language || '?').toUpperCase()} AND ${(pair.b.language || '?').toUpperCase()}`
			: ''
	);

	// ---- deciding -----------------------------------------------------------------------------
	type Refusal = { pair: string; decision: string; reason: string };
	/**
	 * A decision the library's state could not carry, as the workstation
	 * answers it (c648): the pair is back in the review undecided, and the band
	 * says so. The words are the fold's -- "something sits beside it" -- and a
	 * KEEP or GROUP has its own, since neither refuses for that reason.
	 */
	const REFUSED: Record<string, string> = {
		fold: 'A BOOK CAN’T FOLD · SOMETHING SITS BESIDE IT',
		group: 'TWO BOOKS CAN’T JOIN · THE PAIR ISN’T WHAT IT WAS',
		keep: 'A BOOK CAN’T GO TO THE TRASH · THE PAIR ISN’T WHAT IT WAS'
	};
	let refused = $state<Refusal[]>([]);

	async function post(body: object): Promise<{ refused?: Refusal[] } | null> {
		try {
			const r = await fetch(resolve('/api/dupes'), {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify(body)
			});
			if (!r.ok) return null;
			return (await r.json().catch(() => ({}))) as { refused?: Refusal[] };
		} catch {
			return null;
		}
	}

	async function decide(
		decision: 'keep' | 'both' | 'group' | 'fold' | 'apart' | 'skip',
		title: string,
		detail: string,
		open?: number
	) {
		if (!pair || busy) return;
		const key = pair.key;
		const before = { queue: [...queue], done };
		busy = true;
		failed = null;
		refused = [];
		if (decision !== 'skip') {
			const answer = await post({
				pair: key,
				decision,
				keep: decision === 'keep' && sel ? pair[sel].entryId : null
			});
			busy = false;
			if (!answer) {
				failed = 'THE WORKSTATION DID NOT ANSWER · NOTHING CHANGED';
				return;
			}
			// A decision waiting from before is carried out first, and it may be
			// one this state refuses: the band says so before this pair's own.
			refused = answer.refused ?? [];
			queue = queue.slice(1);
			done += 1;
			undo = { title, detail, pair: key, before, open };
		} else {
			busy = false;
			queue = [...queue.slice(1), key];
			undo = { title, detail, pair: null, before: null };
		}
		chosen = null;
	}

	async function undoLast() {
		const u = undo;
		if (!u?.pair || !u.before || busy) return;
		busy = true;
		const ok = await post({ undo: u.pair });
		busy = false;
		if (!ok) {
			failed = 'THE WORKSTATION DID NOT ANSWER · NOTHING CHANGED';
			return;
		}
		queue = u.before.queue;
		done = u.before.done;
		undo = null;
		chosen = null;
	}

	// Leaving carries out the decision still waiting.
	beforeNavigate(() => {
		if (untrack(() => undo?.pair))
			void fetch(resolve('/api/dupes'), {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ apply: true }),
				keepalive: true
			}).catch(() => undefined);
	});

	type Act = { label: string; run: () => void; strong?: boolean };
	const actions = $derived.by((): Act[] => {
		if (!pair) return [];
		const a = pair.a;
		const apart: Act[] = [
			{
				label: 'KEEP APART',
				run: () => decide('apart', 'KEPT APART · WON’T ASK AGAIN', 'TWO BOOKS, AS BEFORE')
			},
			{ label: 'SKIP', run: () => decide('skip', 'SKIPPED', 'COMES UP AGAIN LATER') }
		];
		if (part) return apart;
		if (third) {
			const f = pair.folded!;
			const book = pair[f.side];
			const add = pair[f.side === 'a' ? 'b' : 'a'];
			const codes = [...f.codes, lang2(add)];
			return [
				...apart,
				{
					label: `ADD AS A ${codes.length === 3 ? 'THIRD' : 'NEW'} LANGUAGE`,
					run: () =>
						decide(
							'fold',
							`ADDED · ${book.title.toUpperCase()} IN ${codes.length} LANGUAGES`,
							codes.join(' · '),
							book.seriesId
						),
					strong: true
				}
			];
		}
		if (fold)
			return [
				{
					label: 'KEEP APART',
					run: () => decide('apart', 'KEPT APART · WON’T ASK AGAIN', 'TWO BOOKS, AS BEFORE')
				},
				{ label: 'SKIP', run: () => decide('skip', 'SKIPPED', 'COMES UP AGAIN LATER') },
				{
					label: 'FOLD INTO ONE BOOK',
					run: () =>
						decide(
							'fold',
							'FOLDED · ONE BOOK IN 2 LANGUAGES',
							`${lang2(pair.a)} · ${lang2(pair.b)} · NOTHING DELETED`,
							pair.a.seriesId
						),
					strong: true
				}
			];
		const O = sel ? other(sel).toUpperCase() : '';
		const out: Act[] = [
			{
				label: 'KEEP BOTH',
				run: () => decide('both', 'KEPT BOTH · WON’T ASK AGAIN', 'BOTH STAY AS THEY ARE')
			}
		];
		// Two books each already in a series of books can't become one series.
		if (!(pair.a.series && pair.b.series))
			out.push({
				label: 'GROUP AS A SERIES',
				run: () =>
					decide('group', 'GROUPED AS A SERIES · 2 BOOKS', `${a.title.toUpperCase()} FIRST`)
			});
		out.push(
			{ label: 'SKIP', run: () => decide('skip', 'SKIPPED', 'COMES UP AGAIN LATER') },
			{
				label: `KEEP ${L}`,
				run: () =>
					decide(
						'keep',
						`KEPT ${L} · ${O} TO THE TRASH`,
						carry.length ? `${carry.join(', ')} MOVED TO ${L}` : 'NOTHING TO CARRY OVER'
					),
				strong: true
			}
		);
		return out;
	});
	// The next pair's covers and first pages, fetched while this one is decided.
	$effect(() => {
		const next = queue[1] ? byKey.get(queue[1]) : null;
		if (!next) return;
		for (const k of ['a', 'b'] as const) {
			new Image().src = bookCoverSrc(next.art[k].id, next.art[k].coverPage);
			for (const r of next.rows.slice(0, 12)) {
				const p = r[k];
				if (p !== null) new Image().src = pageThumbSrc(next.art[k], p - 1);
			}
		}
	});

	const actionCols = $derived(
		part
			? '1fr 1fr'
			: fold
				? '1fr 1fr 2fr'
				: actions.length === 4
					? '1fr 1fr 1fr 1.4fr'
					: '1fr 1fr 1.4fr'
	);

	/** OPEN → after a fold: carried out first, so the book screen shows it folded. */
	async function openFolded(seriesId: number) {
		busy = true;
		const answer = await post({ apply: true });
		busy = false;
		// A fold this state refuses is not carried out, so there is no folded
		// book to open: the band says which and why, and the pair comes back to
		// the review (c648) instead of a screen that would look unchanged.
		refused = answer?.refused ?? [];
		if (!answer || refused.length) {
			if (!answer) failed = 'THE WORKSTATION DID NOT ANSWER · NOTHING CHANGED';
			return;
		}
		undo = null;
		await goto(resolve('/series/[id]', { id: String(seriesId) }));
	}
	const counter = $derived(
		pair ? `${String(done + 1).padStart(2, '0')} OF ${String(total).padStart(2, '0')}` : '00'
	);
</script>

<svelte:head><title>Duplicates · tsundoku</title></svelte:head>

<div class="review">
	<header class="head">
		<a class="back" href={resolve('/')}>← LIBRARY</a>
		<div class="heading">
			<span class="long">POSSIBLE DUPLICATES</span><span class="short">DUPLICATES</span>
		</div>
		<div class="counter">{counter}</div>
	</header>

	{#if failed}
		<div class="band" role="alert"><div class="bt"><div>{failed}</div></div></div>
	{:else if undo}
		<div class="band" role="status">
			<div class="bt">
				<div class="line">{undo.title}</div>
				<div class="line dim">{undo.detail}</div>
			</div>
			{#if undo.pair}<button type="button" class="undo" onclick={undoLast}>UNDO</button>{/if}
			{#if undo.open}
				{@const open = undo.open}
				<button type="button" class="undo open" onclick={() => openFolded(open)}>OPEN →</button>
			{/if}
		</div>
	{/if}
	{#each refused as r (r.pair)}
		<div class="band refused" role="alert">
			<div class="bt">
				<div class="line">{REFUSED[r.decision] ?? 'THE WORKSTATION COULDN’T CARRY THAT OUT'}</div>
				<div class="line dim">{r.reason.toUpperCase()} · IT COMES BACK TO THE REVIEW</div>
			</div>
		</div>
	{/each}

	{#if !pair}
		<section class="empty">
			<div class="label">00 — NO DUPLICATES</div>
			<p>Every pair has been settled. New books are compared as they arrive.</p>
			<div class="note">THE LIBRARY BAND IS GONE UNTIL THERE'S ANOTHER PAIR.</div>
			<a class="home" href={resolve('/')}>BACK TO LIBRARY</a>
		</section>
	{:else}
		<!-- A new pair is drawn afresh: reused images would show the last pair's pages under this one's text. -->
		{#key pair.key}
			<div class="scroll">
				<div class="summary">
					<div class="s1">
						<span class="conf {pair.conf}" class:third class:outline={part}
							>{third
								? `SAME BOOK · A ${pair.folded!.codes.length === 2 ? 'THIRD' : 'NEW'} LANGUAGE`
								: part
									? 'PART OF A BIGGER BOOK'
									: pair.conf === 'likely'
										? 'LIKELY SAME'
										: pair.conf === 'maybe'
											? 'MAYBE'
											: `SAME BOOK · ${langs}`}</span
						>
						<span
							>{part && partWhere
								? `${partWhere.short}’S PAGES FOUND INSIDE ${partWhere.long} · ${partWhere.matched} OF ${partWhere.pages} MATCH`
								: `COVER ALIKE · ${matched} OF ${most} PAGES MATCH`}</span
						>
					</div>
					<div class="s2">
						<span class:against>{reason}</span>
						<span
							>{part
								? 'KEEP APART OR SKIP'
								: third
									? 'ADD, KEEP APART, OR SKIP'
									: fold
										? 'FOLD, KEEP APART, OR SKIP'
										: `RULE ${pair.pick!.rule} OF ${RULES.length} · ${pair.pick!.ruleName}`}</span
						>
					</div>
				</div>

				<div class="sides">
					{#each ['a', 'b'] as const as k (k)}
						{@const c = pair[k]}
						{@const kept = sel === k}
						<!-- A radio between the two copies; a fold's editions aren't chosen between. -->
						<!-- svelte-ignore a11y_no_noninteractive_tabindex -->
						<div
							class="side"
							class:kept
							class:fold
							role={fold ? undefined : 'radio'}
							aria-checked={fold ? undefined : kept}
							tabindex={fold ? undefined : 0}
							onclick={() => !fold && (chosen = k)}
							onkeydown={(e) => {
								if (!fold && (e.key === 'Enter' || e.key === ' ')) {
									e.preventDefault();
									chosen = k;
								}
							}}
						>
							<div class="sh">
								<div class="letter">{k.toUpperCase()}</div>
								<div class="source">
									{(c.site || '—').toUpperCase()} · {(c.language || '—').toUpperCase()}{c.hidden
										? ' · HIDDEN ROOT'
										: ''}
								</div>
								<div class="tag" class:on={kept}>{tagOf(k)}</div>
							</div>
							<div class="body">
								<div class="cover" class:ring={kept}>
									<img
										src={bookCoverSrc(pair.art[k].id, pair.art[k].coverPage)}
										alt=""
										loading="lazy"
									/>
									{#if c.favourite}<span class="fav">FAV</span>{/if}
									{#if c.hidden}<span class="hid">HIDDEN</span>{/if}
								</div>
								<div class="info">
									<div class="title" class:quiet={!fold && !kept}>{c.title}</div>
									<div class="rows">
										{#each rowsOf(c, pair[other(k)]) as row (row.label)}
											<div class="row" class:differ={row.differ}>
												<span class="rl"
													>{#if row.differ}<i></i>{/if}{row.label}</span
												>
												<span class="rv">{row.value}</span>
											</div>
										{/each}
									</div>
									{#if kept && carry.length}
										<div class="carry">
											TAKES OVER FROM {other(k).toUpperCase()} · {carry.join(' · ')}
										</div>
									{/if}
								</div>
							</div>
						</div>
					{/each}
				</div>

				<div class="plabel">
					<div>02 — PAGES</div>
					<div>{matched} MATCH · {pair.rows.length - matched} ALONE</div>
				</div>
				<div class="pages">
					{#each pair.rows as r, n (n)}
						{@const alone = r.a === null || r.b === null}
						<div class="pp" class:alone>
							<div class="two">
								{#each [['a', r.a], ['b', r.b]] as const as [k, p] (k)}
									<div class="thumb" class:none={p === null}>
										{#if p !== null}
											<img src={pageThumbSrc(pair.art[k], p - 1)} alt="" loading="lazy" />
										{/if}
										<span class="pl" class:dim={p === null}
											>{p === null ? 'NONE' : `${k.toUpperCase()} ${p}`}</span
										>
									</div>
								{/each}
							</div>
							<div class="note" class:acc={alone}>
								{alone
									? r.a === null
										? 'ONLY IN B'
										: 'ONLY IN A'
									: r.a === r.b
										? `SAME · P ${r.a}`
										: `P ${r.a} = P ${r.b}`}
							</div>
						</div>
					{/each}
				</div>
			</div>
		{/key}

		<div class="actions" style:grid-template-columns={actionCols}>
			{#each actions as act, i (act.label)}
				<button
					type="button"
					class:strong={act.strong}
					class:first={i === 0}
					disabled={busy}
					onclick={act.run}>{act.label}</button
				>
			{/each}
		</div>
	{/if}
</div>

<style>
	/*
	 * Pair Review, transcribed: the mock's spacing is hand-set, not a ladder
	 * (reconcile-tokens: no length tokens in the theme), so the literals are
	 * the decisions. Colours are tokens.
	 */
	.review {
		--pad: 24px;
		--head-h: 72px;
		--cover-w: 132px;
		--pair-min: 200px;
		--act-font: 14px;
		/*
		 * The page scrolls as any screen does, under whatever the layout puts
		 * above it (the reveal banner, the incognito band): a fixed 100dvh
		 * pushed the actions off the bottom once one was there. The actions
		 * stay in reach by sticking to the bottom instead.
		 */
		flex: 1;
		min-height: 100dvh;
		display: flex;
		flex-direction: column;
		background: var(--surface-page);
		color: var(--text-1);
		font-family: var(--font-sans);
	}
	@media (max-width: 599px) {
		.review {
			--pad: 16px;
			--head-h: 60px;
			--cover-w: 104px;
			--pair-min: 150px;
			--act-font: 12px;
		}
	}
	.head {
		flex-shrink: 0;
		display: flex;
		align-items: stretch;
		height: var(--head-h);
		border-bottom: 1px solid var(--line-1);
	}
	.back {
		display: flex;
		align-items: center;
		padding: 0 var(--pad);
		border-right: 1px solid var(--line-1);
		color: var(--text-1);
		font: 500 14px/1.2 var(--font-mono);
		text-decoration: none;
	}
	.heading {
		flex: 1;
		display: flex;
		align-items: center;
		padding: 0 var(--pad);
		min-width: 0;
		font: 500 13px/1.2 var(--font-mono);
		letter-spacing: 0.06em;
		color: var(--text-2);
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}
	.heading .short {
		display: none;
	}
	@media (max-width: 599px) {
		.heading .long {
			display: none;
		}
		.heading .short {
			display: inline;
		}
	}
	.counter {
		display: flex;
		align-items: center;
		padding: 0 var(--pad);
		border-left: 1px solid var(--line-1);
		font: 500 14px/1.2 var(--font-mono);
		white-space: nowrap;
	}
	.band {
		flex-shrink: 0;
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
	.bt {
		display: flex;
		flex-direction: column;
		gap: 3px;
		min-width: 0;
	}
	.line {
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}
	.line.dim {
		font: 400 13px/1.3 var(--font-mono);
		color: var(--text-2);
	}
	.undo {
		align-self: stretch;
		display: flex;
		align-items: center;
		padding: 0 var(--pad);
		border: 0;
		border-left: 1px solid var(--line-1);
		border-radius: 0;
		background: transparent;
		color: var(--text-1);
		font: 500 14px/1.2 var(--font-mono);
		cursor: pointer;
	}
	.undo.open {
		background: var(--accent);
		color: var(--on-accent);
		white-space: nowrap;
	}
	.undo:active,
	.home:active {
		background: var(--surface-inverse);
		color: var(--text-inverse);
	}
	.empty {
		flex: 1;
		display: flex;
		flex-direction: column;
		align-items: flex-start;
		gap: 18px;
		padding: 64px var(--pad);
	}
	.empty .label {
		font: 500 13px/1.2 var(--font-mono);
		letter-spacing: 0.06em;
		color: var(--text-2);
	}
	.empty p {
		margin: 0;
		max-width: 460px;
		font: 500 22px/1.25 var(--font-sans);
		text-wrap: pretty;
	}
	.empty .note {
		font: 400 13px/1.3 var(--font-mono);
		color: var(--text-2);
	}
	.home {
		display: flex;
		align-items: center;
		height: 56px;
		padding: 0 28px;
		border: 1px solid var(--line-2);
		color: var(--text-1);
		font: 500 16px var(--font-mono);
		text-decoration: none;
	}
	.scroll {
		flex: 1;
	}
	.summary {
		display: flex;
		flex-direction: column;
		gap: 10px;
		padding: 16px var(--pad);
		border-bottom: 1px solid var(--line-1);
		background: var(--surface-panel);
	}
	.s1 {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 10px;
		font: 500 14px/1.2 var(--font-mono);
	}
	.conf {
		padding: 2px 5px;
		font: 500 12px/1 var(--font-mono);
	}
	.conf.likely {
		background: var(--accent);
		color: var(--on-accent);
	}
	.conf.maybe {
		box-shadow: inset 0 0 0 1px var(--line-2);
	}
	.conf.lang {
		background: var(--surface-inverse);
		color: var(--text-inverse);
	}
	/* A part of a bigger book: nothing to fold, so the tag isn't filled. */
	.conf.lang.outline {
		background: transparent;
		color: var(--text-1);
		box-shadow: inset 0 0 0 1px var(--line-2);
	}
	.s2 {
		display: flex;
		flex-wrap: wrap;
		justify-content: space-between;
		gap: 6px 18px;
		font: 400 13px/1.3 var(--font-mono);
		color: var(--text-2);
	}
	.s2 span:first-child {
		color: var(--text-1);
	}
	.s2 span.against {
		color: var(--accent);
	}
	.sides {
		display: flex;
		flex-wrap: wrap;
	}
	.side {
		flex: 1 1 560px;
		min-width: 0;
		display: flex;
		flex-direction: column;
		border-bottom: 1px solid var(--line-1);
		border-right: 1px solid var(--line-1);
		cursor: pointer;
	}
	.side.fold {
		cursor: default;
	}
	.side.kept {
		background: var(--accent-select);
	}
	.sh {
		display: flex;
		align-items: stretch;
		height: 48px;
		border-bottom: 1px solid var(--line-subtle);
	}
	.letter {
		width: 48px;
		display: flex;
		align-items: center;
		justify-content: center;
		border-right: 1px solid var(--line-subtle);
		font: 500 16px var(--font-mono);
	}
	.source {
		flex: 1;
		display: flex;
		align-items: center;
		padding: 0 14px;
		min-width: 0;
		font: 400 13px/1.3 var(--font-mono);
		color: var(--text-2);
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}
	.tag {
		display: flex;
		align-items: center;
		padding: 0 14px;
		font: 500 13px/1.2 var(--font-mono);
		letter-spacing: 0.06em;
		color: var(--text-2);
		white-space: nowrap;
	}
	.tag.on {
		background: var(--accent);
		color: var(--on-accent);
	}
	.side.fold .tag {
		color: var(--text-2);
		background: transparent;
	}
	.body {
		display: flex;
		flex-wrap: wrap;
		gap: 18px;
		padding: 18px var(--pad);
	}
	.cover {
		position: relative;
		width: var(--cover-w);
		aspect-ratio: 2 / 2.9;
		flex-shrink: 0;
		background: var(--surface-panel);
	}
	.cover.ring {
		box-shadow: 0 0 0 3px var(--accent);
	}
	.cover img,
	.thumb img {
		position: absolute;
		inset: 0;
		width: 100%;
		height: 100%;
		object-fit: cover;
	}
	.fav,
	.hid {
		position: absolute;
		top: 0;
		padding: 2px 5px;
		font: 500 12px/1 var(--font-mono);
	}
	.fav {
		right: 0;
		background: var(--accent);
		color: var(--on-accent);
	}
	.hid {
		left: 0;
		background: var(--reveal);
		color: var(--on-reveal);
	}
	.info {
		flex: 1 1 240px;
		min-width: 0;
		display: flex;
		flex-direction: column;
		gap: 12px;
	}
	.title {
		font: 500 20px/1.25 var(--font-sans);
		text-wrap: pretty;
	}
	.title.quiet {
		color: var(--text-2);
	}
	.rows {
		display: flex;
		flex-direction: column;
		border-top: 1px solid var(--line-1);
	}
	/* Like a diff, not for developers: what matches is quiet, what differs is marked. */
	.row {
		display: grid;
		grid-template-columns: 104px minmax(0, 1fr);
		align-items: center;
		min-height: 34px;
		border-bottom: 1px solid var(--line-subtle);
		font: 400 13px/1.3 var(--font-mono);
		color: var(--text-2);
	}
	.rl {
		display: flex;
		align-items: center;
		gap: 8px;
		padding-left: 14px;
		letter-spacing: 0.06em;
	}
	.row.differ .rl {
		padding-left: 0;
		color: var(--accent);
		font-weight: 500;
	}
	.rl i {
		width: 6px;
		height: 6px;
		background: var(--accent);
	}
	.row.differ .rv {
		color: var(--text-1);
		font-weight: 500;
	}
	.carry {
		font: 500 12px/1.4 var(--font-mono);
		color: var(--accent);
	}
	.plabel {
		display: flex;
		justify-content: space-between;
		gap: 12px;
		padding: 24px var(--pad) 12px;
		font: 500 13px/1.2 var(--font-mono);
		letter-spacing: 0.06em;
		color: var(--text-2);
	}
	.pages {
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(var(--pair-min), 1fr));
		gap: 1px;
		margin: 0 var(--pad) 24px;
		background: var(--line-1);
		border: 1px solid var(--line-1);
	}
	.pp {
		display: flex;
		flex-direction: column;
		gap: 8px;
		padding: 10px;
		background: var(--surface-page);
	}
	.pp.alone {
		background: var(--surface-panel);
	}
	.two {
		display: grid;
		grid-template-columns: 1fr 1fr;
		gap: 6px;
	}
	.thumb {
		position: relative;
		aspect-ratio: 2 / 2.9;
		display: flex;
		align-items: flex-end;
		padding: 4px;
		background: var(--surface-panel);
	}
	.thumb.none {
		background: transparent;
		border: 1px dashed var(--line-2);
	}
	.pl {
		position: relative;
		padding: 2px 5px;
		background: var(--surface-page);
		font: 500 11px/1 var(--font-mono);
	}
	.pl.dim {
		color: var(--text-2);
	}
	.pp .note {
		font: 500 12px/1.2 var(--font-mono);
		color: var(--text-2);
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}
	.pp .note.acc {
		color: var(--accent);
	}
	.actions {
		position: sticky;
		bottom: 0;
		z-index: 5;
		flex-shrink: 0;
		display: grid;
		border-top: 1px solid var(--line-1);
		background: var(--surface-page);
	}
	.actions button {
		min-height: 64px;
		padding: 8px 10px;
		border: 0;
		border-left: 1px solid var(--line-1);
		border-radius: 0;
		background: transparent;
		color: var(--text-1);
		font: 500 var(--act-font) var(--font-mono);
		letter-spacing: 0.06em;
		line-height: 1.25;
		cursor: pointer;
	}
	.actions button.first {
		border-left: 0;
	}
	.actions button.strong {
		background: var(--surface-inverse);
		color: var(--text-inverse);
	}
	.actions button:disabled {
		opacity: 0.6;
		cursor: default;
	}
	.actions button:not(.strong):active {
		background: var(--surface-inverse);
		color: var(--text-inverse);
	}
</style>

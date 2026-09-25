<script lang="ts">
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { coverSrc } from '$lib/library/links';
	import { coverPlaceholder, hueFor } from '$lib/library/cover';
	import { anilistUrl, parsePasted } from '$lib/library/catalogue';
	import { offline } from '$lib/offline.svelte';
	import type { QueuedFrom, ReviewCandidate } from '$lib/server/catalogue';

	/**
	 * The link review (Link Review; doc/LINKS.md): one series at a time, the
	 * candidates AniList found for it, none of them for certain. Nothing is
	 * preselected: a match under another title is the owner's to judge, so a
	 * tap chooses one and LINK makes it. Each decision is carried out at once;
	 * UNDO takes the last one back.
	 *
	 * `?series=` is one series only (FIND or CHANGE on its screen): deciding
	 * goes back to it.
	 */
	let { data } = $props();

	type Item = (typeof data.items)[number];

	// svelte-ignore state_referenced_locally
	const byId = new Map(data.items.map((i) => [i.seriesId, i]));
	// svelte-ignore state_referenced_locally
	const total = data.items.length;
	// svelte-ignore state_referenced_locally
	const single = data.single;
	// The queue is this visit's: SKIP sends a series to the back of it.
	// svelte-ignore state_referenced_locally
	let queue = $state<number[]>(data.items.map((i) => i.seriesId));
	let done = $state(0);
	let busy = $state(false);
	let failed = $state<string | null>(null);
	/** The workstation answered that AniList couldn't be reached (Link Review 1g). */
	let nonet = $state(false);

	type Undo = {
		title: string;
		detail: string;
		/** What the workstation is asked to take back; null: nothing to take back (SKIP). */
		undo: { kind: 'link' | 'none' | 'search'; series: number; was?: QueuedFrom } | null;
		before: { queue: number[]; done: number };
	};
	let undo = $state<Undo | null>(null);

	const item = $derived<Item | null>(queue.length ? (byId.get(queue[0]) ?? null) : null);
	let chosen = $state<number | null>(null);
	let searching = $state(false);
	let pasting = $state(false);
	let query = $state('');
	let pasteText = $state('');
	let pasted = $state<ReviewCandidate | null>(null);
	let pasteNote = $state<string | null>(null);

	// A new series starts clean: nothing chosen, the panels shut.
	let shown = $state<number | null>(null);
	$effect.pre(() => {
		const id = item?.seriesId ?? null;
		if (id === shown) return;
		shown = id;
		chosen = null;
		pasted = null;
		pasteText = '';
		pasteNote = null;
		searching = false;
		pasting = data.paste && id !== null;
		query = item ? editedTitle(item) : '';
	});

	/** SEARCH AGAIN's field starts from the title, with a "..." Mihon cut it to taken off. */
	function editedTitle(i: Item): string {
		return i.cutShort ? i.title.replace(/\s*(\.\.\.|…)$/, '') : i.query;
	}

	const off = $derived(!offline.online);
	/** Hidden series are never searched (Series Link 1s): only a pasted link. */
	const noSearch = $derived(!!single?.hidden);
	const cands = $derived<ReviewCandidate[]>(pasted ? [pasted] : (item?.candidates ?? []));
	const letter = (i: number) =>
		String.fromCharCode(65 + (pasted ? (item?.candidates.length ?? 0) : i));
	const selected = $derived(cands.find((c) => c.anilistId === chosen) ?? null);
	const selectedLetter = $derived(
		selected ? letter(cands.findIndex((c) => c.anilistId === chosen)) : ''
	);

	// ---- the workstation -------------------------------------------------------------------
	async function post(body: object): Promise<Response | null> {
		try {
			return await fetch(resolve('/api/links'), {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify(body)
			});
		} catch {
			return null;
		}
	}
	const NO_ANSWER = 'THE WORKSTATION DID NOT ANSWER · NOTHING CHANGED';

	/** One decision: sent, then the next series (or back to its screen, for one series). */
	async function decide(
		body: object,
		title: string,
		detail: string,
		kind: 'link' | 'none' | 'search' | 'skip'
	): Promise<void> {
		if (!item || busy) return;
		const id = item.seriesId;
		const before = { queue: [...queue], done };
		busy = true;
		failed = null;
		const r = await post({ series: id, ...body });
		busy = false;
		if (!r || !r.ok) {
			if (r?.status === 503) nonet = true;
			failed = r?.status === 503 ? 'ANILIST DID NOT ANSWER · NOTHING CHANGED' : NO_ANSWER;
			return;
		}
		const answer = (await r.json().catch(() => ({}))) as { was?: QueuedFrom };
		if (single) {
			await goto(resolve('/series/[id]', { id: String(id) }), { invalidateAll: true });
			return;
		}
		if (kind === 'skip') {
			queue = [...queue.slice(1), id];
			undo = { title, detail, undo: null, before };
			return;
		}
		queue = queue.slice(1);
		done += 1;
		undo = {
			title,
			detail,
			undo: { kind, series: id, was: kind === 'search' ? (answer.was ?? null) : undefined },
			before
		};
	}

	async function undoLast() {
		const u = undo;
		if (!u?.undo || busy) return;
		busy = true;
		const r = await post({ series: u.undo.series, undo: u.undo.kind, was: u.undo.was });
		busy = false;
		if (!r?.ok) {
			failed = NO_ANSWER;
			return;
		}
		queue = u.before.queue;
		done = u.before.done;
		undo = null;
		shown = null;
	}

	function linkChosen() {
		if (!item || !selected) return;
		const c = selected;
		decide(
			{ link: c.anilistId, pasted: !!pasted },
			`LINKED · ${c.title.toUpperCase()}`,
			`${c.ids} · ${item.hasCover ? 'COVER STAYS AS IT IS' : 'ITS COVER COMES FROM THE LINK'}`,
			'link'
		);
	}
	function searchAgain() {
		if (!item || !query.trim()) return;
		decide(
			{ search: query.trim() },
			`QUEUED · “${query.trim()}”`,
			'SEARCHED IN THE NEXT COVER PASS · BACK IN THE QUEUE WITH WHAT IT FINDS',
			'search'
		);
	}

	// ---- a pasted link, read as one candidate (Link Review 1d) ------------------------------
	let reading = 0;
	async function readPaste(text: string) {
		pasteText = text;
		const p = parsePasted(text);
		if (!p || !item) {
			pasted = null;
			pasteNote = text.trim() ? 'NOT AN ANILIST OR MAL MANGA LINK' : null;
			return;
		}
		const mine = ++reading;
		pasteNote = 'READING…';
		const r = await post({ series: item.seriesId, paste: text });
		if (mine !== reading) return;
		if (!r) {
			pasteNote = NO_ANSWER;
			return;
		}
		if (r.status === 503) {
			nonet = true;
			pasteNote = 'ANILIST DID NOT ANSWER · TRY AGAIN WHEN IT’S BACK';
			return;
		}
		if (!r.ok) {
			pasted = null;
			pasteNote =
				p.service === 'mal' ? 'ANILIST HAS NO ENTRY FOR THAT MAL ID' : 'NO SUCH ANILIST ENTRY';
			return;
		}
		const { candidate } = (await r.json()) as { candidate: ReviewCandidate };
		pasted = candidate;
		chosen = candidate.anilistId;
		nonet = false;
		pasteNote = `READ AS ANILIST ${candidate.anilistId} · ONLY THE ID WAS SENT, NEVER THE TITLE`;
	}
	function cancelPaste() {
		pasting = false;
		pasted = null;
		pasteText = '';
		pasteNote = null;
		chosen = null;
	}

	// ---- actions -----------------------------------------------------------------------------
	type Act = { label: string; run: () => void; strong?: boolean; dim?: boolean };
	const netDim = $derived(off || nonet);
	const tools = $derived.by((): Act[] => {
		if (!item || pasted || !item.candidates.length) return [];
		return [
			{
				label: 'SEARCH AGAIN',
				run: () => ((searching = !searching), (pasting = false)),
				dim: netDim || noSearch
			},
			{ label: 'PASTE A LINK', run: () => ((pasting = !pasting), (searching = false)), dim: netDim }
		];
	});
	const actions = $derived.by((): Act[] => {
		if (!item) return [];
		const link: Act = selected
			? { label: `LINK ${selectedLetter}`, run: linkChosen, strong: true, dim: off }
			: { label: 'TAP ONE TO LINK', run: () => {}, dim: true };
		if (pasted) return [{ label: 'CANCEL', run: cancelPaste, dim: off }, link];
		// SKIP too with nothing found: the owner's addition to 1c, so a series
		// with no answer yet doesn't block the queue.
		if (!item.candidates.length)
			return [
				{
					label: 'SEARCH AGAIN',
					run: searching ? searchAgain : () => ((searching = true), (pasting = false)),
					strong: searching,
					dim: netDim || noSearch
				},
				{
					label: 'PASTE A LINK',
					run: () => ((pasting = !pasting), (searching = false)),
					dim: netDim
				},
				...(single
					? []
					: [
							{
								label: 'SKIP',
								run: () => decide({ skip: true }, 'SKIPPED', 'COMES UP AGAIN LATER', 'skip'),
								dim: off
							}
						])
			];
		return [
			{
				label: 'NONE OF THESE',
				run: () =>
					decide(
						{ none: true },
						'NONE OF THESE · WON’T ASK AGAIN',
						'FIND AND PASTE A LINK STILL WORK ON ITS SERIES SCREEN',
						'none'
					),
				dim: off
			},
			...(single
				? []
				: [
						{
							label: 'SKIP',
							run: () => decide({ skip: true }, 'SKIPPED', 'COMES UP AGAIN LATER', 'skip'),
							dim: off
						}
					]),
			link
		];
	});
	const actionCols = $derived(
		pasted || !item?.candidates.length
			? pasted
				? '1fr 1.4fr'
				: actions.map(() => '1fr').join(' ')
			: actions.length === 3
				? '1fr 1fr 1.4fr'
				: '1fr 1.4fr'
	);

	const counter = $derived(
		item ? `${String(done + 1).padStart(2, '0')} OF ${String(total).padStart(2, '0')}` : '00'
	);
	const back = $derived(
		single && item
			? { href: resolve('/series/[id]', { id: String(item.seriesId) }), label: '← SERIES' }
			: { href: resolve('/'), label: '← LIBRARY' }
	);
	const searched = $derived(
		!item
			? ''
			: noSearch
				? 'HIDDEN SERIES ARE NEVER SEARCHED · ONLY A PASTED LINK, WHICH SENDS NOTHING BUT ITS ID'
				: single?.queued
					? `A SEARCH FOR “${item.query}” WAITS FOR THE NEXT COVER PASS`
					: !item.searched
						? 'NOT SEARCHED YET · SEARCH AGAIN QUEUES ONE FOR THE NEXT COVER PASS'
						: `SEARCHED ANILIST FOR “${item.query}” IN THE COVER PASS · ${item.found} FOUND${item.found ? ' · NO TITLE EQUAL, SO NOTHING WAS LINKED' : ''}`
	);
	const hint = $derived(
		item?.cutShort
			? 'THE TITLE ENDS IN “...”, SO MIHON PROBABLY CUT IT SHORT. SEARCH AGAIN WITH THE END TRIMMED OR COMPLETED, OR PASTE THE ENTRY’S LINK.'
			: 'SEARCH AGAIN UNDER ANOTHER TITLE, OR PASTE THE ENTRY’S LINK.'
	);

	// The next series' candidate covers, fetched while this one is decided.
	$effect(() => {
		const next = queue[1] ? byId.get(queue[1]) : null;
		for (const c of next?.candidates ?? []) if (c.coverUrl) new Image().src = c.coverUrl;
	});
</script>

<svelte:head><title>Links · tsundoku</title></svelte:head>

<div class="review">
	<header class="head">
		<a class="back" href={back.href}>{back.label}</a>
		<div class="heading">
			<span class="long">SERIES TO LINK</span><span class="short">TO LINK</span>
		</div>
		<div class="counter">{counter}</div>
	</header>

	{#if off}
		<div class="band two" role="status">
			<div class="bt">
				<div class="line">○ OFFLINE · LINKING NEEDS THE WORKSTATION</div>
				<div class="line dim">
					AS FOUND IN THE LAST COVER PASS · NOTHING CAN BE DECIDED UNTIL IT ANSWERS
				</div>
			</div>
		</div>
	{:else if nonet}
		<div class="band two" role="status">
			<div class="bt">
				<div class="line">○ ANILIST UNREACHABLE · LINK STILL WORKS</div>
				<div class="line dim">
					THE WORKSTATION HAS NO INTERNET · SEARCH AGAIN AND PASTE A LINK WAIT FOR IT
				</div>
			</div>
		</div>
	{/if}

	{#if failed}
		<div class="band" role="alert"><div class="bt"><div class="line">{failed}</div></div></div>
	{:else if undo}
		<div class="band" role="status">
			<div class="bt">
				<div class="line">{undo.title}</div>
				<div class="line dim">{undo.detail}</div>
			</div>
			{#if undo.undo}<button type="button" class="undo" onclick={undoLast}>UNDO</button>{/if}
		</div>
	{/if}

	{#if !item}
		<section class="empty">
			<div class="label">00 — NOTHING TO LINK</div>
			<p>
				Every series found on AniList has been settled. New ones are searched in the cover pass.
			</p>
			<div class="note">THE LIBRARY BAND IS GONE UNTIL THERE'S ANOTHER.</div>
			<a class="home" href={resolve('/')}>BACK TO LIBRARY</a>
		</section>
	{:else}
		{#key item.seriesId}
			<div class="body">
				<section class="series" aria-label="This series">
					<div class="sl">THIS SERIES</div>
					<div class="who">
						<div
							class="cover"
							class:none={!item.hasCover}
							style:background={item.hasCover ? coverPlaceholder(item.hue) : undefined}
						>
							{#if item.hasCover}
								<img src={coverSrc(item.seriesId, item.coverAt)} alt="" />
							{:else}
								<span class="nc">NO COVER</span>
							{/if}
						</div>
						<div class="id">
							<div class="meta">{item.kind.toUpperCase()} · {item.sourceKind}</div>
							<div class="title">{item.title}</div>
							{#each item.alts as al (al)}<div class="alt">{al}</div>{/each}
						</div>
					</div>
					<div class="rows">
						<div class="r">
							<span class="rl">SOURCE</span>
							<span>{[item.sourceKind, item.source].filter(Boolean).join(' · ')}</span>
						</div>
						<div class="r"><span class="rl">CHAPTERS</span><span>{item.chapters}</span></div>
						<div class="r">
							<span class="rl">COVER</span>
							<span>{[item.cover.a, item.cover.b].filter(Boolean).join(' · ')}</span>
						</div>
						{#if single?.linked}
							<div class="r">
								<span class="rl">LINKED</span>
								<span>{single.linked} · A NEW LINK REPLACES IT</span>
							</div>
						{/if}
					</div>
					{#if searched}<div class="searched">{searched}</div>{/if}
				</section>

				<div class="cands">
					<div class="ch">
						<div>{pasted ? '01 — FROM YOUR LINK' : '01 — CANDIDATES'}</div>
						<div>
							{pasted
								? `ANILIST ${pasted.anilistId}`
								: cands.length
									? `${cands.length} FOUND · TAP ONE`
									: '0 FOUND'}
						</div>
					</div>

					{#if cands.length}
						<div class="grid">
							{#each cands as c, i (c.anilistId)}
								{@const on = chosen === c.anilistId}
								<div
									class="cand"
									class:on
									class:faded={chosen !== null && !on}
									class:off
									role="button"
									tabindex="0"
									aria-pressed={on}
									onclick={() => !off && (chosen = on ? null : c.anilistId)}
									onkeydown={(e) =>
										(e.key === 'Enter' || e.key === ' ') &&
										!off &&
										(e.preventDefault(), (chosen = on ? null : c.anilistId))}
								>
									<div class="strip">
										<div class="letter">{letter(i)}</div>
										<div class="ids">{c.ids}</div>
										{#if on}<div class="chip">✓ LINK THIS</div>{/if}
										<a
											class="open"
											href={anilistUrl(c.anilistId)}
											target="_blank"
											rel="noopener noreferrer external"
											onclick={(e) => e.stopPropagation()}>OPEN ↗</a
										>
									</div>
									<div class="cb">
										<div class="ccover" style:background={coverPlaceholder(hueFor(c.title))}>
											{#if c.coverUrl}<img src={c.coverUrl} alt="" loading="lazy" />{/if}
										</div>
										<div class="ct">
											<div class="ctitle">{c.title}</div>
											{#if c.alts.length}
												<div class="calts">
													{#each c.alts.slice(0, 3) as al (al)}<div class="alt">{al}</div>{/each}
												</div>
											{/if}
											<div class="why">{c.why}</div>
											<div class="rows">
												{#each c.rows as row (row.label)}
													<div class="r tight">
														<span class="rl">{row.label}</span>
														<span class:agree={row.agree}>{row.value}</span>
													</div>
												{/each}
											</div>
										</div>
									</div>
								</div>
							{/each}
						</div>
					{:else}
						<div class="nothing">
							<p>AniList found nothing under this title.</p>
							<div class="hint">{hint}</div>
						</div>
					{/if}

					{#if searching && !noSearch}
						<div class="ch">
							<div>02 — SEARCH AGAIN</div>
							<div>ANILIST · TITLE</div>
						</div>
						<form
							class="field"
							onsubmit={(e) => {
								e.preventDefault();
								searchAgain();
							}}
						>
							<!-- svelte-ignore a11y_autofocus -->
							<input
								type="text"
								bind:value={query}
								aria-label="Title to search on AniList"
								autocomplete="off"
								autofocus
							/>
							<button type="submit" class="go" disabled={netDim || busy}>SEARCH</button>
						</form>
						<div class="fnote">
							RUNS IN THE NEXT COVER PASS, NOT WHILE YOU WAIT. THE SERIES COMES BACK INTO THE QUEUE
							WITH WHAT IT FINDS.
						</div>
					{/if}

					{#if pasting}
						<div class="ch">
							<div>02 — PASTE A LINK</div>
							<div>ANILIST OR MAL</div>
						</div>
						<div class="field">
							<!-- svelte-ignore a11y_autofocus -->
							<input
								type="url"
								class="mono"
								value={pasteText}
								oninput={(e) => readPaste(e.currentTarget.value)}
								placeholder="anilist.co/manga/… or myanimelist.net/manga/…"
								aria-label="AniList or MAL link"
								autocomplete="off"
								autofocus
								disabled={off}
							/>
						</div>
						<div class="fnote last">
							{pasteNote ?? 'ONLY THE ID IN THE LINK IS SENT, NEVER THE TITLE'}
						</div>
					{/if}
				</div>
			</div>
		{/key}

		{#if tools.length}
			<div class="tools">
				{#each tools as t, i (t.label)}
					<button
						type="button"
						class:first={i === 0}
						class:dim={t.dim}
						disabled={t.dim || busy}
						onclick={t.run}>{t.label}</button
					>
				{/each}
			</div>
		{/if}
		<div class="actions" style:grid-template-columns={actionCols}>
			{#each actions as act, i (act.label)}
				<button
					type="button"
					class:strong={act.strong}
					class:first={i === 0}
					class:dim={act.dim}
					disabled={act.dim || busy}
					onclick={act.run}>{act.label}</button
				>
			{/each}
		</div>
	{/if}
</div>

<style>
	/*
	 * Link Review, transcribed: the mock's spacing is hand-set, not a ladder
	 * (as Pair Review's), so the literals are the decisions. Colours are tokens.
	 */
	.review {
		--pad: 24px;
		--head-h: 72px;
		--cover-w: 104px;
		--cand-cover-w: 96px;
		--title-size: 22px;
		--cand-title: 18px;
		--label-col: 104px;
		--act-font: 14px;
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
			--cover-w: 72px;
			--cand-cover-w: 64px;
			--title-size: 18px;
			--cand-title: 16px;
			--label-col: 84px;
			--act-font: 12px;
		}
	}
	@media (min-width: 1200px) {
		.review {
			--cover-w: 120px;
			height: 100dvh;
			min-height: 0;
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
	.band.two {
		height: auto;
		min-height: 60px;
		padding: 8px var(--pad);
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
	.band.two .line {
		white-space: normal;
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

	/* The body: the series above its candidates, or beside them on desktop (1j). */
	.body {
		flex: 1;
		min-height: 0;
		display: flex;
		flex-direction: column;
	}
	@media (min-width: 1200px) {
		.body {
			flex-direction: row;
			overflow: hidden;
		}
	}
	.series {
		flex-shrink: 0;
		display: flex;
		flex-direction: column;
		gap: 14px;
		padding: 16px var(--pad) 18px;
		background: var(--surface-panel);
		border-bottom: 1px solid var(--line-1);
	}
	@media (min-width: 1200px) {
		.series {
			width: 420px;
			border-right: 1px solid var(--line-1);
		}
	}
	.sl,
	.ch {
		font: 500 13px/1.2 var(--font-mono);
		letter-spacing: 0.06em;
		color: var(--text-2);
	}
	.who {
		display: flex;
		gap: 18px;
	}
	.cover {
		position: relative;
		flex-shrink: 0;
		width: var(--cover-w);
		aspect-ratio: 2 / 2.9;
		overflow: hidden;
	}
	.cover.none {
		background: var(--surface-page);
		border: 1px solid var(--line-2);
	}
	.cover img,
	.ccover img {
		position: absolute;
		inset: 0;
		width: 100%;
		height: 100%;
		object-fit: cover;
	}
	.nc {
		position: absolute;
		inset: 0;
		padding: 8px;
		font: 500 11px/1.3 var(--font-mono);
		color: var(--text-2);
		letter-spacing: 0.06em;
	}
	.id {
		flex: 1;
		min-width: 0;
		display: flex;
		flex-direction: column;
		gap: 8px;
	}
	.meta {
		font: 500 13px/1.3 var(--font-mono);
		letter-spacing: 0.06em;
		color: var(--text-2);
	}
	.title {
		font: 500 var(--title-size) / 1.2 var(--font-sans);
		text-wrap: pretty;
	}
	.alt {
		font: 400 14px/1.35 var(--font-sans);
		color: var(--text-2);
	}
	.rows {
		display: flex;
		flex-direction: column;
		border-top: 1px solid var(--line-1);
	}
	.r {
		display: grid;
		grid-template-columns: var(--label-col) minmax(0, 1fr);
		align-items: center;
		min-height: 34px;
		border-bottom: 1px solid var(--line-subtle);
		font: 400 13px/1.3 var(--font-mono);
	}
	.r.tight {
		min-height: 32px;
	}
	.rl {
		color: var(--text-2);
		letter-spacing: 0.06em;
	}
	.r .agree {
		font-weight: 500;
	}
	.r.tight span:not(.rl):not(.agree) {
		color: var(--text-2);
	}
	.searched {
		font: 400 13px/1.45 var(--font-mono);
		color: var(--text-2);
		text-wrap: pretty;
	}

	.cands {
		flex: 1;
		min-width: 0;
	}
	@media (min-width: 1200px) {
		.cands {
			min-height: 0;
			overflow-y: auto;
		}
	}
	.ch {
		display: flex;
		justify-content: space-between;
		gap: 12px;
		padding: 24px var(--pad) 12px;
	}
	.grid {
		display: grid;
		grid-template-columns: minmax(0, 1fr);
		gap: 1px;
		background: var(--line-1);
		border-top: 1px solid var(--line-1);
		border-bottom: 1px solid var(--line-1);
	}
	@media (min-width: 1200px) {
		.grid {
			grid-template-columns: repeat(2, minmax(0, 1fr));
		}
	}
	.cand {
		min-width: 0;
		display: flex;
		flex-direction: column;
		background: var(--surface-page);
		cursor: pointer;
		outline-offset: -2px;
	}
	.cand.on {
		background: var(--accent-select);
	}
	.cand.off {
		cursor: default;
	}
	.strip {
		display: flex;
		align-items: stretch;
		height: 44px;
		border-bottom: 1px solid var(--line-subtle);
	}
	.letter {
		width: 44px;
		flex-shrink: 0;
		display: flex;
		align-items: center;
		justify-content: center;
		border-right: 1px solid var(--line-subtle);
		font: 500 16px var(--font-mono);
	}
	.ids {
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
	.chip {
		display: flex;
		align-items: center;
		padding: 0 14px;
		font: 500 13px/1.2 var(--font-mono);
		letter-spacing: 0.06em;
		background: var(--accent);
		color: var(--on-accent);
		white-space: nowrap;
	}
	.open {
		display: flex;
		align-items: center;
		padding: 0 14px;
		border-left: 1px solid var(--line-subtle);
		color: var(--text-1);
		font: 500 13px/1.2 var(--font-mono);
		letter-spacing: 0.04em;
		white-space: nowrap;
		text-decoration: none;
	}
	.cb {
		display: flex;
		gap: 16px;
		padding: 16px var(--pad) 18px;
	}
	.ccover {
		position: relative;
		flex-shrink: 0;
		width: var(--cand-cover-w);
		aspect-ratio: 2 / 2.9;
		align-self: flex-start;
		overflow: hidden;
	}
	.cand.on .ccover {
		box-shadow: 0 0 0 3px var(--accent);
	}
	.cand.off .ccover {
		opacity: 0.4;
	}
	.ct {
		flex: 1;
		min-width: 0;
		display: flex;
		flex-direction: column;
		gap: 8px;
	}
	.ctitle {
		font: 500 var(--cand-title) / 1.25 var(--font-sans);
		text-wrap: pretty;
	}
	.cand.faded .ctitle {
		color: var(--text-2);
	}
	.calts {
		display: flex;
		flex-direction: column;
		gap: 2px;
	}
	.why {
		font: 500 12px/1.4 var(--font-mono);
		letter-spacing: 0.04em;
		color: var(--text-2);
	}
	.cand.on .why {
		color: var(--accent);
	}
	.nothing {
		display: flex;
		flex-direction: column;
		gap: 10px;
		padding: 8px var(--pad) 20px;
		border-bottom: 1px solid var(--line-1);
	}
	.nothing p {
		margin: 0;
		max-width: 520px;
		font: 500 20px/1.3 var(--font-sans);
		text-wrap: pretty;
	}
	.hint {
		max-width: 560px;
		font: 400 13px/1.45 var(--font-mono);
		color: var(--text-2);
	}
	.field {
		display: flex;
		align-items: stretch;
		margin: 0 var(--pad);
		height: 56px;
		border: 1px solid var(--text-1);
	}
	.field input {
		flex: 1;
		min-width: 0;
		padding: 0 16px;
		border: 0;
		border-radius: 0;
		background: transparent;
		color: var(--text-1);
		font: 400 16px var(--font-sans);
		caret-color: var(--accent);
		outline: none;
	}
	.field input.mono {
		font: 400 15px var(--font-mono);
	}
	.field input::placeholder {
		color: var(--text-2);
	}
	.go {
		display: flex;
		align-items: center;
		padding: 0 20px;
		border: 0;
		border-left: 1px solid var(--text-1);
		border-radius: 0;
		background: var(--surface-inverse);
		color: var(--text-inverse);
		font: 500 14px var(--font-mono);
		letter-spacing: 0.04em;
		cursor: pointer;
	}
	.go:disabled {
		opacity: 0.35;
	}
	.fnote {
		padding: 10px var(--pad) 0;
		font: 400 13px/1.45 var(--font-mono);
		color: var(--text-2);
		text-wrap: pretty;
	}
	.fnote.last {
		padding-bottom: 24px;
	}

	/* Tools and actions stay in reach at the foot, as the duplicates review's do. */
	.tools,
	.actions {
		flex-shrink: 0;
		display: grid;
		border-top: 1px solid var(--line-1);
		background: var(--surface-page);
	}
	.tools {
		grid-template-columns: 1fr 1fr;
		position: sticky;
		bottom: 64px;
	}
	.actions {
		position: sticky;
		bottom: 0;
	}
	.tools button,
	.actions button {
		padding: 6px 10px;
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
	.tools button {
		min-height: 52px;
	}
	.actions button {
		min-height: 64px;
		padding: 8px 10px;
	}
	.tools button.first,
	.actions button.first {
		border-left: 0;
	}
	.actions button.strong {
		background: var(--surface-inverse);
		color: var(--text-inverse);
	}
	.tools button.dim,
	.actions button.dim {
		opacity: 0.35;
		cursor: default;
	}
	.tools button:not(.dim):active,
	.actions button:not(.dim):active {
		background: var(--surface-inverse);
		color: var(--text-inverse);
	}
</style>

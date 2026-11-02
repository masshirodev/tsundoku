<script lang="ts">
	import TopBar from '$lib/components/chrome/TopBar.svelte';
	import Cover from '$lib/components/content/Cover.svelte';
	import { resolve } from '$app/paths';
	import { SvelteMap } from 'svelte/reactivity';
	import { untrack } from 'svelte';
	import { isSettled, type Settled } from '$lib/library/settled';
	import { SiteCheck } from '$lib/site-check.svelte';
	import { formatNumber } from '$lib/library/series';
	import type { SearchHit } from '$lib/server/download-types';

	/**
	 * MOVE TO ANOTHER SOURCE (doc/MOVE.md; Migrate Calls Q1–Q4, boards 2–4).
	 * Candidates on the left as each source answers, the comparison beside
	 * them; one pane on a phone or a portrait tablet, where picking a
	 * candidate swaps the candidates for the comparison (CSS decides, not
	 * script). Nothing changes until MOVE, and MOVE downloads nothing.
	 */
	let { data, form } = $props();

	const base = $derived(resolve('/series/[id]/move', { id: String(data.series.id) }));
	// svelte-ignore state_referenced_locally
	let q = $state(data.q);
	const toHref = (mangaId: string) =>
		`${base}?q=${encodeURIComponent(data.q)}&to=${encodeURIComponent(mangaId)}`;
	const clearTo = () => `${base}${data.q ? `?q=${encodeURIComponent(data.q)}` : ''}`;
	const failure = $derived(
		form && 'message' in form && typeof form.message === 'string' ? form.message.toUpperCase() : ''
	);

	// ---- candidates as each source answers -----------------------------------------
	const settled = new SvelteMap<string, number | 'x'>();
	const countOf = (s: Settled<unknown[]>) => (s.ok ? s.value.length : 'x');
	for (const g of untrack(() => data.groups))
		if (isSettled(g.hits)) settled.set(g.id, countOf(g.hits));
	$effect(() => {
		settled.clear();
		for (const g of data.groups) {
			const h = g.hits;
			if (isSettled(h)) settled.set(g.id, countOf(h));
			else void h.then((s) => settled.set(g.id, countOf(s)));
		}
	});
	const checks = new SvelteMap<string, SiteCheck>();
	$effect(() => {
		if (!data.engine) return;
		for (const g of data.groups) {
			if (settled.get(g.id) !== undefined) {
				checks.get(g.id)?.stop();
				checks.delete(g.id);
			} else if (!checks.has(g.id)) {
				const c = new SiteCheck();
				c.start(g.id);
				checks.set(g.id, c);
			}
		}
	});
	$effect(() => () => {
		for (const c of checks.values()) c.stop();
	});
	const answered = $derived([...settled.values()].filter((v) => v !== 'x').length);
	const found = $derived(
		[...settled.values()].reduce<number>((a, v) => a + (v === 'x' ? 0 : v), 0)
	);

	// ---- PLAYS: one episode, once a candidate is picked (Anime Calls Q2) ------------
	type Plays = { plays: boolean; quality: string | null };
	let plays = $state<Plays | 'checking' | 'failed' | null>(null);
	$effect(() => {
		const check = data.comparison?.playCheck;
		plays = null;
		if (!check) return;
		plays = 'checking';
		let live = true;
		const u = new URL(
			resolve('/api/anime/candidate/playable'),
			typeof location === 'undefined' ? 'http://x' : location.origin
		);
		u.searchParams.set('source', check.sourceId);
		u.searchParams.set('url', check.url);
		u.searchParams.set('name', check.name);
		void fetch(`${u.pathname}${u.search}`)
			.then(async (r) => {
				if (!live) return;
				if (!r.ok) {
					plays = 'failed';
					return;
				}
				plays = (await r.json()) as Plays;
			})
			.catch(() => {
				if (live) plays = 'failed';
			});
		return () => {
			live = false;
		};
	});
	const playsLine = $derived.by(() => {
		const check = data.comparison?.playCheck;
		if (!check) return null;
		if (plays === 'checking') return `CHECKING EP. ${formatNumber(check.number)}…`;
		if (plays === null || plays === 'failed') return null;
		return plays.plays
			? `✓ EP. ${formatNumber(check.number)} (THEIR ${formatNumber(check.theirNumber)}) PLAYS${plays.quality ? ` · ${plays.quality}` : ''}`
			: `NO VIDEO FOR EP. ${formatNumber(check.number)} THERE`;
	});
</script>

<svelte:head><title>move · {data.series.title} · tsundoku</title></svelte:head>

<!-- eslint-disable svelte/no-navigation-without-resolve -- every href is built from resolve() or base -->

<TopBar strong label="Move to another source">
	{#snippet left()}
		<a
			class="cell back"
			href={resolve('/series/[id]', { id: String(data.series.id) })}
			data-focus-mark="in"
		>
			← <span class="long">SERIES</span>
		</a>
	{/snippet}
	{#snippet middle()}
		<div class="bar-title">
			<div class="t">MOVE TO ANOTHER SOURCE</div>
			<div class="s">
				{data.series.title.toUpperCase()} · NOW FROM {data.state.source.toUpperCase()}
			</div>
		</div>
	{/snippet}
</TopBar>

{#if failure}<div class="failure" role="status">{failure} · NOTHING CHANGED</div>{/if}

<div class="mv" class:comparing={!!data.to}>
	<section class="cands" aria-label="Candidates">
		<form class="qform" method="GET" action={base} aria-label="Search the sources">
			<label class="box">
				<span class="p">/</span>
				<input
					name="q"
					bind:value={q}
					autocomplete="off"
					autocapitalize="off"
					spellcheck="false"
					aria-label="Search the sources for this title"
				/>
				<button class="b" type="submit">SEARCH</button>
			</label>
			{#if data.names.length}
				<div class="names">
					<span class="k">OTHER NAMES</span>
					{#each data.names as name (name)}
						<a class="chip sm" href="{base}?q={encodeURIComponent(name)}">{name}</a>
					{/each}
				</div>
			{/if}
		</form>

		{#if data.series.hidden && !data.groups.length}
			<div class="empty cands-empty">
				<div class="k">01 — NOTHING ASKED YET</div>
				<div class="big">Hidden series are never searched by themselves.</div>
				<p>
					SEARCH asks every {data.series.kind === 'anime' ? 'anime' : 'manga'} source for this title,
					once. PASTE A LINK asks only the site it names.
				</p>
			</div>
		{:else if data.q}
			<div class="lab">
				<span
					>01 — {answered} OF {data.groups.length} SOURCE{data.groups.length === 1 ? '' : 'S'} ANSWERED</span
				>
				<span>{found} FOUND</span>
			</div>
			<div class="scroll">
				{#each data.groups as g (g.id)}
					<div class="ghead">
						<span>{g.name.toUpperCase()}</span>
						<span class="d" class:ink={settled.get(g.id) === 'x'}>
							{#if settled.get(g.id) === undefined && checks.get(g.id)?.since != null}BROWSER CHECK
								· ASKED {Math.floor((checks.get(g.id)?.elapsed ?? 0) / 1000)} S AGO{:else if settled.get(g.id) === undefined}ASKING{:else if settled.get(g.id) === 'x'}DID
								NOT ANSWER{/if}
						</span>
					</div>
					{#snippet answer(hits: SearchHit[] | null)}
						{#if hits}
							{#each hits as h (h.mangaId)}
								{#if h.match.kind === 'in-library' && h.match.seriesId === data.series.id}
									<div class="cand now" aria-disabled="true">
										<Cover src={h.cover} width={44} height={62} />
										<span class="text">
											<span class="t">{h.title}</span>
											<span class="m"
												><span class="lead">THIS SERIES NOW</span> · {h.meta ||
													'AT THIS SOURCE'}</span
											>
										</span>
									</div>
								{:else}
									<a
										class="cand"
										class:on={data.to === h.mangaId}
										href={toHref(h.mangaId)}
										data-focus-mark="in"
									>
										<Cover src={h.cover} width={44} height={62} />
										<span class="text">
											<span class="t">{h.title}</span>
											<span class="m">
												{#if h.match.kind === 'in-library'}<span class="lead">ALSO IN LIBRARY</span
													>{#if h.meta}
														· {h.meta}{/if}{:else if h.match.kind === 'same-title'}<span
														class="lead">SAME TITLE IN LIBRARY</span
													>{#if h.match.source}
														· FROM {h.match.source}{/if}{:else}{h.meta || 'AT THIS SOURCE'}{/if}
											</span>
										</span>
										<span class="go">→</span>
									</a>
								{/if}
							{/each}
							{#if hits.length === 0}<div class="none">NOTHING FOUND</div>{/if}
						{:else}
							<div class="failed">
								<span>DID NOT ANSWER IN 20 S · NOTHING FROM IT</span>
								<a href="{base}?q={encodeURIComponent(data.q)}&source={g.id}">TRY AGAIN</a>
							</div>
						{/if}
					{/snippet}
					{#if isSettled(g.hits)}
						{@render answer(g.hits.ok ? g.hits.value : null)}
					{:else}
						{#await g.hits}
							{#each [62, 48] as w (w)}
								<div class="cand ghost" aria-hidden="true">
									<span class="cov-ghost"></span>
									<span class="text"><i style:width="{w}%"></i><i style:width="34%"></i></span>
								</div>
							{/each}
						{:then s}
							{@render answer(s.ok ? s.value : null)}
						{/await}
					{/if}
				{/each}
			</div>
		{:else}
			<div class="empty cands-empty">
				<div class="k">01 — A TITLE TO ASK WITH</div>
				<div class="big">Search for it, by this name or another.</div>
				<p>
					The series' own title and names are searched on every installed source of its kind, as
					each answers.
				</p>
			</div>
		{/if}

		<form class="paste" method="GET" action={base}>
			<input name="paste" placeholder="PASTE A LINK" aria-label="Paste a series' address" />
			<span class="d">A SERIES' ADDRESS ON A SOURCE'S SITE</span>
			<button type="submit">ASK IT</button>
		</form>
		{#if data.pasteFailed}
			<div class="failed"><span>NO INSTALLED SOURCE IS THAT SITE</span></div>
		{/if}
	</section>

	<section class="cmp" aria-label="What the move does">
		{#if data.comparison}
			{@const c = data.comparison}
			<div class="cmp-body">
				<div class="cmp-head">
					<Cover src={c.candidate.cover} width={72} height={104} />
					<div class="nm">
						<div class="meta">
							{c.candidate.source.toUpperCase()} · {c.kind === 'anime'
								? 'ANIME'
								: data.series.kind.toUpperCase()}{c.candidate.status
								? ` · ${c.candidate.status.toUpperCase()}`
								: ''}
						</div>
						<h2>{c.candidate.title}</h2>
						<div class="yours">
							{#if c.candidate.title.trim().toLowerCase() === data.series.title
									.trim()
									.toLowerCase()}
								The same title as yours.
							{:else}
								Yours is {data.series.title}{c.season ? `, season ${c.season}` : ''}.
							{/if}
						</div>
					</div>
				</div>

				{#if c.offset || c.plan.seasoned}
					<div class="sec">
						<span>02 — WHICH PART IS THIS SERIES</span>
						<span>{c.candidate.flat ? 'THEY LIST EVERY SEASON AS ONE' : 'THEY LIST SEASONS'}</span>
					</div>
					<div class="blk">
						{#if c.offset}
							<form class="offset" method="GET" action={base}>
								<input type="hidden" name="q" value={data.q} />
								<input type="hidden" name="to" value={data.to ?? ''} />
								<span>YOUR EP. 1 IS THEIR EP.</span>
								<input
									class="num"
									name="offset"
									value={c.offset.value}
									inputmode="numeric"
									aria-label="Their episode number for your episode 1"
								/>
								<button type="submit">SET</button>
								<span class="b"
									>{c.offset.guessed ? 'GUESSED FROM EPISODE TITLES' : 'EDITED'} · {c.offset.agree} OF
									{c.offset.of} TITLES AGREE</span
								>
							</form>
						{/if}
						{#if c.plan.seasoned}
							<div class="what">
								<div class="lb">TAKES</div>
								<div class="tx">
									<div class="a">Their season {c.season ?? '—'}, episode by episode</div>
									<div class="b">
										{#each c.candidate.seasons as s (s)}
											<span class="chip sm" class:on={s === c.season}>S{s}</span>
										{/each}
										OTHER SEASONS AREN'T ADDED, AND FOLLOW KEEPS TO YOURS
									</div>
								</div>
							</div>
						{/if}
					</div>
				{/if}

				<div class="sec">
					<span>{c.offset || c.plan.seasoned ? '03' : '02'} — WHAT THE MOVE DOES</span>
					<span>FROM {c.source.toUpperCase()} TO {c.candidate.source.toUpperCase()}</span>
				</div>
				<div class="blk">
					{#each c.summary as row (row.key)}
						<div class="what">
							<div class="lb">{row.label}</div>
							<div class="tx">
								<div class="a">{row.a}</div>
								<div class="b">{row.b}</div>
							</div>
							<div
								class="st"
								class:moves={row.status === 'MOVES'}
								class:kept={row.status === 'KEPT'}
								class:same={row.status === 'UNCHANGED'}
							>
								{row.status}
							</div>
						</div>
					{/each}
					{#if playsLine}
						<div class="what play">
							<div class="lb">PLAYS</div>
							<div class="tx">
								<div class="a">{playsLine}</div>
								<div class="b">THE EPISODE CONTINUE PLAYS · MOVE DOESN'T WAIT ON IT</div>
							</div>
							<div
								class="st"
								class:moves={plays !== null &&
									plays !== 'checking' &&
									plays !== 'failed' &&
									plays.plays}
							>
								{plays === 'checking'
									? 'CHECKING'
									: plays && plays !== 'failed' && plays.plays
										? 'PLAYS'
										: '—'}
							</div>
						</div>
					{/if}
				</div>

				<div class="sec">
					<span>{c.offset || c.plan.seasoned ? '04' : '03'} — BY NUMBER</span>
					<span
						>{c.plan.matches.length} MATCH · {c.plan.kept.length +
							c.plan.added.length +
							c.plan.notTaken.length +
							c.plan.splits.length} PLACE{c.plan.kept.length +
							c.plan.added.length +
							c.plan.notTaken.length +
							c.plan.splits.length ===
						1
							? ''
							: 'S'} DON'T</span
					>
				</div>
				<div class="blk map">
					<div class="mh">
						<div>YOURS · {c.source.toUpperCase()}</div>
						<div>THEIRS · {c.candidate.source.toUpperCase()}</div>
						<div>WHAT HAPPENS</div>
					</div>
					{#each c.plan.rows as row, i (i)}
						<div
							class="mr run"
							class:odd={row.variant !== 'match'}
							class:here={row.here}
							class:read={row.variant === 'match' && row.status.includes('READ')}
						>
							<div class:yours={row.yours !== '—'} class:downloaded={row.downloaded}>
								{row.yours}{#if row.downloaded}<span class="sub">↓ DOWNLOADED</span>{/if}
							</div>
							<div class:theirs={row.theirs !== '—'}>{row.theirs}</div>
							<div>
								<span class="h {row.variant}">{row.status}</span>
								{#if row.detail}<span class="sub">{row.detail}</span>{/if}
							</div>
						</div>
					{/each}
					<details class="more">
						<summary
							><span>MATCHING RUNS FOLDED</span><span class="ink"
								>SHOW ALL {c.plan.allRows.length} ↓</span
							></summary
						>
						{#each c.plan.allRows as row, i (i)}
							<div class="mr odd" class:here={row.here}>
								<div class:yours={row.yours !== '—'} class:downloaded={row.downloaded}>
									{row.yours}{#if row.downloaded}<span class="sub">↓ DOWNLOADED</span>{/if}
								</div>
								<div class:theirs={row.theirs !== '—'}>{row.theirs}</div>
								<div>
									<span class="h {row.variant}">{row.status}</span>
									{#if row.detail}<span class="sub">{row.detail}</span>{/if}
								</div>
							</div>
						{/each}
					</details>
				</div>
			</div>

			{#if c.conflict}
				<div class="confirm blocked">
					<a class="cancel" href={clearTo()} data-focus-mark="in">← CANCEL</a>
					<div class="note">
						<span class="ink">THAT IS ALREADY {c.conflict.title.toUpperCase()} IN THE LIBRARY</span>
						<span>TWO SERIES FROM ONE ENTRY · JOIN THEM IN MIGHT BE ONE SERIES</span>
					</div>
				</div>
			{:else}
				<form class="confirm" method="POST" action="?/move">
					<a class="cancel" href={clearTo()} data-focus-mark="in">← CANCEL</a>
					<div class="note">
						<span class="ink">NOTHING DOWNLOADS ON MOVE</span>
						<span>MOVE BACK STAYS ON THE SERIES FOR 30 DAYS</span>
					</div>
					<input type="hidden" name="to" value={data.to ?? ''} />
					<input type="hidden" name="offset" value={String(c.offset?.value ?? 1)} />
					<button class="go" type="submit" data-focus-mark="in"
						>MOVE TO {c.candidate.source.toUpperCase()} →</button
					>
				</form>
			{/if}
		{:else if data.comparisonError}
			<div class="empty">
				<div class="k">02 — WHAT THE MOVE DOES</div>
				<div class="big">That source wouldn't say.</div>
				<p>{data.comparisonError}. Pick another candidate, or try it again in a moment.</p>
			</div>
		{:else}
			<div class="empty">
				<div class="k">02 — WHAT THE MOVE DOES</div>
				<div class="big">Pick a candidate to see what moves.</div>
				<p>
					Nothing changes until MOVE. Your reading, rating, shelves, tags and downloaded files stay
					with the series wherever its chapters come from.
				</p>
			</div>
		{/if}
	</section>
</div>

<!-- eslint-enable svelte/no-navigation-without-resolve -->

<style>
	/* The frame is the handoff's (mv.css): a 440px candidates column beside the
	   comparison, and one pane below 1024px, where the comparison is its own
	   screen. Colours are tokens; the literals are the design's. */
	.bar-title {
		flex: 1;
		min-width: 0;
		display: flex;
		flex-direction: column;
		justify-content: center;
		gap: 3px;
		padding: 0 20px;
	}
	.bar-title .t {
		font: 500 14px var(--font-mono);
		letter-spacing: 0.04em;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}
	.bar-title .s {
		font: 400 12px var(--font-mono);
		color: var(--text-2);
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}
	.cell.back {
		display: flex;
		align-items: center;
		padding: 0 var(--pad);
		color: var(--text-1);
		font: 500 14px var(--font-mono);
		letter-spacing: 0.04em;
		text-decoration: none;
		white-space: nowrap;
	}
	.failure {
		flex-shrink: 0;
		padding: 12px var(--pad);
		border-bottom: var(--hairline);
		background: var(--surface-panel);
		font: 500 13px var(--font-mono);
		letter-spacing: 0.04em;
	}
	.mv {
		flex: 1;
		min-height: 0;
		display: flex;
	}
	.cands {
		width: 440px;
		flex-shrink: 0;
		display: flex;
		flex-direction: column;
		border-right: var(--hairline);
		overflow: hidden;
	}
	.qform {
		display: flex;
		flex-direction: column;
		gap: 12px;
		padding: 20px var(--pad) 18px;
		border-bottom: var(--hairline);
	}
	.box {
		display: flex;
		height: 52px;
		border: 1px solid var(--text-1);
	}
	.box .p {
		display: flex;
		align-items: center;
		padding-left: 14px;
		color: var(--text-2);
		font: 400 15px var(--font-mono);
	}
	.box input {
		flex: 1;
		min-width: 0;
		border: 0;
		background: transparent;
		padding: 0 10px;
		color: var(--text-1);
		font: 400 15px var(--font-mono);
	}
	.box input:focus {
		outline: none;
	}
	.box .b {
		display: flex;
		align-items: center;
		padding: 0 16px;
		border: 0;
		border-left: 1px solid var(--text-1);
		border-radius: 0;
		background: transparent;
		color: var(--text-1);
		font: 500 13px var(--font-mono);
		letter-spacing: 0.04em;
		cursor: pointer;
	}
	.box .b:active {
		background: var(--surface-inverse);
		color: var(--text-inverse);
	}
	.names {
		display: flex;
		flex-wrap: wrap;
		gap: 8px;
		align-items: center;
	}
	.k {
		font: 500 12px/1.2 var(--font-mono);
		letter-spacing: 0.06em;
		color: var(--text-2);
	}
	.names .k {
		margin-right: 4px;
	}
	.chip {
		display: inline-flex;
		align-items: center;
		height: 36px;
		padding: 0 12px;
		border: 1px solid var(--line-2);
		color: var(--text-1);
		font: 500 13px var(--font-mono);
		white-space: nowrap;
		text-decoration: none;
	}
	.chip.on {
		background: var(--surface-inverse);
		border-color: var(--surface-inverse);
		color: var(--text-inverse);
	}
	.chip.sm {
		height: 32px;
		font-size: 12px;
		max-width: 100%;
		overflow: hidden;
		text-overflow: ellipsis;
	}
	.lab {
		display: flex;
		justify-content: space-between;
		gap: 12px;
		padding: 18px var(--pad) 12px;
		font: 500 13px/1.2 var(--font-mono);
		letter-spacing: var(--tracking-label);
		color: var(--text-2);
	}
	.scroll {
		flex: 1;
		min-height: 0;
		overflow-y: auto;
		border-top: var(--hairline);
	}
	.ghead {
		display: flex;
		justify-content: space-between;
		gap: 12px;
		padding: 14px var(--pad);
		border-bottom: var(--hairline);
		font: 500 13px var(--font-mono);
		letter-spacing: 0.06em;
	}
	.ghead .d {
		color: var(--text-2);
		text-align: right;
	}
	.ghead .d.ink {
		color: var(--text-1);
	}
	.cand {
		display: flex;
		align-items: center;
		gap: 14px;
		padding: 10px var(--pad);
		border-bottom: var(--hairline);
		color: var(--text-1);
		text-decoration: none;
	}
	.cand .text {
		flex: 1;
		min-width: 0;
		display: flex;
		flex-direction: column;
		gap: 5px;
	}
	.cand .t {
		font: 500 15px/1.3 var(--font-sans);
		display: -webkit-box;
		line-clamp: 2;
		-webkit-line-clamp: 2;
		-webkit-box-orient: vertical;
		overflow: hidden;
	}
	.cand .m {
		font: 400 12px/1.4 var(--font-mono);
		color: var(--text-2);
	}
	.cand .m .lead {
		color: var(--text-1);
	}
	.cand .go {
		font: 500 15px var(--font-mono);
		color: var(--text-2);
	}
	.cand.on {
		background: var(--accent-select);
		box-shadow: inset 0 0 0 2px var(--accent);
	}
	.cand.on .go {
		color: var(--accent);
	}
	.cand.now {
		opacity: 0.4;
	}
	.cand.ghost .cov-ghost {
		width: 44px;
		height: 62px;
		flex-shrink: 0;
		border: 1px dashed var(--line-2);
	}
	.cand.ghost i {
		display: block;
		height: 10px;
		background: var(--line-1);
	}
	.failed {
		display: flex;
		justify-content: space-between;
		align-items: center;
		min-height: 52px;
		padding: 0 var(--pad);
		border-bottom: var(--hairline);
		font: 400 12px var(--font-mono);
		color: var(--text-2);
	}
	.failed a {
		color: var(--text-1);
		font-weight: 500;
		text-decoration: none;
	}
	.none {
		display: flex;
		align-items: center;
		min-height: 44px;
		padding: 0 var(--pad);
		border-bottom: var(--hairline);
		font: 500 12px var(--font-mono);
		color: var(--text-2);
	}
	.paste {
		display: flex;
		align-items: center;
		gap: 10px;
		min-height: 60px;
		padding: 0 var(--pad);
		border-top: var(--hairline);
		border-bottom: var(--hairline);
	}
	.paste input {
		width: 130px;
		min-width: 0;
		height: 36px;
		border: 1px solid var(--line-2);
		background: transparent;
		color: var(--text-1);
		padding: 0 10px;
		font: 500 12px var(--font-mono);
	}
	.paste .d {
		flex: 1;
		min-width: 0;
		font: 400 12px var(--font-mono);
		color: var(--text-2);
	}
	.paste button {
		border: 0;
		background: transparent;
		color: var(--text-1);
		font: 500 13px var(--font-mono);
		cursor: pointer;
	}
	.cmp {
		flex: 1;
		min-width: 0;
		display: flex;
		flex-direction: column;
		overflow: hidden;
	}
	.cmp-body {
		flex: 1;
		min-height: 0;
		overflow-y: auto;
		padding: 0 32px 32px;
		display: flex;
		flex-direction: column;
	}
	.empty {
		flex: 1;
		display: flex;
		flex-direction: column;
		justify-content: center;
		gap: 14px;
		padding: 0 64px;
	}
	.cands-empty {
		padding: 0 var(--pad);
		justify-content: flex-start;
		padding-top: 40px;
	}
	.empty .big {
		font: 500 28px/1.25 var(--font-sans);
		max-width: 560px;
	}
	.empty p {
		margin: 0;
		font: 400 17px/1.55 var(--font-sans);
		color: var(--text-2);
		max-width: 560px;
		text-wrap: pretty;
	}
	.cmp-head {
		display: flex;
		gap: 20px;
		padding: 24px 0 20px;
	}
	.cmp-head .nm {
		min-width: 0;
		display: flex;
		flex-direction: column;
		gap: 8px;
	}
	.cmp-head .meta {
		font: 500 13px/1.4 var(--font-mono);
		letter-spacing: 0.06em;
		color: var(--text-2);
	}
	.cmp-head h2 {
		margin: 0;
		font: 500 24px/1.25 var(--font-sans);
	}
	.cmp-head .yours {
		font: 400 14px var(--font-sans);
		color: var(--text-2);
	}
	.sec {
		display: flex;
		justify-content: space-between;
		gap: 12px;
		padding: 20px 0 12px;
		font: 500 13px/1.2 var(--font-mono);
		letter-spacing: 0.06em;
		color: var(--text-2);
	}
	.blk {
		border: var(--hairline);
	}
	.blk > * + * {
		border-top: var(--hairline);
	}
	.what {
		display: flex;
		align-items: stretch;
		min-height: 52px;
	}
	.what .lb {
		width: 112px;
		flex-shrink: 0;
		display: flex;
		align-items: center;
		padding-left: 16px;
		border-right: var(--hairline);
		font: 500 12px var(--font-mono);
		letter-spacing: 0.06em;
		color: var(--text-2);
	}
	.what .tx {
		flex: 1;
		min-width: 0;
		display: flex;
		flex-direction: column;
		justify-content: center;
		gap: 4px;
		padding: 9px 16px;
	}
	.what .tx .a {
		font: 500 15px/1.35 var(--font-sans);
	}
	.what .tx .b {
		font: 400 12px/1.4 var(--font-mono);
		color: var(--text-2);
	}
	.what .st {
		display: flex;
		align-items: center;
		padding: 0 16px;
		border-left: var(--hairline);
		font: 500 12px var(--font-mono);
		letter-spacing: 0.06em;
		white-space: nowrap;
	}
	.what .st.moves {
		color: var(--accent);
	}
	.what .st.kept {
		color: var(--text-1);
	}
	.what .st.same {
		color: var(--text-2);
	}
	.what.play .tx .a {
		color: var(--accent);
	}
	.offset {
		display: flex;
		align-items: center;
		flex-wrap: wrap;
		gap: 12px;
		padding: 12px 16px;
		font: 400 14px var(--font-mono);
	}
	.offset .num {
		width: 80px;
		height: 40px;
		padding: 0 12px;
		border: 1px solid var(--text-1);
		background: transparent;
		color: var(--text-1);
		font: 500 15px var(--font-mono);
	}
	.offset button {
		height: 40px;
		padding: 0 14px;
		border: 1px solid var(--text-1);
		border-radius: 0;
		background: transparent;
		color: var(--text-1);
		font: 500 13px var(--font-mono);
		cursor: pointer;
	}
	.offset .b {
		font-size: 12px;
		color: var(--text-2);
	}
	.map .mh,
	.map .mr {
		display: grid;
		grid-template-columns: 1fr 1fr 1.25fr;
	}
	.map .mh > * {
		padding: 10px 16px;
		font: 500 12px var(--font-mono);
		letter-spacing: 0.06em;
		color: var(--text-2);
	}
	.map .mr > * {
		display: flex;
		flex-direction: column;
		justify-content: center;
		gap: 3px;
		min-height: 48px;
		padding: 7px 16px;
		font: 500 14px var(--font-mono);
	}
	.map .mh > * + *,
	.map .mr > * + * {
		border-left: var(--hairline);
	}
	.map .mr .sub {
		font: 400 12px var(--font-sans);
		color: var(--text-2);
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}
	.map .mr .h {
		font: 500 12px var(--font-mono);
		letter-spacing: 0.04em;
		color: var(--text-2);
	}
	.map .mr .h.kept,
	.map .mr .h.adds,
	.map .mr .h.split,
	.map .mr .h.untaken {
		color: var(--text-1);
	}
	.map .mr.odd {
		background: var(--surface-panel);
	}
	.map .mr.here > :first-child,
	.map .mr.here > :nth-child(2) {
		color: var(--accent);
	}
	.map .more {
		display: block;
		border-top: var(--hairline);
	}
	.map .more summary {
		display: flex;
		justify-content: space-between;
		align-items: center;
		height: 44px;
		padding: 0 16px;
		font: 500 12px var(--font-mono);
		letter-spacing: 0.04em;
		color: var(--text-2);
		cursor: pointer;
		list-style: none;
	}
	.map .more summary::-webkit-details-marker {
		display: none;
	}
	.map .more .ink {
		color: var(--text-1);
	}
	.confirm {
		flex-shrink: 0;
		display: flex;
		height: 72px;
		border-top: var(--rule-strong);
	}
	.confirm .cancel {
		display: flex;
		align-items: center;
		padding: 0 28px;
		border-right: var(--hairline);
		font: 500 14px var(--font-mono);
		letter-spacing: 0.04em;
		color: var(--text-1);
		text-decoration: none;
	}
	.confirm .note {
		flex: 1;
		min-width: 0;
		display: flex;
		flex-direction: column;
		justify-content: center;
		gap: 4px;
		padding: 0 20px;
		font: 400 12px/1.4 var(--font-mono);
		color: var(--text-2);
	}
	.confirm .note .ink {
		font-weight: 500;
		color: var(--text-1);
	}
	.confirm .go {
		display: flex;
		align-items: center;
		gap: 12px;
		padding: 0 28px;
		border: 0;
		border-radius: 0;
		background: var(--accent);
		color: var(--on-accent);
		font: 500 15px var(--font-mono);
		letter-spacing: 0.04em;
		white-space: nowrap;
		cursor: pointer;
	}
	/* Portrait and the phone: one pane. Picking a candidate swaps the list for
	   the comparison; layout is the media query's, never script's. */
	@media (max-width: 1023px) {
		.mv {
			flex-direction: column;
		}
		.cands {
			width: auto;
			flex: 1;
			border-right: 0;
		}
		.cmp {
			flex: 1;
		}
		.mv.comparing .cands {
			display: none;
		}
		.mv:not(.comparing) .cmp {
			display: none;
		}
		.confirm {
			position: sticky;
			bottom: 0;
			background: var(--surface-page);
		}
		.cmp-body {
			padding: 0 16px 16px;
		}
		/* The phone folds harder: only the odd rows and the reading row. */
		.map .mr.run:not(.odd):not(.here) {
			display: none;
		}
		.map .more .mr.run {
			display: grid;
		}
	}
	@media (max-width: 599px) {
		.cell.back .long {
			display: none;
		}
		.cands .qform {
			padding: 14px 16px;
			gap: 10px;
		}
		.box {
			height: 48px;
		}
		.ghead {
			padding: 12px 16px;
			font-size: 12px;
		}
		.cand {
			padding: 10px 16px;
			gap: 12px;
		}
		.cmp-head {
			padding: 16px 0 12px;
			gap: 14px;
		}
		.cmp-head h2 {
			font-size: 18px;
		}
		.cmp-head .meta {
			font-size: 12px;
		}
		.sec {
			padding: 16px 0 10px;
			font-size: 12px;
		}
		.what {
			min-height: 48px;
		}
		.what .lb {
			width: 84px;
			padding-left: 12px;
			font-size: 11px;
		}
		.what .tx {
			padding: 8px 12px;
		}
		.what .tx .a {
			font-size: 14px;
		}
		.what .tx .b {
			font-size: 11px;
		}
		.what .st {
			padding: 0 10px;
			font-size: 11px;
		}
		.confirm {
			height: 64px;
		}
		.confirm .cancel {
			padding: 0 16px;
			font-size: 13px;
		}
		.confirm .go {
			flex: 1;
			justify-content: space-between;
			padding: 0 16px;
			font-size: 14px;
		}
		.empty {
			padding: 0 16px;
		}
		.empty .big {
			font-size: 22px;
		}
		.empty p {
			font-size: 15px;
		}
		.map .mh,
		.map .mr {
			grid-template-columns: 0.8fr 0.8fr 1.4fr;
		}
		.map .mh > * {
			padding: 8px 10px;
			font-size: 11px;
		}
		.map .mr > * {
			min-height: 44px;
			padding: 6px 10px;
			font-size: 13px;
		}
		.map .mr .h {
			font-size: 11px;
		}
		.map .more summary {
			padding: 0 10px;
			font-size: 11px;
		}
	}
</style>

<script lang="ts">
	import StartTrail from '$lib/components/start/StartTrail.svelte';
	import { page } from '$app/state';
	import { trail } from '$lib/start-trail.svelte';
	import { resolve } from '$app/paths';
	import { enhance } from '$app/forms';
	import Band from '$lib/components/chrome/Band.svelte';
	import { formatNumber } from '$lib/library/series';
	import { count, previewConfirm, previewDownload } from '$lib/library/downloads';
	import ConfirmSheet from '$lib/components/chrome/ConfirmSheet.svelte';
	import { coverPlaceholder } from '$lib/library/cover';
	import { offline } from '$lib/offline.svelte';
	import { continueCell, KEEP_DAYS, keptLine, recordLine, rowLook } from '$lib/library/browsing';

	/**
	 * A search result's preview (Download States 1e, state 7): the series
	 * screen's layout with what the source gave -- no rating, shelves or FILE
	 * -- and + ADD TO LIBRARY beside reading. Its DOWNLOAD row is the library
	 * series' own, but each cell asks first, in our sheet, since downloading
	 * adds the series (card c205); adding lands on the new series.
	 */
	let { data, form } = $props();
	/** FIRST READ's next control, ringed while its trip lasts (doc/ONBOARDING.md, "The way back"). */
	const ring = $derived(trail.ring(data.start, page.url.pathname));
	let adding = $state(false);
	/** Which DOWNLOAD cell is asking: its sheet is open while this is set. */
	let asking = $state<'next' | 'all' | null>(null);
	const back = $derived(
		data.from
			? data.from
			: data.q
				? `${resolve('/downloads/search')}?q=${encodeURIComponent(data.q)}`
				: resolve('/downloads/search')
	);
	const refusal = $derived(
		form && 'message' in form && typeof form.message === 'string' ? form.message.toUpperCase() : ''
	);
	const STATUS: Record<string, string> = {
		ONGOING: 'ONGOING',
		COMPLETED: 'COMPLETED',
		LICENSED: 'LICENSED',
		PUBLISHING_FINISHED: 'COMPLETED',
		CANCELLED: 'CANCELLED',
		ON_HIATUS: 'ON HIATUS'
	};
	const host = (u: string) => {
		try {
			return new URL(u).hostname.replace(/^www\./, '').toUpperCase();
		} catch {
			return '';
		}
	};
</script>

<svelte:head><title>preview · tsundoku</title></svelte:head>

<div class="preview">
	<header class="bar">
		<!-- eslint-disable-next-line svelte/no-navigation-without-resolve -- built from resolve() -->
		<a class="back" href={back}
			><span class="arrow">←</span><span>{data.from ? 'BROWSE' : 'SOURCES'}</span></a
		>
	</header>
	<!-- The way back to GET STARTED, while FIRST READ's trip lasts (doc/ONBOARDING.md). -->
	<StartTrail start={data.start} />

	{#if refusal}<Band title={refusal} detail="NOTHING CHANGED" />{/if}

	{#await data.manga}
		<div class="asking">ASKING THE SOURCE…</div>
	{:then m}
		{#if !m}
			<div class="asking">THE SOURCE NO LONGER HAS IT</div>
		{:else}
			{@const anime = m.kind === 'anime'}
			{@const cell = continueCell(data.record?.next ?? null, anime)}
			{@const meta = [m.source.toUpperCase(), STATUS[m.status], data.record ? 'NOT IN LIBRARY' : '']
				.filter(Boolean)
				.join(' · ')}
			<!-- What DOWNLOAD counts: the source's list less what a record has read. -->
			{@const unread = m.chapters.filter((c) => !('states' in m) || !m.states[c.id]?.read).length}
			{@const dl = previewDownload(unread, anime, offline.online)}
			{@const ask = previewConfirm(m.title, unread, asking ?? 'next', anime)}
			<div class="body">
				<section class="panel" aria-label="About this series">
					<div class="identity">
						<span
							class="cover"
							style:background={m.thumbnailUrl
								? `center / cover no-repeat url(${m.cover}), ${coverPlaceholder(160)}`
								: coverPlaceholder(160)}
						></span>
						<div class="names">
							<div class="meta">{meta}</div>
							<h1>{m.title}</h1>
						</div>
					</div>

					<!-- Reading first, adding beside it (Online Calls, "Read first, add beside
						     it"): ▶ continues a record, or starts the first episode or chapter. Novels
						     read online come with card c167. -->
					<div class="cta-bar">
						<form method="POST" action="?/open" class="cta-go">
							<button
								type="submit"
								class="cta"
								name="ep"
								value={data.record?.next?.sourceUrl ?? m.chapters.at(-1)?.url ?? ''}
								disabled={!offline.online || !m.chapters.length}
							>
								<span>{cell.label}</span>
								{#if cell.meta}<span class="cta-meta">{cell.meta}</span>{/if}
							</button>
						</form>
						<form
							method="POST"
							action="?/add"
							use:enhance={() => {
								adding = true;
								return async ({ update }) => {
									await update();
									adding = false;
								};
							}}
						>
							<button
								type="submit"
								class="add"
								class:ring={ring === 'add'}
								disabled={adding || !offline.online}
							>
								<span class="long">{adding ? 'ADDING…' : '+ ADD TO LIBRARY'}</span>
								<span class="short">{adding ? '…' : '+ ADD'}</span>
							</button>
						</form>
					</div>

					<!-- DOWNLOAD (card c205): the library series' row, every cell asking first. -->
					{#snippet dlCells()}
						{#each dl.cells as c (c.which)}
							<button
								type="button"
								class="lc"
								class:acc={c.acc}
								disabled={!offline.online}
								onclick={() => (asking = c.which)}>{c.label}</button
							>
						{/each}
					{/snippet}
					<div
						class="row dl-row"
						class:solo={dl.cells.length === 0}
						class:ring={ring === 'download'}
					>
						<div class="label">DOWNLOAD</div>
						<div class="lk">
							<div class="lk-a">{dl.a}</div>
							<div class="lk-b">{dl.b}</div>
						</div>
						{#if dl.cells.length}<div class="lcs inline">{@render dlCells()}</div>{/if}
					</div>
					{#if dl.cells.length}<div class="lcs stack">{@render dlCells()}</div>{/if}
					<ConfirmSheet
						open={asking !== null}
						title={ask.title}
						lines={ask.lines}
						confirm={ask.confirm}
						action="?/addDownload"
						fields={{ which: asking ?? 'next' }}
						onclose={() => (asking = null)}
					/>

					{#if data.record}
						<div class="row record">
							<div class="label">RECORD</div>
							<div class="lk">
								<div class="lk-a">
									<span class="long">{recordLine(data.record, m.kind === 'anime')}</span>
									<span class="short">{recordLine(data.record, m.kind === 'anime', true)}</span>
								</div>
								<div class="lk-b">
									<span class="long">{keptLine(data.record, Date.now(), KEEP_DAYS)}</span>
									<span class="short">{keptLine(data.record, Date.now(), KEEP_DAYS, true)}</span>
								</div>
							</div>
							<form method="POST" action="?/forget" class="lc-form">
								<button type="submit" class="lc">FORGET</button>
							</form>
						</div>
					{/if}

					<div class="row link-row">
						<div class="label">SOURCE</div>
						<div class="lk">
							<div class="lk-a">{m.source}{m.lang ? ` · ${m.lang}` : ''}</div>
							{#if m.realUrl}<div class="lk-b">{host(m.realUrl)}</div>{/if}
						</div>
						{#if m.realUrl}
							<a class="lc" href={m.realUrl} target="_blank" rel="noopener noreferrer external"
								>OPEN ↗</a
							>
						{/if}
					</div>

					<div class="row top">
						<div class="label">TAGS</div>
						<div class="tags">
							{#if m.author}<div class="tag-line">
									<span class="ns">author</span><span>{m.author}</span>
								</div>{/if}
							{#if m.artist && m.artist !== m.author}<div class="tag-line">
									<span class="ns">artist</span><span>{m.artist}</span>
								</div>{/if}
							{#if m.genres.length}<div class="tag-line">
									<span class="ns">genre</span><span
										>{m.genres.map((g) => g.toLowerCase()).join(' · ')}</span
									>
								</div>{/if}
							<div class="more">FROM THE SOURCE</div>
						</div>
					</div>

					{#if m.description}
						<div class="row top">
							<div class="label">ABOUT</div>
							<div class="about">{m.description}</div>
						</div>
					{/if}
				</section>

				<section class="list" aria-label={anime ? 'Episodes' : 'Chapters'}>
					<div class="head">
						<span>01 — {anime ? 'EPISODES' : 'CHAPTERS'}</span><span class="n"
							>{count(m.chapters.length)}{anime
								? data.record
									? ` · ${data.record.read} WATCHED`
									: ' · EVERY ONE STREAMS'
								: data.record
									? ` · ${data.record.read} READ · ALL ONLINE`
									: ' · ALL ONLINE'}</span
						>
					</div>
					<!-- Every row opens without ADD (doc/BROWSING.md; c161, c166): one form, a
						     button per row, so it works without script. -->
					<form method="POST" action="?/open">
						<ol>
							{#each m.chapters as c (c.id)}
								{@const look = rowLook('states' in m ? m.states[c.id] : null, anime)}
								<li class="ch {look.kind}">
									<button
										class="open"
										name="ep"
										value={c.url}
										disabled={!offline.online}
										aria-label={`${anime ? 'Play' : 'Read'} ${c.name}`}
									>
										<span class="num">{c.number >= 0 ? formatNumber(c.number) : ''}</span>
										<span class="t">{c.name}</span>
										{#if look.status}<span class="go">{look.status}</span>{/if}
									</button>
									{#if look.kind === 'progress'}<span class="prog" style:width="{look.share * 100}%"
										></span>{/if}
								</li>
							{/each}
						</ol>
					</form>
				</section>
			</div>
		{/if}
	{:catch}
		<div class="asking">○ THE SOURCE DID NOT ANSWER · TRY AGAIN FROM THE SEARCH</div>
	{/await}
</div>

<style>
	.preview {
		--label-w: 120px;
		display: flex;
		flex-direction: column;
		min-height: calc(100dvh - var(--banner-h, 0px));
	}
	@media (max-width: 599px) {
		.preview {
			--label-w: 84px;
		}
	}
	.bar {
		display: flex;
		height: 72px;
		border-bottom: var(--hairline);
	}
	@media (max-width: 599px) {
		.bar {
			height: 60px;
		}
	}
	.back {
		display: flex;
		align-items: center;
		gap: 14px;
		padding: 0 var(--pad);
		border-right: var(--hairline);
		color: var(--text-1);
		font: 500 14px var(--font-mono);
		letter-spacing: 0.04em;
		text-decoration: none;
	}
	.arrow {
		font-size: 17px;
	}
	.asking {
		padding: 48px var(--pad);
		font: 500 13px var(--font-mono);
		letter-spacing: var(--tracking-label);
		color: var(--text-2);
	}
	.body {
		display: flex;
		flex-direction: column;
	}
	/* Landscape: the 440px panel beside the list, as the series screen. Both
	   columns run the row's height, so the rule between them reaches the list's
	   last episode, not the panel's last row (2026-10-29). */
	@media (min-width: 1024px) {
		.body {
			flex-direction: row;
			align-items: stretch;
		}
		.panel {
			width: 440px;
			flex-shrink: 0;
			border-right: var(--hairline);
		}
		.list {
			flex: 1;
		}
	}
	.identity {
		display: flex;
		gap: 24px;
		padding: 24px var(--pad);
	}
	.cover {
		flex-shrink: 0;
		width: 184px;
		aspect-ratio: 2 / 2.9;
	}
	@media (max-width: 599px) {
		.cover {
			width: 104px;
		}
	}
	@media (min-width: 1024px) {
		.cover {
			width: 132px;
		}
	}
	.names {
		min-width: 0;
		display: flex;
		flex-direction: column;
		gap: 10px;
	}
	.meta {
		font: 500 13px var(--font-mono);
		letter-spacing: var(--tracking-label);
		color: var(--text-2);
	}
	h1 {
		margin: 0;
		font: 500 28px/1.2 var(--font-sans);
		text-wrap: pretty;
	}
	@media (max-width: 599px) {
		h1 {
			font-size: 20px;
		}
	}
	@media (min-width: 1024px) {
		h1 {
			font-size: 22px;
		}
	}
	form {
		display: flex;
	}
	.cta {
		flex: 1;
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 12px;
		height: 64px;
		padding: 0 var(--pad);
		border: 0;
		border-radius: 0;
		background: var(--accent);
		color: var(--on-accent);
		font: 500 15px var(--font-mono);
		letter-spacing: 0.04em;
		cursor: pointer;
	}
	@media (max-width: 599px) {
		.cta {
			height: 56px;
		}
	}
	.cta:disabled {
		opacity: 0.6;
		cursor: default;
	}
	.short {
		display: none;
	}
	/* The phone, and the 440px landscape panel: the short count. */
	@media (max-width: 599px), (min-width: 1024px) {
		.long {
			display: none;
		}
		.short {
			display: inline;
		}
	}
	.cta > span {
		white-space: nowrap;
	}
	.row {
		display: flex;
		align-items: stretch;
		min-height: 60px;
		border-bottom: var(--hairline);
	}
	.link-row {
		min-height: 68px;
	}
	.label {
		display: flex;
		align-items: center;
		width: var(--label-w);
		flex-shrink: 0;
		box-sizing: border-box;
		padding-left: var(--pad);
		border-right: var(--hairline);
		font: 500 12px var(--font-mono);
		letter-spacing: var(--tracking-label);
		color: var(--text-2);
	}
	.row.top .label {
		align-items: flex-start;
		padding-top: 18px;
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
	}
	.lk-b {
		font: 400 13px/1.35 var(--font-mono);
		color: var(--text-2);
	}
	/* DOWNLOAD (card c205), as the series panel's: cells inline, dropping below
	   in equal columns on the phone and in the 440px landscape panel. */
	.dl-row {
		min-height: 68px;
	}
	.lcs {
		display: flex;
		--cell-pad: 20px;
	}
	.lcs.stack {
		display: none;
	}
	.lcs .lc {
		padding: 0 var(--cell-pad);
		border-radius: 0;
		font: 500 13px var(--font-mono);
	}
	.lc.acc {
		background: var(--accent);
		color: var(--on-accent);
	}
	.lc:disabled {
		opacity: 0.35;
		cursor: default;
	}
	@media (max-width: 599px), (min-width: 1024px) {
		.dl-row {
			border-bottom: 0;
		}
		.dl-row.solo {
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
	}
	/* Online Calls 1B: the RECORD row, 68px like SOURCE's, FORGET its cell. */
	.record {
		min-height: 68px;
	}
	.lc-form {
		display: flex;
	}
	button.lc {
		background: none;
		border: 0;
		border-left: var(--hairline);
		cursor: pointer;
	}
	/* The bar, for anime: ▶ in accent takes the width, + ADD beside it outlined. */
	.cta-bar {
		display: flex;
	}
	.cta-go {
		flex: 1;
		min-width: 0;
		display: flex;
	}
	.cta-go .cta {
		min-width: 0;
	}
	.add {
		height: 64px;
		padding: 0 var(--pad);
		border: 0;
		border-radius: 0;
		background: none;
		box-shadow: inset 0 0 0 1px var(--line-2);
		color: var(--text-1);
		font: 500 15px var(--font-mono);
		letter-spacing: 0.04em;
		white-space: nowrap;
		cursor: pointer;
	}
	@media (max-width: 599px) {
		.add {
			height: 56px;
		}
	}
	/* FIRST READ's next step (FirstRead boards 2): a 2px accent ring, inside. */
	.ring {
		box-shadow: inset 0 0 0 2px var(--accent);
	}
	.add:disabled {
		opacity: 0.6;
		cursor: default;
	}
	/* A record's rows: watched ones mute, the one in progress is a panel with its
	   share in accent along the bottom, as on a library series. */
	.ch {
		position: relative;
	}
	.ch.read .t,
	.ch.read .num {
		color: var(--text-2);
	}
	.ch.progress {
		background: var(--surface-panel);
	}
	.ch.progress .t {
		font-weight: 500;
	}
	.ch.progress .go {
		color: var(--accent);
	}
	.prog {
		position: absolute;
		left: 0;
		bottom: -1px;
		height: 3px;
		background: var(--accent);
		pointer-events: none;
	}
	.lc {
		display: flex;
		align-items: center;
		padding: 0 20px;
		border-left: var(--hairline);
		color: var(--text-1);
		font: 500 13px var(--font-mono);
		letter-spacing: 0.04em;
		text-decoration: none;
		white-space: nowrap;
	}
	.tags {
		flex: 1;
		min-width: 0;
		overflow-wrap: anywhere;
		display: flex;
		flex-direction: column;
		gap: 8px;
		padding: 14px;
	}
	.tag-line {
		display: flex;
		gap: 14px;
		font: 400 15px var(--font-sans);
	}
	.ns {
		width: 72px;
		flex-shrink: 0;
		font: 400 13px var(--font-mono);
		color: var(--text-2);
	}
	@media (max-width: 599px) {
		.ns {
			width: 56px;
		}
	}
	.more {
		font: 500 12px var(--font-mono);
		letter-spacing: 0.04em;
		color: var(--text-2);
	}
	.about {
		flex: 1;
		min-width: 0;
		overflow-wrap: anywhere;
		padding: 14px;
		font: 400 15px/1.5 var(--font-sans);
		color: var(--text-prose);
	}
	.head {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 14px;
		height: 52px;
		padding: 0 var(--pad);
		border-bottom: var(--hairline);
		font: 500 13px var(--font-mono);
		letter-spacing: var(--tracking-label);
		color: var(--text-2);
	}
	/* The list's form (one per page, so rows open without script) is a block: the
	   flex every other form here is shrank the rows to their longest title (2026-10-29). */
	.list > form {
		display: block;
	}
	ol {
		list-style: none;
		margin: 0;
		padding: 0;
	}
	.ch {
		display: flex;
		align-items: center;
		height: 60px;
		border-bottom: var(--hairline);
	}
	@media (max-width: 599px) {
		.ch {
			height: 52px;
		}
	}
	.open {
		all: unset;
		box-sizing: border-box;
		display: flex;
		align-items: center;
		width: 100%;
		height: 100%;
		cursor: pointer;
	}
	.open:hover .go,
	.open:focus-visible .go {
		color: var(--text);
	}
	.open:focus-visible {
		outline: 2px solid var(--accent);
		outline-offset: -2px;
	}
	.open:disabled {
		cursor: default;
		opacity: 0.4;
	}
	.go {
		flex-shrink: 0;
		padding-right: var(--pad);
		font: 500 12px var(--font-mono);
		letter-spacing: var(--tracking-label);
		color: var(--text-2);
	}
	.num {
		width: 80px;
		flex-shrink: 0;
		box-sizing: border-box;
		padding-left: var(--pad);
		font: 500 14px var(--font-mono);
		color: var(--text-2);
	}
	@media (max-width: 599px) {
		.num {
			width: 60px;
		}
	}
	.t {
		flex: 1;
		min-width: 0;
		padding-right: var(--pad);
		font: 400 16px var(--font-sans);
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}
</style>

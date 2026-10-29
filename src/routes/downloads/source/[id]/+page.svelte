<script lang="ts">
	import { resolve } from '$app/paths';
	import { enhance } from '$app/forms';
	import Band from '$lib/components/chrome/Band.svelte';
	import { formatNumber } from '$lib/library/series';
	import { count } from '$lib/library/downloads';
	import { coverPlaceholder } from '$lib/library/cover';
	import { offline } from '$lib/offline.svelte';

	/**
	 * A search result's preview (Download States 1e, state 7): the series
	 * screen's layout with what the source gave -- no rating, shelves or FILE
	 * -- and + ADD TO LIBRARY in CONTINUE's place. The chapters are listed,
	 * not openable. Nothing downloads from here: adding lands on the new
	 * series, with FIRST 10.
	 */
	let { data, form } = $props();
	let adding = $state(false);
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

	{#if refusal}<Band title={refusal} detail="NOTHING CHANGED" />{/if}

	{#await data.manga}
		<div class="asking">ASKING THE SOURCE…</div>
	{:then m}
		{#if !m}
			<div class="asking">THE SOURCE NO LONGER HAS IT</div>
		{:else}
			{@const meta = [m.source.toUpperCase(), STATUS[m.status]].filter(Boolean).join(' · ')}
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
						<button type="submit" class="cta" disabled={adding || !offline.online}>
							<span>{adding ? 'ADDING…' : '+ ADD TO LIBRARY'}</span>
							<span class="cta-meta">
								<span class="long"
									>{count(m.chapters.length)}
									{m.kind === 'anime' ? 'EPISODES · EVERY ONE STREAMS' : 'CHAPTERS'} · NOTHING DOWNLOADS
									UNTIL ASKED</span
								>
								<span class="short"
									>{count(m.chapters.length)} {m.kind === 'anime' ? 'EP.' : 'CH.'}</span
								>
							</span>
						</button>
					</form>

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

				<section class="list" aria-label={m.kind === 'anime' ? 'Episodes' : 'Chapters'}>
					<div class="head">
						<span>01 — {m.kind === 'anime' ? 'EPISODES' : 'CHAPTERS'}</span><span class="n"
							>{count(m.chapters.length)}</span
						>
					</div>
					<ol>
						{#each m.chapters as c (c.id)}
							<li class="ch">
								<span class="num">{c.number >= 0 ? formatNumber(c.number) : ''}</span>
								<span class="t">{c.name}</span>
							</li>
						{/each}
					</ol>
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
	/* Landscape: the 440px panel beside the list, as the series screen. */
	@media (min-width: 1024px) {
		.body {
			flex-direction: row;
			align-items: flex-start;
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
		gap: 14px;
		height: 52px;
		padding: 0 var(--pad);
		border-bottom: var(--hairline);
		font: 500 13px var(--font-mono);
		letter-spacing: var(--tracking-label);
		color: var(--text-2);
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

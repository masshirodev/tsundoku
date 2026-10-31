<script lang="ts">
	import { enhance } from '$app/forms';
	import { resolve } from '$app/paths';
	import { m } from '$lib/paraglide/messages';
	import { num } from '$lib/i18n/format';

	/**
	 * The first day (doc/ONBOARDING.md; the Getting Started handoff, board 3):
	 * an empty library whose checklist is done or skipped. Nothing is added yet,
	 * but everything is one search away: the sources' search, the sources
	 * themselves, and the library folder for files.
	 */
	let {
		sources,
		libraryRoot,
		scanMessage
	}: {
		sources: { id: string; label: string; kind: 'manga' | 'anime' | 'novel'; lang: string }[];
		libraryRoot: string;
		scanMessage: string;
	} = $props();
	const KIND = {
		manga: m.first_kind_manga,
		anime: m.first_kind_anime,
		novel: m.first_kind_novel
	} as const;
	const n = $derived(sources.length);
</script>

<section class="ob" aria-label={m.first_section_label()}>
	<div class="ob-head">
		<div class="k">{m.first_head()}</div>
		<div class="k">{n ? m.first_sources({ count: n, n: num(n) }) : m.first_no_sources()}</div>
	</div>
	{#if n}
		<h1>{m.first_title()}</h1>
		<p class="lede">{m.first_lede()}</p>
		<form method="GET" action={resolve('/downloads/search')} class="box">
			<input
				class="in"
				name="q"
				type="search"
				required
				placeholder={m.first_search_placeholder({ count: n, n: num(n) })}
				aria-label={m.first_search_label()}
			/>
			<button type="submit" class="b">{m.first_search()}</button>
		</form>

		<div class="lab">
			<span>{m.first_your_sources()}</span>
			<a class="r" href="{resolve('/browse/extensions')}?tab=installed"
				>{m.start_done_link_repo()}</a
			>
		</div>
		<div class="rows">
			{#each sources as s (s.id)}
				<a class="row" href={resolve('/browse/[source]', { source: s.id })}>
					<span class="tx">
						<span class="a">{s.label}</span>
						<span class="b">{KIND[s.kind]()} · {s.lang.toUpperCase()}</span>
					</span>
					<span class="ac">{m.first_browse()}</span>
				</a>
			{/each}
		</div>
	{:else}
		<h1>{m.first_empty_title()}</h1>
		<p class="lede">{m.first_empty_lede()}</p>
	{/if}

	<div class="lab">
		<span>{m.first_from_files({ n: n ? '02' : '01' })}</span><span class="r"
			>{m.first_files_kinds()}</span
		>
	</div>
	<div class="rows">
		<div class="row">
			<span class="tx">
				<span class="b">{m.start_library_folder()}</span>
				<span class="a path" title={libraryRoot}>{libraryRoot}</span>
			</span>
			<form method="POST" action="?/scan" use:enhance class="scan">
				<button type="submit" class="ac">{m.start_scan()}</button>
			</form>
		</div>
	</div>
	{#if scanMessage}<div class="scan-message">{scanMessage}</div>{/if}
</section>

<style>
	/* ob.css .ob and the rows (board 3), transcribed; colours are tokens. */
	.ob {
		display: flex;
		flex-direction: column;
		max-width: 980px;
		padding: 44px 64px 56px;
	}
	.ob-head {
		display: flex;
		justify-content: space-between;
		align-items: baseline;
		gap: 12px;
		margin-bottom: 18px;
	}
	.k {
		font: 500 12px/1.2 var(--font-mono);
		letter-spacing: 0.06em;
		color: var(--text-2);
	}
	h1 {
		margin: 0;
		font: 500 34px/1.2 var(--font-sans);
	}
	.lede {
		margin: 14px 0 0;
		max-width: 680px;
		font: 400 18px/1.5 var(--font-sans);
		color: var(--text-2);
		text-wrap: pretty;
	}
	.box {
		display: flex;
		height: 60px;
		margin-top: 28px;
		border: 1px solid var(--text-1);
	}
	.box .in {
		flex: 1;
		min-width: 0;
		padding: 0 16px;
		border: 0;
		border-radius: 0;
		background: transparent;
		color: var(--text-1);
		font: 400 16px var(--font-mono);
		outline: none;
	}
	.box .in::placeholder {
		color: var(--text-2);
	}
	.box .b {
		padding: 0 22px;
		border: 0;
		border-left: 1px solid var(--text-1);
		border-radius: 0;
		background: var(--accent);
		color: var(--on-accent);
		font: 500 14px var(--font-mono);
		cursor: pointer;
	}
	.lab {
		display: flex;
		justify-content: space-between;
		gap: 12px;
		padding: 36px 0 12px;
		font: 500 13px/1.2 var(--font-mono);
		letter-spacing: 0.06em;
		color: var(--text-2);
	}
	.lab .r {
		white-space: nowrap;
		color: var(--text-2);
		text-decoration: none;
	}
	.rows {
		border-top: var(--hairline);
	}
	.row {
		display: flex;
		align-items: stretch;
		min-height: 68px;
		border-bottom: var(--hairline);
		color: var(--text-1);
		text-decoration: none;
	}
	.tx {
		flex: 1;
		min-width: 0;
		display: flex;
		flex-direction: column;
		justify-content: center;
		gap: 5px;
	}
	.tx .a {
		font: 500 16px var(--font-sans);
	}
	.tx .a.path {
		font: 500 15px var(--font-mono);
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.tx .b {
		font: 400 13px var(--font-mono);
		color: var(--text-2);
	}
	.ac {
		display: flex;
		align-items: center;
		padding: 0 24px;
		border: 0;
		border-left: var(--hairline);
		border-radius: 0;
		background: none;
		color: var(--accent);
		font: 500 14px var(--font-mono);
		white-space: nowrap;
		cursor: pointer;
	}
	.scan {
		display: flex;
	}
	.scan .ac {
		color: var(--text-1);
	}
	.scan-message {
		padding-top: 12px;
		font: 400 13px var(--font-mono);
		color: var(--text-2);
	}
	@media (max-width: 599px) {
		.ob {
			padding: 24px 16px 32px;
		}
		h1 {
			font-size: 26px;
		}
		.lede {
			font-size: 16px;
		}
		.ac {
			padding: 0 14px;
		}
	}
</style>

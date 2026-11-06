<script lang="ts">
	import StartTrail from '$lib/components/start/StartTrail.svelte';
	import { resolve } from '$app/paths';
	import TopBar from '$lib/components/chrome/TopBar.svelte';
	import SourceRow from './SourceRow.svelte';
	import ConcealBand from './ConcealBand.svelte';
	import AddedBand from './AddedBand.svelte';
	import { ago } from '$lib/library/tracking';
	import { count } from '$lib/library/downloads';

	/**
	 * BROWSE (Index-Browse: sources, revealOff, revealOn; Browse Calls, "Browse
	 * is a place; extensions is its back room" and "One list, the kinds as
	 * sections"). RECENT (the last four browsed, any kind), then MANGA, ANIME
	 * and NOVELS, each source a row that opens its page. The bar carries
	 * EXTENSIONS, counting updates, as QUEUE counts chapters.
	 *
	 * Hidden means hidden: a mostly-hidden source is only here inside reveal,
	 * marked HIDDEN on its icon, and every count is what reveal lets you see.
	 */
	let { data, form } = $props();
	const list = $derived(data.list);

	type Row = (typeof data.list.manga)[number];
	const here = (r: Row) => {
		if (r.series === 0) return '';
		const n = `${count(r.series)} SERIES HERE`;
		if (r.hidden === 0) return n;
		return r.hidden === r.series ? `${n}, ALL HIDDEN` : `${n}, ${count(r.hidden)} HIDDEN`;
	};
	const meta = (r: Row) =>
		[r.lang.toUpperCase(), here(r), r.check && "FIRST VISIT WAITS FOR THE SITE'S CHECK"]
			.filter(Boolean)
			.join(' · ');
	const recentMeta = (r: Row) =>
		[
			r.kind.toUpperCase(),
			r.lang.toUpperCase(),
			r.browsedAt && `BROWSED ${ago(r.browsedAt, data.now)}`
		]
			.filter(Boolean)
			.join(' · ');

	const plural = (n: number, w: string) => `${count(n)} ${w}${n === 1 ? '' : 'S'}`;
	const sections = $derived(
		[
			{ title: 'MANGA', rows: list.manga },
			{ title: 'ANIME', rows: list.anime },
			{ title: 'NOVELS', rows: list.novels }
		]
			.filter((s) => s.rows.length > 0)
			.map((s) => {
				const ext = new Set(s.rows.map((r) => r.pkg)).size;
				// "8 SOURCES · 7 EXTENSIONS" where they differ; one number where they don't.
				const right =
					ext === s.rows.length
						? count(s.rows.length)
						: `${plural(s.rows.length, 'SOURCE')} · ${plural(ext, 'EXTENSION')}`;
				return { ...s, right };
			})
	);
	const total = $derived(list.manga.length + list.anime.length + list.novels.length);
	const pad = (n: number) => String(n).padStart(2, '0');
	const extensionsHref = resolve('/browse/extensions');
</script>

<svelte:head><title>browse · tsundoku</title></svelte:head>

<div class="screen">
	<TopBar sticky label="BROWSE">
		{#snippet middle()}
			<a class="cell back" href={resolve('/')} aria-label="Back to the library">←</a>
			<span class="cell title">BROWSE</span>
			<a class="cell hint" href={resolve('/downloads/search')}>/ search every source</a>
			<a class="cell ext" href={extensionsHref}>
				<span class="top">EXTENSIONS</span>
				<span
					>{list.updates
						? `${count(list.updates)} UPDATE${list.updates === 1 ? '' : 'S'}`
						: 'MANAGE'}</span
				>
			</a>
		{/snippet}
	</TopBar>
	<!-- The way back to GET STARTED, while FIRST READ's trip lasts (doc/ONBOARDING.md). -->
	<StartTrail start={data.start} />
	<!-- CONCEAL ITS SERIES outside reveal (card c523): its source is mostly
	     hidden now, so the band is here, and names no source. -->
	{#if data.concealed}
		<ConcealBand band={data.concealed} name={null} undo="?/undoConceal" />
	{/if}
	<!-- ADD outside reveal that left its source mostly hidden (card c505): the
	     source's page is not found, so the band is here. Outside reveal it
	     names no source; inside reveal it is here and does (c605). -->
	{#if data.added}
		<AddedBand
			band={data.added}
			name={data.added.sourceName}
			reveal={data.reveal}
			undo="?/undoAdd"
			refusal={form && 'added' in form ? (form.added ?? null) : data.refused}
		/>
	{/if}

	{#if total === 0}
		<!-- The first run (Index-Browse, first; Browse Calls, "No repository ships"). -->
		<div class="empty">
			<div class="lab">00 — NO SOURCES YET</div>
			<div class="h">Nothing to browse yet.</div>
			<p>
				Sources come from extension repositories, and tsundoku ships none. Paste the address of a
				repository you trust: it says what it holds before anything is installed.
			</p>
		</div>
		<form method="GET" action={extensionsHref} class="field">
			<input type="hidden" name="tab" value="repos" />
			<label for="repo-address">REPOSITORY ADDRESS</label>
			<div class="box">
				<input
					id="repo-address"
					name="add"
					placeholder="https://…/index.min.json"
					autocomplete="off"
					inputmode="url"
					required
				/>
				<button type="submit">ADD</button>
			</div>
		</form>
		<div class="label first"><span>WHAT A REPOSITORY HOLDS</span><span></span></div>
		<div class="holds">
			<div class="hold"><span>MANGA, MANHWA, DOUJINSHI</span><span>A MIHON REPOSITORY</span></div>
			<div class="hold"><span>ANIME</span><span>AN ANIYOMI REPOSITORY</span></div>
			<div class="hold">
				<span>NOVELS</span><span>AN LNREADER PLUGIN REPOSITORY · NOT YET</span>
			</div>
		</div>
		<p class="prose">
			The library, its search and every series still open without one. A series' DOWNLOAD row
			appears once its source is installed.
		</p>
	{:else}
		{#if list.recent.length}
			<div class="label first"><span>01 — RECENT</span><span>LAST BROWSED</span></div>
			<div class="rows">
				{#each list.recent as r (r.id)}<SourceRow {r} meta={recentMeta(r)} />{/each}
			</div>
		{/if}
		{#each sections as s, i (s.title)}
			<div class="label" class:first={i === 0 && !list.recent.length}>
				<span>{pad(i + (list.recent.length ? 2 : 1))} — {s.title}</span>
				<span>{s.right}</span>
			</div>
			<div class="rows">
				{#each s.rows as r (r.id)}<SourceRow {r} meta={meta(r)} />{/each}
			</div>
		{/each}
	{/if}
</div>

<style>
	/* Index-Browse, sources, transcribed: the mock's literals; colours are tokens. */
	.screen {
		display: flex;
		flex-direction: column;
		min-height: 100dvh;
	}
	.cell {
		display: flex;
		flex-direction: column;
		justify-content: center;
		/* TopBar centres what it holds; the mock's cells stretch, their text at the left. */
		align-items: stretch;
		gap: 4px;
		height: 100%;
		padding: 0 var(--pad);
		font: 500 14px/1.2 var(--font-mono);
		color: var(--text-1);
		text-decoration: none;
		white-space: nowrap;
	}
	.cell + .cell {
		border-left: var(--hairline);
	}
	.back {
		font: 500 16px/1 var(--font-mono);
	}
	.title {
		font: 500 16px/1.2 var(--font-mono);
	}
	.hint {
		flex: 1 1 auto;
		min-width: 0;
		padding: 0 18px;
		font: 400 16px/1.2 var(--font-mono);
		color: var(--text-2);
	}
	.top {
		font: 500 11px/1 var(--font-mono);
		letter-spacing: 0.06em;
		color: var(--text-2);
	}
	.label {
		flex-shrink: 0;
		display: flex;
		justify-content: space-between;
		gap: 12px;
		padding: 24px var(--pad) 12px;
		font: 500 13px/1.2 var(--font-mono);
		letter-spacing: 0.06em;
		color: var(--text-2);
	}
	.label.first {
		padding-top: 18px;
	}
	.label span:first-child {
		flex-shrink: 0;
		white-space: nowrap;
	}
	.label span:last-child {
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.rows {
		flex-shrink: 0;
		display: flex;
		flex-direction: column;
		border-top: var(--hairline);
	}
	.empty {
		display: flex;
		flex-direction: column;
		gap: 18px;
		max-width: 640px;
		padding: 56px var(--pad) 28px;
	}
	.lab {
		font: 500 13px var(--font-mono);
		letter-spacing: 0.06em;
		color: var(--text-2);
	}
	.h {
		font: 500 28px/1.25 var(--font-sans);
	}
	.empty p {
		margin: 0;
		font: 400 17px/1.5 var(--font-sans);
		color: var(--text-prose);
		text-wrap: pretty;
	}
	.field {
		display: flex;
		flex-direction: column;
		gap: 8px;
		padding: 0 var(--pad) 28px;
	}
	.field label {
		font: 500 12px var(--font-mono);
		letter-spacing: 0.06em;
		color: var(--text-2);
	}
	.box {
		display: flex;
		align-items: stretch;
		min-height: 56px;
		border: 1px solid var(--line-2);
	}
	.box input {
		flex: 1;
		min-width: 0;
		padding: 0 16px;
		border: 0;
		background: transparent;
		color: var(--text-1);
		font: 500 15px var(--font-mono);
		outline: none;
	}
	.box button {
		padding: 0 24px;
		border: 0;
		border-left: 1px solid var(--line-2);
		border-radius: 0;
		background: transparent;
		color: var(--text-1);
		font: 500 14px var(--font-mono);
		cursor: pointer;
	}
	.box:has(input:placeholder-shown) button {
		opacity: 0.4;
	}
	.holds {
		border-top: var(--hairline);
	}
	.hold {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 12px;
		min-height: 56px;
		padding: 0 var(--pad);
		border-bottom: var(--hairline);
		font: 400 13px var(--font-mono);
		letter-spacing: 0.04em;
	}
	.hold span:last-child {
		color: var(--text-2);
		text-align: right;
	}
	.prose {
		margin: 0;
		padding: 20px var(--pad);
		font: 400 15px/1.5 var(--font-sans);
		color: var(--text-prose);
		text-wrap: pretty;
	}

	/* The phone: no room for the hint; BROWSE takes the space. */
	@media (max-width: 599px) {
		.hint {
			display: none;
		}
		.title {
			flex: 1 1 auto;
		}
	}
</style>

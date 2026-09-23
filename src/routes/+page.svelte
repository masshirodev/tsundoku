<script lang="ts">
	import { enhance } from '$app/forms';
	import { goto, invalidateAll } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { SvelteSet } from 'svelte/reactivity';
	import { page } from '$app/state';
	import Banner from '$lib/components/chrome/Banner.svelte';
	import BulkBar from '$lib/components/chrome/BulkBar.svelte';
	import SectionLabel from '$lib/components/chrome/SectionLabel.svelte';
	import TopBar from '$lib/components/chrome/TopBar.svelte';
	import Wordmark from '$lib/components/chrome/Wordmark.svelte';
	import ContinueRow from '$lib/components/content/ContinueRow.svelte';
	import CoverTile from '$lib/components/content/CoverTile.svelte';
	import Button from '$lib/components/controls/Button.svelte';
	import ShelfTabs from '$lib/components/controls/ShelfTabs.svelte';
	import SeriesSheet from './SeriesSheet.svelte';
	import ShelfPicker from './ShelfPicker.svelte';
	import PersonView from './PersonView.svelte';
	import GroupSheet from './GroupSheet.svelte';
	import TagChip from '$lib/components/controls/TagChip.svelte';
	import { tagHref } from '$lib/library/links';
	import { hueFor } from '$lib/library/cover';
	import { desktop, phone, wide } from '$lib/device.svelte';
	import { offline } from '$lib/offline.svelte';
	import { continueSub, count, nextSort, progress, SORT_LABEL } from '$lib/library/labels';
	import { seriesHref, shelfHref, withParam } from '$lib/library/links';
	import type { Shelf } from '$lib/library/types';

	let { data, form } = $props();

	const scanning = $derived(data.scan !== null && data.scan.finishedAt === null);
	const justImported = $derived(data.scan !== null && data.scan.finishedAt !== null);
	const isOffline = $derived(!offline.online);

	// ---- selection -------------------------------------------------------
	let selecting = $state(false);
	const selected = new SvelteSet<number>();

	function toggle(id: number) {
		if (selected.has(id)) selected.delete(id);
		else selected.add(id);
	}

	function stopSelecting() {
		selecting = false;
		selected.clear();
	}

	// ---- sheets ------------------------------------------------------------
	let sheetId = $state<number | null>(null);
	let pickerOpen = $state(false);
	let grouping = $state(false);

	/**
	 * The books GROUP would take: selected doujin singletons, from the library
	 * grid or a person page. GROUP is offered only when every selected item is
	 * one -- a manga or a series of books can't be grouped.
	 */
	const groupBooks = $derived.by(() => {
		const out: { seriesId: number; title: string; hue: number; addedAt: number }[] = [];
		const pool = data.person
			? data.person.items
					.filter((i) => i.groupable)
					.map((i) => ({
						id: i.seriesId,
						title: i.title,
						hue: hueFor(i.title),
						addedAt: i.addedAt
					}))
			: data.series
					.filter((c) => c.kind === 'doujin' && c.entryCount === 1)
					.map((c) => ({ id: c.id, title: c.title, hue: c.hue, addedAt: c.addedAt }));
		for (const b of pool) if (selected.has(b.id)) out.push({ seriesId: b.id, ...b });
		return out;
	});
	const canGroup = $derived(selected.size > 0 && groupBooks.length === selected.size);

	/** A tap opens the series; a long press opens the sheet (see CoverTile). */
	function press(id: number) {
		if (selecting) toggle(id);
		// eslint-disable-next-line svelte/no-navigation-without-resolve -- seriesHref() resolves
		else void goto(seriesHref(id, data.tag ? null : data.shelf));
	}

	// ---- derived view ------------------------------------------------------
	// Layout is decided by CSS (src/lib/styles/layout.css), so the server's
	// first paint is already right for the device. Script only needs the column
	// count to pad the last row, which is cosmetic and can wait for hydration.
	const columns = $derived(phone.current ? 3 : desktop.current ? 8 : wide.current ? 9 : 6);
	const contShown = $derived(data.cont.items.slice(0, 4));
	const showContinue = $derived(contShown.length > 0 && !scanning && !justImported);

	const cachedCount = (id: number) => offline.cached[id] ?? 0;

	const tabs = $derived.by((): Shelf[] => {
		if (!isOffline) return data.shelves;
		const cached: Shelf = {
			key: 'cached',
			name: 'Cached',
			kind: 'smart',
			count: Object.keys(offline.cached).length
		};
		return [cached, ...data.shelves.filter((s) => s.key !== 'new')];
	});

	const activeShelf = $derived(data.tag ? '' : data.shelf);

	const sectionText = $derived.by(() => {
		if (data.tag) {
			const [ns, value] = data.tag.includes(':') ? data.tag.split(':', 2) : ['', data.tag];
			return ns ? `${ns} · ${value}` : value;
		}
		if (scanning) return 'Arriving';
		if (isOffline) return 'On this device';
		if (justImported && data.shelf === 'new') return 'Just imported';
		return 'Shelves';
	});

	/**
	 * CACHED is a device shelf: only the tablet knows what it holds, so the
	 * server lists everything and this narrows it.
	 */
	const shown = $derived(
		data.shelf === 'cached' ? data.series.filter((s) => cachedCount(s.id) > 0) : data.series
	);

	/** Fill the last grid row, so the hairline ground never shows as a block. */
	const fillers = $derived((columns - (shown.length % columns)) % columns);

	const gb = (bytes: number) => (bytes / 1e9).toFixed(1).replace(/\.0$/, '');

	function sortNext() {
		// eslint-disable-next-line svelte/no-navigation-without-resolve -- withParam() resolves
		void goto(withParam(page.url, 'sort', nextSort(data.sort)), {
			noScroll: true,
			keepFocus: true
		});
	}
</script>

<svelte:head><title>tsundoku</title></svelte:head>

<div class="library" class:selecting>
	{#if selecting}
		<TopBar inverse label="Selection">
			{#snippet left()}
				<button type="button" class="cell-btn x" aria-label="Stop selecting" onclick={stopSelecting}
					>✕</button
				>
			{/snippet}
			{#snippet middle()}
				<div class="selected-count" aria-live="polite">{selected.size} SELECTED</div>
			{/snippet}
			{#snippet right()}
				<button
					type="button"
					class="cell-btn"
					onclick={() => shown.forEach((s) => selected.add(s.id))}>SELECT ALL</button
				>
			{/snippet}
		</TopBar>
	{:else if data.person}
		<TopBar label="Library">
			{#snippet left()}
				<a class="cell-btn back" href={resolve('/')} aria-label="Back to library">←</a>
			{/snippet}
			{#snippet middle()}
				<div class="tag-title">
					<span class="ns">{data.person?.namespace || 'tag'}</span><span>{data.person?.value}</span>
				</div>
			{/snippet}
			{#snippet right()}
				<button type="button" class="cell-btn" onclick={() => (selecting = true)}>SELECT</button>
			{/snippet}
		</TopBar>
	{:else}
		<TopBar label="Library">
			{#snippet left()}
				<div class="brand"><Wordmark /></div>
			{/snippet}
			{#snippet middle()}
				<a class="search-hint" href={resolve('/search')}
					><span class="short">/ search</span><span class="long">/ search title, tag, artist</span
					></a
				>
			{/snippet}
			{#snippet right()}
				<button
					type="button"
					class="cell-btn"
					onclick={() => (selecting = true)}
					disabled={data.empty}>SELECT</button
				>
			{/snippet}
		</TopBar>
	{/if}

	{#if data.scan && scanning}
		<Banner
			kind="progress"
			title="SCANNING ON WORKSTATION"
			detail="{gb(data.scan.bytesDone)} / {gb(data.scan.bytesTotal)} GB"
			progress={data.scan.bytesTotal > 0 ? data.scan.bytesDone / data.scan.bytesTotal : 0}
			meta="{count(data.scan.seriesFound)} SERIES SO FAR"
			metaRight={data.scan.sourceLabel
				? `${data.scan.sourceLabel.toUpperCase()} · ${data.scan.step} OF ${data.scan.steps}`
				: undefined}
		/>
	{:else if data.scan && justImported}
		<Banner
			kind="action"
			title="IMPORT FINISHED · {count(data.scan.seriesFound)} SERIES"
			detail={data.scan.failedFiles > 0
				? `${count(data.scan.failedFiles)} FILES FAILED · SEE LOG`
				: undefined}
		>
			{#snippet action()}
				<form method="POST" action="?/dismissScan" use:enhance>
					<input type="hidden" name="scan" value={data.scan?.id} />
					<button type="submit">TIDY NEW →</button>
				</form>
			{/snippet}
		</Banner>
	{/if}

	{#if isOffline}
		<Banner kind="info" title="○ OFFLINE" detail="CACHED STILL OPENS" />
	{/if}

	{#if data.empty}
		<section class="empty">
			<div class="empty-label">00 — LIBRARY EMPTY</div>
			<h1>Nothing imported yet.</h1>
			<p>
				Imports run on the workstation. Put files in the library folder, then start a scan. Series
				appear here as they are found.
			</p>
			<div class="sources">
				<div><span>Mihon backup (.tachibk)</span><span class="dim">manga, manhwa</span></div>
				<div><span>Hentoid folder</span><span class="dim">doujin → hidden</span></div>
				<div><span>EPUB</span><span class="dim">novels</span></div>
			</div>
			<div class="folder">
				<div class="folder-label">LIBRARY FOLDER</div>
				<div class="folder-path">{data.libraryRoot}</div>
			</div>
			<form method="POST" action="?/scan" use:enhance class="scan-form">
				<Button variant="primary" size="lg" type="submit">START SCAN</Button>
				{#if form && 'scanMessage' in form}<div class="scan-message">{form.scanMessage}</div>{/if}
			</form>
		</section>
	{:else if data.person}
		<PersonView
			page={data.person}
			{selecting}
			{selected}
			onselect={(i) =>
				selected.has(i.seriesId) ? selected.delete(i.seriesId) : selected.add(i.seriesId)}
		/>
	{:else}
		{#if showContinue}
			<div class="cont-section">
				<SectionLabel index={1} text="Continue" top={18}>
					{#snippet right()}
						{#if isOffline}
							{contShown.filter((c) => cachedCount(c.id) > 0).length} OF {contShown.length} CACHED
						{:else}
							<!-- History is CONTINUE going further back (Index Addendum). -->
							<a class="to-history" href={resolve('/history')}
								>{count(data.cont.total)} OPEN · HISTORY →</a
							>
						{/if}
					{/snippet}
				</SectionLabel>
				<div class="cont">
					{#each contShown as item (item.id)}
						{@const cached = cachedCount(item.id) > 0}
						<ContinueRow
							title={item.title}
							meta={continueSub(item, isOffline ? { cached } : undefined)}
							progress={progress(item)}
							hue={item.hue}
							unavailable={isOffline && !cached}
						/>
					{/each}
				</div>
			</div>
		{/if}

		<SectionLabel index={2} text={sectionText}>
			{#snippet right()}
				{#if selecting}
					TAP TO ADD
				{:else if scanning}
					NEWEST FIRST
				{:else}
					<button type="button" onclick={sortNext} aria-label="Change sort"
						>{SORT_LABEL[data.sort]}</button
					>
				{/if}
			{/snippet}
		</SectionLabel>

		<div class="tabs">
			<ShelfTabs shelves={tabs} active={activeShelf} href={(k) => shelfHref(page.url, k)} />
		</div>

		{#if data.shelf !== 'people'}
			<div class="grid">
				{#each shown as s (s.id)}
					{@const cached = cachedCount(s.id)}
					<CoverTile
						title={s.title}
						hue={s.hue}
						rating={s.rating}
						favourite={s.favourite}
						newCount={s.newCount}
						hidden={s.hidden}
						indexing={!s.indexed}
						cached={isOffline && cached > 0 ? cached : null}
						dimmed={isOffline && cached === 0}
						selectable={selecting}
						selected={selected.has(s.id)}
						onpress={() => press(s.id)}
						onlongpress={() => (selecting ? toggle(s.id) : (sheetId = s.id))}
					/>
				{/each}
				{#each { length: fillers }, i (i)}
					<div class="filler" aria-hidden="true"></div>
				{/each}
			</div>
		{/if}

		{#if data.shelf === 'people'}
			<!-- The PEOPLE shelf: favourite people, each opening their page. -->
			<div class="people">
				{#each data.people as p (p.namespace + ':' + p.value)}
					<TagChip
						namespace={p.namespace}
						value={p.value}
						count={p.count}
						href={tagHref(`${p.namespace}:${p.value}`)}
					/>
				{/each}
			</div>
			{#if data.people.length === 0}
				<p class="none">NO FAVOURITE PEOPLE · FAV ONE FROM THEIR PAGE</p>
			{/if}
		{:else if shown.length === 0}
			<p class="none">NOTHING ON THIS SHELF</p>
		{/if}
	{/if}
</div>

{#if selecting}
	<form
		method="POST"
		action="?/bulk"
		use:enhance={() =>
			async ({ update }) => {
				await update({ reset: false });
			}}
	>
		{#each [...selected] as id (id)}<input type="hidden" name="id" value={id} />{/each}
		<BulkBar columns={5}>
			{#snippet actions()}
				<button type="submit" name="do" value="fav" disabled={selected.size === 0}>FAV</button>
				<button type="button" disabled={selected.size === 0} onclick={() => (pickerOpen = true)}
					>+ SHELF</button
				>
				<!-- No tag editor is designed yet; see doc/LIBRARY.md. -->
				<button type="button" disabled>TAG</button>
				<!-- Index Books: GROUP, for singles only. -->
				<button type="button" class="group" disabled={!canGroup} onclick={() => (grouping = true)}
					>GROUP</button
				>
				<button type="submit" name="do" value="hide" disabled={selected.size === 0}>HIDE</button>
			{/snippet}
		</BulkBar>
	</form>
{/if}

<SeriesSheet
	id={sheetId}
	shelves={data.shelves}
	onclose={() => (sheetId = null)}
	onchange={() => invalidateAll()}
/>

<GroupSheet
	open={grouping}
	books={groupBooks}
	existing={data.existing}
	onclose={() => (grouping = false)}
/>

<ShelfPicker
	open={pickerOpen}
	ids={[...selected]}
	shelves={data.shelves}
	onclose={() => (pickerOpen = false)}
/>

<style>
	.tag-title {
		flex: 1;
		gap: 10px;
		padding: 0 18px;
		font: 500 16px var(--font-mono);
		white-space: nowrap;
		overflow: hidden;
	}
	.tag-title .ns {
		color: var(--text-2);
	}
	.back {
		font: 500 16px var(--font-mono);
	}
	.people {
		display: flex;
		flex-wrap: wrap;
		gap: 8px;
		padding: 18px var(--pad);
	}
	.library {
		display: flex;
		flex-direction: column;
		flex: 1;
	}
	/* Room for the pinned bulk bar: two 60px rows and the rule above them. */
	.library.selecting {
		padding-bottom: 122px;
	}
	.brand {
		padding: 0 var(--pad);
	}
	.search-hint .long,
	.search-hint .short {
		display: none;
	}
	.cont-section {
		display: contents;
	}
	.to-history {
		color: inherit;
		text-decoration: none;
	}
	.to-history:active {
		color: var(--text-1);
	}
	/* Phone: the Japanese wordmark, four continue rows and the long search hint
	   do not fit, and multi-select needs the room the continue shelf takes. */
	@media (max-width: 599px) {
		.brand :global(.jp) {
			display: none;
		}
		.search-hint .short {
			display: inline;
		}
		.cont > :global(:nth-child(n + 3)) {
			display: none;
		}
		.selecting .cont-section {
			display: none;
		}
	}
	@media (min-width: 600px) {
		.search-hint .long {
			display: inline;
		}
	}
	/* Desktop: the wordmark and the shelves move into the sidebar. */
	@media (min-width: 1024px) and (pointer: fine) {
		.library :global(header .left:has(.brand)),
		.tabs {
			display: none;
		}
	}
	.search-hint {
		flex: 1;
		padding: 0 18px;
		font: 400 16px var(--font-mono);
		color: var(--text-2);
		white-space: nowrap;
		overflow: hidden;
	}
	.search-hint:hover {
		color: var(--text-1);
	}
	.cell-btn {
		padding: 0 var(--pad);
		border: 0;
		border-radius: 0;
		background: transparent;
		color: inherit;
		font: var(--type-control);
		cursor: pointer;
		white-space: nowrap;
	}
	.cell-btn:active:not(:disabled) {
		background: var(--surface-inverse);
		color: var(--text-inverse);
	}
	.cell-btn:disabled {
		opacity: 0.4;
		cursor: default;
	}
	.x {
		font: 500 18px var(--font-mono);
	}
	.selected-count {
		padding: 0 18px;
		font: 500 17px var(--font-mono);
	}
	.cont {
		flex-shrink: 0;
		display: grid;
		grid-template-columns: repeat(var(--cont-cols), minmax(0, 1fr));
		border-top: var(--hairline);
	}
	/* Two columns: the left one of each pair draws the divider. */
	@media (min-width: 1024px) {
		.cont > :global(:nth-child(odd)) {
			border-right-color: var(--line-1);
		}
	}
	.grid {
		display: grid;
		grid-template-columns: repeat(var(--grid-cols), minmax(0, 1fr));
		gap: 1px;
		background: var(--line-1);
		/* Both rules, as the mock draws them: under the tabs this doubles the
		   tabs' own bottom hairline, which is how Index Library.dc.html has it. */
		border-top: var(--hairline);
		border-bottom: var(--hairline);
	}
	.filler {
		background: var(--surface-page);
	}
	.none {
		margin: 0;
		padding: 24px var(--pad);
		font: var(--type-label);
		letter-spacing: var(--tracking-label);
		color: var(--text-2);
	}

	/* ---- empty ---- */
	.empty {
		flex: 1;
		display: flex;
		flex-direction: column;
		justify-content: center;
		gap: 28px;
		padding: 0 64px;
		max-width: 720px;
	}
	@media (max-width: 599px) {
		.empty {
			padding: 0 24px;
		}
	}
	.empty-label {
		font: var(--type-label);
		color: var(--text-2);
		letter-spacing: var(--tracking-label);
	}
	.empty h1 {
		margin: 0;
		font: var(--type-title-lg);
		text-wrap: pretty;
	}
	.empty p {
		margin: 0;
		font: var(--type-body);
		color: var(--text-2);
		text-wrap: pretty;
	}
	.sources {
		display: flex;
		flex-direction: column;
		border-top: var(--hairline);
	}
	.sources > div {
		display: flex;
		justify-content: space-between;
		gap: 12px;
		padding: 14px 0;
		border-bottom: var(--hairline);
		font: 400 15px var(--font-mono);
	}
	.dim {
		color: var(--text-2);
	}
	.folder {
		display: flex;
		flex-direction: column;
		gap: 6px;
	}
	.folder-label {
		font: 500 12px var(--font-mono);
		color: var(--text-2);
		letter-spacing: var(--tracking-label);
	}
	.folder-path {
		font: 500 15px var(--font-mono);
		padding: 14px 16px;
		border: 1px solid var(--line-2);
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.scan-form {
		display: flex;
		flex-direction: column;
		align-items: flex-start;
		gap: 12px;
	}
	.scan-message {
		font: var(--type-meta);
		color: var(--text-2);
	}
</style>

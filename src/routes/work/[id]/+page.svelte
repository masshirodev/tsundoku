<script lang="ts">
	import type { SubmitFunction } from '@sveltejs/kit';
	import { SvelteSet } from 'svelte/reactivity';
	import { resolve } from '$app/paths';
	import { enhance } from '$app/forms';
	import { goto } from '$app/navigation';
	import { backLink, replacing, settleReplacing } from '$lib/back';
	import Band from '$lib/components/chrome/Band.svelte';
	import Cover from '$lib/components/content/Cover.svelte';
	import RatingSlider from '$lib/components/controls/RatingSlider.svelte';
	import { coverSrc, readHref, seriesHref } from '$lib/library/links';
	import { count } from '$lib/library/labels';
	import { orderBooks } from '$lib/library/books';
	import {
		continuePart,
		inOrder,
		workCounts,
		workFavourite,
		workKinds,
		workRating
	} from '$lib/library/works';
	import AddSeriesSheet from './AddSeriesSheet.svelte';
	import Run from './Run.svelte';
	import type { TakeOutFacts, AddFacts, RenameFacts, WorkPartRow } from '$lib/server/works';

	let { data, form } = $props();
	let adding = $state(false);
	// RENAME's row, opened by its own cell. A Work is named in the GROUP sheet
	// before it exists (W4: CREATE waits for a name), so nothing lands here
	// asking to be renamed -- W2's `?rename=1` landing went with its stopgap.
	let renaming = $state(false);
	let reordering = $state(false);
	let order = $state<number[]>([]);
	let selecting = $state(false);
	const selected = new SvelteSet<number>();

	const work = $derived(data.work);
	const parts = $derived(inOrder(data.parts) as WorkPartRow[]);
	const counts = $derived(workCounts(parts));
	const current = $derived(continuePart(parts));
	const currentAt = $derived(
		current ? parts.findIndex((p) => p.seriesId === current.seriesId) : -1
	);
	const rating = $derived(workRating(parts, data.total));
	const fav = $derived(workFavourite(parts, data.total));
	const finishedAt = $derived(Math.max(0, ...parts.map((p) => p.finishedAt ?? 0)));
	const month = (ms: number) =>
		new Date(ms).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }).toUpperCase();
	const orderName = { hand: 'By hand', added: 'By date added', title: 'By title' } as const;

	// ---- bands ------------------------------------------------------------
	const takenOut = $derived(form && 'out' in form ? (form.out as TakeOutFacts[]) : null);
	const added = $derived(form && 'added' in form ? (form.added as AddFacts) : null);
	const renamed = $derived(form && 'renamed' in form ? (form.renamed as RenameFacts) : null);
	const refusal = $derived(
		form && 'message' in form && typeof form.message === 'string' ? form.message : ''
	);
	// The names come from the facts, never from `parts` or the picker: `update()`
	// has already re-read both lists by the time the band renders, so looking a
	// series up there says TAKEN OUT ·  with an empty name.
	const outTitles = $derived(takenOut ? takenOut.map((f) => f.title) : []);
	const addedTitle = $derived(added ? added.title : '');

	// ---- ORDER ------------------------------------------------------------
	function startOrder() {
		order = parts.map((p) => p.seriesId);
		reordering = true;
	}

	function orderBy(mode: 'date' | 'title') {
		const byId = new Map(parts.map((p) => [p.seriesId, p]));
		order = orderBooks(
			order.map((id) => ({ id, title: byId.get(id)!.title, addedAt: byId.get(id)!.addedAt })),
			mode
		).map((p) => p.id);
	}

	function stopOrder() {
		reordering = false;
	}

	// ---- SELECT -----------------------------------------------------------
	function toggle(id: number) {
		if (selected.has(id)) selected.delete(id);
		else selected.add(id);
	}

	function stopSelecting() {
		selecting = false;
		selected.clear();
	}

	/** A tap on a row: open the series, or take the pick SELECT is asking for. */
	function row(part: WorkPartRow) {
		if (selecting) return toggle(part.seriesId);
		// eslint-disable-next-line svelte/no-navigation-without-resolve -- seriesHref() resolves
		void goto(seriesHref(part.seriesId, `work:${work.id}`));
	}

	/**
	 * TAKE OUT of the second-to-last ends the Work, and the action redirects to
	 * the library's band. That redirect must replace this screen in history,
	 * not sit on top of it: pushed, the system's back lands on a Work that no
	 * longer exists (doc/NAVIGATION.md, "Screens that are gone"). UNGROUP
	 * beside it already does this through `replacing`.
	 */
	const selAfter: SubmitFunction = () => async (opts) => {
		stopSelecting();
		await settleReplacing(opts);
	};
</script>

<svelte:head><title>{work.name} · tsundoku</title></svelte:head>

<div class="work">
	{#if reordering}
		<form
			method="POST"
			action="?/reorder"
			use:enhance={() =>
				async ({ update }) => {
					await update();
					reordering = false;
				}}
			class="bar inverse"
			aria-label="Reorder the run"
		>
			<button
				type="button"
				class="cell x"
				aria-label="Cancel reordering"
				data-focus-mark="in"
				onclick={stopOrder}>✕</button
			>
			<div class="mid count">
				<span class="long">REORDER · {parts.length}</span><span class="short">REORDER</span>
			</div>
			<button type="button" class="cell" data-focus-mark="in" onclick={() => orderBy('date')}
				>BY DATE ADDED</button
			>
			<button type="button" class="cell" data-focus-mark="in" onclick={() => orderBy('title')}
				>BY TITLE</button
			>
			{#each order as id (id)}<input type="hidden" name="part" value={id} />{/each}
			<button type="submit" class="cell done" data-focus-mark="in">DONE</button>
		</form>
	{:else if selecting}
		<form
			method="POST"
			action="?/takeOut"
			use:enhance={selAfter}
			class="bar inverse"
			aria-label="Take out"
		>
			<button
				type="button"
				class="cell x"
				aria-label="Stop selecting"
				data-focus-mark="in"
				onclick={stopSelecting}>✕</button
			>
			<div class="mid count" aria-live="polite">{selected.size} SELECTED</div>
			{#each [...selected] as id (id)}<input type="hidden" name="part" value={id} />{/each}
			<button type="submit" class="cell done" data-focus-mark="in" disabled={selected.size === 0}
				>TAKE OUT</button
			>
		</form>
	{:else}
		<header class="bar" aria-label="Work">
			<a class="cell back" href={resolve('/')} use:backLink data-focus-mark="in">
				<span class="arrow">←</span>
				<span class="back-label">LIBRARY</span>
			</a>
			<div class="bar-title">
				<div class="t">{work.name}</div>
				<div class="s">
					WORK · {parts.length} SERIES<span class="ord">
						· {orderName[work.orderMode].toUpperCase()}</span
					>
				</div>
			</div>
		</header>
	{/if}

	{#if takenOut && takenOut.length > 0}
		<Band
			title="TAKEN OUT · {outTitles.join(', ').toUpperCase()}"
			detail="{takenOut.length === 1
				? 'A SERIES ON ITS OWN AGAIN'
				: `${takenOut.length} SERIES ON THEIR OWN AGAIN`} · KEEPS ITS RATING, FAV AND FOLDER"
		>
			{#snippet action()}
				<form method="POST" action="?/undoTakeOut" use:enhance>
					<input type="hidden" name="facts" value={JSON.stringify(takenOut)} />
					<button type="submit">UNDO</button>
				</form>
			{/snippet}
		</Band>
	{:else if added}
		<Band title="ADDED · {addedTitle.toUpperCase()}" detail="AT THE END OF THE RUN">
			{#snippet action()}
				<form method="POST" action="?/undoAdd" use:enhance>
					<input type="hidden" name="facts" value={JSON.stringify(added)} />
					<button type="submit">UNDO</button>
				</form>
			{/snippet}
		</Band>
	{:else if renamed}
		<Band title="RENAMED · {work.name.toUpperCase()}" detail="THE RUN, UNDER ITS OWN NAME">
			{#snippet action()}
				<form method="POST" action="?/undoRename" use:enhance>
					<input type="hidden" name="facts" value={JSON.stringify(renamed)} />
					<button type="submit">UNDO</button>
				</form>
			{/snippet}
		</Band>
	{:else if refusal}
		<Band title={refusal} detail="NOTHING CHANGED" />
	{/if}

	<div class="body">
		{#if !selecting && !reordering}
			<aside class="panel" aria-label="About this Work">
				<div class="ident">
					<div class="fan" aria-hidden="true">
						{#each parts.slice(0, 3) as p (p.seriesId)}
							<span class="cvw"><Cover src={coverSrc(p.seriesId, p.cover)} hue={p.hue} /></span>
						{/each}
					</div>
					<div class="names">
						<div class="meta">{workKinds(parts)}</div>
						<h1>{work.name}</h1>
						<div class="count">
							<span class="ink">{counts.series} SERIES</span> · {count(counts.chapters)}
							CHAPTERS · {counts.allRead ? 'ALL READ' : `${count(counts.read)} READ`}
						</div>
						<div class="count">
							{currentAt >= 0 ? `PART ${currentAt + 1} OF ${parts.length}` : 'THE RUN IS READ'},
							MADE
							{month(work.createdAt)}
						</div>
					</div>
				</div>

				<!-- RATING and FAV are the parts', set together while they agree (doc/WORKS.md). -->
				<div class="rrow">
					<form method="POST" action="?/rate" use:enhance class="rs-form">
						<RatingSlider
							value={rating.shown}
							label={rating.settable ? 'RATING' : 'PARTS DIFFER'}
							name="rating"
							height={64}
							phoneHeight={52}
							labelWidth={120}
							zeroWidth={52}
							pad={24}
							borderTop={false}
							borderBottom={false}
							disabled={!rating.settable}
						/>
					</form>
					<form method="POST" action="?/favourite" use:enhance class="fav-form">
						<input type="hidden" name="on" value={fav.value ? '0' : '1'} />
						<button
							type="submit"
							class="fav"
							class:on={fav.value === true}
							disabled={!fav.settable}
							aria-pressed={fav.value === true}
							>FAV{#if fav.value === null}
								<span class="n">{fav.count} OF {fav.of}</span>
							{/if}</button
						>
					</form>
				</div>

				{#if rating.value === null || fav.value === null}
					<p class="mix">
						{parts.length < data.total
							? 'THIS PAGE SEES ONLY SOME OF THE PARTS, SO IT CANNOT SET THEM'
							: `THE PARTS DIFFER · ${fav.count} OF ${fav.of} FAVOURITE`}
					</p>
				{/if}

				{#if current && data.resume}
					<!-- eslint-disable-next-line svelte/no-navigation-without-resolve -- readHref() resolves -->
					<a class="cta" href={readHref(data.resume.id)}>
						<span>▶ CONTINUE · PART {currentAt + 1} · {data.resume.label.toUpperCase()}</span>
						<span class="m">{current.title.toUpperCase()}</span>
					</a>
				{:else if data.again}
					<!-- eslint-disable-next-line svelte/no-navigation-without-resolve -- readHref() resolves -->
					<a class="cta quiet" href={readHref(data.again.id)}>
						<span>THE RUN IS READ</span>
						<span class="m">FINISHED {finishedAt ? month(finishedAt) : '—'} · READ AGAIN</span>
					</a>
				{/if}

				<div class="prow">
					<div class="lb">ORDER</div>
					<div class="lk">
						<div class="a">{orderName[work.orderMode]}</div>
						<div class="b">CONTINUE AND NEXT FOLLOW IT</div>
					</div>
					<button type="button" class="lc" onclick={startOrder}>CHANGE</button>
				</div>
				<div class="prow">
					<div class="lb">SHELVES</div>
					<div class="lk">
						<div class="a">
							{data.shelves.length ? data.shelves.map((s) => s.name).join(' · ') : 'NONE YET'}
						</div>
						<div class="b">FROM ITS SERIES · SET ON EACH</div>
					</div>
				</div>
				<div class="prow">
					<div class="lb">FILE</div>
					<div class="lk">
						<div class="a">A Work of {parts.length} series</div>
						<div class="b">NOTHING MERGED · EACH KEEPS ITS OWN</div>
					</div>
					<button type="button" class="lc" onclick={() => (renaming = !renaming)}>RENAME</button>
					<form method="POST" action="?/ungroup" use:enhance={replacing}>
						<button type="submit" class="lc">UNGROUP</button>
					</form>
				</div>
				{#if renaming}
					<form method="POST" action="?/rename" use:enhance class="rename">
						<input
							type="text"
							name="name"
							value={work.name}
							aria-label="The Work's name"
							class="field"
						/>
						<button type="submit" class="lc acc">DONE</button>
						<button type="button" class="lc" onclick={() => (renaming = false)}>CANCEL</button>
					</form>
				{/if}
			</aside>
		{/if}

		<section class="list" aria-label="The run">
			<div class="lhead">
				<span>01 — THE RUN · {parts.length}</span>
				<span class="sp"></span>
				{#if !selecting && !reordering}
					<button type="button" class="hc" onclick={() => (selecting = true)}>SELECT</button>
					<button type="button" class="hc" onclick={startOrder}>ORDER</button>
				{/if}
			</div>

			<Run
				workId={work.id}
				{parts}
				currentId={current?.seriesId ?? null}
				resume={data.resume}
				{reordering}
				bind:order
				{selecting}
				{selected}
				onrow={row}
				onselect={(p) => toggle(p.seriesId)}
			/>

			<button type="button" class="add" onclick={() => (adding = true)}>
				+ ADD A SERIES · FROM THE LIBRARY
			</button>

			<div class="notes">
				<div>A TAP OPENS THE SERIES; ▶ CONTINUES IT.</div>
				<div>ORDER: DRAG A ROW, OR FOCUS ONE AND USE THE ARROW KEYS; DONE SAVES.</div>
			</div>
		</section>
	</div>
</div>

<AddSeriesSheet open={adding} workId={work.id} onclose={() => (adding = false)} />

<style>
	.work {
		display: flex;
		flex-direction: column;
		flex: 1;
		--list-top: var(--header-h);
	}
	/* ---- top bar, as the series screen's (src/routes/series/[id]/+page.svelte) ---- */
	.bar {
		position: sticky;
		top: 0;
		z-index: 5;
		flex-shrink: 0;
		display: flex;
		align-items: stretch;
		height: var(--header-h);
		border-bottom: var(--hairline);
		background: var(--surface-page);
	}
	.bar.inverse {
		background: var(--surface-inverse);
		color: var(--text-inverse);
		border-bottom: 0;
	}
	.cell {
		display: flex;
		align-items: center;
		gap: 14px;
		padding: 0 var(--pad);
		border: 0;
		border-radius: 0;
		background: transparent;
		color: inherit;
		font: 500 14px var(--font-mono);
		letter-spacing: 0.04em;
		white-space: nowrap;
		cursor: pointer;
		text-decoration: none;
	}
	.cell:disabled {
		cursor: default;
		opacity: 0.4;
	}
	.bar:not(.inverse) .cell.back {
		border-right: var(--hairline);
		color: var(--text-1);
	}
	.inverse .cell {
		border-left: 1px solid var(--text-2);
	}
	.inverse .cell.x {
		border-left: 0;
		border-right: 1px solid var(--text-2);
		font: 500 18px var(--font-mono);
	}
	.cell.done {
		background: var(--accent);
		color: var(--on-accent);
	}
	.arrow {
		font-size: 17px;
	}
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
		font: 500 15px var(--font-sans);
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
	.mid {
		flex: 1;
		min-width: 0;
		display: flex;
		align-items: center;
		padding: 0 18px;
	}
	.count {
		font: 500 17px var(--font-mono);
	}
	.mid .short {
		display: none;
	}
	@media (max-width: 599px) {
		.mid .long {
			display: none;
		}
		.mid .short {
			display: inline;
		}
		.back-label {
			font-size: 13px;
		}
	}

	/* ---- the series screen's frame: header above the list in portrait, a 440 panel beside it ---- */
	.body {
		display: flex;
		flex-direction: column;
		flex: 1;
		min-height: 0;
	}
	.list {
		min-width: 0;
	}
	@media (min-width: 1024px) {
		.work {
			--list-top: 0px;
		}
		.body {
			flex-direction: row;
			height: calc(100dvh - var(--header-h) - var(--banner-h, 0px));
			flex: none;
		}
		.panel {
			flex-shrink: 0;
			width: 440px;
			overflow-y: auto;
			border-right: var(--hairline);
		}
		.list {
			flex: 1;
			overflow-y: auto;
		}
	}
	@media (pointer: none) and (min-width: 900px) {
		.body {
			flex-direction: row;
			height: calc(100dvh - var(--header-h) - var(--safe-y) - var(--banner-h, 0px));
			flex: none;
			gap: 32px;
			padding: 0 var(--pad);
		}
		.panel {
			flex-shrink: 0;
			width: 352px;
			overflow-y: auto;
			border-right: 0;
		}
		.list {
			flex: 1;
			overflow-y: auto;
		}
		.work {
			--list-top: 0px;
		}
	}

	/* ---- the panel ---- */
	.ident {
		display: flex;
		gap: 24px;
		padding: 24px;
	}
	.fan {
		position: relative;
		width: 148px;
		height: 200px;
		flex-shrink: 0;
	}
	.fan .cvw {
		position: absolute;
		display: block;
		width: 104px;
	}
	.fan .cvw:nth-child(1) {
		left: 44px;
		top: 0;
		opacity: 0.55;
	}
	.fan .cvw:nth-child(2) {
		left: 22px;
		top: 24px;
		opacity: 0.8;
		box-shadow: 1px 0 0 var(--surface-page);
	}
	.fan .cvw:nth-child(3) {
		left: 0;
		top: 48px;
		box-shadow: 2px -2px 0 var(--surface-page);
	}
	.names {
		min-width: 0;
		display: flex;
		flex-direction: column;
		gap: 10px;
	}
	.meta {
		font: 500 13px/1.4 var(--font-mono);
		letter-spacing: 0.06em;
		color: var(--text-2);
	}
	h1 {
		margin: 0;
		font: 500 26px/1.2 var(--font-sans);
	}
	.ident .count {
		font: 400 13px/1.4 var(--font-mono);
		color: var(--text-2);
	}
	.ident .count .ink {
		color: var(--text-1);
	}
	/* RATING and FAV in one row, the series screen's idiom (RatingSlider + its FAV). */
	.rrow {
		display: flex;
		align-items: stretch;
		border-top: var(--hairline);
		border-bottom: var(--hairline);
	}
	.rs-form {
		flex: 1;
		min-width: 0;
		display: flex;
	}
	.rs-form :global(.rs) {
		flex: 1;
	}
	.fav-form {
		display: flex;
	}
	.fav {
		width: 96px;
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		gap: 3px;
		border: 0;
		border-left: var(--hairline);
		border-radius: 0;
		background: transparent;
		color: var(--text-2);
		font: 500 14px var(--font-mono);
		cursor: pointer;
	}
	.fav.on {
		background: var(--accent);
		color: var(--on-accent);
	}
	.fav:disabled {
		opacity: 0.5;
		cursor: default;
	}
	.fav .n {
		font: 400 10px var(--font-mono);
		letter-spacing: 0.04em;
	}
	.mix {
		margin: 0;
		padding: 8px 24px;
		font: 400 11px var(--font-mono);
		letter-spacing: 0.04em;
		color: var(--text-2);
		border-bottom: var(--hairline);
	}
	.cta {
		flex-shrink: 0;
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 12px;
		height: 64px;
		padding: 0 24px;
		background: var(--accent);
		color: var(--on-accent);
		font: 500 15px var(--font-mono);
		letter-spacing: 0.04em;
		white-space: nowrap;
		text-decoration: none;
	}
	.cta .m {
		font-weight: 400;
		font-size: 13px;
	}
	.cta.quiet {
		background: none;
		color: var(--text-1);
		border-bottom: var(--hairline);
	}
	.cta.quiet .m {
		color: var(--text-2);
	}
	.panel {
		display: flex;
		flex-direction: column;
	}
	.prow {
		display: flex;
		align-items: stretch;
		min-height: 64px;
		border-bottom: var(--hairline);
	}
	/* A form in the row (UNGROUP's) must be a flex box too, as .rs-form and
	   .fav-form are, or its .lc keeps its text's height at the row's top. */
	.prow form {
		display: flex;
	}
	.prow .lb {
		width: 120px;
		flex-shrink: 0;
		display: flex;
		align-items: center;
		padding-left: 24px;
		border-right: var(--hairline);
		font: 500 12px var(--font-mono);
		letter-spacing: 0.06em;
		color: var(--text-2);
	}
	.prow .lk {
		flex: 1;
		min-width: 0;
		display: flex;
		flex-direction: column;
		justify-content: center;
		gap: 5px;
		padding: 10px 14px;
	}
	.prow .lk .a {
		font: 500 15px/1.3 var(--font-sans);
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}
	.prow .lk .b {
		font: 400 13px/1.35 var(--font-mono);
		color: var(--text-2);
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}
	.lc {
		display: flex;
		align-items: center;
		justify-content: center;
		padding: 0 18px;
		border: 0;
		border-left: var(--hairline);
		border-radius: 0;
		background: transparent;
		color: var(--text-1);
		font: 500 13px var(--font-mono);
		letter-spacing: 0.04em;
		white-space: nowrap;
		cursor: pointer;
	}
	.lc.acc {
		background: var(--accent);
		color: var(--on-accent);
	}
	.rename {
		display: flex;
		align-items: stretch;
		min-height: 52px;
		border-bottom: var(--hairline);
	}
	.field {
		flex: 1;
		min-width: 0;
		margin: 0;
		padding: 0 14px;
		border: 0;
		border-right: var(--hairline);
		background: transparent;
		color: var(--text-1);
		font: 400 16px var(--font-sans);
	}
	/* ---- the run's head and foot ---- */
	.lhead {
		position: sticky;
		top: var(--list-top, 0);
		z-index: 3;
		display: flex;
		justify-content: space-between;
		align-items: stretch;
		height: 52px;
		border-bottom: var(--hairline);
		background: var(--surface-page);
		font: 500 13px var(--font-mono);
		letter-spacing: 0.06em;
		color: var(--text-2);
	}
	.lhead > span:first-child {
		display: flex;
		align-items: center;
		padding: 0 24px;
	}
	.lhead .sp {
		flex: 1;
	}
	.hc {
		display: flex;
		align-items: center;
		padding: 0 20px;
		border: 0;
		border-left: var(--hairline);
		border-radius: 0;
		background: transparent;
		color: var(--text-1);
		font: 500 13px var(--font-mono);
		letter-spacing: 0.04em;
		cursor: pointer;
	}
	.add {
		display: flex;
		align-items: center;
		min-height: 64px;
		width: 100%;
		padding: 0 24px;
		border: 0;
		border-bottom: var(--hairline);
		border-radius: 0;
		background: transparent;
		color: var(--text-2);
		font: 500 13px var(--font-mono);
		letter-spacing: 0.04em;
		cursor: pointer;
		text-align: left;
	}
	.notes {
		display: flex;
		flex-direction: column;
		gap: 8px;
		padding: 16px 24px 24px;
		font: 400 12px/1.5 var(--font-mono);
		color: var(--text-2);
	}
	@media (max-width: 599px) {
		.ident {
			gap: 16px;
			padding: 16px;
		}
		h1 {
			font-size: 22px;
		}
		.fan {
			width: 112px;
			height: 150px;
		}
		.fan .cvw {
			width: 76px;
		}
		.fan .cvw:nth-child(1) {
			left: 36px;
		}
		.fan .cvw:nth-child(2) {
			left: 18px;
			top: 18px;
		}
		.fan .cvw:nth-child(3) {
			top: 36px;
		}
		.cta {
			padding: 0 16px;
			font-size: 14px;
		}
		.fav {
			width: 72px;
		}
		/* The phone pass (W7, Work-Phone B2): the bar as the series screen's
		   phone header draws it -- the name in mono capitals at 13px over an
		   11px line that drops the order (ORDER's row says it) -- and the
		   run's head and + ADD A SERIES at the board's phone measures. */
		.bar-title {
			padding: 0 14px;
		}
		.bar-title .t {
			font: 500 13px var(--font-mono);
			letter-spacing: 0.04em;
			text-transform: uppercase;
		}
		.bar-title .s {
			font-size: 11px;
		}
		.bar-title .ord {
			display: none;
		}
		.lhead > span:first-child {
			padding: 0 16px;
		}
		.hc {
			padding: 0 16px;
		}
		.add {
			min-height: 104px;
			padding: 0 12px;
		}
	}
</style>

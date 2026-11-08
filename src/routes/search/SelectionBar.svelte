<script lang="ts">
	import { deserialize, enhance } from '$app/forms';
	import type { SubmitFunction } from '@sveltejs/kit';
	import BulkBar from '$lib/components/chrome/BulkBar.svelte';
	import Band from '$lib/components/chrome/Band.svelte';
	import Sheet from '$lib/components/chrome/Sheet.svelte';
	import Switch from '$lib/components/controls/Switch.svelte';
	import { deleteWithLine, keptAcrossLine } from '$lib/library/highlights';
	import { langCode } from '$lib/library/editions';
	import { groupAnswers } from '$lib/library/books';
	import { allHiddenAmong } from '$lib/library/works';
	import { pickedInOrder, titlesLine, workOf, type Picked } from '$lib/library/selection';
	import type { Kind, RefreshBatch, Shelf } from '$lib/library/types';
	import { num, upper } from '$lib/i18n/format';
	import { m } from '$lib/paraglide/messages';
	import GroupSheet from '../GroupSheet.svelte';
	import HideSheet from '../HideSheet.svelte';
	import ShelfPicker from '../ShelfPicker.svelte';

	/**
	 * The selection's bulk bar and the sheets its cells open (c838): the one bar
	 * the library and `/search` both draw, so the search has no copy of it. Every
	 * form posts the library's action by its absolute path (`/?/bulk`), since a
	 * relative `?/bulk` on `/search` would post to `/search`'s own actions, which
	 * have none of these. What the answer means differs: the library reads its
	 * `form`, and SvelteKit does not apply an answer to a page it does not belong
	 * to, so `/search` passes `onanswer`/`bulkAnswer` and reads `result.data`
	 * itself (doc/LIBRARY.md, "SELECT across the search").
	 */
	type BookOption = { id: number; title: string; books: number };
	type WorkOption = { id: number; name: string; series: number; createdAt: number };

	let {
		selecting,
		selected,
		facts,
		workFeet = {},
		existing,
		existingVolumes,
		existingWorks,
		shelves,
		hiddenOf,
		fill,
		foldMessage = '',
		batch = null,
		bulkAnswer,
		ondismissBatch,
		ongrouped,
		ongroupstale,
		onhide,
		onhideanswer,
		ondeleted
	}: {
		selecting: boolean;
		selected: ReadonlySet<number>;
		facts: ReadonlyMap<number, Picked>;
		/** The page's own word on a selected series' Work, fresher than what was noted. */
		workFeet?: Readonly<Record<string, { id: number; name: string } | undefined>>;
		existing: BookOption[];
		existingVolumes: BookOption[];
		existingWorks: WorkOption[];
		shelves: Shelf[];
		hiddenOf: (id: number) => boolean | undefined;
		/** What SELECT ALL took unseen, filled in before a sheet reads the selection. */
		fill: () => Promise<void>;
		/** A refusal, drawn over the bar it came from. */
		foldMessage?: string;
		batch?: RefreshBatch | null;
		bulkAnswer: SubmitFunction;
		ondismissBatch: () => void;
		ongrouped: () => void;
		/** GROUP's sheet refused and closed; `/search` draws why and reads its lists again. */
		ongroupstale?: (message: string) => void;
		onhide: () => void | Promise<void>;
		/** The answer of HIDE's own sheet, for a page SvelteKit does not apply it to. */
		onhideanswer?: (data: Record<string, unknown>) => void;
		ondeleted: () => void | Promise<void>;
	} = $props();

	type GroupRow = {
		seriesId: number;
		title: string;
		hue: number;
		addedAt: number;
		cover: number | null;
		kind: Kind;
		entryCount: number;
		meta: string;
		inWork: string | null;
	};
	const groupRows = $derived(
		pickedInOrder(selected, facts).map((p): GroupRow => ({
			seriesId: p.id,
			title: p.title,
			hue: p.hue,
			addedAt: p.addedAt,
			cover: p.cover,
			kind: p.kind,
			entryCount: p.entryCount,
			meta: p.meta,
			inWork: p.inWork
		}))
	);
	const answers = $derived(
		groupAnswers(groupRows.map((r) => ({ kind: r.kind, entryCount: r.entryCount })))
	);
	/** The noun the sheet's title reads: the first answer the selection allows. */
	const noun = $derived(answers[0] === 'volumes' ? 'VOLUMES' : 'BOOKS');
	/** The Works the selection touches: HIDE asks when there is one (W4). */
	const selectedWorks = $derived([
		...new Set(
			[...selected]
				.map((id) => workOf(id, workFeet, facts)?.id)
				.filter((id): id is number => typeof id === 'number')
		)
	]);
	/** HIDE ALL n: every part of the Works touched, and the selected series in none. */
	const hideWholeCount = $derived(
		selectedWorks.reduce((n, id) => n + (existingWorks.find((w) => w.id === id)?.series ?? 0), 0) +
			[...selected].filter((id) => !workOf(id, workFeet, facts)).length
	);
	/** TAKE OUT: how many series stay behind in their Works. */
	const hideRemainCount = $derived(
		selectedWorks.reduce((n, id) => {
			const work = existingWorks.find((w) => w.id === id);
			const here = [...selected].filter((s) => workOf(s, workFeet, facts)?.id === id).length;
			return n + Math.max(0, (work?.series ?? here) - here);
		}, 0)
	);
	/**
	 * FOLD AS LANGUAGES (doc/EDITIONS.md): two or three single books, each in
	 * a language of its own, none folded already, and each with nothing beside
	 * it (`alone`, c651: `?/fold` refuses the rest, and an action that can only
	 * be refused is not offered). Their codes, or null.
	 */
	const foldCodes = $derived.by(() => {
		if (selected.size < 2 || selected.size > 3) return null;
		const picked = pickedInOrder(selected, facts);
		if (picked.length !== selected.size) return null;
		if (
			picked.some(
				(s) => s.kind !== 'doujin' || s.entryCount !== 1 || !s.alone || !s.language || s.languages
			)
		)
			return null;
		const langs = picked.map((s) => s.language!);
		return new Set(langs).size === langs.length ? langs.map(langCode) : null;
	});
	/** Every series selected is hidden, and the page can see at least one. */
	const allHidden = $derived(
		allHiddenAmong(selected, (id) => hiddenOf(id) ?? facts.get(id)?.hidden)
	);

	let pickerOpen = $state(false);
	let grouping = $state(false);
	let hiding = $state(false);
	let deleting = $state(false);
	let deleteBusy = $state(false);
	/** What the selection holds, read as DELETE opens (Out X4; c731). */
	let held = $state.raw({ n: 0, series: 0 });
	/** DELETE THEM TOO: off every time the sheet opens, never carried over. */
	let deleteHeldToo = $state(false);
	/** The first few titles, so the question names what it's about. */
	const deletingTitles = $derived(titlesLine(selected, facts));
	/** The last tap still waiting on the reads: only it opens its sheet. */
	let lastTap = 0;
	/** ✕, SHOW or a bulk action's success: a tap still waiting on the reads no longer counts. */
	export function dropTaps(): void {
		lastTap++;
	}
	/**
	 * Open a bulk action's sheet once the selection is whole. A tap made while
	 * the reads are out is dropped by ✕, or by a later tap, which is the one
	 * the owner meant.
	 */
	async function openWhenFilled(open: () => void): Promise<void> {
		const tap = ++lastTap;
		await fill();
		if (tap === lastTap) open();
	}

	/** How long DELETE waits for that read before it asks without the row. */
	const HELD_READ_MS = 3000;
	/**
	 * How many highlights `ids` hold. A read that fails answers none, and so
	 * does one that outlasts HELD_READ_MS (a hung read must not hold the sheet
	 * shut): the sheet then says nothing about them and offers no switch, and
	 * the delete keeps them, which is what it does by default.
	 */
	async function readHeld(ids: number[]): Promise<{ n: number; series: number }> {
		const body = new FormData();
		for (const id of ids) body.append('id', String(id));
		try {
			const res = await fetch('/?/held', {
				method: 'POST',
				body,
				headers: { 'x-sveltekit-action': 'true' },
				signal: AbortSignal.timeout(HELD_READ_MS)
			});
			const answer = deserialize(await res.text());
			if (answer.type === 'success' && answer.data) {
				const { n, series } = answer.data as { n: number; series: number };
				return { n, series };
			}
		} catch {
			// Falls through: the workstation did not answer.
		}
		return { n: 0, series: 0 };
	}
	const sameMembers = (ids: number[], set: ReadonlySet<number>) =>
		ids.length === set.size && ids.every((id) => set.has(id));
	/**
	 * DELETE: fill in what SELECT ALL never drew, read the highlights, then ask.
	 * In that order so the sheet opens whole, with no row arriving under the
	 * finger on its way to the action. A selection that moved during the read
	 * is read again, or the row would name other series' highlights.
	 */
	async function askDelete(): Promise<void> {
		const tap = ++lastTap;
		await fill();
		let asked: number[];
		let answer: { n: number; series: number };
		do {
			if (tap !== lastTap) return;
			asked = [...selected];
			answer = await readHeld(asked);
		} while (tap === lastTap && !sameMembers(asked, selected));
		if (tap !== lastTap) return;
		held = answer;
		deleteHeldToo = false;
		deleting = true;
	}

	/** How many failed titles the band names; the count is always the whole truth. */
	const FAILED_SHOWN = 3;
	const batchTitle = $derived(
		!batch
			? ''
			: batch.asked === 0
				? m.library_refresh_nothing()
				: m.library_refresh_asked({ n: num(batch.asked), found: num(batch.found) })
	);
	const batchDetail = $derived.by(() => {
		if (!batch) return '';
		const parts: string[] = [];
		if (batch.failed.length > 0) {
			const named = batch.failed.slice(0, FAILED_SHOWN).map(upper);
			if (batch.failed.length > named.length) named.push('…');
			parts.push(
				m.library_refresh_failed({
					count: batch.failed.length,
					n: num(batch.failed.length),
					titles: named.join(', ')
				})
			);
		} else if (batch.asked > 0) parts.push(m.library_refresh_all_answered());
		if (batch.skipped > 0)
			parts.push(
				batch.asked === 0
					? m.library_refresh_skipped_all({ count: batch.skipped, n: num(batch.skipped) })
					: m.library_refresh_skipped({ count: batch.skipped, n: num(batch.skipped) })
			);
		if (batch.remaining.length > 0)
			parts.push(
				m.library_refresh_not_asked({
					count: batch.remaining.length,
					n: num(batch.remaining.length)
				})
			);
		return parts.join(' · ');
	});

	/** After a HIDE's answer: the screen takes the re-read and ends SELECT. */
	const whenHid = async () => {
		hiding = false;
		await onhide();
	};
</script>

{#if selecting}
	<form method="POST" action="/?/bulk" use:enhance={bulkAnswer}>
		{#each [...selected] as id (id)}<input type="hidden" name="id" value={id} />{/each}
		{#if foldMessage}
			<div class="fold-refused" role="status">{foldMessage}</div>
		{/if}
		<BulkBar columns={7}>
			{#snippet actions()}
				<button type="submit" name="do" value="fav" disabled={selected.size === 0}>FAV</button>
				<button type="button" disabled={selected.size === 0} onclick={() => (pickerOpen = true)}
					>+ SHELF</button
				>
				<!-- No tag editor is designed yet; see doc/LIBRARY.md. -->
				<button type="button" disabled>TAG</button>
				{#if foldCodes}
					<!-- Editions 1f: books in different languages fold, rather than group. -->
					<button type="submit" class="fold" formaction="/?/fold"
						><span class="long">FOLD AS LANGUAGES</span><span class="short">FOLD</span><span
							class="sub">{foldCodes.join(' · ')}</span
						></button
					>
				{:else}
					<!-- Index Books: GROUP, and W4's AS sheet asks what they become. -->
					<button
						type="button"
						class="group"
						disabled={selected.size === 0}
						onclick={() => void openWhenFilled(() => (grouping = true))}>GROUP</button
					>
				{/if}
				<!-- REFRESH (c221): asks each selected series' source once, and downloads nothing. -->
				<button type="submit" formaction="/?/refresh" disabled={selected.size === 0}
					>{m.library_refresh()}</button
				>
				<!-- With reveal on and only hidden tiles selected, the same cell unhides them.
				     A selection that holds part of a Work asks first: a Work is hidden
				     whole, or the part leaves it (W4; doc/WORKS.md, "The one rule").
				     UNHIDE follows the same rule the other way: on a person's page a
				     Work's parts are their own tiles, so showing one must show the Work. -->
				{#if allHidden}
					{#if selectedWorks.length > 0}
						<button type="submit" formaction="/?/showAll" disabled={selected.size === 0}
							>UNHIDE</button
						>
					{:else}
						<button type="submit" name="do" value="unhide" disabled={selected.size === 0}
							>UNHIDE</button
						>
					{/if}
				{:else if selectedWorks.length > 0}
					<button
						type="button"
						disabled={selected.size === 0}
						onclick={() => void openWhenFilled(() => (hiding = true))}>HIDE</button
					>
				{:else}
					<button type="submit" name="do" value="hide" disabled={selected.size === 0}>HIDE</button>
				{/if}
				<!-- Asks first (doc/DELETING.md): duplicates are cleared in bulk. -->
				<button type="button" disabled={selected.size === 0} onclick={() => void askDelete()}
					>DELETE</button
				>
			{/snippet}
		</BulkBar>
	</form>
	{#if batch}
		<!-- REFRESH's answer (c221): pinned over the bar that asked, so it is read where it was pressed. -->
		<div class="refresh-band">
			<Band title={batchTitle} detail={batchDetail} ondismiss={ondismissBatch}>
				{#snippet action()}
					{#if batch && batch.remaining.length > 0}
						<form method="POST" action="/?/refresh" use:enhance={bulkAnswer}>
							{#each batch.remaining as id (id)}<input type="hidden" name="id" value={id} />{/each}
							<button type="submit"
								>{m.library_refresh_more({ n: num(batch.remaining.length) })}</button
							>
						</form>
					{/if}
				{/snippet}
			</Band>
		</div>
	{/if}
{/if}

<GroupSheet
	open={grouping}
	books={groupRows}
	existing={existing.filter((s) => !selected.has(s.id))}
	existingVolumes={existingVolumes.filter((s) => !selected.has(s.id))}
	existingWorks={existingWorks.filter(
		(w) => selectedWorks.length === 0 || !selectedWorks.includes(w.id)
	)}
	{answers}
	{noun}
	absolute
	ondone={() => {
		grouping = false;
		ongrouped();
	}}
	onstale={ongroupstale}
	onclose={() => (grouping = false)}
/>

{#if hiding}
	<HideSheet
		open
		title="HIDE {selected.size} {selected.size === 1 ? 'SERIES' : 'SERIES'}?"
		detail={selectedWorks.length === 1
			? `PART OF ${existingWorks.find((w) => w.id === selectedWorks[0])?.name.toUpperCase() ?? 'A WORK'}`
			: `PART OF ${selectedWorks.length} WORKS`}
		ids={[...selected].map(String)}
		wholeCount={hideWholeCount}
		remainCount={hideRemainCount}
		actionAll="/?/hideAll"
		actionPart="/?/hideParts"
		onanswer={onhideanswer}
		ondone={whenHid}
		onclose={() => (hiding = false)}
	/>
{/if}

<!-- A copy of the shared ConfirmSheet, with the row highlights add between the
     lines and the actions, where that sheet has no place for it (Out X4; c731). -->
<Sheet open={deleting} onclose={() => (deleting = false)} label="DELETE {selected.size} SERIES?">
	<div class="del-head">
		<span class="del-title">DELETE {selected.size} SERIES?</span>
		<button
			type="button"
			class="del-x"
			aria-label={m.chrome_close()}
			onclick={() => (deleting = false)}>✕</button
		>
	</div>
	<div class="del-body">
		{#each [`${selected.size} SELECTED${deletingTitles ? ` · ${deletingTitles}` : ''}`, 'THEIR FILES MOVE TO THE TRASH FOLDER ON THE WORKSTATION.', 'THEIR READING HISTORY GOES WITH THEM.', 'A SCAN OR A SYNC WON’T BRING THEM BACK.'] as line (line)}<p
			>
				{line}
			</p>{/each}
	</div>
	{#if held.n > 0}
		<div class="del-kept" data-highlights-kept>
			<div class="del-row del-col">
				<span class="del-lbl">{keptAcrossLine(held.n, held.series)}</span>
				<span class="del-why"
					>THEIR QUOTES, COPIES AND NOTES STAY ON THE HIGHLIGHTS PAGE, FROM A SERIES NO LONGER IN
					THE LIBRARY.</span
				>
			</div>
			<div class="del-row">
				<span class="del-lbl del-too">DELETE THEM TOO</span>
				<Switch checked={deleteHeldToo} onchange={(v) => (deleteHeldToo = v)} />
			</div>
		</div>
	{/if}
	<form
		method="POST"
		action="/?/delete"
		class="del-actions"
		use:enhance={() => {
			deleteBusy = true;
			return async ({ result }) => {
				deleting = false;
				deleteBusy = false;
				if (result.type === 'success') await ondeleted();
			};
		}}
	>
		{#each [...selected] as id (id)}<input type="hidden" name="id" value={String(id)} />{/each}
		{#if deleteHeldToo && held.n > 0}<input type="hidden" name="highlights" value="1" />{/if}
		<button type="button" onclick={() => (deleting = false)} disabled={deleteBusy}
			>{m.chrome_cancel()}</button
		>
		<button type="submit" class="del-go" disabled={deleteBusy}
			>{deleteBusy
				? m.chrome_working()
				: deleteHeldToo && held.n > 0
					? deleteWithLine(held.n)
					: `DELETE ${selected.size}`}</button
		>
	</form>
</Sheet>

<ShelfPicker open={pickerOpen} ids={[...selected]} {shelves} onclose={() => (pickerOpen = false)} />

<style>
	.fold {
		flex-direction: column;
		gap: 2px;
		background: var(--accent) !important;
		color: var(--on-accent) !important;
	}
	.fold .sub {
		font: 400 12px var(--font-mono);
	}
	.fold .short {
		display: none;
	}
	@media (max-width: 599px) {
		.fold .long {
			display: none;
		}
		.fold .short {
			display: inline;
		}
	}
	.fold-refused {
		position: fixed;
		left: var(--sheet-left, 0);
		right: 0;
		bottom: calc(121px + env(safe-area-inset-bottom));
		z-index: 10;
		padding: 14px var(--pad, 24px);
		background: var(--surface-panel);
		border-top: var(--hairline);
		font: 500 13px var(--font-mono);
		color: var(--accent);
	}

	/* REFRESH's answer (c221), pinned over the bulk bar it came from. A band is
	   an answer, not a wall: the grid under it stays tappable, and only the band
	   itself takes a press (its UNDO, its ASK N MORE). */
	.refresh-band {
		position: fixed;
		left: var(--sheet-left, 0);
		right: 0;
		bottom: calc(121px + env(safe-area-inset-bottom));
		z-index: 10;
		pointer-events: none;
	}
	.refresh-band > :global(.band) {
		pointer-events: auto;
	}
	/* The bulk DELETE's sheet: ConfirmSheet's head, body and actions, unchanged,
	   and the series screen's X4 box (c731). */
	.del-head {
		display: flex;
		align-items: stretch;
		min-height: 64px;
		border-bottom: var(--hairline);
	}
	.del-title {
		flex: 1;
		display: flex;
		align-items: center;
		padding: 12px var(--pad);
		font: 500 16px var(--font-mono);
		letter-spacing: var(--tracking-label);
		overflow-wrap: anywhere;
	}
	.del-x {
		width: 64px;
		border: 0;
		border-left: var(--hairline);
		background: none;
		color: var(--text-1);
		font: 400 20px var(--font-mono);
		cursor: pointer;
	}
	.del-body {
		display: flex;
		flex-direction: column;
		gap: 10px;
		padding: 20px var(--pad);
		border-bottom: var(--hairline);
	}
	.del-body p {
		margin: 0;
		font: 400 14px var(--font-mono);
		line-height: 1.5;
		color: var(--text-2);
	}
	.del-kept {
		display: flex;
		flex-direction: column;
		margin: 16px var(--pad);
		border: var(--hairline);
	}
	.del-row {
		display: flex;
		align-items: center;
		gap: 14px;
		min-height: 48px;
		padding: 10px 16px;
	}
	.del-row + .del-row {
		border-top: var(--hairline);
	}
	.del-col {
		flex-direction: column;
		align-items: flex-start;
		gap: 6px;
	}
	.del-lbl {
		font: 500 12px/1.2 var(--font-mono);
		letter-spacing: var(--tracking-label);
		color: var(--text-1);
	}
	.del-too {
		flex: 1;
		color: var(--text-2);
	}
	.del-why {
		font: 400 14px/1.45 var(--font-sans);
		color: var(--text-2);
	}
	.del-actions {
		display: grid;
		grid-template-columns: 1fr 1fr;
	}
	.del-kept + .del-actions {
		border-top: var(--hairline);
	}
	.del-actions button {
		height: 64px;
		border: 0;
		background: none;
		color: var(--text-1);
		font: 500 15px var(--font-mono);
		letter-spacing: var(--tracking-label);
		cursor: pointer;
	}
	.del-actions button + button {
		border-left: var(--hairline);
	}
	.del-actions .del-go {
		background: var(--surface-inverse);
		color: var(--text-inverse);
	}
	.del-actions button:disabled {
		opacity: 0.5;
		cursor: default;
	}
</style>

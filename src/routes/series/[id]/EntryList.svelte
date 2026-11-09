<script lang="ts">
	import { onMount, tick } from 'svelte';
	import { longpress } from '$lib/actions/longpress';
	import { enhance } from '$app/forms';
	import { downloadStatus, rowAction, type DownloadState } from '$lib/library/downloads';
	import { withLive } from '$lib/downloads-live.svelte';
	import OtherForms from './OtherForms.svelte';
	import type { GroupOther, OtherFormRow } from './other-forms.server';
	import { offline } from '$lib/offline.svelte';
	import {
		currentEntry,
		entryAtFraction,
		entryStatus,
		entryTitle,
		findByNumber,
		formatNumber,
		listCount,
		listRows,
		railTicks,
		type SeriesEntry,
		type SeriesPage
	} from '$lib/library/series';

	/**
	 * The chapter list in reading order, with the fold, the scrub rail and #.
	 *
	 * Rows are a fixed height (60px, 52px on a phone), which is what lets the
	 * rail map a fraction straight to a row without measuring anything.
	 */
	let {
		series,
		selecting,
		selected,
		cached,
		descending = $bindable(false),
		onrow,
		onselect,
		onlong,
		onclose,
		downloads = null,
		canDownload = false,
		readOnline = false,
		otherForms = null,
		ongroup
	}: {
		series: SeriesPage;
		/** The same work's other forms (c700): a folded line under the list. */
		otherForms?: OtherFormRow[] | null;
		ongroup?: GroupOther;
		selecting: boolean;
		selected: Set<number>;
		/** Entry ids cached on the device. */
		cached: Set<number>;
		descending?: boolean;
		onrow: (entry: SeriesEntry) => void;
		onselect: () => void;
		/** A long press on a row: mark it and everything before it read. */
		onlong?: (entry: SeriesEntry) => void;
		/**
		 * The text reader's CONTENTS sheet (Index Text Reader, contents): the
		 * same list, headed CONTENTS with a ✕ instead of SELECT, and no # or
		 * rail below 60 entries, where they'd only get in the way.
		 */
		onclose?: () => void;
		/** Each chapter's place in downloading (doc/DOWNLOADING.md); null where downloading has no say. */
		downloads?: Map<number, DownloadState> | null;
		/**
		 * Whether a tap on a row with no file queues it (or retries it, if it
		 * failed): the engine answering, and the device online.
		 */
		canDownload?: boolean;
		/**
		 * A source serves the series (doc/BROWSING.md, "Manga online"; Online Board 2):
		 * a tap on a chapter with no file reads it online, and downloading moves to
		 * a ↓ cell of its own at the end of the row.
		 */
		readOnline?: boolean;
	} = $props();

	const sheet = $derived(onclose !== undefined);
	const tools = $derived(!sheet || series.entries.length >= 60);

	let expanded = $state(false);
	const rows = $derived(listRows(series.entries, { descending, expanded }));
	const ticks = $derived(railTicks(series.entries));
	const novel = $derived(series.kind === 'novel');
	const first = $derived(series.entries[0]?.number ?? 1);
	const last = $derived(series.entries[series.entries.length - 1]?.number ?? 1);
	const span = $derived(Math.max(1, last - first));
	const readUpTo = $derived.by(() => {
		let n = first;
		for (const e of series.entries) if (e.readAt !== null) n = e.number;
		return series.entries.some((e) => e.readAt !== null) ? n : first - 1;
	});
	const current = $derived(currentEntry(series.entries));

	const fractionOf = (n: number) => (n - first) / span;

	// ---- jumping --------------------------------------------------------------

	let flash = $state<number | null>(null);

	async function jumpTo(entry: SeriesEntry, flashIt = false) {
		const folded = rows.some(
			(r) => r.type === 'fold' && entry.number >= r.from && entry.number <= r.to
		);
		if (folded) {
			expanded = true;
			await tick();
		}
		document.getElementById(`entry-${entry.id}`)?.scrollIntoView({ block: 'start' });
		if (flashIt) {
			flash = entry.id;
			setTimeout(() => (flash = null), 1200);
		}
	}

	// In the reader's CONTENTS sheet the list opens on the chapter being read.
	onMount(() => {
		if (sheet && current) void jumpTo(current);
	});

	let jumping = $state(false);
	let jumpValue = $state('');
	let jumpInput = $state<HTMLInputElement | null>(null);

	async function openJump() {
		jumping = true;
		jumpValue = '';
		await tick();
		jumpInput?.focus();
	}

	function submitJump(e: SubmitEvent) {
		e.preventDefault();
		const target = findByNumber(series.entries, Number(jumpValue));
		jumping = false;
		if (target) void jumpTo(target, true);
	}

	// ---- the rail ---------------------------------------------------------------

	let track = $state<HTMLElement | null>(null);
	let dragging = $state<SeriesEntry | null>(null);

	function entryAt(clientY: number): SeriesEntry | null {
		if (!track) return null;
		const box = track.getBoundingClientRect();
		return entryAtFraction(series.entries, (clientY - box.top) / box.height);
	}

	function railDown(e: PointerEvent) {
		(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
		railMove(e);
	}

	function railMove(e: PointerEvent) {
		if (e.type === 'pointermove' && !(e.buttons & 1) && e.pointerType === 'mouse') return;
		const target = entryAt(e.clientY);
		if (!target || target.id === dragging?.id) return;
		dragging = target;
		void jumpTo(target);
	}

	function railUp() {
		dragging = null;
	}

	function railKey(e: KeyboardEvent) {
		const at = dragging ?? current ?? series.entries[0];
		const i = series.entries.indexOf(at);
		const step =
			e.key === 'PageDown'
				? 10
				: e.key === 'PageUp'
					? -10
					: e.key === 'ArrowDown'
						? 1
						: e.key === 'ArrowUp'
							? -1
							: 0;
		const home = e.key === 'Home' ? 0 : e.key === 'End' ? series.entries.length - 1 : null;
		if (step === 0 && home === null) return;
		e.preventDefault();
		const next = series.entries[home ?? Math.min(series.entries.length - 1, Math.max(0, i + step))];
		void jumpTo(next);
		dragging = next;
		setTimeout(() => (dragging = null), 600);
	}

	const thumb = $derived(dragging ?? current);
</script>

<!-- The row that is the button (Download States, "The row is the button"): a form post, so it works without script. -->
{#if canDownload}<form
		id="dl-rows"
		method="POST"
		action="?/download"
		use:enhance
		hidden
	></form>{/if}

<section class="list" aria-label={novel ? 'Contents' : 'Chapters'}>
	<div class="head">
		{#if jumping}
			<form class="jump" onsubmit={submitJump}>
				<label for="jump-to">GO TO #</label>
				<input
					id="jump-to"
					bind:this={jumpInput}
					bind:value={jumpValue}
					inputmode="decimal"
					autocomplete="off"
					onblur={() => (jumping = false)}
					onkeydown={(e) => e.key === 'Escape' && (jumping = false)}
				/>
			</form>
		{:else}
			<div class="title">
				<span>{sheet ? '' : '01 — '}{novel ? 'CONTENTS' : 'CHAPTERS'}</span>
				<span class="long">{listCount(series.entries)}</span>
				<span class="short">{series.entries.length}</span>
			</div>
			{#if !selecting && tools}
				<button type="button" class="tool" onclick={openJump} aria-label="Go to chapter number"
					>#</button
				>
				<button type="button" class="tool sort" onclick={() => (descending = !descending)}>
					{descending
						? `${formatNumber(last)} → ${formatNumber(first)}`
						: `${formatNumber(first)} → ${formatNumber(last)}`}
				</button>
			{/if}
			{#if sheet}
				<button type="button" class="tool close" onclick={onclose} aria-label="Close contents"
					>✕</button
				>
			{:else if !selecting}
				<button type="button" class="tool" onclick={onselect}>SELECT</button>
			{/if}
		{/if}
	</div>

	<div class="body" class:with-rail={!selecting && series.entries.length > 1 && tools}>
		<ol class="rows">
			{#each rows as row (row.type === 'fold' ? 'fold' : row.type === 'entry' ? row.entry.id : row.key)}
				{#if row.type === 'section'}
					<!-- A book's front and back matter, listed apart (doc/TEXT-READER.md). -->
					<li class="section"><span>{row.label}</span><span>{row.detail}</span></li>
				{:else if row.type === 'volume'}
					<!-- A volume's head (c835), still today's text row until its cover and
					     facts land in the next slice. -->
					<li class="section">
						<span>{row.label} · {row.title.toUpperCase()}</span>
						<span>{row.chapters} · {row.read} READ</span>
					</li>
				{:else if row.type === 'fold'}
					<li class="fold">
						<!-- The stripes are a stylesheet picture: the hover tint must not replace them (c488, doc/MOTION.md). -->
						<button type="button" data-picture onclick={() => (expanded = true)}>
							<span>↑ {formatNumber(row.from)} – {formatNumber(row.to)}</span>
							<span class="long">{row.count} READ · SHOW</span>
							<span class="short">READ</span>
						</button>
					</li>
				{:else}
					{@const e = row.entry}
					{@const on = selected.has(e.id)}
					{@const dl = withLive(downloads?.get(e.id))}
					{@const act = !selecting && canDownload && !e.available ? rowAction(dl) : null}
					{@const online = readOnline && !e.available}
					<!-- Offline, a chapter read online can't open: ○ ONLINE ONLY (Online Board 2B). -->
					{@const opens = selecting || e.available || (online && offline.online)}
					<!-- Read online, the row reads and the ↓ cell downloads; otherwise a tap on a
					     row with no file queues it, as it always has (Download States 1a). -->
					{@const rowQueues = !readOnline && !!act}
					<li
						id="entry-{e.id}"
						class="entry {row.state} {dl ? `dl-${dl.kind}` : ''}"
						class:missing={!e.available && !(online && offline.online)}
						class:online-only={online && !offline.online}
						class:matter={!!e.matter}
						class:selected={selecting && on}
						class:flash={flash === e.id}
					>
						<button
							type={rowQueues ? 'submit' : 'button'}
							form={rowQueues ? 'dl-rows' : undefined}
							name={rowQueues ? 'entry' : undefined}
							value={rowQueues ? String(e.id) : undefined}
							aria-label={rowQueues && act === 'queue'
								? `Download ${entryTitle(e, series.kind)}`
								: rowQueues && act === 'retry'
									? `Retry ${entryTitle(e, series.kind)}`
									: undefined}
							class="entry-btn"
							aria-disabled={!opens && !rowQueues}
							aria-pressed={selecting ? on : undefined}
							data-focus-mark="in"
							data-focus-id={`entry-${e.id}`}
							use:longpress={() => !selecting && onlong?.(e)}
							onclick={() => opens && onrow(e)}
						>
							{#if selecting}
								<span class="check" aria-hidden="true"
									><span class="box" class:on>{on ? '✓' : ''}</span></span
								>
							{/if}
							{#if !novel}<span class="num">{formatNumber(e.number)}</span>{/if}
							<span class="text">
								<span class="t">{entryTitle(e, series.kind)}</span>
								{#if row.state === 'progress'}
									{@const p =
										e.pageCount > 0 && e.lastPosition !== null
											? ((e.lastPosition + 1) / e.pageCount) * 100
											: 0}
									<span class="bar"><span style:width="{p}%"></span></span>
								{:else if dl?.kind === 'downloading'}
									<!-- In ink: accent stays reading's. -->
									<span class="bar ink"><span style:width="{dl.fraction * 100}%"></span></span>
								{/if}
							</span>
							<span class="status">
								{#if e.originSource}
									<!-- A chapter kept from the source the series left (doc/MOVE.md). -->
									<span class="src">{e.originSource.toUpperCase()}</span>
								{:else}
									<span class="long"
										>{downloadStatus(dl) ??
											(online && row.state !== 'read'
												? offline.online
													? 'ONLINE'
													: '○ ONLINE ONLY'
												: entryStatus(e, row.state, series.kind))}</span
									>
									<span class="short"
										>{downloadStatus(dl, true) ??
											(online && row.state !== 'read'
												? offline.online
													? 'ONLINE'
													: 'ONLINE ONLY'
												: entryStatus(e, row.state, series.kind, true))}</span
									>
								{/if}
							</span>
							{#if !novel && !readOnline}<span class="cache">{cached.has(e.id) ? '↓' : ''}</span
								>{/if}
						</button>
						{#if readOnline}
							<!-- The ↓ cell: downloading's own target (Online Board 2A); empty on a row
							     with a file, so the column stays straight. -->
							{#if act}
								<button
									type="submit"
									form="dl-rows"
									name="entry"
									value={String(e.id)}
									class="dl-cell"
									aria-label={act === 'retry'
										? `Retry ${entryTitle(e, series.kind)}`
										: `Download ${entryTitle(e, series.kind)}`}
									>{act === 'retry' ? 'RETRY' : '↓'}</button
								>
							{:else}
								<span class="dl-cell empty" aria-hidden="true"
									>{e.available && cached.has(e.id) && !offline.online ? '↓' : ''}</span
								>
							{/if}
						{/if}
					</li>
				{/if}
			{/each}
		</ol>

		{#if !selecting && series.entries.length > 1 && tools}
			<div class="rail">
				<div
					class="track"
					bind:this={track}
					role="slider"
					tabindex="0"
					data-focus-off
					aria-label="Scrub through {series.entries.length} entries"
					aria-valuemin={first}
					aria-valuemax={last}
					aria-valuenow={thumb?.number ?? first}
					onpointerdown={railDown}
					onpointermove={railMove}
					onpointerup={railUp}
					onpointercancel={railUp}
					onkeydown={railKey}
				>
					<div class="read-mark" style:height="{Math.max(0, fractionOf(readUpTo)) * 100}%"></div>
					{#each ticks as t (t.label)}
						<div class="tick" style:top="{t.fraction * 100}%">{t.label}</div>
					{/each}
					{#if thumb}
						<div
							class="thumb"
							class:drag={dragging !== null}
							style:top="{fractionOf(thumb.number) * 100}%"
						>
							{formatNumber(thumb.number)}
						</div>
					{/if}
				</div>
				{#if dragging}
					<div class="bubble" style:top="{fractionOf(dragging.number) * 100}%" aria-live="polite">
						<div class="b-label">DRAGGING · {dragging.readAt !== null ? 'READ' : 'UNREAD'}</div>
						<div class="b-num">{formatNumber(dragging.number)}</div>
						<div class="b-title">{entryTitle(dragging, series.kind)}</div>
					</div>
				{/if}
			</div>
		{/if}
	</div>
	<!-- Outside the rows: the rail reads a fraction of those, and these are not chapters. -->
	{#if otherForms}<ol class="forms">
			<OtherForms rows={otherForms} seriesId={series.id} {ongroup} />
		</ol>{/if}
</section>

<style>
	.list {
		--row-h: 60px;
		--num-w: 80px;
		--rail-w: 56px;
		display: flex;
		flex-direction: column;
		min-width: 0;
	}
	@media (max-width: 599px) {
		.list {
			--row-h: 52px;
			--num-w: 60px;
			--rail-w: 44px;
		}
	}
	.head {
		position: sticky;
		top: var(--list-top, 0);
		z-index: 3;
		flex-shrink: 0;
		display: flex;
		align-items: stretch;
		height: 52px;
		border-bottom: var(--hairline);
		background: var(--surface-page);
	}
	.title {
		flex: 1;
		min-width: 0;
		display: flex;
		align-items: center;
		gap: 14px;
		padding: 0 var(--pad);
		font: 500 13px var(--font-mono);
		color: var(--text-2);
		letter-spacing: var(--tracking-label);
		white-space: nowrap;
		overflow: hidden;
	}
	.tool {
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
		white-space: nowrap;
		cursor: pointer;
	}
	@media (min-width: 1024px) {
		.tool {
			padding: 0 18px;
		}
	}
	/* The phone has no room for the sort label; # and SELECT stay. */
	@media (max-width: 599px) {
		.tool.sort {
			display: none;
		}
		.tool {
			padding: 0 14px;
		}
	}
	.tool:active {
		background: var(--surface-inverse);
		color: var(--text-inverse);
	}
	.jump {
		flex: 1;
		display: flex;
		align-items: center;
		gap: 12px;
		padding: 0 var(--pad);
		border-bottom: var(--rule-strong);
		font: 500 13px var(--font-mono);
		color: var(--text-2);
		letter-spacing: var(--tracking-label);
	}
	.jump input {
		flex: 1;
		min-width: 0;
		background: transparent;
		border: 0;
		outline: none;
		color: var(--text-1);
		caret-color: var(--accent);
		font: 500 18px var(--font-mono);
	}

	.body {
		position: relative;
		display: grid;
		grid-template-columns: minmax(0, 1fr);
	}
	.body.with-rail {
		grid-template-columns: minmax(0, 1fr) var(--rail-w);
	}
	.forms {
		list-style: none;
		margin: 0;
		padding: 0;
	}
	.rows {
		list-style: none;
		margin: 0;
		padding: 0;
		min-width: 0;
	}
	/* Known from the backup, no file on disk: listed, not readable. */
	.entry.missing:not(.read) .t {
		color: var(--text-2);
	}
	.fold button,
	.entry-btn {
		width: 100%;
		height: var(--row-h);
		display: flex;
		align-items: stretch;
		border: 0;
		border-bottom: var(--hairline);
		border-radius: 0;
		background: transparent;
		color: var(--text-1);
		padding: 0;
		text-align: left;
		font: inherit;
	}
	.entry {
		scroll-margin-top: calc(var(--list-top, 0px) + 52px);
	}
	.entry-btn[aria-disabled='true'] {
		cursor: default;
		color: inherit;
	}
	.entry-btn:not([aria-disabled='true']) {
		cursor: pointer;
	}
	.section {
		display: flex;
		justify-content: space-between;
		padding: 16px var(--pad) 8px;
		border-bottom: var(--hairline);
		font: 500 13px var(--font-mono);
		letter-spacing: 0.06em;
		color: var(--text-2);
	}
	/* Front and back matter: reachable, but not read as chapters. */
	.entry.matter .entry-btn {
		height: 44px;
		font-size: 14px;
		color: var(--text-2);
	}
	.fold button {
		align-items: center;
		justify-content: space-between;
		gap: 12px;
		padding: 0 var(--pad);
		font: 500 13px var(--font-mono);
		color: var(--text-2);
		letter-spacing: 0.04em;
		background: repeating-linear-gradient(
			135deg,
			var(--surface-panel) 0 6px,
			var(--surface-page) 6px 12px
		);
		cursor: pointer;
	}
	.short {
		display: none;
	}
	@media (max-width: 599px) {
		.long {
			display: none;
		}
		.short {
			display: inline;
		}
	}
	.entry.progress .entry-btn {
		background: var(--surface-panel);
	}
	.entry.selected .entry-btn {
		background: var(--accent-select);
	}
	.entry.flash .entry-btn {
		box-shadow: inset 3px 0 0 var(--accent);
	}
	.check {
		width: 60px;
		flex-shrink: 0;
		display: flex;
		align-items: center;
		justify-content: center;
	}
	.box {
		width: 24px;
		height: 24px;
		border: 1.5px solid var(--line-2);
		display: flex;
		align-items: center;
		justify-content: center;
		font: 500 14px var(--font-mono);
		color: var(--on-accent);
	}
	.box.on {
		border-color: var(--accent);
		background: var(--accent);
	}
	.num {
		width: var(--num-w);
		flex-shrink: 0;
		padding-left: var(--pad);
		display: flex;
		align-items: center;
		/* A long number is cut, never drawn over the title. */
		overflow: hidden;
		white-space: nowrap;
		padding-right: 8px;
		box-sizing: border-box;
		font: 500 14px var(--font-mono);
		color: var(--text-2);
	}
	.list:has(.check) .num {
		padding-left: 0;
	}
	.text {
		flex: 1;
		min-width: 0;
		display: flex;
		flex-direction: column;
		justify-content: center;
		gap: 7px;
		padding-right: 12px;
	}
	.list:not(:has(.num)) .text {
		padding-left: var(--pad);
	}
	.t {
		font: 400 16px var(--font-sans);
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}
	.entry.read .t {
		color: var(--text-2);
	}
	.entry.progress .t {
		font-weight: 500;
	}
	.bar {
		height: 2px;
		background: var(--line-1);
	}
	.bar > span {
		display: block;
		height: 2px;
		background: var(--accent);
	}
	.status {
		display: flex;
		align-items: center;
		padding: 0 10px;
		font: 500 13px var(--font-mono);
		color: var(--text-2);
		white-space: nowrap;
	}
	.entry.progress .status {
		color: var(--accent);
	}
	/* A chapter kept from the source the series left (doc/MOVE.md; the handoff's
	   22px `.src` cell), its own box in the status column. */
	.src {
		display: inline-flex;
		align-items: center;
		height: 22px;
		max-width: 160px;
		padding: 0 7px;
		overflow: hidden;
		border: 1px solid var(--line-2);
		color: var(--text-2);
		font: 500 11px var(--font-mono);
		letter-spacing: 0.06em;
		text-overflow: ellipsis;
	}
	/* Downloading (Index Series Download, rows): under way in ink, and FAILED the only
	   row in full ink at 500 with a 3px ink rule -- the # jump's flash, in ink. */
	.entry.dl-queued .status,
	.entry.dl-downloading .status,
	.entry.dl-failed .status {
		color: var(--text-1);
	}
	.entry.dl-failed .entry-btn {
		box-shadow: inset 3px 0 0 var(--text-1);
	}
	.bar.ink > span {
		background: var(--text-1);
	}
	/* The ↓ cell (Online Board 2): 72px, 56px on the phone, over the 44px minimum. */
	.entry:has(.dl-cell) {
		display: flex;
	}
	.entry:has(.dl-cell) .entry-btn {
		flex: 1;
		min-width: 0;
	}
	.dl-cell {
		width: 72px;
		flex-shrink: 0;
		display: flex;
		align-items: center;
		justify-content: center;
		border: 0;
		border-left: var(--hairline);
		background: none;
		color: var(--text-1);
		font: 500 14px var(--font-mono);
		letter-spacing: 0.04em;
		cursor: pointer;
	}
	.dl-cell.empty {
		color: var(--text-2);
		cursor: default;
	}
	@media (max-width: 599px) {
		.dl-cell {
			width: 56px;
		}
	}
	/* Offline, a chapter read online dims and stays closed. */
	.entry.online-only .entry-btn,
	.entry.online-only .dl-cell {
		opacity: 0.35;
	}
	.cache {
		width: 40px;
		flex-shrink: 0;
		display: flex;
		align-items: center;
		justify-content: center;
		font: 500 14px var(--font-mono);
		color: var(--text-2);
	}

	/* ---- the rail ---- */
	.rail {
		position: sticky;
		top: calc(var(--list-top, 0px) + 52px);
		align-self: start;
		height: var(--rail-h, calc(100dvh - var(--list-top, 0px) - 52px - var(--banner-h, 0px)));
		border-left: var(--hairline);
		background: var(--surface-page);
	}
	.track {
		position: absolute;
		inset: 20px 0;
		touch-action: none;
		cursor: ns-resize;
		outline: none;
	}
	.track:focus-visible {
		box-shadow: inset 0 0 0 1px var(--text-1);
	}
	/* Not `.read`: that is also an entry's state class, and a shared name once
	   pulled every read row to the top of the list. */
	.read-mark {
		position: absolute;
		left: 0;
		top: 0;
		width: 3px;
		background: var(--accent);
	}
	.tick {
		position: absolute;
		left: 0;
		right: 0;
		transform: translateY(-50%);
		display: flex;
		justify-content: flex-end;
		padding-right: 8px;
		font: 400 11px var(--font-mono);
		color: var(--text-2);
		pointer-events: none;
	}
	.thumb {
		position: absolute;
		left: -1px;
		right: 0;
		transform: translateY(-50%);
		height: 32px;
		display: flex;
		align-items: center;
		justify-content: center;
		background: var(--surface-page);
		color: var(--accent);
		border: 1px solid var(--accent);
		font: 500 12px var(--font-mono);
		pointer-events: none;
	}
	.thumb.drag {
		background: var(--surface-inverse);
		color: var(--text-inverse);
		border-color: var(--surface-inverse);
	}
	.bubble {
		position: absolute;
		right: calc(var(--rail-w) + 16px);
		margin-top: 20px;
		transform: translateY(-50%);
		display: flex;
		flex-direction: column;
		gap: 8px;
		padding: 18px 22px;
		min-width: 220px;
		background: var(--surface-inverse);
		color: var(--text-inverse);
		pointer-events: none;
		z-index: 4;
	}
	.b-label {
		font: 500 12px var(--font-mono);
		letter-spacing: var(--tracking-label);
		opacity: 0.7;
	}
	.b-num {
		font: 500 36px var(--font-mono);
	}
	.b-title {
		font: 400 14px var(--font-sans);
	}
	/* ---- the TV (c238; TV-Series) ----------------------------------------- */
	@media (pointer: none) and (min-width: 900px) {
		.list {
			--row-h: 56px;
			--num-w: 64px;
			--rail-w: 56px;
			border: var(--hairline);
		}
		/* The list's own label is the 36px band TV-Series draws at `01`. */
		.head {
			height: 36px;
		}
		.title,
		.tool {
			font: var(--type-label);
		}
		.t {
			font-size: 17px;
		}
		.status {
			font: var(--type-meta);
		}
		.rail {
			top: 36px;
		}
	}
</style>

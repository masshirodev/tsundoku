<script lang="ts">
	import { tick } from 'svelte';
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
		onselect
	}: {
		series: SeriesPage;
		selecting: boolean;
		selected: Set<number>;
		/** Entry ids cached on the device. */
		cached: Set<number>;
		descending?: boolean;
		onrow: (entry: SeriesEntry) => void;
		onselect: () => void;
	} = $props();

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
				<span>01 — {novel ? 'CONTENTS' : 'CHAPTERS'}</span>
				<span class="long">{listCount(series.entries)}</span>
				<span class="short">{series.entries.length}</span>
			</div>
			{#if !selecting}
				<button type="button" class="tool" onclick={openJump} aria-label="Go to chapter number"
					>#</button
				>
				<button type="button" class="tool sort" onclick={() => (descending = !descending)}>
					{descending
						? `${formatNumber(last)} → ${formatNumber(first)}`
						: `${formatNumber(first)} → ${formatNumber(last)}`}
				</button>
				<button type="button" class="tool" onclick={onselect}>SELECT</button>
			{/if}
		{/if}
	</div>

	<div class="body" class:with-rail={!selecting && series.entries.length > 1}>
		<ol class="rows">
			{#each rows as row (row.type === 'fold' ? 'fold' : row.entry.id)}
				{#if row.type === 'fold'}
					<li class="fold">
						<button type="button" onclick={() => (expanded = true)}>
							<span>↑ {formatNumber(row.from)} – {formatNumber(row.to)}</span>
							<span class="long">{row.count} READ · SHOW</span>
							<span class="short">READ</span>
						</button>
					</li>
				{:else}
					{@const e = row.entry}
					{@const on = selected.has(e.id)}
					<li
						id="entry-{e.id}"
						class="entry {row.state}"
						class:missing={!e.available}
						class:selected={selecting && on}
						class:flash={flash === e.id}
					>
						<button
							type="button"
							class="entry-btn"
							disabled={!selecting}
							aria-pressed={selecting ? on : undefined}
							onclick={() => onrow(e)}
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
								{/if}
							</span>
							<span class="status">
								<span class="long">{entryStatus(e, row.state, series.kind)}</span>
								<span class="short">{entryStatus(e, row.state, series.kind, true)}</span>
							</span>
							{#if !novel}<span class="cache">{cached.has(e.id) ? '↓' : ''}</span>{/if}
						</button>
					</li>
				{/if}
			{/each}
		</ol>

		{#if !selecting && series.entries.length > 1}
			<div class="rail">
				<div
					class="track"
					bind:this={track}
					role="slider"
					tabindex="0"
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
	.rows {
		list-style: none;
		margin: 0;
		padding: 0;
		min-width: 0;
	}
	.fold button,
	/* Known from the backup, no file on disk: listed, not readable. */
	.entry.missing:not(.read) .t {
		color: var(--text-2);
	}
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
	.entry-btn:disabled {
		cursor: default;
		color: inherit;
	}
	.entry-btn:not(:disabled) {
		cursor: pointer;
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
</style>

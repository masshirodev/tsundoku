<script lang="ts">
	import { enhance } from '$app/forms';
	import Sheet from '$lib/components/chrome/Sheet.svelte';
	import Cover from '$lib/components/content/Cover.svelte';
	import { moveItem, orderBooks, sharedStart, type OrderMode } from '$lib/library/books';
	import { addedMonth } from '$lib/library/series';

	/**
	 * Grouping books by hand (Index Books, state 6): NEW SERIES or ADD TO
	 * EXISTING, a name defaulting to the words every title starts with, and an
	 * order defaulting to date added, fixable here or later with ORDER.
	 *
	 * Opened from the library's bulk bar with the selection, or from a
	 * suggestion's REVIEW → with `suggested` set: then each row has a tick, and
	 * the books left unticked are recorded as not belonging (the whole set is
	 * stored as dismissed, so the suggestion doesn't return).
	 */
	type Book = { seriesId: number; title: string; hue: number; addedAt: number };

	let {
		open,
		books,
		existing,
		suggested = false,
		onclose
	}: {
		open: boolean;
		books: Book[];
		existing: { id: number; title: string; books: number }[];
		suggested?: boolean;
		onclose: () => void;
	} = $props();

	let mode = $state<'new' | 'existing'>('new');
	let orderMode = $state<OrderMode>('date');
	let rows = $state<Book[]>([]);
	let ticked = $state<number[]>([]);
	let name = $state('');
	let into = $state<number | null>(null);

	// Each time the sheet opens, start from the given books.
	$effect(() => {
		if (!open) return;
		const byDate = orderBooks(
			books.map((b) => ({ ...b, id: b.seriesId })),
			'date'
		);
		rows = byDate;
		orderMode = 'date';
		mode = 'new';
		into = existing[0]?.id ?? null;
		ticked = books.map((b) => b.seriesId);
		name = sharedStart(books.map((b) => b.title));
	});

	function setOrder(m: OrderMode) {
		orderMode = m;
		if (m !== 'hand')
			rows = orderBooks(
				rows.map((b) => ({ ...b, id: b.seriesId })),
				m
			);
	}

	function nudge(i: number, by: number) {
		rows = moveItem(rows, i, i + by);
		orderMode = 'hand';
	}

	function toggle(id: number) {
		ticked = ticked.includes(id) ? ticked.filter((t) => t !== id) : [...ticked, id];
	}

	const chosen = $derived(rows.filter((b) => ticked.includes(b.seriesId)));
	/** Reading positions for the ticked rows; an unticked row shows a dash. */
	const numbers = $derived.by(() => {
		let n = 0;
		const out: Record<number, string> = {};
		for (const b of rows)
			out[b.seriesId] = ticked.includes(b.seriesId) ? String(++n).padStart(2, '0') : '—';
		return out;
	});
	const orderLabel = $derived(
		orderMode === 'date' ? 'BY DATE ADDED' : orderMode === 'title' ? 'BY TITLE' : 'BY HAND'
	);
	const canCreate = $derived(
		mode === 'new' ? chosen.length >= 2 && name.trim() !== '' : chosen.length >= 1 && into !== null
	);
	const title = $derived(
		suggested
			? `SUGGESTED · ${chosen.length} OF ${books.length} TICKED`
			: `GROUP ${books.length} BOOKS`
	);
</script>

<Sheet {open} {onclose} label="Group into a series">
	<form method="POST" action="/?/group" use:enhance class="group">
		<div class="head">
			<div class="h-title">{title}</div>
			<button type="button" class="cancel" onclick={onclose}>CANCEL</button>
		</div>

		<div class="modes" role="radiogroup" aria-label="Group into">
			<button
				type="button"
				role="radio"
				aria-checked={mode === 'new'}
				class:on={mode === 'new'}
				onclick={() => (mode = 'new')}>NEW SERIES</button
			>
			<button
				type="button"
				role="radio"
				aria-checked={mode === 'existing'}
				class:on={mode === 'existing'}
				disabled={existing.length === 0}
				onclick={() => (mode = 'existing')}>ADD TO EXISTING · {existing.length}</button
			>
		</div>

		{#if mode === 'new'}
			<div class="label"><span>NAME</span><span>WORDS EVERY TITLE STARTS WITH</span></div>
			<input
				class="name"
				name="name"
				bind:value={name}
				aria-label="Series name"
				autocomplete="off"
			/>
		{:else}
			<div class="label"><span>SERIES</span><span>SAME LIBRARY ROOT</span></div>
			<div class="existing">
				{#each existing as s (s.id)}
					<label class="ex" class:on={into === s.id}>
						<input
							type="radio"
							name="into"
							value={s.id}
							checked={into === s.id}
							onchange={() => (into = s.id)}
						/>
						<span class="ex-title">{s.title}</span>
						<span class="dim">{s.books} BOOKS</span>
					</label>
				{/each}
			</div>
		{/if}

		<div class="label order-label"><span>ORDER</span><span>{orderLabel}</span></div>
		<div class="seg">
			<button type="button" class:on={orderMode === 'date'} onclick={() => setOrder('date')}
				>BY DATE</button
			>
			<button type="button" class:on={orderMode === 'title'} onclick={() => setOrder('title')}
				>BY TITLE</button
			>
			<button type="button" class:on={orderMode === 'hand'} onclick={() => setOrder('hand')}
				>BY HAND</button
			>
		</div>

		<ol class="rows">
			{#each rows as b, i (b.seriesId)}
				{@const on = ticked.includes(b.seriesId)}
				<li class="row" class:off={!on}>
					{#if suggested}
						<button
							type="button"
							class="tick"
							role="checkbox"
							aria-checked={on}
							aria-label="Include {b.title}"
							onclick={() => toggle(b.seriesId)}
							><span class="box" class:on>{on ? '✓' : ''}</span></button
						>
					{/if}
					<span class="num">{numbers[b.seriesId]}</span>
					<span class="cov"><Cover hue={b.hue} width={34} height={49} /></span>
					<span class="t">{b.title}</span>
					<span class="d">{addedMonth(b.addedAt)}</span>
					<button
						type="button"
						class="nudge"
						aria-label="Move {b.title} up"
						disabled={i === 0}
						onclick={() => nudge(i, -1)}>↑</button
					>
					<button
						type="button"
						class="nudge"
						aria-label="Move {b.title} down"
						disabled={i === rows.length - 1}
						onclick={() => nudge(i, 1)}>↓</button
					>
				</li>
			{/each}
		</ol>

		{#each chosen as b (b.seriesId)}<input type="hidden" name="series" value={b.seriesId} />{/each}
		{#if suggested}
			{#each books as b (b.seriesId)}<input
					type="hidden"
					name="suggested"
					value={b.seriesId}
				/>{/each}
		{/if}
		<input type="hidden" name="order" value={orderLabel} />
		<input type="hidden" name="mode" value={mode} />

		<div class="foot">
			<button type="submit" class="create" disabled={!canCreate}>
				{mode === 'new' ? `CREATE SERIES · ${chosen.length} BOOKS` : `ADD ${chosen.length} BOOKS`}
			</button>
			{#if suggested}
				<button type="submit" class="not" formaction="?/dismiss">NOT A SERIES</button>
			{/if}
		</div>
	</form>
</Sheet>

<style>
	.group {
		display: flex;
		flex-direction: column;
	}
	.head {
		flex-shrink: 0;
		display: flex;
		align-items: stretch;
		height: 64px;
		border-bottom: var(--hairline);
	}
	.h-title {
		flex: 1;
		display: flex;
		align-items: center;
		padding: 0 24px;
		font: 500 15px var(--font-mono);
		letter-spacing: 0.04em;
	}
	button {
		border: 0;
		border-radius: 0;
		background: transparent;
		color: var(--text-1);
		cursor: pointer;
	}
	button:disabled {
		opacity: 0.4;
		cursor: default;
	}
	.cancel {
		padding: 0 28px;
		border-left: var(--hairline);
		font: 500 14px var(--font-mono);
		letter-spacing: 0.04em;
	}
	.modes {
		display: flex;
		height: 56px;
		border-bottom: var(--hairline);
	}
	.modes button {
		flex: 1;
		font: 500 14px var(--font-mono);
		letter-spacing: 0.04em;
	}
	.on {
		background: var(--surface-inverse);
		color: var(--text-inverse);
	}
	.label {
		display: flex;
		justify-content: space-between;
		padding: 18px 24px 10px;
		font: 500 13px var(--font-mono);
		color: var(--text-2);
		letter-spacing: var(--tracking-label);
	}
	.order-label {
		padding-top: 22px;
	}
	.name {
		margin: 0 24px;
		height: 52px;
		padding: 0 16px;
		border: var(--rule-strong);
		border-radius: 0;
		background: transparent;
		color: var(--text-1);
		caret-color: var(--accent);
		font: 500 17px var(--font-sans);
		outline: none;
	}
	.existing {
		display: flex;
		flex-direction: column;
		border-top: var(--hairline);
	}
	.ex {
		display: flex;
		align-items: center;
		gap: 12px;
		height: 52px;
		padding: 0 24px;
		border-bottom: var(--hairline);
		cursor: pointer;
	}
	.ex input {
		position: absolute;
		opacity: 0;
		pointer-events: none;
	}
	.ex-title {
		flex: 1;
		font: 500 16px var(--font-sans);
	}
	.dim {
		font: 400 13px var(--font-mono);
		color: var(--text-2);
	}
	.ex.on .dim {
		color: inherit;
	}
	.seg {
		display: flex;
		height: 52px;
		border-top: var(--hairline);
		border-bottom: var(--hairline);
	}
	.seg button {
		flex: 1;
		border-right: var(--hairline);
		font: 500 14px var(--font-mono);
	}
	.seg button:last-child {
		border-right: 0;
	}
	.rows {
		list-style: none;
		margin: 0;
		padding: 0;
	}
	.row {
		display: flex;
		align-items: stretch;
		height: 64px;
		border-bottom: var(--hairline);
	}
	.row.off {
		opacity: 0.4;
	}
	.tick {
		width: 64px;
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
		width: 64px;
		flex-shrink: 0;
		padding-left: 24px;
		display: flex;
		align-items: center;
		font: 500 14px var(--font-mono);
		color: var(--text-2);
	}
	.tick + .num {
		padding-left: 0;
	}
	.cov {
		display: flex;
		align-items: center;
		padding-right: 16px;
	}
	.t {
		flex: 1;
		min-width: 0;
		display: flex;
		align-items: center;
		font: 400 16px var(--font-sans);
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}
	.d {
		display: flex;
		align-items: center;
		padding: 0 16px;
		font: 400 13px var(--font-mono);
		color: var(--text-2);
	}
	.nudge {
		width: 56px;
		flex-shrink: 0;
		border-left: var(--hairline);
		font: 500 15px var(--font-mono);
	}
	.nudge:active:not(:disabled) {
		background: var(--surface-inverse);
		color: var(--text-inverse);
	}
	.foot {
		display: flex;
		height: 68px;
		margin-top: 24px;
		border-top: var(--hairline);
	}
	.create {
		flex: 2;
		background: var(--accent);
		color: var(--on-accent);
		font: 500 15px var(--font-mono);
	}
	.not {
		flex: 1;
		color: var(--text-2);
		font: 500 15px var(--font-mono);
	}
	@media (max-width: 599px) {
		.d {
			display: none;
		}
		.nudge {
			width: 48px;
		}
	}
</style>

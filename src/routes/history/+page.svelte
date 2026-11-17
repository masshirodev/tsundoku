<script lang="ts">
	import { enhance } from '$app/forms';
	import { invalidateAll } from '$app/navigation';
	import { resolve } from '$app/paths';
	import TopBar from '$lib/components/chrome/TopBar.svelte';
	import { kindFacts } from '$lib/library/kinds';
	import Band from '$lib/components/chrome/Band.svelte';
	import Cover from '$lib/components/content/Cover.svelte';
	import { longpress } from '$lib/actions/longpress';
	import { registerBack } from '$lib/focus';
	import { coverSrc, seriesHref } from '$lib/library/links';
	import type { HistoryRow } from '$lib/library/history';

	/**
	 * History: CONTINUE going further back. One row per series per day; a tap
	 * opens the series, a long press offers REMOVE, which removes the row and
	 * nothing else. doc/HISTORY.md has the rules.
	 */
	let { data, form } = $props();

	/** The row whose long press is showing REMOVE, as `seriesId@day`. */
	let pressed = $state<string | null>(null);
	/** A record just added from here: the band says so, with OPEN →. */
	let added = $state<{ seriesId: number; title: string } | null>(null);
	const addHref = (preview: string) => `${resolve('/downloads/source/[id]', { id: preview })}?/add`;
	const findHref = (title: string) =>
		`${resolve('/downloads/search')}?q=${encodeURIComponent(title)}`;
	const addForm = (r: HistoryRow) => () => {
		return async ({ result }: { result: { type: string } }) => {
			pressed = null;
			if (result.type === 'redirect') {
				added = { seriesId: r.seriesId, title: r.title };
				await invalidateAll();
			}
		};
	};
	const keyOf = (r: HistoryRow) => `${r.seriesId}@${r.day}`;

	/**
	 * The answer the band's ✕ cleared: only that answer, so the next
	 * action's new `form` draws its own band.
	 */
	let droppedAnswer = $state.raw<typeof form>(null);
	const latest = $derived(form === droppedAnswer ? null : form);
	const dropAnswer = () => (droppedAnswer = form);
	const removed = $derived(latest && 'removed' in latest ? latest.removed : null);

	/** "CH. 22 STAYS": what the pressed row promises to keep. */
	function stays(r: HistoryRow): string {
		if (r.entryCount <= 1) return 'PROGRESS STAYS';
		const where =
			kindFacts(r.kind).grouping === 'books' ? `BOOK ${r.last.rank}` : r.last.label.toUpperCase();
		return `${where} STAYS`;
	}

	// A long press puts a row's REMOVE up in the row itself: BACK takes it back
	// down before it leaves the screen (doc/TV.md).
	$effect(() =>
		registerBack(() => {
			if (!pressed) return false;
			pressed = null;
			return true;
		})
	);

	const olderHref = $derived(
		data.older
			? `${resolve('/history')}?${new URLSearchParams({ before: data.older, n: String(data.next) })}`
			: null
	);
</script>

<svelte:head><title>History · tsundoku</title></svelte:head>

<div class="history">
	<TopBar label="History">
		{#snippet left()}
			<a class="back" href={resolve('/')}><span class="arrow">←</span><span>LIBRARY</span></a>
		{/snippet}
		{#snippet middle()}
			<h1 class="title">HISTORY</h1>
		{/snippet}
	</TopBar>

	{#if removed}
		<Band title="REMOVED · PROGRESS KEPT" ondismiss={dropAnswer}>
			{#snippet action()}
				<form method="POST" action="?/undo" use:enhance>
					<input type="hidden" name="series" value={removed.series} />
					<input type="hidden" name="day" value={removed.day} />
					<button type="submit">UNDO</button>
				</form>
			{/snippet}
		</Band>
	{/if}

	{#if added}
		<Band
			title="ADDED · PROGRESS KEPT"
			detail="ITS READING COUNTS FROM ITS FIRST DAY"
			ondismiss={() => (added = null)}
		>
			{#snippet action()}
				<!-- eslint-disable-next-line svelte/no-navigation-without-resolve -- seriesHref() resolves -->
				<a href={seriesHref(added!.seriesId)}>OPEN →</a>
			{/snippet}
		</Band>
	{/if}

	{#if data.days.length === 0}
		<section class="empty">
			<div class="empty-label">00 — NO HISTORY</div>
			<h2>Nothing read yet.</h2>
			<p>Each day you read, the series you opened are listed here with how far you got.</p>
		</section>
		<div class="empty-after" aria-hidden="true"></div>
	{:else}
		{#if data.total}
			<!-- Time read: the reading log's, for everything shown here. -->
			<section class="total" aria-label="Time read">
				<div class="total-line">
					<span>READ {data.total.time}</span><span>{data.total.since}</span>
				</div>
				<ul class="kinds">
					{#each data.total.kinds as k (k.kind)}
						<li>
							{k.label}
						</li>
					{/each}
				</ul>
			</section>
		{/if}
		<div class="days">
			{#each data.days as d, di (d.day)}
				<div class="day-label" class:first={di === 0}>
					<span>{d.left}</span><span>{d.right}</span>
				</div>
				<ol class="rows">
					{#each d.rows as r (keyOf(r))}
						{@const isPressed = pressed === keyOf(r)}
						{@const record = r.inLibrary === false && !r.pruned}
						<li class="row" class:pressed={isPressed} class:record class:pruned={!!r.pruned}>
							<!-- eslint-disable svelte/no-navigation-without-resolve -- seriesHref() resolves -->
							<a
								class="main"
								href={r.pruned ? findHref(r.title) : seriesHref(r.seriesId, 'history')}
								use:longpress={() => (pressed = keyOf(r))}
								onclick={(e) => {
									if (pressed) {
										e.preventDefault();
										pressed = null;
									}
								}}
							>
								<span class="cov"
									><Cover
										src={r.pruned ? null : coverSrc(r.seriesId, r.cover)}
										hue={r.hue}
										width={44}
										height={62}
									/></span
								>
								<span class="text">
									<span class="t">{r.title}</span>
									{#if isPressed}
										<span class="m">REMOVES THIS ROW · {stays(r)}</span>
									{:else}
										<span class="m long">{r.meta}</span>
										<span class="m short">{r.metaShort}</span>
									{/if}
								</span>
								{#if !isPressed}<span class="time"
										><span>{r.time}</span>{#if r.spent}<span class="spent">{r.spent}</span
											>{/if}</span
									>{/if}
							</a>
							{#if !isPressed && record && r.preview}
								<!-- + ADD on the row, so adding needn't go through the preview. -->
								<form
									method="POST"
									action={addHref(r.preview)}
									use:enhance={addForm(r)}
									class="act-form wide"
								>
									<button type="submit" class="act cell">+ ADD</button>
								</form>
							{:else if !isPressed && r.pruned}
								<!-- Its place went with it: FIND searches the sources for a fresh one. -->
								<a class="act cell wide" href={findHref(r.title)}>FIND →</a>
							{/if}
							<!-- eslint-enable svelte/no-navigation-without-resolve -->
							{#if isPressed && record && r.preview}
								<!-- The phone has no room for the cell: + ADD leads the long press. -->
								<form
									method="POST"
									action={addHref(r.preview)}
									use:enhance={addForm(r)}
									class="act-form"
								>
									<button type="submit" class="act add">+ ADD</button>
								</form>
							{/if}
							{#if isPressed}
								<form
									method="POST"
									action="?/remove"
									use:enhance={() =>
										async ({ update }) => {
											pressed = null;
											await update();
										}}
									class="act-form"
								>
									<input type="hidden" name="series" value={r.seriesId} />
									<input type="hidden" name="day" value={r.day} />
									<button type="submit" class="act">REMOVE</button>
								</form>
								<button
									type="button"
									class="act x"
									aria-label="Keep this row"
									onclick={() => (pressed = null)}>✕</button
								>
							{/if}
						</li>
					{/each}
				</ol>
			{/each}
			{#if olderHref}
				<!-- eslint-disable-next-line svelte/no-navigation-without-resolve -- olderHref is built from resolve() -->
				<a class="older" href={olderHref}>EARLIER <span aria-hidden="true">→</span></a>
			{/if}
		</div>
	{/if}
</div>

<style>
	.history {
		flex: 1;
		display: flex;
		flex-direction: column;
		min-height: calc(100dvh - var(--banner-h, 0px));
	}
	.back {
		display: flex;
		align-items: center;
		gap: 14px;
		padding: 0 var(--pad);
		color: var(--text-1);
		font: 500 14px var(--font-mono);
		letter-spacing: 0.04em;
		text-decoration: none;
	}
	.arrow {
		font-size: 17px;
	}
	.title {
		margin: 0;
		padding: 0 18px;
		font: 500 17px var(--font-mono);
	}
	.empty {
		flex: 1;
		display: flex;
		flex-direction: column;
		justify-content: center;
		gap: 28px;
		padding: 0 64px;
		max-width: 720px;
	}
	/* The mock centres the message in the upper half, not the whole screen. */
	.empty-after {
		flex: 1;
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
	.empty h2 {
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
	.day-label {
		display: flex;
		justify-content: space-between;
		padding: 24px var(--pad) 12px;
		font: var(--type-label);
		color: var(--text-2);
		letter-spacing: var(--tracking-label);
	}
	.day-label.first {
		padding-top: 18px;
	}
	.rows {
		list-style: none;
		margin: 0;
		padding: 0;
		border-top: var(--hairline);
	}
	.row {
		display: flex;
		align-items: stretch;
		border-bottom: var(--hairline);
		color: var(--text-1);
	}
	.row.pressed {
		background: var(--surface-inverse);
		color: var(--text-inverse);
	}
	.main {
		flex: 1;
		min-width: 0;
		display: flex;
		align-items: center;
		gap: 16px;
		padding: 10px var(--pad);
		color: inherit;
		text-decoration: none;
		-webkit-touch-callout: none;
		user-select: none;
	}
	.row:not(.pressed) .main:active {
		background: var(--surface-panel);
	}
	.cov {
		flex-shrink: 0;
		display: flex;
	}
	.text {
		flex: 1;
		min-width: 0;
		display: flex;
		flex-direction: column;
		gap: 5px;
	}
	.t,
	.m {
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}
	.t {
		font: 500 16px var(--font-sans);
	}
	.m {
		font: 400 13px var(--font-mono);
		color: var(--text-2);
	}
	.pressed .m {
		color: var(--line-2);
	}
	.m.short {
		display: none;
	}
	.time {
		flex-shrink: 0;
		display: flex;
		flex-direction: column;
		align-items: flex-end;
		gap: 4px;
		font: 500 14px var(--font-mono);
		color: var(--text-2);
	}
	/* The time read that day, under the time of its last event. */
	.spent {
		font: 400 13px var(--font-mono);
		color: var(--text-2);
	}
	.total {
		padding: 18px var(--pad) 14px;
		border-bottom: var(--hairline);
	}
	.total-line {
		display: flex;
		justify-content: space-between;
		gap: 12px;
		font: var(--type-label);
		letter-spacing: var(--tracking-label);
		color: var(--text-1);
	}
	.kinds {
		display: flex;
		flex-wrap: wrap;
		gap: 4px 18px;
		list-style: none;
		margin: 8px 0 0;
		padding: 0;
		font: 400 13px var(--font-mono);
		color: var(--text-2);
	}
	.act-form {
		display: flex;
	}
	/* A record: the cover dashed, as Index dashes what isn't
	   stored; a forgotten one dims to 0.4 and keeps only FIND. */
	.record .cov {
		outline: 1px dashed var(--line-2);
		outline-offset: 2px;
	}
	.pruned .main {
		opacity: 0.4;
	}
	.act.cell {
		border-left: var(--hairline);
		color: var(--text-1);
		text-decoration: none;
		font: 500 13px var(--font-mono);
		letter-spacing: 0.04em;
	}
	.act.add {
		background: var(--accent);
		color: var(--on-accent);
	}
	/* On the phone the cells go: + ADD moves into the long press. */
	@media (max-width: 599px) {
		.wide {
			display: none;
		}
	}
	.act {
		display: flex;
		align-items: center;
		padding: 0 var(--pad);
		border: 0;
		border-left: 1px solid var(--surface-page);
		border-radius: 0;
		background: transparent;
		color: inherit;
		font: 500 14px var(--font-mono);
		cursor: pointer;
	}
	.act.x {
		font-size: 18px;
	}
	.older {
		display: flex;
		align-items: center;
		justify-content: center;
		gap: 10px;
		height: 64px;
		border-bottom: var(--hairline);
		color: var(--text-1);
		font: 500 14px var(--font-mono);
		letter-spacing: 0.04em;
		text-decoration: none;
	}
	@media (max-width: 599px) {
		.m.long {
			display: none;
		}
		.m.short {
			display: block;
		}
		/* Cover sizes itself with inline width and height; the phone's 40×56
		   has to override them. */
		.cov :global(.cover) {
			width: 40px !important;
			height: 56px !important;
		}
	}
</style>

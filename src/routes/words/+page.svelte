<script lang="ts">
	import { enhance } from '$app/forms';
	import { resolve } from '$app/paths';
	import { page } from '$app/state';
	import { SvelteMap } from 'svelte/reactivity';
	import TopBar from '$lib/components/chrome/TopBar.svelte';

	/**
	 * Words: every word looked up while reading Japanese waits here, newest
	 * first, until it's approved or rejected. Unmarked words stay for next
	 * time. SEND records the rejected and sends the approved to a Kumiko
	 * flashcard deck, tagged tsundoku (doc/JAPANESE.md, "Mining").
	 */
	let { data, form } = $props();

	type Mark = 'approve' | 'reject';
	const marks = new SvelteMap<string, Mark>();

	// A series' tab, from the end page's or the series screen's REVIEW →.
	let tab = $state<number | null>(Number(page.url.searchParams.get('series')) || null);

	const tabs = $derived.by(() => {
		// Built and read here only: nothing draws from it as it changes.
		// eslint-disable-next-line svelte/prefer-svelte-reactivity
		const by = new Map<number, { id: number; title: string; n: number }>();
		for (const w of data.words) {
			const t = by.get(w.series.id) ?? { id: w.series.id, title: w.series.title, n: 0 };
			t.n += 1;
			by.set(w.series.id, t);
		}
		return [...by.values()].sort((a, b) => b.n - a.n);
	});
	// A tab whose words are all gone falls back to All.
	const current = $derived(tabs.some((t) => t.id === tab) ? tab : null);
	const shown = $derived(
		current === null ? data.words : data.words.filter((w) => w.series.id === current)
	);

	/** Approved and not yet in Kumiko: they stay marked, for RETRY. */
	const kept = $derived(data.words.filter((w) => w.pending));
	const markOf = (lemma: string, pending: boolean): Mark | null =>
		marks.get(lemma) ?? (pending ? 'approve' : null);

	const approved = $derived(data.words.filter((w) => markOf(w.lemma, w.pending) === 'approve'));
	const rejected = $derived(data.words.filter((w) => marks.get(w.lemma) === 'reject'));
	const fresh = $derived(approved.filter((w) => !w.pending));
	const retrying = $derived(kept.length > 0 && fresh.length === 0 && rejected.length === 0);

	function toggle(lemma: string, m: Mark) {
		if (marks.get(lemma) === m) marks.delete(lemma);
		else marks.set(lemma, m);
	}
	function all(m: Mark) {
		for (const w of shown) marks.set(w.lemma, m);
	}

	const sendLabel = $derived(
		retrying
			? 'RETRY SEND →'
			: approved.length
				? `SEND ${approved.length} TO KUMIKO →`
				: rejected.length
					? `REJECT ${rejected.length} →`
					: 'SEND TO KUMIKO →'
	);
	const sendNote = $derived(
		approved.length || rejected.length
			? [
					approved.length ? `${approved.length} APPROVED` : '',
					rejected.length ? `${rejected.length} REJECTED` : ''
				]
					.filter(Boolean)
					.join(' · ')
			: 'NOTHING APPROVED'
	);
	const nothing = $derived(approved.length === 0 && rejected.length === 0);

	/** What the last SEND came to: a band above the list. */
	const result = $derived(form && 'sent' in form ? form : null);
</script>

<svelte:head><title>Words · tsundoku</title></svelte:head>

<div class="words">
	<TopBar label="Words">
		{#snippet left()}
			<a class="back" href={resolve('/')}><span class="arrow">←</span><span>LIBRARY</span></a>
		{/snippet}
	</TopBar>

	{#if !data.setUp && kept.length > 0}
		<div class="band">
			<span>KUMIKO ISN'T SET UP</span><span class="dim">{kept.length} APPROVED ARE KEPT</span>
		</div>
	{:else if kept.length > 0 || (result && result.failed > 0)}
		<div class="band">
			<span>KUMIKO DID NOT ANSWER</span><span class="dim">{kept.length} APPROVED ARE KEPT</span>
		</div>
	{:else if result && result.sent > 0}
		<div class="band">
			<span>✓ {result.sent} SENT TO KUMIKO</span><span class="dim">YOMU DECK · TAGGED TSUNDOKU</span
			>
		</div>
	{/if}

	{#if data.words.length === 0}
		<div class="label"><span>00 — NO WORDS WAITING</span></div>
		<section class="empty">
			<p>
				Words looked up while reading raw Japanese wait here until you approve them. Approved words
				go to your deck in Kumiko.
			</p>
			<div class="note">{data.sent} SENT SO FAR · NOTHING WAITING</div>
		</section>
	{:else}
		<div class="label">
			<span>01 — WORDS TO REVIEW</span><span>{shown.length} · NEWEST FIRST</span>
		</div>
		<div class="tabs" role="tablist" aria-label="Series">
			<button
				type="button"
				role="tab"
				class="tab all"
				class:on={current === null}
				aria-selected={current === null}
				onclick={() => (tab = null)}
			>
				<span class="tt">All</span><span class="tn">{data.words.length}</span>
			</button>
			{#each tabs as t (t.id)}
				<button
					type="button"
					role="tab"
					class="tab"
					class:on={current === t.id}
					aria-selected={current === t.id}
					onclick={() => (tab = t.id)}
				>
					<span class="tt">{t.title}</span><span class="tn">{t.n}</span>
				</button>
			{/each}
		</div>

		<ol class="rows">
			{#each shown as w (w.lemma)}
				{@const m = markOf(w.lemma, w.pending)}
				<li class="row" class:rejected={m === 'reject'}>
					<div class="word" lang="ja">
						<ruby
							>{w.lemma}{#if w.reading && w.reading !== w.lemma}<rt>{w.reading}</rt>{/if}</ruby
						>
					</div>
					<div class="text">
						<div class="meaning">{w.meaning || '—'}</div>
						<div class="sentence" lang="ja">
							{w.before}{#if w.word}<mark>{w.word}</mark>{/if}{w.after}
						</div>
						<div class="src">
							{#if w.series.hidden}<span class="hidden">HIDDEN</span>{/if}
							<span class="where"
								>{w.series.title.toUpperCase()}{w.where ? ` · ${w.where}` : ''} · ×{w.lookups}</span
							>
						</div>
					</div>
					<button
						type="button"
						class="mark x"
						class:on={m === 'reject'}
						aria-pressed={m === 'reject'}
						aria-label="Reject {w.lemma}"
						onclick={() => toggle(w.lemma, 'reject')}>✕</button
					>
					<button
						type="button"
						class="mark v"
						class:on={m === 'approve'}
						aria-pressed={m === 'approve'}
						aria-label="Approve {w.lemma}"
						onclick={() => toggle(w.lemma, 'approve')}>✓</button
					>
				</li>
			{/each}
		</ol>

		<form
			class="actions"
			method="POST"
			action={retrying ? '?/retry' : '?/send'}
			use:enhance={() =>
				async ({ update }) => {
					marks.clear();
					await update();
				}}
		>
			<input type="hidden" name="approve" value={fresh.map((w) => w.lemma).join('\n')} />
			<input type="hidden" name="reject" value={rejected.map((w) => w.lemma).join('\n')} />
			<button type="button" class="bulk" onclick={() => all('reject')}>
				<span class="bt">REJECT ALL</span><span class="bn">{shown.length}</span>
			</button>
			<button type="button" class="bulk" onclick={() => all('approve')}>
				<span class="bt">APPROVE ALL</span><span class="bn">{shown.length}</span>
			</button>
			<button type="submit" class="send" disabled={nothing}>
				<span class="bt">{sendLabel}</span><span class="bn">{sendNote}</span>
			</button>
		</form>
	{/if}
</div>

<style>
	.words {
		flex: 1;
		display: flex;
		flex-direction: column;
		min-height: 100dvh;
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
	/* What the last SEND came to, on the panel ground. */
	.band {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 12px;
		height: 48px;
		padding: 0 var(--pad);
		border-bottom: var(--hairline);
		background: var(--surface-panel);
		font: 500 14px var(--font-mono);
	}
	.dim {
		color: var(--text-2);
	}
	.label {
		display: flex;
		justify-content: space-between;
		gap: 12px;
		padding: 18px var(--pad) 12px;
		font: 500 13px var(--font-mono);
		letter-spacing: 0.06em;
		color: var(--text-2);
	}
	.empty {
		display: flex;
		flex-direction: column;
		gap: 18px;
		padding: 24px var(--pad) 0;
		border-top: var(--hairline);
	}
	.empty p {
		margin: 0;
		max-width: 560px;
		font: 400 20px/1.5 var(--font-sans);
		color: var(--text-prose);
		text-wrap: pretty;
	}
	.note {
		font: 400 13px var(--font-mono);
		letter-spacing: 0.04em;
		color: var(--text-2);
	}
	.tabs {
		display: flex;
		align-items: stretch;
		height: 52px;
		border-top: var(--hairline);
		border-bottom: var(--hairline);
		overflow-x: auto;
		scrollbar-width: none;
	}
	.tab {
		flex: 1;
		min-width: 0;
		display: flex;
		align-items: center;
		gap: 10px;
		padding: 0 18px;
		border: 0;
		border-right: var(--hairline);
		border-radius: 0;
		background: transparent;
		color: var(--text-1);
		cursor: pointer;
	}
	.tab.all {
		flex: 0 0 auto;
	}
	.tab.on {
		background: var(--surface-inverse);
		color: var(--text-inverse);
	}
	.tt {
		flex: 1;
		min-width: 0;
		font: 500 14px var(--font-sans);
		text-align: left;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}
	.tn {
		font: 500 13px var(--font-mono);
	}
	.rows {
		flex: 1;
		list-style: none;
		margin: 0;
		padding: 0;
	}
	.row {
		display: flex;
		align-items: stretch;
		min-height: 108px;
		border-bottom: var(--hairline);
	}
	/* ✕ inverts its cell and dims the row. */
	.row.rejected {
		opacity: 0.4;
	}
	.word {
		width: 156px;
		flex-shrink: 0;
		display: flex;
		align-items: center;
		padding-left: var(--pad);
		font:
			500 28px/1 'IBM Plex Sans JP',
			var(--font-sans);
	}
	.word rt {
		padding-bottom: 4px;
		font:
			400 13px 'IBM Plex Sans JP',
			var(--font-sans);
		color: var(--text-2);
	}
	.text {
		flex: 1;
		min-width: 0;
		display: flex;
		flex-direction: column;
		justify-content: center;
		gap: 6px;
		padding: 14px 16px 14px 0;
	}
	.meaning {
		font: 400 17px/1.3 var(--font-sans);
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}
	.sentence {
		font:
			400 15px/1.5 'IBM Plex Sans JP',
			var(--font-sans);
		color: var(--text-prose);
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}
	mark {
		background: color-mix(in oklch, var(--accent) 30%, transparent);
		color: var(--text-1);
	}
	.src {
		display: flex;
		align-items: center;
		gap: 8px;
		min-width: 0;
	}
	.hidden {
		flex-shrink: 0;
		padding: 2px 5px;
		background: var(--magenta-400);
		color: var(--graphite-950);
		font: 500 11px var(--font-mono);
		letter-spacing: 0.06em;
	}
	.where {
		min-width: 0;
		font: 400 12px var(--font-mono);
		letter-spacing: 0.04em;
		color: var(--text-2);
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}
	.mark {
		width: 76px;
		flex-shrink: 0;
		display: flex;
		align-items: center;
		justify-content: center;
		border: 0;
		border-left: var(--hairline);
		border-radius: 0;
		background: transparent;
		color: var(--text-2);
		font: 500 18px var(--font-mono);
		cursor: pointer;
	}
	.mark.x.on {
		background: var(--surface-inverse);
		color: var(--text-inverse);
	}
	.mark.v.on {
		background: var(--accent);
		color: var(--on-accent);
	}
	/* The dimmed row's ✕ stays legible: it's how the row comes back. */
	.row.rejected .mark.x {
		opacity: 1;
	}
	.actions {
		position: sticky;
		bottom: 0;
		display: flex;
		align-items: stretch;
		height: 76px;
		border-top: var(--rule-strong);
		background: var(--surface-page);
	}
	.bulk,
	.send {
		flex: 1;
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		gap: 5px;
		border: 0;
		border-right: var(--hairline);
		border-radius: 0;
		background: transparent;
		color: var(--text-1);
		cursor: pointer;
	}
	.send {
		flex: 1.3;
		border-right: 0;
		background: var(--accent);
		color: var(--on-accent);
	}
	.send:disabled {
		background: transparent;
		color: var(--text-2);
		cursor: default;
	}
	.bt {
		font: 500 14px var(--font-mono);
		letter-spacing: 0.04em;
	}
	.bn {
		font: 400 12px var(--font-mono);
		color: inherit;
		opacity: 0.8;
	}
	.bulk .bn {
		color: var(--text-2);
		opacity: 1;
	}
	.bulk:active {
		background: var(--surface-inverse);
		color: var(--text-inverse);
	}
	@media (max-width: 599px) {
		.word {
			width: 112px;
			font-size: 22px;
		}
		.mark {
			width: 56px;
		}
	}
</style>

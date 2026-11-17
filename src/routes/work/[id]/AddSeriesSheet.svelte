<script lang="ts">
	import { enhance } from '$app/forms';
	import { resolve } from '$app/paths';
	import Cover from '$lib/components/content/Cover.svelte';
	import Sheet from '$lib/components/chrome/Sheet.svelte';
	import { coverSrc } from '$lib/library/links';
	import { kindLabel } from '$lib/library/labels';
	import { GRID_PAGE } from '$lib/library/paging';
	import type { AddableSeries } from '$lib/library/works';

	/**
	 * + ADD A SERIES: the library a Work can take, with the Work
	 * a series would move out of. A series belongs to one Work at most, so
	 * adding one that is already elsewhere moves it (doc/WORKS.md, W1's
	 * `addSeries`).
	 *
	 * The library is read here, a page at a time, when the sheet opens: the
	 * Work screen's load never carries it, so a large library costs the screen
	 * nothing until the reader asks for the picker.
	 */
	let {
		open,
		workId,
		made,
		onclose
	}: {
		open: boolean;
		workId: number;
		/** The Work's moment of making, posted so a reused id refuses. */
		made: number;
		onclose: () => void;
	} = $props();

	let q = $state('');
	let items = $state<AddableSeries[]>([]);
	let total = $state(0);
	let loading = $state(false);
	let failed = $state(false);
	let request = 0;

	async function read(more = false, query = q) {
		const seq = ++request;
		loading = true;
		failed = false;
		const url = new URL(resolve(`/work/${workId}/addable`), location.origin);
		url.searchParams.set('q', query.trim());
		url.searchParams.set('offset', String(more ? items.length : 0));
		url.searchParams.set('limit', String(GRID_PAGE));
		try {
			const res = await fetch(url, { headers: { accept: 'application/json' } });
			if (!res.ok) throw new Error(String(res.status));
			const page = (await res.json()) as { items: AddableSeries[]; total: number };
			// A slow answer to an older query must not replace the current one.
			if (seq !== request) return;
			items = more ? [...items, ...page.items] : page.items;
			total = page.total;
		} catch {
			if (seq === request) failed = true;
		} finally {
			if (seq === request) loading = false;
		}
	}

	// The first open reads at once; after that the server is asked 180ms behind
	// the typing, the same beat as the library's own search (doc/LIBRARY.md,
	// "Search"), so a word is one read rather than one per keystroke. The seq
	// guard above keeps a slow answer to an older query off the screen.
	let opened = false;
	$effect(() => {
		if (!open) {
			opened = false;
			return;
		}
		const query = q;
		if (!opened) {
			opened = true;
			void read(false, query);
			return;
		}
		const timer = setTimeout(() => void read(false, query), 180);
		return () => clearTimeout(timer);
	});
</script>

<Sheet {open} {onclose} label="Add a series to this Work">
	<div class="head sheet-head">
		<div class="title">
			<div class="t">+ ADD A SERIES</div>
			<div class="s">FROM THE LIBRARY · {total} TO OFFER</div>
		</div>
		<button type="button" class="cell" onclick={onclose}>CANCEL</button>
	</div>
	<div class="search">
		<input type="search" bind:value={q} placeholder="FIND A SERIES" aria-label="Find a series" />
	</div>
	{#if failed}
		<p class="none">
			THE LIBRARY DID NOT ANSWER ·
			<button type="button" class="retry" onclick={() => read(false)}>RETRY</button>
		</p>
	{:else if loading && items.length === 0}
		<p class="none">READING THE LIBRARY…</p>
	{:else if items.length === 0}
		<p class="none">{q.trim() ? 'NO SERIES MATCHES THAT' : 'EVERY SERIES IS IN A WORK ALREADY'}</p>
	{:else}
		<ul class="rows">
			{#each items as s (s.seriesId)}
				<li>
					<form
						method="POST"
						action="?/add"
						use:enhance={() =>
							async ({ update }) => {
								await update();
								onclose();
							}}
					>
						<input type="hidden" name="series" value={s.seriesId} />
						<input type="hidden" name="made" value={made} />
						<button type="submit" class="row">
							<span class="cov"><Cover src={coverSrc(s.seriesId, s.cover)} hue={s.hue} /></span>
							<span class="tx">
								<span class="a">{s.title}</span>
								<span class="b"
									>{kindLabel(s.kind)}{s.inWork
										? ` · IN ${s.inWork.toUpperCase()} · MOVES HERE`
										: ' · NOT IN A WORK'}</span
								>
							</span>
							<span class="nud">+</span>
						</button>
					</form>
				</li>
			{/each}
		</ul>
		{#if items.length < total}
			<button type="button" class="more" disabled={loading} onclick={() => read(true)}>
				{loading ? 'READING…' : `MORE · ${total - items.length} LEFT`}
			</button>
		{/if}
	{/if}
</Sheet>

<style>
	.head {
		display: flex;
		align-items: stretch;
		height: 64px;
		border-bottom: var(--hairline);
	}
	.title {
		flex: 1;
		min-width: 0;
		display: flex;
		flex-direction: column;
		justify-content: center;
		gap: 3px;
		padding: 0 var(--pad);
	}
	.title .t {
		font: 500 15px var(--font-mono);
		letter-spacing: 0.04em;
	}
	.title .s {
		font: 400 12px var(--font-mono);
		color: var(--text-2);
	}
	.cell {
		display: flex;
		align-items: center;
		padding: 0 20px;
		border: 0;
		border-left: var(--hairline);
		background: transparent;
		color: var(--text-1);
		font: 500 13px var(--font-mono);
		letter-spacing: 0.04em;
		cursor: pointer;
	}
	.search {
		padding: 10px var(--pad);
		border-bottom: var(--hairline);
	}
	.search input {
		width: 100%;
		height: 34px;
		border: var(--hairline);
		background: transparent;
		color: var(--text-1);
		font: 400 13px var(--font-mono);
		padding: 0 10px;
	}
	.search input::placeholder {
		color: var(--text-2);
		letter-spacing: 0.04em;
	}
	.none {
		margin: 0;
		padding: 20px var(--pad);
		font: 400 13px var(--font-mono);
		color: var(--text-2);
	}
	.retry {
		border: 0;
		background: transparent;
		color: inherit;
		font: inherit;
		text-decoration: underline;
		cursor: pointer;
		padding: 0;
	}
	.rows {
		list-style: none;
		margin: 0;
		padding: 0;
	}
	.rows li + li {
		border-top: var(--hairline);
	}
	.row {
		width: 100%;
		display: flex;
		align-items: center;
		min-height: 64px;
		border: 0;
		background: transparent;
		color: var(--text-1);
		text-align: left;
		font: inherit;
		cursor: pointer;
		padding: 0;
	}
	.row:active {
		background: var(--surface-inverse);
		color: var(--text-inverse);
	}
	.cov {
		display: flex;
		align-items: center;
		padding-left: 12px;
		width: 46px;
		flex-shrink: 0;
	}
	.cov :global(.cover) {
		width: 34px;
	}
	.tx {
		flex: 1;
		min-width: 0;
		display: flex;
		flex-direction: column;
		gap: 4px;
		padding: 8px 12px;
	}
	.tx .a {
		font: 500 14px/1.3 var(--font-sans);
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}
	.tx .b {
		font: 400 11px/1.35 var(--font-mono);
		color: var(--text-2);
	}
	.nud {
		width: 44px;
		flex-shrink: 0;
		display: flex;
		align-items: center;
		justify-content: center;
		border-left: var(--hairline);
		font: 500 15px var(--font-mono);
		align-self: stretch;
	}
	.more {
		width: 100%;
		height: 48px;
		border: 0;
		border-top: var(--hairline);
		background: transparent;
		color: var(--text-2);
		font: 500 12px var(--font-mono);
		letter-spacing: 0.04em;
		cursor: pointer;
	}
	.more:disabled {
		cursor: default;
	}
</style>

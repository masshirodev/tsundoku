<script lang="ts">
	import { enhance } from '$app/forms';
	import Cover from '$lib/components/content/Cover.svelte';
	import Sheet from '$lib/components/chrome/Sheet.svelte';
	import { coverSrc } from '$lib/library/links';
	import { kindLabel } from '$lib/library/labels';
	import type { Kind } from '$lib/library/types';

	/**
	 * + ADD A SERIES (Work-Screen): the library a Work can take, with the Work
	 * a series would move out of. A series belongs to one Work at most, so
	 * adding one that is already elsewhere moves it (doc/WORKS.md, W1's
	 * `addSeries`).
	 */
	let {
		open,
		series,
		onclose
	}: {
		open: boolean;
		series: {
			seriesId: number;
			title: string;
			kind: Kind;
			hue: number;
			cover: number | null;
			inWork: string | null;
		}[];
		onclose: () => void;
	} = $props();
</script>

<Sheet {open} {onclose} label="Add a series to this Work">
	<div class="head">
		<div class="title">
			<div class="t">+ ADD A SERIES</div>
			<div class="s">FROM THE LIBRARY · {series.length} TO OFFER</div>
		</div>
		<button type="button" class="cell" onclick={onclose}>CANCEL</button>
	</div>
	{#if series.length === 0}
		<p class="none">EVERY SERIES IS IN A WORK ALREADY</p>
	{:else}
		<ul class="rows">
			{#each series as s (s.seriesId)}
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
	{/if}
</Sheet>

<style>
	.head {
		position: sticky;
		top: 0;
		z-index: 1;
		display: flex;
		align-items: stretch;
		height: 64px;
		border-bottom: var(--hairline);
		background: var(--surface-page);
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
	.none {
		margin: 0;
		padding: 20px var(--pad);
		font: 400 13px var(--font-mono);
		color: var(--text-2);
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
</style>

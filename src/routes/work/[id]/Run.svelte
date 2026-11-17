<script lang="ts">
	import Cover from '$lib/components/content/Cover.svelte';
	import { coverSrc, readHref, seriesHref } from '$lib/library/links';
	import { kindLabel, unitLabel } from '$lib/library/labels';
	import { moveItem } from '$lib/library/books';
	import { isFinished, runStatus, type WorkPart } from '$lib/library/works';
	import type { WorkPartRow } from '$lib/server/works';

	/**
	 * THE RUN: a 128px row per part in the user's order, the number cell
	 * inverted on the part CONTINUE opens. A tap opens the series with
	 * `?from=work:<id>` (W5 reads it), ▶ continues it.
	 *
	 * Reordering is the books grid's idiom (`BookGrid`): drag a row, or focus
	 * one and use the arrow keys, and DONE saves the order. SELECT turns a tap
	 * into a pick for TAKE OUT.
	 */
	let {
		workId,
		parts,
		currentId,
		resume = null,
		reordering = false,
		order = $bindable<number[]>([]),
		selecting = false,
		selected,
		now = Date.now(),
		onrow,
		onselect
	}: {
		workId: number;
		parts: WorkPartRow[];
		/** The part CONTINUE opens: its number cell is inverted and its ▶ is the accent cell. */
		currentId: number | null;
		/** The entry ▶ opens on the current part. */
		resume?: { id: number; label: string } | null;
		reordering?: boolean;
		/** Series ids in the order being edited, while reordering. */
		order?: number[];
		selecting?: boolean;
		selected: Set<number>;
		now?: number;
		onrow?: (part: WorkPartRow) => void;
		onselect?: (part: WorkPartRow) => void;
	} = $props();

	const byId = $derived(new Map(parts.map((p) => [p.seriesId, p])));
	const shown = $derived(
		reordering ? order.map((id) => byId.get(id)).filter((p): p is WorkPartRow => !!p) : parts
	);
	const isCurrent = (p: WorkPart) => p.seriesId === currentId;
	const currentIndex = $derived(parts.findIndex(isCurrent));

	const month = (ms: number) =>
		new Date(ms).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }).toUpperCase();

	/** What the row says on its right (the design's status column), and on the phone in its meta line. */
	function stateOf(p: WorkPartRow): { ink: string; sub: string } {
		return runStatus(p, {
			current: isCurrent(p),
			resumeLabel: resume?.label ?? null,
			now,
			month
		});
	}

	/** "ALL DOWNLOADED", "12 OF 98 DOWNLOADED", or the online note. */
	function downloads(p: WorkPartRow): { text: string; online: boolean } {
		if (p.downloaded >= p.entries && p.entries > 0)
			return { text: 'ALL DOWNLOADED', online: false };
		if (p.downloaded > 0)
			return { text: `${p.downloaded} OF ${p.entries} DOWNLOADED`, online: false };
		return { text: `○ 0 OF ${p.entries} DOWNLOADED`, online: true };
	}

	// ---- dragging, as the books grid does it (BookGrid.svelte) ----------------------

	let list = $state<HTMLElement | null>(null);
	let dragId = $state<number | null>(null);

	function indexAt(x: number, y: number): number | null {
		const el = document.elementFromPoint(x, y)?.closest<HTMLElement>('[data-index]');
		return el && list?.contains(el) ? Number(el.dataset.index) : null;
	}

	function down(e: PointerEvent, id: number) {
		if (!reordering || e.button !== 0) return;
		(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
		dragId = id;
	}

	function drag(e: PointerEvent) {
		if (dragId === null) return;
		const to = indexAt(e.clientX, e.clientY);
		const from = order.indexOf(dragId);
		if (to !== null && to !== from) order = moveItem(order, from, to);
	}

	function key(e: KeyboardEvent, id: number) {
		if (!reordering) return;
		const by =
			e.key === 'ArrowLeft' || e.key === 'ArrowUp'
				? -1
				: e.key === 'ArrowRight' || e.key === 'ArrowDown'
					? 1
					: 0;
		if (by === 0) return;
		e.preventDefault();
		const from = order.indexOf(id);
		order = moveItem(order, from, from + by);
	}
</script>

<ol
	class="run"
	class:reordering
	data-focus-off={reordering ? '' : undefined}
	bind:this={list}
	onpointermove={drag}
	onpointerup={() => (dragId = null)}
	onpointercancel={() => (dragId = null)}
>
	{#each shown as p, i (p.seriesId)}
		{@const st = stateOf(p)}
		{@const dl = downloads(p)}
		{@const current = isCurrent(p)}
		{@const next = !current && currentIndex >= 0 && i === currentIndex + 1 && !isFinished(p)}
		<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
		<li
			data-index={i}
			class="part"
			class:read={isFinished(p)}
			class:dragging={dragId === p.seriesId}
			onpointerdown={(e) => down(e, p.seriesId)}
			onkeydown={(e) => key(e, p.seriesId)}
		>
			<svelte:element
				this={reordering ? 'div' : selecting ? 'button' : 'a'}
				type={selecting ? 'button' : undefined}
				href={!reordering && !selecting ? seriesHref(p.seriesId, `work:${workId}`) : undefined}
				class="rowlink"
				role={reordering ? 'presentation' : undefined}
				tabindex={reordering ? 0 : undefined}
				data-focus-mark={reordering ? undefined : 'in'}
				aria-pressed={selecting ? selected.has(p.seriesId) : undefined}
				aria-label={selecting ? `Select ${p.title}` : undefined}
				onclick={reordering ? undefined : () => (selecting ? onselect?.(p) : onrow?.(p))}
			>
				<span class="no" class:now={current && !reordering}
					>{i + 1}<span class="m"
						>{current && !reordering ? 'NOW' : isFinished(p) ? 'READ' : next ? 'NEXT' : ''}</span
					></span
				>
				<span class="body">
					<span class="cvw"><Cover src={coverSrc(p.seriesId, p.cover)} hue={p.hue} /></span>
					<span class="tx">
						<span class="a">{p.title}</span>
						<span class="b">
							<!-- The phone drops the status column into this line. -->
							<span class="wide"
								>{kindLabel(p.kind)}{p.source ? ` · ${p.source.toUpperCase()}` : ''}{p.status
									? ` · ${p.status.toUpperCase()}`
									: ''} · {p.entries}
								{unitLabel(p.kind)} ·
							</span>{#if dl.online}<span class="ink">{dl.text}</span> · READS ONLINE{:else}{dl.text}{/if}
							<span class="inline-st">
								· {#if st.ink}<span class="ink">{st.ink}</span> ·
								{/if}{st.sub}</span
							>
						</span>
						<span class="tr"
							><i
								class:done={isFinished(p)}
								style:width="{p.entries > 0 ? Math.min(100, (p.read / p.entries) * 100) : 0}%"
							></i></span
						>
					</span>
				</span>
				<span class="st">
					<span class="ink">{st.ink}</span>
					<span>{st.sub}</span>
				</span>
			</svelte:element>
			{#if !selecting && !reordering}
				<!-- eslint-disable svelte/no-navigation-without-resolve -- readHref() and seriesHref() resolve -->
				<a
					class="go"
					class:acc={current}
					data-focus-mark="in"
					href={current && resume ? readHref(resume.id) : seriesHref(p.seriesId, `work:${workId}`)}
					aria-label={current ? `Continue ${p.title}` : `Open ${p.title}`}
				>
					{current ? '▶' : '→'}
				</a>
				<!-- eslint-enable svelte/no-navigation-without-resolve -->
			{/if}
			{#if selecting}
				<span class="check" aria-hidden="true">{selected.has(p.seriesId) ? '✓' : ''}</span>
			{/if}
		</li>
	{/each}
</ol>

<style>
	.run {
		list-style: none;
		margin: 0;
		padding: 0;
		display: flex;
		flex-direction: column;
	}
	.part {
		position: relative;
		display: flex;
		align-items: stretch;
		min-height: 128px;
		border-bottom: var(--hairline);
		color: var(--text-1);
	}
	.rowlink {
		flex: 1;
		min-width: 0;
		display: flex;
		align-items: stretch;
		color: inherit;
		text-decoration: none;
		background: transparent;
		border: 0;
		padding: 0;
		text-align: left;
		font: inherit;
		cursor: pointer;
	}
	.no {
		width: 72px;
		flex-shrink: 0;
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		gap: 4px;
		border-right: var(--hairline);
		font: 500 18px var(--font-mono);
		color: var(--text-2);
	}
	.no .m {
		font: 500 10px var(--font-mono);
		letter-spacing: 0.08em;
	}
	.no.now {
		background: var(--surface-inverse);
		color: var(--text-inverse);
	}
	.body {
		flex: 1;
		min-width: 0;
		display: flex;
		align-items: center;
		gap: 18px;
		padding: 14px 20px;
	}
	.cvw {
		width: 68px;
		flex-shrink: 0;
	}
	.tx {
		flex: 1;
		min-width: 0;
		display: flex;
		flex-direction: column;
		gap: 7px;
	}
	.tx .a {
		font: 500 18px/1.25 var(--font-sans);
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}
	.tx .b {
		font: 400 13px/1.35 var(--font-mono);
		color: var(--text-2);
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}
	.tx .b .ink {
		color: var(--text-1);
	}
	.tx .tr {
		height: 3px;
		background: var(--line-1);
		max-width: 420px;
	}
	.tx .tr i {
		display: block;
		height: 3px;
		background: var(--accent);
	}
	.tx .tr i.done {
		background: var(--text-2);
	}
	.st {
		width: 168px;
		flex-shrink: 0;
		display: flex;
		flex-direction: column;
		align-items: flex-end;
		justify-content: center;
		gap: 6px;
		padding-right: 20px;
		font: 500 13px var(--font-mono);
		letter-spacing: 0.04em;
		color: var(--text-2);
		text-align: right;
	}
	.st .ink {
		color: var(--text-1);
	}
	.go {
		width: 72px;
		flex-shrink: 0;
		display: flex;
		align-items: center;
		justify-content: center;
		border-left: var(--hairline);
		font: 500 16px var(--font-mono);
		color: var(--text-1);
		text-decoration: none;
	}
	.go.acc {
		background: var(--accent);
		color: var(--on-accent);
	}
	.read .tx .a {
		color: var(--text-2);
	}
	.inline-st {
		display: none;
	}
	.reordering .part {
		touch-action: none;
		cursor: grab;
	}
	.part.dragging {
		cursor: grabbing;
	}
	.check {
		position: absolute;
		left: 6px;
		top: 10px;
		width: 26px;
		height: 26px;
		border: 2px solid var(--text-1);
		display: flex;
		align-items: center;
		justify-content: center;
		font: 700 15px var(--font-mono);
		color: var(--on-accent);
		background: var(--surface-page);
	}
	.check:not(:empty) {
		border-color: var(--accent);
		background: var(--accent);
	}
	/* The phone: rows are 104px, the status column folds into the meta line. */
	@media (max-width: 599px) {
		.part {
			min-height: 104px;
		}
		.no {
			width: 48px;
			font-size: 15px;
		}
		.body {
			gap: 12px;
			padding: 12px;
		}
		.cvw {
			width: 48px;
		}
		.tx .a {
			font-size: 15px;
		}
		.tx .b {
			font-size: 11px;
		}
		.wide,
		.st {
			display: none;
		}
		.inline-st {
			display: inline;
		}
		.go {
			width: 52px;
		}
	}
	@media (pointer: none) and (min-width: 900px) {
		.go,
		.rowlink {
			outline-offset: -2px;
		}
	}
</style>

<script lang="ts">
	/**
	 * A code listing or a table on its own (Index Text Reader 1e, wideOpen):
	 * full width, margins gone, panned by dragging here -- in the column a
	 * swipe must always turn the page, so wide blocks are only cut there. The
	 * track under it shows which part is in view.
	 */
	let {
		title,
		meta,
		html,
		code,
		onclose
	}: { title: string; meta: string; html: string; code: boolean; onclose: () => void } = $props();

	let pane = $state<HTMLElement | null>(null);
	let left = $state(0);
	let shown = $state(1);
	function measure() {
		if (!pane) return;
		const w = pane.scrollWidth || 1;
		left = pane.scrollLeft / w;
		shown = Math.min(1, pane.clientWidth / w);
	}
	$effect(() => {
		if (pane) measure();
	});
</script>

<div class="view" role="dialog" aria-label={title}>
	<div class="head">
		<button type="button" class="x" aria-label="Close" onclick={onclose}>✕</button>
		<div class="names">
			<div class="title">{title}</div>
			<div class="meta">{meta}</div>
		</div>
	</div>
	<div class="pane" class:code bind:this={pane} onscroll={measure}>
		<!-- The block was rebuilt from the book by the reader's allowlist (text-dom.ts). -->
		<!-- eslint-disable-next-line svelte/no-at-html-tags -->
		{@html html}
	</div>
	<div class="foot">
		<div class="pan">← PAN →</div>
		<div class="track"><div style:left="{left * 100}%" style:width="{shown * 100}%"></div></div>
	</div>
</div>

<style>
	.view {
		position: fixed;
		inset: 0;
		z-index: 60;
		display: flex;
		flex-direction: column;
		background: var(--surface-page);
		color: var(--text-1);
	}
	.head {
		flex-shrink: 0;
		display: flex;
		align-items: stretch;
		height: 64px;
		border-bottom: var(--hairline);
	}
	.x {
		width: 64px;
		flex-shrink: 0;
		border: 0;
		border-right: var(--hairline);
		border-radius: 0;
		background: transparent;
		color: var(--text-1);
		font: 500 18px var(--font-mono);
		cursor: pointer;
	}
	.names {
		flex: 1;
		min-width: 0;
		display: flex;
		flex-direction: column;
		justify-content: center;
		gap: 3px;
		padding: 0 18px;
	}
	.title {
		font: 500 16px/1.2 var(--font-sans);
	}
	.meta {
		font: 400 12px var(--font-mono);
		color: var(--text-2);
		letter-spacing: 0.04em;
	}
	.pane {
		flex: 1;
		overflow: auto;
		padding: 32px 24px;
	}
	.pane.code :global(pre) {
		margin: 0;
		white-space: pre;
		font: 400 15px/1.8 var(--font-mono);
	}
	.pane :global(table) {
		border-collapse: collapse;
		font: 400 15px var(--font-sans);
	}
	.pane :global(td),
	.pane :global(th) {
		padding: 9px 14px;
		border-bottom: var(--hairline);
		white-space: nowrap;
		text-align: left;
	}
	.pane :global(th) {
		font: 500 12px var(--font-mono);
		color: var(--text-2);
	}
	.foot {
		flex-shrink: 0;
		display: flex;
		align-items: center;
		gap: 18px;
		height: 56px;
		padding: 0 24px;
		border-top: var(--hairline);
	}
	.pan {
		font: 500 13px var(--font-mono);
		color: var(--text-2);
	}
	.track {
		position: relative;
		flex: 1;
		height: 4px;
		background: var(--line-1);
	}
	.track div {
		position: absolute;
		height: 4px;
		background: var(--text-2);
	}
</style>

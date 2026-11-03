<script lang="ts">
	import Sheet from '$lib/components/chrome/Sheet.svelte';

	/**
	 * A tag tapped on the series screen (card c313; doc/SERIES.md, the TAGS
	 * row): where to look for it. Two rows, the owner's choice (2026-11-02):
	 * the library's person or tag page, and the series' own source finding it
	 * (its genre's filter included, or a search for the value, decided by the
	 * server once the source's filters have answered). Built on the
	 * shared Sheet, with UnfoldSheet's head and its rows' cells, so it is a
	 * scope on a TV: the first row takes focus, and BACK closes it.
	 */
	let {
		open,
		tag,
		source,
		libraryHref,
		sourceHref,
		onclose
	}: {
		open: boolean;
		/** What was tapped: its namespace as the row names it, and the value. */
		tag: { namespace: string; value: string } | null;
		/** The source's name, as BROWSE lists it. */
		source: string;
		libraryHref: string;
		sourceHref: string;
		onclose: () => void;
	} = $props();
</script>

<Sheet {open} {onclose} label="Look for {tag?.value ?? 'this tag'}">
	<div class="head">
		<span class="h"
			><span class="ns">{(tag?.namespace || 'tag').toUpperCase()}</span>{tag?.value}</span
		>
		<button type="button" class="x" aria-label="Close" onclick={onclose}>✕</button>
	</div>
	<!-- eslint-disable svelte/no-navigation-without-resolve -- both hrefs are built on resolve() by the panel -->
	<nav class="rows" aria-label="Where to look">
		<a class="row" href={libraryHref} data-focus-start onclick={onclose}>
			<span class="t">IN THE LIBRARY</span>
			<span class="go" aria-hidden="true">→</span>
		</a>
		<!-- A server route (`tag-search`), not a page: it waits for the source's filters, then
		     303s there. The sheet stays while the browser waits (up to TAG_SCHEMA_WAIT_MS on a
		     cold source), so the row just chosen stays in view instead of the screen falling
		     back to the TAGS row as if nothing had been tapped. -->
		<a class="row" href={sourceHref} data-sveltekit-reload>
			<span class="t">IN {source.toUpperCase()}</span>
			<span class="go" aria-hidden="true">→</span>
		</a>
	</nav>
	<!-- eslint-enable svelte/no-navigation-without-resolve -->
</Sheet>

<style>
	.head {
		display: flex;
		align-items: stretch;
		min-height: 64px;
		border-bottom: var(--hairline);
	}
	.h {
		flex: 1;
		min-width: 0;
		display: flex;
		align-items: center;
		gap: 12px;
		padding: 12px var(--pad);
		font: 500 15px var(--font-sans);
		overflow-wrap: anywhere;
	}
	.ns {
		flex-shrink: 0;
		font: 500 12px var(--font-mono);
		letter-spacing: 0.04em;
		color: var(--text-2);
	}
	.x {
		width: 64px;
		border: 0;
		border-left: var(--hairline);
		background: none;
		color: var(--text-1);
		font: 500 18px var(--font-mono);
		cursor: pointer;
	}
	.rows {
		display: flex;
		flex-direction: column;
	}
	.row {
		display: flex;
		align-items: center;
		min-height: 64px;
		padding: 0 0 0 var(--pad);
		border-bottom: var(--hairline);
		color: var(--text-1);
		text-decoration: none;
	}
	.row:active {
		background: var(--surface-inverse);
		color: var(--text-inverse);
	}
	.t {
		flex: 1;
		min-width: 0;
		font: 500 14px var(--font-mono);
		letter-spacing: 0.04em;
		overflow-wrap: anywhere;
	}
	.go {
		width: 64px;
		align-self: stretch;
		display: flex;
		align-items: center;
		justify-content: center;
		border-left: var(--hairline);
		font: 500 16px var(--font-mono);
	}
</style>

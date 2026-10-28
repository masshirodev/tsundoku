<script lang="ts">
	import { resolve } from '$app/paths';
	import { coverPlaceholder } from '$lib/library/cover';
	import type { BrowseRow } from '$lib/server/engine/browse';

	/**
	 * A source in BROWSE's list and the empty search's offer (Index-Browse,
	 * sources and phoneEntry): its icon, its name, one line, and → to its
	 * page. A source the engine refused is c94's failed row (a 3px ink rule,
	 * the reason in a word) and leads to EXTENSIONS. HIDDEN sits on the icon of
	 * a mostly-hidden source, which is only ever listed inside reveal.
	 */
	let { r, meta }: { r: BrowseRow; meta: string } = $props();
	const hue = $derived([...r.id].reduce((a, c) => (a * 31 + c.charCodeAt(0)) % 360, 0));
	const m = $derived(meta);
	const extensionsHref = resolve('/browse/extensions');
</script>

{#if r.failed}
	<a class="row failed" href={extensionsHref}>
		<span class="main">
			<span class="icon" style:background={coverPlaceholder(hue)}></span>
			<span class="text">
				<span class="t">{r.label}</span>
				<span class="m"
					><span class="lead">FAILED TO LOAD · {r.failed.toUpperCase()}</span> · TRY AGAIN IN EXTENSIONS</span
				>
			</span>
		</span>
		<span class="go">EXTENSIONS →</span>
	</a>
{:else}
	<a class="row" href={resolve('/browse/[source]', { source: r.id })}>
		<span class="main">
			<span
				class="icon"
				style:background="center / cover no-repeat url({resolve('/api/browse/icon/[pkg]', {
					pkg: r.pkg
				})}), {coverPlaceholder(hue)}"
			>
				{#if r.mostlyHidden}<span class="hid">HIDDEN</span>{/if}
			</span>
			<span class="text">
				<span class="t">{r.label}</span>
				<span class="m">{m}</span>
			</span>
		</span>
		<span class="go" aria-hidden="true">→</span>
	</a>
{/if}

<style>
	.row {
		display: flex;
		align-items: stretch;
		min-height: 64px;
		border-bottom: var(--hairline);
		color: var(--text-1);
		text-decoration: none;
	}
	.row:active {
		background: var(--surface-inverse);
		color: var(--text-inverse);
	}
	.row.failed {
		box-shadow: inset 3px 0 0 var(--text-1);
	}
	.main {
		flex: 1;
		min-width: 0;
		display: flex;
		align-items: center;
		gap: 16px;
		padding: 10px var(--pad);
	}
	.icon {
		position: relative;
		flex-shrink: 0;
		width: 40px;
		height: 40px;
		box-sizing: border-box;
	}
	.hid {
		position: absolute;
		left: 0;
		right: 0;
		bottom: 0;
		padding: 2px 0;
		text-align: center;
		background: var(--reveal);
		color: var(--on-reveal);
		font: 500 8px/1 var(--font-mono);
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
		font: 500 16px/1.3 var(--font-sans);
	}
	.m {
		font: 400 13px/1.3 var(--font-mono);
		color: var(--text-2);
	}
	.lead {
		color: var(--text-1);
		font-weight: 500;
	}
	.row:active .m,
	.row:active .lead {
		color: inherit;
	}
	.go {
		display: flex;
		align-items: center;
		padding: 0 var(--pad);
		font: 500 14px var(--font-mono);
		letter-spacing: 0.04em;
		white-space: nowrap;
	}
</style>

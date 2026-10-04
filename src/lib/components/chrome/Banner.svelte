<script lang="ts">
	import type { Snippet } from 'svelte';
	import ProgressBar from '../content/ProgressBar.svelte';

	/**
	 * The status band under (or, for reveal, above) the header. Measurements
	 * follow the screen mock rather than the component sketch where the two
	 * disagree -- see doc/design/README.md, "Departures".
	 *
	 * - `reveal`: 52px magenta, `● HIDDEN SHOWN`, an outlined HIDE AGAIN.
	 * - `progress`: panel band, title + detail, a 4px bar, a second meta row.
	 * - `action`: 60px panel band, two stacked lines, an accent action cell.
	 * - `info`: 48px panel band, one line, detail on the right.
	 */
	type Kind = 'reveal' | 'progress' | 'action' | 'info';
	let {
		kind,
		title,
		detail,
		meta,
		metaRight,
		metaHref,
		progress,
		action,
		children
	}: {
		kind: Kind;
		title: string;
		detail?: string;
		/** Second row of a progress band. */
		meta?: string;
		metaRight?: string;
		/** Where the second row's right side leads, when it is a link ("NEW →"). */
		metaHref?: string;
		progress?: number;
		/** The action cell: a form button or a link, supplied by the caller. */
		action?: Snippet;
		children?: Snippet;
	} = $props();
</script>

{#if kind === 'reveal'}
	<div class="band reveal" role="status">
		<div>● {title}</div>
		{@render action?.()}
	</div>
{:else if kind === 'progress'}
	<div class="band progress" role="status">
		<div class="line">
			<div>{title}</div>
			{#if detail}<div class="dim">{detail}</div>{/if}
		</div>
		<ProgressBar value={progress ?? 0} height={4} />
		<div class="line meta">
			<div>{meta}</div>
			{#if metaRight && metaHref}
				<!-- eslint-disable-next-line svelte/no-navigation-without-resolve -- the caller resolves it -->
				<a class="meta-link" href={metaHref}>{metaRight}</a>
			{:else if metaRight}<div>{metaRight}</div>{/if}
		</div>
	</div>
{:else if kind === 'action'}
	<div class="band act" role="status">
		<div class="stack">
			<div class="strong">{title}</div>
			{#if detail}<div class="meta">{detail}</div>{/if}
		</div>
		{@render action?.()}
	</div>
{:else}
	<div class="band info" role="status">
		<div>{title}</div>
		{#if detail}<div class="dim">{detail}</div>{/if}
		{@render children?.()}
	</div>
{/if}

<style>
	.band {
		flex-shrink: 0;
		display: flex;
		font: var(--type-control);
	}
	.reveal {
		align-items: center;
		justify-content: space-between;
		gap: 12px;
		height: 52px;
		padding: 0 var(--pad);
		background: var(--reveal);
		color: var(--on-reveal);
		letter-spacing: 0.04em;
	}
	.reveal :global(button) {
		height: 36px;
		padding: 0 14px;
		border: 1.5px solid var(--on-reveal);
		border-radius: 0;
		background: transparent;
		color: inherit;
		font: inherit;
		letter-spacing: inherit;
		cursor: pointer;
	}
	.progress {
		flex-direction: column;
		gap: 10px;
		padding: 16px var(--pad);
		border-bottom: var(--hairline);
		background: var(--surface-panel);
	}
	/* One line each, as the mocks draw them: a long title is cut, never wrapped. */
	.line {
		display: flex;
		justify-content: space-between;
		gap: 12px;
		white-space: nowrap;
	}
	.line > :first-child {
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
	}
	.dim {
		color: var(--text-2);
	}
	.meta {
		font: var(--type-meta);
		color: var(--text-2);
	}
	.meta-link {
		color: var(--text-2);
		text-decoration: none;
	}
	.act {
		align-items: center;
		justify-content: space-between;
		gap: 12px;
		height: 60px;
		padding-left: var(--pad);
		border-bottom: var(--hairline);
		background: var(--surface-panel);
	}
	.stack {
		display: flex;
		flex-direction: column;
		gap: 3px;
		min-width: 0;
	}
	/* A caller's form wrapper must not break the stretch to the band's height. */
	.act > :global(form) {
		align-self: stretch;
		display: flex;
	}
	.act :global(:is(button, a)) {
		align-self: stretch;
		display: flex;
		align-items: center;
		padding: 0 var(--pad);
		border: 0;
		border-radius: 0;
		background: var(--accent);
		color: var(--on-accent);
		font: var(--type-control);
		white-space: nowrap;
		cursor: pointer;
	}
	/* An action that needs the workstation, offline (Catalogue Links 1a): not accent, dimmed. */
	.act :global(.dimmed) {
		align-self: stretch;
		display: flex;
		align-items: center;
		padding: 0 var(--pad);
		border-left: var(--hairline);
		font: var(--type-control);
		white-space: nowrap;
		opacity: 0.35;
	}
	.info {
		align-items: center;
		justify-content: space-between;
		gap: 12px;
		height: 48px;
		padding: 0 var(--pad);
		border-bottom: var(--hairline);
		background: var(--surface-panel);
	}
</style>

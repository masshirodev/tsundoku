<script lang="ts">
	import type { Snippet } from 'svelte';

	/**
	 * A panel band with a plain action cell on the right: the books and
	 * addendum handoffs' confirmation strip ("SERIES CREATED · 6 BOOKS / UNDO",
	 * "NOT A SERIES · WON'T ASK AGAIN / UNDO", "INCOGNITO · NOTHING SAVED /
	 * END"). One line is 48px; with a `detail` line it is 60px. Unlike Banner's
	 * `action` kind, the cell is not accent -- it undoes, it doesn't advance.
	 */
	let {
		title,
		detail,
		action,
		dashed = false
	}: {
		title: string;
		detail?: string;
		/** The right-hand cell: a form button or a link, supplied by the caller. */
		action?: Snippet;
		/** Incognito's mark: "not stored yet" is dashed in Index. */
		dashed?: boolean;
	} = $props();
</script>

<div class="band" class:two={!!detail} class:dashed role="status">
	<div class="text">
		<div class="title">{title}</div>
		{#if detail}<div class="detail">{detail}</div>{/if}
	</div>
	{#if action}<div class="act">{@render action()}</div>{/if}
</div>

<style>
	.band {
		flex-shrink: 0;
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 12px;
		height: 48px;
		padding-left: var(--pad);
		border-bottom: var(--hairline);
		background: var(--surface-panel);
		font: var(--type-control);
	}
	.band.two {
		height: 60px;
	}
	.band.dashed {
		border-bottom: 2px dashed var(--text-2);
	}
	.text {
		display: flex;
		flex-direction: column;
		gap: 3px;
		min-width: 0;
	}
	.title,
	.detail {
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}
	.detail {
		font: var(--type-meta);
		color: var(--text-2);
	}
	.act {
		align-self: stretch;
		display: flex;
		border-left: var(--hairline);
	}
	.act > :global(form) {
		display: flex;
	}
	.act :global(:is(button, a)) {
		display: flex;
		align-items: center;
		padding: 0 var(--pad);
		border: 0;
		border-radius: 0;
		background: transparent;
		color: var(--text-1);
		font: var(--type-control);
		white-space: nowrap;
		cursor: pointer;
	}
	.act :global(:is(button, a):active) {
		background: var(--surface-inverse);
		color: var(--text-inverse);
	}
</style>

<script lang="ts">
	/**
	 * A topic's IN SHORT (doc/HELP.md; the HELP handoff): three numbered,
	 * ruled lines on the panel. The page and a "?"'s sheet show the same block.
	 * A topic GET STARTED walks through ends on a pointer to its steps, in bold
	 * (FirstRead board 4C): a line of its own, never a fourth line of IN SHORT.
	 */
	import { m } from '$lib/paraglide/messages';
	import type { HelpPointer } from '$lib/help/topics';

	let {
		lines,
		pointer,
		compact = false
	}: { lines: string[]; pointer?: HelpPointer; compact?: boolean } = $props();
</script>

<section class="short" class:compact aria-label={m.help_in_short_label()}>
	<div class="k">{m.help_in_short()}</div>
	{#each lines as line, i (i)}
		<div class="line">
			<div class="n">{i + 1}</div>
			<p>{line}</p>
		</div>
	{/each}
	{#if pointer}
		<div class="line pointer">
			<div class="n">→</div>
			<div class="pt"><b>{pointer.text}</b></div>
			<!-- eslint-disable-next-line svelte/no-navigation-without-resolve -- a fixed app path -->
			<a href={pointer.href}>{pointer.label}</a>
		</div>
	{/if}
</section>

<style>
	.short {
		background: var(--surface-panel);
		border-top: var(--hairline);
		border-bottom: var(--hairline);
		--pad: 24px;
		--num: 56px;
	}
	.k {
		padding: 14px var(--pad) 10px;
		font: 500 12px var(--font-mono);
		letter-spacing: 0.06em;
		color: var(--text-2);
	}
	.line {
		display: flex;
		border-top: var(--hairline);
	}
	.n {
		width: var(--num);
		flex-shrink: 0;
		padding-top: 16px;
		text-align: center;
		border-right: var(--hairline);
		font: 500 13px var(--font-mono);
		color: var(--text-2);
	}
	p {
		margin: 0;
		max-width: 72ch;
		padding: 14px var(--pad) 14px 18px;
		font: 400 17px/1.5 var(--font-sans);
		color: var(--text-1);
		text-wrap: pretty;
	}
	.pointer .pt {
		flex: 1;
		max-width: 72ch;
		padding: 14px var(--pad) 14px 18px;
		font: 400 17px/1.5 var(--font-sans);
		text-wrap: pretty;
	}
	.compact .pointer .pt {
		padding: 13px var(--pad) 13px 14px;
		line-height: 1.45;
	}
	.pointer b {
		font-weight: 500;
	}
	.pointer a {
		display: flex;
		align-items: center;
		padding: 0 var(--pad);
		border-left: var(--hairline);
		color: var(--accent);
		font: 500 14px var(--font-mono);
		text-decoration: none;
		white-space: nowrap;
	}
	/* In a sheet (Ask board): 13 px rows, the lines a size down. */
	.compact {
		border-top: 0;
	}
	.compact .n {
		padding-top: 15px;
	}
	.compact p {
		padding: 13px var(--pad) 13px 14px;
		font-size: 17px;
		line-height: 1.45;
	}
	@media (max-width: 599px) {
		.short {
			--pad: 16px;
			--num: 40px;
		}
		p,
		.compact p,
		.pointer .pt {
			font-size: 16px;
		}
	}
</style>

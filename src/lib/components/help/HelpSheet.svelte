<script lang="ts">
	import type { Snippet } from 'svelte';
	import Sheet from '$lib/components/chrome/Sheet.svelte';
	import InShort from './InShort.svelte';
	import { ask } from '$lib/help/topics';
	import { upper } from '$lib/i18n/format';
	import { m } from '$lib/paraglide/messages';

	/**
	 * What a "?" opens (doc/HELP.md; the HELP handoff, Ask board): the topic's
	 * IN SHORT in a sheet, then WHOLE TOPIC → and where it lands. The friend
	 * stays on the screen they asked from. `content` alone draws it inside a
	 * sheet that's already open (the reader's READING), with `back` before the
	 * title.
	 */
	let {
		open = false,
		onclose,
		topic,
		part,
		back,
		content = false,
		at
	}: {
		open?: boolean;
		onclose: () => void;
		topic: string;
		part?: string;
		/** The reader's ← READING: brings the sheet's own rows back. */
		back?: Snippet;
		/** Draw only the inside, for a sheet that's already open. */
		content?: boolean;
		/** Where WHOLE TOPIC lands, when it says more than the part (the reader's). */
		at?: string;
	} = $props();
	const a = $derived(ask(topic, part));
	const title = $derived(
		m.help_sheet_title({ help: m.name_help(), n: a.topic.n, title: upper(a.topic.title) })
	);
</script>

{#snippet inside()}
	<div class="head sheet-head">
		{#if back}{@render back()}{/if}
		<div class="title">{title}</div>
		<button type="button" class="x" aria-label={m.help_close()} onclick={onclose}>✕</button>
	</div>
	<InShort lines={a.topic.short} pointer={a.topic.pointer} compact />
	<!-- eslint-disable-next-line svelte/no-navigation-without-resolve -- topics' paths are fixed app paths -->
	<a class="whole" href={a.href} onclick={onclose}
		><span class="w">{m.help_whole_topic()}</span><span class="at">{at ?? a.at}</span></a
	>
	<div class="end"></div>
{/snippet}

{#if content}
	{@render inside()}
{:else}
	<Sheet {open} {onclose} label={m.help_label()}>{@render inside()}</Sheet>
{/if}

<style>
	/* The Ask board's sheet, transcribed: 56 px head, 64 px WHOLE TOPIC. */
	.head {
		display: flex;
		align-items: stretch;
		height: 56px;
		flex-shrink: 0;
		border-bottom: var(--hairline);
		--pad: 24px;
	}
	.title {
		flex: 1;
		min-width: 0;
		display: flex;
		align-items: center;
		padding: 0 var(--pad);
		overflow: hidden;
		white-space: nowrap;
		text-overflow: ellipsis;
		font: 500 13px var(--font-mono);
		letter-spacing: 0.06em;
		color: var(--text-2);
	}
	.x {
		width: 56px;
		flex-shrink: 0;
		border: 0;
		border-left: var(--hairline);
		border-radius: 0;
		background: none;
		color: var(--text-1);
		font: 500 18px var(--font-mono);
		cursor: pointer;
	}
	.whole {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 12px;
		min-height: 64px;
		padding: 0 24px;
		border-bottom: var(--hairline);
		color: var(--text-1);
		font: 500 15px var(--font-mono);
		letter-spacing: 0.02em;
		text-decoration: none;
	}
	.w {
		white-space: nowrap;
	}
	.at {
		font: 400 12px/1.35 var(--font-mono);
		color: var(--text-2);
		text-align: right;
	}
	.end {
		height: 16px;
	}
	@media (max-width: 599px) {
		.head,
		.whole {
			--pad: 16px;
		}
		.whole {
			padding: 0 16px;
		}
	}
</style>

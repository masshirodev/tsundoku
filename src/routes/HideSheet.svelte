<script lang="ts">
	import { enhance } from '$app/forms';
	import type { SubmitFunction } from '@sveltejs/kit';
	import Sheet from '$lib/components/chrome/Sheet.svelte';

	/**
	 * HIDE on a part of a Work (W4; Work-States 4, doc/WORKS.md, "The one
	 * rule"): a Work is hidden or shown whole, so hiding one of its series
	 * asks. HIDE ALL n hides the Work whole; TAKE OUT takes this series out
	 * first, and hides it on its own, so the rest stay a Work.
	 *
	 * A series in no Work never opens this: it keeps the plain HIDE, and the
	 * controls that offer a choice say so before the sheet.
	 */
	let {
		open,
		title,
		detail = '',
		ids,
		wholeCount,
		remainCount,
		actionAll,
		actionPart,
		ondone,
		onclose
	}: {
		open: boolean;
		title: string;
		detail?: string;
		/** The series being hidden, as the survey reads them: `name="id"` each. */
		ids: string[];
		/** How many series HIDE ALL n hides (the Work, whole). */
		wholeCount: number;
		/** How many stay behind in their Work after TAKE OUT. */
		remainCount: number;
		/** The route actions: the whole Work, and the one series. */
		actionAll: string;
		actionPart: string;
		ondone?: () => void;
		onclose: () => void;
	} = $props();

	const after: SubmitFunction =
		() =>
		async ({ result, update }) => {
			await update();
			if (result.type === 'success') ondone?.();
		};
</script>

<Sheet {open} {onclose} label="Hide">
	<div class="head">
		<div class="h-title">
			<div class="t">{title}</div>
			{#if detail}<div class="s">{detail}</div>{/if}
		</div>
		<button type="button" class="cancel" onclick={onclose}>CANCEL</button>
	</div>

	<form method="POST" action={actionAll} use:enhance={after} class="row">
		{#each ids as id (id)}<input type="hidden" name="id" value={id} />{/each}
		<div class="lb">THE WORK</div>
		<div class="lk">
			<div class="a">All {wholeCount} series</div>
			<div class="b">HIDDEN AND SHOWN WHOLE</div>
		</div>
		<button type="submit" class="lc acc">HIDE ALL {wholeCount}</button>
	</form>

	<form method="POST" action={actionPart} use:enhance={after} class="row">
		{#each ids as id (id)}<input type="hidden" name="id" value={id} />{/each}
		<div class="lb">ONLY THIS</div>
		<div class="lk">
			<div class="a">Take it out, then hide it</div>
			<div class="b">THE OTHER {remainCount} STAY A WORK</div>
		</div>
		<button type="submit" class="lc">TAKE OUT</button>
	</form>
</Sheet>

<style>
	.head {
		flex-shrink: 0;
		display: flex;
		align-items: stretch;
		height: 64px;
		border-bottom: var(--hairline);
	}
	.h-title {
		flex: 1;
		min-width: 0;
		display: flex;
		flex-direction: column;
		justify-content: center;
		gap: 3px;
		padding: 0 24px;
	}
	.h-title .t {
		font: 500 15px var(--font-mono);
		letter-spacing: 0.04em;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}
	.h-title .s {
		font: 400 12px var(--font-mono);
		color: var(--text-2);
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}
	.cancel {
		padding: 0 24px;
		border: 0;
		border-left: var(--hairline);
		border-radius: 0;
		background: transparent;
		color: var(--text-1);
		font: 500 14px var(--font-mono);
		letter-spacing: 0.04em;
		cursor: pointer;
	}
	.row {
		display: flex;
		align-items: stretch;
		min-height: 64px;
		border-bottom: var(--hairline);
	}
	.lb {
		width: 120px;
		flex-shrink: 0;
		display: flex;
		align-items: center;
		padding-left: 24px;
		border-right: var(--hairline);
		font: 500 12px var(--font-mono);
		letter-spacing: 0.06em;
		color: var(--text-2);
	}
	.lk {
		flex: 1;
		min-width: 0;
		display: flex;
		flex-direction: column;
		justify-content: center;
		gap: 5px;
		padding: 10px 14px;
	}
	.lk .a {
		font: 500 15px/1.3 var(--font-sans);
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}
	.lk .b {
		font: 400 13px/1.35 var(--font-mono);
		color: var(--text-2);
	}
	.lc {
		display: flex;
		align-items: center;
		justify-content: center;
		padding: 0 18px;
		border: 0;
		border-left: var(--hairline);
		border-radius: 0;
		background: transparent;
		color: var(--text-1);
		font: 500 13px var(--font-mono);
		letter-spacing: 0.04em;
		white-space: nowrap;
		cursor: pointer;
	}
	.lc.acc {
		background: var(--accent);
		color: var(--on-accent);
	}
	@media (max-width: 599px) {
		.lb {
			width: 84px;
			padding-left: 14px;
		}
		.lc {
			padding: 0 12px;
		}
	}
</style>

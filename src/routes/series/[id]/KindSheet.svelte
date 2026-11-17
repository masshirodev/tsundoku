<script lang="ts">
	import { enhance } from '$app/forms';
	import type { ActionResult } from '@sveltejs/kit';
	import Sheet from '$lib/components/chrome/Sheet.svelte';
	import type { KindSwitchPlan } from '$lib/server/kind-switch';
	import type { Kind } from '$lib/library/kinds';

	/**
	 * The kind switch's sheet. Only the kinds the source serves; picking one
	 * says, before anything happens, where each file goes, what changes and
	 * what stays, and the button names the move. A refusal sits on the kind it
	 * refuses, with its reason, not in an error after the tap; a file still
	 * downloading allows the pick and not the move, and nothing queues it for
	 * later. The move itself is `switchKind` (src/lib/server/kind-switch.ts).
	 *
	 * The measurements are the design's own (a 438px sheet, two 194px kinds,
	 * 48px path rows with a 72px label), not a ladder.
	 */
	let {
		open,
		title,
		source,
		kind,
		plans,
		onclose,
		ondone
	}: {
		open: boolean;
		title: string;
		/** The source's name: `MOVIES MOD SERVES MOVIES AND SHOWS`. */
		source: string;
		kind: Kind;
		plans: KindSwitchPlan[];
		onclose: () => void;
		ondone: (result: ActionResult) => void | Promise<void>;
	} = $props();

	const WORD: Partial<Record<Kind, string>> = { movie: 'MOVIE', show: 'SHOW' };
	const ABOUT: Partial<Record<Kind, string>> = { movie: 'ONE ENTRY', show: 'EPISODES, SEASONS' };
	const serves = $derived(
		[kind, ...plans.map((p) => p.to)].map((k) => `${WORD[k] ?? k.toUpperCase()}S`)
	);
	let picked = $state<Kind | null>(null);
	let busy = $state(false);
	// Every opening starts with nothing picked: the sheet says what a pick does first.
	$effect(() => {
		if (open) picked = null;
	});
	const plan = $derived(plans.find((p) => p.to === picked) ?? null);
	const filesWord = (n: number) => (n === 1 ? '1 FILE' : `${n} FILES`);
	const button = $derived(
		!plan
			? null
			: plan.refused
				? { a: 'NOTHING TO CHANGE', b: '', dim: true }
				: plan.busy
					? { a: `MAKE IT A ${WORD[plan.to]}`, b: 'AFTER THE DOWNLOAD', dim: true }
					: {
							a: `MAKE IT A ${WORD[plan.to]}`,
							b: plan.files.length ? `MOVE ${filesWord(plan.files.length)}` : 'NOTHING TO MOVE',
							dim: false
						}
	);
</script>

<Sheet {open} {onclose} label="Kind: {title}">
	<div class="head sheet-head">
		<div class="who">
			<span class="h">KIND · {title.toUpperCase()}</span>
			<span class="s">{source.toUpperCase()} SERVES {serves.join(' AND ')}</span>
		</div>
		<button type="button" class="cancel" onclick={onclose}>CANCEL</button>
	</div>
	<div class="body">
		<div class="lab"><span>01 — IT IS</span></div>
		<div class="kinds" style:grid-template-columns="repeat({plans.length + 1}, 194px)">
			<div class="k now">
				<span class="kw">{WORD[kind]}</span>
				<span class="kn">NOW</span>
			</div>
			{#each plans as p (p.to)}
				<button
					type="button"
					class="k"
					class:on={picked === p.to}
					aria-pressed={picked === p.to}
					onclick={() => (picked = picked === p.to ? null : p.to)}
				>
					<span class="kw">{WORD[p.to]}</span>
					<span class="kn">{p.refused ?? ABOUT[p.to]}</span>
				</button>
			{/each}
		</div>

		{#if plan?.refused}
			<p class="why">
				A MOVIE IS A SERIES WITH ONE ENTRY. TO KEEP ONE EPISODE AS A FILM, ADD IT FROM THE SOURCE AS
				ITS OWN SERIES.
			</p>
		{:else if plan}
			{#if plan.busy}
				<p class="why">
					THE FILE IS {plan.busy}.<br />IT CAN MOVE ONCE IT IS ON THIS COMPUTER, OR AFTER CANCEL.
				</p>
			{/if}
			<div class="lab">
				<span>02 — THE FILE MOVES</span><span>{filesWord(plan.files.length)}</span>
			</div>
			{#if plan.files.length}
				<div class="paths">
					{#each plan.files as f, i (f.from.name)}
						<div class="pr" class:first={i === 0}>
							<span class="pl">FROM</span>
							<span class="pv"><span>{f.from.name}</span><span class="mu">{f.from.dir}</span></span>
						</div>
						<div class="pr">
							<span class="pl">TO</span>
							<span class="pv"><span>{f.to.name}</span><span class="mu">{f.to.dir}</span></span>
						</div>
					{/each}
				</div>
			{:else}
				<p class="words">
					NOTHING IS ON THIS COMPUTER YET · ITS FOLDER WILL BE {plan.folder.to.toUpperCase()}/
				</p>
			{/if}
			<div class="lab"><span>03 — WHAT CHANGES</span></div>
			<p class="words">{plan.changes.join(' · ')}</p>
			<div class="lab"><span>04 — WHAT STAYS</span></div>
			<p class="words">{plan.stays.join(' · ')}</p>
		{/if}
	</div>
	{#if button}
		<form
			method="POST"
			action="?/switchKind"
			class="foot"
			use:enhance={() => {
				busy = true;
				return async ({ result }) => {
					busy = false;
					await ondone(result);
				};
			}}
		>
			<input type="hidden" name="kind" value={plan?.to} />
			<button type="submit" class="go" class:dim={button.dim} disabled={button.dim || busy}>
				<span>{button.a}</span>{#if button.b}<span class="gb">{button.b}</span>{/if}
			</button>
		</form>
	{/if}
</Sheet>

<style>
	.head {
		display: flex;
		align-items: stretch;
		min-height: 64px;
		border-bottom: 1px solid var(--line-1);
	}
	.who {
		display: flex;
		flex: 1;
		min-width: 0;
		flex-direction: column;
		justify-content: center;
		gap: 4px;
		padding: 0 24px;
	}
	.h {
		font: 500 15px var(--font-mono);
		letter-spacing: 0.04em;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}
	.s {
		font: 400 12px var(--font-mono);
		color: var(--text-2);
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}
	.cancel {
		display: flex;
		align-items: center;
		padding: 0 24px;
		border: 0;
		border-left: 1px solid var(--line-1);
		background: none;
		color: var(--text-1);
		font: var(--type-control);
		letter-spacing: 0.04em;
		cursor: pointer;
	}
	.body {
		display: flex;
		flex-direction: column;
		padding-bottom: 20px;
		overflow-y: auto;
	}
	.lab {
		display: flex;
		justify-content: space-between;
		gap: 12px;
		padding: 20px 24px 10px;
		font: var(--type-label);
		letter-spacing: 0.06em;
		color: var(--text-2);
	}
	.kinds {
		display: grid;
		/* The kinds' own width, 194px each, never the sheet's. */
		width: max-content;
		margin: 0 24px;
		border: 1px solid var(--line-1);
	}
	.k {
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		gap: 3px;
		min-height: 56px;
		padding: 6px 8px;
		border: 0;
		border-right: 1px solid var(--line-1);
		background: none;
		color: var(--text-1);
		font: 500 14px var(--font-mono);
		letter-spacing: 0.04em;
		cursor: pointer;
	}
	.k:last-child {
		border-right: 0;
	}
	.k.now {
		cursor: default;
	}
	.k.on {
		background: var(--surface-inverse);
		color: var(--text-inverse);
	}
	.kn {
		font: 400 11px var(--font-mono);
		letter-spacing: 0.02em;
		color: var(--text-2);
	}
	.k.on .kn {
		color: inherit;
		opacity: 0.7;
	}
	.paths {
		display: flex;
		flex-direction: column;
		margin: 0 24px;
		border: 1px solid var(--line-1);
	}
	.pr {
		display: flex;
		align-items: stretch;
		min-height: 48px;
		border-top: 1px solid var(--line-1);
	}
	.pr.first {
		border-top: 0;
	}
	.pl {
		display: flex;
		flex-shrink: 0;
		align-items: center;
		width: 72px;
		padding-left: 14px;
		border-right: 1px solid var(--line-1);
		font: 500 11px var(--font-mono);
		letter-spacing: 0.06em;
		color: var(--text-2);
	}
	.pv {
		display: flex;
		flex: 1;
		min-width: 0;
		flex-direction: column;
		justify-content: center;
		padding: 8px 12px;
		font: 400 12px/1.45 var(--font-mono);
		overflow-wrap: anywhere;
	}
	.mu {
		color: var(--text-2);
	}
	.words,
	.why {
		margin: 0;
		padding: 0 24px;
		font: 400 12px/1.6 var(--font-mono);
		color: var(--text-2);
	}
	.why {
		padding-top: 14px;
		color: var(--text-1);
	}
	.foot {
		flex-shrink: 0;
		border-top: 1px solid var(--line-1);
	}
	.go {
		display: flex;
		align-items: center;
		justify-content: space-between;
		width: 100%;
		min-height: 63px;
		padding: 0 24px;
		border: 0;
		background: var(--accent);
		color: var(--on-accent);
		font: 500 14px var(--font-mono);
		letter-spacing: 0.04em;
		cursor: pointer;
	}
	.go.dim {
		opacity: 0.4;
		cursor: default;
	}
	.gb {
		font: 400 12px var(--font-mono);
	}
</style>

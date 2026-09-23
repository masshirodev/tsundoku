<script lang="ts">
	import { enhance } from '$app/forms';
	import Sheet from '$lib/components/chrome/Sheet.svelte';
	import { parseTag, type SeriesPage, type SeriesTag } from '$lib/library/series';
	import { count } from '$lib/library/labels';
	import type { Shelf } from '$lib/library/types';
	import type { SubmitFunction } from '@sveltejs/kit';

	/**
	 * SHELVES & TAGS: one sheet for both. Shelves are toggles in the owner's
	 * order. Tags are typed as `namespace:value`, and suggestions come from
	 * existing tags so imports do not multiply spellings.
	 */
	let {
		open,
		series,
		shelves,
		tagMessage,
		onclose
	}: {
		open: boolean;
		series: SeriesPage;
		shelves: Shelf[];
		tagMessage?: string;
		onclose: () => void;
	} = $props();

	type Suggestion = SeriesTag & { count: number; onThis: boolean };

	const collections = $derived(shelves.filter((s) => s.kind === 'collection'));
	const onCount = $derived(
		collections.filter((c) => series.collections.includes(Number(c.key.slice(2)))).length
	);

	let naming = $state(false);
	let newShelf = $state('');
	let tagText = $state('');
	let suggestions = $state<Suggestion[]>([]);

	const grouped = $derived.by(() => {
		const by: Record<string, string[]> = {};
		for (const t of series.tags) (by[t.namespace] ??= []).push(t.value);
		return Object.entries(by);
	});

	// Suggestions follow the typing a beat behind it.
	let timer: ReturnType<typeof setTimeout> | undefined;
	$effect(() => {
		const text = tagText;
		clearTimeout(timer);
		if (!parseTag(text)) {
			suggestions = [];
			return;
		}
		timer = setTimeout(async () => {
			const res = await fetch(`/api/series/${series.id}/tags?q=${encodeURIComponent(text)}`);
			suggestions = res.ok ? await res.json() : [];
		}, 150);
		return () => clearTimeout(timer);
	});

	const reset: SubmitFunction =
		() =>
		async ({ update }) => {
			await update({ reset: false });
			tagText = '';
			newShelf = '';
			naming = false;
		};
</script>

<Sheet {open} {onclose} label="Shelves and tags">
	<div class="head">
		<div class="h-title">SHELVES &amp; TAGS</div>
		<button type="button" class="done" onclick={onclose}>DONE</button>
	</div>

	<div class="label"><span>SHELVES</span><span>IN {onCount} · YOUR ORDER</span></div>
	<ul class="shelves">
		{#each collections as c (c.key)}
			{@const on = series.collections.includes(Number(c.key.slice(2)))}
			<li>
				<form method="POST" action="?/shelf" use:enhance={reset}>
					<input type="hidden" name="collection" value={c.key.slice(2)} />
					<input type="hidden" name="on" value={on ? '0' : '1'} />
					<button type="submit" class="shelf" role="checkbox" aria-checked={on}>
						<span class="box" class:on>{on ? '✓' : ''}</span>
						<span class="name">{c.name}</span>
						<span class="n">{count(c.count)}</span>
					</button>
				</form>
			</li>
		{/each}
		<li>
			{#if naming}
				<form method="POST" action="?/shelf" use:enhance={reset} class="new">
					<!-- svelte-ignore a11y_autofocus -->
					<input
						name="name"
						bind:value={newShelf}
						placeholder="Shelf name"
						aria-label="New shelf name"
						autofocus
					/>
					<button type="submit" disabled={newShelf.trim() === ''}>ADD</button>
				</form>
			{:else}
				<button type="button" class="shelf add" onclick={() => (naming = true)}>+ NEW SHELF</button>
			{/if}
		</li>
	</ul>

	<div class="label tags-label"><span>TAGS</span><span>{series.tags.length}</span></div>
	<form method="POST" action="?/tag" use:enhance={reset} class="tag-form">
		<label class="field">
			<span aria-hidden="true">/</span>
			<input
				name="tag"
				bind:value={tagText}
				placeholder="namespace:value"
				aria-label="Add a tag, as namespace:value"
				autocomplete="off"
				autocapitalize="off"
				spellcheck="false"
			/>
		</label>
		{#if suggestions.length > 0}
			<ul class="sugg">
				{#each suggestions as s (s.namespace + ':' + s.value)}
					<li>
						<button type="submit" name="pick" value="{s.namespace}:{s.value}" disabled={s.onThis}>
							<span class="dim">{s.namespace || 'tag'}</span>
							<span class="v">{s.value}</span>
							<span class="dim">{s.onThis ? '✓ ON THIS' : count(s.count)}</span>
						</button>
					</li>
				{/each}
			</ul>
		{/if}
		{#if tagMessage}<div class="msg">{tagMessage}</div>{/if}
	</form>

	<div class="tag-groups">
		{#each grouped as [ns, values] (ns)}
			<div class="group">
				<div class="ns">{ns || 'tag'}</div>
				<div class="vals">
					{#each values as v (v)}
						<form method="POST" action="?/untag" use:enhance={reset} class="chip">
							<input type="hidden" name="namespace" value={ns} />
							<input type="hidden" name="value" value={v} />
							<span>{v}</span>
							<button type="submit" aria-label="Remove {ns ? `${ns}:` : ''}{v}">✕</button>
						</form>
					{/each}
				</div>
			</div>
		{/each}
	</div>
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
		display: flex;
		align-items: center;
		padding: 0 24px;
		font: 500 15px var(--font-mono);
		letter-spacing: 0.04em;
	}
	.done {
		padding: 0 28px;
		border: 0;
		border-radius: 0;
		background: var(--accent);
		color: var(--on-accent);
		font: 500 14px var(--font-mono);
		letter-spacing: 0.04em;
		cursor: pointer;
	}
	.label {
		display: flex;
		justify-content: space-between;
		padding: 18px 24px 10px;
		font: 500 13px var(--font-mono);
		color: var(--text-2);
		letter-spacing: var(--tracking-label);
	}
	.tags-label {
		padding-top: 22px;
	}
	.shelves {
		list-style: none;
		margin: 0;
		padding: 0;
		border-top: var(--hairline);
	}
	.shelf {
		width: 100%;
		display: flex;
		align-items: center;
		gap: 16px;
		height: 56px;
		padding: 0 24px;
		border: 0;
		border-bottom: var(--hairline);
		border-radius: 0;
		background: transparent;
		color: var(--text-1);
		text-align: left;
		cursor: pointer;
	}
	.shelf.add {
		font: 500 14px var(--font-mono);
		letter-spacing: 0.04em;
	}
	.shelf:active {
		background: var(--surface-inverse);
		color: var(--text-inverse);
	}
	.box {
		width: 24px;
		height: 24px;
		flex-shrink: 0;
		border: 1.5px solid var(--line-2);
		display: flex;
		align-items: center;
		justify-content: center;
		font: 500 14px var(--font-mono);
		color: var(--on-accent);
	}
	.box.on {
		border-color: var(--accent);
		background: var(--accent);
	}
	.name {
		flex: 1;
		font: 500 16px var(--font-sans);
	}
	.n {
		font: 400 13px var(--font-mono);
		color: var(--text-2);
	}
	.new {
		display: flex;
		height: 56px;
		border-bottom: var(--hairline);
	}
	.new input {
		flex: 1;
		min-width: 0;
		padding: 0 24px;
		border: 0;
		background: transparent;
		color: var(--text-1);
		caret-color: var(--accent);
		font: 500 16px var(--font-sans);
		outline: none;
	}
	.new button {
		padding: 0 24px;
		border: 0;
		border-left: var(--hairline);
		border-radius: 0;
		background: transparent;
		color: var(--text-1);
		font: 500 14px var(--font-mono);
		cursor: pointer;
	}
	.new button:disabled {
		opacity: 0.4;
		cursor: default;
	}
	.tag-form {
		margin: 0 24px;
	}
	.field {
		display: flex;
		align-items: center;
		gap: 1ch;
		height: 52px;
		padding: 0 16px;
		border: var(--rule-strong);
		font: 500 16px var(--font-mono);
	}
	.field input {
		flex: 1;
		min-width: 0;
		border: 0;
		outline: none;
		background: transparent;
		color: var(--text-1);
		caret-color: var(--accent);
		font: inherit;
	}
	.field input::placeholder {
		color: var(--text-2);
		font-weight: 400;
	}
	.sugg {
		list-style: none;
		margin: 0;
		padding: 0;
		border: var(--hairline);
		border-top: 0;
	}
	.sugg button {
		width: 100%;
		display: flex;
		align-items: center;
		gap: 12px;
		height: 48px;
		padding: 0 16px;
		border: 0;
		border-bottom: var(--hairline);
		border-radius: 0;
		background: transparent;
		color: var(--text-1);
		font: 500 14px var(--font-mono);
		text-align: left;
		cursor: pointer;
	}
	.sugg li:last-child button {
		border-bottom: 0;
	}
	.sugg button:disabled {
		cursor: default;
	}
	.sugg .v {
		flex: 1;
		font: 500 15px var(--font-sans);
	}
	.dim {
		color: var(--text-2);
	}
	.msg {
		padding-top: 8px;
		font: var(--type-meta);
		color: var(--text-2);
	}
	.tag-groups {
		display: flex;
		flex-direction: column;
		gap: 14px;
		padding: 20px 24px;
	}
	.group {
		display: flex;
		gap: 14px;
		align-items: flex-start;
	}
	.ns {
		width: 80px;
		flex-shrink: 0;
		padding-top: 11px;
		font: 400 12px var(--font-mono);
		color: var(--text-2);
		letter-spacing: 0.04em;
	}
	.vals {
		flex: 1;
		display: flex;
		flex-wrap: wrap;
		gap: 8px;
	}
	.chip {
		height: 38px;
		display: flex;
		align-items: center;
		gap: 10px;
		padding-left: 12px;
		border: 1px solid var(--line-2);
		font: 500 14px var(--font-sans);
	}
	.chip button {
		align-self: stretch;
		display: flex;
		align-items: center;
		padding: 0 10px;
		border: 0;
		border-left: 1px solid var(--line-2);
		border-radius: 0;
		background: transparent;
		color: var(--text-2);
		font: 500 12px var(--font-mono);
		cursor: pointer;
	}
	.chip button:active {
		background: var(--surface-inverse);
		color: var(--text-inverse);
	}
</style>

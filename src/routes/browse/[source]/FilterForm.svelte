<script lang="ts">
	import { onMount } from 'svelte';
	import {
		changedCount,
		EXCLUDE,
		groupCount,
		IGNORE,
		INCLUDE,
		readFilters,
		type FilterField
	} from '$lib/library/browse-filters';

	/**
	 * A source's own filters: one drawing for seven filter types, and nothing
	 * asked before APPLY. The library's panel rows: a label column, then cells.
	 * It's a GET form, since every change would ask the site again: choices
	 * change in place and APPLY sends them, landing on the FILTERED tab.
	 *
	 * Selects, sorts and check boxes are radio and check inputs drawn as cells,
	 * so they work without script. A tri-state is three radio cells (· + −)
	 * without script, and one chip that cycles with it.
	 */
	let {
		action,
		title,
		schema,
		applied,
		q,
		keep = [],
		resetHref,
		cancelHref
	}: {
		action: string;
		title: string;
		schema: FilterField[];
		applied: FilterField[];
		q: string;
		/** Parameters APPLY carries through unchanged: the page's `from`. */
		keep?: [string, string][];
		resetHref: string;
		cancelHref: string;
	} = $props();

	let js = $state(false);
	onMount(() => (js = true));

	// Tri-states with script: the chip's state, by key, sent as a hidden input.
	// svelte-ignore state_referenced_locally
	let tri = $state<Record<string, number>>(initialTri(applied));
	function initialTri(fields: FilterField[]) {
		const out: Record<string, number> = {};
		fields.forEach((f, i) =>
			f.children?.forEach((c, j) => {
				if (c.type === 'tristate') out[`f${i}.${j}`] = c.state as number;
			})
		);
		return out;
	}
	const cycle = (k: string) => (tri[k] = ((tri[k] ?? IGNORE) + 1) % 3);

	/** "5 ON", as the choices stand in the form, not as they were sent. */
	// svelte-ignore state_referenced_locally
	let on = $state(changedCount(schema, applied));
	let form = $state<HTMLFormElement | null>(null);
	function recount() {
		if (!form) return;
		// eslint-disable-next-line svelte/prefer-svelte-reactivity -- a throwaway, read once here
		const p = new URLSearchParams();
		for (const [k, v] of new FormData(form)) if (typeof v === 'string') p.append(k, v);
		on = changedCount(schema, readFilters(schema, p));
	}

	// A long list of tags gets a find field, which narrows the chips (script only).
	const tagCount = $derived(
		applied.reduce((n, f) => n + (f.children?.filter((c) => c.type === 'tristate').length ?? 0), 0)
	);
	let find = $state('');
	const shown = (name: string) => !find || name.toLowerCase().includes(find.trim().toLowerCase());
	const triTotals = $derived.by(() => {
		const v = Object.values(tri);
		return {
			inc: v.filter((s) => s === INCLUDE).length,
			exc: v.filter((s) => s === EXCLUDE).length
		};
	});

	const up = (s: string) => s.toUpperCase();
</script>

<form method="GET" {action} class="panel" bind:this={form} oninput={recount} onchange={recount}>
	<input type="hidden" name="tab" value="filtered" />
	{#if q}<input type="hidden" name="q" value={q} />{/if}
	{#each keep as [k, v] (k)}<input type="hidden" name={k} value={v} />{/each}

	<div class="head">
		<span>FILTER {up(title)}</span>
		<span class="count">{on} ON · ASKS THE SOURCE ON APPLY</span>
	</div>

	{#if js && tagCount > 30}
		<div class="row find">
			<div class="label">TAGS</div>
			<div class="find-cell">
				<input
					type="search"
					placeholder="/ find a tag"
					bind:value={find}
					aria-label="Find a tag"
					autocomplete="off"
				/>
				<span class="n"
					>{[
						triTotals.inc && `${triTotals.inc} IN`,
						triTotals.exc && `${triTotals.exc} OUT`,
						String(tagCount)
					]
						.filter(Boolean)
						.join(' · ')}</span
				>
			</div>
		</div>
	{/if}

	{#each applied as f, i (i)}
		{@const k = `f${i}`}
		{#if f.type === 'header'}
			<div class="sub">{up(f.name)}</div>
		{:else if f.type === 'separator'}
			<div class="sep" aria-hidden="true"></div>
		{:else if f.type === 'select'}
			<fieldset class="row">
				<legend class="label">{up(f.name)}</legend>
				<div class="opts">
					{#each f.values ?? [] as v, n (n)}
						<label class="opt"
							><input type="radio" name={k} value={n} checked={f.state === n} /><span>{up(v)}</span
							></label
						>
					{/each}
				</div>
			</fieldset>
		{:else if f.type === 'sort'}
			{@const s = f.state && typeof f.state === 'object' ? f.state : null}
			<fieldset class="row">
				<legend class="label">{up(f.name)}</legend>
				<div class="opts">
					{#each f.values ?? [] as v, n (n)}
						<label class="opt"
							><input type="radio" name={k} value={n} checked={s?.index === n} /><span>{up(v)}</span
							></label
						>
					{/each}
					<label class="opt" title="Descending"
						><input type="radio" name="{k}.o" value="d" checked={!s?.ascending} /><span>↓</span
						></label
					>
					<label class="opt" title="Ascending"
						><input type="radio" name="{k}.o" value="a" checked={!!s?.ascending} /><span>↑</span
						></label
					>
				</div>
			</fieldset>
		{:else if f.type === 'checkbox'}
			<div class="row">
				<div class="label"></div>
				<div class="opts">
					<label class="opt box"
						><input type="checkbox" name={k} value="1" checked={f.state === true} /><span
							class="chk"
							aria-hidden="true">✓</span
						><span>{up(f.name)}</span></label
					>
				</div>
			</div>
		{:else if f.type === 'text'}
			<div class="row">
				<label class="label" for={k}>{up(f.name)}</label>
				<input class="text" id={k} name={k} value={f.state as string} placeholder="any" />
			</div>
		{:else if f.type === 'group'}
			{@const kids = f.children ?? []}
			{#if kids.every((c) => c.type === 'checkbox')}
				<fieldset class="row">
					<legend class="label">{up(f.name)}</legend>
					<div class="opts">
						{#each kids as c, j (j)}
							<label class="opt box"
								><input type="checkbox" name="{k}.{j}" value="1" checked={c.state === true} /><span
									class="chk"
									aria-hidden="true">✓</span
								><span>{up(c.name)}</span></label
							>
						{/each}
					</div>
				</fieldset>
			{:else if kids.every((c) => c.type === 'select')}
				{#each kids as c, j (j)}
					<fieldset class="row">
						<legend class="label">{up(c.name)}</legend>
						<div class="opts">
							{#each c.values ?? [] as v, n (n)}
								<label class="opt"
									><input type="radio" name="{k}.{j}" value={n} checked={c.state === n} /><span
										>{up(v)}</span
									></label
								>
							{/each}
						</div>
					</fieldset>
				{/each}
			{:else}
				{@const count = js
					? groupCount({
							...f,
							children: kids.map((c, j) => ({ ...c, state: tri[`${k}.${j}`] ?? c.state }))
						})
					: groupCount(f)}
				<fieldset class="row chips-row">
					<legend class="label stack"
						><span>{up(f.name)}</span>{#if count}<span class="n">{count}</span>{/if}</legend
					>
					<div class="chips">
						{#each kids as c, j (j)}
							{@const ck = `${k}.${j}`}
							{#if c.type === 'checkbox'}
								<label class="chip box-chip"
									><input type="checkbox" name={ck} value="1" checked={c.state === true} /><span
										>{c.name}</span
									></label
								>
							{:else if js}
								{#if shown(c.name)}
									<button
										type="button"
										class="chip"
										class:in={tri[ck] === INCLUDE}
										class:out={tri[ck] === EXCLUDE}
										aria-label="{c.name}: {tri[ck] === INCLUDE
											? 'included'
											: tri[ck] === EXCLUDE
												? 'excluded'
												: 'either'}"
										onclick={() => {
											cycle(ck);
											queueMicrotask(recount);
										}}
										>{tri[ck] === INCLUDE ? '+ ' : tri[ck] === EXCLUDE ? '− ' : ''}{c.name}</button
									>
								{/if}
								<input type="hidden" name={ck} value={tri[ck] ?? IGNORE} />
							{:else}
								<span class="tri" role="radiogroup" aria-label={c.name}>
									<span class="tri-name">{c.name}</span>
									{#each [IGNORE, INCLUDE, EXCLUDE] as s (s)}
										<label class="tri-opt"
											><input
												type="radio"
												name={ck}
												value={s}
												checked={c.state === s}
												aria-label={s === IGNORE ? 'either' : s === INCLUDE ? 'include' : 'exclude'}
											/><span>{s === IGNORE ? '·' : s === INCLUDE ? '+' : '−'}</span></label
										>
									{/each}
								</span>
							{/if}
						{/each}
					</div>
				</fieldset>
			{/if}
		{/if}
	{/each}

	<div class="foot">
		<!-- eslint-disable svelte/no-navigation-without-resolve -- both are built from resolve() by the page -->
		<a class="reset" href={resetHref}>✕ RESET</a>
		<a class="cancel" href={cancelHref}>CANCEL</a>
		<!-- eslint-enable svelte/no-navigation-without-resolve -->
		<button type="submit" class="apply">APPLY · ASK AGAIN</button>
	</div>
</form>

<style>
	/* Transcribed from the design: its literals; colours are tokens. */
	.panel {
		display: flex;
		flex-direction: column;
		flex-shrink: 0;
		border-top: 1px solid var(--text-1);
		background: var(--surface-page);
	}
	.head {
		display: flex;
		justify-content: space-between;
		gap: 12px;
		padding: 14px 16px;
		border-bottom: var(--hairline);
		font: 500 12px var(--font-mono);
		letter-spacing: 0.06em;
		color: var(--text-2);
	}
	.head .count {
		color: var(--text-1);
	}
	fieldset {
		margin: 0;
		padding: 0;
		border: 0;
		min-width: 0;
	}
	.row {
		display: flex;
		border-bottom: var(--hairline);
	}
	/* A <legend> won't sit in a flex row; floating it out of the fieldset's
	   rendering and back in as a block makes it one more flex item. */
	legend.label {
		float: left;
	}
	.label {
		box-sizing: border-box;
		display: flex;
		flex-direction: column;
		justify-content: center;
		gap: 4px;
		flex-shrink: 0;
		width: 150px;
		padding: 0 16px;
		border-right: var(--hairline);
		font: 500 12px var(--font-mono);
		letter-spacing: 0.06em;
		color: var(--text-2);
	}
	.label.stack {
		justify-content: flex-start;
		gap: 6px;
		padding: 18px 16px;
	}
	.label .n {
		color: var(--text-1);
	}
	.opts {
		display: flex;
		flex-wrap: wrap;
		flex: 1 1 0%;
		min-width: 0;
	}
	.opt {
		display: flex;
		align-items: center;
		gap: 10px;
		min-height: 52px;
		padding: 0 14px;
		border-right: var(--hairline);
		font: 500 14px var(--font-mono);
		white-space: nowrap;
		color: var(--text-1);
		cursor: pointer;
		user-select: none;
	}
	.opt input,
	.chip input,
	.tri-opt input {
		position: absolute;
		opacity: 0;
		pointer-events: none;
	}
	.opt:not(.box):has(input:checked) {
		background: var(--surface-inverse);
		color: var(--text-inverse);
	}
	.opt:has(input:focus-visible),
	.chip:has(input:focus-visible),
	.tri-opt:has(input:focus-visible) {
		outline: 2px solid var(--accent);
		outline-offset: -2px;
	}
	.chk {
		box-sizing: border-box;
		display: flex;
		align-items: center;
		justify-content: center;
		width: 20px;
		height: 20px;
		border: 2px solid var(--line-2);
		color: transparent;
		font: 700 13px var(--font-mono);
	}
	.box:has(input:checked) .chk {
		border-color: var(--accent);
		background: var(--accent);
		color: var(--on-accent);
	}
	.text {
		box-sizing: border-box;
		flex: 1 1 0%;
		min-width: 0;
		min-height: 52px;
		margin: 6px 12px;
		padding: 0 14px;
		border: 1px solid var(--line-2);
		border-radius: 0;
		background: transparent;
		color: var(--text-1);
		font: 400 15px var(--font-mono);
	}
	.text::placeholder {
		color: var(--text-2);
	}
	.find {
		background: var(--surface-panel);
	}
	.find .label {
		color: var(--text-1);
	}
	.find-cell {
		display: flex;
		flex: 1 1 0%;
		align-items: center;
		justify-content: space-between;
		gap: 12px;
		min-width: 0;
		min-height: 52px;
		padding: 0 16px;
		color: var(--text-2);
		font: 400 14px var(--font-mono);
	}
	.find-cell input {
		flex: 1 1 0%;
		min-width: 0;
		border: 0;
		background: transparent;
		color: var(--text-1);
		font: inherit;
		outline: none;
	}
	.find-cell .n {
		font-weight: 500;
		letter-spacing: 0.04em;
		white-space: nowrap;
	}
	.chips {
		display: flex;
		flex-wrap: wrap;
		flex: 1 1 0%;
		gap: 6px;
		min-width: 0;
		padding: 10px 12px;
	}
	.chip {
		box-sizing: border-box;
		display: flex;
		align-items: center;
		height: 36px;
		padding: 0 10px;
		border: 1px solid var(--line-2);
		border-radius: 0;
		background: transparent;
		color: var(--text-1);
		font: 500 13px var(--font-mono);
		white-space: nowrap;
		cursor: pointer;
	}
	.chip.in,
	.box-chip:has(input:checked) {
		border-color: var(--accent);
		background: var(--accent);
		color: var(--on-accent);
	}
	.chip.out {
		border-color: var(--text-1);
		text-decoration: line-through;
	}
	/* Without script: a tag and its three cells, · + −. */
	.tri {
		display: flex;
		align-items: stretch;
		height: 36px;
		border: 1px solid var(--line-2);
		font: 500 13px var(--font-mono);
	}
	.tri-name {
		display: flex;
		align-items: center;
		padding: 0 10px;
	}
	.tri-opt {
		display: flex;
		align-items: center;
		justify-content: center;
		width: 28px;
		border-left: 1px solid var(--line-2);
		font: 500 13px var(--font-mono);
		cursor: pointer;
	}
	.tri-opt:has(input:checked) {
		background: var(--surface-inverse);
		color: var(--text-inverse);
	}
	.sub {
		padding: 14px 16px 10px;
		border-bottom: var(--hairline);
		font: 500 12px var(--font-mono);
		letter-spacing: 0.06em;
		color: var(--text-2);
	}
	.sep {
		border-bottom: var(--hairline);
		height: 12px;
	}
	.foot {
		position: sticky;
		bottom: 0;
		z-index: 6;
		display: flex;
		height: 56px;
		border-top: 1px solid var(--text-1);
		background: var(--surface-page);
		font: 500 14px var(--font-mono);
	}
	.foot a,
	.foot button {
		display: flex;
		align-items: center;
		padding: 0 16px;
		color: var(--text-1);
		text-decoration: none;
	}
	.reset {
		flex: 1 1 0%;
	}
	.cancel {
		border-left: var(--hairline);
		color: var(--text-2) !important;
	}
	.apply {
		padding: 0 24px !important;
		border: 0;
		border-radius: 0;
		background: var(--accent);
		color: var(--on-accent) !important;
		font: inherit;
		cursor: pointer;
	}
	@media (max-width: 599px) {
		.label {
			width: 104px;
			padding: 0 12px;
		}
	}
</style>

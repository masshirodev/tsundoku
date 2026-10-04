<script lang="ts">
	import { goto } from '$app/navigation';
	import RatingSlider from './RatingSlider.svelte';
	import { activeCount, filterRows, NO_FILTERS, type Filters } from '$lib/library/filters';
	import { onMount } from 'svelte';

	/**
	 * FILTER (Library Filters turn 3, card c68; doc/FILTERS.md): a cell that
	 * opens a panel of every filter, one row each, that narrows whichever
	 * shelf is showing. RATING is one line: ANY, UNRATED, AT LEAST and the
	 * blocks, where dragging the blocks picks AT LEAST by itself.
	 *
	 * Two ways to commit, as RatingSlider has:
	 * - `href`: every choice is a link to the URL with that filter changed, so
	 *   the library works without script. The panel is a <details>, and DATE
	 *   ADDED is a GET form with a SET button that script hides.
	 * - `onchange`: buttons, for a page that filters on the device (a
	 *   person's page).
	 *
	 * The caller places it: pinned at the end of the tabs on phone and tablet,
	 * in the top bar beside SELECT on the desktop (`wide`, 640px from the right).
	 */
	let {
		filters,
		languages,
		reveal,
		title,
		count,
		href,
		onchange,
		formAction = '',
		keep = [],
		wide = false,
		downloaded = true,
		following = false
	}: {
		filters: Filters;
		/** Codes present on the shelf: LANGUAGE offers these, and doesn't exist without any. */
		languages: string[];
		reveal: boolean;
		/** "FILTER MANHWA": what's being narrowed. */
		title: string;
		/** The head's count: "44 OF 188" while narrowed. */
		count: string;
		href?: (f: Filters) => string;
		onchange?: (f: Filters) => void;
		/** DATE ADDED's form without script: where it goes, and what else it carries. */
		formAction?: string;
		keep?: [string, string][];
		wide?: boolean;
		/** Off where cards don't know it (a person's page). */
		downloaded?: boolean;
		/** Something visible is followed: FOLLOWED is offered (doc/DOWNLOADING.md). */
		following?: boolean;
	} = $props();

	let open = $state(false);
	let hydrated = $state(false);
	onMount(() => (hydrated = true));
	let panel = $state<HTMLElement | null>(null);
	// Opened low on a page (a person's page, below its header), the panel
	// comes into view rather than opening off the bottom of the screen.
	$effect(() => {
		if (open && panel) panel.scrollIntoView({ block: 'nearest' });
	});

	const n = $derived(activeCount(filters));
	const rows = $derived(
		filterRows(filters, languages, reveal, following).filter((r) => downloaded || r.key !== 'dl')
	);
	const cleared = NO_FILTERS;

	function choose(f: Filters) {
		if (onchange) onchange(f);
		// eslint-disable-next-line svelte/no-navigation-without-resolve -- the caller's href resolves
		else if (href) void goto(href(f), { noScroll: true, keepFocus: true });
	}
	function setDay(e: Event) {
		const v = (e.currentTarget as HTMLInputElement).value;
		choose({ ...filters, added: v || null });
	}
</script>

<details class="filter" class:wide bind:open>
	<summary class="cell" aria-label={n ? `Filter, ${n} on` : 'Filter'}>
		<span>FILTER</span>
		{#if n}<span class="badge">{n}</span>{/if}
		<span aria-hidden="true">{open ? '▴' : '▾'}</span>
	</summary>
	<!-- A tap outside closes it, as a sheet's scrim does. -->
	<button type="button" class="scrim" aria-label="Close filters" onclick={() => (open = false)}
	></button>
	<div class="panel" role="group" aria-label="Filters" bind:this={panel}>
		<div class="head"><span>FILTER {title}</span><span class="count">{count}</span></div>
		{#each rows as row (row.key)}
			<div class="row" class:hid={row.key === 'hidden'}>
				<div class="label">{row.label}</div>
				<div class="opts" class:rating={row.key === 'rating'}>
					{#each row.choices as c (c.label)}
						{#if href && !onchange}
							<!-- eslint-disable svelte/no-navigation-without-resolve -- the caller's href resolves -->
							<a
								class="opt"
								class:on={c.on}
								href={href(c.to)}
								aria-current={c.on ? 'true' : undefined}
								data-sveltekit-noscroll
								data-sveltekit-keepfocus>{c.label}</a
							>
							<!-- eslint-enable svelte/no-navigation-without-resolve -->
						{:else}
							<button
								type="button"
								class="opt"
								class:on={c.on}
								aria-pressed={c.on}
								onclick={() => choose(c.to)}>{c.label}</button
							>
						{/if}
					{/each}
					{#if row.key === 'rating'}
						<div class="blocks">
							<RatingSlider
								mode="min"
								label={null}
								value={filters.min ?? 0}
								height={53}
								phoneHeight={53}
								borderTop={false}
								borderBottom={false}
								href={onchange || !href
									? undefined
									: (m) => href({ ...filters, min: m, unrated: false })}
								onchange={onchange
									? (m) => choose({ ...filters, min: m, unrated: false })
									: undefined}
							/>
						</div>
					{:else if row.key === 'added'}
						<form class="since" class:on={filters.added} method="GET" action={formAction}>
							{#each keep as [k, v] (k)}<input type="hidden" name={k} value={v} />{/each}
							<label
								><span>SINCE</span><input
									type="date"
									name="added"
									value={filters.added ?? ''}
									onchange={setDay}
								/></label
							>
							{#if !hydrated}<button type="submit" class="set">SET</button>{/if}
						</form>
					{/if}
				</div>
			</div>
		{/each}
		<div class="foot">
			{#if href && !onchange}
				<!-- eslint-disable-next-line svelte/no-navigation-without-resolve -- the caller's href resolves -->
				<a class="clear" class:none={n === 0} href={href(cleared)} data-sveltekit-noscroll
					>✕ CLEAR ALL</a
				>
			{:else}
				<button type="button" class="clear" class:none={n === 0} onclick={() => choose(cleared)}
					>✕ CLEAR ALL</button
				>
			{/if}
			<button type="button" class="done" onclick={() => (open = false)}>DONE</button>
		</div>
	</div>
</details>

<style>
	/* Library Filters.dc.html, turn 3, transcribed: the mock's literals; colours are tokens. */
	.filter {
		display: flex;
		flex-shrink: 0;
	}
	.cell {
		display: flex;
		align-items: center;
		gap: 8px;
		height: 100%;
		padding: 0 16px;
		border-left: var(--hairline);
		font: 500 14px var(--font-mono);
		color: var(--text-1);
		cursor: pointer;
		list-style: none;
		user-select: none;
		/* Above the scrim, as the tabs beside it are: the bar stays lit. */
		position: relative;
		z-index: 5;
		background: var(--surface-page);
	}
	.cell::-webkit-details-marker {
		display: none;
	}
	/* A <details> doesn't stretch its summary, so the top bar's cell takes the
	   bar's height itself (3j). */
	.wide .cell {
		padding: 0 20px;
		height: calc(var(--header-h) - 1px);
	}
	/* The desktop's scrim leaves the sidebar and the top bar lit (3j). */
	.wide .scrim {
		top: var(--header-h);
		left: var(--sidebar-w);
	}
	.filter[open] .cell {
		background: var(--surface-inverse);
		color: var(--text-inverse);
	}
	.badge {
		padding: 1px 6px;
		background: var(--accent);
		color: var(--on-accent);
		font: 500 12px var(--font-mono);
	}
	.scrim {
		position: fixed;
		inset: 0;
		z-index: 4;
		border: 0;
		border-radius: 0;
		padding: 0;
		background: var(--scrim);
		cursor: default;
	}
	.panel {
		position: absolute;
		top: 100%;
		left: 0;
		right: 0;
		z-index: 6;
		margin-top: 1px;
		display: flex;
		flex-direction: column;
		background: var(--surface-page);
		border-top: 1px solid var(--text-1);
		border-bottom: var(--hairline);
	}
	.wide .panel {
		left: auto;
		width: 640px;
		border-left: var(--hairline);
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
	.row {
		display: flex;
		border-bottom: var(--hairline);
	}
	.label {
		display: flex;
		align-items: center;
		flex-shrink: 0;
		width: 132px;
		padding: 0 16px;
		border-right: var(--hairline);
		font: 500 12px var(--font-mono);
		letter-spacing: 0.06em;
		color: var(--text-2);
	}
	.hid .label {
		color: var(--reveal);
	}
	.opts {
		flex: 1 0 auto;
		min-width: 0;
		display: flex;
		min-height: 52px;
	}
	.opt {
		display: flex;
		align-items: center;
		flex-shrink: 0;
		min-height: 52px;
		padding: 0 14px;
		border: 0;
		border-right: var(--hairline);
		border-radius: 0;
		background: transparent;
		color: var(--text-1);
		font: 500 14px var(--font-mono);
		white-space: nowrap;
		cursor: pointer;
	}
	.opt.on {
		background: var(--surface-inverse);
		color: var(--text-inverse);
	}
	.hid .opt:not(.on) {
		color: var(--reveal);
	}
	.hid .opt.on {
		background: var(--reveal);
		color: var(--on-reveal);
	}
	.blocks {
		flex: 1 1 0%;
		min-width: 0;
		height: 52px;
		overflow: hidden;
	}
	.since {
		display: flex;
	}
	.since label {
		display: flex;
		align-items: center;
		gap: 10px;
		padding: 0 14px;
		border-right: var(--hairline);
		font: 500 14px var(--font-mono);
		color: var(--text-1);
		cursor: pointer;
	}
	.since.on label {
		background: var(--surface-inverse);
		color: var(--text-inverse);
	}
	.since input {
		background: transparent;
		border: 0;
		padding: 0;
		color: inherit;
		font: 500 14px var(--font-mono);
		color-scheme: dark;
	}
	.since.on input {
		color-scheme: light;
	}
	.set {
		padding: 0 14px;
		border: 0;
		border-right: var(--hairline);
		border-radius: 0;
		background: transparent;
		color: var(--text-1);
		font: 500 14px var(--font-mono);
	}
	.foot {
		display: flex;
		height: 52px;
	}
	.clear {
		flex: 1;
		display: flex;
		align-items: center;
		padding: 0 16px;
		border: 0;
		border-radius: 0;
		background: transparent;
		color: var(--text-1);
		font: 500 14px var(--font-mono);
		cursor: pointer;
	}
	.clear.none {
		opacity: 0.4;
	}
	.done {
		display: flex;
		align-items: center;
		padding: 0 24px;
		border: 0;
		border-radius: 0;
		background: var(--accent);
		color: var(--on-accent);
		font: 500 14px var(--font-mono);
		cursor: pointer;
	}
	/* The phone (3d): each label above its choices, so RATING still gets a
	   whole line for ANY, AT LEAST and the blocks. */
	@media (max-width: 599px) {
		.row {
			flex-direction: column;
		}
		.label {
			width: auto;
			padding: 12px 16px 6px;
			border-right: 0;
		}
		.opts {
			flex-wrap: wrap;
		}
		.blocks {
			flex-basis: 100%;
			border-top: var(--hairline);
		}
	}
</style>

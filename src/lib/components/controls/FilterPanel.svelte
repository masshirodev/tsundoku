<script lang="ts">
	import { goto } from '$app/navigation';
	import { MediaQuery } from 'svelte/reactivity';
	import { TV } from '$lib/device.svelte';
	import RatingSlider from './RatingSlider.svelte';
	import {
		activeCount,
		filterRows,
		NO_FILTERS,
		type FilterKind,
		type Filters
	} from '$lib/library/filters';
	import { onMount } from 'svelte';
	import { lockPageWhileShown } from '$lib/scroll-lock';

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
	 * The caller places it: at the end of the library's KIND band on phone,
	 * tablet and TV (`band`, c436), in the top bar beside SELECT on the desktop
	 * (`wide`, 640px from the right), and beside a person's page's tabs.
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
		following = false,
		reading = true,
		kinds = [],
		band = false,
		kindRow = true,
		formRow = false,
		countKind = true,
		onchoose
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
		/** Off where cards don't know their progress (a person's page, which has its own UNREAD tab). */
		reading?: boolean;
		/** The kinds on the shelf: KIND is offered where there are two to tell apart. */
		kinds?: readonly FilterKind[];
		/** At the KIND band's end (c436): the band's 40px row and 13px type. */
		band?: boolean;
		/** FILTER's KIND row: off on the library, where the KIND band is that choice (c436). */
		kindRow?: boolean;
		/** FORM (SERIES · ONE-OFF, c436): the library's; a person's page has none. */
		formRow?: boolean;
		/** Whether the badge counts a kind: not where the band shows it (c436). */
		countKind?: boolean;
		/**
		 * A choice is being made here (c557): a row's cell, CLEAR ALL, the date,
		 * or the rating blocks, with the click when there is one. Called before
		 * the navigation it starts, so the caller can say where the page should
		 * land once it has drawn (the library's pinned band); it navigates
		 * nothing itself. A press on the rating blocks passes its PointerEvent,
		 * so a right-click or a modified one can be told apart. A person's page
		 * and BROWSE's filter pass none.
		 */
		onchoose?: (e?: MouseEvent) => void;
	} = $props();

	/**
	 * The <details> is the truth and `open` only follows it (c105). Before
	 * hydration a tap opens it natively; `bind:open` then wrote its `false`
	 * back on mount and shut the panel under the finger, so on a slow tablet
	 * a fast first tap came to nothing. Read once on mount, kept by `toggle`,
	 * and closed through the element.
	 */
	const tvScreen = new MediaQuery(TV, false);

	let details = $state<HTMLDetailsElement | null>(null);
	let open = $state(false);
	let hydrated = $state(false);
	onMount(() => {
		hydrated = true;
		open = details?.open ?? false;
	});
	function close() {
		if (details) details.open = false;
	}
	let panel = $state<HTMLElement | null>(null);
	// Opened low on a page (a person's page, below its header), the panel
	// comes into view rather than opening off the bottom of the screen.
	$effect(() => {
		if (open && panel) panel.scrollIntoView({ block: 'nearest' });
	});
	// The page under the scrim holds still while the panel is open, as it does
	// under a sheet (c1033): a drag on the scrim scrolled the library behind
	// it. The panel scrolls itself instead, so its last rows stay reachable on
	// a short screen. Only while it is drawn: the top bar's is hidden with its
	// cell below 1024px, open or not.
	$effect(() => {
		if (open && panel) return lockPageWhileShown(panel);
	});

	const n = $derived(activeCount(filters, countKind));
	const rows = $derived(
		filterRows(filters, languages, reveal, following, reading, kinds, {
			kind: kindRow,
			form: formRow
		}).filter((r) => downloaded || r.key !== 'dl')
	);
	// CLEAR ALL clears what FILTER holds: on the library the kind is the band's, so it stays.
	const cleared = $derived(kindRow ? NO_FILTERS : { ...NO_FILTERS, kind: filters.kind });

	function choose(f: Filters) {
		onchoose?.();
		if (onchange) onchange(f);
		// eslint-disable-next-line svelte/no-navigation-without-resolve -- the caller's href resolves
		else if (href) void goto(href(f), { noScroll: true, keepFocus: true });
	}
	function setDay(e: Event) {
		const v = (e.currentTarget as HTMLInputElement).value;
		choose({ ...filters, added: v || null });
	}
</script>

<details
	class="filter"
	class:wide
	class:band
	bind:this={details}
	ontoggle={(e) => (open = e.currentTarget.open)}
>
	<!-- A cell of a ruled row (the KIND band, the top bar): the focus mark
	     sits inside it, as on the cells beside it (doc/FOCUS.md). -->
	<summary class="cell" aria-label={n ? `Filter, ${n} on` : 'Filter'} data-focus-mark="in">
		<span>FILTER</span>
		{#if n}<span class="badge">{n}</span>{/if}
		<span aria-hidden="true">{open ? '▴' : '▾'}</span>
	</summary>
	<!-- A tap outside closes it, as a sheet's scrim does. -->
	<button type="button" class="scrim" aria-label="Close filters" onclick={close}></button>
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
								data-sveltekit-keepfocus
								onclick={(e) => onchoose?.(e)}>{c.label}</a
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
						<!-- The blocks are RatingSlider's own links and drag, which call
						     nothing back: a press on them, or a key that moves them, is a
						     choice being made (c557). Only what RatingSlider acts on: the
						     press goes with its button (a right-click drags nothing), Enter
						     follows the focused block's link, and ← → move it on a TV only;
						     Home, End and Space move nothing anywhere. -->
						<div
							class="blocks"
							role="presentation"
							onpointerdowncapture={(e) => onchoose?.(e)}
							onkeydowncapture={(e) => {
								const moves =
									e.key === 'Enter' ||
									(tvScreen.current && (e.key === 'ArrowLeft' || e.key === 'ArrowRight'));
								if (moves && !e.metaKey && !e.ctrlKey && !e.shiftKey && !e.altKey) onchoose?.();
							}}
						>
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
				<!-- eslint-disable svelte/no-navigation-without-resolve -- the caller's href resolves -->
				<a
					class="clear"
					class:none={n === 0}
					href={href(cleared)}
					data-sveltekit-noscroll
					onclick={(e) => onchoose?.(e)}>✕ CLEAR ALL</a
				>
				<!-- eslint-enable svelte/no-navigation-without-resolve -->
			{:else}
				<button type="button" class="clear" class:none={n === 0} onclick={() => choose(cleared)}
					>✕ CLEAR ALL</button
				>
			{/if}
			<button type="button" class="done" onclick={close}>DONE</button>
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
	/* At the KIND band's end (Kinds Calls 05, "FILTER CELL"): the band's own
	   type, 13px, and its padding, 0 14px; the TV's 17px and 0 18px. */
	.band .cell {
		gap: 6px;
		padding: 0 14px;
		font: 500 13px/1 var(--font-mono);
	}
	.band .badge {
		padding: 3px 5px;
		font: 500 12px/1 var(--font-mono);
	}
	@media (pointer: none) and (min-width: 900px) {
		.band .cell {
			padding: 0 18px;
			font-size: 17px;
		}
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
		/* The page is locked while it is open (c1033), so the panel scrolls
		   itself, as BROWSE's filter does, and its scroll ends at its edge. */
		max-height: 70dvh;
		overflow-y: auto;
		overscroll-behavior: contain;
		background: var(--surface-page);
		border-top: 1px solid var(--text-1);
		border-bottom: var(--hairline);
	}
	/* Rows keep their height and the panel scrolls, rather than squeezing them. */
	.panel > * {
		flex-shrink: 0;
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

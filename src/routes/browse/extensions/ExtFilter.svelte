<script lang="ts">
	import { onMount } from 'svelte';
	import { lockPageWhileShown } from '$lib/scroll-lock';
	import {
		NO_EXT_FILTERS,
		activeExtFilters,
		toggleLang,
		type ExtFilters
	} from '$lib/library/ext-filters';

	/**
	 * AVAILABLE's FILTER (doc/BROWSE.md, "Filters"; the owner, 2026-10-31): the
	 * library's FILTER cell and panel (Library Filters 3; FilterPanel.svelte),
	 * with EXTENSIONS' rows. LANGUAGE takes several at once and starts from
	 * SETTINGS' languages; MINE goes back to them. Every choice is a link, so
	 * the list works without script.
	 */
	let {
		filters,
		mine,
		languages,
		repos,
		novels = false,
		title,
		count,
		href
	}: {
		filters: ExtFilters;
		/** SETTINGS › 03 — BROWSE's languages: where LANGUAGE starts. */
		mine: string[];
		/** Every language the list holds: LANGUAGE's choices. */
		languages: string[];
		repos: { key: string; name: string }[];
		/** LNReader marks nothing 18+: no 18+ row for novels. */
		novels?: boolean;
		title: string;
		count: string;
		href: (f: ExtFilters) => string;
	} = $props();

	/**
	 * The <details> is the truth and `open` only follows it, as in
	 * FilterPanel.svelte (c105, c473). Before hydration a tap opens it
	 * natively; `bind:open` then wrote its `false` back at hydration and shut
	 * the panel under the finger. Read once on mount, kept by `toggle`, and
	 * closed through the element.
	 */
	let details = $state<HTMLDetailsElement | null>(null);
	let open = $state(false);
	onMount(() => {
		open = details?.open ?? false;
	});
	function close() {
		if (details) details.open = false;
	}
	// The page under the scrim holds still while the panel is open and drawn,
	// as FILTER's does (c1033); the panel scrolls itself.
	let panel = $state<HTMLElement | null>(null);
	$effect(() => {
		if (open && panel) return lockPageWhileShown(panel);
	});
	const n = $derived(activeExtFilters(filters));
	const asked = $derived(filters.langs ?? mine);
	// The languages there are, SETTINGS' first (they're the likely ones).
	const langChoices = $derived([
		...mine.filter((l) => languages.includes(l)),
		...languages.filter((l) => !mine.includes(l))
	]);
	type Choice = { label: string; on: boolean; to: ExtFilters };
	const rows = $derived.by(() => {
		const out: { key: string; label: string; choices: Choice[] }[] = [];
		if (langChoices.length > 1)
			out.push({
				key: 'lang',
				label: 'LANGUAGE',
				choices: [
					{ label: 'MINE', on: filters.langs === null, to: { ...filters, langs: null } },
					...langChoices.map((l) => ({
						label: l.toUpperCase(),
						on: asked.length > 0 && asked.includes(l),
						to: toggleLang(filters, mine, l)
					}))
				]
			});
		out.push({
			key: 'installed',
			label: 'INSTALLED',
			choices: (['any', 'yes', 'no'] as const).map((v) => ({
				label: v === 'any' ? 'ANY' : v === 'yes' ? 'INSTALLED' : 'NOT INSTALLED',
				on: filters.installed === v,
				to: { ...filters, installed: v }
			}))
		});
		if (repos.length > 1)
			out.push({
				key: 'repo',
				label: 'REPOSITORY',
				choices: [
					{ label: 'ANY', on: !filters.repo, to: { ...filters, repo: null } },
					...repos.map((r) => ({
						label: r.name.toUpperCase(),
						on: filters.repo === r.key,
						to: { ...filters, repo: r.key }
					}))
				]
			});
		if (!novels)
			out.push({
				key: 'adult',
				label: '18+',
				choices: (['any', 'only', 'none'] as const).map((v) => ({
					label: v.toUpperCase(),
					on: filters.adult === v,
					to: { ...filters, adult: v }
				}))
			});
		out.push({
			key: 'library',
			label: 'IN LIBRARY',
			choices: [
				{ label: 'ANY', on: !filters.library, to: { ...filters, library: false } },
				{ label: 'HAS SERIES HERE', on: filters.library, to: { ...filters, library: true } }
			]
		});
		return out;
	});
</script>

<details class="filter" bind:this={details} ontoggle={(e) => (open = e.currentTarget.open)}>
	<summary class="cell" aria-label={n ? `Filter, ${n} on` : 'Filter'}>
		<span>FILTER</span>
		{#if n}<span class="badge">{n}</span>{/if}
		<span aria-hidden="true">{open ? '▴' : '▾'}</span>
	</summary>
	<button type="button" class="scrim" aria-label="Close filters" onclick={close}></button>
	<div class="panel" role="group" aria-label="Filters" bind:this={panel}>
		<div class="head"><span>FILTER {title}</span><span class="count">{count}</span></div>
		{#each rows as row (row.key)}
			<div class="row">
				<div class="label">{row.label}</div>
				<div class="opts" class:wrap={row.key === 'lang' || row.key === 'repo'}>
					{#each row.choices as c (c.label)}
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
					{/each}
				</div>
			</div>
		{/each}
		<div class="foot">
			<!-- eslint-disable-next-line svelte/no-navigation-without-resolve -- the caller's href resolves -->
			<a class="clear" class:none={n === 0} href={href(NO_EXT_FILTERS)} data-sveltekit-noscroll
				>✕ CLEAR ALL</a
			>
			<button type="button" class="done" onclick={close}>DONE</button>
		</div>
	</div>
</details>

<style>
	/* FilterPanel.svelte's look (Library Filters 3), for EXTENSIONS' rows. */
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
		position: relative;
		z-index: 5;
		background: var(--surface-page);
	}
	.cell::-webkit-details-marker {
		display: none;
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
		max-height: 70dvh;
		overflow-y: auto;
		overscroll-behavior: contain;
		background: var(--surface-page);
		border-top: 1px solid var(--text-1);
		border-bottom: var(--hairline);
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
	.opts {
		flex: 1 1 auto;
		min-width: 0;
		display: flex;
		min-height: 52px;
	}
	/* Many languages, many repositories: they wrap onto ruled lines. */
	.opts.wrap {
		flex-wrap: wrap;
	}
	.opts.wrap .opt {
		border-bottom: var(--hairline);
		margin-bottom: -1px;
	}
	.opt {
		display: flex;
		align-items: center;
		flex-shrink: 0;
		min-height: 52px;
		padding: 0 14px;
		border-right: var(--hairline);
		color: var(--text-1);
		font: 500 14px var(--font-mono);
		text-decoration: none;
		white-space: nowrap;
	}
	.opt.on {
		background: var(--surface-inverse);
		color: var(--text-inverse);
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
		color: var(--text-1);
		font: 500 14px var(--font-mono);
		text-decoration: none;
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
	}
</style>

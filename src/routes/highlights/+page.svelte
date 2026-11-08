<script lang="ts">
	import { enhance } from '$app/forms';
	import { goto, invalidateAll } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { page } from '$app/state';
	import Band from '$lib/components/chrome/Band.svelte';
	import Badge from '$lib/components/content/Badge.svelte';
	import { num } from '$lib/i18n/format';
	import { m } from '$lib/paraglide/messages';
	import { splitMatch } from '$lib/library/search';
	import {
		byDay,
		clock,
		byEntry,
		clipLength,
		COLOURS,
		dayHeading,
		foundIn,
		HIGHLIGHT_KINDS,
		kindPlural,
		kindWord,
		metaLine,
		placeOf,
		sizeWord,
		stateTag,
		toMarkdown,
		wayBackHref,
		wayBackLabel,
		type Highlight
	} from '$lib/library/highlights';
	import { desktop } from '$lib/device.svelte';
	import { lockPage } from '$lib/scroll-lock';
	import type { PageProps } from './$types';

	/**
	 * HIGHLIGHTS (doc/HIGHLIGHTS.md). A list on the left, by day; the open
	 * item on the right, from 1024px with a fine pointer (where the sidebar
	 * is); below that one column, and the open item takes the whole screen.
	 * Every filter, the search and the open item live in the URL.
	 */
	let { data, form }: PageProps = $props();

	const f = $derived(data.filter);
	const inSeries = $derived(f.series !== null);
	const groups = $derived(
		inSeries
			? byEntry(data.items).map((g) => ({
					key: g.key,
					heading: g.heading,
					gone: g.gone,
					items: g.items
				}))
			: byDay(data.items, data.now).map((g) => ({
					key: g.day,
					heading: g.day,
					gone: false,
					items: g.items
				}))
	);
	const open = $derived(data.open);

	/** The page's URL with one thing changed, everything else kept. */
	function withParams(changes: Record<string, string | null>): string {
		const u = new URL(page.url);
		for (const [k, v] of Object.entries(changes)) {
			if (v === null || v === '') u.searchParams.delete(k);
			else u.searchParams.set(k, v);
		}
		return `${u.pathname}${u.search}`;
	}

	// The search: typed into the bar, kept in the URL as `q`.
	// Writable: typing sets it before the URL catches up; a navigation resets it.
	let q = $derived(data.filter.q);
	let typing: ReturnType<typeof setTimeout> | null = null;
	function search(value: string) {
		q = value;
		if (typing) clearTimeout(typing);
		typing = setTimeout(() => {
			// eslint-disable-next-line svelte/no-navigation-without-resolve -- the page's own URL
			void goto(withParams({ q: value.trim(), open: null }), {
				replaceState: true,
				keepFocus: true,
				noScroll: true
			});
		}, 250);
	}

	const title = $derived(
		inSeries
			? (data.seriesTitle ?? m.name_highlights())
			: `${m.name_highlights()} · ${num(data.counts.all)}`
	);

	// DELETE's band: HIGHLIGHT DELETED · UNDO, while the page is on screen.
	let droppedAnswer = $state.raw<typeof form>(null);
	const latest = $derived(form === droppedAnswer ? null : form);
	const deleted = $derived(latest && 'deleted' in latest ? Number(latest.deleted) : null);

	// EXPORT: the Markdown of what shows, from the same pure function the file uses.
	let exporting = $state(false);
	// The list holds still under what covers it: EXPORT anywhere, and
	// the open highlight off the desktop, where it fills the screen (P4)
	// rather than standing beside the list.
	$effect(() => {
		if (exporting || (open && !desktop.current)) return lockPage();
	});
	let colours = $state<'leave' | 'tag'>('leave');
	let copied = $state<number | null>(null);
	const markdown = $derived(
		toMarkdown(data.items, data.seriesTitle ?? 'Highlights', {
			colours,
			now: data.now,
			bySeries: !inSeries
		})
	);
	const exportHref = $derived.by(() => {
		// A plain value built once per change, never mutated after: not state.
		// eslint-disable-next-line svelte/prefer-svelte-reactivity
		const u = new URLSearchParams();
		if (f.series !== null) u.set('series', String(f.series));
		if (f.kind) u.set('kind', f.kind);
		if (f.lost) u.set('lost', '1');
		if (f.q) u.set('q', f.q);
		if (colours === 'tag') u.set('colours', 'tag');
		const s = u.toString();
		return `${resolve('/api/highlights/export')}${s ? `?${s}` : ''}`;
	});
	async function copyAll() {
		await navigator.clipboard.writeText(markdown);
		copied = data.items.length;
	}

	const copyHref = (h: Highlight, which: 'copy' | 'still', save = false) =>
		`${resolve('/api/highlights/[id]/[file]', { id: String(h.id), file: which })}${save ? '?save=1' : ''}`;

	/** MADE TODAY 21:14 · HOSHIZORA NO SHISHO · CH. 3 OF 212 */
	function madeLine(h: Highlight & { of: number | null }): string {
		const d = new Date(h.madeAt);
		const day = dayHeading(h.madeAt, data.now);
		const at = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
		const parts = [`MADE ${day === 'TODAY' ? `TODAY ${at}` : day}`];
		if (h.kind === 'page' && h.width && h.height)
			parts.push(`${num(h.width)} × ${num(h.height)}`, sizeWord(h.copyBytes));
		if (h.kind === 'clip') {
			if (h.quality) parts.push(h.quality.toUpperCase());
			if (h.copyBytes) parts.push(sizeWord(h.copyBytes));
		}
		if (h.kind === 'quote') {
			parts.push(h.seriesTitle.toUpperCase());
			parts.push(h.of !== null ? `${placeOf(h).split(' · ')[0]} OF ${num(h.of)}` : placeOf(h));
		}
		return parts.join(' · ');
	}

	/** The quote inside its paragraph, so the marker is drawn over just those words. */
	function marked(h: Highlight): { pre: string; mid: string; post: string } {
		const at = h.paragraph.indexOf(h.quote);
		if (h.quote === '' || at < 0) return { pre: '', mid: h.quote || h.paragraph, post: '' };
		return {
			pre: h.paragraph.slice(0, at),
			mid: h.quote,
			post: h.paragraph.slice(at + h.quote.length)
		};
	}

	const closeHref = $derived(withParams({ open: null }));
	const backHref = $derived(
		f.series !== null ? resolve('/series/[id]', { id: String(f.series) }) : resolve('/')
	);
	/**
	 * A clip still being cut (Anime A6): the job goes on after the player is left,
	 * and this page says KEEPING until it is made. Filtered by the workstation, so
	 * a hidden series' job is not listed with reveal off.
	 */
	let keeping = $state<
		{ id: string; entryLabel: string; from: number; to: number; percent: number; step: string }[]
	>([]);
	$effect(() => {
		let on = true;
		let timer: ReturnType<typeof setTimeout>;
		const ask = async () => {
			try {
				const r = await fetch('/api/highlights/clips');
				if (r.ok) {
					const was = keeping.length;
					keeping = ((await r.json()) as typeof keeping).filter((j) =>
						['waiting', 'fetching', 'cutting'].includes(j.step)
					);
					// Finished while this page was open: the list has one more row.
					if (keeping.length === 0 && was > 0 && on) await invalidateAll().catch(() => {});
				}
			} catch {
				// The next tick.
			}
			if (on && keeping.length > 0) timer = setTimeout(ask, 2000);
		};
		void ask();
		return () => {
			on = false;
			clearTimeout(timer);
		};
	});
</script>

<svelte:head><title>{m.name_highlights()} · tsundoku</title></svelte:head>

{#if keeping.length > 0}
	<div class="keeping" role="status" data-keeping>
		KEEPING · {keeping
			.map((j) => `${j.entryLabel.toUpperCase()} · ${clock(j.from)}–${clock(j.to)} · ${j.percent}%`)
			.join(' · ')}
	</div>
{/if}

<div class="hl-page" class:has-open={!!open}>
	<header class="bar" aria-label={m.name_highlights()}>
		<!-- eslint-disable-next-line svelte/no-navigation-without-resolve -- built from resolve() -->
		<a class="cell back" href={backHref} aria-label="Back">←</a>
		<div class="cell g title">
			{#if inSeries}
				<span class="t1">{title}</span>
				<span class="lbl">{m.name_highlights()} · {num(data.items.length)} · READING ORDER</span>
			{:else}
				<span class="lbl i"><span class="wide-only">01 — </span>{title}</span>
			{/if}
		</div>
		<form
			class="cell search"
			method="GET"
			role="search"
			onsubmit={(e) => {
				e.preventDefault();
				search(q);
			}}
		>
			{#if f.series !== null}<input type="hidden" name="series" value={f.series} />{/if}
			{#if f.kind}<input type="hidden" name="kind" value={f.kind} />{/if}
			<label for="hl-search" class="slash">/</label>
			<input
				id="hl-search"
				name="q"
				type="search"
				autocomplete="off"
				placeholder="SEARCH QUOTES AND NOTES"
				value={q}
				oninput={(e) => search(e.currentTarget.value)}
			/>
		</form>
		{#if inSeries}
			<button type="button" class="cell" onclick={() => (exporting = true)}>EXPORT</button>
		{:else}
			<span class="cell order">NEWEST FIRST ↓</span>
		{/if}
	</header>

	{#if deleted !== null}
		<Band title="HIGHLIGHT DELETED" ondismiss={() => (droppedAnswer = form)}>
			{#snippet action()}
				<form method="POST" action="?/undo" use:enhance>
					<input type="hidden" name="id" value={deleted} />
					<button type="submit">UNDO</button>
				</form>
			{/snippet}
		</Band>
	{:else if copied !== null}
		<Band title="COPIED · {num(copied)}" ondismiss={() => (copied = null)} />
	{:else if latest && 'message' in latest && latest.message}
		<Band title={String(latest.message).toUpperCase()} ondismiss={() => (droppedAnswer = form)} />
	{/if}

	{#if data.all === 0}
		<!-- P6: reached by /highlights, or after the last one is deleted. -->
		<div class="empty">
			<div class="lbl i">00 — NO HIGHLIGHTS YET</div>
			<p>
				Hold a word in a book to select it, press HIGHLIGHT under a manga page, or MARK IN and MARK
				OUT in the player.
			</p>
		</div>
	{:else}
		<nav class="chips" aria-label="Filters">
			<!-- eslint-disable svelte/no-navigation-without-resolve -- the page's own URL -->
			<a
				class="chip"
				class:on={f.kind === null && !f.lost}
				href={withParams({ kind: null, lost: null, open: null })}
				data-focus-mark="in">ALL {num(data.counts.all)}</a
			>
			{#each HIGHLIGHT_KINDS as k (k)}
				<a
					class="chip"
					class:on={f.kind === k}
					href={withParams({ kind: k, lost: null, open: null })}
					data-focus-mark="in">{kindPlural(k)} {num(data.counts[k])}</a
				>
			{/each}
			<span class="gap"></span>
			{#if !inSeries}
				<details class="pick">
					<summary class="chip">SERIES · ALL ↓</summary>
					<div class="menu">
						{#each data.seriesList as s (s.id)}
							<a href={withParams({ series: String(s.id), open: null })} data-focus-mark="in"
								><span>{s.title}</span><span class="n">{num(s.n)}</span></a
							>
						{/each}
					</div>
				</details>
			{:else}
				<a class="chip on" href={withParams({ series: null, open: null })} data-focus-mark="in"
					>SERIES · {(data.seriesTitle ?? '').toUpperCase()} ✕</a
				>
			{/if}
			{#if data.counts.lost > 0}
				<a
					class="chip"
					class:on={f.lost}
					href={withParams({ lost: f.lost ? null : '1', kind: null, open: null })}
					data-focus-mark="in">NO WAY BACK {num(data.counts.lost)}</a
				>
			{/if}
			<!-- eslint-enable svelte/no-navigation-without-resolve -->
		</nav>

		<div class="body">
			<div class="list">
				{#if f.q}
					<div class="lbl found">
						{num(data.items.length)}
						{data.items.length === 1 ? 'HIGHLIGHT' : 'HIGHLIGHTS'} · {num(
							new Set(data.items.map((h) => h.seriesTitle)).size
						)} SERIES
					</div>
				{/if}
				<!-- eslint-disable svelte/no-navigation-without-resolve -- the page's own URL -->
				{#each groups as g (g.key)}
					<div class="lbl day" class:gone={g.gone}>{g.heading}</div>
					<div class="box" class:gone={g.gone}>
						{#each g.items as h (h.id)}
							{@const tag = stateTag(h)}
							{@const short = stateTag(h, true)}
							{@const where = f.q ? foundIn(h, f.q) : null}
							<a
								class="hl"
								class:on={open?.id === h.id}
								href={withParams({ open: String(h.id) })}
								data-sveltekit-noscroll
								data-sveltekit-replacestate
								data-focus-mark="in"
								data-highlight={h.id}
							>
								{#if h.kind === 'page'}
									<span class="art th">
										{#if h.copyPath}<img src={copyHref(h, 'copy')} alt="" loading="lazy" />{/if}
									</span>
								{:else if h.kind === 'clip'}
									<span class="vid st">
										{#if h.stillPath}<img src={copyHref(h, 'still')} alt="" loading="lazy" />{/if}
										<span class="al">{clipLength(h)}</span>
									</span>
								{/if}
								<span class="bd">
									{#if tag || h.hidden}
										<span class="tags">
											{#if h.hidden}<Badge tone="reveal">HIDDEN</Badge>{/if}
											{#if tag && h.state !== 'detached'}
												<span class="tag d"
													><span class="long">{tag}</span><span class="short">{short}</span></span
												>
											{/if}
										</span>
									{/if}
									<span class="t1">{h.seriesTitle}</span>
									<span class="meta-row">
										<span class="meta"
											>{metaLine(h, data.now)}{where === 'note' ? ' · IN THE NOTE' : ''}</span
										>
										{#if h.state === 'detached'}<span class="tag d">{tag}</span>{/if}
									</span>
									{#if h.kind === 'quote'}
										{@const s = splitMatch(h.quote, where === 'quote' ? f.q : '')}
										<span class="q clamp">{s.pre}<b class="match">{s.mid}</b>{s.post}</span>
									{/if}
									{#if h.note.trim()}
										{@const s = splitMatch(h.note, where === 'note' ? f.q : '')}
										<span class="n">{s.pre}<b class="match">{s.mid}</b>{s.post}</span>
									{/if}
								</span>
							</a>
						{/each}
					</div>
				{/each}
				<!-- eslint-enable svelte/no-navigation-without-resolve -->
				{#if data.items.length === 0}
					<p class="none">NO HIGHLIGHT MATCHES THIS</p>
				{/if}
			</div>

			{#if open}
				{@const back = wayBackHref(open)}
				{@const tag = stateTag(open)}
				<aside class="open" aria-label="The open highlight" data-open-highlight={open.id}>
					<div class="sh">
						<span class="lbl"
							>{kindWord(open.kind)} · {open.seriesTitle.toUpperCase()} · {placeOf(open)}</span
						>
						<!-- eslint-disable-next-line svelte/no-navigation-without-resolve -- the page's own URL -->
						<a class="cell x" href={closeHref} aria-label="Close" data-sveltekit-noscroll>✕</a>
					</div>
					<div class="scroll">
						{#if tag}
							<div class="tags pad"><span class="tag d">{tag}</span></div>
						{/if}
						{#if open.kind === 'quote'}
							{@const mk = marked(open)}
							<div class="tr">
								{#if open.context}<p class="ctx">… {open.context}</p>{/if}
								<p>
									{mk.pre}<span class="mk {open.colour ?? 'yellow'}">{mk.mid}</span
									>{mk.post}{#if open.note.trim()}<span class="nm" aria-label="Has a note">≡</span
										>{/if}
								</p>
							</div>
						{:else if open.kind === 'page'}
							<!-- eslint-disable-next-line svelte/no-navigation-without-resolve -- built from resolve() -->
							<a class="large" href={copyHref(open, 'copy')} target="_blank" rel="noopener">
								{#if open.copyPath}<img src={copyHref(open, 'copy')} alt="The page kept" />{/if}
							</a>
						{:else}
							<div class="clip">
								<!-- The player's picture, in place. Its subtitle renderer
								     comes with the clips themselves (H4): doc/HIGHLIGHTS.md. -->
								<!-- svelte-ignore a11y_media_has_caption -->
								<video
									src={open.copyPath ? copyHref(open, 'copy') : undefined}
									poster={open.stillPath ? copyHref(open, 'still') : undefined}
									controls
									preload="metadata"
								></video>
								{#if open.tracks.length}
									<div class="meta">SUBTITLES · {open.tracks.join(' · ').toUpperCase()}</div>
								{/if}
							</div>
						{/if}
						<div class="opts">
							{#if open.kind === 'quote'}
								<div class="sws">
									{#each COLOURS as c (c)}
										<form method="POST" action="?/colour" use:enhance>
											<input type="hidden" name="id" value={open.id} />
											<input type="hidden" name="colour" value={c} />
											<button
												type="submit"
												class="sw {c}"
												class:on={(open.colour ?? 'yellow') === c}
												aria-label="{c[0].toUpperCase()}{c.slice(1)}{(open.colour ?? 'yellow') === c
													? ', chosen'
													: ''}"
												data-focus-mark="in">{(open.colour ?? 'yellow') === c ? '✓' : ''}</button
											>
										</form>
									{/each}
								</div>
							{/if}
							<form
								method="POST"
								action="?/note"
								use:enhance={() =>
									async ({ update }) =>
										update({ reset: false })}
							>
								<input type="hidden" name="id" value={open.id} />
								<label class="lbl" for="hl-note">NOTE</label>
								<textarea
									id="hl-note"
									class="note"
									name="note"
									rows="2"
									placeholder="A FEW LINES OF YOUR OWN"
									value={open.note}
									onchange={(e) => e.currentTarget.form?.requestSubmit()}></textarea>
							</form>
							<div class="meta">{madeLine(open)}</div>
						</div>
					</div>
					<div class="bar b">
						{#if back}
							<!-- eslint-disable-next-line svelte/no-navigation-without-resolve -- built from the entry's id -->
							<a class="cell g" href={back} data-focus-mark="in">{wayBackLabel(open)}</a>
						{/if}
						{#if open.kind === 'quote'}
							<button
								type="button"
								class="cell g"
								data-focus-mark="in"
								onclick={async () => {
									await navigator.clipboard.writeText(open.quote);
									copied = 1;
								}}>COPY</button
							>
						{:else if open.copyPath}
							<!-- eslint-disable-next-line svelte/no-navigation-without-resolve -- built from resolve() -->
							<a class="cell g" href={copyHref(open, 'copy', true)} download data-focus-mark="in"
								>{open.kind === 'page' ? 'SAVE IMAGE' : 'SAVE CLIP'}</a
							>
						{/if}
						<form method="POST" action="?/delete" use:enhance class="cell-form">
							<input type="hidden" name="id" value={open.id} />
							<button type="submit" class="cell g" data-focus-mark="in">DELETE</button>
						</form>
					</div>
				</aside>
			{/if}
		</div>

		<footer class="disk meta" data-disk>
			<span>ON THE WORKSTATION</span>
			<span class="ink">PAGES {sizeWord(data.disk.pages)}</span>
			<span class="ink">CLIPS {sizeWord(data.disk.clips)}</span>
			<span class="wide-only">QUOTES TAKE NONE</span>
			<span class="fill"></span>
			<button type="button" class="exp" onclick={() => (exporting = true)} data-focus-mark="in"
				>EXPORT →</button
			>
		</footer>
	{/if}
</div>

{#if exporting}
	<!-- X1: what leaves, previewed, then COPY ALL or the file. -->
	<div class="scrim" role="presentation" onclick={() => (exporting = false)}></div>
	<div class="export rise" role="dialog" aria-label="Export" aria-modal="true">
		<div class="sh">
			<span class="lbl"
				>EXPORT · {(data.seriesTitle ?? m.name_highlights()).toUpperCase()} · {num(
					data.items.length
				)} · {num(data.items.filter((h) => h.note.trim()).length)} NOTES</span
			>
			<button type="button" class="cell x" aria-label="Close" onclick={() => (exporting = false)}
				>✕</button
			>
		</div>
		<pre class="md">{markdown}</pre>
		<div class="colours">
			<span class="lbl">COLOURS</span>
			<button
				type="button"
				class="chip"
				class:on={colours === 'leave'}
				onclick={() => (colours = 'leave')}>LEAVE OUT</button
			>
			<button
				type="button"
				class="chip"
				class:on={colours === 'tag'}
				onclick={() => (colours = 'tag')}>AS A TAG</button
			>
		</div>
		<div class="bar b">
			<button type="button" class="cell g" onclick={copyAll}>COPY ALL</button>
			<!-- eslint-disable-next-line svelte/no-navigation-without-resolve -- built from resolve() -->
			<a class="cell g inv" href={exportHref} download>SAVE {inSeries ? 'THE BOOK' : 'ALL'} .MD</a>
		</div>
	</div>
{/if}

<style>
	.keeping {
		padding: 10px 16px;
		border-bottom: var(--hairline);
		font: 500 13px var(--font-mono);
		letter-spacing: 0.04em;
	}
	/*
	 * Measurements are the design's, transcribed and pinned by
	 * tests/highlights-frame.e2e.ts: hand-set, not the spacing ladder, so a
	 * tidy-up must not round them. The three marker colours are the design's
	 * new ones, kept on this page until the tokens have them
	 * (doc/HIGHLIGHTS.md, Gaps).
	 */
	.hl-page {
		--mk-y: oklch(0.5 0.09 95);
		--mk-o: oklch(0.44 0.1 52);
		--mk-b: oklch(0.38 0.08 250);
		--mk-ink: var(--text-1);
		display: flex;
		flex-direction: column;
		flex: 1;
		min-width: 0;
		min-height: 100dvh;
		color: var(--text-1);
	}
	:global([data-theme='light']) .hl-page {
		--mk-y: oklch(0.9 0.12 98);
		--mk-o: oklch(0.85 0.09 62);
		--mk-b: oklch(0.82 0.06 240);
	}
	.bar {
		flex-shrink: 0;
		display: flex;
		align-items: stretch;
		height: 64px;
		border-bottom: var(--hairline);
		background: var(--surface-page);
	}
	.bar.b {
		height: 60px;
		border-bottom: 0;
		border-top: var(--hairline);
	}
	.cell {
		display: flex;
		align-items: center;
		justify-content: center;
		padding: 0 18px;
		min-width: 56px;
		border: 0;
		border-left: var(--hairline);
		background: none;
		color: var(--text-1);
		font: 500 13px/1 var(--font-mono);
		letter-spacing: var(--tracking-label);
		white-space: nowrap;
		text-decoration: none;
		cursor: pointer;
	}
	.cell:first-child {
		border-left: 0;
	}
	.cell.g {
		flex: 1;
		flex-direction: column;
		align-items: flex-start;
		justify-content: center;
		gap: 6px;
		min-width: 0;
		overflow: hidden;
	}
	.bar.b .cell.g {
		align-items: center;
	}
	.cell.inv {
		background: var(--surface-inverse);
		color: var(--text-inverse);
	}
	.back {
		font-size: 16px;
	}
	.title {
		border-left: var(--hairline);
	}
	.search {
		flex: 0 0 420px;
		justify-content: flex-start;
		padding: 0;
		height: 64px;
		margin: 0;
	}
	.slash {
		padding: 0 12px 0 18px;
		font: 500 16px/1 var(--font-mono);
		color: var(--text-2);
	}
	.search input {
		flex: 1;
		min-width: 0;
		height: 100%;
		border: 0;
		background: none;
		color: var(--text-1);
		font: 500 13px/1 var(--font-mono);
		letter-spacing: var(--tracking-label);
		outline: none;
	}
	.lbl {
		font: 500 12px/1.2 var(--font-mono);
		letter-spacing: var(--tracking-label);
		color: var(--text-2);
	}
	.lbl.i {
		color: var(--text-1);
	}
	.meta {
		font: 400 12px/1.3 var(--font-mono);
		letter-spacing: 0.04em;
		color: var(--text-2);
	}
	.t1 {
		font: 500 15px/1.15 var(--font-sans);
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
		max-width: 100%;
	}
	.chips {
		display: flex;
		align-items: center;
		gap: 8px;
		padding: 12px 24px;
		border-bottom: var(--hairline);
		flex-wrap: wrap;
	}
	.chip {
		display: inline-flex;
		align-items: center;
		height: 36px;
		padding: 0 12px;
		border: 1px solid var(--line-2);
		background: none;
		color: var(--text-1);
		font: 500 12px/1 var(--font-mono);
		letter-spacing: var(--tracking-label);
		white-space: nowrap;
		text-align: left;
		text-decoration: none;
		cursor: pointer;
	}
	.chip.on {
		background: var(--surface-inverse);
		color: var(--text-inverse);
		border-color: var(--surface-inverse);
	}
	.gap {
		width: 16px;
	}
	.pick {
		position: relative;
	}
	.pick summary {
		list-style: none;
	}
	.pick summary::-webkit-details-marker {
		display: none;
	}
	.menu {
		position: absolute;
		z-index: 5;
		top: 40px;
		left: 0;
		min-width: 280px;
		max-height: 60vh;
		overflow-y: auto;
		background: var(--surface-page);
		border: var(--rule-strong);
	}
	.menu a {
		display: flex;
		justify-content: space-between;
		gap: 12px;
		min-height: 48px;
		align-items: center;
		padding: 0 16px;
		border-top: var(--hairline);
		color: var(--text-1);
		text-decoration: none;
		font: 400 15px var(--font-sans);
	}
	.menu a:first-child {
		border-top: 0;
	}
	.menu .n {
		font: 500 12px var(--font-mono);
		color: var(--text-2);
	}
	.body {
		flex: 1;
		display: flex;
		min-height: 0;
	}
	.list {
		flex: 1;
		min-width: 0;
		padding: 0 24px;
		overflow: hidden;
	}
	.list::after {
		content: '';
		display: block;
		height: 24px;
	}
	/* The rule between the list and the open item is the list's (P1). */
	.has-open .list {
		border-right: var(--hairline);
	}
	.lbl.day {
		padding: 22px 0 10px;
	}
	.list > .lbl.day:first-child,
	.lbl.found + .lbl.day {
		padding-top: 18px;
	}
	.lbl.found {
		padding: 18px 0 0;
	}
	.box {
		display: flex;
		flex-direction: column;
		border: var(--hairline);
	}
	.box.gone {
		border-style: dashed;
	}
	.hl {
		display: flex;
		gap: 16px;
		padding: 16px;
		border-top: var(--hairline);
		align-items: flex-start;
		color: var(--text-1);
		text-decoration: none;
	}
	.hl:first-child {
		border-top: 0;
	}
	.hl.on {
		background: var(--accent-select);
		box-shadow: inset 3px 0 0 var(--accent);
	}
	.th {
		width: 72px;
		height: 104px;
		flex-shrink: 0;
	}
	.st {
		width: 128px;
		height: 72px;
		flex-shrink: 0;
	}
	.art,
	.vid {
		position: relative;
		display: block;
		overflow: hidden;
		background: var(--surface-panel);
	}
	.art img,
	.vid img {
		width: 100%;
		height: 100%;
		object-fit: cover;
		display: block;
	}
	.al {
		position: absolute;
		left: 10px;
		bottom: 10px;
		padding: 4px 6px;
		background: var(--scrim);
		color: var(--text-1);
		font: 500 11px/1 var(--font-mono);
		letter-spacing: var(--tracking-label);
	}
	.bd {
		flex: 1;
		min-width: 0;
		display: flex;
		flex-direction: column;
		gap: 8px;
	}
	.tags,
	.meta-row {
		display: flex;
		gap: 8px;
		flex-wrap: wrap;
		align-items: center;
	}
	.tags.pad {
		padding: 20px 28px 0;
	}
	.q {
		font: 400 16px/1.5 var(--font-serif);
		color: var(--text-1);
	}
	.q.clamp {
		display: -webkit-box;
		-webkit-line-clamp: 2;
		line-clamp: 2;
		-webkit-box-orient: vertical;
		overflow: hidden;
	}
	.n {
		font: 400 14px/1.45 var(--font-sans);
		color: var(--text-prose);
		padding-left: 12px;
		border-left: 2px solid var(--line-2);
	}
	/* P5: the match in full ink, weight 600. */
	.match {
		font-weight: 600;
		color: var(--text-1);
	}
	.tag {
		display: inline-flex;
		align-items: center;
		height: 20px;
		padding: 0 6px;
		border: 1px solid var(--line-2);
		font: 500 11px/1 var(--font-mono);
		letter-spacing: var(--tracking-label);
		color: var(--text-2);
	}
	.tag.d {
		border-style: dashed;
	}
	.tag .short {
		display: none;
	}
	.none {
		padding: 24px 0;
		font: 500 12px var(--font-mono);
		letter-spacing: var(--tracking-label);
		color: var(--text-2);
	}
	/* The open item: 560px beside the list on a desktop (P1–P3). */
	.open {
		width: 560px;
		flex-shrink: 0;
		display: flex;
		flex-direction: column;
		background: var(--surface-page);
	}
	.sh {
		display: flex;
		align-items: stretch;
		height: 56px;
		border-bottom: var(--hairline);
		flex-shrink: 0;
	}
	.sh .lbl {
		flex: 1;
		display: flex;
		align-items: center;
		padding: 0 20px;
		overflow: hidden;
		white-space: nowrap;
		text-overflow: ellipsis;
	}
	.sh .cell {
		font-size: 16px;
	}
	.scroll {
		flex: 1;
		overflow-y: auto;
		overscroll-behavior: contain;
	}
	.tr {
		padding: 24px 28px;
		border-bottom: var(--hairline);
		background: var(--surface-page);
		color: var(--text-prose);
		font: 400 18px/1.62 var(--font-serif);
	}
	.tr p {
		margin: 0;
		white-space: pre-wrap;
	}
	.tr .ctx {
		margin-bottom: 0.9em;
		font-size: 16px;
		color: var(--text-2);
	}
	/* The marker: a flat band over the lower two-thirds of the line, ink to full. */
	.mk {
		color: var(--mk-ink);
		box-shadow: inset 0 -0.66em 0 var(--mk-y);
		-webkit-box-decoration-break: clone;
		box-decoration-break: clone;
		padding: 0 1px;
	}
	.mk.orange {
		box-shadow: inset 0 -0.66em 0 var(--mk-o);
	}
	.mk.blue {
		box-shadow: inset 0 -0.66em 0 var(--mk-b);
	}
	.nm {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 17px;
		height: 17px;
		margin-left: 3px;
		vertical-align: 0.15em;
		border: 1px solid var(--mk-ink);
		font: 500 11px/1 var(--font-mono);
		color: var(--mk-ink);
	}
	.large {
		display: flex;
		justify-content: center;
		background: var(--surface-panel);
		border-bottom: var(--hairline);
	}
	.large img {
		max-width: 100%;
		max-height: 70vh;
		object-fit: contain;
	}
	.clip video {
		display: block;
		width: 100%;
		aspect-ratio: 16 / 9;
		background: var(--surface-panel);
	}
	.clip .meta {
		padding: 10px 28px;
		border-bottom: var(--hairline);
	}
	.opts {
		display: flex;
		flex-direction: column;
		gap: 14px;
		padding: 20px 28px;
	}
	.opts form {
		display: flex;
		flex-direction: column;
		gap: 14px;
		margin: 0;
	}
	.sws {
		display: flex;
		gap: 12px;
		align-items: center;
	}
	.sws form {
		display: contents;
	}
	.sw {
		width: 44px;
		height: 44px;
		border: 1px solid var(--line-2);
		display: flex;
		align-items: center;
		justify-content: center;
		font: 500 14px/1 var(--font-mono);
		text-align: left;
		color: var(--mk-ink);
		cursor: pointer;
	}
	.sw.yellow {
		background: var(--mk-y);
	}
	.sw.orange {
		background: var(--mk-o);
	}
	.sw.blue {
		background: var(--mk-b);
	}
	.sw.on {
		box-shadow:
			0 0 0 3px var(--surface-page),
			0 0 0 4px var(--text-1);
	}
	.note {
		border: 1px solid var(--line-2);
		border-radius: 0;
		padding: 12px 14px;
		background: none;
		color: var(--text-1);
		font: 400 16px/1.5 var(--font-sans);
		min-height: 76px;
		resize: vertical;
	}
	.cell-form {
		display: flex;
		flex: 1;
		margin: 0;
	}
	.cell-form .cell {
		width: 100%;
		border-left: var(--hairline);
	}
	.disk {
		display: flex;
		gap: 18px;
		height: 44px;
		align-items: center;
		padding: 0 24px;
		border-top: var(--hairline);
		flex-shrink: 0;
	}
	.disk .ink {
		color: var(--text-1);
	}
	.disk .fill {
		flex: 1;
	}
	.exp {
		border: 0;
		background: none;
		color: var(--text-2);
		font: inherit;
		letter-spacing: inherit;
		cursor: pointer;
		padding: 0;
	}
	.empty {
		display: flex;
		flex-direction: column;
		gap: 14px;
		padding: 32px 24px;
	}
	.empty p {
		margin: 0;
		max-width: 520px;
		font: 400 16px/1.55 var(--font-sans);
		color: var(--text-prose);
	}
	.scrim {
		position: fixed;
		inset: 0;
		z-index: 19;
		background: var(--scrim);
	}
	.export {
		position: fixed;
		z-index: 20;
		top: 0;
		bottom: 0;
		right: 0;
		width: min(560px, 100vw);
		display: flex;
		flex-direction: column;
		background: var(--surface-page);
		border-left: var(--rule-strong);
	}
	.md {
		flex: 1;
		margin: 0;
		padding: 20px 24px;
		overflow: auto;
		overscroll-behavior: contain;
		white-space: pre-wrap;
		font: 400 13px/1.55 var(--font-mono);
		color: var(--text-prose);
	}
	.colours {
		display: flex;
		align-items: center;
		gap: 8px;
		padding: 12px 24px;
		border-top: var(--hairline);
	}
	.colours .lbl {
		flex: 1;
	}
	/* Below the desktop's sidebar width: one column, the open item full screen (P4). */
	@media not ((min-width: 1024px) and (pointer: fine)) {
		.wide-only {
			display: none;
		}
		.search {
			flex: 1 1 0;
		}
		.title {
			flex: 0 1 auto;
		}
		.chips {
			flex-wrap: nowrap;
			overflow-x: auto;
			padding: 12px 20px;
		}
		.list {
			padding: 0 20px 20px;
		}
		.tag .long {
			display: none;
		}
		.tag .short {
			display: inline;
		}
		.open {
			position: fixed;
			inset: 0;
			z-index: 18;
			width: auto;
			border-left: 0;
		}
	}
	@media (min-width: 1024px) and (pointer: fine) {
		.back {
			display: none;
		}
		/* The open item stays beside the list while the list scrolls. */
		.open {
			position: sticky;
			top: 0;
			max-height: 100dvh;
		}
		.title {
			border-left: 0;
		}
	}
</style>

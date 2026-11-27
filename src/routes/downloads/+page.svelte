<script lang="ts">
	import { engineDownLine } from '$lib/waiting';
	import StartTrail from '$lib/components/start/StartTrail.svelte';
	import { resolve } from '$app/paths';
	import { enhance } from '$app/forms';
	import { page } from '$app/state';
	import TopBar from '$lib/components/chrome/TopBar.svelte';
	import Banner from '$lib/components/chrome/Banner.svelte';
	import Band from '$lib/components/chrome/Band.svelte';
	import SectionLabel from '$lib/components/chrome/SectionLabel.svelte';
	import Cover from '$lib/components/content/Cover.svelte';
	import { backLink } from '$lib/back';
	import { coverSrc, seriesHref, withParam } from '$lib/library/links';
	import { formatNumber } from '$lib/library/series';
	import { count } from '$lib/library/downloads';
	import { clock } from '$lib/library/tracking';
	import { offline } from '$lib/offline.svelte';
	import { invalidateAll } from '$app/navigation';
	import { live, watchQueue } from '$lib/downloads-live.svelte';

	/**
	 * The download queue (doc/DOWNLOADS.md). Failures first, with RETRY and
	 * ✕; then series in the queue's order, each opening (by URL, so without
	 * script too) on ↑ TO THE TOP, CANCEL N and its next chapters. What
	 * finished is the NEW shelf's, linked from the band.
	 */
	let { data, form } = $props();
	const v = $derived(data.view);
	/**
	 * The answer the band's ✕ cleared: only that answer, so the next
	 * action's new `form` draws its own band.
	 */
	let droppedAnswer = $state.raw<typeof form>(null);
	const latest = $derived(form === droppedAnswer ? null : form);
	const dropAnswer = () => (droppedAnswer = form);
	const refusal = $derived(
		latest && 'message' in latest && typeof latest.message === 'string'
			? latest.message.toUpperCase()
			: ''
	);
	const paused = $derived(!!v && !v.running);
	const newHref = resolve('/') + '?shelf=new';
	// Live, but quiet: the band's bar moves; anything else reads the page again.
	$effect(() => {
		if (!v || !offline.online) return;
		return watchQueue(() => void invalidateAll());
	});
	/** The downloading chapter's progress, live when the stream has it. */
	const progress = $derived.by(() => {
		const d = v?.downloading;
		if (!d) return null;
		const l = live.downloading;
		return l && l.chapterId === d.chapterId
			? { fraction: l.fraction, page: l.page, pages: l.pages || d.pages }
			: { fraction: d.progress, page: Math.round(d.progress * d.pages), pages: d.pages };
	});
	const chapterLabel = (n: number, name: string) =>
		n >= 0 ? `Chapter ${formatNumber(n)}` : name || 'Chapter';
</script>

<svelte:head><title>Downloads · tsundoku</title></svelte:head>

<div class="downloads">
	<TopBar sticky label="Downloads">
		{#snippet left()}
			<a class="cell" href={resolve('/')} aria-label="Back to library" use:backLink>←</a>
		{/snippet}
		{#snippet middle()}
			<h1 class="title">DOWNLOADS</h1>
		{/snippet}
		{#snippet right()}
			{#if v && (v.queued > 0 || paused)}
				<!-- RESUME is the cell in accent while paused. -->
				<form method="POST" action={paused ? '?/resume' : '?/pause'} use:enhance class="cell-form">
					<button type="submit" class="cell" class:acc={paused} disabled={!offline.online}
						>{paused ? 'RESUME' : 'PAUSE'}</button
					>
				</form>
			{/if}
		{/snippet}
	</TopBar>
	<!-- The way back to GET STARTED, while FIRST READ's trip lasts (doc/ONBOARDING.md). -->
	<StartTrail start={data.start} />

	{#if refusal}
		<Band title={refusal} detail="NOTHING CHANGED" ondismiss={dropAnswer} />
	{/if}

	{#if !offline.online}
		<Banner kind="info" title="○ OFFLINE" detail="DOWNLOADING NEEDS THE WORKSTATION" />
	{/if}

	{#if data.down}
		<!-- Not answering: one of the few places that names the engine. -->
		<Banner
			kind="info"
			title={engineDownLine(__WEB_EDITION__)}
			detail="SINCE {clock(data.down.since)}"
		/>
	{:else if v && v.downloading && !paused}
		{@const d = v.downloading}
		{@const p = progress ?? { fraction: d.progress, page: 0, pages: 0 }}
		{@const pages = p.pages > 0 ? ` · ${p.page} / ${p.pages}` : ''}
		<!-- The phone's band keeps the chapter and the counts, and drops the rest. -->
		<div class="long">
			<Banner
				kind="progress"
				title="DOWNLOADING · {d.title.toUpperCase()}"
				detail="CH. {formatNumber(d.number)}{pages}"
				progress={p.fraction}
				meta="{count(v.queued)} QUEUED · {v.series} SERIES"
				metaRight="{count(data.recent.hour)} DOWNLOADED IN THE LAST HOUR · NEW →"
				metaHref={newHref}
			/>
		</div>
		<div class="short">
			<Banner
				kind="progress"
				title="DOWNLOADING · {d.title.toUpperCase()}"
				detail="CH. {formatNumber(d.number)}"
				progress={p.fraction}
				meta="{count(v.queued)} QUEUED"
				metaRight="{count(data.recent.hour)} IN 1 H"
				metaHref={newHref}
			/>
		</div>
	{:else if v && paused && v.queued > 0}
		<Banner
			kind="info"
			title="PAUSED · {count(v.queued)} QUEUED"
			detail={v.pausedAt ? `SINCE ${clock(v.pausedAt)}` : undefined}
		/>
	{/if}
	{#if v && v.downloadingEpisode && !paused && !data.down}
		{@const d = v.downloadingEpisode}
		<!-- The episode lane: minutes an episode, so its share. -->
		<Banner
			kind="progress"
			title="DOWNLOADING · {d.title.toUpperCase()} · EP. {formatNumber(d.number)}"
			detail="{Math.round(d.progress * 100)}%"
			progress={d.progress}
			meta="{count(v.queued)} QUEUED · {v.series} SERIES"
			metaRight="{count(data.recent.hour)} IN THE LAST HOUR · NEW →"
			metaHref={newHref}
		/>
	{/if}

	{#if v && v.failures.length > 0}
		<SectionLabel index={1} text="Failed" top={18}>
			{#snippet right()}
				<form method="POST" action="?/retry" use:enhance class="inline-form">
					<input type="hidden" name="all" value="1" />
					<span>{v.failures.length} ·</span>
					<button type="submit" class="link" disabled={!offline.online}>RETRY ALL</button>
				</form>
			{/snippet}
		</SectionLabel>
		<ol class="fails">
			{#each v.failures as f (f.chapterId)}
				<li class="fail">
					<div class="f-text">
						<div class="f-t">{f.title} · {chapterLabel(f.number, f.name)}</div>
						<!-- How it failed, in a word, and how often it tried. -->
						<div class="f-m">
							<span class="f-why">FAILED</span> · {f.tries}
							{f.tries === 1 ? 'TRY' : 'TRIES'}
						</div>
					</div>
					<form method="POST" action="?/retry" use:enhance class="cell-form">
						<input type="hidden" name="chapter" value={f.chapterId} />
						<button type="submit" class="f-act" disabled={!offline.online}>RETRY</button>
					</form>
					<form method="POST" action="?/drop" use:enhance class="cell-form">
						<input type="hidden" name="chapter" value={f.chapterId} />
						<button
							type="submit"
							class="f-act x"
							aria-label="Take it out of the queue"
							disabled={!offline.online}>✕</button
						>
					</form>
				</li>
			{/each}
		</ol>
	{/if}

	{#if v && v.groups.length > 0}
		{@const episodes = v.groups.filter((g) => g.episodes)}
		{@const chapters = v.groups.filter((g) => !g.episodes)}
		{@const first = v.failures.length > 0 ? 2 : 1}
		<!-- Episodes and chapters share the screen, each its own lane (doc/ANIME.md, "Downloading"). -->
		{#if episodes.length}
			<SectionLabel index={first} text="Episodes" top={v.failures.length > 0 ? 24 : 18}>
				{#snippet right()}<span>IN ORDER · {count(episodes.reduce((n, g) => n + g.count, 0))}</span
					>{/snippet}
			</SectionLabel>
			{@render groupList(episodes)}
		{/if}
		{#if chapters.length}
			<SectionLabel
				index={episodes.length ? first + 1 : first}
				text={episodes.length ? 'Chapters' : 'Queue'}
				top={episodes.length || v.failures.length > 0 ? 24 : 18}
			>
				{#snippet right()}<span
						>IN ORDER · {count(
							episodes.length ? chapters.reduce((n, g) => n + g.count, 0) : v.queued
						)}</span
					>{/snippet}
			</SectionLabel>
			{@render groupList(chapters)}
		{/if}
		{#if v.more > 0}
			<!-- eslint-disable-next-line svelte/no-navigation-without-resolve -- withParam() keeps the current, resolved path -->
			<a class="more-series" href={withParam(page.url, 'more', '1')} data-sveltekit-noscroll
				>+ {v.more} MORE SERIES</a
			>
		{/if}
	{/if}

	{#snippet groupList(list: NonNullable<typeof v>['groups'])}
		<ol class="groups">
			{#each list as g (g.mangaId)}
				<li class="group" class:open={g.open}>
					<div class="g-row">
						{#if g.series}
							<!-- eslint-disable-next-line svelte/no-navigation-without-resolve -- seriesHref() resolves -->
							<a class="g-cov" href={seriesHref(g.series.id)} aria-label="Open {g.title}">
								<Cover
									src={coverSrc(g.series.id, g.series.cover)}
									hue={g.series.hue}
									width={44}
									height={62}
								>
									{#if g.series.hidden}<span class="hidden-badge">HIDDEN</span>{/if}
								</Cover>
							</a>
						{:else}
							<span class="g-cov"><Cover width={44} height={62} /></span>
						{/if}
						<div class="g-text">
							<div class="g-t">{g.title}</div>
							<div class="g-m">
								{#if g.active && !paused}<span class="now long">DOWNLOADING ·&nbsp;</span>{/if}<span
									>{count(g.count)} QUEUED</span
								><span class="long">{g.span ? ` · ${g.span}` : ''}</span>
							</div>
						</div>
						<!-- eslint-disable svelte/no-navigation-without-resolve -- withParam() keeps the current, resolved path -->
						<a
							class="g-more"
							href={g.open
								? withParam(page.url, 'open', null)
								: withParam(page.url, 'open', String(g.mangaId))}
							data-sveltekit-noscroll
							data-sveltekit-replacestate>{g.open ? 'LESS ↑' : 'MORE ↓'}</a
						>
						<!-- eslint-enable svelte/no-navigation-without-resolve -->
					</div>
					{#if g.open}
						<div class="g-acts">
							<form method="POST" action="?/top" use:enhance class="cell-form">
								<input type="hidden" name="manga" value={g.mangaId} />
								<button type="submit" disabled={!offline.online}>↑ TO THE TOP</button>
							</form>
							<form method="POST" action="?/cancel" use:enhance class="cell-form">
								<input type="hidden" name="manga" value={g.mangaId} />
								<button type="submit" disabled={!offline.online}>CANCEL {count(g.count)}</button>
							</form>
						</div>
						{#each g.chapters as c, i (i)}
							<div class="g-ch">
								<span class="c-n">{c.number >= 0 ? formatNumber(c.number) : ''}</span>
								<span class="c-t"
									>{c.name ||
										(g.episodes
											? `Episode ${formatNumber(c.number)}`
											: chapterLabel(c.number, c.name))}</span
								>
								<span class="c-s">QUEUED</span>
							</div>
						{/each}
						{#if g.count > g.chapters.length}
							<div class="g-rest">+ {count(g.count - g.chapters.length)} MORE · IN ORDER</div>
						{/if}
					{/if}
				</li>
			{/each}
		</ol>
	{/snippet}

	{#if v && v.queued === 0 && v.failures.length === 0}
		<!-- Empty. A queue of hidden series alone draws this too, with reveal off. -->
		<section class="empty">
			<div class="empty-label">00 — NOTHING QUEUED</div>
			<h2>Nothing is downloading.</h2>
			<p>A series' DOWNLOAD row queues its chapters.</p>
		</section>
		<div class="recent-row">
			<span>{count(data.recent.day)} DOWNLOADED IN 24 H</span>
			<!-- eslint-disable-next-line svelte/no-navigation-without-resolve -- built from resolve() -->
			<a href={newHref}>NEW SHELF →</a>
		</div>
	{/if}
</div>

<style>
	.downloads {
		flex: 1;
		display: flex;
		flex-direction: column;
		min-height: calc(100dvh - var(--banner-h, 0px));
		--x-w: 56px;
		--num-w: 80px;
	}
	@media (max-width: 599px) {
		.downloads {
			--x-w: 44px;
			--num-w: 60px;
		}
	}
	.cell {
		display: flex;
		align-items: center;
		height: 100%;
		padding: 0 var(--pad);
		border: 0;
		border-radius: 0;
		background: transparent;
		color: var(--text-1);
		font: 500 16px var(--font-mono);
		text-decoration: none;
		cursor: pointer;
	}
	.cell-form .cell {
		font-size: 14px;
	}
	.cell.acc {
		background: var(--accent);
		color: var(--on-accent);
	}
	.cell:disabled {
		opacity: 0.35;
		cursor: default;
	}
	.cell-form {
		display: flex;
	}
	.title {
		margin: 0;
		padding: 0 18px;
		font: 500 16px var(--font-mono);
	}
	/* The phone keeps a queued series' count and drops the rest. */
	.short {
		display: none;
	}
	@media (max-width: 599px) {
		.long {
			display: none;
		}
		.short {
			display: block;
		}
	}
	.inline-form {
		display: flex;
		gap: 6px;
		align-items: center;
	}
	.link {
		padding: 0;
		border: 0;
		background: none;
		color: var(--text-1);
		font: inherit;
		letter-spacing: inherit;
		cursor: pointer;
	}
	.link:disabled {
		opacity: 0.35;
	}
	ol {
		list-style: none;
		margin: 0;
		padding: 0;
		border-top: var(--hairline);
	}
	/* FAILED, without a new colour: full ink at 500 and a 3px ink rule. */
	.fail {
		display: flex;
		align-items: stretch;
		min-height: 64px;
		border-bottom: var(--hairline);
		box-shadow: inset 3px 0 0 var(--text-1);
	}
	.f-text {
		flex: 1;
		min-width: 0;
		display: flex;
		flex-direction: column;
		justify-content: center;
		gap: 5px;
		padding: 10px var(--pad);
	}
	.f-t {
		font: 500 16px/1.3 var(--font-sans);
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}
	.f-m {
		font: 400 13px/1.3 var(--font-mono);
		color: var(--text-2);
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}
	.f-why {
		color: var(--text-1);
		font-weight: 500;
	}
	.f-act {
		display: flex;
		align-items: center;
		justify-content: center;
		padding: 0 var(--pad);
		border: 0;
		border-left: var(--hairline);
		border-radius: 0;
		background: transparent;
		color: var(--text-1);
		font: 500 13px var(--font-mono);
		letter-spacing: 0.04em;
		cursor: pointer;
	}
	@media (max-width: 599px) {
		.f-act {
			padding: 0 14px;
		}
	}
	.f-act.x {
		width: var(--x-w);
		padding: 0;
		font-size: 14px;
		color: var(--text-2);
	}
	.f-act:disabled {
		opacity: 0.35;
		cursor: default;
	}
	.group {
		border-bottom: var(--hairline);
	}
	.group.open {
		background: var(--surface-panel);
	}
	.g-row {
		display: flex;
		align-items: center;
		gap: 16px;
		padding: 10px var(--pad);
	}
	.g-cov {
		position: relative;
		flex-shrink: 0;
		display: block;
	}
	.hidden-badge {
		position: absolute;
		top: 0;
		left: 0;
		padding: 2px 3px;
		background: var(--reveal);
		color: var(--on-reveal);
		font: 500 9px/1 var(--font-mono);
	}
	.g-text {
		flex: 1;
		min-width: 0;
		display: flex;
		flex-direction: column;
		gap: 5px;
	}
	.g-t {
		font: 500 16px var(--font-sans);
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}
	.g-m {
		font: 400 13px/1.3 var(--font-mono);
		color: var(--text-2);
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}
	.g-m .now {
		color: var(--text-1);
	}
	.g-more {
		flex-shrink: 0;
		font: 500 12px var(--font-mono);
		letter-spacing: 0.04em;
		color: var(--text-2);
		text-decoration: none;
	}
	.g-acts {
		display: grid;
		grid-template-columns: 1fr 1fr;
		min-height: 52px;
		border-top: var(--hairline);
		border-bottom: var(--hairline);
	}
	.g-acts .cell-form + .cell-form {
		border-left: var(--hairline);
	}
	.g-acts button {
		flex: 1;
		border: 0;
		border-radius: 0;
		background: transparent;
		color: var(--text-1);
		font: 500 13px var(--font-mono);
		letter-spacing: 0.04em;
		cursor: pointer;
	}
	.g-acts button:disabled {
		opacity: 0.35;
		cursor: default;
	}
	.g-ch {
		display: flex;
		align-items: center;
		height: 44px;
		border-bottom: var(--hairline);
	}
	.c-n {
		width: var(--num-w);
		flex-shrink: 0;
		box-sizing: border-box;
		padding-left: var(--pad);
		font: 500 14px var(--font-mono);
		color: var(--text-2);
	}
	.c-t {
		flex: 1;
		min-width: 0;
		font: 400 15px var(--font-sans);
		color: var(--text-2);
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}
	.c-s {
		padding: 0 var(--pad);
		font: 500 13px var(--font-mono);
		white-space: nowrap;
	}
	.g-rest {
		display: flex;
		align-items: center;
		height: 44px;
		padding: 0 var(--pad);
		font: 500 12px var(--font-mono);
		letter-spacing: 0.04em;
		color: var(--text-2);
	}
	.more-series {
		display: flex;
		align-items: center;
		min-height: 44px;
		padding: 0 var(--pad);
		font: 500 13px var(--font-mono);
		letter-spacing: var(--tracking-label);
		color: var(--text-2);
		text-decoration: none;
	}
	.empty {
		display: flex;
		flex-direction: column;
		gap: 16px;
		padding: 48px var(--pad);
	}
	.empty-label {
		font: 500 13px var(--font-mono);
		letter-spacing: var(--tracking-label);
		color: var(--text-2);
	}
	.empty h2 {
		margin: 0;
		font: 500 20px/1.3 var(--font-sans);
	}
	.empty p {
		margin: 0;
		font: 400 15px/1.5 var(--font-sans);
		color: var(--text-prose);
		text-wrap: pretty;
	}
	.recent-row {
		display: flex;
		align-items: stretch;
		min-height: 56px;
		border-top: var(--hairline);
		border-bottom: var(--hairline);
	}
	.recent-row span {
		flex: 1;
		display: flex;
		align-items: center;
		padding: 0 var(--pad);
		font: 400 13px var(--font-mono);
		color: var(--text-2);
	}
	.recent-row a {
		display: flex;
		align-items: center;
		padding: 0 var(--pad);
		border-left: var(--hairline);
		font: 500 13px var(--font-mono);
		letter-spacing: 0.04em;
		color: var(--text-1);
		text-decoration: none;
	}
</style>

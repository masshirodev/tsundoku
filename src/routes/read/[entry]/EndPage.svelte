<script lang="ts">
	import { RATING_OPTIONS } from '$lib/library/rating';
	import type { Mode } from '$lib/reader/reader';

	/**
	 * The page after the last page (Index Reader, states endch, endseries and
	 * offline; the addendum's incogEnd). In paged modes the chapter boundary
	 * is a full page of its own, so crossing it is noticed; a tap or swipe
	 * forward carries on. At the end of what is available it is where the
	 * series is rated -- the rating block shows only while the series is
	 * unrated, so it never interrupts anyone twice.
	 */
	type Next = { name: string; title: string; pageCount: number; available: boolean };
	let {
		variant,
		entryName,
		position,
		kind,
		seriesTitle,
		next,
		nextCached = false,
		rating,
		favourite,
		incognito,
		mode,
		lastPage,
		seriesHref,
		libraryHref,
		onrate,
		onfav,
		onback
	}: {
		/** chapter: next is readable; missing: next has no file; offline: no network; series: nothing next. */
		variant: 'chapter' | 'missing' | 'offline' | 'series';
		entryName: string;
		/** "41 OF 58", "DOUJIN · 1 OF 1". */
		position: string;
		kind: string;
		seriesTitle: string;
		next: Next | null;
		/** The next chapter is cached on the tablet (doc/OFFLINE.md). */
		nextCached?: boolean;
		rating: number;
		favourite: boolean;
		incognito: boolean;
		mode: Mode;
		/** "P. 22 OF 22" */
		lastPage: string;
		seriesHref: string;
		libraryHref: string;
		onrate: (n: number) => void;
		onfav: () => void;
		onback: () => void;
	} = $props();

	const back = $derived(mode === 'rtl' ? '→' : '←');
	const nextTitle = $derived(next?.title ?? '');
</script>

<div class="end" class:incognito>
	{#if variant === 'offline'}
		<div class="offline"><span>○ OFFLINE</span><span class="dim">CACHED STILL OPENS</span></div>
	{/if}

	<div class="body" class:series={variant === 'series'}>
		<div class="kicker">
			<span>END · {variant === 'series' ? 'LAST AVAILABLE' : entryName}</span>
			<span>{variant === 'series' ? `${kind.toUpperCase()} · ${position}` : position}</span>
		</div>
		<div class="rule"></div>

		{#if variant === 'series'}
			<div class="big">{seriesTitle}</div>
			{#if rating === 0}
				<div class="rate-block">
					<div class="rrow">
						<div class="rlabel">RATING</div>
						{#each RATING_OPTIONS as n (n)}
							<button
								type="button"
								class="cell"
								class:muted={rating === 0}
								aria-label={n === 0 ? 'Unrated' : `Rate ${n}`}
								onclick={() => onrate(n)}>{n}</button
							>
						{/each}
					</div>
					<div class="rrow">
						<div class="rlabel">FAV</div>
						<button
							type="button"
							class="switch"
							role="switch"
							aria-checked={favourite}
							onclick={onfav}
						>
							<span class="track" class:on={favourite}><span class="knob"></span></span>
							<span>{favourite ? 'ON' : 'OFF'}</span>
						</button>
					</div>
				</div>
				<div class="note">SHOWN WHILE UNRATED · RATING SAVES ON TAP</div>
			{/if}
		{:else if next}
			<div class="next">
				<div class="kicker-2">NEXT</div>
				<div class="big" class:faded={variant !== 'chapter'}>{nextTitle}</div>
				<div class="sub">
					{#if variant === 'chapter'}
						{next.pageCount} PAGES{nextCached ? ' · ↓ CACHED' : ''}
					{:else if variant === 'missing'}
						○ NOT DOWNLOADED
					{:else}
						○ NOT CACHED
					{/if}
				</div>
			</div>
			{#if variant === 'chapter'}
				<div class="go">
					{mode === 'rtl' ? '← TAP OR SWIPE TO CONTINUE' : 'TAP OR SWIPE TO CONTINUE →'}
				</div>
			{:else if variant === 'missing'}
				<p class="why">
					{nextTitle} isn't on the workstation: it was read online, or hasn't been copied over yet. A
					scan picks it up once it is.
				</p>
			{:else}
				<p class="why">{nextTitle} opens once the workstation is reachable.</p>
			{/if}
		{/if}

		{#if incognito}
			<div class="incog">
				<div class="it">INCOGNITO · NOTHING SAVED</div>
				<div class="id">
					{entryName.charAt(0)}{entryName.slice(1).toLowerCase()} still reads as it did, and CONTINUE
					and history are unchanged. Rating and FAV still save.
				</div>
			</div>
		{/if}
	</div>

	<div class="foot">
		<!-- eslint-disable svelte/no-navigation-without-resolve -- both hrefs are resolved by the page -->
		<a class="fcell" href={seriesHref}>← SERIES</a>
		<span class="spacer"></span>
		{#if variant === 'chapter'}
			<button type="button" class="fcell right dim" onclick={onback}
				>{mode === 'rtl' ? `${lastPage} · BACK ${back}` : `${back} BACK · ${lastPage}`}</button
			>
		{:else}
			<a class="fcell right" href={libraryHref}>LIBRARY</a>
		{/if}
		<!-- eslint-enable svelte/no-navigation-without-resolve -->
	</div>
</div>

<style>
	.end {
		position: relative;
		width: 100vw;
		height: 100dvh;
		display: flex;
		flex-direction: column;
		background: var(--surface-page);
		color: var(--text-1);
	}
	.end.incognito::before {
		content: '';
		position: absolute;
		top: 0;
		left: 0;
		right: 0;
		border-top: 2px dashed var(--text-2);
	}
	.offline {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 12px;
		height: 48px;
		flex-shrink: 0;
		padding: 0 24px;
		border-bottom: var(--hairline);
		background: var(--surface-panel);
		font: 500 14px var(--font-mono);
	}
	.dim {
		color: var(--text-2);
	}
	.body {
		flex: 1;
		display: flex;
		flex-direction: column;
		justify-content: center;
		gap: 40px;
		padding: 0 64px;
		min-height: 0;
	}
	.body.series {
		gap: 36px;
	}
	.kicker,
	.kicker-2 {
		display: flex;
		justify-content: space-between;
		gap: 12px;
		font: 500 13px var(--font-mono);
		letter-spacing: var(--tracking-label);
		color: var(--text-2);
	}
	.rule {
		height: 1px;
		background: var(--line-1);
	}
	.next {
		display: flex;
		flex-direction: column;
		gap: 12px;
	}
	.big {
		font: 500 44px/50.6px var(--font-sans);
		text-wrap: pretty;
	}
	.big.faded {
		opacity: 0.4;
	}
	.sub {
		font: 400 15px var(--font-mono);
		color: var(--text-2);
	}
	.go {
		font: 500 16px var(--font-mono);
		color: var(--accent);
	}
	.why {
		margin: 0;
		max-width: 520px;
		font: var(--type-body);
		color: var(--text-2);
	}
	.rate-block {
		display: flex;
		flex-direction: column;
		border-top: var(--hairline);
	}
	.rrow {
		display: flex;
		align-items: stretch;
		height: 72px;
		border-bottom: var(--hairline);
	}
	.rlabel {
		display: flex;
		align-items: center;
		width: 120px;
		flex-shrink: 0;
		border-right: var(--hairline);
		font: 500 13px var(--font-mono);
		letter-spacing: var(--tracking-label);
		color: var(--text-2);
	}
	button {
		border: 0;
		border-radius: 0;
		background: transparent;
		color: var(--text-1);
		cursor: pointer;
	}
	.cell {
		flex: 1;
		border-right: var(--hairline);
		font: 500 16px var(--font-mono);
	}
	.cell:last-child {
		border-right: 0;
	}
	.cell.muted {
		color: var(--text-2);
	}
	.cell:active {
		background: var(--accent);
		color: var(--on-accent);
	}
	.switch {
		display: flex;
		align-items: center;
		gap: 12px;
		padding: 0 18px;
		font: 500 15px var(--font-mono);
	}
	.track {
		position: relative;
		width: 44px;
		height: 24px;
		border: 1px solid var(--line-2);
	}
	.knob {
		position: absolute;
		top: 2px;
		left: 2px;
		width: 18px;
		height: 18px;
		background: var(--text-2);
	}
	.track.on {
		border-color: var(--accent);
		background: var(--accent);
	}
	.track.on .knob {
		left: 22px;
		background: var(--on-accent);
	}
	.note {
		font: 400 13px var(--font-mono);
		color: var(--text-2);
	}
	.incog {
		display: flex;
		flex-direction: column;
		gap: 8px;
		padding: 18px 20px;
		border: 1px dashed var(--line-2);
	}
	.it {
		font: 500 14px var(--font-mono);
		letter-spacing: 0.04em;
	}
	.id {
		font: 400 16px/24px var(--font-sans);
		color: var(--text-2);
	}
	.foot {
		display: flex;
		height: 64px;
		flex-shrink: 0;
		border-top: var(--hairline);
	}
	.fcell {
		display: flex;
		align-items: center;
		padding: 0 24px;
		border-right: var(--hairline);
		color: var(--text-1);
		font: 500 14px var(--font-mono);
		text-decoration: none;
	}
	.fcell.right {
		border-right: 0;
		border-left: var(--hairline);
	}
	.fcell.dim {
		color: var(--text-2);
	}
	.spacer {
		flex: 1;
	}
	@media (max-width: 599px) {
		.body {
			padding: 0 24px;
			gap: 28px;
		}
		.big {
			font-size: 32px;
			line-height: 38px;
		}
		.rlabel {
			width: 72px;
		}
	}
</style>

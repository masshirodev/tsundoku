<script lang="ts">
	import { onMount } from 'svelte';
	import PageImage from './PageImage.svelte';
	import type { StripChapter } from '$lib/reader/reader';
	import type { Ring } from '$lib/japanese/blocks';

	/**
	 * Vertical scroll (Index Reader, states vertical and endchV): pages
	 * stitched full-width with no gap, each sized from the manifest before it
	 * loads, so the strip never jumps. The current page is the one under the
	 * middle of the screen.
	 *
	 * The strip holds a window of chapters, as Mihon's webtoon reader does:
	 * the one being read and its neighbours, with a 320px band ruled above and
	 * below between each two naming the chapter that ended and the one that
	 * starts. Reading carries on across a band either way; the reader follows
	 * (`onpage` names the chapter as well as the page), and the chapters on
	 * the strip move with it (doc/READER.md, "Vertical").
	 */
	let {
		chapters,
		sides = 0,
		src,
		onpage,
		onend,
		ontap,
		rings = () => []
	}: {
		chapters: StripChapter[];
		/** Each side's margin, percent of the width: the strip is the rest, centred. */
		sides?: number;
		src: (c: StripChapter, i: number) => string;
		/** A page crossed the middle of the screen: which chapter, which page. */
		onpage: (chapter: number, i: number) => void;
		/** A chapter's end came into view: it's read. */
		onend: (chapter: number) => void;
		/** A tap: the reader decides, a text block or the controls. */
		ontap: (e: MouseEvent) => void;
		/** A page's OCR'd text blocks to outline (doc/JAPANESE.md). */
		rings?: (chapter: number, i: number) => Ring[];
	} = $props();

	let root = $state<HTMLElement | null>(null);

	onMount(() => {
		const current_ = new IntersectionObserver(
			(entries) => {
				for (const e of entries) {
					if (!e.isIntersecting) continue;
					const el = e.target as HTMLElement;
					const chapter = Number(el.dataset.entry);
					if (el.dataset.role === 'page') onpage(chapter, Number(el.dataset.index));
					else if (el.dataset.role === 'end') onend(chapter);
				}
			},
			// A thin line across the middle of the screen: whatever crosses it is current.
			{ rootMargin: '-50% 0px -50% 0px' }
		);
		const watch = () => root?.querySelectorAll('[data-role]').forEach((el) => current_.observe(el));
		watch();
		const later = new MutationObserver(watch);
		if (root) later.observe(root, { childList: true, subtree: true });
		return () => {
			current_.disconnect();
			later.disconnect();
		};
	});
</script>

<!-- A tap anywhere shows the controls, the side margins included, unless it's on a text block; scrolling is the only way to move. -->
<!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
<div class="lane" onclick={ontap}>
	<div class="strip" bind:this={root} style:width="{100 - 2 * sides}%">
		{#each chapters as c, k (c.id)}
			{#if k > 0}
				{@const ended = chapters[k - 1]}
				<section class="band" aria-label="Chapter boundary" data-between="{ended.id}-{c.id}">
					<div class="kicker"><span>END · {ended.name}</span><span>{ended.position}</span></div>
					<div class="rule"></div>
					<div class="next">
						<div class="kicker">NEXT</div>
						<div class="name">{c.title || c.name}</div>
						<div class="sub">{c.pageCount} PAGES{c.cached ? ' · ↓ CACHED' : ''}</div>
					</div>
					<div class="go">{c.pages ? '↕ KEEP SCROLLING' : '↓ LOADING'}</div>
				</section>
			{/if}
			{#if c.pages}
				{#each c.pages as p, i (src(c, i))}
					<div data-role="page" data-entry={c.id} data-index={i} class="slot">
						<PageImage
							src={src(c, i)}
							number={i + 1}
							w={p.w}
							h={p.h}
							fit="strip"
							lazy
							rings={rings(c.id, i)}
						/>
					</div>
				{/each}
				<div data-role="end" data-entry={c.id} class="marker"></div>
			{/if}
		{/each}
	</div>
</div>

<style>
	.lane {
		width: 100%;
	}
	.strip {
		display: flex;
		flex-direction: column;
		width: 100%;
		max-width: 100vw;
		margin: 0 auto;
		/* The reader keeps the place itself as chapters come and go above it
		   (ImageReader's keepPlace); the browser's anchoring would do it twice. */
		overflow-anchor: none;
	}
	:global(html:has(.strip)) {
		overflow-anchor: none;
	}
	.slot {
		display: flex;
		width: 100%;
	}
	.slot :global(.page) {
		flex: 1;
	}
	.marker {
		height: 1px;
	}
	.band {
		display: flex;
		flex-direction: column;
		justify-content: center;
		gap: 18px;
		height: 320px;
		padding: 0 40px;
		border-top: var(--rule-strong);
		border-bottom: var(--rule-strong);
		background: var(--surface-page);
		color: var(--text-1);
	}
	.kicker {
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
		gap: 8px;
	}
	.name {
		font: var(--type-title-lg);
		line-height: 40.8px;
	}
	.sub {
		font: 400 13px var(--font-mono);
		color: var(--text-2);
	}
	.go {
		font: 500 14px var(--font-mono);
		color: var(--accent);
	}
</style>

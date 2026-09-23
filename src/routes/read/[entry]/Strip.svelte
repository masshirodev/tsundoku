<script lang="ts">
	import { onMount, tick } from 'svelte';
	import PageImage from './PageImage.svelte';
	import type { Page } from '$lib/reader/reader';

	/**
	 * Vertical scroll (Index Reader, states vertical and endchV): pages
	 * stitched full-width with no gap, each sized from the manifest before it
	 * loads, so the strip never jumps. The current page is the one under the
	 * middle of the screen.
	 *
	 * At the end, the strip carries on into the next chapter: a 320px band
	 * ruled above and below names the chapter that ended and the one that
	 * starts, then the next chapter's pages follow. Once its first page
	 * reaches the top, the reader moves to it (`oncross`).
	 */
	let {
		pages,
		src,
		start,
		offset = 0,
		ended,
		position,
		next,
		nextPages,
		nextSrc,
		onpage,
		oncross,
		onend,
		ontap
	}: {
		pages: Page[];
		src: (i: number) => string;
		start: number;
		/** Where the start page's top sits on screen: kept across a crossing so nothing jumps. */
		offset?: number;
		/** "END · CH. 213" */
		ended: string;
		/** "213 OF 243" */
		position: string;
		next: { name: string; title: string; pageCount: number } | null;
		/** The next chapter's pages once fetched; null until then, or when it can't be read. */
		nextPages: Page[] | null;
		nextSrc: (i: number) => string;
		onpage: (i: number) => void;
		/** Called with the next chapter's first page's position on screen. */
		oncross: (top: number) => void;
		/** The strip's end came into view: the chapter is read. */
		onend: () => void;
		ontap: () => void;
	} = $props();

	let root = $state<HTMLElement | null>(null);

	onMount(() => {
		let crossed = false;
		const current = new IntersectionObserver(
			(entries) => {
				for (const e of entries) {
					if (!e.isIntersecting) continue;
					const el = e.target as HTMLElement;
					if (el.dataset.role === 'page') onpage(Number(el.dataset.index));
					else if (el.dataset.role === 'end') onend();
					else if (el.dataset.role === 'next' && !crossed) {
						crossed = true;
						oncross(el.getBoundingClientRect().top);
					}
				}
			},
			// A thin line across the middle of the screen: whatever crosses it is current.
			{ rootMargin: '-50% 0px -50% 0px' }
		);
		const watch = () => root?.querySelectorAll('[data-role]').forEach((el) => current.observe(el));
		watch();
		const later = new MutationObserver(watch);
		if (root) later.observe(root, { childList: true, subtree: true });
		void tick().then(() => {
			const el = root?.querySelector<HTMLElement>(`[data-index="${start}"]`);
			if (el) window.scrollTo({ top: el.getBoundingClientRect().top + window.scrollY - offset });
		});
		return () => {
			current.disconnect();
			later.disconnect();
		};
	});
</script>

<!-- A tap anywhere shows the controls; scrolling is the only way to move. -->
<!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
<div class="strip" bind:this={root} onclick={ontap}>
	{#each pages as p, i (src(i))}
		<div data-role="page" data-index={i} class="slot">
			<PageImage src={src(i)} number={i + 1} w={p.w} h={p.h} fit="strip" />
		</div>
	{/each}
	<div data-role="end" class="marker"></div>

	{#if next}
		<section class="band" aria-label="Chapter boundary">
			<div class="kicker"><span>{ended}</span><span>{position}</span></div>
			<div class="rule"></div>
			<div class="next">
				<div class="kicker">NEXT</div>
				<div class="name">{next.title || next.name}</div>
				<div class="sub">{next.pageCount} PAGES</div>
			</div>
			<div class="go">{nextPages ? '↓ KEEP SCROLLING' : '↓ LOADING'}</div>
		</section>
		{#if nextPages}
			{#each nextPages as p, i (nextSrc(i))}
				<div class="slot" data-role={i === 0 ? 'next' : undefined}>
					<PageImage src={nextSrc(i)} number={i + 1} w={p.w} h={p.h} fit="strip" />
				</div>
			{/each}
		{/if}
	{/if}
</div>

<style>
	.strip {
		display: flex;
		flex-direction: column;
		width: 100%;
		max-width: 100vw;
		margin: 0 auto;
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

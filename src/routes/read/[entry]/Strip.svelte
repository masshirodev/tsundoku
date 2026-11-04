<script lang="ts">
	import { keepPlaceBy } from '$lib/reader/smooth-scroll';
	import { onMount, tick } from 'svelte';
	import PageImage from './PageImage.svelte';
	import { skipOffscreen } from '$lib/reader/offscreen';
	import type { Page, StripChapter } from '$lib/reader/reader';
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
		zoom = 1,
		src,
		shape = (_c, _i, p) => p,
		onshape,
		onpage,
		onend,
		ontap,
		rings = () => [],
		stopNext = null,
		stopPrev = null,
		padGuard = false,
		ongo
	}: {
		chapters: StripChapter[];
		/** Each side's margin, percent of the width: the strip is the rest, centred. */
		sides?: number;
		/** The reader's zoom (doc/READER.md, "Zoom"): the strip's width, times it; past 100% it scrolls sideways. */
		zoom?: number;
		src: (c: StripChapter, i: number) => string;
		/** A page's shape for its box, where the manifest had none (a chapter read online). */
		shape?: (c: StripChapter, i: number, p: Page) => Page;
		/** A page read online arrived at this size. */
		onshape?: (c: StripChapter, i: number, w: number, h: number) => void;
		/** A page crossed the middle of the screen: which chapter, which page. */
		onpage: (chapter: number, i: number) => void;
		/** A chapter's end came into view: it's read. */
		onend: (chapter: number) => void;
		/** A tap: the reader decides, a text block or the controls. */
		ontap: (e: MouseEvent) => void;
		/** A page's OCR'd text blocks to outline (doc/JAPANESE.md). */
		rings?: (chapter: number, i: number) => Ring[];
		/**
		 * The strip stops at the chapter's end (CHAPTERS: STOP AT THE END; c206):
		 * the chapter after and before, offered as buttons instead of run on into.
		 */
		stopNext?: { id: number; name: string; title: string; pageCount: number } | null;
		stopPrev?: { id: number; name: string; title: string } | null;
		/** A stop band's button: open that chapter. */
		/** A TV's chrome is up: the stops are arrow stops only while on screen (c253). */
		padGuard?: boolean;
		ongo?: (id: number) => void;
	} = $props();

	let root = $state<HTMLElement | null>(null);
	let lane = $state<HTMLElement | null>(null);

	/**
	 * Where the reader is: the page (or band) under the middle of the screen,
	 * and how far down it the middle falls, as a fraction. Noted on every
	 * scroll, at the width it was noted at, since by the time a rotation is
	 * seen the layout has already changed under it.
	 */
	let place: {
		el: HTMLElement;
		at: number;
		width: number;
		/** A zoom's point (anchorAt): where on the screen it goes back, and how far across the page. */
		to?: { x: number; y: number; fx: number };
	} | null = null;
	/** Set while the place is being put back: pages crossing the middle meanwhile aren't read. */
	let settling = false;

	function note() {
		if (!root || settling) return;
		const width = root.clientWidth;
		// Already relaid out at a new width: what's under the middle now is the jump, not the place.
		if (place && place.width !== width) return;
		const el = document
			.elementFromPoint(innerWidth / 2, innerHeight / 2)
			?.closest<HTMLElement>('[data-role="page"], .band');
		if (!el || !root.contains(el)) return;
		const r = el.getBoundingClientRect();
		place = { el, at: r.height ? (innerHeight / 2 - r.top) / r.height : 0, width };
	}

	/**
	 * The strip changed width (a rotation, SIDES, a resized window): every
	 * page's height scaled with it but the scroll offset didn't, which lands
	 * pages away. Put the same point of the same page back under the middle.
	 */
	function restore() {
		if (!root) return;
		const width = root.clientWidth;
		if (!place || place.width === width) return;
		const { el, at, to } = place;
		if (el.isConnected) {
			settling = true;
			const r = el.getBoundingClientRect();
			keepPlaceBy(r.top + at * r.height - (to?.y ?? innerHeight / 2));
			// A zoom keeps its point across the page too, inside the lane.
			if (to && lane) lane.scrollLeft += r.left + to.fx * r.width - to.x;
			requestAnimationFrame(() =>
				requestAnimationFrame(() => {
					settling = false;
				})
			);
		}
		place = { el, at, width };
	}

	/**
	 * A zoom is about to change the strip's width (a double tap, a pinch: card
	 * c185): keep the point at (x, y) where it is, rather than the middle of the
	 * screen, which is what the width change would otherwise keep. Called just
	 * before the zoom; `restore` does the rest when the width changes.
	 */
	export function anchorAt(x: number, y: number) {
		if (!root) return;
		const el = document.elementFromPoint(x, y)?.closest<HTMLElement>('[data-role="page"], .band');
		if (!el || !root.contains(el)) return;
		const r = el.getBoundingClientRect();
		place = {
			el,
			at: r.height ? (y - r.top) / r.height : 0,
			width: root.clientWidth,
			to: { x, y, fx: r.width ? (x - r.left) / r.width : 0.5 }
		};
	}

	/**
	 * A page read online arrived another size than its box guessed (shapeOf
	 * in $lib/reader/reader), and its box, with any still guessing, is about
	 * to take it. Above the page being read that would shove it: note the
	 * page under the middle first, and put it back after, as the reader's
	 * keepPlace does for a chapter arriving above.
	 */
	async function reshaped(c: StripChapter, i: number, w: number, h: number) {
		const anchor = document
			.elementFromPoint(innerWidth / 2, innerHeight / 2)
			?.closest<HTMLElement>('[data-role="page"], .band');
		const before = anchor?.getBoundingClientRect().top;
		onshape?.(c, i, w, h);
		await tick();
		if (!anchor?.isConnected || before === undefined) return;
		const moved = anchor.getBoundingClientRect().top - before;
		if (Math.abs(moved) < 1) return;
		settling = true;
		keepPlaceBy(moved);
		requestAnimationFrame(() =>
			requestAnimationFrame(() => {
				settling = false;
			})
		);
	}

	onMount(() => {
		let noting = 0;
		const onscroll = () => {
			if (noting) return;
			noting = requestAnimationFrame(() => {
				noting = 0;
				note();
			});
		};
		addEventListener('scroll', onscroll, { passive: true });
		const resized = new ResizeObserver(restore);
		if (root) resized.observe(root);
		// The first place, before any scroll: where the strip opened.
		requestAnimationFrame(note);

		const current_ = new IntersectionObserver(
			(entries) => {
				if (settling) return;
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
			removeEventListener('scroll', onscroll);
			cancelAnimationFrame(noting);
			resized.disconnect();
			current_.disconnect();
			later.disconnect();
		};
	});
</script>

<!-- A tap anywhere shows the controls, the side margins included, unless it's on a text block; scrolling is the only way to move. -->
<!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
<div class="lane" class:wider={zoom > 1} bind:this={lane} onclick={ontap}>
	<div
		class="strip"
		bind:this={root}
		style:--strip-width="{(100 - 2 * sides) * zoom}%"
		style:--strip-zoom={zoom}
	>
		{#if stopPrev}
			<!-- Stopped at the chapter's ends (c206): the one before, by choice. -->
			<section class="band stop top" aria-label="Previous chapter" use:skipOffscreen={padGuard}>
				<button
					type="button"
					class="go-btn"
					onclick={(e) => {
						e.stopPropagation();
						ongo?.(stopPrev.id);
					}}>← PREVIOUS CHAPTER · {stopPrev.title || stopPrev.name}</button
				>
			</section>
		{/if}
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
					{@const s = shape(c, i, p)}
					<div data-role="page" data-entry={c.id} data-index={i} class="slot">
						<PageImage
							src={src(c, i)}
							number={i + 1}
							w={s.w}
							h={s.h}
							fit="strip"
							lazy
							online={c.version.startsWith('online-')}
							onshape={(w, h) => reshaped(c, i, w, h)}
							rings={rings(c.id, i)}
						/>
					</div>
				{/each}
				<div data-role="end" data-entry={c.id} class="marker"></div>
			{/if}
		{/each}
		{#if stopNext && chapters.length}
			{@const ended = chapters[chapters.length - 1]}
			<!-- Stopped at the end (c206; a friend, 2026-10-30): the next chapter waits for a tap. -->
			<section
				class="band stop"
				aria-label="Chapter end"
				data-stop={ended.id}
				use:skipOffscreen={padGuard}
			>
				<div class="kicker"><span>END · {ended.name}</span><span>{ended.position}</span></div>
				<div class="rule"></div>
				<div class="next">
					<div class="kicker">NEXT</div>
					<div class="name">{stopNext.title || stopNext.name}</div>
					<div class="sub">{stopNext.pageCount} PAGES</div>
				</div>
				<button
					type="button"
					class="go-btn"
					onclick={(e) => {
						e.stopPropagation();
						ongo?.(stopNext.id);
					}}>NEXT CHAPTER →</button
				>
			</section>
		{/if}
	</div>
</div>

<style>
	.lane {
		width: 100%;
	}
	/* Zoomed past the screen: the strip scrolls sideways inside its lane, and
	   still down the page as before. */
	.lane.wider {
		overflow-x: auto;
	}
	.lane.wider .strip {
		max-width: none;
	}
	.strip {
		display: flex;
		flex-direction: column;
		width: var(--strip-width);
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
	/* A stop band's button (c206): the band's GO line, made a thing to press. */
	.go-btn {
		align-self: flex-start;
		display: flex;
		align-items: center;
		min-height: 56px;
		padding: 0 24px;
		border: 1px solid var(--line-2);
		background: transparent;
		color: var(--accent);
		font: 500 16px var(--font-mono);
		cursor: pointer;
	}
	.go-btn:active {
		background: var(--surface-inverse);
		color: var(--text-inverse);
	}
	.band.stop.top {
		padding-top: 24px;
		padding-bottom: 24px;
	}
	/* The TV's strip is 520 wide, centred, at any zoom (TV-Reader, state 7C). */
	@media (pointer: none) and (min-width: 900px) {
		.strip {
			width: calc(var(--tv-strip-w) * var(--strip-zoom, 1));
		}
	}
</style>

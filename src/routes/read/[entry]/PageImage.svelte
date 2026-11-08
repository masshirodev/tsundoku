<script lang="ts">
	import { croppedSize, viewBox, type Inset } from '$lib/reader/crop';
	import type { Ring } from '$lib/japanese/blocks';
	/**
	 * One page (Index Reader, states loading and failed). While the image is
	 * on its way, the page's own box -- sized from the manifest, so nothing
	 * jumps -- shows "P. 15" and a bar; if it fails, why, and RETRY.
	 */
	let {
		src,
		number,
		w,
		h,
		fit = 'screen',
		share = 1,
		side = 'center',
		half = null,
		rotate = false,
		inset = null,
		rings = [],
		lazy = false,
		chapter = '',
		online = false,
		rule = null,
		onshape
	}: {
		src: string;
		/** 1-based, as the reader names it. */
		number: number;
		w: number;
		h: number;
		/** How the page meets the screen; `share` is how many pages split the width. */
		fit?: 'width' | 'height' | 'screen' | 'strip';
		share?: number;
		/** In a spread, the two pages meet at the gutter rather than float in their halves. */
		side?: 'left' | 'right' | 'center';
		/** A wide page split in two: which half this screen shows (doc/READER.md, "Wide pages"). */
		half?: 'left' | 'right' | null;
		/** A wide page turned a quarter, to fill a portrait screen. */
		rotate?: boolean;
		/** Its plain border, cropped away (doc/READER.md, "Crop borders"). */
		inset?: Inset | null;
		/** OCR'd text blocks outlined on the page (doc/JAPANESE.md), in fractions of what's shown. */
		rings?: Ring[];
		/**
		 * Asked for only as it nears the screen (the vertical strip): three
		 * chapters' pages at once starve the ones being read on a slow link.
		 */
		lazy?: boolean;
		/**
		 * The chapter, named in the box on a chapter's first page (Loading
		 * States 1n): arriving from the previous chapter, that's what's loading.
		 */
		chapter?: string;
		/** Read from its source (doc/BROWSING.md, "Manga online"): waiting is dashed, as Index dashes what isn't stored. */
		online?: boolean;
		/**
		 * A kept page (Highlights H3, c703; Manga M3): a 4px yellow rule in the
		 * gutter at the page's outer side, 6px off the art. Nothing is drawn on
		 * the art itself; a page with no gutter (full bleed) shows nothing, as
		 * the screen clips what falls past its edge.
		 */
		rule?: 'left' | 'right' | null;
		/**
		 * The image arrived at this size. Asked of a page read online, whose
		 * box was a guess: a source never says how big its pages are
		 * (shapeOf in $lib/reader/reader).
		 */
		onshape?: (w: number, h: number) => void;
	} = $props();
	const name = $derived(chapter ? `${chapter} · P. ${number}` : `P. ${number}`);

	let status = $state<'loading' | 'loaded' | 'failed'>('loading');
	let attempt = $state(0);
	const url = $derived(attempt ? `${src}${src.includes('?') ? '&' : '?'}retry=${attempt}` : src);

	// One component per page: the reader keys them by source, so a new page
	// starts fresh and there is no reset to race a cached image's onload.
	// Cropped, the page takes the shape of what's left, so its box is right before it loads.
	const cropped = $derived(inset && !half && !rotate ? inset : null);
	const size = $derived(cropped ? croppedSize(w, h, cropped) : { w, h });
	const ratio = $derived(
		!(w > 0 && h > 0)
			? '800 / 1136'
			: cropped
				? `${size.w} / ${size.h}`
				: half
					? `${w / 2} / ${h}`
					: rotate
						? `${h} / ${w}`
						: `${w} / ${h}`
	);
	/** The drawn image's shape, for the text frame; none where the box already is it. */
	const aspect = $derived(w > 0 && h > 0 && !half && !rotate ? size.w / size.h : 0);
</script>

<div
	class="page fit-{fit}"
	class:half={!!half}
	class:rotate
	style:aspect-ratio={ratio}
	style:--share={share}
	style:--wh={w > 0 && h > 0 ? w / h : 1}
	data-page={number}
>
	<img
		class:right={half === 'right'}
		style:object-view-box={viewBox(cropped)}
		src={url}
		style:object-position={side === 'left'
			? 'right center'
			: side === 'right'
				? 'left center'
				: 'center'}
		alt="Page {number}"
		loading={lazy ? 'lazy' : undefined}
		draggable="false"
		class:hidden={status !== 'loaded'}
		onload={(e) => {
			status = 'loaded';
			const img = e.currentTarget as HTMLImageElement;
			if (online && img.naturalWidth > 0 && img.naturalHeight > 0)
				onshape?.(img.naturalWidth, img.naturalHeight);
		}}
		onerror={() => (status = 'failed')}
	/>
	<!--
		Where the image is actually drawn: `contain` letterboxes it whenever the
		box isn't the page's shape (a phone in FIT SCREEN caps the width, so the
		box is the screen's), and a ring placed in the box's fractions sits off
		the text by half the letterbox. The reader hit-tests against this too.
	-->
	<div
		class="frame {side}"
		class:fill={!aspect}
		style:--ar={aspect || undefined}
		data-text-frame
		aria-hidden="true"
	>
		{#if rule}<span class="kept-rule {rule}" data-kept-rule={rule}></span>{/if}
		{#if status === 'loaded'}
			{#each rings as r, k (k)}
				<div
					class="ring"
					class:selected={r.selected}
					style:left="{r.box[0] * 100}%"
					style:top="{r.box[1] * 100}%"
					style:width="{r.box[2] * 100}%"
					style:height="{r.box[3] * 100}%"
				></div>
			{/each}
		{/if}
	</div>
	{#if status === 'loading'}
		<div class="loading" class:online aria-hidden="true">
			<div class="n">{online ? `${name} · ON ITS WAY` : name}</div>
			<div class="bar"><div></div></div>
		</div>
	{:else if status === 'failed'}
		<div class="failed" role="alert">
			<!-- From the page's top, and kept in sight while it scrolls past: a manhwa
			     slice is thousands of pixels tall, and centred in it the message was a
			     scroll through black away (the owner, 2026-10-30). -->
			<div class="inner">
				<div class="msg">
					<div class="t">{name} DID NOT LOAD</div>
					<div class="d">
						{online ? 'THE SOURCE DID NOT SEND IT · TRIED TWICE' : 'WORKSTATION DID NOT ANSWER'}
					</div>
				</div>
				<button
					type="button"
					onpointerdown={(e) => e.stopPropagation()}
					onpointerup={(e) => e.stopPropagation()}
					onclick={(e) => {
						e.stopPropagation();
						status = 'loading';
						attempt += 1;
					}}>RETRY</button
				>
			</div>
		</div>
	{/if}
</div>

<style>
	.page {
		position: relative;
		flex-shrink: 0;
		background: transparent;
		container-type: size;
	}
	/* Paged: the page is as large as the screen allows, in its own shape. */
	/* --zoom is the reader's (doc/READER.md, "Zoom"): the page as fitted, times it. */
	.fit-screen {
		max-width: calc(100vw * var(--zoom, 1) / var(--share));
		max-height: calc(100dvh * var(--zoom, 1));
		height: calc(100dvh * var(--zoom, 1));
	}
	.fit-height {
		height: calc(100dvh * var(--zoom, 1));
	}
	.fit-width {
		width: calc(100vw * var(--zoom, 1) / var(--share));
	}
	/* Vertical: full width, stitched with no gap. */
	.fit-strip {
		width: 100%;
	}
	img {
		display: block;
		width: 100%;
		height: 100%;
		object-fit: contain;
		user-select: none;
		-webkit-user-drag: none;
	}
	img.hidden {
		visibility: hidden;
	}
	/* Half a wide page: the whole image at twice the box's width, one half showing. */
	.half,
	.rotate {
		overflow: hidden;
	}
	.half img {
		width: 200%;
		max-width: none;
		object-fit: fill;
	}
	.half img.right {
		transform: translateX(-50%);
	}
	/* A wide page turned a quarter: laid out in the box's turned shape, then turned. */
	.rotate img {
		position: absolute;
		left: 50%;
		top: 50%;
		width: calc(100% * var(--wh));
		height: calc(100% / var(--wh));
		max-width: none;
		object-fit: fill;
		transform: translate(-50%, -50%) rotate(90deg);
	}
	/* The contain rectangle, aligned the way object-position aligns the image. */
	.frame {
		position: absolute;
		top: 50%;
		left: 50%;
		width: min(100cqw, 100cqh * var(--ar));
		height: min(100cqh, 100cqw / var(--ar));
		transform: translate(-50%, -50%);
		pointer-events: none;
	}
	.frame.left {
		left: auto;
		right: 0;
		transform: translateY(-50%);
	}
	.frame.right {
		left: 0;
		transform: translateY(-50%);
	}
	/* Manga M3: 4px, 6px off the drawn art's outer edge, the page's full height.
	   The marker's yellow in the dark theme (Main 02), as /highlights keeps it. */
	.kept-rule {
		position: absolute;
		top: 0;
		bottom: 0;
		width: 4px;
		background: oklch(0.5 0.09 95);
	}
	.kept-rule.right {
		left: calc(100% + 6px);
	}
	.kept-rule.left {
		right: calc(100% + 6px);
	}
	.frame.fill {
		inset: 0;
		width: auto;
		height: auto;
		transform: none;
	}
	/*
	 * Index Japanese 1a: an ink outline with a dark edge either side, so it
	 * reads on white paper and on black art; the block being looked up, in the
	 * accent.
	 */
	.ring {
		position: absolute;
		pointer-events: none;
		box-shadow:
			0 0 0 1px var(--graphite-950),
			0 0 0 2px var(--graphite-100),
			0 0 0 3px var(--graphite-950);
	}
	.ring.selected {
		box-shadow: 0 0 0 3px var(--accent);
	}
	/* A page read online, not here yet: dashed at its expected size (Online Board 3a). */
	.loading.online {
		outline: 1px dashed var(--line-2);
		outline-offset: -1px;
	}
	.loading {
		position: absolute;
		inset: 0;
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		gap: 16px;
		background: var(--surface-panel);
	}
	.n {
		font: 500 15px var(--font-mono);
		color: var(--text-2);
	}
	.bar {
		width: 160px;
		height: 2px;
		background: var(--line-1);
		overflow: hidden;
	}
	.bar div {
		width: 64px;
		height: 2px;
		background: var(--accent);
		animation: slide 1.2s var(--ease) infinite;
	}
	@keyframes slide {
		from {
			transform: translateX(-64px);
		}
		to {
			transform: translateX(160px);
		}
	}
	@media (prefers-reduced-motion: reduce) {
		.bar div {
			animation: none;
		}
	}
	.failed {
		position: absolute;
		inset: 0;
		display: flex;
		flex-direction: column;
		align-items: center;
		border: 1px solid var(--line-2);
		background: var(--surface-page);
	}
	/* Sticky at about the screen's middle: a page that fits the screen shows it
	   centred as before, a tall one from its first pixel on. */
	.inner {
		position: sticky;
		top: calc(50dvh - 72px);
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 24px;
		padding: 24px 16px;
	}
	.msg {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 8px;
	}
	.t {
		font: 500 16px var(--font-mono);
		color: var(--text-1);
	}
	.d {
		font: 400 13px var(--font-mono);
		color: var(--text-2);
	}
	.failed button {
		display: flex;
		align-items: center;
		height: 56px;
		padding: 0 32px;
		border: 1px solid var(--line-2);
		border-radius: 0;
		background: transparent;
		color: var(--text-1);
		font: 500 15px var(--font-mono);
		cursor: pointer;
	}
	.failed button:active {
		background: var(--surface-inverse);
		color: var(--text-inverse);
	}
</style>

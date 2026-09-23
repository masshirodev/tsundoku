<script lang="ts">
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
		chapter = ''
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
		/**
		 * The chapter, named in the box on a chapter's first page (Loading
		 * States 1n): arriving from the previous chapter, that's what's loading.
		 */
		chapter?: string;
	} = $props();
	const name = $derived(chapter ? `${chapter} · P. ${number}` : `P. ${number}`);

	let status = $state<'loading' | 'loaded' | 'failed'>('loading');
	let attempt = $state(0);
	const url = $derived(attempt ? `${src}${src.includes('?') ? '&' : '?'}retry=${attempt}` : src);

	// One component per page: the reader keys them by source, so a new page
	// starts fresh and there is no reset to race a cached image's onload.
	const ratio = $derived(w > 0 && h > 0 ? `${w} / ${h}` : '800 / 1136');
</script>

<div class="page fit-{fit}" style:aspect-ratio={ratio} style:--share={share} data-page={number}>
	<img
		src={url}
		style:object-position={side === 'left'
			? 'right center'
			: side === 'right'
				? 'left center'
				: 'center'}
		alt="Page {number}"
		draggable="false"
		class:hidden={status !== 'loaded'}
		onload={() => (status = 'loaded')}
		onerror={() => (status = 'failed')}
	/>
	{#if status === 'loading'}
		<div class="loading" aria-hidden="true">
			<div class="n">{name}</div>
			<div class="bar"><div></div></div>
		</div>
	{:else if status === 'failed'}
		<div class="failed" role="alert">
			<div class="msg">
				<div class="t">{name} DID NOT LOAD</div>
				<div class="d">WORKSTATION DID NOT ANSWER</div>
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
	{/if}
</div>

<style>
	.page {
		position: relative;
		flex-shrink: 0;
		background: transparent;
	}
	/* Paged: the page is as large as the screen allows, in its own shape. */
	.fit-screen {
		max-width: calc(100vw / var(--share));
		max-height: 100dvh;
		height: 100dvh;
	}
	.fit-height {
		height: 100dvh;
	}
	.fit-width {
		width: calc(100vw / var(--share));
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
		justify-content: center;
		gap: 24px;
		border: 1px solid var(--line-2);
		background: var(--surface-page);
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

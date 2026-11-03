<script lang="ts">
	import { leave } from '$lib/motion';
	/**
	 * An illustration, full screen (Index Text Reader 1e, illusFull): the image
	 * reader's black ground and fit. Two fingers pinch to zoom, one finger pans
	 * a zoomed image, and a tap closes. The zoom level shows for a moment.
	 */
	let { src, alt, onclose }: { src: string; alt: string; onclose: () => void } = $props();

	let scale = $state(1);
	let x = $state(0);
	let y = $state(0);
	let showZoom = $state(false);
	let hideZoom: ReturnType<typeof setTimeout> | undefined;

	// Fingers down, by pointer: gesture bookkeeping, never rendered.
	// eslint-disable-next-line svelte/prefer-svelte-reactivity
	const points = new Map<number, { x: number; y: number }>();
	let start: { dist: number; scale: number } | null = null;
	let moved = false;

	function flash() {
		showZoom = true;
		clearTimeout(hideZoom);
		hideZoom = setTimeout(() => (showZoom = false), 1200);
	}
	const dist = () => {
		const [a, b] = [...points.values()];
		return Math.hypot(a.x - b.x, a.y - b.y);
	};
	function down(e: PointerEvent) {
		(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
		points.set(e.pointerId, { x: e.clientX, y: e.clientY });
		moved = false;
		if (points.size === 2) start = { dist: dist(), scale };
	}
	function move(e: PointerEvent) {
		const prev = points.get(e.pointerId);
		if (!prev) return;
		points.set(e.pointerId, { x: e.clientX, y: e.clientY });
		if (points.size === 2 && start) {
			scale = Math.min(6, Math.max(1, (start.scale * dist()) / start.dist));
			if (scale === 1) x = y = 0;
			moved = true;
			flash();
		} else if (points.size === 1 && scale > 1) {
			x += e.clientX - prev.x;
			y += e.clientY - prev.y;
			if (Math.hypot(e.clientX - prev.x, e.clientY - prev.y) > 2) moved = true;
		}
	}
	function up(e: PointerEvent) {
		points.delete(e.pointerId);
		if (points.size < 2) start = null;
		if (points.size === 0 && !moved) onclose();
	}
	function wheel(e: WheelEvent) {
		e.preventDefault();
		scale = Math.min(6, Math.max(1, scale * (e.deltaY < 0 ? 1.1 : 1 / 1.1)));
		if (scale === 1) x = y = 0;
		flash();
	}
</script>

<div
	class="view appear"
	out:leave
	role="dialog"
	aria-label="Illustration"
	tabindex="-1"
	onpointerdown={down}
	onpointermove={move}
	onpointerup={up}
	onpointercancel={up}
	onwheel={wheel}
	onkeydown={(e) => e.key === 'Escape' && onclose()}
>
	<img {src} {alt} style:transform="translate({x}px, {y}px) scale({scale})" draggable="false" />
	{#if showZoom}<div class="zoom">{scale.toFixed(1)}×</div>{/if}
	<div class="hint">PINCH · ZOOM / TAP · CLOSE</div>
</div>

<style>
	.view {
		position: fixed;
		inset: 0;
		z-index: 60;
		display: flex;
		align-items: center;
		justify-content: center;
		background: #000;
		touch-action: none;
		overflow: hidden;
	}
	img {
		max-width: 100%;
		max-height: 100%;
		object-fit: contain;
		transform-origin: center;
		user-select: none;
	}
	.zoom {
		position: absolute;
		top: 24px;
		right: 24px;
		padding: 10px 14px;
		background: var(--surface-page);
		font: 500 14px var(--font-mono);
		color: var(--text-1);
	}
	.hint {
		position: absolute;
		left: 50%;
		bottom: 32px;
		transform: translateX(-50%);
		padding: 10px 14px;
		background: var(--surface-page);
		font: 500 14px var(--font-mono);
		color: var(--text-2);
		white-space: pre;
	}
</style>

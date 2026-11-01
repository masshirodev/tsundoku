<script lang="ts">
	import { onMount } from 'svelte';

	/**
	 * A temporary measuring overlay for the vertical strip on a phone (the
	 * owner, 2026-10-30: a diagonal swipe on the Fold, in Hermit, "goes way
	 * faster than i think it should"). Shown only with `?fling` on the
	 * reader's address. Per flick it says the swipe's angle from vertical, the
	 * finger's travel and release speed down the page, how far the page then
	 * glided by itself, and whether a glide was still running when the finger
	 * came down (Chromium adds a new fling to one in flight: "BOOST").
	 * Reads only; it never touches the scroll. To come out once measured.
	 */
	type Flick = {
		id: number;
		angle: number;
		finger: number;
		speed: number;
		glide: number | null;
		boost: boolean;
	};
	let flicks = $state<Flick[]>([]);

	onMount(() => {
		let samples: { y: number; x: number; t: number }[] = [];
		let start: { x: number; y: number } | null = null;
		let gliding = false;
		let lastScroll = 0;
		let boost = false;
		let watch = 0;
		let n = 0;
		const onScroll = () => (lastScroll = performance.now());
		const touchstart = (e: TouchEvent) => {
			if (e.touches.length !== 1) return void (start = null);
			const t = e.touches[0];
			start = { x: t.clientX, y: t.clientY };
			// A glide in flight: the page moved in the last 50 ms without a finger on it.
			boost = gliding && performance.now() - lastScroll < 50;
			samples = [{ x: t.clientX, y: t.clientY, t: e.timeStamp }];
		};
		const touchmove = (e: TouchEvent) => {
			if (!start || e.touches.length !== 1) return;
			const t = e.touches[0];
			samples.push({ x: t.clientX, y: t.clientY, t: e.timeStamp });
			if (samples.length > 12) samples.shift();
		};
		const touchend = (e: TouchEvent) => {
			if (!start || e.touches.length) return;
			const last = samples[samples.length - 1];
			const dx = last.x - start.x;
			const dy = last.y - start.y;
			start = null;
			if (Math.abs(dy) < 20) return;
			// Release speed down the page over the last ~80 ms, in px/ms.
			const tail = samples.filter((s) => last.t - s.t <= 80);
			const first = tail[0];
			const speed = last.t > first.t ? Math.abs(last.y - first.y) / (last.t - first.t) : 0;
			const id = ++n;
			const flick: Flick = {
				id,
				angle: Math.round((Math.atan2(Math.abs(dx), Math.abs(dy)) * 180) / Math.PI),
				finger: Math.round(Math.abs(dy)),
				speed: Math.round(speed * 100) / 100,
				glide: null,
				boost
			};
			flicks = [flick, ...flicks].slice(0, 8);
			const from = scrollY;
			gliding = true;
			lastScroll = performance.now();
			cancelAnimationFrame(watch);
			// The glide ends when the page has been still for 150 ms.
			const settle = () => {
				if (performance.now() - lastScroll > 150) {
					gliding = false;
					const glide = Math.round(Math.abs(scrollY - from));
					flicks = flicks.map((f) => (f.id === id ? { ...f, glide } : f));
					return;
				}
				watch = requestAnimationFrame(settle);
			};
			watch = requestAnimationFrame(settle);
		};
		addEventListener('scroll', onScroll, { passive: true });
		addEventListener('touchstart', touchstart, { passive: true });
		addEventListener('touchmove', touchmove, { passive: true });
		addEventListener('touchend', touchend, { passive: true });
		return () => {
			cancelAnimationFrame(watch);
			removeEventListener('scroll', onScroll);
			removeEventListener('touchstart', touchstart);
			removeEventListener('touchmove', touchmove);
			removeEventListener('touchend', touchend);
		};
	});
</script>

<div class="meter" aria-hidden="true">
	<div class="h">ANGLE · FINGER · SPEED · GLIDE · DPR {devicePixelRatio}</div>
	{#each flicks as f (f.id)}
		<div class:boost={f.boost}>
			{f.angle}° · {f.finger}px · {f.speed}px/ms · {f.glide ?? '…'}px{f.boost ? ' · BOOST' : ''}
		</div>
	{/each}
</div>

<style>
	.meter {
		position: fixed;
		top: 8px;
		left: 8px;
		z-index: 50;
		padding: 6px 8px;
		background: var(--scrim);
		color: var(--text-1);
		font: 500 11px/1.4 var(--font-mono);
		pointer-events: none;
	}
	.h {
		color: var(--text-2);
	}
	.boost {
		color: var(--accent);
	}
</style>

<script lang="ts">
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import Wordmark from './Wordmark.svelte';

	/**
	 * Leaving the app (Index Addendum, states blank and returnLib). When the
	 * page goes to the background it is covered at once with the graphite
	 * ground and the wordmark, so the recent-apps thumbnail has nothing on it.
	 * That is best effort -- Android may take its snapshot first, and a PWA
	 * can't block screenshots -- so nothing on screen claims otherwise.
	 *
	 * If reveal or incognito was on, a beacon ends both, and coming back lands
	 * on the library with reveal off, without a message. Otherwise the app
	 * comes back where it was. doc/PRIVACY.md has the rules.
	 */
	let { armed }: { armed: boolean } = $props();

	let blank = $state(false);
	/** Reveal or incognito was on when the page went away. */
	let ending = false;
	/**
	 * The page is being unloaded -- a reload, a full navigation, a form POST
	 * without JavaScript -- rather than put in the background. Unloading
	 * fires `pagehide` before `visibilitychange`, and ending reveal on every
	 * full navigation would make /incognito typed in search end /reveal.
	 */
	let unloading = false;

	$effect(() => {
		const leave = resolve('/leave');
		const change = async () => {
			if (document.visibilityState === 'hidden') {
				blank = true;
				if (armed && !unloading) {
					ending = true;
					navigator.sendBeacon(leave);
				}
				return;
			}
			if (!blank) return;
			if (ending) {
				ending = false;
				// The beacon may not have gone (offline, or the tab was frozen
				// first), so end both again before anything is drawn.
				await fetch(leave, { method: 'POST' }).catch(() => undefined);
				await goto(resolve('/'), { replaceState: true, invalidateAll: true });
			}
			blank = false;
		};
		const hide = () => (unloading = true);
		const show = () => {
			// Back from the bfcache: a fresh start, nothing to cover.
			unloading = false;
			blank = false;
		};
		document.addEventListener('visibilitychange', change);
		window.addEventListener('pagehide', hide);
		window.addEventListener('pageshow', show);
		return () => {
			document.removeEventListener('visibilitychange', change);
			window.removeEventListener('pagehide', hide);
			window.removeEventListener('pageshow', show);
		};
	});
</script>

{#if blank}
	<div class="blank" data-testid="privacy-blank"><Wordmark /></div>
{/if}

<style>
	.blank {
		position: fixed;
		inset: 0;
		z-index: 100;
		display: flex;
		align-items: center;
		justify-content: center;
		background: var(--surface-page);
		color: var(--text-1);
	}
</style>

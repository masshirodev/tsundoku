<script lang="ts">
	import Wordmark from './Wordmark.svelte';

	/**
	 * Leaving the app (Index Addendum, states blank and returnLib). When the
	 * page goes to the background it is covered at once with the graphite
	 * ground and the wordmark, so the recent-apps thumbnail has nothing on it.
	 * That is best effort -- Android may take its snapshot first, and a PWA
	 * can't block screenshots -- so nothing on screen claims otherwise.
	 *
	 * The cover is all it does: reveal and
	 * incognito survive a trip to another tab or app, and coming back lands
	 * where it left. END and HIDE AGAIN are how each one ends, and both are
	 * session cookies besides, so closing the browser does too. doc/PRIVACY.md
	 * has the rules.
	 */
	let blank = $state(false);

	$effect(() => {
		const change = () => {
			blank = document.visibilityState === 'hidden';
		};
		const show = () => {
			// Back from the bfcache: a fresh start, nothing to cover.
			blank = false;
		};
		document.addEventListener('visibilitychange', change);
		window.addEventListener('pageshow', show);
		return () => {
			document.removeEventListener('visibilitychange', change);
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

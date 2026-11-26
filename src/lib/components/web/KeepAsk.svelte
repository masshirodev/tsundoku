<script lang="ts">
	import { onMount } from 'svelte';
	import Banner from '$lib/components/chrome/Banner.svelte';
	import { askToKeep, keepAskBand, onFirstAdd, readKeep, type KeepState } from '$lib/web/keep';

	/**
	 * Keeping the library, after the first ADD (doc/WEB-EDITION.md, "Keeping
	 * the library"; handoff `web-edition-start`, `Keep-Ask`; c1123). Drawn
	 * under ADDED TO THE LIBRARY in the web edition only.
	 *
	 * Firefox asks the visitor itself, and only from a tap: a band offers it,
	 * with no ✕, gone when the screen is left or once asked. Chrome and Edge
	 * decide alone: they are asked at once and nothing is drawn; a no shows on
	 * SETTINGS. Once per browser (`onFirstAdd`).
	 */
	let keep = $state<KeepState | null>(null);
	let asking = $state(false);

	onMount(() => {
		void readKeep().then(async (k) => {
			keep = k;
			if (onFirstAdd(k) === 'silent') keep = await askToKeep();
		});
	});

	const words = $derived(keep ? keepAskBand(keep.browser) : null);

	async function ask() {
		asking = true;
		try {
			keep = await askToKeep();
		} finally {
			asking = false;
		}
	}
</script>

{#if keep && words && onFirstAdd(keep) === 'band'}
	<Banner kind="action" title={words.title} detail={words.detail}>
		{#snippet action()}
			<button type="button" onclick={ask} disabled={asking}>{words.action}</button>
		{/snippet}
	</Banner>
{/if}

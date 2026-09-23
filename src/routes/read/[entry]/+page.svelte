<script lang="ts">
	import ImageReader from './ImageReader.svelte';
	import TextReader from './TextReader.svelte';

	/**
	 * The reader: pages for manga, manhwa and doujinshi (doc/READER.md), text
	 * for novels (doc/TEXT-READER.md). The same route, so every ▶ in the app
	 * opens an entry without caring which it is.
	 */
	let { data } = $props();
</script>

{#if data.text}
	<TextReader {data} />
{:else}
	<ImageReader {data} />
{/if}

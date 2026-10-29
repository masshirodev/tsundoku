<script lang="ts">
	import ImageReader from './ImageReader.svelte';
	import TextReader from './TextReader.svelte';
	import VideoPlayer from './VideoPlayer.svelte';

	/**
	 * The reader: pages for manga, manhwa and doujinshi (doc/READER.md), text
	 * for novels (doc/TEXT-READER.md), the player for anime (doc/ANIME.md). The
	 * same route, so every ▶ in the app opens an entry without caring which it is.
	 */
	let { data } = $props();
</script>

{#if 'video' in data && data.video}
	{#key data.episodes[data.index].id}
		<VideoPlayer {data} />
	{/key}
{:else if data.text}
	<TextReader {data} />
{:else}
	<ImageReader {data} />
{/if}

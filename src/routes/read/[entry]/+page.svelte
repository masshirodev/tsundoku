<script lang="ts">
	import ImageReader from './ImageReader.svelte';
	import TextReader from './TextReader.svelte';
	import VideoPlayer from './VideoPlayer.svelte';
	import OnlineWait from './OnlineWait.svelte';

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
{:else if 'online' in data && data.online}
	<!-- A chapter read online (doc/READING-ONLINE.md): the page comes at once, the chapter streams in. -->
	{#await data.waiting}
		<OnlineWait {...data.wait} />
	{:then r}
		{#if r.ok}
			<!-- The layout's data and the chapter's, as a downloaded chapter's page has them. -->
			<ImageReader
				data={{ ...data, ...r.data, online: undefined, wait: undefined, waiting: undefined }}
			/>
		{:else}
			<OnlineWait {...data.wait} failed={r} />
		{/if}
	{/await}
{:else}
	<ImageReader {data} />
{/if}

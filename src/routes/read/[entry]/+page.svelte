<script lang="ts">
	import ImageReader from './ImageReader.svelte';
	import TextReader from './TextReader.svelte';
	import VideoPlayer from './VideoPlayer.svelte';
	import OnlineWait from './OnlineWait.svelte';
	import type { ComponentProps } from 'svelte';

	/**
	 * The reader: pages for manga, manhwa and doujinshi (doc/READER.md), text
	 * for novels (doc/TEXT-READER.md), the player for anime (doc/ANIME.md). The
	 * same route, so every ▶ in the app opens an entry without caring which it is.
	 */
	let { data } = $props();

	type Pages = ComponentProps<typeof ImageReader>['data'];
	type Online = Extract<typeof data, { online: true }>;
	type Answer = Awaited<Online['waiting']>;

	/**
	 * A chapter read online (doc/READING-ONLINE.md) comes in two steps: the page
	 * at once, the chapter's data when the source answers, which over a slow
	 * link is seconds. Each navigation brings a new `waiting`, a strip's
	 * crossing included. Waiting by throwing the reader away (as an
	 * `{#await}` did) put the waiting page up at every band and drew a new
	 * reader with an empty strip, which placed itself where the address said:
	 * scrolling up into the chapter before opened it at its start, and the
	 * next crossing landed a chapter off (c1158). So the reader stays: while
	 * the next chapter of the same series is on its way it keeps the data it
	 * has, as SvelteKit keeps a downloaded chapter's page until its load
	 * finishes, and takes the new data when it lands. The waiting page is for
	 * a first open, another series, and a source that failed.
	 */
	let answer = $state<{ for: Promise<Answer>; is: Answer } | null>(null);
	/** What the image reader shows now, kept across a navigation that is still waiting. */
	let shown = $state<Pages | null>(null);

	$effect(() => {
		if (!('online' in data) || !data.online) return;
		const waiting = data.waiting;
		let live = true;
		void waiting.then((is) => {
			if (live) answer = { for: waiting, is };
		});
		return () => {
			live = false;
		};
	});

	/** The online chapter's own answer, once it is this navigation's. */
	const settled = $derived(
		'online' in data && data.online && answer?.for === data.waiting ? answer.is : null
	);
	/** The image reader's data for this navigation, or null while it is still on its way. */
	const ready = $derived.by((): Pages | null => {
		if ('video' in data && data.video) return null;
		if (data.text) return null;
		if (!('online' in data) || !data.online) return data as Pages;
		return settled?.ok
			? ({
					...data,
					...settled.data,
					online: undefined,
					wait: undefined,
					waiting: undefined
				} as Pages)
			: null;
	});
	$effect(() => {
		if (ready) shown = ready;
	});
	/** The reader kept while the next chapter of the same series is on its way. */
	const kept = $derived(
		!ready && 'online' in data && data.online && !settled && shown?.series.id === data.wait.seriesId
			? shown
			: null
	);
</script>

{#if 'video' in data && data.video}
	{#key data.episodes[data.index].id}
		<VideoPlayer {data} />
	{/key}
{:else if data.text}
	<TextReader {data} />
{:else if ready ?? kept}
	<!-- One reader for downloaded and online chapters alike, so crossing from
	     one to the other keeps the strip too. -->
	<ImageReader data={(ready ?? kept)!} />
{:else if 'online' in data && data.online}
	<!-- A chapter read online, opened afresh or failed: the page comes at once,
	     the chapter streams in (doc/READING-ONLINE.md). -->
	<OnlineWait {...data.wait} failed={settled && !settled.ok ? settled : undefined} />
{/if}

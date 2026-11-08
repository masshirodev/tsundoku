<script lang="ts">
	import { resolve } from '$app/paths';
	import TopBar from '$lib/components/chrome/TopBar.svelte';
	import StartList from '$lib/components/start/StartList.svelte';
	import { countLine, readLeads } from '$lib/library/start';
	import { pollStart, trail } from '$lib/start-trail.svelte';
	import { m } from '$lib/paraglide/messages';

	/**
	 * GET STARTED, a page of its own (doc/ONBOARDING.md; the handoff's
	 * Start-Phone board): the empty library's list, reachable from HELP's first
	 * topic and the sidebar on any install, finished or not. Arriving here ends
	 * a trip (the way back has done its job).
	 */
	let { data } = $props();
	$effect(() => trail.end());
	// A step ticked elsewhere (a phone pairing, a download) shows here without a
	// reload, until the list is finished (c722; doc/ONBOARDING.md).
	const open = $derived(!!data.start && !data.start.finished);
	$effect(() => {
		if (open) return pollStart();
	});
	const leads = $derived(!!data.start && !data.start.finished && readLeads(data.start));
</script>

<svelte:head><title>{m.start_page_doc_title()}</title></svelte:head>

<div class="start-page">
	<TopBar label={m.start_page_label()}>
		{#snippet left()}
			<a class="back" href={resolve('/')}
				><span class="arrow">←</span><span>{m.start_back_library()}</span></a
			>
		{/snippet}
		{#snippet middle()}
			<div class="title">
				<h1>{m.name_get_started()}</h1>
				<span>{m.start_page_help_ref()}</span>
			</div>
		{/snippet}
	</TopBar>

	{#if data.start}
		<section class="ob" aria-label={m.start_page_label()}>
			<div class="ob-head">
				<div class="k">{leads ? m.start_head_read() : m.start_head()}</div>
				<div class="k">
					<span class="long">{countLine(data.start)}</span><span class="short"
						>{countLine(data.start, true)}</span
					>
				</div>
			</div>
			<h2>
				{data.start.finished
					? m.start_page_title_finished()
					: leads
						? m.start_read_title()
						: m.start_page_title_open()}
			</h2>
			<p class="lede">{leads ? m.start_read_lede() : m.start_page_lede()}</p>
			<div class="list">
				<StartList
					view={data.start}
					libraryRoot={data.libraryRoot}
					extras={data.firstRead}
					imported={data.imported}
				/>
			</div>
			<p class="kept">{m.start_page_kept()}</p>
		</section>
	{/if}
</div>

<style>
	.back {
		display: flex;
		align-items: center;
		gap: 14px;
		padding: 0 var(--pad);
		border-right: var(--hairline);
		color: var(--text-1);
		font: 500 14px var(--font-mono);
		letter-spacing: 0.04em;
		text-decoration: none;
	}
	.arrow {
		font-size: 17px;
	}
	.title {
		display: flex;
		flex-direction: column;
		justify-content: center;
		gap: 3px;
		padding: 0 20px;
	}
	.title h1 {
		margin: 0;
		font: 500 14px var(--font-mono);
	}
	.title span {
		font: 400 12px var(--font-mono);
		color: var(--text-2);
	}
	/* The checklist's frame (ob.css .ob), as on the empty library. */
	.ob {
		display: flex;
		flex-direction: column;
		max-width: 980px;
		padding: 48px 64px 56px;
	}
	.ob-head {
		display: flex;
		justify-content: space-between;
		align-items: baseline;
		gap: 12px;
		margin-bottom: 18px;
	}
	.k {
		font: 500 12px/1.2 var(--font-mono);
		letter-spacing: 0.06em;
		color: var(--text-2);
	}
	h2 {
		margin: 0;
		font: 500 34px/1.2 var(--font-sans);
	}
	.lede {
		margin: 14px 0 0;
		max-width: 680px;
		font: 400 18px/1.5 var(--font-sans);
		color: var(--text-2);
		text-wrap: pretty;
	}
	.list {
		margin-top: 32px;
	}
	.short {
		display: none;
	}
	.kept {
		margin: 20px 0 0;
		font: 400 12px/1.5 var(--font-mono);
		color: var(--text-2);
	}
	@media (max-width: 599px) {
		.back span:last-child {
			display: none;
		}
		.ob {
			padding: 18px 0 24px;
		}
		.ob-head {
			padding: 0 16px;
			margin-bottom: 12px;
		}
		h2,
		.lede {
			display: none;
		}
		.list {
			margin-top: 0;
		}
		.kept {
			padding: 0 16px;
		}
		.long {
			display: none;
		}
		.short {
			display: inline;
		}
	}
</style>

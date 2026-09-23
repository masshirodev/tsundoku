<script lang="ts">
	import '$lib/styles/index.css';
	import { enhance } from '$app/forms';
	import { page } from '$app/state';
	import Banner from '$lib/components/chrome/Banner.svelte';
	import Wordmark from '$lib/components/chrome/Wordmark.svelte';
	import ShelfTabs from '$lib/components/controls/ShelfTabs.svelte';
	import { shelfHref } from '$lib/library/links';

	let { data, children } = $props();

	const activeShelf = $derived(page.url.searchParams.get('shelf') ?? (data.scan ? 'new' : 'all'));
</script>

<svelte:head>
	<meta name="theme-color" content={data.theme === 'light' ? '#f5f4ef' : '#0e0f10'} />
</svelte:head>

<div class="app" class:revealed={data.reveal}>
	{#if page.url.pathname !== '/login'}
		<!--
			The desktop sidebar. Rendered on every device and shown only on a
			desktop, so the server can send it without knowing the screen.
		-->
		<aside class="sidebar" aria-label="Shelves">
			<div class="brand"><Wordmark size={17} /></div>
			<div class="side-label">SHELVES</div>
			<ShelfTabs
				vertical
				shelves={data.shelves}
				active={activeShelf}
				href={(k) => shelfHref(page.url, k)}
			/>
			<div class="spacer"></div>
			<!-- Neither screen exists yet; see doc/LIBRARY.md, "What it does not do yet". -->
			<div class="side-foot">
				<span aria-disabled="true">IMPORT LOG</span>
				<span aria-disabled="true">SETTINGS</span>
			</div>
		</aside>
	{/if}

	<div class="main">
		{#if data.reveal}
			<Banner kind="reveal" title="HIDDEN SHOWN">
				{#snippet action()}
					<form method="POST" action="/?/command" use:enhance>
						<input type="hidden" name="command" value="hide" />
						<button type="submit">HIDE AGAIN</button>
					</form>
				{/snippet}
			</Banner>
		{/if}
		{@render children()}
	</div>

	{#if data.reveal}
		<!-- The 4px magenta frame: on every screen for as long as reveal is on. -->
		<div class="reveal-frame" aria-hidden="true"></div>
	{/if}
</div>

<style>
	.app {
		display: flex;
		min-height: 100dvh;
	}
	/* The reveal banner's height, for screens that size themselves to the viewport. */
	.app.revealed {
		--banner-h: 52px;
	}
	.main {
		flex: 1;
		min-width: 0;
		display: flex;
		flex-direction: column;
	}
	.sidebar {
		display: none;
	}
	@media (min-width: 1024px) and (pointer: fine) {
		.sidebar {
			position: sticky;
			top: 0;
			height: 100dvh;
			width: var(--sidebar-w);
			flex-shrink: 0;
			border-right: var(--hairline);
			display: flex;
			flex-direction: column;
			overflow-y: auto;
		}
	}
	.brand {
		display: flex;
		align-items: center;
		height: 64px;
		padding: 0 24px;
		border-bottom: var(--hairline);
		flex-shrink: 0;
	}
	.side-label {
		padding: 20px 24px 10px;
		font: 500 12px var(--font-mono);
		color: var(--text-2);
		letter-spacing: var(--tracking-label);
	}
	.spacer {
		flex: 1;
	}
	.side-foot {
		display: flex;
		flex-direction: column;
		border-top: var(--hairline);
	}
	.side-foot span {
		display: flex;
		align-items: center;
		height: 48px;
		padding: 0 24px;
		font: 500 13px var(--font-mono);
		color: var(--text-2);
	}
	.side-foot span + span {
		border-top: var(--hairline);
	}
	.reveal-frame {
		position: fixed;
		inset: 0;
		box-shadow: var(--reveal-frame);
		pointer-events: none;
		z-index: 30;
	}
</style>

<script lang="ts">
	import { enhance } from '$app/forms';
	import { resolve } from '$app/paths';
	import TopBar from '$lib/components/chrome/TopBar.svelte';

	/**
	 * SETTINGS (Editions 1e; doc/SETTINGS.md): what the library does on every
	 * device. Its first section is the language a folded book opens in.
	 */
	let { data } = $props();
</script>

<svelte:head><title>Settings · tsundoku</title></svelte:head>

<div class="settings">
	<TopBar label="Settings">
		{#snippet left()}
			<a class="back" href={resolve('/')}><span class="arrow">←</span><span>LIBRARY</span></a>
		{/snippet}
		{#snippet middle()}
			<h1 class="title">SETTINGS</h1>
		{/snippet}
	</TopBar>

	<section aria-labelledby="langs">
		<div class="section">
			<h2 id="langs">01 — BOOKS IN SEVERAL LANGUAGES</h2>
			<span>{data.folded} FOLDED</span>
		</div>
		<form method="POST" action="?/language" use:enhance class="row">
			<div class="label">OPENS IN</div>
			<div class="seg">
				{#each data.choices as l (l)}
					<button
						type="submit"
						name="language"
						value={l}
						class:on={l === data.preferred}
						aria-pressed={l === data.preferred}>{l.toUpperCase()}</button
					>
				{/each}
			</div>
		</form>
		<div class="notes">
			<p>A FOLDED BOOK OPENS IN THIS LANGUAGE.</p>
			<p>WITHOUT AN EDITION IN IT, IT OPENS IN THE ONE LAST READ.</p>
			<p>
				A BOOK’S OWN LANGUAGE ROW OVERRIDES THIS{data.overridden > 0
					? ` · ${data.overridden} BOOK${data.overridden === 1 ? '' : 'S'} DO${data.overridden === 1 ? 'ES' : ''}`
					: ''}
			</p>
		</div>
	</section>
</div>

<style>
	.settings {
		display: flex;
		flex-direction: column;
		min-height: 100dvh;
		background: var(--surface-page);
		color: var(--text-1);
		--pad: 24px;
	}
	.back {
		display: flex;
		align-items: center;
		gap: 14px;
		padding: 0 var(--pad);
		color: var(--text-1);
		font: 500 14px var(--font-mono);
		letter-spacing: 0.04em;
		text-decoration: none;
	}
	.arrow {
		font-size: 17px;
	}
	.title {
		margin: 0;
		padding: 0 18px;
		font: 500 13px var(--font-mono);
		letter-spacing: 0.06em;
		color: var(--text-2);
	}
	.section {
		display: flex;
		justify-content: space-between;
		gap: 12px;
		padding: 24px var(--pad) 12px;
		font: 500 13px/1.2 var(--font-mono);
		letter-spacing: 0.06em;
		color: var(--text-2);
	}
	h2 {
		margin: 0;
		font: inherit;
	}
	.row {
		display: flex;
		align-items: stretch;
		min-height: 64px;
		border-top: 1px solid var(--line-1);
		border-bottom: 1px solid var(--line-1);
	}
	.label {
		display: flex;
		align-items: center;
		width: 120px;
		flex-shrink: 0;
		padding-left: var(--pad);
		border-right: 1px solid var(--line-1);
		font: 500 12px var(--font-mono);
		letter-spacing: 0.06em;
		color: var(--text-2);
	}
	.seg {
		flex: 1;
		display: flex;
		min-width: 0;
	}
	.seg button {
		flex: 1;
		min-width: 0;
		border: 0;
		border-right: 1px solid var(--line-1);
		border-radius: 0;
		background: transparent;
		color: var(--text-1);
		font: 500 14px var(--font-mono);
		cursor: pointer;
	}
	.seg button:last-child {
		border-right: 0;
	}
	.seg button.on {
		background: var(--surface-inverse);
		color: var(--text-inverse);
	}
	.seg button:active:not(.on) {
		background: var(--surface-inverse);
		color: var(--text-inverse);
	}
	.notes {
		display: flex;
		flex-direction: column;
		gap: 8px;
		padding: 16px var(--pad);
		font: 400 13px/1.45 var(--font-mono);
		color: var(--text-2);
	}
	.notes p {
		margin: 0;
	}
	/* The phone: four languages in a row don't fit their names; they wrap into two. */
	@media (max-width: 599px) {
		.settings {
			--pad: 16px;
		}
		.label {
			width: 96px;
		}
		.seg {
			flex-wrap: wrap;
		}
		.seg button {
			flex: 1 1 50%;
			min-height: 56px;
			font-size: 13px;
			border-bottom: 1px solid var(--line-1);
		}
	}
</style>

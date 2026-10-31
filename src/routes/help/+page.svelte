<script lang="ts">
	import { resolve } from '$app/paths';
	import TopBar from '$lib/components/chrome/TopBar.svelte';
	import { TOPICS, notHere } from '$lib/help/topics';

	/**
	 * HELP (doc/HELP.md; card c208; the HELP handoff, board 1B): seven topics,
	 * each row naming its parts, so there's nothing to search. 01 counts the
	 * checklist; a topic that can't apply here says NOT HERE, and still opens.
	 */
	let { data } = $props();
	const metaOf = (slug: string, meta: string) =>
		slug === 'start' && data.start
			? `${meta} · ${data.start.done + data.start.skipped} OF ${data.start.steps.length}`
			: notHere(slug, data.place)
				? `${meta} · NOT HERE`
				: meta;
</script>

<svelte:head><title>Help · tsundoku</title></svelte:head>

<div class="help">
	<TopBar label="Help">
		{#snippet left()}
			<a class="back" href={resolve('/')}><span class="arrow">←</span><span>LIBRARY</span></a>
		{/snippet}
		{#snippet middle()}
			<h1 class="title">HELP</h1>
		{/snippet}
	</TopBar>

	<div class="body">
		<div class="lab"><span>01 — TOPICS</span><span>{TOPICS.length}</span></div>
		<nav aria-label="Topics" class="topics">
			{#each TOPICS as t (t.slug)}
				<a
					class="topic"
					href={t.slug === 'start'
						? resolve('/start')
						: resolve('/help/[topic]', { topic: t.slug })}
				>
					<span class="n">{t.n}</span>
					<span class="tx"
						><span class="t">{t.title}</span><span class="m">{metaOf(t.slug, t.meta)}</span></span
					>
					<span class="go" aria-hidden="true">→</span>
				</a>
			{/each}
		</nav>
		<div class="lab stuck-lab">02 — STILL STUCK</div>
		<div class="stuck">
			<div class="s">Save a report and send it to whoever gave you tsundoku.</div>
			<a href={resolve('/help/[topic]', { topic: 'report' })}>07 →</a>
		</div>
	</div>
</div>

<style>
	/* The HELP handoff's phone list (1B), at every width inside a column. */
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
		margin: 0;
		display: flex;
		align-items: center;
		padding: 0 16px;
		font: 500 13px var(--font-mono);
		letter-spacing: 0.06em;
		color: var(--text-2);
	}
	.body {
		max-width: 880px;
	}
	.lab {
		display: flex;
		justify-content: space-between;
		padding: 20px 16px 12px;
		font: 500 13px var(--font-mono);
		letter-spacing: 0.06em;
		color: var(--text-2);
	}
	@media (min-width: 600px) {
		.lab {
			padding: 24px 24px 12px;
		}
	}
	.topic {
		display: flex;
		align-items: stretch;
		min-height: 72px;
		border-top: var(--hairline);
		color: var(--text-1);
		text-decoration: none;
	}
	.topic:last-child {
		border-bottom: var(--hairline);
	}
	.topic .n {
		width: 48px;
		flex-shrink: 0;
		display: flex;
		align-items: center;
		justify-content: center;
		border-right: var(--hairline);
		font: 500 13px var(--font-mono);
		color: var(--text-2);
	}
	.tx {
		flex: 1;
		min-width: 0;
		display: flex;
		flex-direction: column;
		justify-content: center;
		gap: 4px;
		padding: 10px 12px 10px 14px;
	}
	.tx .t {
		font: 500 15px/1.3 var(--font-sans);
	}
	.tx .m {
		font: 400 12px/1.4 var(--font-mono);
		color: var(--text-2);
	}
	.go {
		width: 40px;
		flex-shrink: 0;
		display: flex;
		align-items: center;
		justify-content: center;
		font: 500 15px var(--font-mono);
		color: var(--text-2);
	}
	.topic:active {
		background: var(--surface-inverse);
		color: var(--text-inverse);
	}
	.stuck {
		display: flex;
		align-items: stretch;
		background: var(--surface-panel);
		border-top: var(--hairline);
		border-bottom: var(--hairline);
	}
	.stuck .s {
		flex: 1;
		padding: 14px 16px;
		font: 400 15px/1.45 var(--font-sans);
	}
	.stuck a {
		display: flex;
		align-items: center;
		padding: 0 16px;
		border-left: var(--hairline);
		color: var(--text-1);
		font: 500 13px var(--font-mono);
		text-decoration: none;
	}
	@media (max-width: 599px) {
		.back span:last-child {
			display: none;
		}
	}
</style>

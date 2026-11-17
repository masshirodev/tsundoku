<script lang="ts">
	import { resolve } from '$app/paths';
	import TopBar from '$lib/components/chrome/TopBar.svelte';
	import InShort from '$lib/components/help/InShort.svelte';
	import { neighbours, notHere, topicBySlug, topics, type HelpTopic } from '$lib/help/topics';
	import { num, upper } from '$lib/i18n/format';
	import { m } from '$lib/paraglide/messages';

	/**
	 * A HELP topic (doc/HELP.md): its number, title and parts, IN SHORT, then
	 * each part, numbered as SETTINGS' sections are, with a link to its screen.
	 * It ends with ← and → between topics and STILL STUCK. On a wide screen the
	 * topics' index sits beside it.
	 */
	let { data } = $props();
	const all = $derived(topics());
	const topic = $derived(topicBySlug(data.slug)!);
	const near = $derived(neighbours(data.slug));
	const band = $derived(notHere(data.slug, data.place));
	const partsLine = $derived(
		m.help_parts_line({
			count: topic.parts.length,
			n: num(topic.parts.length),
			titles: topic.parts.map((p) => p.title).join(' · ')
		})
	);
	const hrefOf = (t: HelpTopic) =>
		t.slug === 'start' ? resolve('/start') : resolve('/help/[topic]', { topic: t.slug });
	const idxMeta = (t: HelpTopic) =>
		t.slug === 'start' && data.start
			? m.help_index_count({
					done: num(data.start.done + data.start.skipped),
					total: num(data.start.steps.length)
				})
			: notHere(t.slug, data.place)
				? m.help_not_here()
				: '';
</script>

<svelte:head><title>{m.help_topic_doc_title({ title: topic.title })}</title></svelte:head>

<div class="help">
	<TopBar label={m.help_label()}>
		{#snippet left()}
			<a class="back" href={resolve('/help')}
				><span class="arrow">←</span><span>{m.name_help()}</span></a
			>
		{/snippet}
		{#snippet middle()}
			<h1 class="title">{m.name_help()} · {topic.n}</h1>
		{/snippet}
		{#snippet right()}
			<span class="count">{m.help_topic_count({ count: all.length, n: num(all.length) })}</span>
		{/snippet}
	</TopBar>

	<div class="frame">
		<nav aria-label={m.help_topics_label()} class="index">
			{#each all as t (t.slug)}
				<a href={hrefOf(t)} aria-current={t.slug === topic.slug ? 'page' : undefined}
					><span>{t.n} {upper(t.title)}</span><span class="im">{idxMeta(t)}</span></a
				>
			{/each}
		</nav>

		<article>
			<header>
				<div class="k">{topic.n} — {upper(topic.title)}</div>
				<h2>{topic.title}</h2>
				<div class="parts-line">{partsLine}</div>
			</header>
			{#if band}
				<div class="not-here" role="note">
					<div class="a">{band.a}</div>
					<div class="b">{band.b}</div>
				</div>
			{/if}
			<InShort lines={topic.short} pointer={topic.pointer} />

			{#each topic.parts as p, i (p.id)}
				<div class="part-lab" id={p.id}>
					<h3>{String(i + 1).padStart(2, '0')} — {p.title}</h3>
					{#if p.link}
						<!-- eslint-disable-next-line svelte/no-navigation-without-resolve -- topics' links are fixed app paths -->
						<a href={p.link.href}>{p.link.label}</a>
					{:else if p.right}<span>{p.right}</span>{/if}
				</div>
				{#each p.paras ?? [] as para, j (j)}<p>{para}</p>{/each}
				{#if p.table}
					<div class="table">
						{#each p.table as [w, what] (w)}
							<div class="tr">
								<div class="tw">{w}</div>
								<div class="td">{what}</div>
							</div>
						{/each}
					</div>
				{/if}
			{/each}

			<nav aria-label={m.help_near_label()} class="near">
				{#if near.prev}
					<a href={hrefOf(near.prev)}>← {near.prev.n} {near.prev.word}</a>
				{:else}<span></span>{/if}
				{#if near.next}
					<a class="next" href={hrefOf(near.next)}>{near.next.n} {near.next.word} →</a>
				{:else}<span></span>{/if}
			</nav>
			{#if topic.slug !== 'report'}
				<div class="stuck">
					<div class="st">
						<div class="sk">{m.help_still_stuck()}</div>
						<div class="ss">{m.help_still_stuck_body()}</div>
					</div>
					<a href={resolve('/help/[topic]', { topic: 'report' })}>{m.help_when_it_breaks()}</a>
				</div>
			{:else}
				<div class="stuck">
					<div class="st">
						<div class="sk">{m.help_the_report()}</div>
						<div class="ss">
							{m.help_the_report_body({
								settings: m.name_settings(),
								library: m.name_library_section()
							})}
						</div>
					</div>
					<a href="{resolve('/settings')}?section=library">{m.help_save()}</a>
				</div>
			{/if}
		</article>
	</div>
</div>

<style>
	/* The design's topic page, transcribed; colours are tokens. */
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
		padding: 0 18px;
		font: 500 13px var(--font-mono);
		letter-spacing: 0.06em;
		color: var(--text-2);
	}
	.count {
		display: flex;
		align-items: center;
		padding: 0 24px;
		border-left: var(--hairline);
		font: 500 12px var(--font-mono);
		letter-spacing: 0.04em;
		color: var(--text-2);
	}
	.frame {
		display: flex;
	}
	.index {
		width: 232px;
		flex-shrink: 0;
		align-self: flex-start;
		display: flex;
		flex-direction: column;
	}
	.index a {
		display: flex;
		justify-content: space-between;
		align-items: center;
		gap: 8px;
		min-height: 52px;
		padding: 0 20px;
		border-bottom: var(--hairline);
		color: var(--text-1);
		text-decoration: none;
		font: 500 13px/1.3 var(--font-mono);
		letter-spacing: 0.04em;
	}
	.index .im {
		white-space: nowrap;
		font-weight: 400;
		color: var(--text-2);
	}
	.index a[aria-current='page'] {
		background: var(--surface-inverse);
		color: var(--text-inverse);
	}
	.index a[aria-current='page'] .im {
		color: var(--text-inverse);
	}
	article {
		flex: 1;
		max-width: 880px;
		min-width: 0;
		display: flex;
		flex-direction: column;
		border-left: var(--hairline);
		border-right: var(--hairline);
		--pad-x: 24px;
	}
	header {
		padding: 32px var(--pad-x) 24px;
	}
	.k {
		font: 500 13px var(--font-mono);
		letter-spacing: 0.06em;
		color: var(--text-2);
	}
	h2 {
		margin: 12px 0 0;
		font: 500 30px/1.25 var(--font-sans);
	}
	.parts-line {
		margin-top: 10px;
		font: 400 12px/1.4 var(--font-mono);
		letter-spacing: 0.04em;
		color: var(--text-2);
	}
	.not-here {
		display: flex;
		flex-direction: column;
		gap: 4px;
		margin: 0 var(--pad-x) 24px;
		padding: 12px 16px;
		border: 1px dashed var(--line-2);
	}
	.not-here .a {
		font: 500 13px var(--font-mono);
		letter-spacing: 0.04em;
	}
	.not-here .b {
		font: 400 12px/1.45 var(--font-mono);
		color: var(--text-2);
	}
	.part-lab {
		display: flex;
		justify-content: space-between;
		align-items: baseline;
		gap: 12px;
		padding: 32px var(--pad-x) 12px;
		font: 500 13px/1.2 var(--font-mono);
		letter-spacing: 0.06em;
		color: var(--text-2);
		scroll-margin-top: 16px;
	}
	.part-lab h3 {
		margin: 0;
		font: inherit;
	}
	.part-lab a {
		color: var(--text-1);
		text-decoration: underline;
		text-underline-offset: 3px;
		letter-spacing: 0.04em;
		white-space: nowrap;
	}
	.part-lab span {
		white-space: nowrap;
	}
	article p {
		margin: 0 0 12px;
		padding: 0 var(--pad-x);
		max-width: 64ch;
		font: 400 16px/1.6 var(--font-sans);
		color: var(--text-prose);
		text-wrap: pretty;
	}
	.table {
		margin-bottom: 12px;
		border-top: var(--hairline);
	}
	.tr {
		display: flex;
		min-height: 60px;
		border-bottom: var(--hairline);
	}
	.tw {
		display: flex;
		align-items: center;
		width: 132px;
		flex-shrink: 0;
		box-sizing: border-box;
		padding-left: var(--pad-x);
		border-right: var(--hairline);
		font: 500 12px var(--font-mono);
		letter-spacing: 0.06em;
		color: var(--text-2);
	}
	.td {
		flex: 1;
		display: flex;
		align-items: center;
		padding: 12px 18px;
		font: 400 15px/1.45 var(--font-sans);
	}
	.near {
		display: flex;
		height: 64px;
		margin-top: 32px;
		border-top: var(--hairline);
		font: 500 14px var(--font-mono);
		letter-spacing: 0.04em;
	}
	.near > * {
		flex: 1;
		display: flex;
		align-items: center;
		padding: 0 var(--pad-x);
		color: var(--text-1);
		text-decoration: none;
	}
	.near > :first-child {
		border-right: var(--hairline);
	}
	.near .next {
		justify-content: flex-end;
	}
	.stuck {
		display: flex;
		align-items: stretch;
		background: var(--surface-panel);
		border-top: var(--hairline);
		border-bottom: var(--hairline);
	}
	.st {
		flex: 1;
		display: flex;
		flex-direction: column;
		justify-content: center;
		gap: 5px;
		padding: 14px var(--pad-x);
	}
	.sk {
		font: 500 12px var(--font-mono);
		letter-spacing: 0.06em;
		color: var(--text-2);
	}
	.ss {
		font: 400 15px/1.45 var(--font-sans);
	}
	.stuck a {
		display: flex;
		align-items: center;
		padding: 0 24px;
		border-left: var(--hairline);
		color: var(--text-1);
		font: 500 13px var(--font-mono);
		letter-spacing: 0.04em;
		text-decoration: none;
		white-space: nowrap;
	}
	/* Narrower than the index and a topic side by side: the topic alone. */
	@media (max-width: 1023px) {
		.index {
			display: none;
		}
		article {
			border-left: 0;
			border-right: 0;
		}
	}
	@media (max-width: 599px) {
		article {
			--pad-x: 16px;
		}
		.count {
			display: none;
		}
		.tw {
			width: 84px;
			padding-left: var(--pad-x);
		}
		.td {
			padding: 10px 14px;
		}
		.stuck a {
			padding: 0 16px;
		}
	}
</style>

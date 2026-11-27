<!--
	A refusal of the reader's own network where tsundoku meets it (c1156;
	handoff `fetcher-options`, revision 1): REPOSITORIES (compact) and a
	source's page. Three cases:
	- the host the page asked for: ALLOW <host:port>, which asks the fetcher,
	  whose window the reader answers; on yes, `onallowed` retries;
	- a redirect or an answer that landed on the reader's network: where it
	  was sent, and nothing to allow (tsundoku won't ask for a redirect);
	- a proxy: refusals for two or more sites all answered from one address,
	  ALLOW <address> on every port.
	The host stays in its own case inside the uppercase chrome, so the reader
	can type it as shown.
-->
<script lang="ts">
	import { m } from '$lib/paraglide/messages';
	import { askToAllow, ownNetwork } from '$lib/web/own-network.svelte';
	import type { Refused } from '$lib/web/refusals';

	let {
		refused,
		proxy = null,
		name = '',
		compact = false,
		onallowed
	}: {
		refused: Refused;
		/** A proxy on the reader's network, if the refusals show one. */
		proxy?: { address: string; hosts: string[] } | null;
		/** The source's name, for the prose; empty on REPOSITORIES. */
		name?: string;
		compact?: boolean;
		onallowed: (entry: string) => void;
	} = $props();

	const asProxy = $derived(
		!!proxy && !!refused.answeredFrom && proxy.address === refused.answeredFrom
	);
	const target = $derived(
		asProxy ? { host: proxy!.address, port: undefined } : { host: refused.host, port: refused.port }
	);
	const shown = $derived(target.port ? `${target.host}:${target.port}` : target.host);
	const offered = $derived(asProxy || refused.asked);

	let asking = $state(false);
	let note = $state<string | null>(null);

	async function allow() {
		if (asking) return;
		asking = true;
		note = null;
		// Read before the answer: forgetting the refusal below takes this block
		// off the screen, and a removed component's props are not to be read.
		const { host, port } = target;
		const entry = shown;
		const done = onallowed;
		const answer = await askToAllow(host, port);
		asking = false;
		if (answer === 'no-fetcher') return void (note = m.own_network_no_fetcher());
		if (answer.allowed) {
			// The retry first, then forget what it answered, so nothing goes on
			// offering ALLOW; a reload has not left the page yet when this runs.
			done(entry);
			ownNetwork.forget(host);
			return;
		}
		note = {
			cancelled: m.own_network_cancelled(),
			declined: m.own_network_declined(),
			busy: m.own_network_busy(),
			'no-press': m.own_network_no_press(),
			'not-local': m.own_network_cancelled()
		}[answer.why];
	}
</script>

{#snippet actions(quiet: string)}
	<div class="acts">
		{#if offered}
			<button type="button" class="allow" disabled={asking} onclick={allow}
				>{#if asking}{m.own_network_answer_in_window()}{:else}{m.own_network_allow()}
					<span class="host">{shown}</span>{/if}</button
			>
		{/if}
		<div class="q" class:alone={!offered} role="status">{note ?? quiet}</div>
	</div>
{/snippet}

{#if compact}
	<section class="found" aria-label={m.own_network_label()}>
		{#if offered}
			<div class="fa">{m.own_network_label()} · <span class="host">{shown}</span></div>
			<div class="fb">{m.own_network_repo_detail()}</div>
			{@render actions(m.own_network_only_you())}
		{:else}
			<div class="fa">{m.own_network_sent_label()} · <span class="host">{refused.host}</span></div>
			{@render actions(m.own_network_sent_nothing({ from: refused.from ?? '' }))}
		{/if}
	</section>
{:else if asProxy}
	<section class="found big" aria-label={m.own_network_proxy_label()}>
		<div class="head">
			<span>00 — {m.own_network_proxy_label()}</span><span class="host"
				>{m.own_network_proxy_from({ address: target.host })}</span
			>
		</div>
		<div class="bb">
			<h2>{m.own_network_proxy_title({ address: target.host })}</h2>
			<p>
				{m.own_network_proxy_prose({
					address: target.host,
					hosts: proxy!.hosts.slice(0, 2).join(', ')
				})}
			</p>
		</div>
		{@render actions(m.own_network_proxy_note())}
	</section>
{:else if offered}
	<section class="found big" aria-label={m.own_network_label()}>
		<div class="head">
			<span>00 — {m.own_network_label()}</span><span class="host">{shown}</span>
		</div>
		<div class="bb">
			<h2>{m.own_network_title({ host: refused.host })}</h2>
			<p>{m.own_network_prose({ name })}</p>
		</div>
		{@render actions(m.own_network_only_you())}
	</section>
{:else}
	<section class="found big" aria-label={m.own_network_sent_label()}>
		<div class="head">
			<span>00 — {m.own_network_sent_label()}</span><span class="host">{refused.host}</span>
		</div>
		<div class="bb">
			<h2>{m.own_network_sent_title({ name, host: refused.host })}</h2>
			<p>{m.own_network_sent_prose({ from: refused.from ?? '' })}</p>
		</div>
		{@render actions(m.own_network_sent_nothing({ from: refused.from ?? '' }))}
	</section>
{/if}

<style>
	.found {
		margin: 0 var(--pad);
		border: var(--hairline);
		border-top: 0;
		background: var(--surface-panel);
		box-shadow: inset 3px 0 0 var(--text-1);
	}
	.found.big {
		margin-top: 18px;
		border-top: var(--hairline);
	}
	.fa {
		padding: 12px 18px 0;
		font: 500 14px/1.3 var(--font-mono);
	}
	.fb {
		padding: 6px 18px 12px;
		font: 400 13px/1.4 var(--font-mono);
		color: var(--text-2);
	}
	.host {
		text-transform: none;
		color: var(--text-1);
		letter-spacing: 0;
	}
	.head {
		display: flex;
		justify-content: space-between;
		gap: 12px;
		padding: 14px 18px 0;
		font: 500 13px/1.3 var(--font-mono);
		letter-spacing: 0.06em;
		color: var(--text-2);
	}
	.bb {
		padding: 10px 18px 18px;
	}
	h2 {
		margin: 0;
		font: 500 20px/1.3 var(--font-sans);
	}
	p {
		margin: 8px 0 0;
		max-width: 62ch;
		font: 400 15px/1.55 var(--font-sans);
		color: var(--text-prose);
	}
	.acts {
		display: flex;
		align-items: stretch;
		min-height: var(--hit-row);
		border-top: var(--hairline);
	}
	.allow {
		display: flex;
		align-items: center;
		gap: 0.6ch;
		padding: 0 var(--pad);
		border: 0;
		border-radius: 0;
		background: var(--accent);
		color: var(--on-accent);
		font: 500 14px var(--font-mono);
		white-space: nowrap;
		cursor: pointer;
	}
	.allow .host {
		color: inherit;
	}
	.allow:disabled {
		background: var(--line-1);
		color: var(--text-1);
		cursor: default;
	}
	.q {
		flex: 1;
		display: flex;
		align-items: center;
		padding: 8px 18px;
		border-left: var(--hairline);
		font: 400 13px/1.4 var(--font-mono);
		color: var(--text-2);
	}
	.q.alone {
		border-left: 0;
	}
	@media (max-width: 600px) {
		.acts {
			flex-direction: column;
		}
		.allow {
			min-height: var(--hit-row);
			justify-content: center;
		}
		.q {
			border-left: 0;
			border-top: var(--hairline);
		}
	}
</style>

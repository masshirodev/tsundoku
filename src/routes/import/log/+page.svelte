<script lang="ts">
	import { untrack } from 'svelte';
	import { invalidateAll } from '$app/navigation';
	import { page } from '$app/state';
	import { resolve } from '$app/paths';
	import TopBar from '$lib/components/chrome/TopBar.svelte';
	import { clock, dayMonth, n, refusalLines, sizeWords } from '$lib/import/backup-preview';
	import type { LogEntry } from '$lib/server/import/log';
	import HiddenFold from '../HiddenFold.svelte';

	/**
	 * The IMPORT LOG: every import of a backup and every scan, newest first,
	 * one running or waiting at the top with its bar. Counts follow reveal (the
	 * server counts through `series`), and what reveal leaves out is counted
	 * apart, in `HiddenFold`. An entry opens in place; a running one asks again
	 * every second.
	 */
	let { data } = $props();
	// `?open=backup:<id>` (or `scan:<id>`) opens that entry on arrival: GET
	// STARTED's 03, done by an import, links its entry here.
	// `?job=<scan job id>` opens the entry of that job, a
	// scan's or a backup's, which is all the library's band knows of it.
	const job = Number(page.url.searchParams.get('job'));
	// Read once, on arrival: later polls must not reopen what was closed.
	const ofJob = untrack(() =>
		data.entries.find((e) =>
			e.kind === 'scan' ? e.id === job : e.jobId !== null && e.jobId === job
		)
	);
	let open = $state<string | null>(
		page.url.searchParams.get('open') ?? (ofJob ? `${ofJob.kind}:${ofJob.id}` : null)
	);
	const key = (e: LogEntry) => `${e.kind}:${e.id}`;

	const WEEK = 7 * 24 * 60 * 60 * 1000;
	const recent = $derived(data.entries.filter((e) => e.at >= data.now - WEEK || live(e)));
	const earlier = $derived(data.entries.filter((e) => !(e.at >= data.now - WEEK || live(e))));

	function live(e: LogEntry): boolean {
		return e.kind === 'scan' ? e.running : e.state === 'running' || e.state === 'waiting';
	}

	$effect(() => {
		if (!data.entries.some(live)) return;
		const t = setInterval(() => void invalidateAll(), 1000);
		return () => clearInterval(t);
	});

	const appName = (app: string) => (app ? `${app.toUpperCase()} BACKUP` : 'A FILE');
	const fromWords = {
		desktop: 'FROM THIS DESKTOP',
		tablet: 'FROM A TABLET',
		phone: 'FROM A PHONE'
	};

	/** How many Works its folds took a series out of, when any. */
	const droppedWords = (e: LogEntry) =>
		e.dropped.length
			? ` · ${n(e.dropped.length)} ${e.dropped.length === 1 ? 'WORK' : 'WORKS'} DROPPED`
			: '';

	function head(e: LogEntry): { a: string; b: string; ruled: boolean } {
		const when = `${dayMonth(e.at)}, ${clock(e.at)}`;
		if (e.kind === 'scan') {
			if (e.running)
				return {
					a: `SCAN · ${e.label || 'THE LIBRARY FOLDER'}`,
					b: `RUNNING · ${Math.floor(e.progress * 100)}%`,
					ruled: false
				};
			return {
				a: `SCAN · ${n(e.series)} SERIES`,
				b: `${when} · ${e.label || 'THE LIBRARY FOLDER'}${e.failedFiles ? ` · ${n(e.failedFiles)} ${e.failedFiles === 1 ? 'FILE' : 'FILES'} FAILED` : ''}${droppedWords(e)}`,
				ruled: false
			};
		}
		if (e.state === 'refused')
			return {
				a: `${appName(e.app)} · NOT READ`,
				b: `${when} · ${refusalLines(e.refusal).a} · NOTHING CHANGED`,
				ruled: true
			};
		if (e.state === 'waiting')
			return {
				a: `${appName(e.app)} · WAITING`,
				b: 'STARTS WHEN THE RUNNING SCAN ENDS',
				ruled: false
			};
		if (e.state === 'running')
			return {
				a: `${appName(e.app)} · IMPORTING`,
				b: `${n(e.seriesDone)} OF ${n(e.seriesTotal)} SERIES`,
				ruled: false
			};
		const parts = [
			when,
			`${n(e.counts.fresh)} NEW`,
			e.counts.merged ? `${n(e.counts.merged)} MERGED` : '',
			e.counts.noSource ? `${n(e.counts.noSource)} WITHOUT A SOURCE` : '',
			e.state === 'failed' ? 'STOPPED' : ''
		].filter(Boolean);
		return {
			a: `${appName(e.app)} · ${n(e.counts.fresh + e.counts.merged)} SERIES`,
			b: parts.join(' · ') + droppedWords(e),
			ruled: e.state === 'failed'
		};
	}
</script>

<!--
	The Works a job's folds took a series out of (doc/IMPORT-BACKUP.md, "The
	log"), drawn as REFUSED is: one line each, the Work a link while it still
	exists (the server checks its id with its created_at).
-->
{#snippet droppedRows(dropped: LogEntry['dropped'])}
	{#if dropped.length}
		<div class="kv">
			<div class="k">WORKS</div>
			<div class="dropped">
				{#each dropped as d, i (i)}
					<div>
						{#if d.workId !== null}
							<a href={resolve('/work/[id]', { id: String(d.workId) })}>{d.line}</a>
						{:else}
							{d.line}
						{/if}
					</div>
				{/each}
			</div>
		</div>
	{/if}
{/snippet}

<svelte:head><title>Import log · tsundoku</title></svelte:head>

<TopBar label="Import log">
	{#snippet middle()}
		<div class="bar-title">
			<h1 class="t">IMPORT LOG</h1>
			<div class="s">EVERY IMPORT AND SCAN, NEWEST FIRST</div>
		</div>
	{/snippet}
	{#snippet right()}
		<a class="cellx" href={resolve('/import')}>IMPORT A BACKUP →</a>
	{/snippet}
</TopBar>

<section class="pg" aria-label="Import log">
	{#if data.entries.length === 0}
		<div class="lab first"><span>NOTHING YET</span></div>
		<p class="prose">
			No backup has come in and no scan has run. <b>IMPORT A BACKUP</b> brings in a library from a phone's
			app; RESCAN reads the library folder.
		</p>
	{/if}
	{#each [{ t: '01 — THIS WEEK', list: recent, first: true }, { t: recent.length ? '02 — EARLIER' : '01 — EARLIER', list: earlier, first: recent.length === 0 }] as group (group.t)}
		{#if group.list.length > 0}
			<div class="lab" class:first={group.first}>
				<span>{group.t}</span><span class="r">{n(group.list.length)}</span>
			</div>
			<div class="blk">
				{#each group.list as e (key(e))}
					{@const h = head(e)}
					{@const isOpen = open === key(e)}
					<div class="entry">
						<div class="r" class:ruled={h.ruled}>
							<div class="tx">
								<div class="am">{h.a}</div>
								<div class="b">{h.b}</div>
							</div>
							<button
								type="button"
								class="ac"
								class:inv={isOpen}
								aria-expanded={isOpen}
								onclick={() => (open = isOpen ? null : key(e))}
								>{isOpen ? 'CLOSE ↑' : 'OPEN ↓'}</button
							>
						</div>
						{#if live(e)}
							<div class="prog">
								<i
									style:width="{e.kind === 'scan'
										? Math.floor(e.progress * 100)
										: e.seriesTotal > 0
											? Math.floor((e.seriesDone / e.seriesTotal) * 100)
											: 0}%"
								></i>
							</div>
						{/if}
						{#if isOpen}
							<div class="detail">
								{#if e.kind === 'backup'}
									<div class="kv">
										<div class="k">FILE</div>
										<div>
											{e.fileName} · {sizeWords(e.fileBytes)}{e.origin
												? ` · ${fromWords[e.origin as keyof typeof fromWords] ?? ''}`
												: ''}
										</div>
									</div>
									{#if e.state === 'refused'}
										<div class="kv">
											<div class="k">WHY</div>
											<div>{e.refusal}</div>
										</div>
									{/if}
									{#if e.outcome.noSource?.length}
										<div class="kv">
											<div class="k">EXTENSIONS</div>
											<div>
												NONE INSTALLED FOR {e.outcome.noSource
													.map((x) => x.name)
													.join(', ')
													.toUpperCase()}
											</div>
										</div>
									{/if}
									{#if e.outcome.shelves?.length || e.outcome.leftOut?.length}
										<div class="kv">
											<div class="k">SHELVES</div>
											<div>
												{(e.outcome.shelves ?? []).join(' · ').toUpperCase()}{e.outcome.leftOut
													?.length
													? ` · ${e.outcome.leftOut.join(', ').toUpperCase()} LEFT OUT`
													: ''}
											</div>
										</div>
									{/if}
									{#if e.outcome.refused?.length}
										<div class="kv">
											<div class="k">REFUSED</div>
											<div>
												{n(e.outcome.refused.length)} DAMAGED · {e.outcome.refused
													.map((t) => t || 'untitled')
													.join(', ')}
											</div>
										</div>
									{/if}
									{@render droppedRows(e.dropped)}
									{#if e.hidden}<HiddenFold hidden={e.hidden} />{/if}
									{#if e.state !== 'refused'}
										<div class="go">
											<a class="btn" href={resolve('/import/[id]', { id: String(e.id) })}
												>THE FULL RESULT →</a
											>
										</div>
									{/if}
								{:else}
									<div class="kv">
										<div class="k">READ</div>
										<div>{e.label || 'THE LIBRARY FOLDER'}</div>
									</div>
									<div class="kv">
										<div class="k">BROUGHT</div>
										<div>
											{n(e.series)} SERIES{e.failedFiles
												? ` · ${n(e.failedFiles)} ${e.failedFiles === 1 ? 'FILE' : 'FILES'} FAILED`
												: ''}
										</div>
									</div>
									{@render droppedRows(e.dropped)}
									{#if e.hidden}<HiddenFold hidden={e.hidden} />{/if}
								{/if}
							</div>
						{/if}
					</div>
				{/each}
			</div>
			{#if group.first}
				<div class="note">
					AN IMPORT RUNNING OR WAITING SITS AT THE TOP, WITH ITS BAR. COUNTS FOLLOW REVEAL.
				</div>
			{/if}
		{/if}
	{/each}
</section>

<style>
	.detail {
		display: flex;
		flex-direction: column;
		gap: 12px;
		padding: 16px 20px 20px;
		border-top: var(--hairline);
		background: var(--surface-panel);
		font: 400 13px/1.45 var(--font-mono);
	}
	.kv {
		display: grid;
		grid-template-columns: 120px minmax(0, 1fr);
		gap: 12px;
		overflow-wrap: anywhere;
	}
	.dropped {
		display: flex;
		flex-direction: column;
		gap: 4px;
	}
	.dropped a {
		color: inherit;
		text-decoration: underline;
	}
	.go {
		display: flex;
		gap: 12px;
	}
	@media (max-width: 599px) {
		.kv {
			grid-template-columns: minmax(0, 1fr);
			gap: 4px;
		}
	}
</style>

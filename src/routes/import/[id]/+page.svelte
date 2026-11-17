<script lang="ts">
	import HiddenFold from '../HiddenFold.svelte';
	import { deserialize, enhance } from '$app/forms';
	import { invalidateAll } from '$app/navigation';
	import { resolve } from '$app/paths';
	import TopBar from '$lib/components/chrome/TopBar.svelte';
	import StartTrail from '$lib/components/start/StartTrail.svelte';
	import {
		clock,
		dayMonth,
		n,
		refusalLines,
		seeAll,
		SEE_ALL_PAGE,
		sizeWords,
		took,
		type MissingSource
	} from '$lib/import/backup-preview';
	import type { Kind } from '$lib/library/types';

	/**
	 * One chosen file (doc/IMPORT-BACKUP.md): what it holds before anything is
	 * written, IMPORT, its progress and its result, with a narrow layout for
	 * the phone. The page follows the row; while it runs it asks again every
	 * second.
	 */
	let { data, form } = $props();

	// ---- the preview -------------------------------------------------------------
	let unticked = $state<string[]>([]);
	const toggle = (name: string) =>
		(unticked = unticked.includes(name) ? unticked.filter((x) => x !== name) : [...unticked, name]);

	let seeing = $state(false);
	let query = $state('');
	let tab = $state<Kind | null>(null);
	let shown = $state(SEE_ALL_PAGE);
	const list = $derived(
		data.view === 'preview' ? seeAll(data.preview.rows, { query, kind: tab, shown }) : null
	);

	/** INSTALL from the preview: what EXTENSIONS' own INSTALL posts (doc/IMPORT-BACKUP.md, "Installing a missing source"). */
	let installing = $state<Record<string, 'installing' | 'untrusted' | 'failed'>>({});
	async function install(sources: MissingSource[]) {
		for (const s of sources) {
			if (!s.found) continue;
			installing = { ...installing, [s.id]: 'installing' };
			const body = new FormData();
			body.set('pkg', s.found.pkg);
			let outcome: 'done' | 'untrusted' | 'failed' = 'failed';
			try {
				const res = await fetch('/browse/extensions?/install', {
					method: 'POST',
					headers: { 'x-sveltekit-action': 'true' },
					body
				});
				const r = deserialize(await res.text());
				if (r.type === 'success') outcome = 'done';
				else if (r.type === 'failure' && /UNTRUSTED|signed/i.test(JSON.stringify(r.data)))
					outcome = 'untrusted';
			} catch {
				outcome = 'failed';
			}
			const next = { ...installing };
			if (outcome === 'done') delete next[s.id];
			else next[s.id] = outcome;
			installing = next;
		}
		await invalidateAll();
	}

	const shelvesTicked = $derived(
		data.view === 'preview'
			? data.preview.categories.filter((c) => c.effect !== 'rates' && !unticked.includes(c.name))
			: []
	);
	const ratingsTicked = $derived(
		data.view === 'preview'
			? data.preview.categories.filter((c) => c.effect === 'rates' && !unticked.includes(c.name))
			: []
	);
	const kindWord = (k: Kind) => k.toUpperCase();

	// ---- following a run ---------------------------------------------------------
	$effect(() => {
		if (data.view !== 'progress') return;
		const t = setInterval(() => void invalidateAll(), 1000);
		return () => clearInterval(t);
	});

	let copied = $state(false);
	async function copyPath(path: string) {
		try {
			await navigator.clipboard.writeText(path);
			copied = true;
		} catch {
			copied = false;
		}
	}
</script>

<svelte:head><title>Import a backup · tsundoku</title></svelte:head>

{#if data.view === 'tv'}
	<!-- The TV never imports: the server refuses, and says so here. -->
	<TopBar label="Import a backup">
		{#snippet left()}
			<a class="cellx back" href={resolve('/')}><span>←</span><span class="word">LIBRARY</span></a>
		{/snippet}
		{#snippet middle()}
			<div class="bar-title">
				<h1 class="t">IMPORT A BACKUP</h1>
			</div>
		{/snippet}
	</TopBar>
	<section class="pg" aria-label="Not on a TV">
		<div class="drop" role="alert">
			<div class="r ruled">
				<div class="tx">
					<div class="am">{data.reason.split(' · ')[0]}</div>
					<div class="b">{data.reason.split(' · ').slice(1).join(' · ')}</div>
				</div>
			</div>
		</div>
	</section>
{:else if data.view === 'preview'}
	{@const p = data.preview}
	{@const found = p.missing.filter((m) => m.found && !installing[m.id])}
	{@const without = p.missing.reduce((a, m) => a + m.series, 0)}
	{@const left = p.leftOut.browsed + p.leftOut.local + p.leftOut.damaged.length}
	<TopBar label="Import a backup">
		{#snippet left()}
			<a class="cellx back" href={resolve('/import')}
				><span>←</span><span class="word">BACK</span></a
			>
		{/snippet}
		{#snippet middle()}
			<div class="bar-title">
				<h1 class="t">MIHON BACKUP</h1>
				<div class="s">
					{data.row.fileName} · {sizeWords(data.row.fileBytes)}{data.row.madeAt
						? ` · MADE ${dayMonth(data.row.madeAt)}, ${clock(data.row.madeAt)}`
						: ''}
				</div>
			</div>
		{/snippet}
		{#snippet right()}
			<a class="cellx wide" href={resolve('/import')}>CHOOSE ANOTHER</a>
		{/snippet}
	</TopBar>
	<!-- The way back to GET STARTED, while 03's trip lasts (doc/ONBOARDING.md). -->
	<StartTrail start={data.start} />

	<section class="pg" aria-label="What the backup holds">
		<div class="lab first">
			<span>01 — WHAT IT HOLDS</span><span class="r">NOTHING WRITTEN YET</span>
		</div>
		<h2 class="h1 flush">
			{n(p.series)} series, from {n(p.sources)}
			{p.sources === 1 ? 'source' : 'sources'}.
		</h2>
		<div class="nums" aria-label="What it holds">
			{#each p.kinds.slice(0, 3) as k (k.kind)}
				<div>
					<div class="v">{n(k.series)}</div>
					<div class="t">{kindWord(k.kind)}</div>
				</div>
			{/each}
			<div>
				<div class="v acc">{n(p.withReading)}</div>
				<div class="t">WITH READING · {n(p.chaptersRead)} CHAPTERS READ</div>
			</div>
			<!-- Four cells always, as the board draws them: fewer kinds leave a blank cell, not a gap. -->
			{#each [0, 1, 2].slice(Math.min(3, p.kinds.length)) as i (i)}<div
					aria-hidden="true"
				></div>{/each}
		</div>

		{#if p.same}
			<div class="same">
				<div class="band top">
					<div class="bt">
						<div class="a">THE SAME MIHON LIBRARY CAME IN ON {dayMonth(p.same.at)}</div>
						<div class="b">THIS ONE ADDS AND UPDATES · NOTHING IS REMOVED</div>
					</div>
					<a class="bc" href={resolve('/import/log')}>LOG →</a>
				</div>
				<div class="nums flush">
					<div>
						<div class="v acc">{n(p.same.fresh)}</div>
						<div class="t">NEW</div>
					</div>
					<div>
						<div class="v">{n(p.same.here)}</div>
						<div class="t">ALREADY HERE</div>
					</div>
					<div>
						<div class="v">{n(p.same.newer)}</div>
						<div class="t">WITH NEWER READING</div>
					</div>
					<div>
						<div class="v">{n(p.same.gone)}</div>
						<div class="t">GONE FROM THE APP · STAY HERE</div>
					</div>
				</div>
			</div>
		{/if}

		<div class="blk under">
			<div class="r">
				<div class="tx">
					{#if p.same}
						<div class="am">SEE WHAT IT HOLDS</div>
						<div class="b">EVERY SERIES IN THE FILE, MARKED WHERE IT IS ALREADY HERE</div>
					{:else if p.alreadyHere > 0}
						<div class="am">{n(p.alreadyHere)} ALREADY IN YOUR LIBRARY</div>
						<div class="b">
							MERGED, NOT DOUBLED · READ STATE ONLY MOVES FORWARD · YOUR TITLES, RATINGS AND FAVS
							STAY
						</div>
					{:else}
						<div class="am">NONE OF IT IS HERE YET</div>
						<div class="b">EVERY SERIES COMES IN NEW, ON THE NEW SHELF</div>
					{/if}
				</div>
				<button type="button" class="ac" aria-expanded={seeing} onclick={() => (seeing = !seeing)}>
					{seeing ? 'CLOSE ↑' : `SEE ALL ${n(p.series)} →`}
				</button>
			</div>
			{#if seeing && list}
				<div class="see" aria-label="Every series in the file">
					<div class="find">
						<input
							type="search"
							bind:value={query}
							placeholder="/ search the backup"
							aria-label="Search the backup"
						/>
					</div>
					<div class="tabs" role="tablist" aria-label="Kinds">
						<button
							type="button"
							role="tab"
							aria-selected={tab === null}
							onclick={() => (tab = null)}>ALL <span>{n(p.series)}</span></button
						>
						{#each p.kinds as k (k.kind)}
							<button
								type="button"
								role="tab"
								aria-selected={tab === k.kind}
								onclick={() => (tab = k.kind)}>{kindWord(k.kind)} <span>{n(k.series)}</span></button
							>
						{/each}
					</div>
					{#each list.rows as r, i (i)}
						<div class="r">
							<div class="tx">
								<div class="a one">{r.title}</div>
								<div class="b">
									{kindWord(r.kind)} · {r.source.toUpperCase() || 'NO NAME'} · {r.read > 0
										? `CH. ${n(r.read)} OF ${n(r.chapters)} READ`
										: 'NOT STARTED'}{r.categories.length
										? ` · ${r.categories.join(' · ').toUpperCase()}`
										: ''}
								</div>
							</div>
							{#if r.here}<div class="cl">ALREADY HERE</div>{:else if r.missing}<div class="cl">
									NO SOURCE
								</div>{/if}
						</div>
					{/each}
					<div class="r foot">
						<div class="tx">
							<div class="b">
								{n(list.rows.length)} OF {n(list.matching)} SHOWN HERE · {SEE_ALL_PAGE} AT A TIME
							</div>
						</div>
						{#if list.rows.length < list.matching}
							<button type="button" class="ac" onclick={() => (shown += SEE_ALL_PAGE)}
								>{SEE_ALL_PAGE} FURTHER ↓</button
							>
						{/if}
					</div>
				</div>
			{/if}
		</div>
		<div class="note">
			{n(p.chapters)} CHAPTERS · NO CHAPTER FILES: A BACKUP NEVER HOLDS THEM
		</div>

		<div class="lab">
			<span>02 — SOURCES IT NEEDS</span><span class="r"
				>{p.missing.length} OF {p.sources} MISSING</span
			>
		</div>
		{#if p.missing.length === 0}
			<p class="prose">Every source in it comes from an extension you have.</p>
		{:else}
			<p class="prose before">
				{p.sources - p.missing.length} sources come from extensions you have. {p.missing.length ===
				1
					? "This one doesn't."
					: `These ${p.missing.length} don't.`} Install them now, or bring their series in without a source
				and install later.
			</p>
			<div class="blk" aria-label="Missing sources">
				{#if found.length > 0}
					<div class="band">
						<div class="bt"><div class="a">{found.length} FOUND IN YOUR REPOSITORIES</div></div>
						<button type="button" class="bc fill" onclick={() => install(found)}
							>INSTALL ALL FOUND</button
						>
					</div>
				{/if}
				{#each p.missing as s (s.id)}
					{@const st = installing[s.id]}
					<div class="r" class:ruled={!s.found || st === 'untrusted'}>
						<div class="tx">
							<div class="a">{s.name}</div>
							<div class="b">
								{n(s.series)} SERIES · {st === 'installing'
									? 'INSTALLING'
									: st === 'untrusted'
										? "UNTRUSTED: NOT SIGNED BY THE REPOSITORY'S KEY"
										: st === 'failed'
											? 'IT DID NOT INSTALL'
											: s.found
												? `FOUND IN ${s.found.repo.toUpperCase()}`
												: "NO REPOSITORY YOU'VE ADDED LISTS IT"}
							</div>
						</div>
						{#if st === 'installing'}
							<div class="cl">INSTALLING…</div>
						{:else}
							<div class="cl wide">SKIP: NO NEW CHAPTERS</div>
							{#if st === 'untrusted'}
								<a class="ac" href="{resolve('/browse/extensions')}?tab=available">REVIEW…</a>
							{:else if s.found}
								<button type="button" class="ac fill" onclick={() => install([s])}>INSTALL</button>
							{:else}
								<a class="ac go" href="{resolve('/browse/extensions')}?tab=repos"
									>ADD A REPOSITORY</a
								>
							{/if}
						{/if}
					</div>
				{/each}
			</div>
			<div class="note">
				SKIPPED, A SOURCE'S SERIES STILL COME IN, CHAPTERS LISTED AND READING KEPT, MARKED NO
				SOURCE. INSTALLING IT LATER CONNECTS THEM.
			</div>
		{/if}

		{#if p.categories.length > 0}
			<div class="lab">
				<span>03 — CATEGORIES</span><span class="r"
					>{shelvesTicked.length}
					{shelvesTicked.length === 1 ? 'SHELF' : 'SHELVES'} · {ratingsTicked.length}
					{ratingsTicked.length === 1 ? 'RATING' : 'RATINGS'} · {unticked.length} LEFT OUT</span
				>
			</div>
			<div class="chips" role="group" aria-label="Categories">
				{#each p.categories as c (c.name)}
					{@const on = !unticked.includes(c.name)}
					<button
						type="button"
						class="chip"
						class:on
						aria-pressed={on}
						onclick={() => toggle(c.name)}
						>{on ? '✓ ' : ''}{c.name}<span class="n"
							>{n(c.series)}{c.effect === 'rates'
								? ` · RATES ${c.rating}`
								: c.effect === 'adds'
									? ' · ADDS TO YOUR SHELF'
									: ''}</span
						></button
					>
				{/each}
			</div>
			<div class="note">UNTICKED, A CATEGORY ISN'T A SHELF. ITS SERIES STILL COME IN.</div>
		{/if}

		{#if left > 0}
			<div class="lab"><span>04 — LEFT OUT</span><span class="r">{n(left)}</span></div>
			<div class="blk">
				{#if p.leftOut.browsed > 0}
					<div class="r">
						<div class="tx">
							<div class="a">{n(p.leftOut.browsed)} browsed, never added to the app's library</div>
						</div>
						<div class="cl">AS ALWAYS</div>
					</div>
				{/if}
				{#if p.leftOut.local > 0}
					<div class="r">
						<div class="tx">
							<div class="a">{n(p.leftOut.local)} from the app's local folder</div>
						</div>
						<div class="cl wide">THEIR FILES STAYED ON THE PHONE</div>
					</div>
				{/if}
				{#if p.leftOut.damaged.length > 0}
					<div class="r ruled">
						<div class="tx">
							<div class="a">{n(p.leftOut.damaged.length)} couldn't be read</div>
							<div class="b">
								{p.leftOut.damaged.map((t) => t || 'UNTITLED').join(' · ')} — DAMAGED ENTRIES IN THE BACKUP
							</div>
						</div>
						<div class="cl">REFUSED</div>
					</div>
				{/if}
			</div>
		{/if}
	</section>

	{#if form && 'message' in form}
		<div class="band" role="alert">
			<div class="bt"><div class="a">IT DID NOT START · {form.message}</div></div>
		</div>
	{/if}
	<form method="POST" action="?/import" class="confirm" use:enhance>
		{#each unticked as name (name)}<input type="hidden" name="leaveOut" value={name} />{/each}
		<div class="sum">
			<div class="a">
				{n(p.series)} SERIES · {shelvesTicked.length}
				{shelvesTicked.length === 1 ? 'SHELF' : 'SHELVES'} · {p.missing.length}
				{p.missing.length === 1 ? 'SOURCE' : 'SOURCES'} MISSING
			</div>
			<div class="b">
				{#if data.running}
					{data.running.label} IS RUNNING · THIS IMPORT STARTS WHEN IT ENDS
				{:else if without > 0}
					{n(without)} SERIES WOULD COME IN WITHOUT A SOURCE
				{:else}
					EVERY SERIES COMES IN WITH ITS SOURCE
				{/if}
			</div>
		</div>
		<a class="c" href={resolve('/import')}>CANCEL</a>
		<button type="submit" class="c go">IMPORT {n(p.series)} SERIES →</button>
	</form>
{:else if data.view === 'refused'}
	{@const lines = refusalLines(data.reason)}
	<TopBar label="Import a backup">
		{#snippet left()}
			<a class="cellx back" href={resolve('/import')}
				><span>←</span><span class="word">BACK</span></a
			>
		{/snippet}
		{#snippet middle()}
			<div class="bar-title">
				<h1 class="t">IMPORT A BACKUP</h1>
				<div class="s">{data.row.fileName}</div>
			</div>
		{/snippet}
	</TopBar>
	<!-- The way back to GET STARTED, while 03's trip lasts (doc/ONBOARDING.md). -->
	<StartTrail start={data.start} />
	<section class="pg" aria-label="Not a backup">
		<div class="drop" role="alert">
			<div class="r ruled">
				<div class="tx">
					<div class="am">{lines.a}</div>
					<div class="b">{lines.b}</div>
				</div>
				<a class="ac" href={resolve('/import')}>CHOOSE ANOTHER</a>
			</div>
		</div>
	</section>
{:else if data.view === 'progress'}
	{@const r = data.row}
	{@const pct = r.seriesTotal > 0 ? Math.floor((r.seriesDone / r.seriesTotal) * 100) : 0}
	<TopBar label="Import a backup">
		{#snippet left()}
			<a class="cellx back" href={resolve('/')}><span>←</span><span class="word">LIBRARY</span></a>
		{/snippet}
		{#snippet middle()}
			<div class="bar-title">
				<h1 class="t">MIHON BACKUP</h1>
				<div class="s">
					{r.state === 'waiting'
						? 'WAITING ITS TURN'
						: `IMPORTING · STARTED ${clock(r.startedAt ?? r.createdAt)}`}
				</div>
			</div>
		{/snippet}
	</TopBar>
	<!-- The way back to GET STARTED, while 03's trip lasts (doc/ONBOARDING.md). -->
	<StartTrail start={data.start} />
	<section class="pg" aria-label="Importing">
		<div class="lab first">
			<span>00 — IMPORTING</span><span class="r">YOU CAN LEAVE THIS PAGE</span>
		</div>
		<h2 class="h1">Bringing in {n(r.seriesTotal)} series.</h2>
		{#if r.state === 'waiting'}
			<div class="blk spaced" role="status">
				<div class="band">
					<div class="bt">
						<div class="a">
							{data.running ? `${data.running.label} IS RUNNING` : 'A SCAN IS RUNNING'} · {Math.floor(
								(data.running?.progress ?? 0) * 100
							)}%
						</div>
						<div class="b">THIS IMPORT STARTS WHEN IT ENDS · YOU CAN LEAVE THIS PAGE</div>
					</div>
					<a class="bc" href={resolve('/import/log')}>LOG →</a>
				</div>
			</div>
		{:else}
			<div class="count" role="status">
				<span>{n(r.seriesDone)} OF {n(r.seriesTotal)} SERIES</span><span>{pct}%</span>
			</div>
			<div class="prog"><i style:width="{pct}%"></i></div>
		{/if}
		<div class="blk spaced">
			<div class="r">
				<div class="tx"><div class="am">✓ READ THE BACKUP</div></div>
				<div class="cl">{n(r.seriesTotal)} SERIES</div>
			</div>
			<div class="r" class:ruled={r.state === 'running'}>
				<div class="tx">
					<div class="am">{r.state === 'running' ? '▶ ' : ''}WRITING SERIES AND CHAPTERS</div>
				</div>
				<div class="cl">{n(r.seriesDone)} / {n(r.seriesTotal)}</div>
			</div>
			<div class="r">
				<div class="tx"><div class="am">READING HISTORY, SHELVES AND RATINGS</div></div>
				<div class="cl wide">WITH EACH SERIES</div>
			</div>
		</div>
		<p class="prose spaced">
			It runs on the computer, so closing this tab or the phone doesn't stop it. The library's band
			follows it, and the <b>IMPORT LOG</b> keeps the result.
		</p>
	</section>
{:else}
	{@const e = data.entry}
	{@const o = e.outcome}
	{@const leftOut = (o.browsed ?? 0) + (o.local ?? 0) + (o.refused?.length ?? 0)}
	{@const failed = e.state === 'failed'}
	<TopBar label="Import a backup">
		{#snippet left()}
			<a class="cellx back" href={resolve('/')}><span>←</span><span class="word">LIBRARY</span></a>
		{/snippet}
		{#snippet middle()}
			<div class="bar-title">
				<h1 class="t">MIHON BACKUP</h1>
				<div class="s">
					{failed ? 'STOPPED' : 'IMPORTED'}
					{dayMonth(e.at)}, {clock(e.at)} · KEPT IN THE IMPORT LOG
				</div>
			</div>
		{/snippet}
	</TopBar>
	<!-- The way back to GET STARTED, while 03's trip lasts (doc/ONBOARDING.md). -->
	<StartTrail start={data.start} />
	<section class="pg" aria-label="The result">
		<div class="lab first">
			<span>00 — {failed ? 'STOPPED' : 'IMPORTED'}</span><span class="r"
				>{data.row.startedAt && data.row.finishedAt
					? `IN ${took(data.row.finishedAt - data.row.startedAt)}`
					: ''}</span
			>
		</div>
		<h2 class="h1">
			{failed
				? `The import stopped after ${n(e.counts.fresh + e.counts.merged)} series.`
				: `${n(e.counts.fresh + e.counts.merged)} series came in.`}
		</h2>
		<div class="nums" aria-label="The result">
			<div>
				<div class="v acc">{n(e.counts.fresh)}</div>
				<div class="t">NEW · ON THE NEW SHELF</div>
			</div>
			<div>
				<div class="v">{n(e.counts.merged)}</div>
				<div class="t">MERGED WITH SERIES ALREADY HERE</div>
			</div>
			<div>
				<div class="v">{n(e.counts.noSource)}</div>
				<div class="t">WITHOUT A SOURCE</div>
			</div>
			<div>
				<div class="v">{n(leftOut)}</div>
				<div class="t">LEFT OUT OR REFUSED</div>
			</div>
		</div>

		<div class="lab">
			<span>01 — WHAT CAME IN</span><span class="r"
				>{o.shelves?.length ?? 0}
				{o.shelves?.length === 1 ? 'SHELF' : 'SHELVES'} · {o.rated ?? 0} RATED</span
			>
		</div>
		<div class="blk">
			<div class="r">
				<div class="tx">
					<div class="a">{n(e.counts.fresh)} new series</div>
					<div class="b">ON THE NEW SHELF UNTIL YOU TIDY IT</div>
				</div>
				<a class="ac fill" href="{resolve('/')}?shelf=new">TIDY NEW →</a>
			</div>
			<div class="r">
				<div class="tx">
					<div class="a">{n(e.counts.merged)} merged with series already here</div>
					<div class="b">READING ONLY MOVED FORWARD · YOUR TITLES, RATINGS AND FAVS KEPT</div>
				</div>
			</div>
			{#if e.counts.noSource > 0}
				<div class="r ruled">
					<div class="tx">
						<div class="a">{n(e.counts.noSource)} series with no source</div>
						<div class="b">
							{data.lacking.join(' · ').toUpperCase()} · CHAPTERS LISTED, READING KEPT · NO NEW CHAPTERS
							UNTIL IT'S INSTALLED
						</div>
					</div>
					<a class="ac go" href="{resolve('/browse/extensions')}?tab=repos">ADD A REPOSITORY</a>
				</div>
			{/if}
			{#if (o.shelves?.length ?? 0) > 0 || (o.rated ?? 0) > 0}
				<div class="r">
					<div class="tx">
						<div class="a">
							{o.shelves?.length ?? 0}
							{o.shelves?.length === 1 ? 'shelf' : 'shelves'}, and {n(o.rated ?? 0)} rated from a category
						</div>
						<div class="b">
							{(o.shelves ?? []).join(' · ').toUpperCase()}{o.leftOut?.length
								? ` · ${o.leftOut.join(', ').toUpperCase()} LEFT OUT`
								: ''}
						</div>
					</div>
				</div>
			{/if}
		</div>

		{#if e.hidden}
			<div class="hidden-fold"><HiddenFold hidden={e.hidden} /></div>
		{/if}

		{#if leftOut > 0}
			<div class="lab">
				<span>02 — LEFT OUT AND REFUSED</span><span class="r">{n(leftOut)}</span>
			</div>
			<div class="blk">
				{#if o.browsed}
					<div class="r">
						<div class="tx">
							<div class="a">{n(o.browsed)} browsed, never in the app's library</div>
						</div>
						<div class="cl">LEFT OUT</div>
					</div>
				{/if}
				{#if o.local}
					<div class="r">
						<div class="tx"><div class="a">{n(o.local)} from the app's local folder</div></div>
						<div class="cl wide">THEIR FILES STAYED ON THE PHONE</div>
					</div>
				{/if}
				{#if o.refused?.length}
					<div class="r ruled">
						<div class="tx">
							<div class="a">{n(o.refused.length)} couldn't be read</div>
							<div class="b">
								{o.refused.map((t) => t || 'UNTITLED').join(' · ')} — DAMAGED ENTRIES IN THE BACKUP
							</div>
						</div>
						<div class="cl">REFUSED</div>
					</div>
				{/if}
			</div>
		{/if}

		<div class="lab">
			<span>03 — DOWNLOADS AREN'T IN A BACKUP</span><span class="r wide"
				>0 CHAPTER FILES CAME IN</span
			>
		</div>
		<div class="blk">
			<div class="dl">
				<p class="prose">
					A backup holds the list, the reading and the categories, never the chapters themselves.
					Every chapter came in listed, <b>NOT DOWNLOADED</b>: DOWNLOAD on a series fetches it from
					its source.
				</p>
				<p class="prose">
					Chapters already downloaded on the phone can come too. Copy Mihon's <b>downloads</b>
					folder from the phone into this folder on the computer, then <b>RESCAN</b>. They attach to
					these series by source and title.
				</p>
				<div class="path">
					<div class="p">{data.downloads}</div>
					<button type="button" onclick={() => copyPath(data.downloads)}
						>{copied ? 'COPIED' : 'COPY'}</button
					>
				</div>
				<div class="note">
					ON THE PHONE IT'S MIHON'S STORAGE FOLDER › downloads, ONE FOLDER PER SOURCE
				</div>
			</div>
		</div>

		<div class="ends">
			<a class="btn primary lg" href={resolve('/')}>OPEN THE LIBRARY →</a>
			<a class="btn lg" href={resolve('/import')}>IMPORT ANOTHER</a>
		</div>
	</section>
{/if}

<style>
	.back {
		border-right: var(--hairline);
	}
	.h1 {
		margin: 10px 0 0;
		font: 500 34px/1.2 var(--font-sans);
	}
	.spaced {
		margin-top: 24px;
	}
	/* Extracted from the design: the heading sits on 01's label, the
	   ALREADY row hangs under the numbers with no rule of its own on top, and
	   02's prose keeps 16px from its rows. */
	.h1.flush {
		margin-top: 0;
	}
	.blk.under {
		border-top: 0;
	}
	.hidden-fold {
		margin-top: 16px;
	}
	.prose.before {
		margin-bottom: 16px;
	}
	.same {
		margin-top: 24px;
		border: var(--hairline);
	}
	.same .nums.flush {
		margin-top: 0;
		border: 0;
		border-top: var(--hairline);
	}
	.one {
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}
	.see .find {
		display: flex;
		height: 52px;
		border-bottom: var(--hairline);
	}
	.see input {
		flex: 1;
		min-width: 0;
		padding: 0 20px;
		border: 0;
		background: transparent;
		color: var(--text-1);
		font: 400 15px var(--font-mono);
	}
	.tabs {
		display: flex;
		flex-wrap: wrap;
		border-bottom: var(--hairline);
	}
	.tabs button {
		height: 44px;
		padding: 0 18px;
		border: 0;
		border-right: var(--hairline);
		background: transparent;
		color: var(--text-1);
		font: 500 13px var(--font-mono);
		cursor: pointer;
	}
	.tabs button[aria-selected='true'] {
		background: var(--surface-inverse);
		color: var(--text-inverse);
	}
	.tabs span {
		margin-left: 8px;
		opacity: 0.7;
	}
	.see > .r + .r {
		border-top: var(--hairline);
	}
	.chips {
		display: flex;
		flex-wrap: wrap;
		gap: 8px;
	}
	.chip {
		display: inline-flex;
		align-items: center;
		gap: 12px;
		min-height: 44px;
		padding: 0 14px;
		border: 1px solid var(--line-2);
		background: transparent;
		font: 500 13px var(--font-mono);
		color: var(--text-1);
		cursor: pointer;
	}
	.chip .n {
		color: var(--text-2);
		font-weight: 400;
	}
	.chip.on {
		background: var(--surface-inverse);
		border-color: var(--surface-inverse);
		color: var(--text-inverse);
	}
	.chip.on .n {
		color: var(--text-inverse);
	}
	.count {
		display: flex;
		justify-content: space-between;
		margin: 24px 0 10px;
		font: 500 14px var(--font-mono);
	}
	.drop {
		margin-top: 8px;
		border: 1px solid var(--text-1);
	}
	.dl {
		display: flex;
		flex-direction: column;
		gap: 14px;
		padding: 20px;
	}
	.path {
		display: flex;
		height: 52px;
		border: 1px solid var(--text-1);
	}
	.path .p {
		flex: 1;
		min-width: 0;
		display: flex;
		align-items: center;
		padding: 0 16px;
		font: 400 14px var(--font-mono);
		overflow: hidden;
		white-space: nowrap;
		text-overflow: ellipsis;
	}
	.path button {
		padding: 0 22px;
		border: 0;
		border-left: 1px solid var(--text-1);
		background: transparent;
		color: var(--text-1);
		font: 500 14px var(--font-mono);
		cursor: pointer;
	}
	.ends {
		display: flex;
		flex-wrap: wrap;
		gap: 12px;
		margin-top: 40px;
	}
	@media (max-width: 599px) {
		.wide {
			display: none;
		}
		.h1 {
			font-size: 26px;
		}
		.back .word {
			display: none;
		}
		.ends .btn {
			width: 100%;
		}
	}
</style>

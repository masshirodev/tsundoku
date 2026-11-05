<script lang="ts">
	import { enhance } from '$app/forms';
	import Sheet from '$lib/components/chrome/Sheet.svelte';
	import { anilistUrl, malUrl, viaLabel, type SeasonRow } from '$lib/library/catalogue';
	import { kindFacts } from '$lib/library/kinds';
	import type { Kind } from '$lib/library/types';
	import { ago, clock, SERVICE_NAME, STATUSES, statusLabel } from '$lib/library/tracking';
	import { ranobeLines } from '$lib/library/ranobe';
	import type { LinkState } from '$lib/server/catalogue';
	import type { SeasonTrack, Tracking } from '$lib/server/tracking';
	import type { RanobeSeries } from '$lib/server/ranobe-review';
	import {
		formatWords,
		listState,
		mainList,
		seasonCellTag,
		seasonWords,
		type SheetAt
	} from './lists';

	/**
	 * EDIT's sheet (Series Link 1m, redrawn by the LISTS handoff's 1E; card
	 * c424; doc/TRACKING.md). It is the entry's home now: ENTRY holds OPEN ↗,
	 * CHANGE and UNLINK, which left the row; STATUS, set once for both
	 * catalogues, sends at once; PROGRESS is each catalogue's, from the reading
	 * or watching here. DONE only closes. No SCORE: the RATING row is the score.
	 *
	 * An anime edits one season at a time (c240): a tab per season, opening on
	 * the line EDIT was pressed on, and a change goes to that season's entries
	 * only. A flat list, or a show of one season, has no tabs and names no
	 * season anywhere (c423): its one "season" is 0 inside, never on screen.
	 *
	 * On Ranobe's line it is the same sheet without STATUS to set: Ranobe works
	 * the status out from the reads, and the RATING row and FAV are what it gets.
	 *
	 * OPEN ↗ needs the entry's own kind: a linked anime's entries are AniList's
	 * and MAL's `/anime/` ones, and `/manga/23` is another work (c298).
	 */
	let {
		open,
		at,
		tracking,
		link,
		ranobe = null,
		kind,
		seasons = null,
		seriesId,
		linksHref,
		offline = false,
		onclose
	}: {
		open: boolean;
		/** The line EDIT was pressed on. */
		at: SheetAt;
		tracking: Tracking | null;
		/** AniList's link, for a comic's ENTRY; an anime's comes from `seasons`. */
		link: LinkState | null;
		ranobe?: RanobeSeries | null;
		/** The entry's kind, for OPEN ↗ (`link.linked.kind`, else the series'). */
		kind: Kind;
		/** An anime's seasons, for the tabs and each season's ENTRY; null for a comic. */
		seasons?: SeasonRow[] | null;
		seriesId: number;
		linksHref: string;
		offline?: boolean;
		onclose: () => void;
	} = $props();

	const anime = $derived(!!seasons && seasons.length > 0);
	const tabbed = $derived(anime && (seasons?.length ?? 0) > 1);
	let picked = $state<number | null>(null);
	// Every opening starts on the line it was opened from.
	$effect(() => {
		if (open) picked = at.list === 'anilist' ? at.season : null;
	});
	const seasonNo = $derived(
		anime ? (picked ?? tracking?.openSeason ?? seasons?.[0]?.season ?? 0) : null
	);
	/** The season's own rows: its link (ENTRY) and its facts (STATUS, PROGRESS). */
	const sv = $derived(
		seasonNo === null ? null : (seasons?.find((s) => s.season === seasonNo) ?? null)
	);
	const st = $derived<SeasonTrack | null>(
		seasonNo === null ? null : (tracking?.seasons?.find((s) => s.season === seasonNo) ?? null)
	);
	const facts = $derived(st ? st.facts : (tracking?.facts ?? []));
	/** What this sheet calls the season, or nothing on a flat list (c423). */
	const words = $derived(seasonWords(seasonNo, tabbed));

	// ---- ENTRY -----------------------------------------------------------------
	const entry = $derived.by(() => {
		if (anime) {
			const l = sv?.link ?? null;
			return l
				? {
						title: l.title,
						anilistId: l.anilistId,
						malId: l.malId,
						via: l.via,
						format: l.format,
						episodes: l.episodes,
						year: l.year,
						entryKind: kind
					}
				: null;
		}
		const l = link?.linked ?? null;
		return l
			? {
					title: l.title,
					anilistId: l.anilistId,
					malId: l.malId,
					via: l.via as string,
					format: l.format,
					episodes: null,
					year: null,
					entryKind: l.kind ?? kind
				}
			: null;
	});
	const entryMeta = $derived(
		entry
			? [
					entry.anilistId ? `ANILIST ${entry.anilistId}` : '',
					entry.malId ? `MAL ${entry.malId}` : '',
					formatWords(entry.format),
					entry.episodes ? `${entry.episodes} EP.` : '',
					entry.year ? String(entry.year) : ''
				]
					.filter(Boolean)
					.join(' · ')
			: ''
	);
	const openHref = $derived(
		entry
			? entry.anilistId
				? anilistUrl(entry.anilistId, entry.entryKind)
				: entry.malId
					? malUrl(entry.malId, entry.entryKind)
					: null
			: null
	);
	/** CHANGE and FIND: the review, on this season when the show has several. */
	const findHref = $derived(
		`${linksHref}?series=${seriesId}${tabbed && seasonNo !== null ? `&season=${seasonNo}` : ''}`
	);

	// ---- STATUS and PROGRESS ------------------------------------------------------
	/** Sends nothing: hidden, cover-only, the wrong kind, or a kind AniList doesn't track. */
	const untracked = $derived.by(() => {
		if (!tracking || !entry) return 'NOT LINKED · NOTHING TO SET';
		if (tracking.hidden) return 'NOTHING SENT · HIDDEN SERIES STAY OFF EVERY LIST';
		if (st ? st.wrongKind : link?.linked?.wrongKind)
			return 'LINKED TO THE WRONG KIND · NOTHING SENT';
		if (st ? st.coverOnly : tracking.coverOnly) return 'COVER AND DETAILS ONLY · NEVER TRACKED';
		if (!tracking.catalogueTracks)
			return ranobe?.configured
				? 'COVER AND DETAILS · TRACKED ON RANOBE'
				: 'COVER AND DETAILS · NOT TRACKED HERE';
		return null;
	});
	const signed = $derived(
		facts
			.filter((f) => f.linked && f.signedIn)
			.map((f) => SERVICE_NAME[f.service])
			.join(' AND ')
	);
	const linkedNames = $derived(
		facts
			.filter((f) => f.linked)
			.map((f) => SERVICE_NAME[f.service])
			.join(' AND ')
	);
	const status = $derived(listState(facts)?.status ?? null);
	/** "EP." on an anime's season, "CH." on a comic: the registry's unit. */
	const unit = $derived(`${kindFacts(anime ? kind : (link?.linked?.kind ?? kind)).unit.short}.`);
	const rows = $derived(
		facts
			.filter((f) => f.linked)
			.map((f) => {
				const media =
					(f.service === 'anilist' ? entry?.anilistId : entry?.malId) ??
					tracking?.links.find((l) => l.service === f.service)?.mediaId ??
					0;
				const of = 'of' in f && typeof f.of === 'number' ? f.of : null;
				return {
					service: f.service,
					a: f.state
						? [
								f.state.progress ? `${unit} ${f.state.progress}` : 'NOT STARTED',
								of ? `OF ${of}` : '',
								f.state.score ? String(Math.round(f.state.score)) : ''
							]
								.filter(Boolean)
								.join(' · ')
						: 'NOT ON YOUR LIST',
					b: !f.signedIn
						? 'NOT SIGNED IN'
						: f === mainList(facts)
							? 'SIGNED IN · MAIN LIST'
							: 'SIGNED IN',
					href:
						f.service === 'anilist'
							? anilistUrl(media, entry?.entryKind ?? kind)
							: malUrl(media, entry?.entryKind ?? kind)
				};
			})
	);
	/** The season's own short word under its tab: "COMPLETED", "EP. 8 / 24", "NOT LINKED". */
	function tabWord(t: SeasonTrack | undefined, row: SeasonRow): string {
		if (!row.link) return 'NOT LINKED';
		const main = t ? listState(t.facts) : null;
		if (!main) return 'NOT LISTED';
		const label = statusLabel(main.status ?? 'reading', true);
		const of = t?.facts.find((f) => f.linked)?.of ?? null;
		const where = main.progress > 0 ? `EP. ${main.progress}${of ? ` / ${of}` : ''}` : '';
		return label === 'COMPLETED' ? label : where || label;
	}

	// ---- Ranobe's sheet ------------------------------------------------------------
	const rnb = $derived(at.list === 'ranobe');
	const rnbTrack = $derived(
		ranobe ? ranobeLines(ranobe.facts, { now: Date.now(), offline, ago, clock }) : null
	);
	const rnbWord = $derived(
		ranobe?.facts.remote?.status
			? ranobe.facts.remote.status.replace(/_/g, ' ').toUpperCase()
			: 'NOT IN YOUR LIBRARY YET'
	);
	const rnbScope = $derived(
		(seasons?.length ?? 0) > 1
			? `ONE ENTRY FOR ALL ${seasons!.length} SEASONS`
			: 'ONE FOR THE SERIES'
	);
	const title = $derived(
		rnb
			? 'RANOBE'
			: [tabbed && seasonNo !== null ? seasonCellTag(seasonNo) : '', linkedNames || 'ANILIST']
					.filter(Boolean)
					.join(' · ')
	);
</script>

<Sheet {open} {onclose} label="Tracking">
	<div class="head">
		<div class="ti">{title}</div>
		<button type="button" class="done" onclick={onclose}>DONE</button>
	</div>

	{#if rnb && ranobe}
		<div class="sl">
			<div>ENTRY</div>
			<div class="r">{rnbScope}</div>
		</div>
		<div class="blk">
			{#if ranobe.link}
				<div class="ent">
					<div class="t">{ranobe.link.title}</div>
					<div class="m">{ranobe.link.meta}</div>
				</div>
				<div class="cells">
					<a class="c" href={ranobe.link.href} target="_blank" rel="noopener noreferrer external"
						>RANOBE ↗</a
					>
					{#if offline}
						<span class="c dim" aria-disabled="true">CHANGE</span>
						<span class="c dim" aria-disabled="true">UNLINK</span>
					{:else}
						<!-- eslint-disable-next-line svelte/no-navigation-without-resolve -- built from resolve() -->
						<a class="c" href="{linksHref}?series={seriesId}&service=ranobe">CHANGE</a>
						<form method="POST" action="?/unlinkRanobe" use:enhance class="cf">
							<button type="submit" class="c">UNLINK</button>
						</form>
					{/if}
				</div>
			{:else}
				<div class="ent"><div class="t mu">Not on Ranobe</div></div>
			{/if}
		</div>
		<div class="sl"><div>STATUS</div></div>
		<div class="note">
			<b>{rnbWord} · WORKED OUT FROM WHAT YOU READ</b> THE RATING ROW AND FAV ARE WHAT RANOBE GETS.
		</div>
		{#if rnbTrack}
			<div class="sl"><div>PROGRESS</div></div>
			<div class="blk">
				<div class="pr">
					<div class="k">RANOBE</div>
					<div class="v">
						<span>{rnbTrack.lines[0].l.replace(/^RANOBE · /, '')}</span>
						{#if rnbTrack.lines[0].r}<span class="d">{rnbTrack.lines[0].r}</span>{/if}
					</div>
				</div>
			</div>
		{/if}
		<div class="note">
			UNLINK IS A DECISION: NO PASS LINKS IT AGAIN, AND WHAT WAS SENT STAYS ON RANOBE.
		</div>
	{:else}
		{#if tabbed && seasons}
			<!-- One season at a time (Track Calls, question 2): a tab each, opening on the
			     line EDIT was pressed on. The tab's own word says where that season is. -->
			<div class="sl">
				<div>SEASON</div>
				<div class="r">OPENED ON THE ONE YOU PICKED</div>
			</div>
			<div
				class="tabs"
				role="tablist"
				aria-label="Season"
				style:grid-template-columns="repeat({seasons.length}, minmax(0, 1fr))"
			>
				{#each seasons as row (row.season)}
					<button
						type="button"
						role="tab"
						class="tab"
						aria-selected={row.season === seasonNo}
						class:on={row.season === seasonNo}
						onclick={() => (picked = row.season)}
					>
						<span class="no">{seasonCellTag(row.season)}</span>
						<span class="w"
							>{tabWord(
								tracking?.seasons?.find((s) => s.season === row.season),
								row
							)}</span
						>
					</button>
				{/each}
			</div>
		{/if}

		<div class="sl">
			<div>ENTRY</div>
			<div class="r">{entry ? viaLabel(entry.via) : ''}</div>
		</div>
		<div class="blk">
			{#if entry}
				<div class="ent">
					<div class="t">{entry.title}</div>
					<div class="m">{entryMeta}</div>
				</div>
				<div class="cells">
					{#if openHref}
						<a class="c" href={openHref} target="_blank" rel="noopener noreferrer external"
							>OPEN ↗</a
						>
					{/if}
					{#if offline}
						<span class="c dim" aria-disabled="true">CHANGE</span>
						<span class="c dim" aria-disabled="true">UNLINK</span>
					{:else}
						<!-- eslint-disable-next-line svelte/no-navigation-without-resolve -- built from resolve() -->
						<a class="c" href={findHref}>CHANGE</a>
						<!-- The sheet closes on UNLINK, so the band's UNDO is in sight (c520). -->
						<form
							method="POST"
							action="?/unlink"
							use:enhance={() =>
								async ({ result, update }) => {
									await update();
									if (result.type === 'success') onclose();
								}}
							class="cf"
						>
							{#if tabbed && seasonNo !== null}
								<!-- The season the tab is on; a show of one season names none, and its UNLINK takes every part. -->
								<input type="hidden" name="season" value={seasonNo} />
							{/if}
							<button type="submit" class="c">UNLINK</button>
						</form>
					{/if}
				</div>
			{:else}
				<div class="ent"><div class="t mu">Not linked</div></div>
				<div class="cells">
					{#if offline}
						<span class="c dim" aria-disabled="true">FIND</span>
					{:else}
						<!-- eslint-disable-next-line svelte/no-navigation-without-resolve -- built from resolve() -->
						<a class="c" href={findHref}>FIND</a>
					{/if}
				</div>
			{/if}
		</div>

		{#if untracked}
			<div class="sl"><div>STATUS</div></div>
			<div class="note">{untracked}</div>
		{:else}
			<div class="sl">
				<div>STATUS</div>
				<div class="r">{signed ? `GOES TO ${signed} · A TAP SENDS IT` : 'NOTHING SIGNED IN'}</div>
			</div>
			{#if signed}
				<form method="POST" action="?/tracking" use:enhance class="sts">
					{#if anime && seasonNo !== null}
						<!-- One season's entry, named even when it is the only one: a part's
						     send must not reach its sibling (c240). -->
						<input type="hidden" name="season" value={seasonNo} />
						<input type="hidden" name="part" value={st?.part ?? 1} />
					{/if}
					{#each STATUSES as s (s)}
						<button
							type="submit"
							class="st"
							name="status"
							value={s}
							disabled={offline}
							class:on={s === status}
							aria-pressed={s === status}>{statusLabel(s, anime)}</button
						>
					{/each}
				</form>
			{:else}
				<div class="note">SIGN IN ON SETTINGS, 06 — CATALOGUES, AND A TAP HERE SENDS IT.</div>
			{/if}

			<div class="sl">
				<div>PROGRESS</div>
				<div class="r">
					{anime
						? [words.subject, st && st.parts.length > 1 ? 'IN EACH PART' : 'FROM YOUR WATCHING']
								.filter(Boolean)
								.join(' ')
						: 'FROM YOUR READING'}
				</div>
			</div>
			<div class="blk">
				{#each rows as r (r.service)}
					<div class="pr">
						<div class="k">{SERVICE_NAME[r.service]}</div>
						<div class="v"><span>{r.a}</span><span class="d">{r.b}</span></div>
						<a class="o" href={r.href} target="_blank" rel="noopener noreferrer external">OPEN ↗</a>
					</div>
				{/each}
				{#if st && st.other}
					<!-- The season's other part is named, so a part completed at EP. 12 reads as
					     expected beside the one being watched (Track Calls, "question 3"). -->
					<div class="pr">
						<div class="k">PART {st.other.part}</div>
						<div class="v">
							<span>
								{[
									st.other.state ? statusLabel(st.other.state, true) : 'NOT LISTED',
									st.other.progress > 0
										? `EP. ${st.other.progress}${st.other.of ? ` OF ${st.other.of}` : ''}`
										: ''
								]
									.filter(Boolean)
									.join(' · ')}
							</span>
						</div>
					</div>
				{/if}
			</div>

			<div class="note">
				{#if anime}
					<p>
						A CHANGE HERE GOES TO {words.scope}{tabbed ? '. THE OTHER SEASONS KEEP THEIRS.' : '.'}
					</p>
					<p>
						A SEASON’S FIRST EPISODE WATCHED SENDS WATCHING, ITS LAST SENDS COMPLETED. ON HOLD AND
						DROPPED ARE YOURS AND STAY: ONLY THE EPISODE GOES.
					</p>
					<p>
						YOUR RATING IS THE SCORE THE SEASON BEING WATCHED GETS{tabbed
							? '. EACH OTHER SEASON KEEPS THE SCORE ANILIST HAS FOR IT.'
							: '.'}
					</p>
				{:else}
					<p>A CHANGE HERE GOES TO BOTH CATALOGUES.</p>
					<p>
						THE CHAPTER ONLY MOVES FORWARD. A LOWER ONE IS NEVER SENT, SO MIHON ON THE PHONE CAN BE
						AHEAD.
					</p>
					<p>YOUR RATING IS THE SCORE BOTH CATALOGUES GET: SET IT IN THE RATING ROW.</p>
				{/if}
			</div>
		{/if}
	{/if}
</Sheet>

<style>
	/* 1E (doc/handoffs/series-lists/Sheet.dc.html), transcribed: the mock's literals,
	   colours from tokens. The spacing is hand-set and on no ladder: leave it. */
	.head {
		flex-shrink: 0;
		display: flex;
		align-items: stretch;
		min-height: 56px;
		border-bottom: 1px solid var(--line-1);
	}
	.ti {
		flex: 1;
		min-width: 0;
		display: flex;
		align-items: center;
		padding: 0 16px;
		font: 500 14px var(--font-mono);
		letter-spacing: 0.04em;
	}
	.done {
		display: flex;
		align-items: center;
		padding: 0 18px;
		border: 0;
		border-left: 1px solid var(--line-1);
		border-radius: 0;
		background: transparent;
		color: var(--text-1);
		font: 500 13px var(--font-mono);
		letter-spacing: 0.04em;
		cursor: pointer;
	}
	.sl {
		flex-shrink: 0;
		display: flex;
		justify-content: space-between;
		gap: 12px;
		padding: 18px 16px 8px;
		font: 500 12px var(--font-mono);
		letter-spacing: 0.06em;
		color: var(--text-2);
	}
	.sl .r {
		font-weight: 400;
		letter-spacing: 0.02em;
		text-align: right;
	}
	.blk {
		flex-shrink: 0;
		margin: 0 16px;
		border: 1px solid var(--line-1);
		display: flex;
		flex-direction: column;
	}
	.ent {
		display: flex;
		flex-direction: column;
		gap: 5px;
		padding: 12px 14px;
	}
	.ent .t {
		font: 500 15px/1.3 var(--font-sans);
	}
	.ent .t.mu {
		color: var(--text-2);
	}
	.ent .m {
		font: 400 12px/1.4 var(--font-mono);
		color: var(--text-2);
	}
	.cells {
		display: grid;
		grid-auto-flow: column;
		grid-auto-columns: minmax(0, 1fr);
		min-height: 48px;
		border-top: 1px solid var(--line-1);
	}
	.cf {
		display: flex;
	}
	.c {
		flex: 1;
		display: flex;
		align-items: center;
		justify-content: center;
		padding: 0 12px;
		border: 0;
		border-right: 1px solid var(--line-1);
		border-radius: 0;
		background: transparent;
		color: var(--text-1);
		font: 500 13px var(--font-mono);
		letter-spacing: 0.04em;
		white-space: nowrap;
		text-decoration: none;
		cursor: pointer;
	}
	.cells > :last-child,
	.cells > :last-child .c {
		border-right: 0;
	}
	.c.dim {
		opacity: 0.35;
		cursor: default;
	}
	.tabs {
		flex-shrink: 0;
		display: grid;
		margin: 0 16px;
		border: 1px solid var(--line-1);
	}
	.tab {
		display: flex;
		flex-direction: column;
		gap: 3px;
		min-width: 0;
		min-height: 52px;
		padding: 8px 10px;
		border: 0;
		border-right: 1px solid var(--line-1);
		border-radius: 0;
		background: transparent;
		color: var(--text-1);
		text-align: left;
		cursor: pointer;
	}
	.tab:last-child {
		border-right: 0;
	}
	.tab .no {
		font: 500 12px var(--font-mono);
	}
	.tab .w {
		font: 400 11px var(--font-mono);
		color: var(--text-2);
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}
	.tab.on {
		background: var(--surface-inverse);
		color: var(--text-inverse);
	}
	.tab.on .w {
		color: var(--text-inverse);
	}
	.sts {
		flex-shrink: 0;
		display: grid;
		grid-template-columns: repeat(3, minmax(0, 1fr));
		margin: 0 16px;
		border: 1px solid var(--line-1);
	}
	.st {
		min-height: 48px;
		border: 0;
		border-right: 1px solid var(--line-1);
		border-bottom: 1px solid var(--line-1);
		border-radius: 0;
		background: transparent;
		color: var(--text-1);
		font: 500 13px var(--font-mono);
		letter-spacing: 0.04em;
		cursor: pointer;
	}
	/* By type, not child: an anime's two hidden fields come first in the form. */
	.st:nth-of-type(3n) {
		border-right: 0;
	}
	.st.on {
		background: var(--surface-inverse);
		color: var(--text-inverse);
	}
	.st:disabled {
		opacity: 0.35;
		cursor: default;
	}
	.pr {
		display: flex;
		align-items: stretch;
		min-height: 52px;
		border-bottom: 1px solid var(--line-1);
	}
	.pr:last-child {
		border-bottom: 0;
	}
	.k {
		width: 84px;
		flex-shrink: 0;
		display: flex;
		align-items: center;
		padding-left: 12px;
		border-right: 1px solid var(--line-1);
		font: 500 12px var(--font-mono);
		letter-spacing: 0.06em;
		color: var(--text-2);
	}
	.v {
		flex: 1;
		min-width: 0;
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 4px 8px;
		padding: 8px 12px;
		font: 500 13px var(--font-mono);
	}
	.v .d {
		font-weight: 400;
		color: var(--text-2);
	}
	.o {
		display: flex;
		align-items: center;
		padding: 0 14px;
		border-left: 1px solid var(--line-1);
		color: var(--text-1);
		font: 500 13px var(--font-mono);
		letter-spacing: 0.04em;
		white-space: nowrap;
		text-decoration: none;
	}
	.note {
		flex-shrink: 0;
		display: flex;
		flex-direction: column;
		gap: 8px;
		padding: 16px;
		font: 400 12px/1.5 var(--font-mono);
		color: var(--text-2);
	}
	.note b {
		font-weight: 500;
		color: var(--text-1);
	}
	.note p {
		margin: 0;
	}
</style>

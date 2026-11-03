<script lang="ts">
	import { enhance } from '$app/forms';
	import Sheet from '$lib/components/chrome/Sheet.svelte';
	import { anilistUrl, malUrl, type SeasonRow } from '$lib/library/catalogue';
	import type { Kind } from '$lib/library/types';
	import { SERVICE_NAME, STATUSES, statusLabel } from '$lib/library/tracking';
	import type { SeasonTrack, Tracking } from '$lib/server/tracking';

	/**
	 * TRACKING (Series Link 1m; doc/TRACKING.md): status, set once for both
	 * catalogues, and each one's progress from the watching here. A tap sends at
	 * once; DONE only closes. No SCORE row since c67: the rating above is out
	 * of 10 as the catalogues' score is, and is what they get, one number.
	 *
	 * An anime edits one season at a time (c240; Track Calls, "Which season"):
	 * a tab per season, opening on the one being watched, and a change goes to
	 * that season's entries only. The other seasons keep their own.
	 *
	 * OPEN ↗ needs the entry's own kind: a linked anime's entries are AniList's
	 * and MAL's `/anime/` ones, and `/manga/23` is another work (c298).
	 */
	let {
		open,
		tracking,
		kind,
		seasons = null,
		onclose
	}: {
		open: boolean;
		tracking: Tracking;
		kind: Kind;
		/** An anime's seasons, for the tabs; null for a comic. */
		seasons?: SeasonRow[] | null;
		onclose: () => void;
	} = $props();

	const anime = $derived(!!seasons && seasons.length > 0 && kind === 'anime');
	const tabbed = $derived(anime && (seasons?.length ?? 0) > 1);
	let picked = $state<number | null>(null);
	// The season the sheet is on, tabs or not: a one-season anime is still one
	// season's entry, and a change must name it (c240).
	const at = $derived(
		anime
			? (tracking.seasons?.find((s) => s.season === (picked ?? tracking.openSeason)) ??
					tracking.seasons?.[0] ??
					null)
			: null
	);
	const seasonNo = $derived(at?.season ?? tracking.openSeason ?? 0);
	const status = $derived(
		at
			? (at.facts.find((f) => f.service === 'anilist')?.state?.status ??
					at.facts.find((f) => f.service === 'mal')?.state?.status ??
					null)
			: tracking.status
	);
	const both = $derived(
		(at ? at.facts : tracking.facts)
			.filter((f) => f.linked && f.signedIn)
			.map((f) => SERVICE_NAME[f.service])
			.join(' AND ')
	);
	/** The season's own short word under its tab: "COMPLETED", "EP. 8 / 24", "NOT LISTED". */
	function tabWord(sv: SeasonTrack): string {
		const main =
			sv.facts.find((f) => f.service === 'anilist')?.state ??
			sv.facts.find((f) => f.service === 'mal')?.state ??
			null;
		if (!sv.link)
			return sv.parts.length > 1 ? `${sv.parts.length} PARTS · NOT LISTED` : 'NOT LISTED';
		if (!main) return 'NOT LISTED';
		const label = statusLabel(main.status ?? 'reading', true);
		const of = sv.facts.find((f) => f.linked)?.of ?? null;
		const where = main.progress > 0 ? `EP. ${main.progress}${of ? ` / ${of}` : ''}` : '';
		return label === 'COMPLETED' ? label : [label, where].filter(Boolean).join(' · ');
	}
	/** "EP." on an anime's season, "CH." on a comic (c240). */
	const unit = $derived(anime ? 'EP.' : 'CH.');
	const rows = $derived(
		(at ? at.facts : tracking.facts)
			.filter((f) => f.linked)
			.map((f) => {
				const media = at
					? f.service === 'anilist'
						? (at.link?.anilistId ?? 0)
						: (at.link?.malId ?? 0)
					: (tracking.links.find((l) => l.service === f.service)?.mediaId ?? 0);
				return {
					service: f.service,
					a: f.state
						? [
								f.state.progress ? `${unit} ${f.state.progress}` : 'NOT STARTED',
								'of' in f && f.of ? `OF ${f.of}` : '',
								f.state.score ? String(Math.round(f.state.score)) : ''
							]
								.filter(Boolean)
								.join(' · ')
						: 'NOT ON YOUR LIST',
					b: !f.signedIn
						? 'NOT SIGNED IN'
						: f.service === 'anilist'
							? 'SIGNED IN · MAIN LIST'
							: 'SIGNED IN',
					href: f.service === 'anilist' ? anilistUrl(media, kind) : malUrl(media, kind)
				};
			})
	);
	/** What the notes say about the scope: one season's entry, or both. */
	const scope = $derived(at ? `SEASON ${seasonNo}’S ENTRY ON BOTH CATALOGUES` : 'BOTH CATALOGUES');
</script>

<Sheet {open} {onclose} label="Tracking">
	<div class="head">
		<div class="title">TRACKING</div>
		<button type="button" class="done" onclick={onclose}>DONE</button>
	</div>

	{#if tabbed && tracking.seasons}
		<!-- One season at a time (Track Calls, question 2): a tab each, opening on the
		     one being watched. The tag's own word says where that season is. -->
		<div class="sl">
			<div>SEASON</div>
			<div>OPENED ON THE ONE BEING WATCHED</div>
		</div>
		<div class="tabs" role="tablist" aria-label="Season">
			{#each tracking.seasons as sv (sv.season)}
				<button
					type="button"
					role="tab"
					aria-selected={sv.season === seasonNo}
					class:on={sv.season === seasonNo}
					onclick={() => (picked = sv.season)}
				>
					<span class="tno">S{sv.season}</span>
					<span class="tword">{tabWord(sv)}</span>
				</button>
			{/each}
		</div>
	{/if}

	<div class="sl">
		<div>STATUS</div>
		<div>{both ? `GOES TO ${both}` : 'NOTHING SIGNED IN'}</div>
	</div>
	<form method="POST" action="?/tracking" use:enhance class="statuses">
		{#if at}
			<!-- One season's entry, named even when it is the only one: a part's
			     send must not reach its sibling (c240). -->
			<input type="hidden" name="season" value={seasonNo} />
			<input type="hidden" name="part" value={at.part ?? 1} />
		{/if}
		{#each STATUSES as s (s)}
			<button
				type="submit"
				name="status"
				value={s}
				class:on={s === status}
				aria-pressed={s === status}>{statusLabel(s, anime)}</button
			>
		{/each}
	</form>

	<div class="sl">
		<div>PROGRESS</div>
		<div>
			{at
				? at.parts.length > 1
					? `SEASON ${seasonNo} IN EACH PART`
					: `SEASON ${seasonNo} FROM YOUR WATCHING`
				: 'FROM YOUR READING'}
		</div>
	</div>
	<div class="progress">
		{#each rows as r (r.service)}
			<div class="prow">
				<div class="label">{SERVICE_NAME[r.service]}</div>
				<div class="pv"><span>{r.a}</span><span class="dim">{r.b}</span></div>
				<a class="open" href={r.href} target="_blank" rel="noopener noreferrer external">OPEN ↗</a>
			</div>
		{/each}
	</div>
	{#if at && at.other}
		<!-- The season's other part is named, so a part completed at EP. 12 reads as
		     expected beside the one being watched (Track Calls, "question 3"). -->
		<div class="progress">
			<div class="prow">
				<div class="label">PART {at.other.part}</div>
				<div class="pv">
					<span>
						{[
							at.other.state ? statusLabel(at.other.state, true) : 'NOT LISTED',
							at.other.progress > 0
								? `EP. ${at.other.progress}${at.other.of ? ` OF ${at.other.of}` : ''}`
								: ''
						]
							.filter(Boolean)
							.join(' · ')}
					</span>
				</div>
			</div>
		</div>
	{/if}

	<div class="notes">
		{#if at}
			<p>A CHANGE HERE GOES TO {scope}. THE OTHER SEASONS KEEP THEIRS.</p>
			<p>
				A SEASON’S FIRST EPISODE WATCHED SENDS WATCHING, ITS LAST SENDS COMPLETED. ON HOLD, DROPPED
				AND PLANNING ARE YOURS AND STAY.
			</p>
			<p>
				YOUR RATING IS THE SCORE THE SEASON BEING WATCHED GETS. EACH OTHER SEASON KEEPS THE SCORE
				ANILIST HAS FOR IT.
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
</Sheet>

<style>
	/* Series Link 1m, transcribed: the mock's literals; colours are tokens. */
	.head {
		flex-shrink: 0;
		display: flex;
		align-items: stretch;
		height: 64px;
		border-bottom: 1px solid var(--line-1);
	}
	.title {
		flex: 1;
		min-width: 0;
		display: flex;
		align-items: center;
		padding: 0 var(--pad);
		font: 500 15px var(--font-mono);
		letter-spacing: 0.04em;
	}
	.done {
		display: flex;
		align-items: center;
		padding: 0 28px;
		border: 0;
		border-radius: 0;
		background: var(--accent);
		color: var(--on-accent);
		font: 500 14px var(--font-mono);
		letter-spacing: 0.04em;
		cursor: pointer;
	}
	.sl {
		display: flex;
		justify-content: space-between;
		gap: 12px;
		padding: 22px var(--pad) 10px;
		font: 500 13px var(--font-mono);
		color: var(--text-2);
		letter-spacing: 0.06em;
	}
	.sl:first-of-type {
		padding-top: 18px;
	}
	.tabs {
		display: flex;
		flex-wrap: wrap;
		border-top: 1px solid var(--line-1);
		border-bottom: 1px solid var(--line-1);
	}
	.tabs button {
		flex: 1;
		min-width: 0;
		min-height: 60px;
		display: flex;
		flex-direction: column;
		align-items: flex-start;
		justify-content: center;
		gap: 3px;
		padding: 8px 12px;
		border: 0;
		border-right: 1px solid var(--line-1);
		border-radius: 0;
		background: transparent;
		color: var(--text-1);
		font: 500 13px var(--font-mono);
		text-align: left;
		cursor: pointer;
	}
	.tabs button:last-child {
		border-right: 0;
	}
	.tabs button.on {
		background: var(--surface-inverse);
		color: var(--text-inverse);
	}
	.tno {
		font-size: 14px;
		letter-spacing: 0.04em;
	}
	.tword {
		font-weight: 400;
		font-size: 11px;
		letter-spacing: 0.04em;
		opacity: 0.75;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
		max-width: 100%;
	}
	.statuses {
		display: grid;
		grid-template-columns: repeat(5, minmax(0, 1fr));
		border-top: 1px solid var(--line-1);
	}
	.statuses button {
		display: flex;
		align-items: center;
		justify-content: center;
		border: 0;
		border-right: 1px solid var(--line-1);
		border-radius: 0;
		background: transparent;
		color: var(--text-1);
		cursor: pointer;
	}
	.statuses button {
		min-height: 56px;
		border-bottom: 1px solid var(--line-1);
		font: 500 14px var(--font-mono);
		letter-spacing: 0.04em;
	}
	.statuses button.on {
		background: var(--surface-inverse);
		color: var(--text-inverse);
	}
	.progress {
		display: flex;
		flex-direction: column;
		border-top: 1px solid var(--line-1);
	}
	.prow {
		display: flex;
		align-items: stretch;
		min-height: 56px;
		border-bottom: 1px solid var(--line-1);
	}
	.label {
		display: flex;
		align-items: center;
		width: var(--label-w, 120px);
		padding-left: var(--pad);
		flex-shrink: 0;
		font: 500 12px var(--font-mono);
		letter-spacing: 0.06em;
		color: var(--text-2);
		border-right: 1px solid var(--line-1);
	}
	.pv {
		flex: 1;
		min-width: 0;
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		justify-content: space-between;
		gap: 4px 12px;
		padding: 8px 14px;
		font: 400 13px/1.35 var(--font-mono);
	}
	.dim {
		color: var(--text-2);
	}
	.open {
		display: flex;
		align-items: center;
		padding: 0 20px;
		border-left: 1px solid var(--line-1);
		color: var(--text-1);
		font: 500 13px var(--font-mono);
		letter-spacing: 0.04em;
		white-space: nowrap;
		text-decoration: none;
	}
	.notes {
		display: flex;
		flex-direction: column;
		gap: 8px;
		padding: 16px var(--pad) 20px;
		font: 400 13px/1.45 var(--font-mono);
		color: var(--text-2);
	}
	.notes p {
		margin: 0;
	}
	@media (max-width: 599px) {
		.statuses {
			grid-template-columns: repeat(2, minmax(0, 1fr));
		}
		.label {
			width: 84px;
		}
		.open {
			padding: 0 14px;
		}
		.tabs button {
			min-width: 84px;
		}
	}
</style>

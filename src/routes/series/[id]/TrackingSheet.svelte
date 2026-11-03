<script lang="ts">
	import { enhance } from '$app/forms';
	import Sheet from '$lib/components/chrome/Sheet.svelte';
	import { anilistUrl, malUrl } from '$lib/library/catalogue';
	import type { Kind } from '$lib/library/types';
	import { SERVICE_NAME, STATUSES, STATUS_LABEL } from '$lib/library/tracking';
	import type { Tracking } from '$lib/server/tracking';

	/**
	 * TRACKING (Series Link 1m; doc/TRACKING.md): status, set once for both
	 * catalogues, and each one's progress from the reading here. A tap sends at
	 * once; DONE only closes. No SCORE row since c67: the rating above is out
	 * of 10 as the catalogues' score is, and is what they get, one number.
	 *
	 * OPEN ↗ needs the series' kind: a linked anime's entries are AniList's and
	 * MAL's `/anime/` ones, and `/manga/23` is another work (c298).
	 */
	let {
		open,
		tracking,
		kind,
		onclose
	}: { open: boolean; tracking: Tracking; kind: Kind; onclose: () => void } = $props();

	const status = $derived(tracking.status);
	const both = $derived(
		tracking.facts
			.filter((f) => f.linked && f.signedIn)
			.map((f) => SERVICE_NAME[f.service])
			.join(' AND ')
	);
	const rows = $derived(
		tracking.facts
			.filter((f) => f.linked)
			.map((f) => {
				const media = tracking.links.find((l) => l.service === f.service)?.mediaId ?? 0;
				return {
					service: f.service,
					a: f.state
						? [
								f.state.progress ? `CH. ${f.state.progress}` : 'NOT STARTED',
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
</script>

<Sheet {open} {onclose} label="Tracking">
	<div class="head">
		<div class="title">TRACKING</div>
		<button type="button" class="done" onclick={onclose}>DONE</button>
	</div>

	<div class="sl">
		<div>STATUS</div>
		<div>{both ? `GOES TO ${both}` : 'NOTHING SIGNED IN'}</div>
	</div>
	<form method="POST" action="?/tracking" use:enhance class="statuses">
		{#each STATUSES as s (s)}
			<button
				type="submit"
				name="status"
				value={s}
				class:on={s === status}
				aria-pressed={s === status}>{STATUS_LABEL[s]}</button
			>
		{/each}
	</form>

	<div class="sl">
		<div>PROGRESS</div>
		<div>FROM YOUR READING</div>
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

	<div class="notes">
		<p>A CHANGE HERE GOES TO BOTH CATALOGUES.</p>
		<p>
			THE CHAPTER ONLY MOVES FORWARD. A LOWER ONE IS NEVER SENT, SO MIHON ON THE PHONE CAN BE AHEAD.
		</p>
		<p>YOUR RATING IS THE SCORE BOTH CATALOGUES GET: SET IT IN THE RATING ROW.</p>
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
	}
</style>

<script lang="ts">
	import { n } from '$lib/import/backup-preview';
	import type { HiddenReport } from '$lib/server/import/log';

	/**
	 * What an import brought that belongs to hidden series, with reveal off
	 * (c633; doc/IMPORT-BACKUP.md, "The log"). The import takes everything whatever the
	 * mode, so its report says so, but hidden means hidden here too: how many,
	 * closed until asked, and never a title or a Work's name. The fold is the
	 * series screen's move page's (`.fold`), so it needs nothing new of a reader.
	 */
	let { hidden }: { hidden: HiddenReport } = $props();

	const series = $derived(hidden.fresh + hidden.merged);
	const parts = $derived(
		[
			hidden.fresh ? `${n(hidden.fresh)} NEW` : '',
			hidden.merged ? `${n(hidden.merged)} MERGED` : '',
			hidden.noSource ? `${n(hidden.noSource)} WITHOUT A SOURCE` : '',
			hidden.dropped
				? `${n(hidden.dropped)} ${hidden.dropped === 1 ? 'WORK' : 'WORKS'} DROPPED`
				: ''
		].filter(Boolean)
	);
</script>

<details class="fold">
	<summary
		><span>{n(series + hidden.dropped)} IN HIDDEN SERIES</span><span class="ink">↓</span></summary
	>
	<div class="body">
		<div>{parts.join(' · ')}</div>
		<div class="quiet">THEIR TITLES SHOW ONLY WITH REVEAL ON</div>
	</div>
</details>

<style>
	.fold {
		display: block;
		border: var(--hairline);
	}
	.fold summary {
		display: flex;
		justify-content: space-between;
		align-items: center;
		min-height: 48px;
		padding: 0 var(--pad-phone);
		font: 500 12px var(--font-mono);
		letter-spacing: 0.06em;
		color: var(--text-2);
		cursor: pointer;
		list-style: none;
	}
	.fold summary::-webkit-details-marker {
		display: none;
	}
	.fold summary .ink {
		color: var(--text-1);
	}
	.fold[open] summary .ink {
		transform: rotate(180deg);
	}
	.body {
		display: flex;
		flex-direction: column;
		gap: 4px;
		padding: 12px var(--pad-phone) 16px;
		border-top: var(--hairline);
		font: 400 13px/1.45 var(--font-mono);
	}
	.quiet {
		color: var(--text-2);
		font-size: 12px;
	}
</style>
